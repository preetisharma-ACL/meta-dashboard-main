import { createStore } from "solid-js/store";
import { fetchUser } from "../services/userProfile";

// ─── Current user identity store ──────────────────────────────────────────────
// Fetched once per session from GET /auth/me. The whole CM UI gates on the
// role/tier exposed here. We never filter DATA by role on the frontend — this
// store only decides which CONTROLS to render.
const defaultUser = {
  loaded: false,
  loading: false,
  error: null,

  id: null,
  email: null,
  username: null,
  organizationId: null,
  organizationName: null,

  role: null, // admin | campaign_manager | client | sales | coordination | accounts
  cmProfile: null, // { tier, is_active } | null
};

export const [currentUser, setCurrentUser] = createStore(defaultUser);

// ─── Derived helpers (functions so callers stay reactive) ─────────────────────
export const cmTier = () => currentUser.cmProfile?.tier ?? null; // "tier_1" | "tier_2" | null
export const isCM = () => currentUser.role === "campaign_manager";
export const isAdmin = () => currentUser.role === "admin";
export const isTier1 = () => cmTier() === "tier_1";
export const isTier2 = () => cmTier() === "tier_2";

// Controls the rest of the UI gates on:
export const canSwitch = () => isTier1();
export const canUseAI = () => isAdmin() || isTier1();

// ─── Campaign write gate (pause/resume) ───────────────────────────────────────
// Who may write a campaign's status: admins + the other GLOBAL_READ roles
// (coordination, accounts), and Tier-1 campaign managers. Tier-2 CMs, clients,
// and sales cannot. The backend is the real authority (it also scope-checks that
// a CM owns the campaign); this gate just decides whether to SHOW the control so
// non-writers don't see a button that always 403s.
const CAMPAIGN_WRITE_ROLES = new Set(["admin", "coordination", "accounts"]);

export const canWriteCampaigns = () => {
  // Primary source of truth: the loaded /auth/me store.
  if (currentUser.loaded) {
    if (CAMPAIGN_WRITE_ROLES.has(currentUser.role)) return true;
    return isCM() && isTier1();
  }
  // Fallback before /auth/me resolves: read role/tier mirrored into localStorage
  // auth (role at login, cmTier enriched by loadCurrentUser). Keeps the control
  // from flickering hidden→shown on first paint for a known writer.
  try {
    const auth = JSON.parse(localStorage.getItem("auth") || "null");
    if (!auth) return false;
    if (CAMPAIGN_WRITE_ROLES.has(auth.role)) return true;
    return auth.role === "campaign_manager" && auth.cmTier === "tier_1";
  } catch {
    return false;
  }
};

// ─── Loader ───────────────────────────────────────────────────────────────────
// Idempotent: safe to call from multiple mount points; only fetches once.
let inFlight = null;

export const loadCurrentUser = async (force = false) => {
  if (!force && currentUser.loaded) return currentUser;
  if (inFlight) return inFlight;

  setCurrentUser({ loading: true, error: null });

  inFlight = (async () => {
    try {
      const res = await fetchUser(); // returns the { success, data, meta } envelope
      const u = res?.data ?? {};

      setCurrentUser({
        loaded: true,
        loading: false,
        error: null,
        id: u.id ?? null,
        email: u.email ?? null,
        username: u.username ?? null,
        organizationId: u.organization_id ?? null,
        organizationName: u.organization_name ?? null,
        role: u.role ?? null,
        cmProfile: u.cm_profile ?? null,
      });

      // Mirror tier into localStorage auth so synchronous gates (sidebar/route
      // guards) can branch without awaiting this fetch. Role is already stored
      // by the login flow; we just enrich it.
      try {
        const auth = JSON.parse(localStorage.getItem("auth") || "null");
        if (auth) {
          auth.role = u.role ?? auth.role;
          auth.cmTier = u.cm_profile?.tier ?? null;
          localStorage.setItem("auth", JSON.stringify(auth));
        }
      } catch {}

      return currentUser;
    } catch (err) {
      console.error("[currentUser] Failed to load /auth/me:", err);
      setCurrentUser({ loading: false, error: err.message || "Failed to load user" });
      return currentUser;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};
