// ─── "Dead clients" toggle ────────────────────────────────────────────────────
// One look on every list that hides dead clients by default. ON swaps the list
// to dead clients ONLY (?dead=only) — it does not add them to the live ones,
// which is why the label says "Dead clients" and the ON state is unmistakable.
export const DEAD_TOGGLE_TITLE =
  "Dead = status Dead with no live campaign, or Completed with no spend and no leads for 20 days and no live campaign. Hidden by default; turn this on to see ONLY dead clients.";

export default function DeadToggle(props) {
  return (
    <button
      type="button"
      onClick={() => props.onChange(!props.value)}
      aria-pressed={props.value}
      title={DEAD_TOGGLE_TITLE}
      disabled={props.disabled}
      class={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap disabled:opacity-50 ${
        props.value
          ? "bg-[#3B3F47] text-white border-[#3B3F47] dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200"
          : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#3B3F47]/50"
      } ${props.class ?? ""}`}
    >
      <span
        class={`h-1.5 w-1.5 rounded-full ${
          props.value ? "bg-current" : "bg-gray-300 dark:bg-gray-600"
        }`}
        aria-hidden="true"
      />
      {props.value ? "Showing dead clients only" : "Dead clients"}
    </button>
  );
}
