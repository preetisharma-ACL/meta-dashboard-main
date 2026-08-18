import { Show } from "solid-js";

// ─── Filter pill ──────────────────────────────────────────────────────────────
// One option inside a <FilterGroup>. Idle pills are a light fill with an inset
// hairline; the chosen one is solid navy. That's the whole system — the pill
// never borrows its axis's accent colour, because then "selected" and "which
// axis" would be saying the same thing in the same channel.
//
// Marks (all optional, and a pill wears at most one):
//   dot        a filled disc — client type, engagement
//   dotHollow  an empty ring — activity: paused
//   warn       an amber triangle — activity: mismatch
//   check      ✓ when selected, ○ when not — for MULTI-SELECT axes, where the
//              reader needs to see that several options can be on at once
//   dotActive  replacement colour for `dot` on the selected pill; a near-black
//              dot would vanish into the navy fill without it
//
// `count` is optional: surfaces that can tally their buckets pass one, surfaces
// that can't simply omit it rather than showing a blank slot.
export default function FilterPill(props) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      title={props.title}
      class={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold ring-1 ring-inset transition-colors ${
        props.active
          ? "bg-[#14233A] text-white ring-[#14233A] shadow-[0_1px_2px_rgba(20,35,58,.35)] dark:bg-gray-600 dark:ring-gray-600"
          : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 ring-gray-200 dark:ring-gray-700 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white hover:ring-gray-300 dark:hover:ring-gray-600"
      }`}
    >
      <Show when={props.check}>
        <svg
          class="w-3.5 h-3.5 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <Show
            when={props.active}
            fallback={<circle cx="12" cy="12" r="8" stroke-width="1.6" />}
          >
            <path d="M20 6 9 17l-5-5" />
          </Show>
        </svg>
      </Show>

      <Show when={props.warn}>
        <svg
          class={`w-3.5 h-3.5 ${props.active ? "text-amber-300" : "text-[#B07A14] dark:text-amber-400"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      </Show>

      <Show when={props.dotHollow}>
        <span
          class={`w-[7px] h-[7px] rounded-full border ${
            props.active
              ? "border-white/80"
              : "border-gray-400 dark:border-gray-500"
          }`}
        />
      </Show>

      <Show when={props.dot}>
        <span
          class={`w-[7px] h-[7px] rounded-full ${
            (props.active && props.dotActive) || props.dot
          }`}
        />
      </Show>

      {props.label}

      <Show when={props.count != null}>
        <span
          class={`text-[11px] font-bold tabular-nums ${
            props.active ? "text-white/60" : "text-gray-400 dark:text-gray-500"
          }`}
        >
          {props.count}
        </span>
      </Show>
    </button>
  );
}
