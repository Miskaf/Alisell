// Wraps Firebase Cloud Functions callables so the classic app.js script can
// call them without becoming an ES module itself.

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

function waitForApp(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (window.firebaseApp) return resolve(window.firebaseApp);
    const t = setTimeout(() => window.firebaseApp ? resolve(window.firebaseApp) : reject(new Error("Firebase is still connecting — please try again")), timeout);
    window.addEventListener("firebase-ready", () => { clearTimeout(t); resolve(window.firebaseApp); }, { once: true });
  });
}

(async () => {
  const app = await waitForApp();
  const functionsInstance = getFunctions(app);
  const becomeRoleFn = httpsCallable(functionsInstance, "becomeRole");
  const setUserRoleFn = httpsCallable(functionsInstance, "setUserRole");
  const initializePaymentFn = httpsCallable(functionsInstance, "initializePayment");
  const verifyPaymentFn = httpsCallable(functionsInstance, "verifyPayment");
  const reviewVerificationFn = httpsCallable(functionsInstance, "reviewVerification");
  const createOrderFn = httpsCallable(functionsInstance, "createOrder");
  const createBookingFn = httpsCallable(functionsInstance, "createBooking");
  const claimOrderFn = httpsCallable(functionsInstance, "claimOrder");
  const deliveredFn = httpsCallable(functionsInstance, "markOrderDelivered");
  const createReviewFn = httpsCallable(functionsInstance, "createReview");
  const updateBookingStatusFn = httpsCallable(functionsInstance, "updateBookingStatus");
  const submitVerificationFn = httpsCallable(functionsInstance, "submitVerification");
  const getAdminOverviewFn = httpsCallable(functionsInstance, "getAdminOverview");
  const getVerificationDocumentUrlFn = httpsCallable(functionsInstance, "getVerificationDocumentUrl");
  const createReservationFn = httpsCallable(functionsInstance, "createReservation");
  const updateReservationStatusFn = httpsCallable(functionsInstance, "updateReservationStatus");

  window.firebaseFunctions = {
    async becomeRole(role) {
      const res = await becomeRoleFn({ role });
      return res.data;
    },
    async setUserRole(uid, role) {
      const res = await setUserRoleFn({ uid, role });
      return res.data;
    },
    async initializePayment(kind, id) {
      const returnUrl = new URL("payment.html", location.origin + location.pathname.replace(/[^/]*$/, "")).href;
      const res = await initializePaymentFn({ kind, id, returnUrl });
      return res.data;
    },
    async verifyPayment(reference) {
      const res = await verifyPaymentFn({ reference });
      return res.data;
    },
    async reviewVerification(uid, decision, note) {
      const res = await reviewVerificationFn({ uid, decision, note });
      return res.data;
    },
    async createOrder(payload) {
      const res = await createOrderFn(payload);
      return res.data;
    },
    async createBooking(payload) {
      const res = await createBookingFn(payload);
      return res.data;
    },
    async claimOrder(orderId) {
      const res = await claimOrderFn({ orderId });
      return res.data;
    },
    async markOrderDelivered(orderId) {
      const res = await deliveredFn({ orderId });
      return res.data;
    },
    async createReview(payload) {
      const res = await createReviewFn(payload);
      return res.data;
    },
    async updateBookingStatus(bookingId, status) {
      const res = await updateBookingStatusFn({ bookingId, status });
      return res.data;
    },
    async submitVerification(payload) {
      const res = await submitVerificationFn(payload);
      return res.data;
    },
    async getAdminOverview() {
      const res = await getAdminOverviewFn({});
      return res.data;
    },
    async getVerificationDocumentUrl(uid, kind) {
      const res = await getVerificationDocumentUrlFn({ uid, kind });
      return res.data;
    },
    async createReservation(payload) {
      const res = await createReservationFn(payload);
      return res.data;
    },
    async updateReservationStatus(reservationId, status) {
      const res = await updateReservationStatusFn({ reservationId, status });
      return res.data;
    }
  };
  window.dispatchEvent(new CustomEvent("firebase-functions-ready"));
})();
