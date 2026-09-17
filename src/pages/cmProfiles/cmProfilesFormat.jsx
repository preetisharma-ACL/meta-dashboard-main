import { For, Show } from "solid-js";

// ─── CM profile formatting ────────────────────────────────────────────────────
// Shared by the roster, the detail pane, the edit modal and the history drawer,
// so a tier reads identically wherever it appears.
//
// The badges, card/field chrome and date formatter come from the ASSIGNMENTS
// screen rather than being re-cut here: a tier-1 manager has to look the same on
// the screen that sets their tier as on the screen that assigns them clients, or
// the two stop reading as facts about the same person.
export {
  CARD,
  FIELD,
  Avatar,
  TierBadge,
  InactiveBadge,
  CountChip,
  tierLabel,
  fmtDateTime,
  cmLabel,
  clientLabel,
} from "../assignments/assignmentsFormat";

// ─── What a tier actually grants ──────────────────────────────────────────────
// This list is the screen's central claim, so it lives in one place and is shown
// identically in the detail pane and in the promote/demote confirmation. Each
// entry names an ACTION a manager can take in this product, not a capability in
// the abstract — "may set campaign budgets" is checkable against a screen the
// operator has used; "elevated permissions" is not.
export const TIER_1_POWERS = [
  "Pause and resume campaigns",
  "Set campaign budgets",
  "Record payments",
  "Run bulk campaign operations",
  "Reassign campaigns between clients",
];

// ─── Field labels ─────────────────────────────────────────────────────────────
// The history log names fields the way the database does. Rendering `is_active`
// verbatim in a sentence an operator reads is how a log stops being read at all.
export const fieldLabel = (field) => {
  const f = String(field ?? "").trim();
  if (f === "tier") return "Tier";
  if (f === "team_lead" || f === "team_lead_id") return "Team lead";
  if (f === "is_active") return "Active";
  return f ? f.replace(/_/g, " ") : "—";
};

// A history value in the operator's vocabulary. tier values become "Tier 1";
// booleans become active/inactive; a NULL lead becomes "no lead", which is a
// real state on this model (every tier-1 has one) and must not render as "—"
// alongside genuinely missing data. Anything else is shown exactly as sent.
export const historyValue = (field, value, resolve) => {
  const f = String(field ?? "");

  if (value == null || value === "") return f === "team_lead" || f === "team_lead_id" ? "no lead" : "—";
  if (value === true || value === "true" || value === "True")
    return f === "is_active" ? "active" : "true";
  if (value === false || value === "false" || value === "False")
    return f === "is_active" ? "inactive" : "false";

  const s = String(value);
  if (s === "tier_1") return "Tier 1";
  if (s === "tier_2") return "Tier 2";

  // A lead recorded as a bare id is unreadable on its own — resolve it against
  // the roster when the caller can, and fall back to the id rather than hiding
  // that a value was there.
  if ((f === "team_lead" || f === "team_lead_id") && /^\d+$/.test(s)) {
    return resolve?.(Number(s)) ?? `#${s}`;
  }
  return s;
};

// ─── Permission table ─────────────────────────────────────────────────────────
// Both columns are always drawn, including the one the manager is NOT on. The
// point of the table is the DIFFERENCE between the tiers — a list of what a
// tier-2 manager can't do is the argument for promoting them, and it disappears
// if only the current tier is shown.
export function TierPowers(props) {
  const isLead = () => props.tier === "tier_1";

  return (
    <ul class="space-y-1.5">
      <For each={TIER_1_POWERS}>
        {(power) => (
          <li class="flex items-start gap-2.5 text-sm">
            <span
              aria-hidden="true"
              class={`flex-none mt-0.5 w-4 h-4 rounded-full grid place-items-center text-[10px] font-bold ${
                isLead()
                  ? "bg-[#E7F5EE] text-[#0F7A55] dark:bg-green-900/40 dark:text-green-300"
                  : "bg-[#F0F4F9] text-[#8593A8] dark:bg-gray-700 dark:text-gray-500"
              }`}
            >
              {isLead() ? "✓" : "✕"}
            </span>
            <span
              class={
                isLead()
                  ? "text-[#14233A] dark:text-gray-200"
                  : "text-[#8593A8] line-through decoration-[#C9D3E0]"
              }
            >
              {power}
            </span>
          </li>
        )}
      </For>
    </ul>
  );
}

// ─── "Inactive but still holding clients" ─────────────────────────────────────
// A deactivated manager who still holds clients is not a normal row: those
// clients are assigned to someone who is switched off, so nobody is looking at
// them and the only place that fact is visible is here. It is stated as an
// observation, not an error — these two predate this screen and neither is
// broken, they just need somebody to decide where the clients go.
export function StrandedClientsNote(props) {
  return (
    <Show when={props.profile?.isActive === false && props.profile?.clientCount > 0}>
      <div
        class={`rounded-xl border border-[#E4B94A]/50 bg-[#FDF6E7] dark:bg-yellow-900/20 dark:border-yellow-700/50 px-4 py-3 ${props.class ?? ""}`}
      >
        <p class="text-sm font-semibold text-[#8A6410] dark:text-yellow-200">
          Inactive, but still holding {props.profile.clientCount} client
          {props.profile.clientCount === 1 ? "" : "s"}.
        </p>
        <p class="text-xs text-[#8A6410]/85 dark:text-yellow-200/75 mt-1">
          Those clients stay assigned to a manager who is switched off. Reactivate
          this profile or move the clients to another manager on Client
          Assignments — deactivating alone does not hand them over.
        </p>
      </div>
    </Show>
  );
}

// A compact version of the same fact for a roster row: one amber dot and a
// count, so the two rows that need attention are findable in a list of 23
// without opening each one.
export function StrandedChip(props) {
  return (
    <Show when={props.profile?.isActive === false && props.profile?.clientCount > 0}>
      <span class="inline-flex items-center gap-1 px-2 py-[3px] rounded-full ring-1 ring-inset text-[10px] font-bold uppercase tracking-[.07em] leading-none whitespace-nowrap bg-[#FDF6E7] text-[#8A6410] ring-[#8A6410]/25 dark:bg-yellow-900/30 dark:text-yellow-200 dark:ring-yellow-500/25">
        <span aria-hidden="true" class="w-1.5 h-1.5 rounded-full bg-[#C08A12]" />
        holds {props.profile.clientCount}
      </span>
    </Show>
  );
}
