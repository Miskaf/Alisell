// Firebase initialization for Alisell
// This file only sets up the Firebase connection — it does not change any
// existing UI, routing, or app logic. Other scripts can access the
// initialized services via window.firebaseApp / window.firebaseAuth /
// window.firebaseDb / window.firebaseAnalytics once this module has loaded.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getAdditionalUserInfo
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getAnalytics, isSupported as isAnalyticsSupported } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-analytics.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCdDK4tXBF5n2pXlzi9itFALwHa7XnOUCk",
  authDomain: "marketlink-f5acc.firebaseapp.com",
  projectId: "marketlink-f5acc",
  storageBucket: "marketlink-f5acc.firebasestorage.app",
  messagingSenderId: "287158268882",
  appId: "1:287158268882:web:8c45578ffbdc65bb428e0b",
  measurementId: "G-STSR9X0CZ2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Auto-detect long polling: avoids slow/stalled streaming connections on some mobile networks and proxies.
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

// Analytics only works in supported browser contexts (not http://localhost
// in some setups, and never in non-browser environments), so guard it.
let analytics = null;
isAnalyticsSupported().then((supported) => {
  if (supported) {
    analytics = getAnalytics(app);
    window.firebaseAnalytics = analytics;
  }
});

// Expose on window so the existing plain-script files (app.js, api.js, etc.)
// can use Firebase without needing to become ES modules themselves.
window.firebaseApp = app;
window.firebaseAuth = auth;
window.firebaseDb = db;

// Email/password auth helpers, callable from classic (non-module) scripts.
// Each returns a plain { user } object or throws an Error with a readable message.
let phoneConfirmation = null;
let recaptcha = null;
window.firebaseAuthFns = {
  async signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const res = await signInWithPopup(auth, provider);
    const info = getAdditionalUserInfo(res);
    return { user: res.user, isNew: !!(info && info.isNewUser) };
  },
  async startPhoneSignIn(phone, containerId) {
    if (recaptcha) { try { recaptcha.clear(); } catch (e) {} recaptcha = null; }
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = "";
    recaptcha = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
    try {
      phoneConfirmation = await signInWithPhoneNumber(auth, phone, recaptcha);
    } catch (e) {
      try { recaptcha.clear(); } catch (e2) {}
      recaptcha = null;
      throw e;
    }
  },
  async confirmPhoneCode(code, name) {
    if (!phoneConfirmation) throw new Error("Request a code first");
    const res = await phoneConfirmation.confirm(code);
    phoneConfirmation = null;
    if (name && !res.user.displayName) await updateProfile(res.user, { displayName: name });
    const info = getAdditionalUserInfo(res);
    return { user: res.user, isNew: !!(info && info.isNewUser) };
  },
  async signUp(name, email, password) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(cred.user, { displayName: name });
    return { user: cred.user };
  },
  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return { user: cred.user };
  },
  async signOutUser() {
    await signOut(auth);
  },
  getCurrentUser() {
    return auth.currentUser;
  },
  async sendVerificationEmail() {
    if (!auth.currentUser) throw new Error("Please sign in first");
    await sendEmailVerification(auth.currentUser);
  },
  async resetPassword(email) {
    if (!email) throw new Error("Enter your email address first");
    await sendPasswordResetEmail(auth, email);
  },
  async updateDisplayName(name) {
    if (!auth.currentUser) throw new Error("Please sign in first");
    await updateProfile(auth.currentUser, { displayName: name });
    window.firebaseUser = auth.currentUser;
  }
};

// Keep a simple, always-current snapshot of the signed-in Firebase user so
// other scripts can read it synchronously (e.g. window.firebaseUser?.email).
onAuthStateChanged(auth, (user) => {
  window.firebaseUser = user || null;
  window.dispatchEvent(new CustomEvent("firebase-auth-changed", { detail: { user } }));
});

// Let the rest of the app know Firebase is ready, in case anything needs to
// wait for it (module scripts load asynchronously relative to classic scripts).
window.dispatchEvent(new CustomEvent("firebase-ready", { detail: { app, auth, db } }));
