import { Show } from "solid-js";

// ─── Assignment screen formatting ─────────────────────────────────────────────
// Shared by the two tabs, the confirm modal and the history drawer, so a tier or
// an action reads identically wherever it appears.

export const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 " +
  "bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-100 " +
  "placeholder:text-[#8593A8] " +
  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none " +
  "disabled:opacity-50 transition";

export const CARD =
  "bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 " +
  "rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]";

// "tier_1" → "Tier 1". Unknown values pass through rather than becoming "—":
// showing what the server sent beats inventing a label for it.
export const tierLabel = (tier) => {
  if (!tier) return null;
  const t = String(tier);
  if (t === "tier_1") return "Tier 1";
  if (t === "tier_2") return "Tier 2";
  return t.replace(/_/g, " ");
};

// ─── Badges ───────────────────────────────────────────────────────────────────
// One pill shape for every label on this screen — a hairline ring instead of a
// heavy fill, so a row carrying two or three of them still reads as one line of
// text. The ring is what separates a pale pill from the card behind it; without
// it the light tints wash out on white.

const PILL =
  "inline-flex items-center gap-1 px-2 py-[3px] rounded-full ring-1 ring-inset " +
  "text-[10px] font-bold uppercase tracking-[.07em] leading-none whitespace-nowrap";

function Dot(props) {
  return (
    <span
      aria-hidden="true"
      class={`w-1.5 h-1.5 rounded-full flex-none ${props.class ?? "bg-current opacity-60"}`}
    />
  );
}

// Every badge is the same object — tinted fill, matching ring, saturated dot —
// and only the HUE changes, so the operator learns one shape and reads the
// colour. Tier 1 is indigo (a lead), tier 2 teal (a report): distinct enough to
// tell apart mid-scroll, and neither is the amber that means "inactive" or the
// brand red that means "client type".
export function TierBadge(props) {
  const lead = () => props.tier === "tier_1";
  return (
    <Show when={tierLabel(props.tier)}>
      <span
        class={`${PILL} ${
          lead()
            ? "bg-[#EDF0FB] text-[#3A4BA0] ring-[#3A4BA0]/20 dark:bg-indigo-900/30 dark:text-indigo-200 dark:ring-indigo-400/25"
            : "bg-[#E6F4F6] text-[#136B78] ring-[#136B78]/20 dark:bg-teal-900/30 dark:text-teal-200 dark:ring-teal-400/25"
        }`}
      >
        <Dot class={lead() ? "bg-[#4C5FD7]" : "bg-[#1B93A5]"} />
        {tierLabel(props.tier)}
      </span>
    </Show>
  );
}

// Client type is a CATEGORY, not a rank, so each value gets its own hue instead
// of one shared brand red — a column of mixed CPL/HYBRID rows is then sorted by
// eye without reading a word. Known types are pinned so they never drift between
// releases; anything else the server sends is coloured deterministically from
// the leftovers rather than falling back to a single grey.
//
// The hues deliberately avoid indigo/teal (tier), amber (inactive) and brand red
// (destructive actions) — nothing on this screen should look like two things.
const TYPE_TINTS = [
  {
    pill: "bg-[#F3EEFB] text-[#5B3E9B] ring-[#5B3E9B]/20 dark:bg-purple-900/30 dark:text-purple-200 dark:ring-purple-400/25",
    dot: "bg-[#7A57C7]",
  },
  {
    pill: "bg-[#E7F5EE] text-[#0F7A55] ring-[#0F7A55]/20 dark:bg-green-900/30 dark:text-green-200 dark:ring-green-400/25",
    dot: "bg-[#15966A]",
  },
  {
    pill: "bg-[#E8EEF8] text-[#2B4A80] ring-[#2B4A80]/20 dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-400/25",
    dot: "bg-[#3E6BB5]",
  },
  {
    pill: "bg-[#FCEFE6] text-[#9A5312] ring-[#9A5312]/20 dark:bg-orange-900/30 dark:text-orange-200 dark:ring-orange-400/25",
    dot: "bg-[#C97220]",
  },
  {
    pill: "bg-[#FAECF4] text-[#9B3E7A] ring-[#9B3E7A]/20 dark:bg-pink-900/30 dark:text-pink-200 dark:ring-pink-400/25",
    dot: "bg-[#C05798]",
  },
  {
    pill: "bg-[#EDF3F1] text-[#3F6156] ring-[#3F6156]/20 dark:bg-gray-700/60 dark:text-gray-200 dark:ring-gray-500/30",
    dot: "bg-[#5D8375]",
  },
];

