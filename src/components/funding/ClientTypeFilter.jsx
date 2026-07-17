import { For, Show } from "solid-js";

// ─────────────────────────────────────────────────────────────────────────────
// Client-type filter — shared by Account Funding and Funds Added by Date.
// Both pages send the same ?client_types=cpl,hybrid param to their respective
// endpoints (same parser, same default, same values server-side), so the chips,
// the default and the helper text must stay identical across the two.
//
// Default is CPL + Hybrid (the agency-funded view — retainer accounts are
// client-funded, so the agency never loads them).
//
// Props:
//   value    — array of selected keys (reactive; pass clientTypes())
//   onToggle — (key) => void, called when a chip is clicked
//   caveat   — optional string; renders an info icon with this text as its
//              tooltip after the helper text (Funds Added uses it to explain
//              that wallet-balance deltas can't be split by client type)
//   class    — optional extra classes on the wrapper
// ─────────────────────────────────────────────────────────────────────────────

export const CLIENT_TYPES = [
  { key: "cpl", label: "CPL" },
  { key: "hybrid", label: "Hybrid" },
  { key: "retainer", label: "Retainer" },
];
export const DEFAULT_CLIENT_TYPES = ["cpl", "hybrid"];

// Toggle a key within a selection; never allow an empty selection (an empty
// client_types would make the backend fall back to its default, which would
// silently disagree with the chips on screen).
export const toggleClientTypeIn = (prev, key) => {
  const next = prev.includes(key)
    ? prev.filter((k) => k !== key)
    : [...prev, key];
  return next.length ? next : prev;
};

export default function ClientTypeFilter(props) {
  return (
    <div class={`flex flex-wrap items-center gap-2 ${props.class ?? "mb-5"}`}>
      <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mr-1">
        Client type
      </span>
      {/* Keep CPL/Hybrid/Retainer together on a single line */}
      <div class="flex items-center gap-2">
        <For each={CLIENT_TYPES}>
          {(t) => {
            const on = () => (props.value ?? []).includes(t.key);
            return (
              <button
                onClick={() => props.onToggle?.(t.key)}
                aria-pressed={on()}
                class={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                  on()
                    ? "bg-[#14233A] text-white border-[#14233A]"
                    : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
                }`}
              >
                <svg
                  class="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <Show
                    when={on()}
                    fallback={<circle cx="12" cy="12" r="9" stroke-width="1.6" />}
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </Show>
                </svg>
                {t.label}
              </button>
            );
          }}
        </For>
      </div>
      <span class="text-xs text-[#8593A8] dark:text-gray-500 ml-1">
        Retainer accounts are client-funded; excluded by default.
      </span>
      <Show when={props.caveat}>
        <span
          title={props.caveat}
          tabindex="0"
          aria-label={props.caveat}
          class="inline-flex items-center justify-center w-4 h-4 flex-none rounded-full text-[#8593A8] dark:text-gray-500 hover:text-[#3E6FB0] dark:hover:text-blue-300 cursor-help focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25"
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </span>
      </Show>
    </div>
  );
}
