import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import Swal from "sweetalert2";
import { Pencil, Loader2, X, ArrowRight, AlertTriangle } from "lucide-solid";
import {
  previewCampaignBudget,
  executeCampaignBudget,
} from "../services/campaignBudget";
import { canWriteCampaigns } from "../stores/currentUser";

// ─── Single-campaign daily-budget edit control ────────────────────────────────
// The sibling of CampaignStatusControl. Drop it next to the pause/resume button
// on the campaign detail page. It owns the whole safe-write flow:
//
//   "Edit budget" → modal (pre-filled current) → debounced preview (dry-run,
//   shows current → new + blocks invalid) → explicit confirm → write → toast.
//
// Hard rules (mirror the status control):
//   • This is a REAL Meta write (changes spend). NEVER write on keystroke — only
//     on an explicit confirm click, gated behind a confirmation dialog.
//   • A preview with valid:false blocks the write and shows the server's reason
//     (below Meta minimum, CBO-managed, out of bounds, …).
//   • Only update the displayed budget on a confirmed success. On ANY failure the
//     backend left Meta untouched — keep the old budget and surface the error.
//   • Only shown to users who can write campaigns (same gate as pause/resume).
//
// Props:
//   campaignId    – campaign id (number/string)
//   campaignName  – display name for the confirm dialog
//   currentBudget – best-known current daily budget (prefills the input); the
//                   preview's current_budget is the authoritative value once run
//   onChanged     – (newBudget) => void, called ONLY on a confirmed success
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

