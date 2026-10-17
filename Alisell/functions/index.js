// Alisell Cloud Functions (2nd gen, callable). Deploy: firebase deploy --only functions
// Paystack key: firebase functions:secrets:set PAYSTACK_SECRET
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore(), FV = admin.firestore.FieldValue;
const PAYSTACK = defineSecret("PAYSTACK_SECRET");
const plain = { cors: true }, paid = { cors: true, secrets: [PAYSTACK] };

const fail = (c, m) => { throw new HttpsError(c, m); };
const uidOf = (r) => { if (!r.auth) fail("unauthenticated", "Please sign in first"); return r.auth.uid; };
const prof = async (uid) => { const s = await db.doc("users/" + uid).get(); return s.exists ? s.data() : {}; };
const hasRole = (p, role) => (p.roles || []).includes(role);
async function need(r, role) {
  const uid = uidOf(r), p = await prof(uid);
  if (!hasRole(p, role)) fail("permission-denied", "You need the " + role + " role");
  return { uid, p };
}
const ROLES = ["seller", "host", "restaurant", "landlord", "agent"];
const str = (v, max = 500) => String(v == null ? "" : v).slice(0, max);

/* ---------- roles ---------- */
// Roles are only granted after an admin approves identity verification (see reviewVerification).
exports.becomeRole = onCall(plain, async () => { fail("failed-precondition", "Roles are granted after identity verification"); });
exports.setUserRole = onCall(plain, async (r) => {
  await need(r, "admin");
  const { uid, role } = r.data;
  if (!uid || !["customer", ...ROLES, "admin"].includes(role)) fail("invalid-argument", "Invalid user or role");
  await db.doc("users/" + uid).set({ roles: role === "customer" ? [] : [role], updated_at: FV.serverTimestamp() }, { merge: true });
  return { ok: true };
});

/* ---------- orders ---------- */
exports.createOrder = onCall(plain, async (r) => {
  const uid = uidOf(r), { items, name, phone, address } = r.data;
  if (!Array.isArray(items) || !items.length || items.length > 50) fail("invalid-argument", "Your cart is empty");
  if (!address || !phone) fail("invalid-argument", "Delivery address and phone are required");
  const refs = items.map((i) => db.doc("products/" + str(i.productId, 100)));
  const snaps = await db.getAll(...refs);
  let total = 0;
  const lines = snaps.map((s, k) => {
    if (!s.exists) fail("not-found", "A product in your cart no longer exists");
    const qty = Math.max(1, Math.min(99, parseInt(items[k].quantity, 10) || 1)), p = s.data();
    total += Number(p.price) * qty;
    return { productId: s.id, name: p.name || p.title || "", price: Number(p.price), quantity: qty, sellerUid: p.sellerUid || null };
  });
  const ref = await db.collection("orders").add({
    uid, items: lines, total, name: str(name, 100), phone: str(phone, 30), address: str(address),
    status: "placed", payment_status: "pending", deliveryAgentUid: null, created_at: FV.serverTimestamp()
  });
  return { orderId: ref.id, total };
});
exports.claimOrder = onCall(plain, async (r) => {
  const { uid, p } = await need(r, "agent");
  if (!p.verified) fail("failed-precondition", "Verify your identity before claiming orders");
  const ref = db.doc("orders/" + str(r.data.orderId, 100));
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) fail("not-found", "Order not found");
    const o = s.data();
    if (o.payment_status !== "paid") fail("failed-precondition", "Order is not paid yet");
    if (o.deliveryAgentUid) fail("already-exists", "Another agent already claimed this order");
    tx.update(ref, { deliveryAgentUid: uid, status: "assigned", claimed_at: FV.serverTimestamp() });
  });
  return { ok: true };
});
exports.markOrderDelivered = onCall(plain, async (r) => {
  const uid = uidOf(r), ref = db.doc("orders/" + str(r.data.orderId, 100)), s = await ref.get();
  if (!s.exists) fail("not-found", "Order not found");
  if (s.data().deliveryAgentUid !== uid) fail("permission-denied", "This is not your delivery");
  await ref.update({ status: "delivered", delivered_at: FV.serverTimestamp() });
  return { ok: true };
});

