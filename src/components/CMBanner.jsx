import { Show } from "solid-js";
import { asTeamMemberId, viewingAs, clearScope } from "../stores/cmScope";
import { canSwitch, isAdmin } from "../stores/currentUser";

// Persistent banner shown whenever a Tier 1 is viewing as a team member, OR an
// admin is "viewing as" a campaign manager from the Campaign Managers screen.
// Email/tier come from meta.viewing_as captured on the latest scoped response
// (the admin screen also primes it on select). "Return to my view" clears the
// scope and lets pages refetch their own data.
//
// Keyed on a specific member being selected (asTeamMemberId != null), so it's
// naturally suppressed in the Tier-1 "Just me" mode (scope=own with no member —
// the lead's own perspective) and on the default team view.
export default function CMBanner() {
  const tierLabel = (t) =>
    t === "tier_1" ? "Tier 1" : t === "tier_2" ? "Tier 2" : t;

  return (
    <Show when={(canSwitch() || isAdmin()) && asTeamMemberId() != null}>
      <div class="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/60">
        <div class="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
            <svg
              class="w-4 h-4 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
            <span class="font-medium">
              Viewing as{" "}
              <span class="font-semibold">
                {viewingAs()?.email ?? "team member"}
              </span>
              <Show when={viewingAs()?.tier}>
                {" "}
                <span class="text-amber-600 dark:text-amber-400">
                  ({tierLabel(viewingAs()?.tier)})
                </span>
              </Show>
            </span>
          </div>
          <button
            onClick={clearScope}
            class="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg
                   bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Return to my view
          </button>
        </div>
      </div>
    </Show>
  );
}
