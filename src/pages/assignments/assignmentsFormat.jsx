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

export function TierBadge(props) {
  return (
    <Show when={tierLabel(props.tier)}>
      <span
        class={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
          props.tier === "tier_1"
            ? "bg-[#14233A]/10 text-[#14233A] dark:bg-white/10 dark:text-gray-200"
            : "bg-[#E2E8F1] text-[#54657E] dark:bg-gray-700 dark:text-gray-300"
        }`}
      >
        {tierLabel(props.tier)}
      </span>
    </Show>
  );
}

export function ClientTypeBadge(props) {
  return (
    <Show when={props.type}>
      <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#FBEEF0] text-[#AC2334] dark:bg-[#AC2334]/20 dark:text-red-300">
        {String(props.type)}
      </span>
    </Show>
  );
}

// An inactive CM or client still holds assignments — it has to stay visible and
// labelled, not silently dropped, or the operator can't reason about who sees what.
export function InactiveBadge(props) {
  return (
    <Show when={props.isActive === false}>
      <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#FDF6E7] text-[#8A6410] dark:bg-yellow-900/30 dark:text-yellow-200">
        inactive
      </span>
    </Show>
  );
}

// A count chip. Zero is shown, not hidden — "0 clients" is exactly the state an
// operator opening this screen is looking for.
export function CountChip(props) {
  return (
    <span class="flex-none px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#F0F4F9] text-[#54657E] dark:bg-gray-700 dark:text-gray-300">
      {props.count ?? 0} {props.label}
    </span>
  );
}

// "assigned" is a grant of visibility, "unassigned" a revoke — they must never
// read the same colour in a log the operator is scanning for a specific change.
export function ActionBadge(props) {
  const assigned = () => String(props.action) === "assigned";
  return (
    <span
      class={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
        assigned()
          ? "bg-[#E9F7F1] text-[#0F7A55] dark:bg-green-900/30 dark:text-green-300"
          : "bg-[#FDF6E7] text-[#8A6410] dark:bg-yellow-900/30 dark:text-yellow-200"
      }`}
    >
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
