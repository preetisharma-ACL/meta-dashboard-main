import { createSignal, Show } from "solid-js";
import { ArrowLeftRight, History } from "lucide-solid";
import CampaignReassignModal from "./CampaignReassignModal";
import CampaignOwnershipHistoryDrawer from "./CampaignOwnershipHistoryDrawer";
import {
  canReassignCampaigns,
  canSeeOwnershipHistory,
} from "../../stores/currentUser";

// ─── Campaign ownership control ───────────────────────────────────────────────
// The reusable pair of entry points for a campaign row or header: "Move" opens
// the guarded reassignment flow, "History" opens the ownership trail. Drop it
// wherever a campaign is listed; it owns the modal/drawer state so callers only
// have to hand it the campaign and take the row update back.
//
// THE TWO GATES ARE DIFFERENT ON PURPOSE. Moving a campaign is a write, and the
// backend allows it to admins and TIER-1 campaign managers only — note that this
// is a narrower set than pause/resume, which also lets coordination through.
// Reading who owned a campaign is information, so History opens to any campaign
// manager, tier-2 included: rendering it behind the write gate would hide the
// trail from exactly the people most likely to be asking why a month's leads
// moved.
//
// Neither gate is the authority — the backend re-checks both, and additionally
// refuses a tier-1 CM whose team doesn't cover BOTH the current and the target
// client. These just avoid handing anyone a button that always 403s.
//
// Props:
//   campaign  – { id, name, clientNomenId, clientNomenName }
//   size      – "sm" | "md" (default "md")
//   onReassigned – ({ clientNomenId, clientNomenName, newName }) => void, called
//                  only on a confirmed success. `newName` is null when Meta
//                  refused the rename, i.e. when the row's label did NOT change.
//   canWrite  – optional override; defaults to canReassignCampaigns()

export default function CampaignOwnershipControl(props) {
  const [moving, setMoving] = createSignal(null);
  const [viewing, setViewing] = createSignal(null);

  const allowWrite = () => props.canWrite ?? canReassignCampaigns();
  const sm = () => props.size === "sm";

  const BTN =
    "inline-flex items-center gap-1.5 rounded-lg font-semibold border transition-colors " +
    "disabled:opacity-50 disabled:cursor-default";
  const pad = () => (sm() ? "px-2.5 py-1 text-xs " : "px-3 py-1.5 text-sm ");
  const icon = () => (sm() ? "w-3.5 h-3.5" : "w-4 h-4");

  return (
    <>
      <div class="inline-flex items-center gap-1.5">
        <Show when={allowWrite()}>
          <button
            type="button"
            title="Move this campaign to another client"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMoving({ ...props.campaign });
            }}
            class={
              BTN +
              pad() +
              "border-purple-300 text-purple-700 hover:bg-purple-50 " +
              "dark:border-purple-700/60 dark:text-purple-300 dark:hover:bg-purple-900/20"
            }
          >
            <ArrowLeftRight class={icon()} />
            Move
          </button>
        </Show>

        <Show when={canSeeOwnershipHistory()}>
          <button
            type="button"
            title="Who has owned this campaign"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewing({ ...props.campaign });
            }}
            class={
              BTN +
              pad() +
              "border-gray-300 text-gray-600 hover:bg-gray-50 " +
              "dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            }
          >
            <History class={icon()} />
            History
          </button>
        </Show>
      </div>

      <CampaignReassignModal
        campaign={moving()}
        onReassigned={(change) => props.onReassigned?.(change)}
        onClose={() => setMoving(null)}
      />

      <CampaignOwnershipHistoryDrawer
        campaign={viewing()}
        onClose={() => setViewing(null)}
      />
    </>
  );
}
