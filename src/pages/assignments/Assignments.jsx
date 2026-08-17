import { createSignal, createMemo, createResource, For, Show } from "solid-js";
import Swal from "sweetalert2";

import {
  fetchAssignments,
  assignClientToCm,
  unassignClientFromCm,
} from "../../services/cmAssignments";
import { specificError } from "../../utils/apiErrors";
import AssignmentConfirmModal from "./AssignmentConfirmModal";
import AssignmentHistoryDrawer from "./AssignmentHistoryDrawer";
import {
  CARD,
  FIELD,
  Avatar,
  TierBadge,
  ClientTypeBadge,
  InactiveBadge,
  CountChip,
  cmLabel,
  clientLabel,
} from "./assignmentsFormat";

// ─── CM ↔ Client assignments ──────────────────────────────────────────────────
// Admin + coordination only (route-gated; the endpoints 403 everyone else).
//
// The relationship is MANY-TO-MANY — a client can have several campaign
// managers and a manager many clients — so there is no "the CM" dropdown
// anywhere on this screen. Both tabs are the same table read from opposite
// ends, and both write through the same assign/unassign endpoints, which is why
// a change made in one is refetched into both.
//
// Assignment DRIVES DATA VISIBILITY, so every write is confirmed and every
// removal is described as a revoke: the row is deactivated, its history is
// kept, and assigning the same pair again reactivates it. See the confirm modal.
//
// VISIBILITY ≠ THIS TABLE for tier-1 managers: a tier-1 lead also sees whatever
// their tier-2 reports are assigned. The hints below say "can see" for that and
// "assigned" for this list, and never conflate the two.

const TABS = [
  { key: "cm", label: "By Campaign Manager" },
  { key: "client", label: "By Client" },
];

const matches = (haystacks, query) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => String(h ?? "").toLowerCase().includes(q));
};

// Documented rejections, worded for the operator. These are used ONLY when the
// server sent nothing more specific than its wrapper string — a real message
// from the backend always wins, verbatim.
const statusFallback = (status, p) => {
  if (status === 409)
    return `${p.clientLabel} is already assigned to ${p.cmLabel}.`;
  if (status === 400) return `${p.cmLabel} is not a campaign manager.`;
  if (status === 404)
    return p.action === "assign"
      ? "That client or campaign manager no longer exists — refresh and try again."
      : `There is no active assignment between ${p.clientLabel} and ${p.cmLabel} to remove.`;
  if (status === 403)
    return "You don't have permission to change assignments.";
  return null;
};

