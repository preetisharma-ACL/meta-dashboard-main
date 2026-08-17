import { createSignal, createEffect, Show } from "solid-js";
import { FIELD } from "./assignmentsFormat";

// ─── Assign / unassign confirmation ───────────────────────────────────────────
// Both directions are confirmed, because an assignment is not a label: it is
// what DECIDES WHETHER THE MANAGER CAN SEE THE CLIENT'S DATA. The sentence
// naming that consequence is the whole point of the step, so it is stated in
// both wordings rather than left to a generic "Are you sure?".
//
// Unassign is described as a REVOKE, never a delete: the row is deactivated,
// the audit trail survives, and assigning the same pair again later reactivates
// it. Saying "delete" would misdescribe what the operator is about to do.
//
// The optional note rides along as `notes` and lands in the audit log, which is
// the only place a reason for a change is ever recorded.
//
// Props: pending ({ action:"assign"|"unassign", clientId, cmId, clientLabel,
//        cmLabel } | null), busy, error, onConfirm(notes), onClose()

export default function AssignmentConfirmModal(props) {
  const [notes, setNotes] = createSignal("");

  const isAssign = () => props.pending?.action === "assign";

  // Clear the note whenever a NEW pair is put up for confirmation, so a note
  // typed for one change can never be filed against a different one. Tracks the
  // pending OBJECT, which the caller replaces per confirmation — a rejected
  // attempt leaves it untouched, so a retry keeps what the operator typed.
  createEffect(() => {
    props.pending;
    setNotes("");
  });

  const confirm = () => props.onConfirm?.(notes());

  return (
    <Show when={props.pending}>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          onClick={() => !props.busy && props.onClose?.()}
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            isAssign() ? "Confirm assignment" : "Confirm removal of assignment"
          }
          class="relative z-50 w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-2xl overflow-hidden"
        >
          <div class="px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
            <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
              {isAssign() ? "Assign client" : "Remove assignment"}
            </h2>
            <p class="text-sm text-[#54657E] dark:text-gray-400 mt-0.5">
              {isAssign()
                ? "Gives this manager access to the client's data."
                : "Takes the client's data out of this manager's view."}
            </p>
          </div>

          <div class="px-6 py-5 space-y-4">
            {/* The pair, spelled out — the operator may have arrived here from
                either tab, so neither side can be assumed as context. */}
            <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60 px-4 py-3 space-y-2">
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-xs font-bold uppercase tracking-wider text-[#8593A8]">
                  Client
                </span>
                <span class="text-sm font-semibold text-[#14233A] dark:text-gray-100 text-right break-all">
                  {props.pending?.clientLabel}
                </span>
              </div>
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-xs font-bold uppercase tracking-wider text-[#8593A8]">
                  Campaign manager
                </span>
                <span class="text-sm font-semibold text-[#14233A] dark:text-gray-100 text-right break-all">
                  {props.pending?.cmLabel}
                </span>
              </div>
            </div>

            {/* The consequence, named. */}
            <p class="text-sm font-medium text-[#14233A] dark:text-gray-200">
              This changes which clients{" "}
              <span class="font-bold">{props.pending?.cmLabel}</span> can see.
            </p>

            <Show when={!isAssign()}>
              <p class="text-xs text-[#54657E] dark:text-gray-400">
                This is a revoke, not a deletion — the history is kept, and
                assigning the same pair again later reactivates it.
              </p>
            </Show>

            <div>
              <label class="block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5">
                Note{" "}
                <span class="font-normal text-[#8593A8]">(optional)</span>
              </label>
              <textarea
                rows="3"
                value={notes()}
                onInput={(e) => setNotes(e.target.value)}
                disabled={props.busy}
                placeholder={
                  isAssign()
                    ? "Why is this client being assigned?"
                    : "Why is this assignment being removed?"
                }
                class={`${FIELD} resize-none`}
              />
              <p class="text-xs text-[#8593A8] mt-1">
                Saved to the assignment history.
              </p>
            </div>

            {/* Rejections land here rather than throwing the operator back to
                the list — the pair is still on screen, so the message is
                actionable where it is read. Shown verbatim. */}
            <Show when={props.error}>
              <p
                role="alert"
                class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
              >
                {props.error}
              </p>
            </Show>
          </div>

          <div class="px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 flex gap-3">
            <button
              type="button"
              onClick={() => props.onClose?.()}
              disabled={props.busy}
              class="flex-1 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1]/60 dark:hover:bg-gray-700 disabled:opacity-40 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={props.busy}
              class={`flex-1 px-4 py-2.5 rounded-lg text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition ${
                isAssign()
                  ? "bg-[#15966A] hover:bg-[#0F7A55]"
                  : "bg-[#AC2334] hover:bg-[#93192a]"
              }`}
            >
              {props.busy
                ? isAssign()
                  ? "Assigning…"
                  : "Removing…"
                : isAssign()
                  ? "Assign client"
                  : "Remove assignment"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
