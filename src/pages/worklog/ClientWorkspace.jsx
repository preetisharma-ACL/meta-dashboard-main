import {
  createSignal,
  createResource,
  createMemo,
  createEffect,
  on,
  For,
  Show,
  onMount,
} from "solid-js";
import { A, useParams, useSearchParams } from "@solidjs/router";
import {
  fetchClientActivity,
  fetchComplaints,
  fetchComplaint,
} from "../../services/worklog";
import { scopeKey } from "../../stores/cmScope";
import Avatar from "../../components/common/Avatar";
import LogComplaintModal from "../../components/worklog/LogComplaintModal";
import AssignTaskModal from "../../components/worklog/AssignTaskModal";
import ResolveComplaintModal from "../../components/worklog/ResolveComplaintModal";
import ComplaintDetailModal from "../../components/worklog/ComplaintDetailModal";
import {
  NODE_DOT,
  NODE_TEXT,
  STATUS_CHIP,
  LEVEL_CHIP,
  CATEGORY_LABEL,
  humanize,
  fmtRelative,
  fmtDateTime,
} from "../../components/worklog/worklogTokens";

// ─── Client Workspace — per-client Activity + Complaints ──────────────────────
// Route: /client-workspace/:nomenId  (?tab=activity|complaints&complaint=<id>&name=<label>)
// Two tabs from the mock: the merged Activity timeline (green = Meta/campaign
// change, gold = team task, clay = complaint milestone) and per-client Complaint
// management (list + Log/Resolve/assign-task flows). A single `overlay` signal
// guarantees only one modal is ever open.

// Activity Type filter → node colour (the mock's All/Tasks/Changes/Complaints).
const ACTIVITY_FILTERS = [
  { key: "all", label: "All", node: null },
  { key: "task", label: "Tasks", node: "gold" },
  { key: "changes", label: "Changes", node: "green" },
  { key: "complaint", label: "Complaints", node: "clay" },
];

