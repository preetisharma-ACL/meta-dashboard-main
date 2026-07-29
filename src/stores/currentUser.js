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
export const isSales = () => currentUser.role === "sales";
export const isTier1 = () => cmTier() === "tier_1";
export const isTier2 = () => cmTier() === "tier_2";

// Controls the rest of the UI gates on:
export const canSwitch = () => isTier1();
export const canUseAI = () => isAdmin() || isTier1();

// ─── GLOBAL_READ gate ─────────────────────────────────────────────────────────
// admin + coordination + accounts read across the whole org (all managers /
// clients). Cross-org admin views (e.g. Manager Performance, Budget History) are
// available to these roles. The backend is the real authority; this just decides
// whether to SHOW the control so other roles don't see one that always 403s.
const GLOBAL_READ_ROLES = new Set(["admin", "coordination", "accounts"]);
export const isGlobalRead = () => {
  if (currentUser.loaded) return GLOBAL_READ_ROLES.has(currentUser.role);
  // Fallback before /auth/me resolves: read the role mirrored into localStorage.
  try {
    const auth = JSON.parse(localStorage.getItem("auth") || "null");
    return auth ? GLOBAL_READ_ROLES.has(auth.role) : false;
  } catch {
    return false;
  }
};

// ─── Campaign write gate (pause/resume) ───────────────────────────────────────
// Who may write a campaign's status: admins, coordination, and Tier-1 campaign
// managers. Tier-2 CMs, clients, sales and ACCOUNTS cannot. The backend is the
// real authority (it also scope-checks that a CM owns the campaign); this gate
// just decides whether to SHOW the control so non-writers don't see a button
// that always 403s.
//
// NOTE — this set is deliberately NOT the GLOBAL_READ set. Accounts is a
// global READER (it needs to see money across every client) but never a
// campaign writer: its job is the payments desk. Removing it here also strips
// the campaign write controls it could previously see in CMHierarchy,
// CampaignBudgetControl and CampaignStatusControl, which is the point.
const CAMPAIGN_WRITE_ROLES = new Set(["admin", "coordination"]);

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

// ─── Payments gates (accounts desk + tier-1 CM entry) ─────────────────────────
// Same two-source pattern as canWriteCampaigns(): prefer the loaded /auth/me
// store, fall back to the role/tier mirrored into localStorage so a gate
// doesn't flicker (or wrongly deny) before /auth/me resolves.
//
// These decide which CONTROLS and ROUTES to show. The API is the authority:
// /payments/clients/ and add-funds 403 a tier-2 CM, and PATCH/DELETE 403 any
// CM at all. The UI gate exists so nobody is handed a button that always fails.

const readAuth = () => {
  try {
    return JSON.parse(localStorage.getItem("auth") || "null");
  } catch {
    return null;
  }
};

// The accounts desk — plus admin, who sees every accounts surface.
export const isAccountsDesk = () => {
  const role = currentUser.loaded ? currentUser.role : readAuth()?.role;
  return role === "accounts" || role === "admin";
};

// Tier-1 campaign managers ONLY. Tier-2 is excluded everywhere in payments.
export const isTier1CM = () => {
  if (currentUser.loaded) return isCM() && isTier1();
  const auth = readAuth();
  return auth?.role === "campaign_manager" && auth?.cmTier === "tier_1";
};

// Who may POST /payments/add-funds/ — the accounts desk and tier-1 CMs.
export const canRecordPayments = () => isAccountsDesk() || isTier1CM();

// Who may PATCH / DELETE a payment — accounts and admin only, never a CM.
export const canManagePayments = () => isAccountsDesk();

// True once the tier is actually known. A campaign_manager's tier arrives with
// /auth/me, so a route guard must WAIT on this rather than treat "tier not
// loaded yet" as "not tier-1" and bounce a legitimate tier-1 lead.
export const isTierResolved = () => {
  if (currentUser.loaded) return true;
  const auth = readAuth();
  if (!auth) return true; // unauthenticated — the auth guard handles it
  if (auth.role !== "campaign_manager") return true; // tier is irrelevant
  return auth.cmTier !== undefined && auth.cmTier !== null;
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
