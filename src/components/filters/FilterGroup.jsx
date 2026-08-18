import { Show } from "solid-js";

// ─── Filter group ─────────────────────────────────────────────────────────────
// One titled panel per filter AXIS, headed like a settings row: tinted icon
// tile, a real title, and a caption that says what the axis actually is.
//
// The caption is doing the job a tooltip used to. Screens here routinely carry
// four filters that describe four DIFFERENT facts about a client — how they're
// billed (client_type), the label somebody put on them (engagement_status), what
// their campaigns are really doing (campaign_activity) and what they're worth to
// us (value_tier). Rendering those as four identical grey uppercase words gave
// the reader no way to tell them apart without hovering each one, which is
// exactly the confusion the separate axes exist to prevent. So each gets its own
// accent, its own glyph and a line of prose.
//
// The label sits ABOVE its pills, never beside them: an inline label makes every
// group a different width, and a row of differently-sized groups can't line up
// into columns.
//
// Props
//   label     the axis name
//   caption   one short line saying what it is (and what it isn't)
//   tone      which accent the icon tile wears — see GROUP_TONE
//   icon      a <GroupIcon> glyph
//   internal  show the INTERNAL tag (value tier only — a promise to the reader,
//             not decoration)
//   on        this axis is currently narrowing the list; the card lifts and its
//             border darkens so an active filter is visible without reading
//             every pill

// One accent per axis, never shared.
export const GROUP_TONE = {
  type: "bg-teal-50 text-teal-600 ring-teal-100 dark:bg-teal-900/25 dark:text-teal-300 dark:ring-teal-800/50",
  engagement:
    "bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/50",
  activity:
    "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600/50",
  tier: "bg-[#14233A]/[0.07] text-[#14233A] ring-[#14233A]/10 dark:bg-[#E9AE5C]/15 dark:text-[#E9AE5C] dark:ring-[#E9AE5C]/25",
  neutral:
    "bg-gray-100 text-gray-500 ring-gray-200 dark:bg-gray-700/40 dark:text-gray-300 dark:ring-gray-600/50",
};

// 15px stroked glyphs on the shared 24-unit viewBox.
export const GroupIcon = (props) => (
  <svg
    class="w-[15px] h-[15px]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {props.children}
  </svg>
);

// The four glyphs the app's client-filter axes use, so a given concept wears the
// same mark wherever it's filtered. The tier diamond is the one the Value Tier
// board wears in its own masthead.
export const AXIS_ICON = {
  type: (
    <GroupIcon>
      <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </GroupIcon>
  ),
  engagement: (
    <GroupIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.4 2.4 2.4 4.6-5.2" />
    </GroupIcon>
  ),
  activity: (
    <GroupIcon>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </GroupIcon>
  ),
  tier: (
    <GroupIcon>
      <path d="M12 3l4 5-4 13-4-13 4-5zm-4 5h8" />
    </GroupIcon>
  ),
};

export default function FilterGroup(props) {
  return (
    <div
      class={`min-w-0 rounded-2xl border bg-white dark:bg-gray-900 px-4 py-3.5 transition-all duration-200 ${
        props.on
          ? "border-[#14233A]/25 dark:border-gray-500 shadow-[0_4px_14px_-6px_rgba(20,35,58,.22)]"
          : "border-gray-200/80 dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05)] hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
      <div class="flex items-start gap-2.5 mb-3">
        <span
          class={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg ring-1 ${
            GROUP_TONE[props.tone] ?? GROUP_TONE.neutral
          }`}
          aria-hidden="true"
        >
          {props.icon}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-[13px] font-bold leading-tight tracking-[-0.01em] text-gray-900 dark:text-gray-100">
              {props.label}
            </h3>
            <Show when={props.internal}>
              <span class="inline-flex items-center gap-1 rounded-full bg-[#14233A]/[0.07] dark:bg-[#E9AE5C]/15 px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-[#14233A]/70 dark:text-[#E9AE5C]">
                <svg
                  class="w-2.5 h-2.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                Internal
              </span>
            </Show>
          </div>
          <Show when={props.caption}>
            {/* Titled as well as printed: the line is truncated to keep the four
                headers the same height, so a caption that doesn't fit is still
                readable on hover rather than silently clipped. */}
            <p
              title={props.caption}
              class="mt-0.5 text-[11px] leading-tight text-gray-400 dark:text-gray-500 truncate"
            >
              {props.caption}
            </p>
          </Show>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5">{props.children}</div>
    </div>
  );
}
