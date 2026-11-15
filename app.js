import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, getDoc, query, where, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);

// Safe Firebase initialization
let app = null, auth = null, db = null, storage = null;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
} catch (initErr) {
  console.warn("Firebase initialization note:", initErr.message);
}

let currentUser = null;
let activeSession = null;
let stopGallery = null;
let stopSessions = null;
let mediaItems = [];
let toastTimer = null;
let isSignUpMode = false;

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB
const isConfigured = !Object.values(firebaseConfig).some(v => String(v).startsWith("PASTE_"));

// Local demo persistence keys
const DEMO_SESSIONS_KEY = "gather_demo_sessions_v1";
const DEMO_UPLOADS_PREFIX = "gather_demo_uploads_v1_";

function getDemoSessions() {
  try { return JSON.parse(localStorage.getItem(DEMO_SESSIONS_KEY) || "[]"); } catch { return []; }
}
function saveDemoSession(sess) {
  const list = getDemoSessions().filter(s => s.id !== sess.id);
  list.unshift(sess);
  localStorage.setItem(DEMO_SESSIONS_KEY, JSON.stringify(list));
}
function getDemoUploads(sid) {
  try { return JSON.parse(localStorage.getItem(DEMO_UPLOADS_PREFIX + sid) || "[]"); } catch { return []; }
}
function saveDemoUpload(sid, item) {
  const list = getDemoUploads(sid);
  list.unshift(item);
  localStorage.setItem(DEMO_UPLOADS_PREFIX + sid, JSON.stringify(list));
}

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function showView(name) {
  ["homeView", "joinView", "adminView"].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle("hidden", id !== name);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function safeName(s) {
  return String(s || "file").replace(/[^\w.\-() ]/g, "_").slice(0, 100);
}

function formatDate(ts) {
  try {
    if (ts?.toDate) return ts.toDate().toLocaleString();
    if (ts?.seconds) return new Date(ts.seconds * 1000).toLocaleString();
    if (typeof ts === "string" || typeof ts === "number") return new Date(ts).toLocaleString();
    return "Just now";
  } catch {
    return "Just now";
  }
}

function bytesLabel(n) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let val = Number(n);
  while (val >= 1024 && i < 3) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function requireConfig() {
  if (!isConfigured) {
    toast("Add your Firebase web config in firebase-config.js first.");
    return false;
  }
  return true;
}

function baseUrl() {
  return location.href.split("?")[0].split("#")[0];
}

function sessionUrl(id) {
  return `${baseUrl()}?session=${encodeURIComponent(id)}`;
}

// File and media type recognition
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif", "avif"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "ogg", "mkv", "avi", "3gp", "m4v"]);

function getExt(filename) {
  return (filename || "").split(".").pop().toLowerCase();
}

function isVideo(type, filename) {
  if ((type || "").startsWith("video/")) return true;
  if (filename && VIDEO_EXTS.has(getExt(filename))) return true;
  return false;
}

function isImage(type, filename) {
  if ((type || "").startsWith("image/")) return true;
  if (filename && IMAGE_EXTS.has(getExt(filename))) return true;
  return false;
}

function resolveMime(file) {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }
  const ext = getExt(file.name);
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm"
  };
  return map[ext] || "image/jpeg";
}

// Modal handling
function openModal(id) {
  const m = $(id);
  if (m) m.classList.remove("hidden");
}

function closeModal(id) {
  const m = $(id);
  if (m) m.classList.add("hidden");
}

document.querySelectorAll("[data-close]").forEach(el => {
  el.addEventListener("click", () => {
    const target = el.dataset.close;
    if (target) {
      closeModal(`${target}Modal`);
    }
  });
});

window.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal:not(.hidden)").forEach(m => m.classList.add("hidden"));
  }
});

