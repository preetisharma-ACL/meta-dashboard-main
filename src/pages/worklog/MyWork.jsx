import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchMyWork } from "../../services/worklog";
import { currentUser, isGlobalRead } from "../../stores/currentUser";
import LogComplaintModal from "../../components/worklog/LogComplaintModal";
import AssignTaskModal from "../../components/worklog/AssignTaskModal";
import {
  CATEGORY_LABEL,
  humanize,
  fmtDate,
  levelClassOf,
  statusClassOf,
  initialsOf,
} from "../../components/worklog/worklogTokens";

// My Work uses only the two project theme colours, so its avatars are drawn
// from blue-900 / #AC2334 instead of the shared forest/gold/clay palette.
const BRAND_AVATAR = ["#1e3a8a", "#AC2334"];
const brandAvatar = (seed) => {
  const s = String(seed ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return BRAND_AVATAR[h % BRAND_AVATAR.length];
};

// ─── My Work — unified task + complaint queue ─────────────────────────────────
// Renders GET /worklog/my-work/?view=own|all exactly as the backend sorts it
// (most urgent first — we never re-sort). Styled to Alok's approved
// forest/gold/clay prototype (scoped .wl theme).

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default function MyWork() {
  const navigate = useNavigate();
  // isGlobalRead() has a localStorage fallback, so seniors get the "All clients"
  // control (and default) even before /auth/me resolves.
  const canSeeAll = () => isGlobalRead();

  // Default to "All clients" for seniors; everyone else starts on "Mine".
  const [view, setView] = createSignal(canSeeAll() ? "all" : "own"); // "own" | "assigned_by_me" | "all"
  const [typeFilter, setTypeFilter] = createSignal("all"); // all | task | complaint
  const [statusFilter, setStatusFilter] = createSignal("all"); // all | open | in_progress | overdue | resolved

  const [data, { refetch }] = createResource(view, (v) => fetchMyWork({ view: v }));

  // Create actions — the modals carry their own client picker (no client is in
  // scope here). One overlay signal → only one modal open at a time.
  const [overlay, setOverlay] = createSignal(null); // null | "log" | "assign"
  const closeOverlay = () => setOverlay(null);

  const items = () => data()?.items ?? [];
  const meta = () =>
    data()?.meta ?? { total: 0, taskCount: 0, complaintCount: 0, overdueCount: 0 };

  // Status buckets for the summary tiles (computed from the queue itself).
  const bucketOf = (it) => {
    if (it.overdue) return "overdue";
    const s = String(it.status ?? "").toLowerCase();
    if (s === "in_progress" || s === "progress") return "in_progress";
    if (s === "done" || s === "resolved" || s === "closed") return "resolved";
    return "open";
  };
  const counts = createMemo(() => {
    const c = { open: 0, in_progress: 0, overdue: 0, resolved: 0 };
    for (const it of items()) c[bucketOf(it)]++;
    return c;
  });

  // Type + status filters (client-side; backend order preserved).
  const visible = createMemo(() => {
    const t = typeFilter();
    const s = statusFilter();
    return items().filter((it) => {
      if (t !== "all" && it.kind !== t) return false;
      if (s !== "all" && bucketOf(it) !== s) return false;
      return true;
    });
  });

  const openItem = (it) => {
    if (it.clientNomen == null) return;
    const params = new URLSearchParams();
    if (it.clientNomenName) params.set("name", it.clientNomenName);
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

  const SegBtn = (props) => (
    <button
      class={typeFilter() === props.value ? "on" : ""}
      onClick={() => setTypeFilter(props.value)}
    >
      {props.label}
    </button>
  );

  return (
    <section class="wl wl-brand">
      <div class="content">
        {/* ════════ LEAD ════════ */}
        <div class="lead">
          <div>
            <h2>My work</h2>
            <p>
              Every task and complaint across your clients in one queue, most
              urgent first.
            </p>
          </div>
          <div class="actions">
            <button class="btn-soft" onClick={() => setOverlay("log")}>
              <PlusIcon />
              Log complaint
            </button>
            <button class="btn-primary" onClick={() => setOverlay("assign")}>
              <PlusIcon />
              Assign task
            </button>
          </div>
        </div>

        {/* View segment — All clients (senior only) · By me (tasks I delegated) · Mine */}
        <div style="margin-top:12px">
          <div class="seg">
            <Show when={canSeeAll()}>
              <button class={view() === "all" ? "on" : ""} onClick={() => setView("all")}>
                All clients
              </button>
            </Show>
            <button
              class={view() === "assigned_by_me" ? "on" : ""}
              onClick={() => setView("assigned_by_me")}
              title="Tasks you created for someone else"
            >
              By me
            </button>
            <button class={view() === "own" ? "on" : ""} onClick={() => setView("own")}>
              Mine
            </button>
          </div>
        </div>

        {/* ════════ SUMMARY TILES ════════ */}
        <div class="summary">
          <div class="tile">
            <div class="n">{counts().open}</div>
            <div class="l"><i style="background:var(--slate)" />To do</div>
          </div>
          <div class="tile">
            <div class="n">{counts().in_progress}</div>
            <div class="l"><i style="background:var(--warn)" />In progress</div>
          </div>
          <div class="tile">
            <div class="n">{counts().overdue}</div>
            <div class="l"><i style="background:var(--clay)" />Overdue</div>
          </div>
          <div class="tile">
            <div class="n">{counts().resolved}</div>
            <div class="l"><i style="background:var(--ok)" />Resolved</div>
          </div>
        </div>

        {/* ════════ FILTERS ════════ */}
        <div class="filters">
          <div class="fgroup">
            <label>Type</label>
            <div class="seg">
              <SegBtn value="all" label={`All${meta().total ? " · " + meta().total : ""}`} />
              <SegBtn value="task" label="Tasks" />
              <SegBtn value="complaint" label="Complaints" />
            </div>
          </div>
          <div class="fgroup">
            <label>Status</label>
            <select value={statusFilter()} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="open">To do</option>
              <option value="in_progress">In progress</option>
              <option value="overdue">Overdue</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </div>

        {/* ════════ FEED ════════ */}
        <Show when={data.error}>
          <div class="empty">
            <b>Couldn't load your work queue</b>
            Please try again in a moment.
          </div>
        </Show>

        <Show
          when={!data.loading}
          fallback={
            <div class="clist">
              <For each={Array(5).fill(0)}>{() => <div class="skel" />}</For>
            </div>
          }
        >
          <Show
            when={visible().length > 0}
            fallback={
              <div class="empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <b>{view() === "assigned_by_me" ? "No tasks delegated" : "Nothing in your queue"}</b>
                {typeFilter() !== "all" || statusFilter() !== "all"
                  ? "No items match these filters."
                  : view() === "assigned_by_me"
                    ? "You haven't assigned any open tasks to others."
                    : "You're all caught up. 🎉"}
              </div>
            }
          >
            <div class="clist">
              <For each={visible()}>
                {(it) => {
                  const name = it.clientNomenName ?? `Client #${it.clientNomen ?? "—"}`;
                  const bucket = bucketOf(it);
                  return (
                    <div class="card clickable" onClick={() => openItem(it)}>
                      <div class="card-top">
                        <span class="actor">
                          <span class="av" style={`background:${brandAvatar(name)}`}>
                            {initialsOf(name)}
                          </span>
                          <b>{name}</b>
                        </span>
                        <span class="rolechip">{it.kind}</span>
                        <span class="time">{it.dueDate ? fmtDate(it.dueDate) : "—"}</span>
                      </div>
                      <div class="title">{it.title}</div>
                      <Show when={it.category || it.assigneeEmail}>
                        <div class="desc">
                          <Show when={it.category}>
                            {CATEGORY_LABEL[it.category] ?? humanize(it.category)}
                          </Show>
                          <Show when={it.category && it.assigneeEmail}>{" · "}</Show>
                          <Show when={it.assigneeEmail}>{it.assigneeEmail}</Show>
                        </div>
                      </Show>
                      <div class="badges">
                        <Show when={bucket === "overdue"}>
                          <span class="pill overdue">Overdue</span>
                        </Show>
                        <Show when={it.status}>
                          <span class={`pill ${statusClassOf(it.status)}`}>
                            {humanize(it.status)}
                          </span>
                        </Show>
                        <Show when={it.level}>
                          <span class={`pill ${it.kind === "complaint" ? "sev" : "prio"} ${levelClassOf(it.level)}`}>
                            {humanize(it.level)}
                          </span>
                        </Show>
                        <span class="openhint">
                          Open
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* ════════ CREATE OVERLAYS ════════ */}
      <Show when={overlay() === "log"}>
        <LogComplaintModal brand onClose={closeOverlay} onCreated={() => refetch()} />
      </Show>
      <Show when={overlay() === "assign"}>
        <AssignTaskModal brand onClose={closeOverlay} onCreated={() => refetch()} />
      </Show>
    </section>
  );
}
