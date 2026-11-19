import { createSignal } from "solid-js";
import { fetchBankTransfers } from "../services/hdfcPay";

// ─── "Bank transfers to verify" sidebar counter ───────────────────────────────
// How many reported transfers are sitting unverified. Same rules as the Fund
// Requests and Budget Guard counters: starts at 0, renders only above 0, and a
// FAILED POLL KEEPS THE LAST NUMBER rather than dropping to 0 — a badge that
// vanishes reads as "nothing waiting", which is the exact failure this feature
// has when it fails. A client who reported a payment and is waiting on it is
// the person who pays for a missed badge.
//
// ADMIN AND ACCOUNTS ONLY, gated on the role in localStorage because the
// sidebar starts this before /auth/me lands. Every other role would just
// collect 403s.
const ROLES = ["admin", "accounts"];

const [bankTransfersBadge, setBankTransfersBadge] = createSignal(0);
export { bankTransfersBadge };

const canVerify = () => {
  try {
    const auth = JSON.parse(localStorage.getItem("auth") || "{}");
    return !!auth?.token && ROLES.includes(auth?.role);
  } catch {
    return false;
  }
};

let inFlight = null;

export const refreshBankTransfersBadge = async () => {
  if (!canVerify()) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // There is no count endpoint, so the pending list IS the count. It is the
      // queue a desk works through in a day, not an unbounded table.
      const rows = await fetchBankTransfers({ status: "pending" });
      setBankTransfersBadge(Array.isArray(rows) ? rows.length : 0);
    } catch (err) {
      console.warn("[bankTransfers] badge refresh failed:", err?.message);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

const POLL_MS = 60_000;
let timer = null;

export const watchBankTransfersBadge = () => {
  if (!canVerify()) return;
  refreshBankTransfersBadge();
  if (timer) return;
  timer = setInterval(refreshBankTransfersBadge, POLL_MS);
};
