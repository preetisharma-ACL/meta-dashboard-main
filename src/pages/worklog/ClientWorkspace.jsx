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
import LogComplaintModal from "../../components/worklog/LogComplaintModal";
import AssignTaskModal from "../../components/worklog/AssignTaskModal";
import ResolveComplaintModal from "../../components/worklog/ResolveComplaintModal";
import ComplaintDetailModal from "../../components/worklog/ComplaintDetailModal";
import {
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  humanize,
  fmtRelative,
  fmtDateTime,
  nodeClassOf,
  levelClassOf,
  statusClassOf,
  avatarColor,
  initialsOf,
} from "../../components/worklog/worklogTokens";

// ─── Client Workspace — per-client Activity + Complaints ──────────────────────
// Route: /client-workspace/:nomenId  (?tab=activity|complaints&complaint=<id>&name=<label>)
// Styled to Alok's approved forest/gold/clay prototype (scoped .wl theme). The
// merged Activity timeline uses the semantic node scheme (green = Meta/campaign
// change, gold = team task, clay = complaint milestone).

// Activity Type filter → node colour.
const ACTIVITY_FILTERS = [
  { key: "all", label: "All", node: null },
  { key: "task", label: "Tasks", node: "gold" },
  { key: "changes", label: "Changes", node: "green" },
  { key: "complaint", label: "Complaints", node: "clay" },
];

