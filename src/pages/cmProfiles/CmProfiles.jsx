import { createSignal, createMemo, createResource, For, Show } from "solid-js";
import Swal from "sweetalert2";

import {
  fetchCmProfiles,
  fetchCmProfile,
  updateCmProfile,
} from "../../services/cmProfiles";
import { collectFieldMessages } from "../../utils/apiErrors";
import { canWriteCmProfiles } from "../../stores/currentUser";
import ProfileChangeModal from "./ProfileChangeModal";
import ProfileHistoryDrawer from "./ProfileHistoryDrawer";
import {
  CARD,
  Avatar,
  TierBadge,
  InactiveBadge,
  CountChip,
  TierPowers,
  StrandedClientsNote,
  StrandedChip,
  tierLabel,
  cmLabel,
  clientLabel,
} from "./cmProfilesFormat";

// ─── Campaign manager profiles ────────────────────────────────────────────────
// Read for admin, coordination, accounts and campaign managers; WRITE for admin
// and coordination only (canWriteCmProfiles). Readers get the whole screen minus
// the buttons — what a manager may do and whose dashboard their clients are on
// is worth being able to look up even if you can't change it.
//
// NEITHER FIELD ON THIS SCREEN IS A LABEL, and the layout is built around
// saying so:
//
//   tier is a PERMISSION LEVEL. The detail pane leads with the five things a
//   Tier 1 manager may do and a Tier 2 manager may not, and the promote
//   confirmation repeats the list — because one PATCH grants all five at once.
//
//   team_lead is a VISIBILITY FILTER, not an org chart. get_visible_client_ids
//   walks from a tier-1 lead down to their team, so moving one tier-2 manager
//   between leads moves every client they hold out of one dashboard and into
//   another, at once and for all history. The detail route returns clients[] for
//   exactly this, so the confirmation lists those clients BY NAME.
//
// The server owns the rules (a lead with active reports can't be demoted; a
// tier-2 always has an active tier-1 lead; a tier-1 never has one; nobody leads
// themselves). This screen keeps the form coherent with them and shows the 422
// verbatim when it disagrees — those responses name the members or the rule that
// stopped the change, which is the actionable part.

const TIER_FILTERS = [
  { key: "all", label: "All tiers" },
  { key: "tier_1", label: "Tier 1" },
  { key: "tier_2", label: "Tier 2" },
];

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

const matches = (haystacks, query) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => String(h ?? "").toLowerCase().includes(q));
};

// Used ONLY when the server sent nothing more specific than its wrapper string.
// A real message from the backend always wins, verbatim.
const statusFallback = (status) => {
  if (status === 403)
    return "You don't have permission to change campaign manager profiles.";
  if (status === 404)
    return "That profile no longer exists — refresh and try again.";
  return null;
};

const toast = (title) =>
  Swal.fire({
    icon: "success",
    title,
    toast: true,
    position: "top-end",
    timer: 5000,
    timerProgressBar: true,
    showConfirmButton: false,
  });

function SectionTitle(props) {
  return (
    <div class="flex items-center justify-between gap-3 mb-3">
      <h3 class="text-sm font-bold uppercase tracking-wider text-[#8593A8]">
        {props.children}
      </h3>
      {props.right}
    </div>
  );
}

