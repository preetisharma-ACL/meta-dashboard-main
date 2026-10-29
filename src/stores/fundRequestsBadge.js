import { createSignal } from "solid-js";
import { fetchFundBadge } from "../services/fundRequests";

// ─── Fund Requests sidebar counter ────────────────────────────────────────────
// urgent + stopped — the requests where an ad account is already off air or
// about to be. Same rules as the Budget Guard count: starts at 0, renders only
// above 0, and a failed poll keeps the last number rather than dropping to 0
// (a vanished badge reads as "nothing waiting").
//
// Gated on the role in localStorage: the sidebar starts this before /auth/me
// lands, and every other role would just collect 403s.
const ROLES = ["admin", "accounts", "coordination", "campaign_manager"];

const [fundRequestsBadge, setFundRequestsBadge] = createSignal(0);
export { fundRequestsBadge };

const canSeeFundRequests = () => {
  try {
    const auth = JSON.parse(localStorage.getItem("auth") || "{}");
    return !!auth?.token && ROLES.includes(auth?.role);
  } catch {
    return false;
  }
};

let inFlight = null;

export const refreshFundRequestsBadge = async () => {
  if (!canSeeFundRequests()) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      setFundRequestsBadge(await fetchFundBadge());
    } catch (err) {
      console.warn("[fundRequests] badge refresh failed:", err?.message);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

const POLL_MS = 60_000;
let timer = null;

export const watchFundRequestsBadge = () => {
  if (!canSeeFundRequests()) return;
  refreshFundRequestsBadge();
  if (timer) return;
  timer = setInterval(refreshFundRequestsBadge, POLL_MS);
};