const PINNED_TYPES = { cpl: 0, hybrid: 1, cpm: 2, retainer: 3, cps: 4 };

const typeTint = (type) => {
  const key = String(type ?? "").trim().toLowerCase();
  if (key in PINNED_TYPES) return TYPE_TINTS[PINNED_TYPES[key]];
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TYPE_TINTS[h % TYPE_TINTS.length];
};

export function ClientTypeBadge(props) {
  const tint = () => typeTint(props.type);
  return (
    <Show when={props.type}>
      <span class={`${PILL} flex-none ${tint().pill}`}>
        <Dot class={tint().dot} />
        {String(props.type)}
      </span>
    </Show>
  );
}

// An inactive CM or client still holds assignments — it has to stay visible and
// labelled, not silently dropped, or the operator can't reason about who sees what.
// The dot is what makes it scannable in a column of otherwise-active rows.
export function InactiveBadge(props) {
  return (
    <Show when={props.isActive === false}>
      <span class={`${PILL} bg-[#FDF6E7] text-[#8A6410] ring-[#8A6410]/20 dark:bg-yellow-900/30 dark:text-yellow-200 dark:ring-yellow-500/25`}>
        <Dot class="bg-[#C08A12]" />
        inactive
      </span>
    </Show>
  );
}

// A count chip. Zero is shown, not hidden — "0 clients" is exactly the state an
// operator opening this screen is looking for — but it is drawn flat and grey so
// an empty manager doesn't shout the way a populated one does.
export function CountChip(props) {
  const empty = () => !Number(props.count);
  return (
    <span
      class={`flex-none inline-flex items-baseline gap-1 px-2 py-[3px] rounded-full ring-1 ring-inset text-[11px] leading-none whitespace-nowrap ${
        empty()
          ? "bg-transparent text-[#8593A8] ring-[#E2E8F1] dark:text-gray-400 dark:ring-gray-600"
          : "bg-[#F0F4F9] text-[#33465F] ring-[#DCE4EF] dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600"
      }`}
    >
      <span class="font-extrabold tabular-nums">{props.count ?? 0}</span>
      <span class="font-semibold">{props.label}</span>
    </span>
  );
}

// ─── Roster avatar ────────────────────────────────────────────────────────────
// The app-wide avatar, not a local one: a manager must look the same here as on
// every other screen that shows people. Rows are scanned rather than read, and an
// identity mark the eye can land on makes a 21-row list navigable in a way a
// column of near-identical @-addresses never is.
//
// It is named off the LABEL (email for a manager, nomen for a client), which is
// what keys the shared component's colour — so the same person keeps the same
// colour across both tabs and the detail pane.
export { default as Avatar } from "../../components/common/Avatar";

// "assigned" is a grant of visibility, "unassigned" a revoke — they must never
// read the same colour in a log the operator is scanning for a specific change.
export function ActionBadge(props) {
  const assigned = () => String(props.action) === "assigned";
  return (
    <span
      class={`${PILL} ${
        assigned()
          ? "bg-[#E9F7F1] text-[#0F7A55] ring-[#0F7A55]/20 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-500/25"
          : "bg-[#FDF6E7] text-[#8A6410] ring-[#8A6410]/20 dark:bg-yellow-900/30 dark:text-yellow-200 dark:ring-yellow-500/25"
      }`}
    >
      <Dot class={assigned() ? "bg-[#0F7A55]" : "bg-[#C08A12]"} />
      {props.action ?? "—"}
    </span>
  );
}

// "12 Mar 2026, 4:05 pm". Unparseable → the raw string (better to show what the
// server sent than to swallow it).
export const fmtDateTime = (v) => {
  if (v == null || v === "") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// The label a manager is known by. Falls back to the email, then the id — a row
// with no display name must still be identifiable.
export const cmLabel = (m) => m?.email || m?.name || (m?.cmId ? `CM #${m.cmId}` : "—");

export const clientLabel = (c) =>
  c?.nomen || c?.email || (c?.clientId ? `Client #${c.clientId}` : "—");
