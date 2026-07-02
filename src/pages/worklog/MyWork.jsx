import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchMyWork } from "../../services/worklog";
import { currentUser } from "../../stores/currentUser";
import {
  kindNode,
  NODE_DOT,
  LEVEL_CHIP,
  CATEGORY_LABEL,
  humanize,
  fmtDate,
} from "../../components/worklog/worklogTokens";

// ─── My Work — unified task + complaint queue ─────────────────────────────────
// Renders GET /worklog/my-work/?view=own|all exactly as the backend sorts it
// (most urgent first — we never re-sort). The Type filter narrows client-side on
// item.kind; the queue already carries both kinds so it needs no re-fetch.
//
// view=all ("everyone's open items") only works for senior roles
// (admin/coordination/accounts); a regular CM always sees their own, so the
// segment's "All clients" option is only offered to those roles.

// Senior roles that may view the whole team's queue.
const SENIOR_ROLES = new Set(["admin", "coordination", "accounts"]);

export default function MyWork() {
  const navigate = useNavigate();
  const canSeeAll = () => SENIOR_ROLES.has(currentUser.role);

  const [view, setView] = createSignal("own"); // "own" | "all"
  const [typeFilter, setTypeFilter] = createSignal("all"); // all | task | complaint

  const [data] = createResource(view, (v) => fetchMyWork({ view: v }));

  const items = () => data()?.items ?? [];
  const meta = () => data()?.meta ?? { total: 0, taskCount: 0, complaintCount: 0, overdueCount: 0 };

  // Client-side Type filter — order preserved (backend already sorted).
  const visible = createMemo(() => {
    const t = typeFilter();
    if (t === "all") return items();
    return items().filter((it) => it.kind === t);
  });

  const openItem = (it) => {
    if (it.clientNomen == null) return;
    const params = new URLSearchParams();
    if (it.clientNomenName) params.set("name", it.clientNomenName);
    // A complaint opens its own record; a task opens the complaint it resolves
    // (if any), otherwise the client's activity timeline.
    if (it.kind === "complaint") {
      params.set("tab", "complaints");
      params.set("complaint", String(it.id));
    } else if (it.fromComplaint != null) {
      params.set("tab", "complaints");
      params.set("complaint", String(it.fromComplaint));
    } else {
      params.set("tab", "activity");
    }
    navigate(`/client-workspace/${it.clientNomen}?${params.toString()}`);
  };

  const TypeTab = (props) => (
    <button
      onClick={() => setTypeFilter(props.value)}
      class={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
        typeFilter() === props.value
          ? "bg-white dark:bg-gray-700 text-[#14233A] dark:text-gray-100 shadow-sm"
          : "text-[#54657E] dark:text-gray-400 hover:text-[#AC2334] dark:hover:text-gray-200"
      }`}
    >
      {props.label}
      <Show when={props.count != null}>
        <span class="ml-1.5 text-xs font-bold text-[#8593A8]">{props.count}</span>
      </Show>
    </button>
  );

  return (
    <section class="w-full px-4 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Client workspace · My Work
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1 flex items-center gap-3">
            My Work
            <span class="inline-flex items-center justify-center min-w-[2rem] px-2.5 h-7 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-sm font-bold tabular-nums">
              {meta().total}
            </span>
          </h1>
          <p class="text-sm text-[#54657E] dark:text-gray-400">
            {view() === "all" ? "Everyone's open items" : currentUser.email || "Your open items"}
          </p>
        </div>

        {/* View segment — Mine vs All clients (senior only) */}
        <Show when={canSeeAll()}>
          <div class="inline-flex gap-1 p-1 bg-[#EEF2F7] dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 self-start">
            <button
              onClick={() => setView("own")}
              class={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                view() === "own"
                  ? "bg-white dark:bg-gray-700 text-[#14233A] dark:text-gray-100 shadow-sm"
                  : "text-[#54657E] dark:text-gray-400 hover:text-[#AC2334]"
              }`}
            >
              Mine
            </button>
            <button
              onClick={() => setView("all")}
              class={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                view() === "all"
                  ? "bg-white dark:bg-gray-700 text-[#14233A] dark:text-gray-100 shadow-sm"
                  : "text-[#54657E] dark:text-gray-400 hover:text-[#AC2334]"
              }`}
            >
              All clients
            </button>
          </div>
        </Show>
      </div>

      {/* ════════ TYPE FILTER + OVERDUE ════════ */}
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <div class="inline-flex gap-1 p-1 bg-[#EEF2F7] dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700">
          <TypeTab value="all" label="All" count={meta().total} />
          <TypeTab value="task" label="Tasks" count={meta().taskCount} />
          <TypeTab value="complaint" label="Complaints" count={meta().complaintCount} />
        </div>
        <Show when={meta().overdueCount > 0}>
          <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800">
            <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {meta().overdueCount} overdue
          </span>
        </Show>
      </div>

      {/* ════════ ERROR ════════ */}
      <Show when={data.error}>
        <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
          Failed to load your work queue. Please try again.
        </div>
      </Show>

      {/* ════════ QUEUE ════════ */}
      <Show
        when={!data.loading}
        fallback={
          <div class="space-y-2">
            <For each={Array(6).fill(0)}>
              {() => (
                <div class="h-16 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 animate-pulse" />
              )}
            </For>
          </div>
        }
      >
        <Show
          when={visible().length > 0}
          fallback={
            <div class="bg-white dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 p-10 text-center text-sm text-[#8593A8] dark:text-gray-500">
              Nothing in your queue{typeFilter() !== "all" ? " for this filter" : ""}. 🎉
            </div>
          }
        >
          <ul class="space-y-2">
            <For each={visible()}>
              {(it) => {
                const node = kindNode(it.kind);
                return (
                  <li>
                    <button
                      onClick={() => openItem(it)}
                      class={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border bg-white dark:bg-gray-800 hover:shadow-sm transition-all ${
                        it.overdue
                          ? "border-red-300 dark:border-red-800 ring-1 ring-red-200 dark:ring-red-900/40"
                          : "border-[#E2E8F1] dark:border-gray-700 hover:border-[#AC2334]/30"
                      }`}
                    >
                      {/* Node colour by kind */}
                      <span
                        class={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${NODE_DOT[node]}`}
                        title={it.kind}
                      />

                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="font-semibold text-[#14233A] dark:text-gray-100 truncate">
                            {it.title}
                          </span>
                          <span class="text-[10px] font-bold uppercase tracking-wide text-[#8593A8] dark:text-gray-500">
                            {it.kind}
                          </span>
                          <Show when={it.overdue}>
                            <span class="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                              Overdue
                            </span>
                          </Show>
                        </div>
                        <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5 truncate">
                          {it.clientNomenName ?? `Client #${it.clientNomen ?? "—"}`}
                          <Show when={it.category}>
                            {" · "}
                            {CATEGORY_LABEL[it.category] ?? humanize(it.category)}
                          </Show>
                          <Show when={it.assigneeEmail}>
                            {" · "}
                            {it.assigneeEmail}
                          </Show>
                        </p>
                      </div>

                      {/* Level chip */}
                      <Show when={it.level}>
                        <span
                          class={`flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                            LEVEL_CHIP[it.level] ?? LEVEL_CHIP.low
                          }`}
                        >
                          {it.level}
                        </span>
                      </Show>

                      {/* Due date */}
                      <span
                        class={`flex-shrink-0 text-xs font-medium whitespace-nowrap ${
                          it.overdue
                            ? "text-red-600 dark:text-red-400"
                            : "text-[#8593A8] dark:text-gray-500"
                        }`}
                      >
                        {it.dueDate ? fmtDate(it.dueDate) : "—"}
                      </span>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  );
}
