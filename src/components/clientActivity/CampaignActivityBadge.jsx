import { Show } from "solid-js";
import {
  ACTIVITY_RUNNING,
  ACTIVITY_UNKNOWN,
  MISMATCH_TOOLTIP,
  activityLabel,
  isActivityMismatch,
  normaliseActivity,
} from "../../services/campaignActivity";

// ─── Derived campaign activity: ● Running / ○ Paused ──────────────────────────
// Deliberately NOT shaped like the engagement badge it sits next to. "Active"
// (a person's label) and "Running" (live campaigns) mean different things, so the
// two must never be mistaken for one another at a glance:
//
//   Engagement  full pill · coloured fill · green/amber/slate   ClientStatusControl
//   Activity    square-ish outline · monochrome · ●/○ mark      this
//
// The dashed-outline "Not set" engagement badge is the closest neighbour, so this
// one uses a SOLID border, a rounded rectangle rather than a pill, and uppercase
// tracking — three separate cues, any one of which is enough to tell them apart.
//
// Unknown activity renders NOTHING. The hierarchy payload is cached and one
// minted before the field existed carries no value; drawing "Paused" there would
// invent a fact. (Refreshing that view repopulates it.)
//
// Props:
//   activity     "running" | "paused" | null
//   engagement   the row's engagement_status — only used to flag the mismatch
//   compact      smaller, for dense card lists
//   class        extra classes on the wrapper

export default function CampaignActivityBadge(props) {
  const value = () => normaliseActivity(props.activity);
  const running = () => value() === ACTIVITY_RUNNING;
  const known = () => value() !== ACTIVITY_UNKNOWN;
  const mismatch = () => isActivityMismatch(props.engagement, props.activity);

  return (
    <Show when={known()}>
      <span class={`inline-flex items-center gap-1 ${props.class ?? ""}`}>
        <span
          class={`inline-flex items-center gap-1.5 rounded-md border font-bold uppercase tracking-[0.07em] whitespace-nowrap
                  border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 ${
                    props.compact
                      ? "px-1.5 py-[1px] text-[9.5px]"
                      : "px-2 py-[2px] text-[10px]"
                  }`}
          title={
            running()
              ? "At least one campaign is currently active"
              : "No campaign is currently active"
          }
        >
          {/* ● filled when running, ○ hollow when not — readable without colour */}
          <span
            class={`h-1.5 w-1.5 rounded-full ${
              running()
                ? "bg-gray-700 dark:bg-gray-200"
                : "border border-gray-400 dark:border-gray-500"
            }`}
          />
          {activityLabel(props.activity)}
        </span>

        {/* Mismatch hint — the manual label says Active, the campaigns say no. */}
        <Show when={mismatch()}>
          <span
            class="inline-flex text-[#B07A14] dark:text-amber-400"
            title={MISMATCH_TOOLTIP}
            aria-label={MISMATCH_TOOLTIP}
            role="img"
          >
            <svg
              class={props.compact ? "w-3 h-3" : "w-3.5 h-3.5"}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          </span>
        </Show>
      </span>
    </Show>
  );
}