// Timeline node icon by semantic colour.
const NodeIcon = (props) => (
  <Show
    when={props.node === "clay"}
    fallback={
      <Show
        when={props.node === "gold"}
        fallback={
          // green (default) — Meta / campaign change
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
          </svg>
        }
      >
        {/* gold — task / comment */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M9 12h6M9 16h4" />
        </svg>
      </Show>
    }
  >
    {/* clay — complaint */}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m10.3 3.9-8 13.9A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  </Show>
);

// Day grouping for the timeline.
const startOfDay = (t) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const dayLabel = (iso) => {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return ["Undated", ""];
  const day = startOfDay(t);
  const today = startOfDay(Date.now());
  const diff = Math.round((today - day) / 86400000);
  const full = new Date(t).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  if (diff === 0) return ["Today", full];
  if (diff === 1) return ["Yesterday", full];
  const dow = new Date(t).toLocaleDateString("en-IN", { weekday: "long" });
  return [full, dow];
};

export default function ClientWorkspace() {
  const params = useParams();
  const [search] = useSearchParams();
  const nomenId = () => params.nomenId;

  // The workspace + worklog endpoints require the INTEGER nomen_id. Guard against
  // a hand-typed/stale URL carrying a client name/slug — skip the fetches (which
  // would 404 activity / 500 complaints) and show a clear message instead.
  const validNomenId = () =>
    /^\d+$/.test(String(params.nomenId ?? "").trim()) ? params.nomenId : null;

  const [tab, setTab] = createSignal(
    search.tab === "complaints" ? "complaints" : "activity",
  );
  const [activityFilter, setActivityFilter] = createSignal("all");
  const [cStatus, setCStatus] = createSignal("all");
  const [cCategory, setCCategory] = createSignal("all");

  // Refresh nonces — bumped after mutations to re-pull the affected surface.
  const [activityNonce, setActivityNonce] = createSignal(0);
  const [complaintsNonce, setComplaintsNonce] = createSignal(0);
  const bumpActivity = () => setActivityNonce((n) => n + 1);
  const bumpComplaints = () => setComplaintsNonce((n) => n + 1);

  // Inline complaint edits layer over the list without a refetch.
  const [patches, setPatches] = createSignal({});
  const applyPatch = (c) => c && setPatches((p) => ({ ...p, [c.id]: c }));

  // ── Resources (guarded on a numeric nomen) ──
  const [activity] = createResource(
    () => (validNomenId() ? { id: validNomenId(), n: activityNonce() } : null),
    ({ id }) => fetchClientActivity(id),
  );

  const [complaintsRes] = createResource(
    () =>
      validNomenId()
        ? { id: validNomenId(), n: complaintsNonce(), scope: scopeKey() }
        : null,
    ({ id }) => fetchComplaints({ clientNomen: id }),
  );

  createEffect(on(complaintsRes, () => setPatches({}), { defer: true }));

  const complaints = createMemo(() => {
    const list = complaintsRes()?.complaints ?? [];
    const p = patches();
    return list.map((c) => p[c.id] ?? c);
  });

  const openComplaintCount = () =>
    complaints().filter((c) => c.status !== "resolved" && c.status !== "closed")
      .length;

  const cCounts = createMemo(() => {
    const c = { open: 0, in_progress: 0, awaiting: 0, resolved: 0, closed: 0 };
    for (const x of complaints()) {
      const s = statusClassOf(x.status);
      if (s === "in_progress") c.in_progress++;
      else if (s === "awaiting") c.awaiting++;
      else if (s === "resolved") c.resolved++;
      else if (s === "closed") c.closed++;
      else c.open++;
    }
    return c;
  });

  const visibleComplaints = createMemo(() => {
    const st = cStatus();
    const cat = cCategory();
    return complaints().filter((c) => {
      if (st !== "all" && statusClassOf(c.status) !== st) return false;
      if (cat !== "all" && c.category !== cat) return false;
      return true;
    });
  });

  const clientName = () =>
    search.name ||
    complaints()[0]?.clientNomenName ||
    activity()?.entries?.[0]?.meta?.client_nomen_name ||
    `Client #${nomenId()}`;

  // ── Overlay (single active modal) ──
  const [overlay, setOverlay] = createSignal(null);
  const close = () => setOverlay(null);

  const openComplaintById = async (id) => {
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

  onMount(() => {
    if (search.complaint) openComplaintById(search.complaint);
  });

  // ── Timeline (filtered → day-grouped) ──
  const timeline = createMemo(() => {
    const node = ACTIVITY_FILTERS.find((f) => f.key === activityFilter())?.node;
    const entries = activity()?.entries ?? [];
    return node ? entries.filter((e) => e.node === node) : entries;
  });

  const grouped = createMemo(() => {
    const groups = [];
    let cur = null;
    for (const e of timeline()) {
      const key = startOfDay(new Date(e.timestamp).getTime());
      if (!cur || cur.key !== key) {
        cur = { key, label: dayLabel(e.timestamp), items: [] };
        groups.push(cur);
      }
      cur.items.push(e);
    }
    return groups;
  });

  const initials = () => initialsOf(clientName());

  return (
    <section class="wl">
      {/* ════════ CLIENT HEAD ════════ */}
      <div class="client-head">
        <div style="max-width:960px;margin:0 auto">
          <A href="/my-work" class="back-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            My work
          </A>
        </div>
        <div class="ch-top">
          <div class="ch-logo">{initials()}</div>
          <div style="min-width:0">
            <h1 class="ch-name">{clientName()}</h1>
            <div class="ch-meta">
              <span class="mono">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 9h18" />
                </svg>
                nomen_{nomenId()}
              </span>
            </div>
          </div>
          <div class="ch-status"><i />Active</div>
        </div>
        <div class="tabs">
          <button
            class={tab() === "activity" ? "active" : ""}
            onClick={() => setTab("activity")}
          >
            Activity
          </button>
          <button
            class={tab() === "complaints" ? "active" : ""}
            onClick={() => setTab("complaints")}
          >
            Complaints
            <Show when={openComplaintCount() > 0}>
              <span class="tab-badge">{openComplaintCount()}</span>
            </Show>
          </button>
        </div>
      </div>

      <div class="content">
        {/* ════════ INVALID-NOMEN GUARD ════════ */}
        <Show when={!validNomenId()}>
          <div class="empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <b>This workspace link is invalid</b>
            It must reference a numeric client id (got “{String(nomenId() ?? "")}”).
            Open a client from <A href="/my-work" style="color:var(--forest);font-weight:600">My work</A>.
          </div>
        </Show>

        {/* ════════ ACTIVITY PANEL ════════ */}
        <Show when={tab() === "activity" && validNomenId()}>
          <div class="lead">
            <div>
              <h2>Activity</h2>
              <p>
                One history: changes synced from Meta, tasks from your team, and
                complaints raised and resolved.
              </p>
            </div>
          </div>

          <div class="filters">
            <div class="fgroup">
              <label>Type</label>
              <div class="seg">
                <For each={ACTIVITY_FILTERS}>
                  {(f) => (
                    <button
                      class={activityFilter() === f.key ? "on" : ""}
                      onClick={() => setActivityFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="ftext">
              <button class="btn-primary" onClick={() => setOverlay({ type: "assign" })}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Assign task
              </button>
            </div>
          </div>

          <Show when={activity.error}>
            <div class="empty"><b>Couldn't load the activity timeline</b>Please try again.</div>
          </Show>

          <Show
            when={!activity.loading}
            fallback={
              <div class="feed">
                <For each={Array(4).fill(0)}>{() => <div class="skel" />}</For>
              </div>
            }
          >
            <Show
              when={timeline().length > 0}
              fallback={
                <div class="empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <b>No activity here</b>
                  {activityFilter() !== "all" ? "Try a different type filter." : "Nothing has happened yet."}
                </div>
              }
            >
              <div class="feed">
                <For each={grouped()}>
                  {(g) => (
                    <div class="daygroup">
                      <div class="dayhead">
                        <b>{g.label[0]}</b>
                        <span class="d">{g.label[1]}</span>
                        <span class="rule" />
                      </div>
                      <For each={g.items}>
                        {(e) => {
                          const clickable = e.refType === "complaint" && e.refId != null;
                          return (
                            <div class="row">
                              <div class="spine">
                                <div class={`node ${nodeClassOf(e.node)}`}>
                                  <NodeIcon node={e.node} />
                                </div>
                              </div>
                              <div
                                class={`card ${clickable ? "clickable" : ""}`}
                                onClick={clickable ? () => openComplaintById(e.refId) : undefined}
                              >
                                <div class="card-top">
                                  <Show when={e.actor}>
                                    <span class="actor">
                                      <span class="av" style={`background:${avatarColor(e.actor)}`}>
                                        {initialsOf(e.actor)}
                                      </span>
                                      <b>{e.actor}</b>
                                    </span>
                                  </Show>
                                  <span class="time mono" title={fmtDateTime(e.timestamp)}>
                                    {fmtRelative(e.timestamp)}
                                  </span>
                                </div>
                                <div class="title">{e.title}</div>
                                <Show when={e.kind}>
                                  <div class="badges">
                                    <span class={`pill ${e.node === "clay" ? "cat" : e.node === "gold" ? "camp" : "auto"}`}>
                                      {humanize(e.kind)}
                                    </span>
                                    <Show when={clickable}>
                                      <span class="openhint">
                                        View complaint
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                          <path d="m9 18 6-6-6-6" />
                                        </svg>
                                      </span>
                                    </Show>
                                  </div>
                                </Show>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>

        {/* ════════ COMPLAINTS PANEL ════════ */}
        <Show when={tab() === "complaints" && validNomenId()}>
          <div class="lead">
            <div>
              <h2>Complaints</h2>
              <p>
                Issues the client has raised, with owner, status, and resolution.
                Raised and resolved also show on the Activity history.
              </p>
            </div>
          </div>

          <div class="summary">
            <div class="tile">
              <div class="n">{cCounts().open}</div>
              <div class="l"><i style="background:var(--slate)" />Open</div>
            </div>
            <div class="tile">
              <div class="n">{cCounts().in_progress}</div>
              <div class="l"><i style="background:var(--warn)" />In progress</div>
            </div>
            <div class="tile">
              <div class="n">{cCounts().awaiting}</div>
              <div class="l"><i style="background:var(--blue)" />Awaiting client</div>
            </div>
            <div class="tile">
              <div class="n">{cCounts().resolved}</div>
              <div class="l"><i style="background:var(--ok)" />Resolved</div>
            </div>
          </div>

          <div class="filters">
            <div class="fgroup">
              <label>Status</label>
              <div class="seg">
                <For
                  each={[
                    { k: "all", l: "All" },
                    { k: "open", l: "Open" },
                    { k: "in_progress", l: "In progress" },
                    { k: "awaiting", l: "Awaiting" },
                    { k: "resolved", l: "Resolved" },
                    { k: "closed", l: "Closed" },
                  ]}
                >
                  {(o) => (
                    <button class={cStatus() === o.k ? "on" : ""} onClick={() => setCStatus(o.k)}>
                      {o.l}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="fgroup">
              <label>Category</label>
              <select value={cCategory()} onChange={(e) => setCCategory(e.target.value)}>
                <option value="all">All categories</option>
                <For each={CATEGORY_OPTIONS}>
                  {(o) => <option value={o.value}>{o.label}</option>}
                </For>
              </select>
            </div>
            <div class="ftext">
              <button class="btn-primary" onClick={() => setOverlay({ type: "log" })}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Log complaint
              </button>
            </div>
          </div>

          <Show when={complaintsRes.error}>
            <div class="empty"><b>Couldn't load complaints</b>Please try again.</div>
          </Show>

          <Show
            when={!complaintsRes.loading}
            fallback={
              <div class="clist">
                <For each={Array(3).fill(0)}>{() => <div class="skel" />}</For>
              </div>
            }
          >
            <Show
              when={visibleComplaints().length > 0}
              fallback={
                <div class="empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <b>{complaints().length ? "Nothing here" : "No complaints logged"}</b>
                  {complaints().length
                    ? "No complaints match this filter."
                    : "Nothing has been raised for this client."}
                  <div style="margin-top:14px">
                    <button class="btn-primary" onClick={() => setOverlay({ type: "log" })}>
                      Log complaint
                    </button>
                  </div>
                </div>
              }
            >
              <div class="clist">
                <For each={visibleComplaints()}>
                  {(c) => {
                    const sev = levelClassOf(c.severity);
                    return (
                      <div
                        class={`ccard sev-${sev}`}
                        onClick={() => setOverlay({ type: "detail", complaint: c })}
                      >
                        <div class="ctop">
                          <div class="ctitle">{c.title}</div>
                          <span class={`status pill ${statusClassOf(c.status)}`}>
                            {humanize(c.status)}
                          </span>
                        </div>
                        <div class="cmeta">
                          <Show when={c.category}>
                            <span class="pill cat">
                              {CATEGORY_LABEL[c.category] ?? humanize(c.category)}
                            </span>
                          </Show>
                          <Show when={c.severity}>
                            <span class={`pill sev ${sev}`}>{humanize(c.severity)}</span>
                          </Show>
                          <Show when={c.openTaskCount > 0}>
                            <span class="pill camp">
                              {c.openTaskCount} task{c.openTaskCount !== 1 ? "s" : ""}
                            </span>
                          </Show>
                          {/* SLA kind — awaiting client is a distinct, non-breaching state (blue). */}
                          <Show when={statusClassOf(c.status) === "awaiting"}>
                            <span class="pill awaiting">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="8" r="4" />
                                <path d="M6 21v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1" />
                              </svg>
                              Waiting on client
                            </span>
                          </Show>
                        </div>
                        <Show when={c.description}>
                          <div class="desc">{c.description}</div>
                        </Show>
                        <div class="cfoot">
                          <Show when={c.raisedBy}>
                            <span class="who">
                              <span class="av" style={`background:${avatarColor(c.raisedBy)}`}>
                                {initialsOf(c.raisedBy)}
                              </span>
                              {c.raisedBy}
                            </span>
                            <span class="dotsep" />
                          </Show>
                          <span>Raised {fmtRelative(c.createdAt)}</span>
                          <Show when={c.owner}>
                            <span class="dotsep" />
                            <span>Owner: {c.owner}</span>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>

      {/* ════════ OVERLAYS ════════ */}
      <Show when={overlay()?.type === "log"}>
        <LogComplaintModal
          clientNomen={validNomenId()}
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
          clientNomen={validNomenId()}
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
