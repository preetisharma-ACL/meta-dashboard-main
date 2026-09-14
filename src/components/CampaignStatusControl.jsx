import { createSignal, Show } from "solid-js";
import Swal from "sweetalert2";
import { Pause, Play, Loader2 } from "lucide-solid";
import {
  previewCampaignStatus,
  executeCampaignStatus,
} from "../services/campaignStatus";
import { canWriteCampaigns } from "../stores/currentUser";

// Note: campaign pause/resume is logged to the activity trail automatically by
// the backend on its status endpoint — no frontend recordActivity call needed.

// ─── Campaign Pause / Resume control ──────────────────────────────────────────
// The single, reusable button for the first write feature. Drop it next to any
// campaign row/header. It owns the entire safe-write flow so callers don't have
// to repeat it:
//
//   click → preview (dry-run) → confirm dialog → execute → toast + report back
//
// Hard rules (see the build spec):
//   • Confirmation is MANDATORY — never write on a single click.
//   • Only flip the displayed status on a confirmed success. On ANY failure the
//     backend left Meta untouched, so we keep the old status and just surface the
//     error. We never optimistically flip.
//   • Only show the button for users who can write, and only for active/paused
//     campaigns (the only states the backend lets you toggle).
//
// Props:
//   status        – current campaign status ("active" | "paused" | …)
//   campaignId    – campaign id (number/string)
//   campaignName  – display name for the confirm dialog
//   onChanged     – (newStatus) => void, called ONLY on a confirmed success
//   size          – "sm" | "md" (default "md")
//   canWrite      – optional override; defaults to canWriteCampaigns()

const toast = (icon, title, text) =>
  Swal.fire({
    icon,
    title,
    text,
    toast: true,
    position: "top-end",
    timer: icon === "error" ? 6000 : 3500,
    timerProgressBar: true,
    showConfirmButton: false,
  });

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function CampaignStatusControl(props) {
  const [busy, setBusy] = createSignal(false);

  const allowed = () => (props.canWrite ?? canWriteCampaigns());
  // Only active⇄paused are toggleable; everything else (completed/draft/…) hides.
  const action = () =>
    props.status === "active"
      ? "pause"
      : props.status === "paused"
        ? "resume"
        : null;

  const run = async () => {
    const act = action();
    if (!act || busy()) return;

    setBusy(true);
    try {
      // 1. Dry-run preview — populates the dialog and catches no-ops early.
      let preview;
      try {
        preview = await previewCampaignStatus(props.campaignId, act);
      } catch (err) {
        handleError(err, act);
        return;
      }

      if (!preview?.valid) {
        // Already in the target state (or otherwise not toggleable). Not an
        // error — just tell the user and stop. No write is attempted.
        toast(
          "info",
          "Nothing to change",
          preview?.reason
            ? cap(preview.reason)
            : `Campaign is already ${act === "pause" ? "paused" : "active"}.`,
        );
        return;
      }

      // 2. Mandatory confirmation, built from the preview.
      const verb = act === "pause" ? "Pause" : "Resume";
      const from = cap(preview.current_status);
      const to = cap(preview.target_status);
      const name = preview.campaign_name || props.campaignName || "this campaign";

      const { isConfirmed } = await Swal.fire({
        title: `${verb} campaign?`,
        html: `<div style="text-align:left;font-size:13px;line-height:1.6">
          <b>${escapeHtml(name)}</b><br/>
          This will change its status from
          <b>${from}</b> → <b>${to}</b> on Meta.
        </div>`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: verb,
        cancelButtonText: "Cancel",
        confirmButtonColor: act === "pause" ? "#B07A14" : "#15966A",
        reverseButtons: true,
        focusCancel: true,
      });
      if (!isConfirmed) return;

      // 3. The real write — confirm:true is sent by the service.
      let result;
      try {
        result = await executeCampaignStatus(props.campaignId, act);
      } catch (err) {
        handleError(err, act);
        return;
      }

      if (result?.success) {
        // 4a. Success — flip the displayed status and celebrate.
        props.onChanged?.(result.new_status);
        toast(
          "success",
          act === "pause" ? "Campaign paused" : "Campaign resumed",
          `Now ${cap(result.new_status)} on Meta.`,
        );
      } else {
        // 4b. Defensive: HTTP 200 but success:false. Treat as a write failure;
        // status is unchanged.
        toast(
          "error",
          "Write didn't go through",
          result?.error || "Meta rejected the change. Status unchanged.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  // Map every failure mode to an honest message; never change the status here.
  const handleError = (err, act) => {
    if (err?.status === 403) {
      toast(
        "error",
        "Not allowed",
        "You don't have permission to control this campaign.",
      );
      return;
    }
    if (err?.message === "Failed to fetch") {
      toast(
        "error",
        "Couldn't reach the server",
        "The campaign status was not changed.",
      );
      return;
    }
    if (err?.code === "confirmation_required") {
      // Shouldn't happen — the service always sends confirm:true.
      toast("error", "Confirmation required", "Please try again.");
      return;
    }
    // write_failed (Meta rejected) or anything else. Prefer the specific Meta
    // message from detail.error; fall back to the generic message.
    const metaMsg = err?.data?.detail?.error || err?.message;
    toast(
      "error",
      `Couldn't ${act} campaign`,
      metaMsg ? `Meta: ${metaMsg}` : "The status was not changed.",
    );
  };

  return (
    <Show when={allowed() && action()}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          run();
        }}
        disabled={busy()}
        title={action() === "pause" ? "Pause this campaign" : "Resume this campaign"}
        class={
          // Sizing is shared with CampaignOwnershipControl so Pause/Move/History
          // line up as one control group: same height, padding, radius and ring.
          "inline-flex items-center justify-center rounded-md font-medium leading-none " +
          "whitespace-nowrap ring-1 ring-inset transition-colors " +
          "focus-visible:outline-none focus-visible:ring-2 " +
          "disabled:opacity-50 disabled:cursor-default " +
          (props.size === "sm"
            ? "h-7 px-2.5 gap-1.5 text-xs "
            : "h-9 px-3.5 gap-2 text-sm ") +
          (action() === "pause"
            ? "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100 " +
              "dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30 dark:hover:bg-amber-500/20"
            : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100 " +
              "dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30 dark:hover:bg-emerald-500/20")
        }
      >
        <Show
          when={!busy()}
          fallback={<Loader2 class={(props.size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4") + " animate-spin"} />}
        >
          <Show
            when={action() === "pause"}
            fallback={<Play class={props.size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />}
          >
            <Pause class={props.size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
          </Show>
        </Show>
        {action() === "pause" ? "Pause" : "Resume"}
      </button>
    </Show>
  );
}

// Minimal HTML escape — campaign names go into Swal's html option.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
