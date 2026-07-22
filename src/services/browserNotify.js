// ─── OS-level browser notifications + sound for new dashboard alerts ─────────
//
// These use the Web Notifications API, so the popup is drawn by the operating
// system and appears no matter which browser tab is focused (or even when the
// window is in the background). The on-screen position (bottom-right, top-right,
// etc.) is controlled by the OS/browser — a web page can't choose it.
//
// Sound is a normal <audio> element pointing at /notification.mp3 (public/).
// Browsers block audio until the user has interacted with the page at least
// once, so we "unlock" the element on the first click/keypress/touch.

let audioEl;
const getAudio = () => {
  if (!audioEl) {
    audioEl = new Audio("/notification.mp3");
    audioEl.preload = "auto";
  }
  return audioEl;
};

// Prime the audio element on the first user gesture so later programmatic
// play() calls (triggered by a notification, not a click) are allowed.
let audioUnlocked = false;
const unlockAudio = () => {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const a = getAudio();
  a.muted = true;
  a.play()
    .then(() => {
      a.pause();
      a.currentTime = 0;
      a.muted = false;
    })
    .catch(() => {
      a.muted = false;
    });
};

if (typeof window !== "undefined") {
  ["click", "keydown", "touchstart"].forEach((ev) =>
    window.addEventListener(ev, unlockAudio, { once: true, passive: true }),
  );
}

// Ask for permission to show OS notifications. Safe to call repeatedly.
export const ensureNotifyPermission = async () => {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
};

const playSound = () => {
  try {
    const a = getAudio();
    a.currentTime = 0;
    a.play().catch(() => {}); // ignore autoplay rejections
  } catch {}
};

// Fire a browser notification (if permitted) and always play the sound.
// Sound plays even when OS-notification permission is denied, so the user still
// gets an audible cue while the dashboard tab is open.
export const showBrowserNotification = ({ title, body, tag, onClick } = {}) => {
  playSound();

  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    const n = new Notification(title || "New notification", {
      body: body || "",
      icon: "/aajneeti-favicon.png",
      badge: "/aajneeti-favicon.png",
      tag, // same tag collapses duplicates instead of stacking
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {}
      onClick?.();
      n.close();
    };
  } catch {}
};
