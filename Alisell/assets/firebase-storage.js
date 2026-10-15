// Wraps Firebase Storage uploads so the classic app.js script can use them
// without becoming an ES module itself.

import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

function waitForApp(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (window.firebaseApp) return resolve(window.firebaseApp);
    const t = setTimeout(() => window.firebaseApp ? resolve(window.firebaseApp) : reject(new Error("Firebase is still connecting — please try again")), timeout);
    window.addEventListener("firebase-ready", () => { clearTimeout(t); resolve(window.firebaseApp); }, { once: true });
  });
}
function waitForData(timeout = 5000) {
  return new Promise((resolve) => {
    if (window.firebaseData) return resolve(window.firebaseData);
    const t = setTimeout(() => resolve(window.firebaseData || null), timeout);
    window.addEventListener("firebase-data-ready", () => { clearTimeout(t); resolve(window.firebaseData); }, { once: true });
  });
}


// Shrinks photos to <= 200 KB (JPEG) in the browser before upload.
const MAX_IMAGE_BYTES = 200 * 1024;
async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) {}
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
    img.src = url;
  });
}
function toJpegBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
async function compressImage(file, maxBytes = MAX_IMAGE_BYTES) {
  if (!file || !file.type || !file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size <= maxBytes) return file;
  const bmp = await loadBitmap(file);
  const w0 = bmp.width, h0 = bmp.height;
  let maxDim = 1600, best = null;
  for (let round = 0; round < 6; round++) {
    const scale = Math.min(1, maxDim / Math.max(w0, h0));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for (let q = 0.85; q >= 0.4; q -= 0.1) {
      const blob = await toJpegBlob(canvas, q);
      if (!blob) continue;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= maxBytes) {
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
      }
    }
    maxDim = Math.round(maxDim * 0.75);
    if (maxDim < 480) break;
  }
  if (bmp.close) try { bmp.close(); } catch (e) {}
  return best ? new File([best], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

(async () => {
  const app = await waitForApp();
  const storage = getStorage(app);

  async function uploadTo(folder, file) {
    const user = window.firebaseAuth?.currentUser;
    if (!user) throw new Error("Please sign in first");
    file = await compressImage(file);
    const path = `${folder}/${user.uid}/${Date.now()}-${file.name}`;
    const r = ref(storage, path);
    await uploadBytes(r, file, file.type ? { contentType: file.type } : undefined);
    return { path, url: await getDownloadURL(r) };
  }

  window.firebaseStorageFns = {
    async uploadAvatar(file) {
      const result = await uploadTo("avatars", file);
      const user = window.firebaseAuth.currentUser;
      await updateProfile(user, { photoURL: result.url });
      const fd = await waitForData();
      if (fd) await fd.ensureUserProfile(user, { photoURL: result.url });
      return result.url;
    },
    async uploadListingImage(file) {
      return (await uploadTo("listings", file)).url;
    },
    async uploadVerificationDoc(file, kind) {
      // kind: "addressProof" | "selfie" — used as part of the filename only
      const user = window.firebaseAuth?.currentUser;
      if (!user) throw new Error("Please sign in first");
      if (!['addressProof','selfie'].includes(kind)) throw new Error("Invalid verification document type");
      file = await compressImage(file);
      const safeName = String(file.name || "document").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
      const path = `verification/${user.uid}/${kind}-${Date.now()}-${safeName}`;
      const r = ref(storage, path);
      await uploadBytes(r, file);
      return { path, url: await getDownloadURL(r) };
    }
  };
  window.dispatchEvent(new CustomEvent("firebase-storage-ready"));
})();