/* ---------- bookings ---------- */
exports.createBooking = onCall(plain, async (r) => {
  const uid = uidOf(r), { hotelId, checkIn, checkOut, guests } = r.data;
  const hs = await db.doc("hotels/" + str(hotelId, 100)).get();
  if (!hs.exists) fail("not-found", "Hotel not found");
  const a = new Date(checkIn), b = new Date(checkOut), nights = Math.round((b - a) / 864e5);
  if (isNaN(a) || isNaN(b) || nights < 1 || nights > 90) fail("invalid-argument", "Check your dates");
  const h = hs.data(), total = Number(h.price) * nights;
  const ref = await db.collection("bookings").add({
    customerUid: uid, hotelId: hs.id, hotelName: h.name, hotelOwnerUid: h.ownerUid, checkIn: str(checkIn, 10), checkOut: str(checkOut, 10),
    guests: Math.max(1, parseInt(guests, 10) || 1), nights, total, status: "pending", payment_status: "pending", created_at: FV.serverTimestamp()
  });
  return { bookingId: ref.id, total };
});
exports.updateBookingStatus = onCall(plain, async (r) => {
  const uid = uidOf(r), { bookingId, status } = r.data;
  if (!["confirmed", "cancelled"].includes(status)) fail("invalid-argument", "Invalid status");
  const ref = db.doc("bookings/" + str(bookingId, 100)), s = await ref.get();
  if (!s.exists) fail("not-found", "Booking not found");
  const p = await prof(uid);
  if (s.data().hotelOwnerUid !== uid && !hasRole(p, "admin")) fail("permission-denied", "Not your booking");
  await ref.update({ status, updated_at: FV.serverTimestamp() });
  return { ok: true };
});

/* ---------- restaurant reservations ---------- */
exports.createReservation = onCall(plain, async (r) => {
  const uid = uidOf(r), { restaurantId, date, time, guests } = r.data;
  const rs = await db.doc("restaurants/" + str(restaurantId, 100)).get();
  if (!rs.exists) fail("not-found", "Restaurant not found");
  if (isNaN(new Date(date + "T00:00:00")) || !/^\d{2}:\d{2}$/.test(String(time))) fail("invalid-argument", "Check the date and time");
  const ref = await db.collection("reservations").add({
    customerUid: uid, customerName: r.auth.token.name || r.auth.token.email || "Customer", restaurantId: rs.id, restaurantName: rs.data().name, restaurantOwnerUid: rs.data().ownerUid,
    date: str(date, 10), time: str(time, 5), guests: Math.max(1, Math.min(50, parseInt(guests, 10) || 1)), status: "pending", created_at: FV.serverTimestamp()
  });
  return { reservationId: ref.id };
});
exports.updateReservationStatus = onCall(plain, async (r) => {
  const uid = uidOf(r), { reservationId, status } = r.data;
  if (!["confirmed", "cancelled"].includes(status)) fail("invalid-argument", "Invalid status");
  const ref = db.doc("reservations/" + str(reservationId, 100)), s = await ref.get();
  if (!s.exists) fail("not-found", "Reservation not found");
  if (s.data().restaurantOwnerUid !== uid && !hasRole(await prof(uid), "admin")) fail("permission-denied", "Not your reservation");
  await ref.update({ status, updated_at: FV.serverTimestamp() });
  return { ok: true };
});

/* ---------- payments (Paystack) ---------- */
const coll = (kind) => (kind === "booking" ? "bookings" : kind === "order" ? "orders" : fail("invalid-argument", "Unknown payment type"));
async function paystack(path, opts) {
  const res = await fetch("https://api.paystack.co" + path, { ...opts, headers: { Authorization: "Bearer " + PAYSTACK.value(), "Content-Type": "application/json" } });
  const j = await res.json();
  if (!j.status) fail("internal", j.message || "Paystack error");
  return j.data;
}
exports.initializePayment = onCall(paid, async (r) => {
  const uid = uidOf(r), { kind, id, returnUrl } = r.data, ref = db.doc(coll(kind) + "/" + str(id, 100)), s = await ref.get();
  if (!s.exists) fail("not-found", "Not found");
  const d = s.data();
  if ((d.uid || d.customerUid) !== uid) fail("permission-denied", "Not yours");
  if (d.payment_status === "paid") fail("failed-precondition", "Already paid");
  const email = r.auth.token.email || (await prof(uid)).email || uid + "@alisell.app";
  const data = await paystack("/transaction/initialize", { method: "POST", body: JSON.stringify({ email, amount: Math.round(d.total * 100), callback_url: str(returnUrl, 300), metadata: { kind, id } }) });
  await ref.update({ paymentReference: data.reference });
  return { authorization_url: data.authorization_url, reference: data.reference };
});
exports.verifyPayment = onCall(paid, async (r) => {
  uidOf(r);
  const data = await paystack("/transaction/verify/" + encodeURIComponent(str(r.data.reference, 100)));
  if (data.status !== "success") return { paid: false };
  const { kind, id } = data.metadata || {}, ref = db.doc(coll(kind) + "/" + str(id, 100)), s = await ref.get();
  if (!s.exists || s.data().paymentReference !== data.reference || Math.round(s.data().total * 100) !== data.amount) fail("failed-precondition", "Payment does not match this order");
  if (s.data().payment_status !== "paid") await ref.update({ payment_status: "paid", paid_at: FV.serverTimestamp() });
  return { paid: true };
});

