import { createResource, For, Show } from "solid-js";
import { canSwitch, currentUser } from "../stores/currentUser";
import { tierLabel } from "../utils/cmTiers";
import {
  asTeamMemberId,
  ownScope,
  setAsTeamMemberId,
  setOwnScope,
  setTeamScope,
} from "../stores/cmScope";
import { fetchTeamMembers } from "../services/cm";

// Tier 1 + Tier 2 scope selector. Three modes:
//   • "Just me"            → as_team_member_id = the lead's OWN id (own clients only)
//   • "My team (everyone)" → no scope param (own + all team members, merged)
//   • a specific member    → as_team_member_id = that member's id
// Selecting a mode sets the global asTeamMemberId scope, which every CM data
// fetch threads via withScope/scopeQuery — so all views refetch accordingly.
// Tier 3 / non-CM never render this (gated by canSwitch()).
//
// The team list runs down the whole tree: a Tier 1 gets their Tier 2s AND
// those Tier 2s' Tier 3s; a Tier 2 gets their Tier 3s. Each option names the
// member's tier and, when it isn't the viewer, who they report to.
// /cm/team-members/ rows: { user_id, email, tier, tier_label, team_lead_email }
// (confirmed on prod 2026-10-09).
const ME = "__me__";
const TEAM = "__team__";

export default function SwitchModeDropdown() {
  // Only fetch team members when this user can actually switch.
  const [members] = createResource(
    () => (canSwitch() ? "load" : null),
    async () => {
      try {
        const res = await fetchTeamMembers();
        return Array.isArray(res?.data) ? res.data : [];
      } catch (err) {
        console.error("[SwitchModeDropdown] Failed to load team members:", err);
        return [];
      }
    },
  );

  const reportsTo = (m) => {
    const lead = m.team_lead_email ?? null;
    return lead && lead !== currentUser.email ? lead : null;
  };

  const optionLabel = (m) =>
    [m.email, tierLabel(m.tier, m.tier_label), reportsTo(m) && `reports to ${reportsTo(m)}`]
      .filter(Boolean)
      .join(" · ");

  const onChange = (e) => {
    const val = e.target.value;
    if (val === TEAM) setTeamScope();
    else if (val === ME) setOwnScope();
    else setAsTeamMemberId(Number(val));
  };

  const currentValue = () => {
    if (ownScope()) return ME;
    return asTeamMemberId() == null ? TEAM : String(asTeamMemberId());
  };

  return (
    <Show when={canSwitch()}>
      <div class="hidden sm:flex items-center gap-2">
        <span class="text-xs font-medium text-gray-400 dark:text-gray-500 whitespace-nowrap">
          Viewing
        </span>
        <div class="relative">
          <select
            value={currentValue()}
            onChange={onChange}
            class="appearance-none pl-3 pr-8 py-1.5 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200
                   focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer max-w-[220px]"
            title="Switch which CM's data you're viewing"
          >
            <option value={ME}>Just me</option>
            <option value={TEAM}>My team (everyone)</option>
            <Show when={!members.loading && (members() ?? []).length > 0}>
              <optgroup label="Team members">
                <For each={members() ?? []}>
                  {(m) => (
                    <option value={String(m.user_id)} title={optionLabel(m)}>
                      {optionLabel(m)}
                    </option>
                  )}
                </For>
              </optgroup>
            </Show>
          </select>
          <svg
            class="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    </Show>
  );
}
