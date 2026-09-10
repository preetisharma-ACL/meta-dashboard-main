import { createResource, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import {
  fetchCampaignOwnershipHistory,
  today,
} from "../../services/campaignReassign";
import { errorMessage } from "../../utils/apiErrors";
import { spanLabel, daysInclusive, plural } from "./ownershipFormat";

// ─── Who owned this campaign, and when ────────────────────────────────────────
// The ownership trail for one campaign. Reading it is information rather than an
// action, so it is open to any campaign manager — a tier-2 who cannot move a
// campaign can still need to know why a month's leads sit on another client's
// ledger, and this is the only place that answers it.
//
// Each row is a SPAN, not an event: the client, the dates it owned the campaign
// between, and the name the campaign carried at the time. The current span is
// open-ended — valid_to is null because it hasn't ended, which is a real state
// and not a missing value, so it gets its own wording.
//
// `notes` carries who did it, when, and the reason they gave. It is shown
// verbatim and never summarised: on a change that moves money between two
// clients, the operator's own sentence is the record.
//
// Props: campaign ({ id, name } | null), onClose()

export default function CampaignOwnershipHistoryDrawer(props) {
  // Keyed on the campaign, so opening a different one refetches and closing
  // drops the request entirely.
  const [entries] = createResource(
    () => (props.campaign ? { ...props.campaign } : null),
    async (c) => await fetchCampaignOwnershipHistory(c.id),
  );

  return (
    // Portalled to the body — the row control that opens this sits in a sticky,
    // z-indexed table cell, which is a stacking context a fixed overlay cannot
    // escape from where it is rendered.
    <Show when={props.campaign}>
      <Portal>
        <div class="fixed inset-0 z-[80] flex">
          <div
            onClick={() => props.onClose?.()}
            class="fixed inset-0 bg-[#14233A]/50 backdrop-blur-[2px]"
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Campaign ownership history"
            class="fixed inset-y-0 right-0 z-[81] w-full max-w-lg bg-white dark:bg-gray-900
                 border-l border-[#E2E8F1] dark:border-gray-700 shadow-2xl flex flex-col"
          >
            <div class="flex items-start justify-between gap-3 px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
              <div class="min-w-0">
                <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
                  Ownership history
                </h2>
                <p
                  class="text-sm text-[#54657E] dark:text-gray-400 break-all line-clamp-2"
                  title={props.campaign?.name}
                >
                  {props.campaign?.name}
                </p>
              </div>
              <button
                onClick={() => props.onClose?.()}
                aria-label="Close"
                class="flex-none w-8 h-8 rounded-full flex items-center justify-center text-[#54657E] hover:bg-[#E2E8F1] dark:hover:bg-gray-700 transition"
              >
                ✕
              </button>
            </div>

            <div class="flex-1 overflow-y-auto px-6 py-5">
              <Show when={entries.loading}>
                <p class="text-sm text-[#8593A8]">Loading history…</p>
              </Show>

              <Show when={entries.error}>
                <p
                  role="alert"
                  class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
                >
                  {errorMessage(entries.error, "Could not load the history.")}
                </p>
              </Show>

              <Show when={!entries.loading && !entries.error}>
                <Show
                  when={entries()?.length}
                  fallback={
                    <p class="text-sm text-[#8593A8]">
                      This campaign has never changed hands.
                    </p>
                  }
                >
                  <ol class="space-y-3">
                    <For each={entries()}>
                      {(e) => {
                        // A span's length is the thing a reconciliation actually
                        // needs — "41 days" answers "how much delivery sat here?"
                        // in a way two dates do not. The open span is measured to
                        // today, which is what "so far" means.
                        const days = () =>
                          daysInclusive(e.validFrom, e.validTo ?? today());
                        return (
                          <li
                            class={`rounded-xl border px-4 py-3 ${
                              e.isCurrent
                                ? "border-[#15966A]/40 bg-[#EEF7F3] dark:bg-green-900/10 dark:border-green-800/60"
                                : "border-[#E2E8F1] dark:border-gray-700"
                            }`}
                          >
                            <div class="flex items-center justify-between gap-3 flex-wrap">
                              <span class="text-sm font-semibold text-[#14233A] dark:text-gray-100 break-all">
                                {e.clientNomenName ??
                                  (e.clientNomenId
                                    ? `Client #${e.clientNomenId}`
                                    : "—")}
                              </span>
                              <Show when={e.isCurrent}>
                                <span class="inline-flex items-center px-2 py-[3px] rounded-full ring-1 ring-inset ring-[#15966A]/40 bg-white dark:bg-transparent text-[10px] font-bold uppercase tracking-[.07em] text-[#15966A]">
                                  Owns it now
                                </span>
                              </Show>
                            </div>

                            <p class="mt-1 text-xs text-[#54657E] dark:text-gray-400">
                              {spanLabel(e)}
                              <Show when={days() != null}>
                                {" · "}
                                {plural(days(), "day", "days")}
                                <Show when={!e.validTo}> so far</Show>
                              </Show>
                            </p>

                            {/* The label the campaign carried during this span.
                              Ownership used to follow the name, so an older row
                              can legitimately show a name nobody recognises —
                              which is exactly what makes it worth keeping. */}
                            <Show
                              when={
                                e.campaignName &&
                                e.campaignName !== props.campaign?.name
                              }
                            >
                              <p class="mt-1.5 text-xs text-[#8593A8] break-all">
                                Named{" "}
                                <span class="font-medium">
                                  {e.campaignName}
                                </span>{" "}
                                at the time
                              </p>
                            </Show>

                            <Show when={e.notes}>
                              <p class="mt-2 pt-2 border-t border-[#E2E8F1] dark:border-gray-700 text-sm text-[#54657E] dark:text-gray-300 whitespace-pre-wrap break-words">
                                {e.notes}
                              </p>
                            </Show>
                          </li>
                        );
                      }}
                    </For>
                  </ol>
                </Show>
              </Show>
            </div>

            <div class="px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
              <p class="text-xs text-[#8593A8]">
                A span's leads and spend sit on that client's ledger for its
                whole length. Ownership moves in whole days — Meta reports one
                row per campaign per day, so a day is never split between two
                owners.
              </p>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