/* ---------- reviews ---------- */
exports.createReview = onCall(plain, async (r) => {
  const uid = uidOf(r), { targetUid, orderId, bookingId, comment } = r.data, rating = parseInt(r.data.rating, 10);
  if (!targetUid || targetUid === uid) fail("invalid-argument", "Invalid review target");
  if (!(rating >= 1 && rating <= 5)) fail("invalid-argument", "Rating must be 1 to 5");
  const key = orderId || bookingId;
  if (!key) fail("invalid-argument", "A review must be linked to an order or booking");
  const src = await db.doc((orderId ? "orders/" : "bookings/") + str(key, 100)).get();
  if (!src.exists || (src.data().uid || src.data().customerUid) !== uid) fail("permission-denied", "You can only review your own purchases");
  const rv = db.doc("reviews/" + uid + "_" + key), tu = db.doc("users/" + targetUid);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(rv)).exists) fail("already-exists", "You already reviewed this");
    tx.set(rv, { reviewerUid: uid, reviewerName: r.auth.token.name || "Customer", targetUid, orderId: orderId || null, bookingId: bookingId || null, rating, comment: str(comment, 1000), created_at: FV.serverTimestamp() });
    tx.set(tu, { ratingSum: FV.increment(rating), ratingCount: FV.increment(1) }, { merge: true });
  });
  return { ok: true };
});

/* ---------- identity verification ---------- */
exports.submitVerification = onCall(plain, async (r) => {
  const uid = uidOf(r), { role, businessName, address, addressProofPath, selfiePath } = r.data, pre = "verification/" + uid + "/";
  if (!ROLES.includes(role)) fail("invalid-argument", "Choose what you want to join as");
  if (!businessName || !address || !String(addressProofPath).startsWith(pre) || !String(selfiePath).startsWith(pre)) fail("invalid-argument", "Name, address, proof of address and a selfie are required");
  await db.doc("verificationRequests/" + uid).set({
    uid, role, businessName: str(businessName, 120), name: r.auth.token.name || "", email: r.auth.token.email || "", address: str(address), addressProofPath, selfiePath, status: "pending", note: "", submitted_at: FV.serverTimestamp()
  });
  return { ok: true };
});
exports.reviewVerification = onCall(plain, async (r) => {
  await need(r, "admin");
  const { uid, decision, note } = r.data;
  if (!uid || !["approved", "rejected"].includes(decision)) fail("invalid-argument", "Invalid decision");
  const ref = db.doc("verificationRequests/" + uid), s = await ref.get();
  if (!s.exists) fail("not-found", "No verification request for that user");
  await ref.set({ status: decision, note: str(note, 300), reviewed_at: FV.serverTimestamp() }, { merge: true });
  if (decision === "approved") await db.doc("users/" + uid).set({ verified: true, roles: FV.arrayUnion(s.data().role) }, { merge: true });
  return { ok: true };
});
exports.getVerificationDocumentUrl = onCall(plain, async (r) => {
  await need(r, "admin");
  const { uid, kind } = r.data;
  if (!uid || !["addressProof", "selfie"].includes(kind)) fail("invalid-argument", "Invalid request");
  const [files] = await admin.storage().bucket().getFiles({ prefix: "verification/" + uid + "/" + kind + "-" });
  if (!files.length) fail("not-found", "No document uploaded");
  const [url] = await files.sort((a, b) => (a.name < b.name ? -1 : 1)).pop().getSignedUrl({ action: "read", expires: Date.now() + 10 * 60 * 1000 });
  return { url };
});

/* ---------- admin ---------- */
exports.getAdminOverview = onCall(plain, async (r) => {
  await need(r, "admin");
  const n = async (q) => (await q.count().get()).data().count, c = (x) => db.collection(x);
  const [users, products, orders, hotels, bookings, properties, restaurants, pendingVerifications] = await Promise.all([
    n(c("users")), n(c("products")), n(c("orders")), n(c("hotels")), n(c("bookings")), n(c("properties")), n(c("restaurants")), n(c("verificationRequests").where("status", "==", "pending"))
  ]);
  return { users, products, orders, hotels, bookings, properties, restaurants, pendingVerifications };
});
