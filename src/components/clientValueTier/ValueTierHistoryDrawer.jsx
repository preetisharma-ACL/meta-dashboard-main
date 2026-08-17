import { createResource, For, Show } from "solid-js";
import {
  fetchClientValueTierHistory,
  valueTierLabel,
  normaliseValueTier,
  VALUE_TIER_BADGE,
  VALUE_TIER_DIAMOND,
  VALUE_TIER_UNSET,
} from "../../services/valueTier";
import { canSeeValueTier } from "../../stores/currentUser";

// ─── Value tier history drawer ────────────────────────────────────────────────
// Every reclassification this client has been through, newest first: from → to,
// the reason if one was given, who did it and when. Same shape as the engagement
// history drawer next door, with two differences that follow the endpoints:
//   • the reason is OPTIONAL here, so entries legitimately have none — those read
//     "No reason given" rather than an empty line pretending to be a quote;
//   • the fields are from_tier / to_tier, not from_status / to_status.
//
// ⚠ INTERNAL. Gated on canSeeValueTier() like the control, so it cannot open for
// a role that should never learn a client's tier.
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

const changedByLabel = (email) => {
  const local = String(email ?? "").split("@")[0];
  if (!local) return "—";
  return local.charAt(0).toUpperCase() + local.slice(1);
};

function TierPill(props) {
  const k = () => normaliseValueTier(props.tier);
  return (
    <Show
      when={k() !== VALUE_TIER_UNSET}
      fallback={
        <span class="inline-flex items-center px-2 py-[2px] rounded-[4px] border border-dashed border-gray-300 dark:border-gray-600 text-[10px] font-bold uppercase tracking-[0.06em] text-gray-400">
          Cleared
        </span>
      }
    >
      <span
        class={`inline-flex items-center gap-1 px-2 py-[2px] rounded-[4px] text-[10px] font-bold uppercase tracking-[0.06em] whitespace-nowrap ${VALUE_TIER_BADGE[k()]}`}
      >
        <span class={VALUE_TIER_DIAMOND[k()]} aria-hidden="true">
          ◆
        </span>
        {valueTierLabel(k())}
      </span>
    </Show>
  );
}

export default function ValueTierHistoryDrawer(props) {
  // Keyed on the client so re-opening for a different one refetches, and closing
  // releases the request rather than holding a stale list. The role gate is part
  // of the key: a role that may not see tiers never issues the call.
  const [history] = createResource(
    () =>
      props.open && props.clientId && canSeeValueTier()
        ? String(props.clientId)
        : null,
    (id) => fetchClientValueTierHistory(id),
  );

  return (
    <Show when={props.open && canSeeValueTier()}>
      <div class="fixed inset-0 z-50 flex">
        <div
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          onClick={() => props.onClose?.()}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Value tier history"
          class="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col"
        >
          <div class="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div class="min-w-0">
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white truncate">
                Value tier history
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
                        This client hasn't been classified yet.
                      </p>
                    </div>
                  }
                >
                  <ol class="relative border-l border-gray-200 dark:border-gray-700 ml-1.5">
                    <For each={history()}>
                      {(h) => (
                        <li class="ml-5 pb-6 last:pb-0">
                          <span class="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-[#14233A] dark:bg-[#E9AE5C] ring-4 ring-white dark:ring-gray-900" />
                          <div class="flex flex-wrap items-center gap-2">
                            <Show
                              when={h.from_tier}
                              fallback={
                                <span class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                                  First classified
                                </span>
                              }
                            >
                              <TierPill tier={h.from_tier} />
                              <span class="text-gray-400" aria-hidden="true">
                                →
                              </span>
                            </Show>
                            <TierPill tier={h.to_tier} />
                          </div>
                          <p
                            class={`mt-2 text-sm ${
                              h.reason
                                ? "text-gray-700 dark:text-gray-200"
                                : "text-gray-400 dark:text-gray-500 italic"
                            }`}
                          >
                            {h.reason || "No reason given"}
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
