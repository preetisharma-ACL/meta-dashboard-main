import { Navigate } from "@solidjs/router";
import { Show } from "solid-js";
import {
  isAccountsDesk,
  isTier1CM,
  isTierResolved,
  currentUser,
} from "../stores/currentUser";

// ─── Payments route guard ─────────────────────────────────────────────────────
// AdminRoute gates on ROLE alone, which isn't enough here: the payment screens
// split campaign managers by TIER, and a tier-2 CM must be bounced even though
// their role matches. This guard adds that axis.
//
// props.allow — which gates open the route:
//   "accounts" → accounts + admin only          (ledger, needs-docs)
//   "record"   → accounts + admin, or tier-1 CM (record payment)
//   "cm"       → tier-1 CM only                 (my entries)
//
// THE TIER RACE: a CM's tier arrives with /auth/me, which ProtectedLayout kicks
// off on mount. Treating "not loaded yet" as "not tier-1" would redirect a
// legitimate tier-1 lead away on a hard refresh — so when the tier is still
// unknown we hold on a spinner instead of deciding. isTierResolved() is only
// false for a campaign_manager whose tier hasn't landed; every other role
// decides immediately. Reading the reactive store means this re-evaluates the
// moment /auth/me resolves.

export default function PaymentsRoute(props) {
  const auth = (() => {
    try {
      return JSON.parse(localStorage.getItem("auth") || "{}");
    } catch {
      return {};
    }
  })();

  if (!auth?.token) return <Navigate href="/login" />;

  const allowed = () => {
    switch (props.allow) {
      case "record":
        return isAccountsDesk() || isTier1CM();
      case "cm":
        return isTier1CM();
      case "accounts":
      default:
        return isAccountsDesk();
    }
  };

  // Still waiting on /auth/me for this CM's tier — don't decide yet.
  const pending = () => !isTierResolved() && !currentUser.error;

  return (
    <Show
      when={!pending()}
      fallback={
        <div class="w-full min-h-[60vh] grid place-items-center">
          <div class="flex items-center gap-3 text-sm font-semibold text-[#54657E] dark:text-gray-400">
            <svg class="w-5 h-5 animate-spin text-[#14233A] dark:text-gray-300" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Checking your access…
          </div>
        </div>
      }
    >
      <Show when={allowed()} fallback={<Navigate href="/dashboard" />}>
        {props.children}
      </Show>
    </Show>
  );
}
