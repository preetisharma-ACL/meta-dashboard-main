import { createResource, For, Show } from "solid-js";
import { fetchAssignmentAuditLog } from "../../services/cmAssignments";
import { errorMessage } from "../../utils/apiErrors";
import { ActionBadge, fmtDateTime } from "./assignmentsFormat";

// ─── Assignment history ───────────────────────────────────────────────────────
// The audit log for one client OR one campaign manager, whichever the caller
// opened it for. This panel is the reason unassign can be a SOFT revoke: the
// assigned/unassigned pairs stay on the record forever, so "was this manager
// ever able to see this client, and who changed it?" is an answerable question.
//
// Rows are shown newest-first. The endpoint's own order is trusted when it
// already descends; the sort is defensive, not corrective.
//
// Props: target ({ scope:"client"|"cm", id, label } | null), onClose()

export default function AssignmentHistoryDrawer(props) {
  // Keyed on the target, so opening a different client/manager refetches and
  // closing drops the request entirely.
  const [entries] = createResource(
    () => (props.target ? { ...props.target } : null),
    async (t) => {
      const rows = await fetchAssignmentAuditLog(
        t.scope === "client" ? { clientId: t.id } : { cmId: t.id },
      );
      return [...rows].sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
    },
  );

  const isClientScope = () => props.target?.scope === "client";

  return (
    <Show when={props.target}>
      <div class="fixed inset-0 z-50 flex">
        <div
          onClick={() => props.onClose?.()}
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label="Assignment history"
          class="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white dark:bg-gray-900
                 border-l border-[#E2E8F1] dark:border-gray-700 shadow-2xl flex flex-col"
        >
          <div class="flex items-start justify-between px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
            <div class="min-w-0">
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
                Assignment history
              </h2>
              <p class="text-sm text-[#54657E] dark:text-gray-400 break-all">
                {isClientScope() ? "Client" : "Campaign manager"} ·{" "}
                {props.target?.label}
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
                    No assignment changes recorded yet.
                  </p>
                }
              >
                <ol class="space-y-3">
                  <For each={entries()}>
                    {(e) => (
                      <li class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 px-4 py-3">
                        <div class="flex items-center justify-between gap-3 flex-wrap">
                          <ActionBadge action={e.action} />
                          <span class="text-xs text-[#8593A8]">
                            {fmtDateTime(e.createdAt)}
                          </span>
                        </div>

                        {/* The OTHER side of the pair — the side the drawer
                            isn't already scoped to is the only one that varies
                            row to row, so it leads. */}
                        <p class="mt-2 text-sm font-semibold text-[#14233A] dark:text-gray-100 break-all">
                          {isClientScope()
                            ? (e.cmEmail ??
                              (e.cmId ? `CM #${e.cmId}` : "—"))
                            : (e.clientNomen ??
                              (e.clientId ? `Client #${e.clientId}` : "—"))}
                        </p>

                        <p class="mt-0.5 text-xs text-[#54657E] dark:text-gray-400 break-all">
                          by {e.performedByEmail ?? "—"}
                        </p>

                        <Show when={e.notes}>
                          <p class="mt-2 pt-2 border-t border-[#E2E8F1] dark:border-gray-700 text-sm text-[#54657E] dark:text-gray-300 whitespace-pre-wrap">
                            {e.notes}
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
              Removals are revokes, not deletions — every change stays on this
              record.
            </p>
          </div>
        </div>
      </div>
    </Show>
  );
}