// Image compression & downscaling helper for fast, reliable uploads
async function optimizeImage(file, maxDimension = 1920, quality = 0.85) {
  const mime = resolveMime(file);
  if (!isImage(mime, file.name) || mime === "image/gif" || mime === "image/svg+xml") {
    return file;
  }
  try {
    return await new Promise(resolve => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;
        if (width <= maxDimension && height <= maxDimension && file.size <= 600 * 1024) {
          resolve(file);
          return;
        }
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (blob && blob.size < file.size) {
            const optFile = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
            resolve(optFile);
          } else {
            resolve(file);
          }
        }, "image/jpeg", quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      };
      img.src = objectUrl;
    });
  } catch {
    return file;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Navigation & Actions
if ($("homeNav")) {
  $("homeNav").onclick = () => {
    history.pushState({ view: "home" }, "", baseUrl());
    showView("homeView");
  };
}

if ($("brandNav")) {
  $("brandNav").onclick = e => {
    e.preventDefault();
    history.pushState({ view: "home" }, "", baseUrl());
    showView("homeView");
  };
}

if ($("navSignInBtn")) {
  $("navSignInBtn").onclick = () => {
    history.pushState({ view: "admin" }, "", baseUrl() + "?admin=1");
    showView("adminView");
    setAuthMode(false);
  };
}

if ($("loginFromHero")) {
  $("loginFromHero").onclick = () => {
    history.pushState({ view: "admin" }, "", baseUrl() + "?admin=1");
    showView("adminView");
    setAuthMode(false);
  };
}

if ($("createFromHero")) {
  $("createFromHero").onclick = () => {
    openModal("sessionModal");
  };
}

if ($("myGalleriesBtn")) {
  $("myGalleriesBtn").onclick = () => {
    history.pushState({ view: "admin" }, "", baseUrl() + "?admin=1");
    showView("adminView");
  };
}

if ($("navDashboardBtn")) {
  $("navDashboardBtn").onclick = () => {
    history.pushState({ view: "admin" }, "", baseUrl() + "?admin=1");
    showView("adminView");
  };
}

if ($("navSignOutBtn")) {
  $("navSignOutBtn").onclick = async () => {
    try {
      await signOut(auth);
      toast("Signed out successfully.");
      history.pushState({ view: "home" }, "", baseUrl());
      showView("homeView");
    } catch (e) {
      toast(e.message);
    }
  };
}

if ($("joinInfo")) {
  $("joinInfo").onclick = () => {
    toast("Host creates a gallery, shares the QR code or link, and guests can view and upload photos.");
  };
}

if ($("newSession")) {
  $("newSession").onclick = () => {
    openModal("sessionModal");
  };
}

// Paste gallery link or code to join and see pics
if ($("heroJoinBtn")) {
  $("heroJoinBtn").onclick = () => {
    const input = ($("heroSessionInput")?.value || "").trim();
    if (!input) return toast("Please paste a gallery link or enter a gallery code.");
    let sid = input;
    try {
      const u = new URL(input);
      const p = u.searchParams.get("session");
      if (p) sid = p;
    } catch {}
    if (sid.includes("session=")) {
      const m = sid.match(/session=([^&/#]+)/);
      if (m) sid = decodeURIComponent(m[1]);
    }
    sid = sid.replace(/[^a-zA-Z0-9_\-]/g, "");
    if (!sid) return toast("Please enter a valid gallery link or code.");
    history.pushState({ view: "join", session: sid }, "", sessionUrl(sid));
    startJoin(sid);
  };
}

if ($("heroSessionInput")) {
  $("heroSessionInput").addEventListener("keydown", e => {
    if (e.key === "Enter") $("heroJoinBtn")?.click();
  });
}

// Auth tabs toggle
function setAuthMode(signUp) {
  isSignUpMode = signUp;
  $("tabSignIn").classList.toggle("active", !signUp);
  $("tabSignUp").classList.toggle("active", signUp);
  $("authHeading").textContent = signUp ? "Create admin account" : "Admin sign in";
  $("authSubheading").textContent = signUp
    ? "Create your administrator account to host and manage live galleries."
    : "Sign in with your email and password to manage event galleries.";
  $("authSubmitBtn").innerHTML = signUp ? "Create account <span>→</span>" : "Sign in <span>→</span>";
  $("loginError").textContent = "";
}

$("tabSignIn").onclick = () => setAuthMode(false);
$("tabSignUp").onclick = () => setAuthMode(true);

function formatAuthError(msg) {
  if (!msg) return "Authentication failed.";
  if (msg.includes("invalid-credential") || msg.includes("INVALID_LOGIN_CREDENTIALS")) {
    return "Incorrect email or password. If you haven't created an account yet, click 'Create account' above.";
  }
  if (msg.includes("email-already-in-use")) {
    return "This email is already registered. Please sign in instead.";
  }
  if (msg.includes("weak-password")) {
    return "Password is too weak. Please use at least 6 characters.";
  }
  if (msg.includes("invalid-email")) {
    return "Please enter a valid email address.";
  }
  return msg;
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!requireConfig()) return;
  $("loginError").textContent = "";
  const email = $("email").value.trim();
  const password = $("password").value;
  try {
    if (isSignUpMode) {
      await createUserWithEmailAndPassword(auth, email, password);
      toast("Admin account created successfully!");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      toast("Signed in.");
    }
  } catch (err) {
    console.error("Auth error:", err);
    $("loginError").textContent = formatAuthError(err.message || err.code);
  }
});

if ($("signOut")) {
  $("signOut").onclick = async () => {
    try {
      await signOut(auth);
      toast("Signed out successfully.");
      history.pushState({ view: "home" }, "", baseUrl());
      showView("homeView");
    } catch (e) {
      toast(e.message);
    }
  };
}

// Toggle setup helper accordion
$("toggleSetupHelp").onclick = () => {
  $("setupHelpContent").classList.toggle("hidden");
};

// Create Demo Gallery directly
$("createDemoGalleryBtn").onclick = () => {
  const demoId = "demo-" + Math.random().toString(36).substring(2, 9);
  const name = "Demo Gallery " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const demoSess = {
    id: demoId,
    name,
    active: true,
    isDemo: true,
    createdAt: new Date().toISOString()
  };
  saveDemoSession(demoSess);
  toast("Instant Demo Gallery created!");
  history.pushState({ view: "join", session: demoId }, "", sessionUrl(demoId));
  startJoin(demoId);
};

// Gallery Session Creation
$("sessionForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("sessionName").value.trim();
  if (!name) return;

  const mode = document.querySelector('input[name="galleryMode"]:checked')?.value || "firebase";

  if (mode === "demo" || !currentUser) {
    // Local / Demo gallery
    const demoId = "demo-" + Math.random().toString(36).substring(2, 9);
    const demoSess = {
      id: demoId,
      name,
      active: true,
      isDemo: true,
      ownerUid: currentUser?.uid || "demo-owner",
      createdAt: new Date().toISOString()
    };
    saveDemoSession(demoSess);
    closeModal("sessionModal");
    $("sessionName").value = "";
    await openQr(demoId, name);
    toast("Demo gallery created.");
    return;
  }

  // Cloud Firebase Gallery
  try {
    const refDoc = await addDoc(collection(db, "sessions"), {
      name,
      ownerUid: currentUser.uid,
      active: true,
      createdAt: serverTimestamp()
    });
    closeModal("sessionModal");
    $("sessionName").value = "";
    await openQr(refDoc.id, name);
    toast("Gallery created.");
  } catch (err) {
    console.error("Session creation error:", err);
    // If Firestore rules blocked creating in cloud, offer demo fallback
    if (err.message && err.message.includes("permission")) {
      const demoId = "gallery-" + Math.random().toString(36).substring(2, 9);
      saveDemoSession({ id: demoId, name, active: true, isDemo: true, ownerUid: currentUser.uid, createdAt: new Date().toISOString() });
      closeModal("sessionModal");
      $("sessionName").value = "";
      await openQr(demoId, name);
      toast("Saved locally (Publish Firestore rules to enable cloud sync).");
    } else {
      toast("Could not create gallery: " + err.message);
    }
  }
});

async function openQr(id, name) {
  $("qrTitle").textContent = name;
  const url = sessionUrl(id);
  $("shareUrl").textContent = url;
  openModal("qrModal");

  const canvas = $("qrCanvas");
  let qrGenerated = false;

  if (canvas) {
    // Clear canvas before drawing
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
      try {
        await window.QRCode.toCanvas(canvas, url, {
          width: 240,
          margin: 2,
          errorCorrectionLevel: "M",
          color: {
            dark: "#111827",
            light: "#ffffff"
          }
        });
        qrGenerated = true;
      } catch (qrErr) {
        console.warn("QRCode.toCanvas failed, using fallback:", qrErr);
      }
    }

    // High-reliability fallback if library did not render
    if (!qrGenerated && ctx) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          canvas.width = 240;
          canvas.height = 240;
          ctx.drawImage(img, 0, 0, 240, 240);
        };
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(url)}`;
      } catch (fallbackErr) {
        console.warn("QR fallback image error:", fallbackErr);
      }
    }
  }

  $("downloadQr").onclick = () => {
    try {
      const a = document.createElement("a");
      a.download = `${safeName(name)}-QR.png`;
      a.href = $("qrCanvas").toDataURL("image/png");
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      window.open(`https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(url)}`, "_blank");
    }
  };

  $("copyLink").onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Sharing link copied.");
    } catch {
      toast("Link: " + url);
    }
  };
}

function updateAuthStateUI(user) {
  currentUser = user;

  // Topbar elements
  const navSignInBtn = $("navSignInBtn");
  const navUserEmail = $("navUserEmail");
  const navDashboardBtn = $("navDashboardBtn");
  const navSignOutBtn = $("navSignOutBtn");

  if (user) {
    if (navSignInBtn) navSignInBtn.classList.add("hidden");
    if (navUserEmail) {
      navUserEmail.textContent = user.email || "Signed in";
      navUserEmail.classList.remove("hidden");
    }
    if (navDashboardBtn) navDashboardBtn.classList.remove("hidden");
    if (navSignOutBtn) navSignOutBtn.classList.remove("hidden");
  } else {
    if (navSignInBtn) navSignInBtn.classList.remove("hidden");
    if (navUserEmail) navUserEmail.classList.add("hidden");
    if (navDashboardBtn) navDashboardBtn.classList.add("hidden");
    if (navSignOutBtn) navSignOutBtn.classList.add("hidden");
  }

  // Home view host actions: hide Create a gallery for guest, show only when signed in
  const heroGuestActions = $("heroGuestActions");
  const heroAuthActions = $("heroAuthActions");
  const heroWelcomeUser = $("heroWelcomeUser");

  if (user) {
    if (heroGuestActions) heroGuestActions.classList.add("hidden");
    if (heroAuthActions) heroAuthActions.classList.remove("hidden");
    if (heroWelcomeUser) {
      const name = user.email ? user.email.split("@")[0] : "friend";
      heroWelcomeUser.textContent = `Welcome back, ${name}!`;
    }
  } else {
    if (heroGuestActions) heroGuestActions.classList.remove("hidden");
    if (heroAuthActions) heroAuthActions.classList.add("hidden");
  }

  // Admin view
  const loginPanel = $("loginPanel");
  const dashboardPanel = $("dashboardPanel");
  const adminEmail = $("adminEmail");
  if (loginPanel) loginPanel.classList.toggle("hidden", !!user);
  if (dashboardPanel) dashboardPanel.classList.toggle("hidden", !user);
  if (user) {
    if (adminEmail) adminEmail.textContent = user.email || "Signed in";
    loadSessions();
  } else if (stopSessions) {
    stopSessions();
    stopSessions = null;
  }
}

function renderAuth() {
  if (!requireConfig()) return;
  updateAuthStateUI(currentUser);
}

function loadSessions() {
  if (stopSessions) stopSessions();

  // Combine local demo sessions
  const localList = getDemoSessions().filter(s => s.ownerUid === currentUser?.uid || s.isDemo);

  // Firestore query: Query WITHOUT compound orderBy to avoid Firestore composite index requirement!
  const q = query(collection(db, "sessions"), where("ownerUid", "==", currentUser.uid));
  stopSessions = onSnapshot(
    q,
    snap => {
      const cloudSessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const allSessions = [...localList, ...cloudSessions];

      // Sort in memory by createdAt descending
      allSessions.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      });

      renderSessionList(allSessions);
    },
    err => {
      console.warn("Cloud sessions listener note:", err);
      // Fallback to local sessions if cloud query has index/permission issues
      renderSessionList(localList);
    }
  );
}

function renderSessionList(sessions) {
  const list = $("sessionList");
  list.innerHTML = "";
  if (!sessions.length) {
    list.innerHTML =
      '<div class="empty-state compact"><div class="empty-icon">✳</div><b>No galleries yet</b><p>Create your first gallery and share its QR code.</p></div>';
    return;
  }

  sessions.forEach(s => {
    const row = document.createElement("div");
    row.className = "session-row";
    row.innerHTML = `
      <div class="session-symbol">▧</div>
      <div class="session-main">
        <b></b>
        <small>${s.active ? "Active gallery" : "Closed gallery"} · ${formatDate(s.createdAt)} ${s.isDemo ? '<span class="badge-demo">Demo</span>' : ''}</small>
      </div>
      <span class="session-status ${s.active ? "" : "closed"}">${s.active ? "OPEN" : "CLOSED"}</span>
      <div class="session-buttons">
        <button class="btn btn-secondary btn-small qr-action">QR code</button>
        <button class="btn btn-secondary btn-small copy-action">Copy link</button>
        <button class="btn btn-ghost btn-small toggle-action">${s.active ? "Close" : "Reopen"}</button>
      </div>
    `;
    row.querySelector(".session-main b").textContent = s.name;
    row.querySelector(".qr-action").onclick = () => openQr(s.id, s.name);
    row.querySelector(".copy-action").onclick = async () => {
      try {
        await navigator.clipboard.writeText(sessionUrl(s.id));
        toast("Link copied.");
      } catch {
        toast("Could not copy link.");
      }
    };
    row.querySelector(".toggle-action").onclick = async () => {
      try {
        if (s.isDemo) {
          s.active = !s.active;
          saveDemoSession(s);
          loadSessions();
          toast(s.active ? "Gallery reopened." : "Gallery closed.");
        } else {
          await updateDoc(doc(db, "sessions", s.id), { active: !s.active });
          toast(s.active ? "Gallery closed." : "Gallery reopened.");
        }
      } catch (e) {
        toast(e.message);
      }
    };
    list.appendChild(row);
  });
}

// Join Gallery View & Listening
async function startJoin(sid) {
  showView("joinView");
  const banner = $("joinBanner");
  banner.classList.add("hidden");

  // Reset inputs
  ["cameraPhoto", "cameraVideo", "galleryFiles"].forEach(id => {
    const el = $(id);
    if (el) el.disabled = false;
  });

  // Check if it's a local demo session
  const localSess = getDemoSessions().find(s => s.id === sid);
  if (localSess) {
    activeSession = localSess;
    $("joinTitle").textContent = activeSession.name;
    $("joinSubtitle").textContent = activeSession.active
      ? "Add your photos and videos to the collection."
      : "This gallery is closed. Uploads are no longer accepted.";
    $("galleryStatusPill").textContent = "● Demo gallery";
    listenGallery(sid);
    return;
  }

  // Fetch from Firebase
  try {
    const s = await getDoc(doc(db, "sessions", sid));
    if (s.exists()) {
      activeSession = { id: sid, ...s.data() };
      $("joinTitle").textContent = activeSession.name;
      $("joinSubtitle").textContent = activeSession.active
        ? "Add your photos and videos to the collection."
        : "This gallery is closed. Uploads are no longer accepted.";
      const disabled = !activeSession.active;
      ["cameraPhoto", "cameraVideo", "galleryFiles"].forEach(id => {
        const el = $(id);
        if (el) el.disabled = disabled;
      });
      listenGallery(sid);
      return;
    }
  } catch (err) {
    console.warn("Firestore session fetch note:", err);
  }

  // Graceful fallback for unconfigured or permission-restricted sessions
  activeSession = { id: sid, name: "Event Gallery", active: true, isGuestSession: true };
  $("joinTitle").textContent = "Shared Event Gallery";
  $("joinSubtitle").textContent = "Add your photos and videos to the collection.";
  listenGallery(sid);
}

function listenGallery(sid) {
  if (stopGallery) stopGallery();

  const localUploads = getDemoUploads(sid);
  mediaItems = [...localUploads];
  renderGallery();

  if (!db) return;

  try {
    const q = collection(db, "sessions", sid, "uploads");
    stopGallery = onSnapshot(
      q,
      snap => {
        const cloudItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Combine cloud & local items, eliminating duplicates by ID/path
        const map = new Map();
        [...localUploads, ...cloudItems].forEach(item => {
          map.set(item.id || item.path || item.url, item);
        });
        mediaItems = Array.from(map.values());

        // Sort by timestamp descending
        mediaItems.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
          return tB - tA;
        });

        renderGallery();
      },
      err => {
        console.warn("Live gallery snapshot note:", err);
        // Fallback to local gallery uploads
        mediaItems = localUploads;
        renderGallery();
      }
    );
  } catch (e) {
    console.warn("Live listener setup error:", e);
  }
}

function renderGallery() {
  const grid = $("galleryGrid");
  grid.innerHTML = "";
  $("galleryCount").textContent = mediaItems.length
    ? `${mediaItems.length} ${mediaItems.length === 1 ? "memory" : "memories"} shared`
    : "Waiting for the first memory…";
  $("downloadAll").disabled = !mediaItems.length;

  if (!mediaItems.length) {
    grid.innerHTML =
      '<div class="empty-state"><div class="empty-icon">▧</div><b>Your gallery is ready</b><p>New photos and videos will appear here automatically.</p></div>';
    return;
  }

  mediaItems.forEach(item => {
    const card = document.createElement("article");
    card.className = "media-card";

    const thumb = document.createElement("div");
    thumb.className = "media-thumb";

    if (isImage(item.contentType, item.name)) {
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.name || "Shared photo";
      img.loading = "lazy";
      img.onerror = () => {
        thumb.innerHTML = `<div class="video-placeholder" style="background:#4b5563">📷<small>PHOTO</small></div>`;
      };
      thumb.appendChild(img);
    } else {
      const v = document.createElement("div");
      v.className = "video-placeholder";
      v.innerHTML = `▶<small>VIDEO</small>`;
      thumb.appendChild(v);
    }

    thumb.onclick = () => preview(item);

    const info = document.createElement("div");
    info.className = "media-info";

    const meta = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = item.name || "Shared media";
    const small = document.createElement("small");
    small.textContent = `${formatDate(item.createdAt)} · ${bytesLabel(item.size)}`;
    meta.append(b, small);

    const dl = document.createElement("button");
    dl.className = "icon-button";
    dl.title = "Download";
    dl.textContent = "↓";
    dl.onclick = e => {
      e.stopPropagation();
      downloadOne(item);
    };

    info.append(meta, dl);
    card.append(thumb, info);
    grid.appendChild(card);
  });
}

function preview(item) {
  const c = $("previewContent");
  c.innerHTML = "";
  let el;
  if (isVideo(item.contentType, item.name)) {
    el = document.createElement("video");
    el.src = item.url;
    el.controls = true;
    el.autoplay = true;
  } else {
    el = document.createElement("img");
    el.src = item.url;
    el.alt = item.name || "Photo";
  }
  c.appendChild(el);
  openModal("previewModal");
}

async function downloadOne(item) {
  try {
    if (item.url.startsWith("data:")) {
      const a = document.createElement("a");
      a.href = item.url;
      a.download = safeName(item.name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const response = await fetch(item.url);
    if (!response.ok) throw new Error("Download failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = safeName(item.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  } catch (e) {
    console.warn("Direct download fallback:", e);
    window.open(item.url, "_blank", "noopener");
    toast("Opened media in a new tab. Right-click or long-press to save.");
  }
}

$("downloadAll").onclick = async () => {
  if (!window.JSZip) return toast("ZIP library did not load.");
  const btn = $("downloadAll");
  btn.disabled = true;
  btn.textContent = "Preparing ZIP…";

  try {
    const zip = new JSZip();
    let done = 0;
    for (const item of mediaItems) {
      try {
        let blob;
        if (item.url.startsWith("data:")) {
          const parts = item.url.split(",");
          const mimeMatch = parts[0].match(/:(.*?);/);
          const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
          const binStr = atob(parts[1]);
          const len = binStr.length;
          const u8arr = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            u8arr[i] = binStr.charCodeAt(i);
          }
          blob = new Blob([u8arr], { type: mime });
        } else {
          const response = await fetch(item.url);
          if (!response.ok) continue;
          blob = await response.blob();
        }
        zip.file(safeName(item.name || `media-${done + 1}`), blob);
        done++;
      } catch (itemErr) {
        console.warn("Item skipped in zip:", itemErr);
      }
    }

    if (done === 0) {
      throw new Error("No files could be bundled. Try downloading individually.");
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName(activeSession?.name || "gallery")}-photos-videos.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`${done} files packed for download.`);
  } catch (e) {
    console.error(e);
    toast("ZIP download issue: " + e.message);
  } finally {
    btn.disabled = !mediaItems.length;
    btn.textContent = "↓ Download all";
  }
};

// Resilient Photo & Video Uploader
async function uploadFiles(fileList) {
  const currentSessionId = activeSession?.id || new URLSearchParams(location.search).get("session") || "demo-gallery";

  if (activeSession && activeSession.active === false) {
    return toast("This gallery is closed. Uploads are no longer accepted.");
  }

  const files = Array.from(fileList || []);
  if (!files.length) return;

  const queue = $("uploadQueue");
  queue.classList.remove("hidden");

  try {
    for (const rawFile of files) {
      const mime = resolveMime(rawFile);
      if (!isImage(mime, rawFile.name) && !isVideo(mime, rawFile.name)) {
        toast(`${rawFile.name}: only photos and videos are supported.`);
        continue;
      }
      if (rawFile.size > MAX_FILE_BYTES) {
        toast(`${rawFile.name}: maximum file size is 200 MB.`);
        continue;
      }

      const row = document.createElement("div");
      row.className = "queue-item";
      const label = document.createElement("span");
      label.textContent = rawFile.name;
      const track = document.createElement("div");
      track.className = "progress-track";
      const bar = document.createElement("i");
      track.appendChild(bar);
      const status = document.createElement("small");
      status.textContent = "Optimizing…";
      row.append(label, track, status);
      queue.prepend(row);

      try {
        // Step 1: Optimize images for fast mobile uploads
        let fileToUpload = rawFile;
        if (isImage(mime, rawFile.name)) {
          fileToUpload = await optimizeImage(rawFile);
        }
        const finalMime = resolveMime(fileToUpload);
        status.textContent = "Uploading…";

        const fileId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        let downloadUrl = null;
        let storagePath = null;

        // Step 2: Attempt Firebase Storage upload if available
        if (storage && !activeSession?.isDemo) {
          try {
            storagePath = `sessions/${currentSessionId}/${fileId}-${safeName(fileToUpload.name)}`;
            const storageRef = ref(storage, storagePath);
            const task = uploadBytesResumable(storageRef, fileToUpload, {
              contentType: finalMime,
              customMetadata: { sessionId: currentSessionId }
            });

            await new Promise((resolve, reject) => {
              task.on(
                "state_changed",
                snap => {
                  const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
                  bar.style.width = pct + "%";
                  status.textContent = pct + "%";
                },
                err => reject(err),
                async () => {
                  try {
                    downloadUrl = await getDownloadURL(task.snapshot.ref);
                    resolve();
                  } catch (e) {
                    reject(e);
                  }
                }
              );
            });
          } catch (storageErr) {
            console.warn("Storage upload note, switching to resilient fallback:", storageErr.message);
            // If Storage failed (e.g. 404 bucket not created or permission denied), fallback to Base64 data URL
            if (isImage(finalMime, fileToUpload.name)) {
              status.textContent = "Packing…";
              let fallbackFile = fileToUpload;
              if (fallbackFile.size > 600 * 1024) {
                fallbackFile = await optimizeImage(fallbackFile, 1280, 0.7);
              }
              downloadUrl = await fileToDataUrl(fallbackFile);
              storagePath = "inline-data";
            } else {
              throw storageErr;
            }
          }
        } else {
          // Local / Demo mode or Storage not ready: generate inline data URL
          status.textContent = "Packing…";
          downloadUrl = await fileToDataUrl(fileToUpload);
          storagePath = "inline-data";
        }

        if (!downloadUrl) throw new Error("Could not prepare media.");

        // Step 3: Record upload in Firestore
        const mediaRecord = {
          name: fileToUpload.name,
          contentType: finalMime,
          size: fileToUpload.size,
          path: storagePath || "uploads",
          url: downloadUrl,
          createdAt: serverTimestamp ? serverTimestamp() : new Date().toISOString()
        };

        let savedToFirestore = false;
        if (db && !activeSession?.isDemo) {
          try {
            await addDoc(collection(db, "sessions", currentSessionId, "uploads"), mediaRecord);
            savedToFirestore = true;
          } catch (fsErr) {
            console.warn("Firestore write note, persisting locally:", fsErr.message);
          }
        }

        // Also save to local demo storage so UI updates immediately & works offline
        saveDemoUpload(currentSessionId, {
          ...mediaRecord,
          id: fileId,
          createdAt: new Date().toISOString()
        });

        // Refresh gallery
        listenGallery(currentSessionId);

        bar.style.width = "100%";
        status.textContent = "Uploaded";
        toast(`Uploaded ${rawFile.name}`);
      } catch (uploadErr) {
        console.error("Upload error:", uploadErr);
        status.textContent = "Failed";
        bar.style.background = "#e53e3e";
        toast(`Upload issue: ${uploadErr.message}`);
      }
    }
  } finally {
    ["cameraPhoto", "cameraVideo", "galleryFiles"].forEach(id => {
      const el = $(id);
      if (el) el.value = "";
    });
  }
}

// Drag & Drop Support
const uploadPanel = $("uploadPanel");
if (uploadPanel) {
  ["dragenter", "dragover"].forEach(evt => {
    uploadPanel.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
      uploadPanel.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach(evt => {
    uploadPanel.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
      uploadPanel.classList.remove("drag-over");
    });
  });
  uploadPanel.addEventListener("drop", e => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      uploadFiles(dt.files);
    }
  });
}

// File Input Listeners
["cameraPhoto", "cameraVideo", "galleryFiles"].forEach(id => {
  const el = $(id);
  if (el) {
    el.addEventListener("change", e => uploadFiles(e.target.files));
  }
});

// App Entry Point & Router
function route() {
  const currentParams = new URLSearchParams(location.search);
  const sid = currentParams.get("session");
  if (sid) {
    startJoin(sid);
  } else if (currentParams.has("admin")) {
    showView("adminView");
    renderAuth();
  } else {
    showView("homeView");
  }
}

// Global Auth State initialization
if (auth) {
  onAuthStateChanged(auth, user => {
    updateAuthStateUI(user);
  });
}

route();
window.addEventListener("popstate", route);
