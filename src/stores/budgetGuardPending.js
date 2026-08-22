import { createSignal } from "solid-js";
import { fetchBudgetGuardQueue } from "../services/budgetGuard";

// ─── Budget Guard pending count ───────────────────────────────────────────────
// One number, shared by every surface that has to say "something is waiting":
// the sidebar row, the header bell's dropdown and the notifications page.
//
// This exists because of how the feature FAILS IN PRACTICE. A campaign that trips
// the guard is paused and capped correctly — and then sits there. Nobody is
// emailed, nothing is broken, the client's spend simply stops. The only thing
// standing between "the guard worked" and "the guard quietly killed a live
// campaign for three days" is somebody noticing this count.
//
// ADMIN ONLY, and the poll is gated on the role in localStorage rather than on
// the reactive currentUser store: this fires from the sidebar the moment the app
// mounts, before /auth/me has landed, and a non-admin hitting an admin endpoint
// gets a 403 in everyone's console for nothing.
//
// The count served here is the SERVER's pending_count (see fetchBudgetGuardQueue)
// — never a locally tallied list length while the server offers its own number.

// Starts at 0 and every surface renders its badge only when the count is ABOVE
// zero — so the pre-first-read state and "nothing waiting" both render as no
// badge, and neither can ever be mistaken for the other on screen.
const [budgetGuardPending, setBudgetGuardPending] = createSignal(0);

export { budgetGuardPending };

export const canSeeBudgetGuard = () => {
  try {
    const auth = JSON.parse(localStorage.getItem("auth") || "{}");
    return !!auth?.token && auth?.role === "admin";
  } catch {
    return false;
  }
};

// Set from a queue response the page already holds, so deciding on a row updates
// the sidebar badge without a second round-trip.
export const setBudgetGuardPendingCount = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return;
  setBudgetGuardPending(v);
};

let inFlight = null;

export const refreshBudgetGuardPending = async () => {
  if (!canSeeBudgetGuard()) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { pendingCount } = await fetchBudgetGuardQueue();
      setBudgetGuardPendingCount(pendingCount);
    } catch (err) {
      // A failed poll leaves the last known count alone rather than dropping the
      // badge to 0 — a badge that disappears reads as "nothing waiting", which
      // is the one wrong answer this number must never give.
      console.warn("[budgetGuard] pending count refresh failed:", err?.message);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

// One interval for the whole app, however many surfaces ask for it. 90s: the
// guard acts on Meta's schedule, not ours, so a fresher poll buys nothing.
const POLL_MS = 90_000;
let timer = null;

export const watchBudgetGuardPending = () => {
  if (!canSeeBudgetGuard()) return;
  refreshBudgetGuardPending();
  if (timer) return;
  timer = setInterval(refreshBudgetGuardPending, POLL_MS);
};