const money = (v) => {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export default function CampaignBudgetControl(props) {
  const [open, setOpen] = createSignal(false);
  const [value, setValue] = createSignal("");
  const [preview, setPreview] = createSignal(null); // last preview payload
  const [previewAmount, setPreviewAmount] = createSignal(null); // amount it was for
  const [previewing, setPreviewing] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  const allowed = () => props.canWrite ?? canWriteCampaigns();

  // The authoritative "current" budget: prefer the preview's current_budget once
  // we've fetched one, else the prop the page passed in.
  const currentBudget = () => preview()?.current_budget ?? props.currentBudget;

  const openEditor = () => {
    const seed =
      props.currentBudget != null && props.currentBudget !== ""
        ? String(parseFloat(props.currentBudget))
        : "";
    setValue(seed);
    setPreview(null);
    setPreviewAmount(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setValue("");
    setPreview(null);
    setPreviewAmount(null);
    setPreviewing(false);
  };

  const targetNum = () => parseFloat(value());
  const hasTarget = () => value().trim() !== "" && isFinite(targetNum());
  // A preview matching the number currently in the box (fresh, not stale from a
  // prior keystroke). Keyed on the requested amount so an invalid preview whose
  // echoed target_budget got normalized still counts as fresh (shows its reason).
  const previewFresh = () =>
    preview() != null && hasTarget() && previewAmount() === targetNum();
  const canConfirm = () =>
    previewFresh() && preview().valid === true && !saving();

  // ── Debounced preview (read-only — safe to fire as the user types) ──────────
  // Never writes; just populates the current → new comparison and any block
  // reason. The write itself stays behind the explicit confirm below.
  let debounce;
  onCleanup(() => clearTimeout(debounce));
  createEffect(() => {
    const v = value();
    const isOpen = open();
    clearTimeout(debounce);
    if (!isOpen || v.trim() === "" || !isFinite(parseFloat(v))) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const amount = parseFloat(v);
    debounce = setTimeout(async () => {
      try {
        const data = await previewCampaignBudget(props.campaignId, amount);
        // Ignore a stale response if the user has typed on since.
        if (parseFloat(value()) === amount) {
          setPreview(data);
          setPreviewAmount(amount);
        }
      } catch (err) {
        if (parseFloat(value()) === amount) {
          setPreview(null);
          setPreviewAmount(null);
          toast(
            "error",
            "Couldn't preview the change",
            err?.data?.detail?.error || err?.message || "Please try again.",
          );
        }
      } finally {
        if (parseFloat(value()) === amount) setPreviewing(false);
      }
    }, 450);
  });

  // ── Confirm + write ─────────────────────────────────────────────────────────
  const save = async () => {
    if (!canConfirm()) return;
    const from = money(currentBudget());
    const to = money(targetNum());
    const name = preview()?.campaign_name || props.campaignName || "this campaign";

    const { isConfirmed } = await Swal.fire({
      title: "Change daily budget?",
      html: `<div style="text-align:left;font-size:13px;line-height:1.6">
        <b>${escapeHtml(name)}</b><br/>
        This will change the daily budget from
        <b>${from}</b> → <b>${to}</b> on Meta.
      </div>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Change budget",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#14233A",
      reverseButtons: true,
      focusCancel: true,
    });
    if (!isConfirmed) return;

    setSaving(true);
    try {
      const result = await executeCampaignBudget(props.campaignId, targetNum());
      // The write endpoint reports failure either as a thrown error (handled
      // below) or, defensively, as HTTP 200 with success:false.
      if (result && result.success === false) {
        toast(
          "error",
          "Budget change didn't go through",
          result.error || result.detail || "Meta rejected the change. Budget unchanged.",
        );
        return;
      }
      const newBudget = result?.target_budget ?? result?.budget ?? targetNum();
      props.onChanged?.(newBudget);
      toast("success", "Budget updated", `Now ${money(newBudget)} / day on Meta.`);
      close();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleError = (err) => {
    if (err?.status === 403) {
      toast(
        "error",
        "Not allowed",
        "You don't have permission to change this campaign's budget.",
      );
      return;
    }
    if (err?.message === "Failed to fetch") {
      toast(
        "error",
        "Couldn't reach the server",
        "The budget was not changed.",
      );
      return;
    }
    const metaMsg =
      err?.data?.detail?.error || err?.data?.error || err?.message;
    toast(
      "error",
      "Couldn't change the budget",
      metaMsg ? `Meta: ${metaMsg}` : "The budget was not changed.",
    );
  };

  return (
    <Show when={allowed()}>
      <button
        type="button"
        onClick={openEditor}
        title="Edit the daily budget"
        class={
          "inline-flex items-center gap-1.5 rounded-lg font-semibold border transition-colors border-[#35507F]/40 text-[#35507F] hover:bg-[#35507F]/5 dark:border-blue-700/60 dark:text-blue-300 dark:hover:bg-blue-900/20 " +
          (props.size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm")
        }
      >
        <Pencil class={props.size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
        Edit budget
      </button>

      <Show when={open()}>
        <div
          class="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40"
          onClick={close}
        >
          <div
            class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-[420px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div class="font-sans font-bold text-[15px] text-gray-800 dark:text-white">
                Edit daily budget
              </div>
              <button
                onClick={close}
                class="w-8 h-8 rounded-lg grid place-items-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X class="w-4 h-4" />
              </button>
            </div>

            <div class="p-5">
              <div class="text-[12px] text-gray-500 dark:text-gray-400 mb-1">
                Current daily budget
              </div>
              <div class="text-[15px] font-semibold text-gray-800 dark:text-gray-100 tabular-nums mb-4">
                {money(currentBudget())}
              </div>

              <label class="block text-[12px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                New daily budget
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[14px]">
                  ₹
                </span>
                <input
                  type="number"
                  min="1"
                  value={value()}
                  onInput={(e) => setValue(e.target.value)}
                  placeholder="e.g. 500"
                  autofocus
                  class="w-full h-10 rounded-[10px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-7 pr-3 text-[14px] font-semibold text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#14233A]/10 focus:border-[#14233A] transition-colors"
                />
              </div>

              {/* Preview / validity */}
              <div class="mt-3 min-h-[44px]">
                <Show when={previewing()}>
                  <div class="flex items-center gap-2 text-[12.5px] text-gray-400">
                    <Loader2 class="w-3.5 h-3.5 animate-spin" /> Checking…
                  </div>
                </Show>

                <Show when={!previewing() && previewFresh()}>
                  <Show
                    when={preview().valid}
                    fallback={
                      <div class="flex items-start gap-2 rounded-xl bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 px-3.5 py-2.5 text-[12px] text-[#AC2334] dark:text-red-300">
                        <AlertTriangle class="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>
                          {preview().reason ||
                            "This budget can't be applied to this campaign."}
                        </span>
                      </div>
                    }
                  >
                    <div class="flex items-center justify-center gap-2 rounded-xl bg-[#14233A]/[0.04] dark:bg-gray-800 px-3.5 py-2.5 text-[13px] font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
                      {money(currentBudget())}
                      <ArrowRight class="w-3.5 h-3.5 text-gray-400" />
                      <span class="text-[#14233A] dark:text-white">
                        {money(preview().target_budget)}
                      </span>
                    </div>
                  </Show>
                </Show>
              </div>

              <div class="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={close}
                  class="h-10 px-4 rounded-[10px] font-semibold text-[13px] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={!canConfirm()}
                  class="h-10 px-4 rounded-[10px] font-semibold text-[13px] text-white bg-[#14233A] hover:bg-[#1c2f4d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
                >
                  <Show when={saving()}>
                    <Loader2 class="w-4 h-4 animate-spin" />
                  </Show>
                  Change budget
                </button>
              </div>
              <p class="mt-2 text-[11px] text-gray-400 text-center">
                This writes to Meta immediately and changes spend.
              </p>
            </div>
          </div>
        </div>
      </Show>
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
