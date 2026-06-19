import { createSignal, createResource, For, Show } from "solid-js";
import { canSwitch } from "../stores/currentUser";
import {
  asTeamMemberId,
  setAsTeamMemberId,
} from "../stores/cmScope";
import { fetchTeamMembers } from "../services/cm";

// Tier-1-only switcher. Lets a team lead "view as" one of their team members.
// Selecting a member sets the global asTeamMemberId scope, which every CM data
// fetch threads via withScope/scopeQuery — so all views refetch scoped to that
// member. Tier 2 / non-CM never render this (gated by canSwitch()).
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

  const tierLabel = (t) =>
    t === "tier_1" ? "Tier 1" : t === "tier_2" ? "Tier 2" : "";

  const onChange = (e) => {
    const val = e.target.value;
    setAsTeamMemberId(val === "__own__" ? null : Number(val));
  };

  const currentValue = () => {
    const id = asTeamMemberId();
    return id == null ? "__own__" : String(id);
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
            <option value="__own__">My team (everyone)</option>
            <Show when={!members.loading}>
              <For each={members() ?? []}>
                {(m) => (
                  <option value={String(m.user_id)}>
                    {m.email}
                    {tierLabel(m.tier) ? ` · ${tierLabel(m.tier)}` : ""}
                  </option>
                )}
              </For>
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
