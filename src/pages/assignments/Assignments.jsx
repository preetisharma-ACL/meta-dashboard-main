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
    `w-full text-left px-3.5 py-3 rounded-xl border transition ${
      active
        ? "border-[#AC2334] bg-[#FBEEF0] dark:bg-[#AC2334]/15 shadow-[inset_0_0_0_1px_rgba(172,35,52,.25)]"
        : "border-transparent hover:bg-[#F6F9FC] dark:hover:bg-gray-700/40"
    }`;

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

      <div class="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
        {/* ════════ LEFT — ROSTER ════════ */}
        <div class={`${CARD} p-4`}>
          <Show
            when={tab() === "cm"}
            fallback={
              <>
                <SectionTitle
                  right={
                    <span class="text-xs text-[#8593A8]">
                      {filteredClients().length}/{clients().length}
                    </span>
                  }
                >
                  Clients
                </SectionTitle>
                <input
                  type="text"
                  value={clientSearch()}
                  onInput={(e) => setClientSearch(e.target.value)}
                  placeholder="Search by nomen or email…"
                  class={`${FIELD} mb-3`}
                />
                <div class="max-h-[62vh] overflow-y-auto space-y-1 -mx-1 px-1">
                  <Show when={data.loading && !clients().length}>
                    <p class="text-sm text-[#8593A8] px-2 py-3">
                      Loading clients…
                    </p>
                  </Show>
                  <Show when={!data.loading && !filteredClients().length}>
                    <p class="text-sm text-[#8593A8] px-2 py-3">
                      No clients match.
                    </p>
                  </Show>
                  <For each={filteredClients()}>
                    {(c) => (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClientId(c.clientId);
                          setAddCmSearch("");
                          setActionError(null);
                        }}
                        class={listRowClass(selectedClientId() === c.clientId)}
                      >
                        <div class="flex items-start justify-between gap-2">
                          <span class="min-w-0">
                            <span class="block text-sm font-semibold text-[#14233A] dark:text-gray-100 truncate">
                              {clientLabel(c)}
                            </span>
                            <span class="block text-xs text-[#8593A8] truncate">
                              {c.email ?? "—"}
                            </span>
                          </span>
                          <CountChip count={c.cmCount} label="CM" />
                        </div>
                        <div class="flex items-center gap-1.5 mt-1.5">
                          <ClientTypeBadge type={c.clientType} />
                          <InactiveBadge isActive={c.isActive} />
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </>
            }
          >
            <SectionTitle
              right={
                <span class="text-xs text-[#8593A8]">
                  {filteredManagers().length}/{managers().length}
                </span>
              }
            >
              Campaign managers
            </SectionTitle>
            <input
              type="text"
              value={cmSearch()}
              onInput={(e) => setCmSearch(e.target.value)}
              placeholder="Search by email or name…"
              class={`${FIELD} mb-3`}
            />
            <div class="max-h-[62vh] overflow-y-auto space-y-1 -mx-1 px-1">
              <Show when={data.loading && !managers().length}>
                <p class="text-sm text-[#8593A8] px-2 py-3">
                  Loading campaign managers…
                </p>
              </Show>
              <Show when={!data.loading && !filteredManagers().length}>
                <p class="text-sm text-[#8593A8] px-2 py-3">
                  No campaign managers match.
                </p>
              </Show>
              <For each={filteredManagers()}>
                {(m) => (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCmId(m.cmId);
                      setAddClientSearch("");
                      setActionError(null);
                    }}
                    class={listRowClass(selectedCmId() === m.cmId)}
                  >
                    <div class="flex items-start justify-between gap-2">
                      <span class="min-w-0">
                        <span class="block text-sm font-semibold text-[#14233A] dark:text-gray-100 truncate">
                          {m.email ?? m.name ?? `CM #${m.cmId}`}
                        </span>
                        <Show when={m.name && m.email}>
                          <span class="block text-xs text-[#8593A8] truncate">
                            {m.name}
                          </span>
                        </Show>
                      </span>
                      <CountChip count={m.clientCount} label="clients" />
                    </div>
                    <div class="flex items-center gap-1.5 mt-1.5">
                      <TierBadge tier={m.tier} />
                      <InactiveBadge isActive={m.isActive} />
                    </div>
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
                            <span class="min-w-0">
                              <span class="block text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                                {clientLabel(c)}
                              </span>
                              <span class="flex items-center gap-1.5 mt-0.5">
                                <ClientTypeBadge type={c.clientType} />
                                <InactiveBadge isActive={c.isActive} />
                                <span class="text-xs text-[#8593A8] truncate">
                                  {c.email ?? ""}
                                </span>
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
                            <span class="min-w-0">
                              <span class="block text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                                {clientLabel(c)}
                              </span>
                              <span class="flex items-center gap-1.5 mt-0.5">
                                <ClientTypeBadge type={c.clientType} />
                                <InactiveBadge isActive={c.isActive} />
                                <span class="text-xs text-[#8593A8] truncate">
                                  {c.cmCount} CM
                                </span>
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
                            <span class="min-w-0">
                              <span class="block text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                                {cmLabel(m)}
                              </span>
                              <span class="flex items-center gap-1.5 mt-0.5">
                                <TierBadge tier={m.tier} />
                                <InactiveBadge isActive={m.isActive} />
                                <Show when={m.name}>
                                  <span class="text-xs text-[#8593A8] truncate">
                                    {m.name}
                                  </span>
                                </Show>
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
                            <span class="min-w-0">
                              <span class="block text-sm font-medium text-[#14233A] dark:text-gray-100 truncate">
                                {cmLabel(m)}
                              </span>
                              <span class="flex items-center gap-1.5 mt-0.5">
                                <TierBadge tier={m.tier} />
                                <InactiveBadge isActive={m.isActive} />
                                <span class="text-xs text-[#8593A8]">
                                  {m.clientCount} clients
                                </span>
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