export default function ClientWorkspace() {
  const params = useParams();
  const [search] = useSearchParams();
  const nomenId = () => params.nomenId;

  const [tab, setTab] = createSignal(
    search.tab === "complaints" ? "complaints" : "activity",
  );
  const [activityFilter, setActivityFilter] = createSignal("all");

  // Refresh nonces — bumped after mutations to re-pull the affected surface.
  const [activityNonce, setActivityNonce] = createSignal(0);
  const [complaintsNonce, setComplaintsNonce] = createSignal(0);
  const bumpActivity = () => setActivityNonce((n) => n + 1);
  const bumpComplaints = () => setComplaintsNonce((n) => n + 1);

  // Inline complaint edits (status/severity/owner/resolve) layer over the list
  // without a refetch; a full refetch (create) clears them (fresh data wins).
  const [patches, setPatches] = createSignal({});
  const applyPatch = (c) => c && setPatches((p) => ({ ...p, [c.id]: c }));

  // ── Resources ──
  const [activity] = createResource(
    () => ({ id: nomenId(), n: activityNonce() }),
    ({ id }) => fetchClientActivity(id),
  );

  const [complaintsRes] = createResource(
    () => ({ id: nomenId(), n: complaintsNonce(), scope: scopeKey() }),
    ({ id }) => fetchComplaints({ clientNomen: id }),
  );

  // A fresh complaints pull supersedes any inline patches.
  createEffect(
    on(complaintsRes, () => setPatches({}), { defer: true }),
  );

  const complaints = createMemo(() => {
    const list = complaintsRes()?.complaints ?? [];
    const p = patches();
    return list.map((c) => p[c.id] ?? c);
  });

  const openComplaintCount = () =>
    complaints().filter((c) => c.status !== "resolved" && c.status !== "closed").length;

  const clientName = () =>
    search.name ||
    complaints()[0]?.clientNomenName ||
    activity()?.entries?.[0]?.meta?.client_nomen_name ||
    `Client #${nomenId()}`;

  // ── Overlay (single active modal) ──
  const [overlay, setOverlay] = createSignal(null);
  const close = () => setOverlay(null);

  const openComplaintById = async (id) => {
    // Prefer the row we already have; otherwise fetch it.
    const existing = complaints().find((c) => String(c.id) === String(id));
    if (existing) {
      setOverlay({ type: "detail", complaint: existing });
      return;
    }
    try {
      const c = await fetchComplaint(id);
      if (c) setOverlay({ type: "detail", complaint: c });
    } catch {
      /* ignore — deep-link to a complaint we can't see */
    }
  };

  // Deep-link: ?complaint=<id> opens that complaint on load.
  onMount(() => {
    if (search.complaint) openComplaintById(search.complaint);
  });

  // ── Timeline ──
  const timeline = createMemo(() => {
    const node = ACTIVITY_FILTERS.find((f) => f.key === activityFilter())?.node;
    const entries = activity()?.entries ?? [];
    return node ? entries.filter((e) => e.node === node) : entries;
  });

  const aMeta = () => activity()?.meta ?? { greenCount: 0, goldCount: 0, clayCount: 0, total: 0 };

  return (
    <section class="w-full px-4 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <A
        href="/my-work"
        class="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8593A8] dark:text-gray-500 hover:text-[#AC2334] mb-3"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        My Work
      </A>

      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div class="flex items-center gap-3 min-w-0">
          <Avatar name={clientName()} size="w-11 h-11" textSize="text-sm" />
          <div class="min-w-0">
            <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-0.5">
              Client workspace
            </p>
            <h1 class="text-2xl font-bold text-[#14233A] dark:text-white truncate">
              {clientName()}
            </h1>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setOverlay({ type: "assign" })}
            class="px-4 py-2 text-sm font-bold rounded-lg border border-[#3E6FB0]/40 text-[#3E6FB0] dark:text-blue-300 hover:bg-[#ECF2FA] dark:hover:bg-blue-900/20"
          >
            Assign task
          </button>
          <button
            onClick={() => setOverlay({ type: "log" })}
            class="px-4 py-2 text-sm font-bold rounded-lg bg-[#AC2334] text-white hover:bg-[#951d2c]"
          >
            Log complaint
          </button>
        </div>
      </div>

      {/* ════════ TABS ════════ */}
      <div class="inline-flex gap-1 p-1 bg-[#EEF2F7] dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 mb-6">
        <button
          onClick={() => setTab("activity")}
          class={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
            tab() === "activity"
              ? "bg-white dark:bg-gray-700 text-[#14233A] dark:text-gray-100 shadow-sm"
              : "text-[#54657E] dark:text-gray-400 hover:text-[#AC2334]"
          }`}
        >
          Activity
        </button>
        <button
          onClick={() => setTab("complaints")}
          class={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5 ${
            tab() === "complaints"
              ? "bg-white dark:bg-gray-700 text-[#14233A] dark:text-gray-100 shadow-sm"
              : "text-[#54657E] dark:text-gray-400 hover:text-[#AC2334]"
          }`}
        >
          Complaints
          <Show when={openComplaintCount() > 0}>
            <span class="inline-flex items-center justify-center min-w-[1.25rem] px-1.5 h-5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 text-xs font-bold">
              {openComplaintCount()}
            </span>
          </Show>
        </button>
      </div>

      {/* ════════ ACTIVITY TAB ════════ */}
      <Show when={tab() === "activity"}>
        {/* Type filter → node colour */}
        <div class="inline-flex gap-1 p-1 bg-[#EEF2F7] dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 mb-5">
          <For each={ACTIVITY_FILTERS}>
            {(f) => (
              <button
                onClick={() => setActivityFilter(f.key)}
                class={`px-3.5 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5 ${
                  activityFilter() === f.key
                    ? "bg-white dark:bg-gray-700 text-[#14233A] dark:text-gray-100 shadow-sm"
                    : "text-[#54657E] dark:text-gray-400 hover:text-[#AC2334]"
                }`}
              >
                <Show when={f.node}>
                  <span class={`w-2 h-2 rounded-full ${NODE_DOT[f.node]}`} />
                </Show>
                {f.label}
              </button>
            )}
          </For>
        </div>

        <Show when={activity.error}>
          <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
            Failed to load the activity timeline.
          </div>
        </Show>

        <Show
          when={!activity.loading}
          fallback={
            <div class="space-y-3">
              <For each={Array(5).fill(0)}>
                {() => <div class="h-14 rounded-xl bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 animate-pulse" />}
              </For>
            </div>
          }
        >
          <Show
            when={timeline().length > 0}
            fallback={
              <div class="bg-white dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 p-10 text-center text-sm text-[#8593A8] dark:text-gray-500">
                No activity{activityFilter() !== "all" ? " for this filter" : " yet"}.
              </div>
            }
          >
            {/* Vertical timeline */}
            <div class="relative pl-6">
              <span class="absolute left-[7px] top-1 bottom-1 w-px bg-[#E2E8F1] dark:bg-gray-700" />
              <ul class="space-y-4">
                <For each={timeline()}>
                  {(e) => {
                    const clickable = e.refType === "complaint" && e.refId != null;
                    return (
                      <li class="relative">
                        <span
                          class={`absolute -left-[22px] top-1.5 w-3.5 h-3.5 rounded-full ring-4 ring-gray-50 dark:ring-gray-900 ${NODE_DOT[e.node] ?? "bg-gray-400"}`}
                        />
                        <div
                          onClick={clickable ? () => openComplaintById(e.refId) : undefined}
                          class={`rounded-xl border bg-white dark:bg-gray-800 border-[#E2E8F1] dark:border-gray-700 px-4 py-3 ${
                            clickable ? "cursor-pointer hover:border-orange-300 hover:shadow-sm transition-all" : ""
                          }`}
                        >
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <p class="text-sm font-semibold text-[#14233A] dark:text-gray-100">
                                {e.title}
                              </p>
                              <p class="text-xs text-[#8593A8] dark:text-gray-500 mt-0.5">
                                <span class={`font-bold uppercase tracking-wide ${NODE_TEXT[e.node] ?? "text-gray-400"}`}>
                                  {humanize(e.kind)}
                                </span>
                                <Show when={e.actor}>
                                  {" · "}
                                  {e.actor}
                                </Show>
                              </p>
                            </div>
                            <span
                              class="text-xs text-[#8593A8] dark:text-gray-500 whitespace-nowrap flex-shrink-0"
                              title={fmtDateTime(e.timestamp)}
                            >
                              {fmtRelative(e.timestamp)}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </div>
          </Show>
        </Show>
      </Show>

      {/* ════════ COMPLAINTS TAB ════════ */}
      <Show when={tab() === "complaints"}>
        <Show when={complaintsRes.error}>
          <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
            Failed to load complaints.
          </div>
        </Show>

        <Show
          when={!complaintsRes.loading}
          fallback={
            <div class="space-y-2">
              <For each={Array(4).fill(0)}>
                {() => <div class="h-20 rounded-xl bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 animate-pulse" />}
              </For>
            </div>
          }
        >
          <Show
            when={complaints().length > 0}
            fallback={
              <div class="bg-white dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 p-10 text-center">
                <p class="text-sm text-[#8593A8] dark:text-gray-500 mb-3">
                  No complaints logged for this client.
                </p>
                <button
                  onClick={() => setOverlay({ type: "log" })}
                  class="px-4 py-2 text-sm font-bold rounded-lg bg-[#AC2334] text-white hover:bg-[#951d2c]"
                >
                  Log complaint
                </button>
              </div>
            }
          >
            <ul class="space-y-2">
              <For each={complaints()}>
                {(c) => (
                  <li>
                    <button
                      onClick={() => setOverlay({ type: "detail", complaint: c })}
                      class="w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-orange-300 hover:shadow-sm transition-all"
                    >
                      <span class={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${NODE_DOT.clay}`} />
                      <div class="min-w-0 flex-1">
                        <p class="font-semibold text-[#14233A] dark:text-gray-100 truncate">
                          {c.title}
                        </p>
                        <div class="flex items-center gap-2 flex-wrap mt-1">
                          <span class={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_CHIP[c.status] ?? STATUS_CHIP.open}`}>
                            {humanize(c.status)}
                          </span>
                          <Show when={c.severity}>
                            <span class={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${LEVEL_CHIP[c.severity] ?? LEVEL_CHIP.low}`}>
                              {c.severity}
                            </span>
                          </Show>
                          <Show when={c.category}>
                            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {CATEGORY_LABEL[c.category] ?? humanize(c.category)}
                            </span>
                          </Show>
                          <Show when={c.openTaskCount > 0}>
                            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              {c.openTaskCount} task{c.openTaskCount !== 1 ? "s" : ""}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <span class="text-xs text-[#8593A8] dark:text-gray-500 whitespace-nowrap flex-shrink-0">
                        {fmtRelative(c.createdAt)}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>

      {/* ════════ OVERLAYS ════════ */}
      <Show when={overlay()?.type === "log"}>
        <LogComplaintModal
          clientNomen={nomenId()}
          clientName={clientName()}
          onClose={close}
          onCreated={() => {
            bumpComplaints();
            bumpActivity();
            setTab("complaints");
          }}
        />
      </Show>

      <Show when={overlay()?.type === "assign"}>
        <AssignTaskModal
          clientNomen={nomenId()}
          clientName={clientName()}
          sourceComplaint={overlay().sourceComplaint}
          onClose={close}
          onCreated={() => {
            bumpActivity();
            bumpComplaints();
          }}
        />
      </Show>

      <Show when={overlay()?.type === "detail"}>
        <ComplaintDetailModal
          complaint={overlay().complaint}
          clientName={clientName()}
          onClose={close}
          onChanged={applyPatch}
          onRequestResolve={(c) => setOverlay({ type: "resolve", complaint: c })}
          onRequestTask={(c) => setOverlay({ type: "assign", sourceComplaint: c.id })}
        />
      </Show>

      <Show when={overlay()?.type === "resolve"}>
        <ResolveComplaintModal
          complaint={overlay().complaint}
          onClose={close}
          onResolved={(c) => {
            applyPatch(c);
            bumpActivity();
          }}
        />
      </Show>
    </section>
  );
}
