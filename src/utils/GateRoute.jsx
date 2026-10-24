import { Navigate } from "@solidjs/router";
import { Show } from "solid-js";
import { isTierResolved, currentUser } from "../stores/currentUser";

// ─── Predicate route guard ────────────────────────────────────────────────────
// For routes role alone can't decide (CM tier). props.allow is a function over
// the reactive currentUser store. Same tier-race handling as PaymentsRoute:
// while a CM's tier is still unknown we hold on a spinner instead of bouncing
// a legitimate user away on a hard refresh.
export default function GateRoute(props) {
  const auth = (() => {
    try {
      return JSON.parse(localStorage.getItem("auth") || "{}");
    } catch {
      return {};
    }
  })();

  if (!auth?.token) return <Navigate href="/login" />;

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
      <Show when={props.allow()} fallback={<Navigate href="/dashboard" />}>
        {props.children}
      </Show>
    </Show>
  );
}
