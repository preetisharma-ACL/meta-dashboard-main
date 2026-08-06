import { Show } from "solid-js";

// ─── Lead replacement breakdown ───────────────────────────────────────────────
// The one place the Generated → Replaced → Billable progression is drawn, so it
// reads identically on the dashboard, the billing overview and the daily report.
//
// It is a PROGRESSION, not three unrelated stats: what Meta delivered, what we
// credited back, and what the client actually pays for. The arrows between the
// columns carry that meaning, and "Replaced" is the only one tinted (crimson —
// it's the deduction) so the eye lands on the change rather than the totals.
//
// AAJneeti brand: navy #14233A · crimson #AC2334 · line #E2E8F1 · muted #54657E
// · faint #8593A8 · green #15966A.

const n = (v) => (v == null ? "—" : Number(v).toLocaleString("en-IN"));

const Arrow = () => (
  <span
    aria-hidden="true"
    class="hidden sm:flex items-center justify-center text-[#C8D2E0] dark:text-gray-600 select-none px-1"
  >
    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5-5 5M6 7l5 5-5 5" />
    </svg>
  </span>
);

function Leg(props) {
  return (
    <div class="min-w-0 flex-1 py-1">
      <p
        class={`text-[11px] font-bold uppercase tracking-wider ${
          props.tone === "credit"
            ? "text-[#AC2334] dark:text-red-400"
            : "text-[#8593A8] dark:text-gray-400"
        }`}
      >
        {props.label}
      </p>
      <p
        class={`font-bold tabular-nums mt-1 ${props.size || "text-2xl"} ${
          props.tone === "credit"
            ? "text-[#AC2334] dark:text-red-400"
            : props.tone === "final"
              ? "text-[#14233A] dark:text-white"
              : "text-[#54657E] dark:text-gray-300"
        }`}
      >
        {props.tone === "credit" && props.value > 0 ? "−" : ""}
        {n(props.value)}
      </p>
      <Show when={props.sub}>
        <p class="text-xs text-[#8593A8] dark:text-gray-500 mt-0.5">{props.sub}</p>
      </Show>
    </div>
  );
}

// Props:
//   breakdown  { generated, replaced, billable, billedAmount, adSpend } | null
//   title?     section heading (omit for a bare strip)
//   note?      trailing caption under the strip
//   compact?   smaller figures, for use inside an existing card
//   class?     extra classes on the wrapper
export default function LeadBreakdown(props) {
  const b = () => props.breakdown || {};
  const size = () => (props.compact ? "text-xl" : "text-2xl");

  return (
    <div
      class={`rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800/70 ${
        props.compact ? "p-4" : "p-5"
      } ${props.class || ""}`}
    >
      <Show when={props.title}>
        <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            {props.title}
          </p>
          <Show when={b().replaced > 0}>
            <span class="inline-flex items-center rounded-full bg-[#FBEEF0] dark:bg-red-900/30 px-2.5 py-0.5 text-[11px] font-bold text-[#AC2334] dark:text-red-300">
              {n(b().replaced)} replaced
            </span>
          </Show>
        </div>
      </Show>

      <div class="flex flex-col sm:flex-row sm:items-start divide-y sm:divide-y-0 sm:divide-x divide-[#E2E8F1] dark:divide-gray-700">
        <div class="sm:pr-4 flex-1 min-w-0">
          <Leg label="Leads Generated" value={b().generated} size={size()} />
        </div>
        <Arrow />
        <div class="sm:px-4 flex-1 min-w-0">
          <Leg
            label="Replaced"
            value={b().replaced}
            tone="credit"
            size={size()}
            sub={
              b().billedAmount != null && b().adSpend != null
                ? `₹${Math.round(Math.max(0, b().adSpend - b().billedAmount)).toLocaleString("en-IN")} credited`
                : null
            }
          />
        </div>
        <Arrow />
        <div class="sm:pl-4 flex-1 min-w-0">
          <Leg
            label="Billable"
            value={b().billable}
            tone="final"
            size={size()}
            sub="charged to the client"
          />
        </div>
      </div>

      <Show when={props.note}>
        <p class="mt-3 text-xs text-[#54657E] dark:text-gray-400">{props.note}</p>
      </Show>
    </div>
  );
}
