import { createResource, For, Show } from "solid-js";
import { fetchCmProfileHistory } from "../../services/cmProfiles";
import { errorMessage } from "../../utils/apiErrors";
import { fieldLabel, historyValue, fmtDateTime } from "./cmProfilesFormat";

// ─── Profile history ──────────────────────────────────────────────────────────
// Every tier, team-lead and active change on one profile, newest first.
//
// This is the only record of WHEN a manager's clients moved between dashboards.
// The rest of the product shows the current state — a lead's dashboard simply
// contains the clients it contains — so a question like "why did these sixteen
// clients appear under muskan in March?" is answerable here and nowhere else.
// That is why clients_affected is given the same weight as the values: a change
// that moved nothing and a change that moved sixteen clients read differently.
//
// Props: profileId, label, resolveLead(id) → email, onClose()

export default function ProfileHistoryDrawer(props) {
  const [entries] = createResource(
    () => props.profileId ?? null,
    async (id) => {
      const rows = await fetchCmProfileHistory(id);
      // The endpoint's own order is trusted when it already descends; this sort
      // is defensive, not corrective.
      return [...rows].sort((a, b) => {
        const ta = a.at ? new Date(a.at).getTime() : 0;
        const tb = b.at ? new Date(b.at).getTime() : 0;
        return tb - ta;
      });
    },
  );

  const resolve = (id) => props.resolveLead?.(id) ?? null;

  return (
    <Show when={props.profileId != null}>
      <div class="fixed inset-0 z-50 flex">
        <div
          onClick={() => props.onClose?.()}
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label="Profile history"
          class="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white dark:bg-gray-900
                 border-l border-[#E2E8F1] dark:border-gray-700 shadow-2xl flex flex-col"
        >
          <div class="flex items-start justify-between px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
            <div class="min-w-0">
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
                Profile history
              </h2>
              <p class="text-sm text-[#54657E] dark:text-gray-400 break-all">
                {props.label}
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
                    Nothing has changed on this profile yet.
                  </p>
                }
              >
                <ol class="space-y-3">
                  <For each={entries()}>
                    {(e) => (
                      <li class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 px-4 py-3">
                        <div class="flex items-center justify-between gap-3 flex-wrap">
                          <span class="text-[10px] font-bold uppercase tracking-[.07em] px-2 py-[3px] rounded-full ring-1 ring-inset bg-[#F0F4F9] text-[#33465F] ring-[#DCE4EF] dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600">
                            {fieldLabel(e.field)}
                          </span>
                          <span class="text-xs text-[#8593A8]">
                            {fmtDateTime(e.at)}
                          </span>
                        </div>

                        {/* from → to, both shown. A log that records only the
                            new value can't answer "what was it before?", which
                            is most of why anyone opens this. */}
                        <p class="mt-2 text-sm text-[#14233A] dark:text-gray-100 break-all">
                          <span class="text-[#8593A8] line-through decoration-[#C9D3E0]">
                            {historyValue(e.field, e.fromValue, resolve)}
                          </span>
                          <span aria-hidden="true" class="mx-2 text-[#8593A8]">
                            →
                          </span>
                          <span class="font-semibold">
                            {historyValue(e.field, e.toValue, resolve)}
                          </span>
                        </p>

                        {/* The size of the change, in the only unit that
                            matters: how many clients changed dashboards. */}
                        <Show when={e.clientsAffected != null}>
                          <p
                            class={`mt-1.5 text-xs font-semibold ${
                              e.clientsAffected > 0
                                ? "text-[#8A6410] dark:text-yellow-300"
                                : "text-[#8593A8]"
                            }`}
                          >
                            {e.clientsAffected > 0
                              ? `${e.clientsAffected} client${e.clientsAffected === 1 ? "" : "s"} moved`
                              : "No clients moved"}
                          </p>
                        </Show>

                        <Show when={e.affectedClients.length}>
                          <p class="mt-1 text-xs text-[#54657E] dark:text-gray-400 break-words">
                            {e.affectedClients
                              .map((c) => c.nomen ?? c.email ?? `#${c.clientId}`)
                              .join(", ")}
                          </p>
                        </Show>

                        <p class="mt-1.5 text-xs text-[#54657E] dark:text-gray-400 break-all">
                          by {e.changedBy ?? "—"}
                        </p>

                        <Show when={e.reason}>
                          <p class="mt-2 pt-2 border-t border-[#E2E8F1] dark:border-gray-700 text-sm text-[#54657E] dark:text-gray-300 whitespace-pre-wrap">
                            {e.reason}
                          </p>
                        </Show>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            </Show>
          </div>

          <div class="px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
            <p class="text-xs text-[#8593A8]">
              A lead change applies to all history, so a client's whole record
              moves with it — this log is where the date it happened survives.
            </p>
          </div>
        </div>
      </div>
    </Show>
  );
}