const toast = (title) =>
  Swal.fire({
    icon: "success",
    title,
    toast: true,
    position: "top-end",
    timer: 3200,
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

// ─── Roster panel chrome ──────────────────────────────────────────────────────
// The roster is the screen's index — it is on-screen the whole session while the
// detail pane swaps beneath the operator's cursor, so it gets a pinned header,
// its own search and rows that read as a directory rather than a list of links.

const ICON_USERS = (
  <path
    stroke-linecap="round"
    stroke-linejoin="round"
    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
  />
);

const ICON_CLIENTS = (
  <path
    stroke-linecap="round"
    stroke-linejoin="round"
    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
  />
);

function RosterHeader(props) {
  return (
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
            {props.icon}
          </svg>
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="text-[13px] font-bold uppercase tracking-[.08em] text-[#14233A] dark:text-gray-100 truncate">
            {props.title}
          </h3>
          <p class="text-[11px] text-[#8593A8] mt-0.5 truncate">
            {props.subtitle}
          </p>
        </div>
        <span class="flex-none px-2.5 py-1 rounded-full text-[11px] font-bold tabular-nums ring-1 ring-inset ring-[#DCE4EF] bg-[#F4F7FB] text-[#54657E] dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-600">
          {props.count}
        </span>
      </div>
      {props.children}
    </div>
  );
}

function RosterSearch(props) {
  return (
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
        value={props.value}
        onInput={(e) => props.onInput(e.target.value)}
        placeholder={props.placeholder}
        class="w-full pl-9 pr-8 py-2.5 rounded-xl text-sm border border-[#E2E8F1] dark:border-gray-600
               bg-[#F8FAFC] dark:bg-gray-900/40 text-[#14233A] dark:text-gray-100
               placeholder:text-[#8593A8] outline-none transition
               focus:bg-white dark:focus:bg-gray-800 focus:border-[#AC2334] focus:ring-2 focus:ring-[#AC2334]/25"
      />
      <Show when={props.value}>
        <button
          type="button"
          onClick={() => props.onInput("")}
          aria-label="Clear search"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded-full
                 text-[11px] text-[#8593A8] hover:bg-[#E2E8F1] hover:text-[#14233A]
                 dark:hover:bg-gray-700 dark:hover:text-gray-100 transition"
        >
          ✕
        </button>
      </Show>
    </div>
  );
}

// The selected row is the one thing the detail pane is answering about, so it
// carries a hard brand-coloured rail — visible at a glance from across the pane,
// and readable without relying on the tint alone.
function RowRail(props) {
  return (
    <span
      aria-hidden="true"
      class={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all duration-150 ${
        props.active ? "h-9 bg-[#AC2334]" : "h-0 bg-transparent"
      }`}
    />
  );
}

// A hairline between rows, inset to the text column so it separates entries
// without boxing them in. It is drawn on the row BELOW the join and pulled at
// hover/selection, so the highlighted row always sits on clean edges.
function RowDivider(props) {
  return (
    <Show when={props.show}>
      <span
        aria-hidden="true"
        class="pointer-events-none absolute left-16 right-3 top-0 h-px bg-[#EDF1F7]
               dark:bg-gray-700/70 transition-opacity duration-150 group-hover:opacity-0"
      />
    </Show>
  );
}

// Shape-of-the-content placeholders rather than a "Loading…" line: the roster is
// the first thing painted on this screen and a jumping layout reads as a bug.
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

function RosterEmpty(props) {
  return (
    <div class="px-4 py-10 text-center">
      <p class="text-sm font-semibold text-[#14233A] dark:text-gray-200">
        {props.title}
      </p>
      <p class="text-xs text-[#8593A8] mt-1">{props.hint}</p>
    </div>
  );
}

function EmptyPanel(props) {
  return (
    <div
      class={`${CARD} p-10 grid place-items-center text-center min-h-[320px]`}
    >
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
        <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">
          {props.hint}
        </p>
      </div>
    </div>
  );
}

export default function Assignments() {
  // Both directions in ONE resource: they are the same table, and refetching
  // only one after a write would leave the other tab showing stale counts.
  const [data, { refetch }] = createResource(fetchAssignments);

  const [tab, setTab] = createSignal("cm");

  const [cmSearch, setCmSearch] = createSignal("");
  const [clientSearch, setClientSearch] = createSignal("");
  const [addClientSearch, setAddClientSearch] = createSignal("");
  const [addCmSearch, setAddCmSearch] = createSignal("");

  const [selectedCmId, setSelectedCmId] = createSignal(null);
  const [selectedClientId, setSelectedClientId] = createSignal(null);

  const [pending, setPending] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal(null);
  const [history, setHistory] = createSignal(null);

  const managers = () => data()?.byCm ?? [];
  const clients = () => data()?.byClient ?? [];

  // Derived from the LIVE resource, not captured at click time — so after a
  // refetch the open panel shows the new lists and counts without re-selecting.
  const selectedCm = createMemo(() =>
    managers().find((m) => m.cmId === selectedCmId()),
  );
  const selectedClient = createMemo(() =>
    clients().find((c) => c.clientId === selectedClientId()),
  );

  const filteredManagers = createMemo(() =>
    managers().filter((m) => matches([m.email, m.name], cmSearch())),
  );
  const filteredClients = createMemo(() =>
    clients().filter((c) => matches([c.nomen, c.email], clientSearch())),
  );

  // Candidates for the pickers: everything not already assigned to the selected
  // side. The filter is a convenience, NOT the guard — a stale list or a
  // concurrent edit can still produce a 409, which is why that lands inline.
  const clientCandidates = createMemo(() => {
    const assigned = new Set((selectedCm()?.clients ?? []).map((c) => c.clientId));
    return clients()
      .filter((c) => !assigned.has(c.clientId))
      .filter((c) => matches([c.nomen, c.email], addClientSearch()));
  });

  const cmCandidates = createMemo(() => {
    const assigned = new Set(
      (selectedClient()?.campaignManagers ?? []).map((m) => m.cmId),
    );
    return managers()
      .filter((m) => !assigned.has(m.cmId))
      .filter((m) => matches([m.email, m.name], addCmSearch()));
  });

  // ── Writes ─────────────────────────────────────────────────────────────────
  const ask = (action, client, manager) => {
    setActionError(null);
    setPending({
      action,
      clientId: client.clientId,
      cmId: manager.cmId,
      clientLabel: clientLabel(client),
      cmLabel: cmLabel(manager),
    });
  };

  const runAction = async (notes) => {
    const p = pending();
    if (!p) return;

    setBusy(true);
    setActionError(null);
    try {
      const args = { clientId: p.clientId, cmId: p.cmId, notes };
      if (p.action === "assign") await assignClientToCm(args);
      else await unassignClientFromCm(args);

      setPending(null);
      setAddClientSearch("");
      setAddCmSearch("");
      // Refetch BOTH directions so every count on both tabs reflects the write.
      await refetch();

      toast(
        p.action === "assign"
          ? `${p.clientLabel} assigned to ${p.cmLabel}`
          : `${p.clientLabel} removed from ${p.cmLabel}`,
      );
    } catch (err) {
      // The server's own wording wins whenever it gave one — it names the pair
      // and the reason. Our sentences only cover the case where it sent nothing
      // past the wrapper string. Either way this stays INLINE: the modal keeps
      // the pair on screen, and the message survives into the panel after it's
      // dismissed, so an "already assigned" never reads as a crash.
      setActionError(
        specificError(err) ??
          statusFallback(err?.status, p) ??
          err?.message ??
          "Could not apply the change.",
      );
    } finally {
      setBusy(false);
    }
  };

  const loadError = () => data.error;

  // ── Row renderers ──────────────────────────────────────────────────────────
  const listRowClass = (active) =>
    "group relative w-full text-left pl-4 pr-3 py-3 rounded-xl border overflow-hidden " +
    "transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#AC2334]/40 " +
    (active
      ? "border-[#AC2334]/35 bg-gradient-to-r from-[#FBEEF0] to-white " +
        "dark:from-[#AC2334]/20 dark:to-transparent dark:border-[#AC2334]/40 " +
        "shadow-[0_1px_2px_rgba(16,29,49,.05),0_6px_16px_rgba(172,35,52,.10)]"
      : "border-transparent hover:bg-[#F6F9FC] dark:hover:bg-gray-700/40");

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-5">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Access
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Campaign manager assignments
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            Assignments decide which clients each campaign manager can see. A
            client can have several managers, and a manager many clients — work
            from whichever side is easier.
          </p>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={data.loading}
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {data.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* ════════ TABS ════════ */}
      <div
        role="tablist"
        class="inline-flex p-1 rounded-xl bg-[#F0F4F9] dark:bg-gray-800 mb-5"
      >
        <For each={TABS}>
          {(t) => (
            <button
              role="tab"
              type="button"
              aria-selected={tab() === t.key}
              onClick={() => setTab(t.key)}
              class={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                tab() === t.key
                  ? "bg-white dark:bg-gray-900 text-[#AC2334] shadow-sm"
                  : "text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>

      {/* Load failure — the whole screen is these two lists, so this is a hard
          stop with a retry rather than two empty columns. */}
      <Show when={loadError()}>
        <div
          role="alert"
          class="mb-5 rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300 flex items-center justify-between gap-3"
        >
          <span>
            Could not load assignments. {loadError()?.message ?? ""}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            class="flex-none px-3 py-1.5 rounded-lg border border-[#AC2334]/40 font-semibold hover:bg-white/60 transition"
          >
            Retry
          </button>
        </div>
      </Show>

      <div class="grid grid-cols-1 lg:grid-cols-[400px_1fr] xl:grid-cols-[460px_1fr] gap-5 items-start">
        {/* ════════ LEFT — ROSTER ════════ */}
        <div class={`${CARD} overflow-hidden lg:sticky lg:top-6`}>
          <Show
            when={tab() === "cm"}
            fallback={
              <>
                <RosterHeader
                  icon={ICON_CLIENTS}
                  title="Clients"
                  subtitle={
                    clientSearch().trim()
                      ? `${filteredClients().length} of ${clients().length} match`
                      : "Pick one to manage its managers"
                  }
                  count={`${filteredClients().length}/${clients().length}`}
                >
                  <RosterSearch
                    value={clientSearch()}
                    onInput={setClientSearch}
                    placeholder="Search by nomen or email…"
                  />
                </RosterHeader>
                <div class="max-h-[62vh] overflow-y-auto px-2.5 py-2.5">
                  <Show when={data.loading && !clients().length}>
                    <RosterSkeleton />
                  </Show>
                  <Show when={!data.loading && !filteredClients().length}>
                    <RosterEmpty
                      title="No clients match"
                      hint="Try a shorter search, or clear it to see everyone."
                    />
                  </Show>
                  <For each={filteredClients()}>
                    {(c, i) => (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClientId(c.clientId);
                          setAddCmSearch("");
                          setActionError(null);
                        }}
                        aria-current={
                          selectedClientId() === c.clientId ? "true" : undefined
                        }
                        class={listRowClass(selectedClientId() === c.clientId)}
                      >
                        <RowDivider
                          show={
                            i() > 0 &&
                            selectedClientId() !== c.clientId &&
                            selectedClientId() !==
                              filteredClients()[i() - 1]?.clientId
                          }
                        />
                        <RowRail active={selectedClientId() === c.clientId} />
                        <span class="flex items-start gap-3">
                          <Avatar
                            name={clientLabel(c)}
                            size="w-9 h-9"
                            textSize="text-[11px]"
                          />
                          <span class="min-w-0 flex-1">
                            <span class="flex items-start justify-between gap-2">
                              <span class="block text-sm font-semibold text-[#14233A] dark:text-gray-100 truncate">
                                {clientLabel(c)}
                              </span>
                              <CountChip count={c.cmCount} label="CM" />
                            </span>
                            <span class="block text-xs text-[#8593A8] truncate mt-0.5">
                              {c.email ?? "—"}
                            </span>
                            <span class="flex items-center gap-1.5 mt-2">
                              <ClientTypeBadge type={c.clientType} />
                              <InactiveBadge isActive={c.isActive} />
                            </span>
                          </span>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </>
            }
          >
            <RosterHeader
              icon={ICON_USERS}
              title="Campaign managers"
              subtitle={
                cmSearch().trim()
                  ? `${filteredManagers().length} of ${managers().length} match`
                  : "Pick one to manage their clients"
              }
              count={`${filteredManagers().length}/${managers().length}`}
            >
              <RosterSearch
                value={cmSearch()}
                onInput={setCmSearch}
                placeholder="Search by email or name…"
              />
            </RosterHeader>
            <div class="max-h-[62vh] overflow-y-auto px-2.5 py-2.5">
              <Show when={data.loading && !managers().length}>
                <RosterSkeleton />
              </Show>
              <Show when={!data.loading && !filteredManagers().length}>
                <RosterEmpty
                  title="No campaign managers match"
                  hint="Try a shorter search, or clear it to see everyone."
                />
              </Show>
              <For each={filteredManagers()}>
                {(m, i) => (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCmId(m.cmId);
                      setAddClientSearch("");
                      setActionError(null);
                    }}
                    aria-current={
                      selectedCmId() === m.cmId ? "true" : undefined
                    }
                    class={listRowClass(selectedCmId() === m.cmId)}
                  >
                    <RowDivider
                      show={
                        i() > 0 &&
                        selectedCmId() !== m.cmId &&
                        selectedCmId() !== filteredManagers()[i() - 1]?.cmId
                      }
                    />
                    <RowRail active={selectedCmId() === m.cmId} />
                    <span class="flex items-start gap-3">
                      <Avatar
                        name={cmLabel(m)}
                        size="w-9 h-9"
                        textSize="text-[11px]"
                      />
                      <span class="min-w-0 flex-1">
                        <span class="flex items-start justify-between gap-2">
                          <span class="block text-sm font-semibold text-[#14233A] dark:text-gray-100 truncate">
                            {m.email ?? m.name ?? `CM #${m.cmId}`}
                          </span>
                          <CountChip count={m.clientCount} label="clients" />
                        </span>
                        <Show when={m.name && m.email}>
                          <span class="block text-xs text-[#8593A8] truncate mt-0.5">
                            {m.name}
                          </span>
                        </Show>
                        <span class="flex items-center gap-1.5 mt-2">
                          <TierBadge tier={m.tier} />
                          <InactiveBadge isActive={m.isActive} />
                        </span>
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* ════════ RIGHT — DETAIL ════════ */}
        <div>
          {/* A failed write survives the modal being dismissed, so an
              "already assigned" stays readable next to the picker that
              produced it instead of vanishing with the dialog. */}
          <Show when={actionError() && !pending()}>
            <div
              role="alert"
              class="mb-4 rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300 flex items-start justify-between gap-3"
            >
              <span>{actionError()}</span>
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

          {/* ─────────── BY CAMPAIGN MANAGER ─────────── */}
          <Show when={tab() === "cm"}>
            <Show
              when={selectedCm()}
              fallback={
                <EmptyPanel
                  title="No campaign manager selected"
                  hint="Pick a manager on the left to see and change the clients assigned to them."
                />
              }
            >
              <div class={`${CARD} p-5 sm:p-6`}>
                <div class="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#E2E8F1] dark:border-gray-700">
                  {/* Same avatar as the roster row that was clicked — it is the
                      only visual thread confirming which side of the list the
                      detail pane is answering about. */}
                  <div class="flex items-start gap-3 min-w-0">
                    <Avatar
                      name={cmLabel(selectedCm())}
                      size="w-11 h-11"
                      textSize="text-sm"
                    />
                    <div class="min-w-0">
                      <h2 class="text-lg font-bold text-[#14233A] dark:text-white break-all">
                        {selectedCm().email ?? selectedCm().name}
                      </h2>
                      <div class="flex items-center gap-2 mt-1">
                        <Show when={selectedCm().name && selectedCm().email}>
                          <span class="text-sm text-[#54657E] dark:text-gray-400">
                            {selectedCm().name}
                          </span>
                        </Show>
                        <TierBadge tier={selectedCm().tier} />
                        <InactiveBadge isActive={selectedCm().isActive} />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setHistory({
                        scope: "cm",
                        id: selectedCm().cmId,
                        label: cmLabel(selectedCm()),
                      })
                    }
                    class="flex-none px-3.5 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition"
                  >
                    History
                  </button>
                </div>

                {/* Visibility is WIDER than this list for a tier-1 lead, and
                    this list is not proof of what they can see. Worded so it
                    never reads as direct assignment. */}
                <Show when={selectedCm().tier === "tier_1"}>
                  <p class="mt-4 rounded-lg bg-[#F0F4F9] dark:bg-gray-700/50 px-3.5 py-2.5 text-xs text-[#54657E] dark:text-gray-300">
                    As a tier-1 lead, this manager can also see the clients
                    assigned to their tier-2 reports. Those clients are not
                    listed here — this list is only what's assigned to them
                    directly.
                  </p>
                </Show>
                <Show
                  when={
                    selectedCm().tier === "tier_2" && selectedCm().teamLeadId
                  }
                >
                  <p class="mt-4 rounded-lg bg-[#F0F4F9] dark:bg-gray-700/50 px-3.5 py-2.5 text-xs text-[#54657E] dark:text-gray-300">
                    This manager reports to a tier-1 lead, who can also see
                    every client assigned here.
                  </p>
                </Show>

                {/* Assigned clients */}
                <div class="mt-5">
                  <SectionTitle>
                    Assigned clients ({selectedCm().clientCount})
                  </SectionTitle>
                  <Show
                    when={selectedCm().clients.length}
                    fallback={
                      <p class="text-sm text-[#8593A8] py-2">
                        No clients assigned yet.
                      </p>
                    }
                  >
                    <ul class="divide-y divide-[#E2E8F1] dark:divide-gray-700 border border-[#E2E8F1] dark:border-gray-700 rounded-xl overflow-hidden">
                      <For each={selectedCm().clients}>
                        {(c) => (
                          <li class="flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <Avatar
                              name={clientLabel(c)}
                              size="w-8 h-8"
                              textSize="text-[10px]"
                            />
                            <span class="min-w-0 flex-1">
                              <span class="block text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                                {clientLabel(c)}
                              </span>
                              {/* Email first, badges after: the address is what
                                  identifies the row, so it keeps the left edge
                                  and the labels trail it. */}
                              <span class="flex items-center gap-1.5 mt-0.5 min-w-0">
                                <span class="text-xs text-[#8593A8] truncate">
                                  {c.email ?? ""}
                                </span>
                                <ClientTypeBadge type={c.clientType} />
                                <InactiveBadge isActive={c.isActive} />
                              </span>
                            </span>
                            <span class="flex-none flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setHistory({
                                    scope: "client",
                                    id: c.clientId,
                                    label: clientLabel(c),
                                  })
                                }
                                class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition"
                              >
                                History
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  ask("unassign", c, selectedCm())
                                }
                                class="px-3 py-1.5 rounded-lg border border-[#AC2334]/30 text-xs font-semibold text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/20 transition"
                              >
                                Remove
                              </button>
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>

                {/* Add client */}
                <div class="mt-6 pt-5 border-t border-[#E2E8F1] dark:border-gray-700">
                  <SectionTitle>Add a client</SectionTitle>
                  <input
                    type="text"
                    value={addClientSearch()}
                    onInput={(e) => setAddClientSearch(e.target.value)}
                    placeholder="Search clients not assigned to this manager…"
                    class={`${FIELD} mb-2`}
                  />
                  <div class="max-h-64 overflow-y-auto border border-[#E2E8F1] dark:border-gray-700 rounded-xl divide-y divide-[#E2E8F1] dark:divide-gray-700">
                    <Show
                      when={clientCandidates().length}
                      fallback={
                        <p class="px-3.5 py-3 text-sm text-[#8593A8]">
                          {clients().length
                            ? "No unassigned clients match."
                            : "No clients available."}
                        </p>
                      }
                    >
                      <For each={clientCandidates()}>
                        {(c) => (
                          <div class="flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <Avatar
                              name={clientLabel(c)}
                              size="w-8 h-8"
                              textSize="text-[10px]"
                            />
                            <span class="min-w-0 flex-1">
                              <span class="block text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                                {clientLabel(c)}
                              </span>
                              <span class="flex items-center gap-1.5 mt-0.5 min-w-0">
                                <span class="text-xs text-[#8593A8] truncate">
                                  {c.cmCount} CM
                                </span>
                                <ClientTypeBadge type={c.clientType} />
                                <InactiveBadge isActive={c.isActive} />
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => ask("assign", c, selectedCm())}
                              class="flex-none px-3 py-1.5 rounded-lg bg-[#15966A] text-white text-xs font-semibold hover:bg-[#0F7A55] transition"
                            >
                              Assign
                            </button>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              </div>
            </Show>
          </Show>

          {/* ─────────── BY CLIENT ─────────── */}
          <Show when={tab() === "client"}>
            <Show
              when={selectedClient()}
              fallback={
                <EmptyPanel
                  title="No client selected"
                  hint="Pick a client on the left to see and change the campaign managers on it."
                />
              }
            >
              <div class={`${CARD} p-5 sm:p-6`}>
                <div class="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#E2E8F1] dark:border-gray-700">
                  <div class="flex items-start gap-3 min-w-0">
                    <Avatar
                      name={clientLabel(selectedClient())}
                      size="w-11 h-11"
                      textSize="text-sm"
                    />
                    <div class="min-w-0">
                      <h2 class="text-lg font-bold text-[#14233A] dark:text-white break-all">
                        {clientLabel(selectedClient())}
                      </h2>
                      <div class="flex items-center gap-2 mt-1">
                        <Show when={selectedClient().email}>
                          <span class="text-sm text-[#54657E] dark:text-gray-400 break-all">
                            {selectedClient().email}
                          </span>
                        </Show>
                        <ClientTypeBadge type={selectedClient().clientType} />
                        <InactiveBadge isActive={selectedClient().isActive} />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setHistory({
                        scope: "client",
                        id: selectedClient().clientId,
                        label: clientLabel(selectedClient()),
                      })
                    }
                    class="flex-none px-3.5 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition"
                  >
                    History
                  </button>
                </div>

                {/* Same caveat from the client's side: the managers listed are
                    the ones ASSIGNED, which is not the full set who can see it. */}
                <p class="mt-4 rounded-lg bg-[#F0F4F9] dark:bg-gray-700/50 px-3.5 py-2.5 text-xs text-[#54657E] dark:text-gray-300">
                  These are the managers assigned to this client. A tier-1 lead
                  whose tier-2 report is listed here can also see it without
                  appearing in this list.
                </p>

                {/* Assigned managers */}
                <div class="mt-5">
                  <SectionTitle>
                    Campaign managers ({selectedClient().cmCount})
                  </SectionTitle>
                  <Show
                    when={selectedClient().campaignManagers.length}
                    fallback={
                      <p class="text-sm text-[#8593A8] py-2">
                        No campaign managers assigned yet.
                      </p>
                    }
                  >
                    <ul class="divide-y divide-[#E2E8F1] dark:divide-gray-700 border border-[#E2E8F1] dark:border-gray-700 rounded-xl overflow-hidden">
                      <For each={selectedClient().campaignManagers}>
                        {(m) => (
                          <li class="flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <Avatar
                              name={cmLabel(m)}
                              size="w-8 h-8"
                              textSize="text-[10px]"
                            />
                            <span class="min-w-0 flex-1">
                              <span class="block text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                                {cmLabel(m)}
                              </span>
                              <span class="flex items-center gap-1.5 mt-0.5 min-w-0">
                                <Show when={m.name}>
                                  <span class="text-xs text-[#8593A8] truncate">
                                    {m.name}
                                  </span>
                                </Show>
                                <TierBadge tier={m.tier} />
                                <InactiveBadge isActive={m.isActive} />
                              </span>
                            </span>
                            <span class="flex-none flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setHistory({
                                    scope: "cm",
                                    id: m.cmId,
                                    label: cmLabel(m),
                                  })
                                }
                                class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition"
                              >
                                History
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  ask("unassign", selectedClient(), m)
                                }
                                class="px-3 py-1.5 rounded-lg border border-[#AC2334]/30 text-xs font-semibold text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/20 transition"
                              >
                                Remove
                              </button>
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>

                {/* Add campaign manager */}
                <div class="mt-6 pt-5 border-t border-[#E2E8F1] dark:border-gray-700">
                  <SectionTitle>Add a campaign manager</SectionTitle>
                  <input
                    type="text"
                    value={addCmSearch()}
                    onInput={(e) => setAddCmSearch(e.target.value)}
                    placeholder="Search managers not on this client…"
                    class={`${FIELD} mb-2`}
                  />
                  <div class="max-h-64 overflow-y-auto border border-[#E2E8F1] dark:border-gray-700 rounded-xl divide-y divide-[#E2E8F1] dark:divide-gray-700">
                    <Show
                      when={cmCandidates().length}
                      fallback={
                        <p class="px-3.5 py-3 text-sm text-[#8593A8]">
                          {managers().length
                            ? "No unassigned managers match."
                            : "No campaign managers available."}
                        </p>
                      }
                    >
                      <For each={cmCandidates()}>
                        {(m) => (
                          <div class="flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <Avatar
                              name={cmLabel(m)}
                              size="w-8 h-8"
                              textSize="text-[10px]"
                            />
                            <span class="min-w-0 flex-1">
                              <span class="block text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                                {cmLabel(m)}
                              </span>
                              <span class="flex items-center gap-1.5 mt-0.5 min-w-0">
                                <span class="text-xs text-[#8593A8]">
                                  {m.clientCount} clients
                                </span>
                                <TierBadge tier={m.tier} />
                                <InactiveBadge isActive={m.isActive} />
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                ask("assign", selectedClient(), m)
                              }
                              class="flex-none px-3 py-1.5 rounded-lg bg-[#15966A] text-white text-xs font-semibold hover:bg-[#0F7A55] transition"
                            >
                              Assign
                            </button>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </div>

      <AssignmentConfirmModal
        pending={pending()}
        busy={busy()}
        error={actionError()}
        onConfirm={runAction}
        onClose={() => setPending(null)}
      />

      <AssignmentHistoryDrawer
        target={history()}
        onClose={() => setHistory(null)}
      />
    </section>
  );
}
