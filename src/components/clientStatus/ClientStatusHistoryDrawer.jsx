import { createResource, For, Show } from "solid-js";
import {
  fetchClientStatusHistory,
  statusLabel,
  STATUS_BADGE,
  STATUS_DOT,
  normaliseStatus,
  changedByLabel,
} from "../../services/clientStatus";

// ─── Status history drawer ────────────────────────────────────────────────────
// Every change this client's engagement status has been through, newest first:
// from → to, the reason, who did it and when. The reason is the point — the
// board only ever shows the latest one, and the argument for a hold made three
// months ago is often the thing you actually need.
//
// Props: open, clientId (Client PK), clientLabel, onClose()

const fullStamp = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function Pill(props) {
  const k = () => normaliseStatus(props.status);
  return (
    <span
      class={`inline-flex items-center gap-1.5 px-2 py-[2px] rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_BADGE[k()]}`}
    >
      <span class={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[k()]}`} />
      {statusLabel(k())}
    </span>
  );
}

export default function ClientStatusHistoryDrawer(props) {
  // Keyed on the client so re-opening for a different client refetches, and
  // closing releases the request rather than holding a stale list.
  const [history] = createResource(
    () => (props.open && props.clientId ? String(props.clientId) : null),
    (id) => fetchClientStatusHistory(id),
  );

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex">
        <div
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          onClick={() => props.onClose?.()}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Status history"
          class="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col"
        >
          <div class="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div class="min-w-0">
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white truncate">
                Status history
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 truncate">
                {props.clientLabel || "—"}
              </p>
            </div>
            <button
              onClick={() => props.onClose?.()}
              aria-label="Close"
              class="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            >
              ✕
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-6 py-5">
            <Show
              when={!history.loading}
              fallback={
                <p class="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
              }
            >
              <Show
                when={!history.error}
                fallback={
                  <p role="alert" class="text-sm font-medium text-[#AC2334]">
                    {history.error?.message || "Could not load the history."}
                  </p>
                }
              >
                <Show
                  when={(history() ?? []).length > 0}
                  fallback={
                    <div class="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 py-10 text-center">
                      <p class="text-sm text-gray-500 dark:text-gray-400">
                        No status changes recorded yet.
                      </p>
                    </div>
                  }
                >
                  <ol class="relative border-l border-gray-200 dark:border-gray-700 ml-1.5">
                    <For each={history()}>
                      {(h) => (
                        <li class="ml-5 pb-6 last:pb-0">
                          <span class="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-[#AC2334] ring-4 ring-white dark:ring-gray-900" />
                          <div class="flex flex-wrap items-center gap-2">
                            <Show when={h.from_status} fallback={
                              <span class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                                First set
                              </span>
                            }>
                              <Pill status={h.from_status} />
                              <span class="text-gray-400" aria-hidden="true">→</span>
                            </Show>
                            <Pill status={h.to_status} />
                          </div>
                          <p class="mt-2 text-sm text-gray-700 dark:text-gray-200">
                            {h.reason || "—"}
                          </p>
                          <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                            {changedByLabel(h.changed_by_email)} ·{" "}
                            {fullStamp(h.changed_at)}
                          </p>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