function Segmented(props) {
  return (
    <div role="tablist" class="inline-flex p-1 rounded-xl bg-[#F0F4F9] dark:bg-gray-800">
      <For each={props.options}>
        {(o) => (
          <button
            role="tab"
            type="button"
            aria-selected={props.value === o.key}
            onClick={() => props.onChange(o.key)}
            class={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              props.value === o.key
                ? "bg-white dark:bg-gray-900 text-[#AC2334] shadow-sm"
                : "text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-gray-200"
            }`}
          >
            {o.label}
          </button>
        )}
      </For>
    </div>
  );
}

function RosterSkeleton() {
  return (
    <div class="space-y-1.5 px-1 py-1">
      <For each={[0, 1, 2, 3, 4]}>
        {() => (
          <div class="flex items-center gap-3 px-3 py-3 animate-pulse">
            <span class="w-9 h-9 rounded-xl bg-[#EDF1F7] dark:bg-gray-700" />
            <span class="flex-1 space-y-2">
              <span class="block h-2.5 w-2/3 rounded bg-[#EDF1F7] dark:bg-gray-700" />
              <span class="block h-2 w-1/3 rounded bg-[#F2F5F9] dark:bg-gray-700/60" />
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

function EmptyPanel(props) {
  return (
    <div class={`${CARD} p-10 grid place-items-center text-center min-h-[320px]`}>
      <div>
        <div class="w-12 h-12 mx-auto rounded-xl bg-[#F0F4F9] dark:bg-gray-700 grid place-items-center mb-3">
          <svg
            class="w-6 h-6 text-[#8593A8]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
        </div>
        <p class="text-sm font-semibold text-[#14233A] dark:text-gray-200">
          {props.title}
        </p>
        <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">{props.hint}</p>
      </div>
    </div>
  );
}

export default function CmProfiles() {
  // The whole roster, unfiltered. The tier/is_active query params exist on the
  // endpoint, but narrowing server-side would hide the inactive managers still
  // holding clients — and counting those is the one thing this screen does that
  // nothing else does. Filtering 23 rows in memory is also instant.
  const [profiles, { refetch: refetchList }] = createResource(() =>
    fetchCmProfiles(),
  );

  const [selectedId, setSelectedId] = createSignal(null);

  // The detail route is what carries clients[], and those names are what the
  // lead-change confirmation is built from. Keyed on the selection so it
  // refetches on every change of manager.
  const [detail, { refetch: refetchDetail }] = createResource(
    selectedId,
    fetchCmProfile,
  );

  const [search, setSearch] = createSignal("");
  const [tierFilter, setTierFilter] = createSignal("all");
  const [statusFilter, setStatusFilter] = createSignal("all");

  const [pending, setPending] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal(null);
  const [reasonError, setReasonError] = createSignal(null);
  const [historyFor, setHistoryFor] = createSignal(null);

  const rows = () => profiles() ?? [];
  const canWrite = () => canWriteCmProfiles();

  // team_lead_id is a USER id — the model's FK is to User and the PATCH resolves
  // it with User.objects.filter(pk=…). The two ranges don't even overlap on the
  // live roster (profile ids 1–27, user ids 133–267), so a profile id sent here
  // would resolve to nobody rather than to the wrong person.
  const byLeadId = createMemo(() => {
    const m = new Map();
    for (const p of rows()) if (p.userId != null) m.set(p.userId, p);
    return m;
  });

  // The email behind a team_lead_id, for the history log and the roster rows.
  const resolveLead = (id) => {
    const p = byLeadId().get(Number(id));
    return p ? cmLabel(p) : null;
  };

  // A tier-1 lead's team. Neither route sends one, so it is derived from the
  // roster — every tier-2 row names its lead, which is the same relation read
  // from the other end.
  const teamOf = (p) => {
    if (!p?.userId) return [];
    return rows().filter((r) => r.teamLeadId != null && r.teamLeadId === p.userId);
  };

  // team_size when the server sent one (tier-1 rows only), the derived team
  // otherwise. Read through one helper so a roster row and the detail pane can't
  // disagree about how many people report to the same manager.
  const teamCountOf = (p) => p?.teamMemberCount || teamOf(p).length;

  // The tier in the server's own words when it sent them, ours otherwise — the
  // badge keeps deriving its own, since it is shared with a screen that has no
  // tier_label to read.
  const tierText = (p) => p?.tierLabel ?? tierLabel(p?.tier);

  // The selected profile, merged: identity and clients from the DETAIL payload,
  // the team derived from the roster. The row in the list is the fallback so the
  // pane has something to draw while the detail is still in flight.
  const selected = createMemo(() => {
    const listRow = rows().find((p) => p.id === selectedId());
    const d = detail.state === "ready" ? detail() : null;
    const base = d ?? listRow;
    if (!base) return null;
    const team = teamOf(base);
    return {
      ...base,
      teamMembers: team,
      // The derived team is the one with names in it, so an active-member count
      // (which is what the demotion guard actually tests) comes from there.
      activeTeamCount: team.filter((m) => m.isActive).length,
      teamMemberCount: base.teamMemberCount || team.length,
    };
  });

  const filtered = createMemo(() =>
    rows()
      .filter((p) => tierFilter() === "all" || p.tier === tierFilter())
      .filter((p) =>
        statusFilter() === "all"
          ? true
          : statusFilter() === "active"
            ? p.isActive
            : !p.isActive,
      )
      .filter((p) => matches([p.email, p.name, p.teamLeadEmail], search())),
  );

  // Inactive managers who still hold clients. Counted off the UNFILTERED roster
  // so a filter can never make the warning disappear while the state persists.
  const stranded = createMemo(() =>
    rows().filter((p) => !p.isActive && (p.clientCount ?? 0) > 0),
  );

  // Every active tier-1 manager except the one being changed — nobody can report
  // to themselves, and a tier-2 manager's lead must be ACTIVE.
  const leadCandidates = createMemo(() => {
    const self = selected();
    return rows()
      .filter((p) => p.tier === "tier_1" && p.isActive && p.id !== self?.id)
      // sendId is the USER id — what team_lead_id holds and what the PATCH
      // looks up. A row without one is dropped rather than sent as a profile id.
      .map((p) => ({ ...p, sendId: p.userId }))
      .filter((p) => p.sendId != null);
  });

  // ── Writes ─────────────────────────────────────────────────────────────────
  // Every confirmation is built from the DETAIL payload's clients[] — the roster
  // row carries a count and no names. Opening one before that lands would tell
  // the operator a manager holds no clients while they hold sixteen, so the
  // actions wait for it. The resource is keyed on the selection, so a "ready"
  // state always belongs to the manager on screen (a refetch reads as
  // "refreshing", not "ready").
  const detailReady = () => detail.state === "ready";

  const ask = (mode) => {
    if (!canWrite() || !detailReady()) return;
    setActionError(null);
    setReasonError(null);
    setPending({ mode, profile: selected(), leadCandidates: leadCandidates() });
  };

  // A 422 here is the normal way the server says no, and every one of them is
  // worded to be read: the reason rule names the field, the demotion guard
  // answers fields.tier = [<member>, <member>, <member>] — the three people who
  // would be left reporting to somebody who is no longer a lead.
  //
  // That list is the whole answer, so EVERY entry is shown. Reading one message
  // per field would have turned anurag's three names into one and left the
  // operator moving members one at a time to find the rest.
  //
  // Both halves are kept: the rule (error.detail) says what stopped the change
  // and the field list says who. Neither is rewritten on the way through.
  const applyError = (err) => {
    const fields = collectFieldMessages(err);
    setReasonError(fields.reason?.join(" ") ?? null);

    const detailMsg = err?.data?.error?.detail ?? err?.data?.detail;
    const parts = [];
    if (typeof detailMsg === "string" && detailMsg) parts.push(detailMsg);
    for (const [path, msgs] of Object.entries(fields)) {
      if (path === "reason") continue;
      // A backend that repeats its sentence in both places shouldn't print it
      // twice.
      for (const msg of msgs) if (!parts.includes(msg)) parts.push(msg);
    }

    // One per line. The entries under a key can be sentences or bare member
    // addresses, and a line break is the only separator that reads correctly for
    // both — both banners render whitespace-pre-wrap for this.
    if (parts.length) setActionError(parts.join("\n"));
    // A reason rejection is already pinned under the textarea; repeating the
    // wrapper ("Validation failed") above it would only add noise.
    else if (fields.reason) setActionError(null);
    else
      setActionError(
        statusFallback(err?.status) ?? err?.message ?? "Could not apply the change.",
      );
  };

  const runChange = async (patch) => {
    const p = pending();
    if (!p?.profile?.id) return;

    setBusy(true);
    setActionError(null);
    setReasonError(null);
    try {
      const res = await updateCmProfile(p.profile.id, patch);

      setPending(null);
      // Both, always: the roster carries the tier, the lead and the counts that
      // just changed, and the detail carries the client list the next
      // confirmation will be built from.
      await Promise.all([refetchList(), refetchDetail()]);

      // The server's own sentence names what moved ("… 16 client(s) moved from
      // anurag@… to muskan@…'s dashboard"), which is more than we can say from
      // here — we'd have to recompute it from a roster that has already been
      // refetched.
      toast(res?.message || "Profile updated.");
    } catch (err) {
      applyError(err);
    } finally {
      setBusy(false);
    }
  };

  const listRowClass = (active) =>
    "group relative w-full text-left pl-4 pr-3 py-3 rounded-xl border overflow-hidden " +
    "transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#AC2334]/40 " +
    (active
      ? "border-[#AC2334]/35 bg-gradient-to-r from-[#FBEEF0] to-white " +
        "dark:from-[#AC2334]/20 dark:to-transparent dark:border-[#AC2334]/40 " +
        "shadow-[0_1px_2px_rgba(16,29,49,.05),0_6px_16px_rgba(172,35,52,.10)]"
      : "border-transparent hover:bg-[#F6F9FC] dark:hover:bg-gray-700/40");

  const actionBtn =
    "px-3.5 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-5">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Access
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Campaign manager profiles
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            Tier decides what a manager may do — pausing campaigns, setting
            budgets, recording payments. Team lead decides whose dashboard their
            clients appear on. Neither is a label, and both take effect the
            moment they are saved.
          </p>
        </div>

        <button
          type="button"
          onClick={() => refetchList()}
          disabled={profiles.loading}
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {profiles.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Load failure — the screen is this roster, so it's a hard stop. */}
      <Show when={profiles.error}>
        <div
          role="alert"
          class="mb-5 rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300 flex items-center justify-between gap-3"
        >
          <span>Could not load profiles. {profiles.error?.message ?? ""}</span>
          <button
            type="button"
            onClick={() => refetchList()}
            class="flex-none px-3 py-1.5 rounded-lg border border-[#AC2334]/40 font-semibold hover:bg-white/60 transition"
          >
            Retry
          </button>
        </div>
      </Show>

      {/* ════════ INACTIVE MANAGERS STILL HOLDING CLIENTS ════════
          Surfaced at the top of the screen rather than left to be found by
          scrolling: a switched-off manager holding live clients means nobody is
          looking at those clients, and the roster row alone doesn't say it loudly
          enough. Named, because "2 profiles need attention" is not actionable. */}
      <Show when={stranded().length}>
        <div class="mb-5 rounded-xl border border-[#E4B94A]/50 bg-[#FDF6E7] dark:bg-yellow-900/20 dark:border-yellow-700/50 px-4 py-3.5">
          <p class="text-sm font-bold text-[#8A6410] dark:text-yellow-200">
            {stranded().length} inactive manager
            {stranded().length === 1 ? "" : "s"} still hold
            {stranded().length === 1 ? "s" : ""} clients
          </p>
          <ul class="mt-2 space-y-1">
            <For each={stranded()}>
              {(p) => (
                <li class="text-xs text-[#8A6410] dark:text-yellow-200/90">
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    class="font-semibold underline underline-offset-2 hover:opacity-80 break-all"
                  >
                    {cmLabel(p)}
                  </button>{" "}
                  — {tierText(p) ?? "unknown tier"}, inactive, holds{" "}
                  {p.clientCount} client{p.clientCount === 1 ? "" : "s"}
                </li>
              )}
            </For>
          </ul>
          <p class="mt-2 text-xs text-[#8A6410]/85 dark:text-yellow-200/75">
            Deactivating a profile does not reassign its clients. Either
            reactivate the manager or move those clients on Client Assignments.
          </p>
        </div>
      </Show>

      <div class="grid grid-cols-1 lg:grid-cols-[440px_1fr] xl:grid-cols-[520px_1fr] gap-5 items-start">
        {/* ════════ LEFT — ROSTER ════════ */}
        <div class={`${CARD} overflow-hidden lg:sticky lg:top-6`}>
          <div class="px-4 pt-4 pb-3.5 border-b border-[#EDF1F7] dark:border-gray-700 bg-gradient-to-b from-[#FAFCFF] to-white dark:from-gray-800/40 dark:to-gray-800">
            <div class="flex items-center gap-3">
              <span class="flex-none w-9 h-9 rounded-xl grid place-items-center bg-[#14233A] dark:bg-white/10 shadow-[0_2px_6px_rgba(16,29,49,.18)]">
                <svg
                  class="w-[18px] h-[18px] text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.8"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </span>
              <div class="min-w-0 flex-1">
                <h3 class="text-[13px] font-bold uppercase tracking-[.08em] text-[#14233A] dark:text-gray-100 truncate">
                  Campaign managers
                </h3>
                <p class="text-[11px] text-[#8593A8] mt-0.5 truncate">
                  Pick one to see what they may do and who sees their clients
                </p>
              </div>
              <span class="flex-none px-2.5 py-1 rounded-full text-[11px] font-bold tabular-nums ring-1 ring-inset ring-[#DCE4EF] bg-[#F4F7FB] text-[#54657E] dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-600">
                {filtered().length}/{rows().length}
              </span>
            </div>

            <div class="relative mt-3">
              <svg
                class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8593A8]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                />
              </svg>
              <input
                type="text"
                value={search()}
                onInput={(e) => setSearch(e.target.value)}
                placeholder="Search by email, name or lead…"
                class="w-full pl-9 pr-8 py-2.5 rounded-xl text-sm border border-[#E2E8F1] dark:border-gray-600
                       bg-[#F8FAFC] dark:bg-gray-900/40 text-[#14233A] dark:text-gray-100
                       placeholder:text-[#8593A8] outline-none transition
                       focus:bg-white dark:focus:bg-gray-800 focus:border-[#AC2334] focus:ring-2 focus:ring-[#AC2334]/25"
              />
              <Show when={search()}>
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  class="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded-full
                         text-[11px] text-[#8593A8] hover:bg-[#E2E8F1] hover:text-[#14233A]
                         dark:hover:bg-gray-700 dark:hover:text-gray-100 transition"
                >
                  ✕
                </button>
              </Show>
            </div>

            <div class="flex flex-wrap items-center gap-2 mt-3">
              <Segmented
                options={TIER_FILTERS}
                value={tierFilter()}
                onChange={setTierFilter}
              />
              <Segmented
                options={STATUS_FILTERS}
                value={statusFilter()}
                onChange={setStatusFilter}
              />
            </div>
          </div>

          <div class="max-h-[62vh] overflow-y-auto px-2.5 py-2.5">
            <Show when={profiles.loading && !rows().length}>
              <RosterSkeleton />
            </Show>
            <Show when={!profiles.loading && !filtered().length}>
              <div class="px-4 py-10 text-center">
                <p class="text-sm font-semibold text-[#14233A] dark:text-gray-200">
                  No managers match
                </p>
                <p class="text-xs text-[#8593A8] mt-1">
                  Clear the search or the filters to see everyone.
                </p>
              </div>
            </Show>

            <For each={filtered()}>
              {(p) => (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id);
                    setActionError(null);
                    setReasonError(null);
                  }}
                  aria-current={selectedId() === p.id ? "true" : undefined}
                  class={listRowClass(selectedId() === p.id)}
                >
                  <span
                    aria-hidden="true"
                    class={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all duration-150 ${
                      selectedId() === p.id ? "h-9 bg-[#AC2334]" : "h-0 bg-transparent"
                    }`}
                  />
                  <span class="flex items-start gap-3">
                    <Avatar name={cmLabel(p)} size="w-9 h-9" textSize="text-[11px]" />
                    <span class="min-w-0 flex-1">
                      <span class="flex items-start justify-between gap-2">
                        <span class="block text-sm font-semibold text-[#14233A] dark:text-gray-100 truncate">
                          {cmLabel(p)}
                        </span>
                        <CountChip count={p.clientCount} label="clients" />
                      </span>
                      <span class="block text-xs text-[#8593A8] truncate mt-0.5">
                        {p.tier === "tier_1"
                          ? teamCountOf(p)
                            ? `Leads ${teamCountOf(p)} manager${teamCountOf(p) === 1 ? "" : "s"}`
                            : "Leads nobody"
                          : `Reports to ${p.teamLeadEmail ?? resolveLead(p.teamLeadId) ?? "—"}`}
                      </span>
                      <span class="flex flex-wrap items-center gap-1.5 mt-2">
                        <TierBadge tier={p.tier} />
                        <InactiveBadge isActive={p.isActive} />
                        <StrandedChip profile={p} />
                      </span>
                    </span>
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>

        {/* ════════ RIGHT — DETAIL ════════ */}
        <div>
          <Show when={actionError()}>
            <div
              role="alert"
              class="mb-4 rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300 flex items-start justify-between gap-3"
            >
              <span class="whitespace-pre-wrap">{actionError()}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                aria-label="Dismiss"
                class="flex-none text-[#AC2334] hover:opacity-70"
              >
                ✕
              </button>
            </div>
          </Show>

          <Show
            when={selected()}
            fallback={
              <EmptyPanel
                title="No campaign manager selected"
                hint="Pick a manager on the left to see what their tier permits and whose dashboard their clients appear on."
              />
            }
          >
            <div class="space-y-5">
              {/* ── Identity ── */}
              <div class={`${CARD} p-5 sm:p-6`}>
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="flex items-start gap-3 min-w-0">
                    <Avatar name={cmLabel(selected())} size="w-11 h-11" textSize="text-sm" />
                    <div class="min-w-0">
                      <h2 class="text-lg font-bold text-[#14233A] dark:text-white break-all">
                        {cmLabel(selected())}
                      </h2>
                      <div class="flex flex-wrap items-center gap-2 mt-1">
                        <Show when={selected().name && selected().email}>
                          <span class="text-sm text-[#54657E] dark:text-gray-400">
                            {selected().name}
                          </span>
                        </Show>
                        <TierBadge tier={selected().tier} />
                        <InactiveBadge isActive={selected().isActive} />
                        <CountChip count={selected().clientCount} label="clients" />
                      </div>
                    </div>
                  </div>

                  <div class="flex-none flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setHistoryFor({ id: selected().id, label: cmLabel(selected()) })
                      }
                      class={`${actionBtn} border border-[#E2E8F1] dark:border-gray-700 text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700`}
                    >
                      History
                    </button>
                    <Show when={canWrite()}>
                      <button
                        type="button"
                        onClick={() => ask("active")}
                        disabled={!detailReady()}
                        title={detailReady() ? undefined : "Loading this manager’s clients…"}
                        class={`${actionBtn} border ${
                          selected().isActive
                            ? "border-[#AC2334]/30 text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/20"
                            : "border-[#15966A]/40 text-[#0F7A55] hover:bg-[#E7F5EE] dark:hover:bg-green-900/20"
                        }`}
                      >
                        {selected().isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </Show>
                  </div>
                </div>

                <StrandedClientsNote profile={selected()} class="mt-4" />

                {/* Readers get the screen without the buttons; saying why beats
                    a pane that silently has fewer controls than a colleague's. */}
                <Show when={!canWrite()}>
                  <p class="mt-4 rounded-lg bg-[#F0F4F9] dark:bg-gray-700/50 px-3.5 py-2.5 text-xs text-[#54657E] dark:text-gray-300">
                    You can read every profile here. Changing a tier, a team lead
                    or a manager's active state is restricted to admin and
                    coordination.
                  </p>
                </Show>
              </div>

              {/* ── Tier = permissions ── */}
              <div class={`${CARD} p-5 sm:p-6`}>
                <SectionTitle
                  right={
                    <Show when={canWrite()}>
                      <button
                        type="button"
                        onClick={() => ask("tier")}
                        disabled={!detailReady()}
                        title={detailReady() ? undefined : "Loading this manager’s clients…"}
                        class={`${actionBtn} border ${
                          selected().tier === "tier_1"
                            ? "border-[#AC2334]/30 text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/20"
                            : "border-[#15966A]/40 text-[#0F7A55] hover:bg-[#E7F5EE] dark:hover:bg-green-900/20"
                        }`}
                      >
                        {selected().tier === "tier_1"
                          ? "Demote to Tier 2"
                          : "Promote to Tier 1"}
                      </button>
                    </Show>
                  }
                >
                  Permissions — {tierText(selected()) ?? "no tier"}
                </SectionTitle>

                <p class="text-sm text-[#54657E] dark:text-gray-300 mb-3">
                  {selected().tier === "tier_1"
                    ? "This manager may do all of the following:"
                    : "Tier 2. This manager may do none of the following:"}
                </p>
                <TierPowers tier={selected().tier} />
                <p class="text-xs text-[#8593A8] mt-3">
                  A tier change grants or removes every one of these at once.
                </p>
              </div>

              {/* ── Team lead = visibility ── */}
              <div class={`${CARD} p-5 sm:p-6`}>
                <SectionTitle
                  right={
                    <Show when={canWrite() && selected().tier === "tier_2"}>
                      <button
                        type="button"
                        onClick={() => ask("lead")}
                        disabled={!detailReady()}
                        title={detailReady() ? undefined : "Loading this manager’s clients…"}
                        class={`${actionBtn} border border-[#E2E8F1] dark:border-gray-700 text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700`}
                      >
                        Move to another lead
                      </button>
                    </Show>
                  }
                >
                  Team Member 
                </SectionTitle>

                <Show
                  when={selected().tier === "tier_2"}
                  fallback={
                    <>
                      <p class="text-sm text-[#14233A] dark:text-gray-200">
                        A Tier 1 manager has no team lead. Their dashboard shows
                        their own clients plus every client held by the tier-2
                        managers who report to them.
                      </p>
                      <div class="mt-4">
                        <SectionTitle>
                          Team ({teamOf(selected()).length})
                        </SectionTitle>
                        <Show
                          when={teamOf(selected()).length}
                          fallback={
                            <p class="text-sm text-[#8593A8]">
                              Nobody reports to this manager, so their dashboard
                              shows only their own clients.
                            </p>
                          }
                        >
                          <ul class="divide-y divide-[#E2E8F1] dark:divide-gray-700 border border-[#E2E8F1] dark:border-gray-700 rounded-xl overflow-hidden">
                            <For each={teamOf(selected())}>
                              {(m) => (
                                <li class="flex items-center gap-3 px-3.5 py-2.5">
                                  <Avatar
                                    name={cmLabel(m)}
                                    size="w-8 h-8"
                                    textSize="text-[10px]"
                                  />
                                  <span class="min-w-0 flex-1">
                                    <span class="block text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                                      {cmLabel(m)}
                                    </span>
                                    <span class="flex items-center gap-1.5 mt-0.5">
                                      <TierBadge tier={m.tier} />
                                      <InactiveBadge isActive={m.isActive} />
                                      <Show when={m.clientCount != null}>
                                        <span class="text-xs text-[#8593A8]">
                                          {m.clientCount} client
                                          {m.clientCount === 1 ? "" : "s"}
                                        </span>
                                      </Show>
                                    </span>
                                  </span>
                                  <Show when={m.id != null}>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedId(m.id)}
                                      class="flex-none px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition"
                                    >
                                      Open
                                    </button>
                                  </Show>
                                </li>
                              )}
                            </For>
                          </ul>
                          <p class="text-xs text-[#8593A8] mt-2">
                            Every client these managers hold is also visible on
                            this lead's dashboard. Demoting this manager is
                            refused while any of them are active.
                          </p>
                        </Show>
                      </div>
                    </>
                  }
                >
                  <p class="text-sm text-[#14233A] dark:text-gray-200">
                    Reports to{" "}
                    <span class="font-bold break-all">
                      {selected().teamLeadEmail ??
                        resolveLead(selected().teamLeadId) ??
                        "no lead"}
                    </span>
                    .
                  </p>
                  <p class="text-sm text-[#54657E] dark:text-gray-300 mt-1.5">
                    All {selected().clientCount} of this manager's clients appear
                    on that lead's dashboard. Moving them to another lead moves
                    every one of those clients with them — at once, and for all
                    history, not from the change date forward.
                  </p>
                </Show>
              </div>

              {/* ── The clients themselves ── */}
              <div class={`${CARD} p-5 sm:p-6`}>
                <SectionTitle>Clients ({selected().clientCount})</SectionTitle>

                <Show when={detail.loading}>
                  <p class="text-sm text-[#8593A8]">Loading clients…</p>
                </Show>
                <Show when={detail.error}>
                  <p class="text-sm text-[#AC2334]">
                    Could not load this manager's clients.{" "}
                    {detail.error?.message ?? ""}
                  </p>
                </Show>

                <Show when={!detail.loading && !detail.error}>
                  <Show
                    when={selected().clients?.length}
                    fallback={
                      <p class="text-sm text-[#8593A8]">
                        No clients assigned to this manager.
                      </p>
                    }
                  >
                    {/* The route sends nomen NAMES, nothing else — no email, no
                        type, no id — so the row is the name and the mark beside
                        it. Rendering empty slots for fields the payload doesn't
                        carry would make a complete list look like a broken one. */}
                    <ul class="divide-y divide-[#E2E8F1] dark:divide-gray-700 border border-[#E2E8F1] dark:border-gray-700 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                      <For each={selected().clients}>
                        {(c) => (
                          <li class="flex items-center gap-3 px-3.5 py-2.5">
                            <Avatar
                              name={clientLabel(c)}
                              size="w-8 h-8"
                              textSize="text-[10px]"
                            />
                            <span class="min-w-0 flex-1 text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                              {clientLabel(c)}
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                    <p class="text-xs text-[#8593A8] mt-2">
                      These are the clients that change dashboards when this
                      manager's tier or team lead changes.
                    </p>
                  </Show>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <ProfileChangeModal
        pending={pending()}
        busy={busy()}
        error={actionError()}
        reasonError={reasonError()}
        onConfirm={runChange}
        onClose={() => !busy() && setPending(null)}
      />

      <ProfileHistoryDrawer
        profileId={historyFor()?.id ?? null}
        label={historyFor()?.label}
        resolveLead={resolveLead}
        onClose={() => setHistoryFor(null)}
      />
    </section>
  );
}
