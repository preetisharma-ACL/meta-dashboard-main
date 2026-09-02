import { createSignal, createEffect, Show } from "solid-js";
import {
  approveBudgetGuardEntry,
  rejectBudgetGuardEntry,
  approveSentence,
  rejectSentence,
  guardEventSentence,
  untouchedBudgetLine,
  detailText,
  triggerLabel,
  triggerChip,
  involvesBudgetChange,
  fmtPerDay,
  hasMetaError,
} from "../../services/budgetGuard";
import { collectFieldErrors, errorBanner } from "../../utils/apiErrors";

// ─── Approve / Reject a guarded campaign ──────────────────────────────────────
// A confirm step that spells out what the decision DOES before it is taken, in
// the row's own numbers — approving is what puts a ₹9,00,000/day campaign back
// on air, and nobody should discover that from the result.
//
// The reason is REQUIRED by both endpoints (422 on blank). It is also the only
// record of WHY a capped campaign was released, which is the entire audit trail
// this feature has, so the field is required here too rather than left for the
// server to bounce.
//
// Props: open, mode ("approve" | "reject"), row, onClose(), onDecided(row, mode)

const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 " +
  "bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-100 " +
  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none " +
  "disabled:opacity-50 transition";

export default function BudgetGuardDecisionModal(props) {
  const [reason, setReason] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [banner, setBanner] = createSignal(null);
  const [reasonError, setReasonError] = createSignal(null);
  // A 409 means somebody else already decided this row. The queue we are looking
  // at is stale, so the modal stops offering the button and asks for a refresh
  // instead of letting the admin retry into the same wall.
  const [alreadyDecided, setAlreadyDecided] = createSignal(false);

  const isApprove = () => props.mode === "approve";
  const row = () => props.row ?? {};

  // Fresh state whenever a new row/mode is opened — a reason typed for one
  // campaign must never be carried into the next.
  createEffect(() => {
    if (props.open) {
      props.mode;
      props.row?.id;
      setReason("");
      setBanner(null);
      setReasonError(null);
      setAlreadyDecided(false);
      setSubmitting(false);
    }
  });

  const close = () => {
    if (submitting()) return;
    props.onClose?.();
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    const text = reason().trim();
    if (!text) {
      setReasonError("A written reason is required.");
      return;
    }
    if (alreadyDecided()) return;

    setSubmitting(true);
    setBanner(null);
    setReasonError(null);
    try {
      const call = isApprove() ? approveBudgetGuardEntry : rejectBudgetGuardEntry;
      await call(row().id, text);
      props.onDecided?.(row(), props.mode);
    } catch (err) {
      // 409 — already decided. Say so plainly; the row is gone from the queue.
      if (err?.status === 409) {
        setAlreadyDecided(true);
        setBanner(
          errorBanner(
            err,
            collectFieldErrors(err),
            "This request has already been decided by someone else. Refresh the queue to see the decision.",
          ),
        );
      } else {
        // 422 (blank reason) and every other 4xx: pin the field message where it
        // belongs and put the rest in the banner, verbatim from the server.
        const pinned = collectFieldErrors(err);
        if (pinned.reason) setReasonError(pinned.reason);
        setBanner(errorBanner(err, pinned, "The decision could not be saved."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex">
        <div
          onClick={close}
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            isApprove() ? "Approve guarded campaign" : "Reject guarded campaign"
          }
          class="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-gray-900
                 border-l border-[#E2E8F1] dark:border-gray-700 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div class="flex items-start justify-between px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
            <div class="min-w-0">
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
                {isApprove()
                  ? involvesBudgetChange(row())
                    ? "Approve and restore"
                    : "Approve and resume"
                  : involvesBudgetChange(row())
                    ? "Reject and keep capped"
                    : "Reject and keep paused"}
              </h2>
              <p class="text-sm text-[#54657E] dark:text-gray-400 truncate">
                {row().campaign_name || "Campaign"}
              </p>
            </div>
            <button
              onClick={close}
              aria-label="Close"
              class="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center text-[#54657E] hover:bg-[#E2E8F1] dark:hover:bg-gray-700 transition"
            >
              ✕
            </button>
          </div>

          <form onSubmit={submit} class="flex-1 flex flex-col min-h-0">
            <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <Show when={banner()}>
                <div
                  role="alert"
                  class="rounded-lg border border-[#F0C2C9] bg-[#FDF2F4] dark:border-red-900/50 dark:bg-red-950/30 px-3.5 py-3 text-sm text-[#8C1F2C] dark:text-red-300"
                >
                  {banner()}
                </div>
              </Show>

              {/* What the guard did — carried into the confirm step so the
                  decision is taken against the same facts the card stated,
                  including WHICH RULE fired: approving a wrong-objective
                  campaign and approving an over-budget one are different acts
                  with different consequences. */}
              <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60 px-4 py-3.5">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                    What happened
                  </p>
                  <span
                    class={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${triggerChip(row())}`}
                  >
                    {triggerLabel(row())}
                  </span>
                </div>
                <p class="mt-1.5 text-sm text-[#14233A] dark:text-gray-100 leading-relaxed">
                  {guardEventSentence(row())}
                </p>
                <Show when={untouchedBudgetLine(row())}>
                  <p class="mt-1.5 text-sm text-[#54657E] dark:text-gray-300">
                    {untouchedBudgetLine(row())}
                  </p>
                </Show>
                {/* The guard's own words, verbatim, carried into the confirm
                    step with everything else — the decision is taken against
                    the same facts the card stated, including the ones this
                    screen only relays. */}
                <Show when={detailText(row()) && !involvesBudgetChange(row())}>
                  <p class="mt-2 text-xs text-[#54657E] dark:text-gray-400 break-words">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                      From the guard
                    </span>{" "}
                    <span class="font-mono text-[#14233A] dark:text-gray-200">
                      {detailText(row())}
                    </span>
                  </p>
                </Show>
              </div>

              {/* What this decision DOES. The approve wording carries the row's
                  own original_daily_budget — never a recomputed figure. */}
              <div
                class={`rounded-xl border px-4 py-3.5 ${
                  isApprove()
                    ? "border-[#F0C2C9] bg-[#FDF2F4] dark:border-red-900/50 dark:bg-red-950/25"
                    : "border-[#E2E8F1] bg-white dark:border-gray-700 dark:bg-gray-800/60"
                }`}
              >
                <p
                  class={`text-[11px] font-bold uppercase tracking-wider ${
                    isApprove()
                      ? "text-[#AC2334] dark:text-red-300"
                      : "text-[#8593A8] dark:text-gray-400"
                  }`}
                >
                  {isApprove() ? "This spends money again" : "This changes nothing on Meta"}
                </p>
                <p
                  class={`mt-1.5 text-sm font-semibold leading-relaxed ${
                    isApprove()
                      ? "text-[#8C1F2C] dark:text-red-200"
                      : "text-[#14233A] dark:text-gray-100"
                  }`}
                >
                  {isApprove() ? approveSentence(row()) : rejectSentence(row())}
                </p>
              </div>

              {/* Meta refused part of the guard — repeated here because it
                  changes what approving means: the campaign may never have been
                  stopped in the first place. */}
              <Show when={hasMetaError(row())}>
                <div class="rounded-xl border border-[#F0C2C9] bg-[#FDF2F4] dark:border-red-900/50 dark:bg-red-950/25 px-4 py-3.5">
                  <p class="text-[11px] font-bold uppercase tracking-wider text-[#AC2334] dark:text-red-300">
                    Meta refused part of this
                  </p>
                  <p class="mt-1.5 text-sm text-[#8C1F2C] dark:text-red-200 leading-relaxed break-words">
                    {row().meta_error}
                  </p>
                  <p class="mt-2 text-xs text-[#8C1F2C]/80 dark:text-red-300/80">
                    Check this campaign in Ads Manager before deciding — it may
                    not actually be stopped.
                  </p>
                </div>
              </Show>

              {/* Reason — required by the endpoint AND the only record of why a
                  capped campaign was released. */}
              <div>
                <label
                  for="bg-reason"
                  class="block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5"
                >
                  Reason <span class="text-[#AC2334]">*</span>
                </label>
                <textarea
                  id="bg-reason"
                  rows="4"
                  class={FIELD}
                  placeholder={
                    isApprove()
                      ? involvesBudgetChange(row())
                        ? "Who authorised this budget, and how it was verified"
                        : "Why this campaign should run as it is"
                      : involvesBudgetChange(row())
                        ? "Why this campaign should stay capped"
                        : "Why this campaign should stay paused"
                  }
                  value={reason()}
                  disabled={submitting() || alreadyDecided()}
                  onInput={(e) => {
                    setReason(e.currentTarget.value);
                    if (reasonError()) setReasonError(null);
                  }}
                />
                <Show when={reasonError()}>
                  <p class="mt-1.5 text-sm text-[#AC2334] dark:text-red-400">
                    {reasonError()}
                  </p>
                </Show>
                <p class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-400">
                  Recorded against this decision with your name and the time.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
              <button
                type="button"
                onClick={close}
                disabled={submitting()}
                class="px-4 py-2.5 rounded-lg text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1] dark:hover:bg-gray-700 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting() || alreadyDecided() || !reason().trim()}
                class={`px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  isApprove()
                    ? "bg-[#AC2334] hover:bg-[#93192a]"
                    : "bg-[#14233A] hover:bg-[#0F1B2E]"
                }`}
              >
                {/* The button names the write it performs. On an objective or
                    daily-spend row there is no budget write at all, so it must
                    not offer to restore one. */}
                {submitting()
                  ? "Saving…"
                  : isApprove()
                    ? involvesBudgetChange(row())
                      ? `Restore ${fmtPerDay(row().original_daily_budget) ?? "the budget"}`
                      : "Resume the campaign"
                    : involvesBudgetChange(row())
                      ? "Keep it capped"
                      : "Keep it paused"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
