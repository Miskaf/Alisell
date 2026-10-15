// Firestore data layer for Alisell.
// Wraps Firestore reads/writes for products, orders, hotels, bookings,
// properties, reviews, verification requests, and user profiles, and
// exposes them on window.firebaseData so the existing classic app.js
// script can call them without becoming an ES module itself.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

function waitForDb(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (window.firebaseDb) return resolve(window.firebaseDb);
    const t = setTimeout(() => {
      window.firebaseDb ? resolve(window.firebaseDb) : reject(new Error("Firebase is still connecting — please try again"));
    }, timeout);
    window.addEventListener("firebase-ready", () => { clearTimeout(t); resolve(window.firebaseDb); }, { once: true });
  });
}
function currentUser() { return window.firebaseAuth?.currentUser || null; }
function toDate(v) { return v?.toDate ? v.toDate() : (v ? new Date(v) : new Date()); }

/* ---------------- Products ---------------- */
// Reading is open to everyone. Creating requires a verified Seller (see
// firestore.rules) — the client can't fake sellerUid or bypass verification.

async function getProducts() {
  const db = await waitForDb();
  const snap = await getDocs(collection(db, "products"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getProduct(id) {
  const db = await waitForDb();
  const snap = await getDoc(doc(db, "products", id));
  if (!snap.exists()) throw new Error("Product not found");
  return { id: snap.id, ...snap.data() };
}

async function createProduct(p) {
  const db = await waitForDb();
  const user = currentUser();
  if (!user) throw new Error("Please sign in first");
  const payload = { ...p, sellerUid: user.uid, sellerName: user.displayName || user.email || "Seller", rating: 0, review_count: 0, created_at: serverTimestamp() };
  const ref = await addDoc(collection(db, "products"), payload);
  return { id: ref.id, ...payload, created_at: new Date() };
}

async function updateProduct(id, patch) {
  const db = await waitForDb();
  await setDoc(doc(db, "products", id), { ...patch, updated_at: serverTimestamp() }, { merge: true });
  return true;
}

async function deleteProduct(id) {
  const db = await waitForDb();
  await deleteDoc(doc(db, "products", id));
  return true;
}

async function getProductsForSeller(uid) {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "products"), where("sellerUid", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ---------------- Orders ---------------- */

async function getOrders() {
  const db = await waitForDb();
  const user = currentUser();
  if (!user) return [];
  const snap = await getDocs(query(collection(db, "orders"), where("uid", "==", user.uid)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

// Orders nobody has picked up yet — visible to any signed-in Delivery Agent.
async function getUnassignedOrders() {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "orders"), where("deliveryAgentUid", "==", null), where("payment_status", "==", "paid")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
}

async function getOrdersForAgent(uid) {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "orders"), where("deliveryAgentUid", "==", uid)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

async function getOrdersForLogistics() {
  const db = await waitForDb();
  const snap = await getDocs(collection(db, "orders"));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

/* ---------------- User profiles & roles ---------------- */
// Role/verified changes never happen via a direct client write (Firestore
// rules forbid it) — only through Cloud Functions using the Admin SDK.

async function ensureUserProfile(user, extra = {}) {
  const db = await waitForDb();
  const { role, verified, ...rest } = extra; // eslint-disable-line no-unused-vars
  await setDoc(
    doc(db, "users", user.uid),
    { name: user.displayName || rest.name || "", email: user.email || "", updated_at: serverTimestamp(), ...rest },
    { merge: true }
  );
}

async function getUserProfile(uid) {
  const db = await waitForDb();
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function findUserByEmail(email) {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "users"), where("email", "==", email)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

/* ---------------- Hotels & bookings ---------------- */

async function createHotel(hotel) {
  const db = await waitForDb();
  const user = currentUser();
  if (!user) throw new Error("Please sign in first");
  const payload = { ...hotel, ownerUid: user.uid, ownerName: user.displayName || user.email || "Host", created_at: serverTimestamp() };
  const ref = await addDoc(collection(db, "hotels"), payload);
  return { id: ref.id, ...payload, created_at: new Date() };
}

async function getHotels() {
  const db = await waitForDb();
  const snap = await getDocs(collection(db, "hotels"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getHotel(id) {
  const db = await waitForDb();
  const snap = await getDoc(doc(db, "hotels", id));
  if (!snap.exists()) throw new Error("Hotel not found");
  return { id: snap.id, ...snap.data() };
}

async function updateHotel(id, patch) {
  const db = await waitForDb();
  await setDoc(doc(db, "hotels", id), { ...patch, updated_at: serverTimestamp() }, { merge: true });
  return true;
}

async function deleteHotel(id) {
  const db = await waitForDb();
  await deleteDoc(doc(db, "hotels", id));
  return true;
}

async function getHotelsForOwner(uid) {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "hotels"), where("ownerUid", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getBookingsForCustomer() {
  const db = await waitForDb();
  const user = currentUser();
  if (!user) return [];
  const snap = await getDocs(query(collection(db, "bookings"), where("customerUid", "==", user.uid)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

async function getBookingsForHotelOwner(uid) {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "bookings"), where("hotelOwnerUid", "==", uid)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

/* ---------------- Alisell Properties (house rent / house sale / land sale) ---------------- */

async function createProperty(p) {
  const db = await waitForDb();
  const user = currentUser();
  if (!user) throw new Error("Please sign in first");
  const payload = { ...p, ownerUid: user.uid, ownerName: user.displayName || user.email || "Agent", created_at: serverTimestamp() };
  const ref = await addDoc(collection(db, "properties"), payload);
  return { id: ref.id, ...payload, created_at: new Date() };
}

async function getProperties() {
  const db = await waitForDb();
  const snap = await getDocs(collection(db, "properties"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getProperty(id) {
  const db = await waitForDb();
  const snap = await getDoc(doc(db, "properties", id));
  if (!snap.exists()) throw new Error("Property not found");
  return { id: snap.id, ...snap.data() };
}

async function updateProperty(id, patch) {
  const db = await waitForDb();
  await setDoc(doc(db, "properties", id), { ...patch, updated_at: serverTimestamp() }, { merge: true });
  return true;
}

async function deleteProperty(id) {
  const db = await waitForDb();
  await deleteDoc(doc(db, "properties", id));
  return true;
}

async function getPropertiesForOwner(uid) {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "properties"), where("ownerUid", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function createPropertyLead(lead) {
  const db = await waitForDb();
  const user = currentUser();
  if (!user) throw new Error("Please sign in to contact the lister");
  const payload = { ...lead, customerUid: user.uid, customerName: user.displayName || user.email || "Interested buyer", created_at: serverTimestamp() };
  const ref = await addDoc(collection(db, "propertyLeads"), payload);
  return { id: ref.id, ...payload, created_at: new Date() };
}

async function getLeadsForOwner(uid) {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "propertyLeads"), where("ownerUid", "==", uid)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

/* ---------------- Ratings & feedback ---------------- */

async function getReviewsForTarget(targetUid) {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "reviews"), where("targetUid", "==", targetUid)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: toDate(d.data().created_at) }));
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

async function getRatingSummary(uid) {
  const profile = await getUserProfile(uid);
  const count = profile?.ratingCount || 0;
  const sum = profile?.ratingSum || 0;
  return { average: count ? sum / count : 0, count };
}

/* ---------------- Identity verification ---------------- */
// Submitting/editing (while pending) is a normal client write; only the
// admin-only reviewVerification Cloud Function can set approved/rejected.

async function getVerificationRequest(uid) {
  const db = await waitForDb();
  const snap = await getDoc(doc(db, "verificationRequests", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Admin-only in practice (Firestore rules restrict reads of others' users
// docs to admins); scans users for pending verification requests.
async function getPendingVerifications() {
  const db = await waitForDb();
  const snap = await getDocs(query(collection(db, "verificationRequests"), where("status", "==", "pending")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

window.firebaseData = {
  getProducts, getProduct, createProduct, updateProduct, deleteProduct, getProductsForSeller,
  getOrders, getUnassignedOrders, getOrdersForAgent, getOrdersForLogistics,
  ensureUserProfile, getUserProfile, findUserByEmail,
  createHotel, updateHotel, deleteHotel, getHotels, getHotel, getHotelsForOwner,
  getBookingsForCustomer, getBookingsForHotelOwner,
  createProperty, updateProperty, deleteProperty, getProperties, getProperty, getPropertiesForOwner, createPropertyLead, getLeadsForOwner,
  getReviewsForTarget, getRatingSummary,
  getVerificationRequest, getPendingVerifications
};
window.dispatchEvent(new CustomEvent("firebase-data-ready"));
