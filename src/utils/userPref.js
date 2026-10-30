// ─── Per-user on/off preferences in localStorage ──────────────────────────────
// For list switches like "Show inactive" / "Show dead clients" that should be
// remembered per user. Keyed `<name>.<user id>`; auth.user is written at login,
// so the key is known before /auth/me answers. Storage can throw (private
// mode, quota) — reads then fall back to off, writes just aren't remembered.

const userKey = (name) => {
  try {
    const u = JSON.parse(localStorage.getItem("auth") || "{}")?.user;
    return `${name}.${u?.id ?? u?.email ?? "me"}`;
  } catch {
    return `${name}.me`;
  }
};

export const readUserFlag = (name) => {
  try {
    return localStorage.getItem(userKey(name)) === "1";
  } catch {
    return false;
  }
};

export const writeUserFlag = (name, on) => {
  try {
    localStorage.setItem(userKey(name), on ? "1" : "0");
  } catch {
    /* not remembered — still applies for this visit */
  }
};
