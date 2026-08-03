import {
  createSignal,
  createEffect,
  createMemo,
  createResource,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { A } from "@solidjs/router";
import { getActivities, getActivitySummary, getLogins } from "../services/activityLog";
import { fetchHierarchyClients } from "../services/cm";
import { currentUser } from "../stores/currentUser";
import RowsPerPageSelect from "../components/common/RowsPerPageSelect";

// ─── Activity Log ─────────────────────────────────────────────────────────────
// Read-only view of the append-only activity trail (GET /api/activity/). There is
// deliberately no edit or delete control — entries are immutable and reads are
// role-scoped server-side.
//
// The feed carries more than campaign events now (auth logins, payment_*,
// leads_*). Rows render generically off actor/action/category/result/target/
// timestamp, so new categories need no per-type branch — only the Change column
// picks a sensible detail per shape (from→to, amount, ip, count).

// The canonical actions the backend emits, grouped for the filter's <optgroup>s.
// The dropdown is seeded from this so you can filter for an action that isn't on
// the page you're looking at. `action` is still an open string server-side, so
// actionOptions() also merges in anything the feed returns that isn't listed
// here — a new action type is never invisible.
//
// `result` is a SEPARATE axis: a failed login is action=login + result=failure,
// so failure variants never belong in this list — the result filter covers them.
const ACTION_GROUPS = [
  {
    category: "auth",
    label: "Auth",
    actions: [["login", "Login"]],
  },
  {
    category: "payment",
    label: "Payment",
    actions: [
      ["payment_created", "Payment recorded"],
      ["payment_updated", "Payment edited"],
      ["payment_docs_completed", "Docs completed"],
      ["payment_deleted", "Payment deleted"],
    ],
  },
  {
    category: "lead",
    label: "Lead",
    actions: [
      ["leads_fed", "Leads fed"],
      ["leads_updated", "Leads updated"],
      ["leads_revoked", "Leads revoked"],
    ],
  },
  {
    category: "campaign",
    label: "Campaign",
    actions: [
      ["campaign_paused", "Campaign paused"],
      ["campaign_resumed", "Campaign resumed"],
      ["campaign_budget_changed", "Budget changed"],
    ],
  },
];

const ACTION_LABELS = Object.fromEntries(
  ACTION_GROUPS.flatMap((g) => g.actions),
);

const KNOWN_ACTIONS = ACTION_GROUPS.flatMap((g) => g.actions.map(([v]) => v));

// actor_role filter — value sent verbatim as ?actor_role=<value>.
const ACTOR_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "campaign_manager", label: "Campaign Manager" },
  { value: "accounts", label: "Accounts" },
  { value: "sales", label: "Sales" },
  { value: "coordination", label: "Coordination" },
  { value: "client", label: "Client" },
];

const titleCase = (s) =>
  String(s || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

const actionLabel = (a) => ACTION_LABELS[a] ?? titleCase(a);

const roleLabel = (r) =>
  ACTOR_ROLES.find((x) => x.value === r)?.label ?? titleCase(r);

const CATEGORY_STYLES = {
  campaign: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  auth: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  payment: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  lead: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

const fmtAmount = (n, currency) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const amount = num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return currency && currency !== "INR" ? `${amount} ${currency}` : `₹${amount}`;
};

// One readable "what changed" line per entry, whatever the category:
// campaign status flips carry from/to, payments carry an amount, logins carry an
// ip, lead pushes carry a count. Falls back to nothing rather than raw JSON.
const changeSummary = (a) => {
  const d = a.details || {};
  if (d.from != null || d.to != null) return `${d.from ?? "?"} → ${d.to ?? "?"}`;
  if (d.amount != null) return fmtAmount(d.amount, d.currency);
  if (d.count != null) return `${d.count} lead${Number(d.count) === 1 ? "" : "s"}`;
  if (d.ip) return `IP ${d.ip}`;
  return null;
};

const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const fmtDay = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const fmtCount = (n) => (Number(n) || 0).toLocaleString("en-IN");

// ─── Date range ───────────────────────────────────────────────────────────────
// Both the feed and the summary take the same ?start_date=/?end_date= pair as
// plain YYYY-MM-DD, so the presets are computed in local time and stringified
// here rather than sent as full ISO timestamps (a UTC round-trip would shift the
// window by a day for anyone east of Greenwich).

const pad2 = (n) => String(n).padStart(2, "0");

const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const DATE_PRESETS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

// 30 days is the default because that's what the backend defaults to when the
// params are omitted — the control starts out agreeing with the server.
const DEFAULT_PRESET = "30";

const presetRange = (days) => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - Number(days));
  return { startDate: isoDay(start), endDate: isoDay(end) };
};

// ─── Chart helpers ────────────────────────────────────────────────────────────

// "YYYY-MM-DD" (or a full ISO timestamp) → a local-midnight Date. Built from the
// parts rather than Date.parse so a bare date string isn't read as UTC.
const parseDay = (s) => {
  const [y, m, d] = String(s ?? "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

// by_day skips days with no logins at all, so a raw plot would silently compress
// a quiet stretch into a straight jump. Fill every missing day in the window with
// 0/0 so the x-axis is real time and a gap reads as "nobody signed in".
const fillLoginSeries = (rows, window) => {
  const points = (rows ?? [])
    .map((r) => ({
      date: parseDay(r.day),
      success: Number(r.success) || 0,
      failure: Number(r.failure) || 0,
    }))
    .filter((p) => p.date)
    .sort((a, b) => a.date - b.date);
  if (!points.length) return [];

  // Prefer the window the server reports (so an empty tail still shows as flat),
  // and widen it if a point somehow falls outside it.
  const from = new Date(
    Math.min(parseDay(window?.start) ?? points[0].date, points[0].date),
  );
  const to = new Date(
    Math.max(parseDay(window?.end) ?? points.at(-1).date, points.at(-1).date),
  );

  const span = Math.round((to - from) / 86400000);
  if (!(span >= 0) || span > 400) return points; // absurd window — plot as-is

  const byDay = new Map(points.map((p) => [isoDay(p.date), p]));
  const out = [];
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const hit = byDay.get(isoDay(d));
    out.push({
      date: new Date(d),
      success: hit?.success ?? 0,
      failure: hit?.failure ?? 0,
    });
  }
  return out;
};

// The time series draws into a fixed viewBox and is scaled by CSS; strokes carry
// vector-effect="non-scaling-stroke" so they stay a true 1–2px at any width.
const VB = { w: 760, h: 220, top: 14, right: 16, bottom: 30, left: 46 };
const PLOT_W = VB.w - VB.left - VB.right;
const PLOT_H = VB.h - VB.top - VB.bottom;
const BASE_Y = VB.top + PLOT_H;

// Round the axis ceiling up to a clean number. A busy Monday can put a single
// day well past a hundred sign-ins, so the axis always scales to the window's own
// max — there is deliberately no fixed ceiling to clip against.
const niceMax = (n) => {
  if (!(n > 0)) return 5;
  const mag = 10 ** Math.floor(Math.log10(n));
  for (const s of [1, 2, 2.5, 5, 10]) if (s * mag >= n) return s * mag;
  return 10 * mag;
};

const fmtAxisDay = (d) =>
  d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const fmtPointDay = (d) =>
  d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

// Daily sign-ins, two series: successes as a filled area in the page accent and
// failures as a bare red line on top. Failures are almost always the smaller
// series, so they get the line (never buried under a fill) and the direct label.
function LoginTrendChart(props) {
  const [hover, setHover] = createSignal(null);
  let svgEl;

  const pts = () => props.points ?? [];
  // One shared y-axis: two axes would make a 3-failure day look like a 300-login
  // day. Both series are the same unit, so they belong on the same scale.
  const maxY = () =>
    niceMax(Math.max(0, ...pts().flatMap((p) => [p.success, p.failure])));
  const xAt = (i) =>
    pts().length < 2 ? VB.left + PLOT_W / 2 : VB.left + (i / (pts().length - 1)) * PLOT_W;
  const yAt = (v) => VB.top + PLOT_H * (1 - v / maxY());

  const linePoints = (key) =>
    pts().map((p, i) => `${xAt(i)},${yAt(p[key])}`).join(" ");

  const areaPath = () => {
    const p = pts();
    if (p.length < 2) return "";
    return `M ${xAt(0)},${BASE_Y} L ${p
      .map((d, i) => `${xAt(i)},${yAt(d.success)}`)
      .join(" L ")} L ${xAt(p.length - 1)},${BASE_Y} Z`;
  };

  const peak = (key) => {
    let best = -1;
    pts().forEach((p, i) => {
      if (best < 0 || p[key] > pts()[best][key]) best = i;
    });
    return best >= 0 && pts()[best][key] > 0 ? best : null;
  };

  // Both peaks are direct-labelled, except when they land on the same day — the
  // two labels would then sit on the same anchor, so the tooltip covers it.
  const labelFailurePeak = () =>
    peak("failure") != null && peak("failure") !== peak("success");

  // Up to 6 evenly spaced day labels — enough to place the eye, few enough not
  // to collide at 90 days.
  const xTicks = () => {
    const n = pts().length;
    if (!n) return [];
    const want = Math.min(n, 6);
    if (want === 1) return [0];
    const step = (n - 1) / (want - 1);
    return Array.from({ length: want }, (_, k) => Math.round(k * step));
  };

  const anchorFor = (i) =>
    i === 0 ? "start" : i === pts().length - 1 ? "end" : "middle";

  const onMove = (e) => {
    const n = pts().length;
    if (!n || !svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width) return;
    // clientX → viewBox units → nearest index (the whole svg is the hit area, so
    // there's no pinpoint target to land on).
    const vbX = ((e.clientX - rect.left) / rect.width) * VB.w;
    const i = n < 2 ? 0 : Math.round(((vbX - VB.left) / PLOT_W) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const hovered = () => (hover() == null ? null : pts()[hover()]);

  return (
    <Show
      when={pts().length}
      fallback={
        <div class="h-[180px] flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
          No sign-ins in this window
        </div>
      }
    >
      <div class="relative">
        {/* Two series need a legend — the colours alone don't name themselves. */}
        <div class="flex items-center gap-4 mb-1">
          <span class="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span class="w-3 h-0.5 rounded bg-purple-600 dark:bg-purple-400" />
            Successful
          </span>
          <span class="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span class="w-3 h-0.5 rounded bg-red-500 dark:bg-red-400" />
            Failed
          </span>
        </div>

        <svg
          ref={svgEl}
          viewBox={`0 0 ${VB.w} ${VB.h}`}
          class="w-full overflow-visible"
          role="img"
          aria-label="Successful and failed sign-ins per day over the selected window"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* Gridlines + y ticks — solid hairlines, one step off the surface */}
          <For each={[0, 0.5, 1]}>
            {(f) => (
              <>
                <line
                  x1={VB.left}
                  x2={VB.w - VB.right}
                  y1={yAt(maxY() * f)}
                  y2={yAt(maxY() * f)}
                  class="stroke-gray-200 dark:stroke-gray-700"
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                />
                <text
                  x={VB.left - 8}
                  y={yAt(maxY() * f) + 4}
                  text-anchor="end"
                  class="fill-gray-400 dark:fill-gray-500 text-[11px] [font-variant-numeric:tabular-nums]"
                >
                  {fmtCount(Math.round(maxY() * f))}
                </text>
              </>
            )}
          </For>

          <Show when={pts().length > 1}>
            <path d={areaPath()} class="fill-purple-500/10 dark:fill-purple-400/10" />
            <polyline
              points={linePoints("success")}
              fill="none"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
              class="stroke-purple-600 dark:stroke-purple-400"
            />
            {/* Failures ride on top, unfilled, so a flat red floor stays readable
                against the success area rather than tinting it. */}
            <polyline
              points={linePoints("failure")}
              fill="none"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
              class="stroke-red-500 dark:stroke-red-400"
            />
          </Show>

          {/* A single failure on an otherwise-clean window is one pixel of line —
              dot every day that had one so it can't be missed. */}
          <For each={pts()}>
            {(p, i) => (
              <Show when={p.failure > 0}>
                <circle
                  cx={xAt(i())}
                  cy={yAt(p.failure)}
                  r="2.5"
                  class="fill-red-500 dark:fill-red-400"
                />
              </Show>
            )}
          </For>

          {/* A one-day window has no line to draw — show the points themselves. */}
          <Show when={pts().length === 1}>
            <circle
              cx={xAt(0)}
              cy={yAt(pts()[0].success)}
              r="4"
              class="fill-purple-600 dark:fill-purple-400 stroke-white dark:stroke-gray-900"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
            />
          </Show>

          {/* Direct labels on the peaks — the values the axis reads worst. */}
          <Show when={peak("success") != null}>
            <circle
              cx={xAt(peak("success"))}
              cy={yAt(pts()[peak("success")].success)}
              r="4"
              class="fill-purple-600 dark:fill-purple-400 stroke-white dark:stroke-gray-900"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
            />
            <text
              x={xAt(peak("success"))}
              y={yAt(pts()[peak("success")].success) - 10}
              text-anchor={anchorFor(peak("success"))}
              class="fill-gray-500 dark:fill-gray-400 text-[11px] font-semibold"
            >
              {fmtCount(pts()[peak("success")].success)}
            </text>
          </Show>

          <Show when={labelFailurePeak()}>
            <text
              x={xAt(peak("failure"))}
              y={yAt(pts()[peak("failure")].failure) - 8}
              text-anchor={anchorFor(peak("failure"))}
              class="fill-red-500 dark:fill-red-400 text-[11px] font-semibold"
            >
              {fmtCount(pts()[peak("failure")].failure)}
            </text>
          </Show>

          {/* x labels */}
          <For each={xTicks()}>
            {(i) => (
              <text
                x={xAt(i)}
                y={BASE_Y + 18}
                text-anchor={anchorFor(i)}
                class="fill-gray-400 dark:fill-gray-500 text-[11px]"
              >
                {fmtAxisDay(pts()[i].date)}
              </text>
            )}
          </For>

          {/* Crosshair. Gated on the point, not the index — swapping the date
              range can leave a hover index past the end of the new series. */}
          <Show when={hovered()}>
            <line
              x1={xAt(hover())}
              x2={xAt(hover())}
              y1={VB.top}
              y2={BASE_Y}
              class="stroke-gray-300 dark:stroke-gray-600"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
            <circle
              cx={xAt(hover())}
              cy={yAt(hovered().success)}
              r="4"
              class="fill-purple-600 dark:fill-purple-400 stroke-white dark:stroke-gray-900"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
            />
            <Show when={hovered().failure > 0}>
              <circle
                cx={xAt(hover())}
                cy={yAt(hovered().failure)}
                r="4"
                class="fill-red-500 dark:fill-red-400 stroke-white dark:stroke-gray-900"
                stroke-width="2"
                vector-effect="non-scaling-stroke"
              />
            </Show>
          </Show>
        </svg>

        <Show when={hovered()}>
          <div
            class="pointer-events-none absolute -translate-x-1/2 -translate-y-full z-10
                   rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800
                   px-2 py-1 shadow-sm whitespace-nowrap"
            style={{
              left: `${Math.min(92, Math.max(8, (xAt(hover()) / VB.w) * 100))}%`,
              top: `${(yAt(Math.max(hovered().success, hovered().failure)) / VB.h) * 100 - 2}%`,
            }}
          >
            <div class="text-[11px] text-gray-500 dark:text-gray-400">
              {fmtPointDay(hovered().date)}
            </div>
            <div class="text-xs font-semibold text-gray-900 dark:text-white">
              {fmtCount(hovered().success)} successful
            </div>
            {/* Always shown, even at zero — "0 failed" is the reassuring read. */}
            <div
              class={`text-xs font-semibold ${
                hovered().failure > 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-gray-400 dark:text-gray-500"
              }`}
            >
              {fmtCount(hovered().failure)} failed
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}

// ─── Summary header bits ──────────────────────────────────────────────────────
function StatCard(props) {
  const alert = () => props.tone === "alert";
  return (
    <div
      class={`rounded-xl border p-4 ${
        alert()
          ? "border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-900/20"
          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
      }`}
    >
      <div class="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {props.label}
      </div>
      <div
        class={`mt-1 text-2xl font-semibold ${
          alert()
            ? "text-amber-700 dark:text-amber-300"
            : "text-gray-900 dark:text-white"
        }`}
      >
        {props.value}
      </div>
    </div>
  );
}

const RESULT_STYLES = {
  success: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  failure: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
};

// ─── Logins tab ───────────────────────────────────────────────────────────────
// Admin-only view of GET /activity/logins/: window stats, the daily success /
// failure trend, the recent attempts, and an all-time last-login roster.
//
// props = { data, refreshing } — `data` is the resolved payload, or null when the
// call failed (the caller renders the unavailable notice instead).

const TABLE_SHELL =
  "bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700";
const TH =
  "p-3 text-left whitespace-nowrap sticky top-0 z-10 bg-gray-50 dark:bg-gray-800";
const THEAD =
  "border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider";

function LoginsPanel(props) {
  const [userSearch, setUserSearch] = createSignal("");

  const points = createMemo(() =>
    fillLoginSeries(props.data?.byDay, props.data?.window),
  );

  const stats = () => props.data?.stats ?? {};
  const recent = () => props.data?.recent ?? [];

  // ~200 rows, so the roster is filtered client-side rather than round-tripping.
  // The server's order (never-logged-in first, then oldest first) is the whole
  // point of the table, so filter only — never re-sort.
  const perUser = createMemo(() => {
    const q = userSearch().trim().toLowerCase();
    const rows = props.data?.perUser ?? [];
    if (!q) return rows;
    return rows.filter(
      (u) =>
        String(u.email ?? "").toLowerCase().includes(q) ||
        roleLabel(u.role).toLowerCase().includes(q),
    );
  });

  return (
    <div class={props.refreshing ? "opacity-50 transition-opacity" : "transition-opacity"}>
      {/* 1 — Stat cards */}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total logins" value={fmtCount(stats().totalLogins)} />
        <StatCard label="Unique users" value={fmtCount(stats().uniqueUsers)} />
        <StatCard
          label="Failed attempts"
          value={fmtCount(stats().failedAttempts)}
          tone={stats().failedAttempts > 0 ? "alert" : "neutral"}
        />
        {/* Not window-scoped like the other three — say so on the label rather
            than letting it read as "nobody signed in during these 30 days". */}
        <StatCard
          label="Never logged in (all time)"
          value={fmtCount(stats().neverLoggedIn)}
        />
      </div>

      {/* 2 — Trend */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 p-4 mb-3">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-1">
          Sign-ins over time
        </h3>
        <LoginTrendChart points={points()} />
      </div>

      {/* 3 — Recent attempts */}
      <div class={`${TABLE_SHELL} mb-3`}>
        <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
            Recent sign-ins
          </h3>
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Newest first · up to the last 100 attempts in this window
          </p>
        </div>
        <div class="max-h-[420px] overflow-auto">
          <table class="min-w-full text-sm">
            <thead class={THEAD}>
              <tr>
                <th class={TH}>User</th>
                <th class={TH}>Role</th>
                <th class={TH}>When</th>
                <th class={TH}>IP</th>
                <th class={TH}>Result</th>
              </tr>
            </thead>
            <tbody>
              <For each={recent()}>
                {(r, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                            ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/60 dark:bg-gray-800/30"}`}
                  >
                    <td class="p-3 text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                      {r.actor ?? "—"}
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {r.actorRole ? roleLabel(r.actorRole) : "—"}
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {fmtTime(r.timestamp)}
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap [font-variant-numeric:tabular-nums]">
                      {r.ip || "—"}
                    </td>
                    <td class="p-3 whitespace-nowrap">
                      <span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${RESULT_STYLES[r.result] ?? RESULT_STYLES.info}`}>
                        {r.result}
                      </span>
                    </td>
                  </tr>
                )}
              </For>
              <Show when={!recent().length}>
                <tr>
                  <td colspan="5" class="py-12 text-center text-gray-400 dark:text-gray-500">
                    No sign-ins recorded in this window
                  </td>
                </tr>
              </Show>
            </tbody>
          </table>
        </div>
      </div>

      {/* 4 — Per-user last login (all time, never-first) */}
      <div class={TABLE_SHELL}>
        <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700
                    flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
              Last login by user
            </h3>
            {/* The caveat that keeps this table from being read as an inactivity
                report — tracking has a start date, "Never" only means "not since". */}
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Login history only goes back to when tracking was switched on — a
              user shown as “Never” may simply not have signed in since then, which
              isn’t proof the account is unused.
            </p>
          </div>
          <input
            type="text"
            placeholder="Search users…"
            value={userSearch()}
            onInput={(e) => setUserSearch(e.target.value)}
            class="w-[220px] max-w-full px-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>
        <div class="max-h-[460px] overflow-auto">
          <table class="min-w-full text-sm">
            <thead class={THEAD}>
              <tr>
                <th class={TH}>User</th>
                <th class={TH}>Role</th>
                <th class={TH}>Last login</th>
                <th class={TH}>Days ago</th>
              </tr>
            </thead>
            <tbody>
              <For each={perUser()}>
                {(u, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                            ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/60 dark:bg-gray-800/30"}`}
                  >
                    <td class="p-3 text-gray-700 dark:text-gray-300 font-medium">
                      {u.email ?? "—"}
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {u.role ? roleLabel(u.role) : "—"}
                    </td>
                    <td class="p-3 whitespace-nowrap">
                      <Show
                        when={u.lastLogin}
                        fallback={
                          <span class="text-amber-700 dark:text-amber-400 font-medium">
                            Never
                          </span>
                        }
                      >
                        <span class="text-gray-500 dark:text-gray-400">
                          {fmtTime(u.lastLogin)}
                        </span>
                      </Show>
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap [font-variant-numeric:tabular-nums]">
                      {u.daysSince == null ? "—" : fmtCount(u.daysSince)}
                    </td>
                  </tr>
                )}
              </For>
              <Show when={!perUser().length}>
                <tr>
                  <td colspan="4" class="py-12 text-center text-gray-400 dark:text-gray-500">
                    {userSearch() ? "No users match your search" : "No users to show"}
                  </td>
                </tr>
              </Show>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Rows-per-page: 50 stays the default (this log is skimmed in bulk), but the
// size is user-selectable and remembered across visits.
const DEFAULT_PAGE_SIZE = 50;
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 200];

// ─── Tabs ─────────────────────────────────────────────────────────────────────
// The Logins tab is backed by an admin-only endpoint, so it's only offered to
// admins — for anyone else the tab would lead straight to a 403. Same two-source
// pattern as the other gates in stores/currentUser: prefer the loaded /auth/me
// store, fall back to the role mirrored into localStorage so the tab doesn't
// flicker in a beat after first paint.
const isAdminUser = () => {
  if (currentUser.loaded) return currentUser.role === "admin";
  try {
    return JSON.parse(localStorage.getItem("auth") || "null")?.role === "admin";
  } catch {
    return false;
  }
};

export default function Activity() {
  const [tab, setTab] = createSignal("activity");
  const [search, setSearch] = createSignal("");
  const [debouncedSearch, setDebouncedSearch] = createSignal("");
  const [resultFilter, setResultFilter] = createSignal("all");
  const [actionFilter, setActionFilter] = createSignal("all");
  const [actorRoleFilter, setActorRoleFilter] = createSignal("all");
  const [targetId, setTargetId] = createSignal("");
  const [debouncedTargetId, setDebouncedTargetId] = createSignal("");
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(
    Number(localStorage.getItem("activityRowsPerPage")) || DEFAULT_PAGE_SIZE,
  );

  const changePageSize = (size) => {
    setPageSize(size);
    localStorage.setItem("activityRowsPerPage", String(size));
    setPage(1); // the current page number can be past the end at a bigger size
  };

  const [entries, setEntries] = createSignal([]);
  const [seenActions, setSeenActions] = createSignal([]);
  const [pagination, setPagination] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);

  // The one place the page's date window lives — the header control writes here
  // and both the feed and the summary read from it, so they can never disagree
  // about which window is on screen.
  const [rangePreset, setRangePreset] = createSignal(DEFAULT_PRESET);
  const [customStart, setCustomStart] = createSignal("");
  const [customEnd, setCustomEnd] = createSignal("");

  const dateFilters = createMemo(() => {
    if (rangePreset() === "custom") {
      // A half-filled custom range is sent as-is; the backend defaults whichever
      // side is missing rather than the UI inventing one.
      return { startDate: customStart(), endDate: customEnd() };
    }
    return presetRange(rangePreset());
  });

  const today = isoDay(new Date());

  const pickPreset = (value) => {
    // Seed the custom inputs from the window that's already on screen, so
    // switching to Custom starts from what you were looking at.
    if (value === "custom" && !customStart() && !customEnd()) {
      const r = dateFilters();
      setCustomStart(r.startDate);
      setCustomEnd(r.endDate);
    }
    setPage(1); // a narrower window can leave you past the end
    setRangePreset(value);
  };

  const setCustomDate = (setter) => (value) => {
    setPage(1);
    setter(value);
  };

  // Glance summary. Keyed on the date window so it refetches when that changes;
  // the feed's category/role/action/client filters deliberately don't re-scope it
  // — this is a window-level overview, not a reflection of the filtered rows.
  // Resolves to null on failure so a broken summary can never take the feed down.
  const [summary] = createResource(dateFilters, async (range) => {
    try {
      return await getActivitySummary(range);
    } catch (err) {
      console.error("[Activity] summary load failed:", err);
      return null;
    }
  });

  // Hold the last resolved summary so changing the date range doesn't flash the
  // skeleton and jump the layout — the previous render stays, dimmed, until the
  // new window lands. `undefined` means "nothing loaded yet"; `null` is a real
  // resolved state (the fetch failed).
  const [lastSummary, setLastSummary] = createSignal();
  createEffect(() => {
    const s = summary();
    if (s !== undefined) setLastSummary(s);
  });
  const summaryView = () => lastSummary();
  const summaryFirstLoad = () => summary.loading && lastSummary() === undefined;
  const summaryRefreshing = () => summary.loading && lastSummary() !== undefined;

  // ── Logins tab ──────────────────────────────────────────────────────────────
  // Admin-only endpoint, and only worth fetching once the tab is actually on
  // screen — a falsy source keeps createResource from firing at all, so every
  // other role's page load never touches an endpoint that would 403.
  const showLoginsTab = () => isAdminUser();
  const onLoginsTab = () => tab() === "logins" && showLoginsTab();

  const [logins] = createResource(
    () => (onLoginsTab() ? dateFilters() : false),
    async (range) => {
      try {
        return await getLogins(range);
      } catch (err) {
        console.error("[Activity] logins load failed:", err);
        return null; // a broken logins call must not take the page down
      }
    },
  );

  // Same hold-last-value treatment as the summary: changing the date range dims
  // the current render instead of dropping back to a skeleton.
  const [lastLogins, setLastLogins] = createSignal();
  createEffect(() => {
    const l = logins();
    if (l !== undefined) setLastLogins(l);
  });
  const loginsView = () => lastLogins();
  const loginsFirstLoad = () => logins.loading && lastLogins() === undefined;
  const loginsRefreshing = () => logins.loading && lastLogins() !== undefined;

  const summaryWindow = () => {
    const w = summaryView()?.window;
    const start = fmtDay(w?.start);
    const end = fmtDay(w?.end);
    if (start && end) return `${start} – ${end}`;
    return start || end || null;
  };

  // Client list for the target filter. Same source the Clients screens use, so
  // it's already visibility-scoped per role; if it's empty/unavailable the
  // control degrades to a plain client-id box (see the filter bar below).
  const [clients] = createResource(async () => {
    try {
      const res = await fetchHierarchyClients();
      const list = Array.isArray(res?.data) ? res.data : [];
      return list
        .map((c) => ({
          id: c.client_nomen_id,
          name: c.client_name || c.client_nomen_name || `Client #${c.client_nomen_id}`,
        }))
        .filter((c) => c.id != null)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    } catch {
      return [];
    }
  });
  const hasClientList = () => (clients() ?? []).length > 0;

  // Debounce the search box so we don't fire a request per keystroke.
  createEffect(() => {
    const q = search();
    const t = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(q);
    }, 350);
    onCleanup(() => clearTimeout(t));
  });

  // Same treatment for the typed client-id box (the <select> path sets both
  // signals at once, so picking from the list still costs only one request).
  createEffect(() => {
    const id = targetId();
    const t = setTimeout(() => {
      setPage(1);
      setDebouncedTargetId(id);
    }, 350);
    onCleanup(() => clearTimeout(t));
  });

  // Refetch whenever page or any (debounced) filter changes.
  createEffect(() => {
    const params = {
      page: page(),
      pageSize: pageSize(),
      filters: {
        search: debouncedSearch(),
        action: actionFilter(),
        result: resultFilter(),
        actorRole: actorRoleFilter(),
        targetId: debouncedTargetId(),
        ...dateFilters(),
      },
    };

    let cancelled = false;
    setLoading(true);
    setError(null);
    getActivities(params)
      .then(({ entries, pagination }) => {
        if (cancelled) return;
        setEntries(entries);
        setPagination(pagination);
        // Top the action dropdown up with whatever the feed actually contains,
        // so new server-side actions become filterable without a code change.
        setSeenActions((prev) => {
          const next = new Set(prev);
          entries.forEach((e) => e.action && next.add(e.action));
          return next.size === prev.length ? prev : [...next];
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[Activity] load failed:", err);
        setError("Couldn't load the activity log. Please try again.");
        setEntries([]);
        setPagination(null);
      })
      .finally(() => !cancelled && setLoading(false));

    onCleanup(() => (cancelled = true));
  });

  const onFilterChange = (setter) => (value) => {
    setPage(1);
    setter(value);
  };

  // Picking from the client dropdown shouldn't wait on the typing debounce.
  const pickClient = (id) => {
    setPage(1);
    setTargetId(id);
    setDebouncedTargetId(id);
  };

  // Canonical groups first, then an "Other" group for anything the feed turned up
  // (or a filter value restored from elsewhere) that isn't in ACTION_GROUPS.
  const actionOptions = createMemo(() => {
    const extra = new Set(seenActions());
    if (actionFilter() !== "all") extra.add(actionFilter()); // keep the active one selectable
    KNOWN_ACTIONS.forEach((a) => extra.delete(a));

    const groups = ACTION_GROUPS.map((g) => ({ label: g.label, actions: g.actions }));
    if (extra.size) {
      groups.push({
        label: "Other",
        actions: [...extra]
          .sort((a, b) => actionLabel(a).localeCompare(actionLabel(b)))
          .map((a) => [a, actionLabel(a)]),
      });
    }
    return groups;
  });

  const filtersActive = () =>
    search() !== "" ||
    actionFilter() !== "all" ||
    resultFilter() !== "all" ||
    actorRoleFilter() !== "all" ||
    targetId() !== "";

  const clearFilters = () => {
    setPage(1);
    setSearch("");
    setDebouncedSearch("");
    setActionFilter("all");
    setResultFilter("all");
    setActorRoleFilter("all");
    setTargetId("");
    setDebouncedTargetId("");
  };

  const total = () => pagination()?.total ?? entries().length;
  const hasPrev = () => pagination()?.has_prev ?? page() > 1;
  const hasNext = () => pagination()?.has_next ?? false;

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-3 lg:p-8">

      {/* Header */}
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            Activity Log
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            A permanent, append-only record of actions taken in the dashboard.
          </p>
        </div>

        {/* Date range — scopes the whole page (summary, feed and the logins tab)
            from one place, so everything below always describes the same window. */}
        <div class="flex flex-wrap items-center gap-2">
          <select
            value={rangePreset()}
            onChange={(e) => pickPreset(e.target.value)}
            aria-label="Date range"
            class="px-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          >
            <For each={DATE_PRESETS}>
              {(p) => <option value={p.value}>{p.label}</option>}
            </For>
            <option value="custom">Custom…</option>
          </select>

          <Show when={rangePreset() === "custom"}>
            <input
              type="date"
              value={customStart()}
              max={customEnd() || today}
              onChange={(e) => setCustomDate(setCustomStart)(e.target.value)}
              aria-label="Start date"
              class="px-3 py-2 text-sm rounded-lg border border-gray-200
                     dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
            <span class="text-sm text-gray-400 dark:text-gray-500">to</span>
            <input
              type="date"
              value={customEnd()}
              min={customStart()}
              max={today}
              onChange={(e) => setCustomDate(setCustomEnd)(e.target.value)}
              aria-label="End date"
              class="px-3 py-2 text-sm rounded-lg border border-gray-200
                     dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </Show>
        </div>
      </div>

      {/* Tabs. Only drawn when there's actually a choice — for a non-admin the
          Logins tab doesn't exist, and a lone "Activity" chip says nothing. */}
      <Show when={showLoginsTab()}>
        <div class="mb-4 inline-flex rounded-lg border border-gray-200 dark:border-gray-700
                    bg-white dark:bg-gray-900 p-1" role="tablist">
          <For each={[["activity", "Activity"], ["logins", "Logins"]]}>
            {([value, label]) => (
              <button
                role="tab"
                aria-selected={tab() === value}
                onClick={() => setTab(value)}
                class={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                  tab() === value
                    ? "bg-purple-600 text-white dark:bg-purple-500"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {label}
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={onLoginsTab()}>
        <Show
          when={!loginsFirstLoad()}
          fallback={
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <For each={Array(4).fill(0)}>
                {() => (
                  <div class="rounded-xl border border-gray-200 dark:border-gray-700
                              bg-white dark:bg-gray-900 p-4 animate-pulse">
                    <div class="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div class="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded mt-2" />
                  </div>
                )}
              </For>
            </div>
          }
        >
          <Show
            when={loginsView()}
            fallback={
              <div class="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700
                          bg-white dark:bg-gray-900 text-sm text-gray-400 dark:text-gray-500">
                Login data unavailable right now.
              </div>
            }
          >
            <LoginsPanel data={loginsView()} refreshing={loginsRefreshing()} />
          </Show>
        </Show>
      </Show>

      {/* ── Activity tab ─────────────────────────────────────────────────────
          Left at its original indentation so the switch to tabs stays a wrapper
          rather than a 150-line reflow of the feed below. */}
      <Show when={tab() === "activity"}>

      {/* Append-only notice */}
      <div class="flex items-start gap-2 mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50
                  dark:border-amber-900/50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
        <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m0-10a2 2 0 012 2v1H10V9a2 2 0 012-2zM5 13h14v8H5z" />
        </svg>
        <span>
          Entries here are <b>never edited or deleted</b>. The log only ever grows as
          new actions are recorded.
        </span>
      </div>

      {/* Summary header — window-level counts from /activity/summary/. Rendered
          from its own resource so a failure here degrades to a one-line notice
          and leaves the feed below untouched. */}
      <Show
        when={!summaryFirstLoad()}
        fallback={
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <For each={Array(3).fill(0)}>
              {() => (
                <div class="rounded-xl border border-gray-200 dark:border-gray-700
                            bg-white dark:bg-gray-900 p-4 animate-pulse">
                  <div class="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div class="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded mt-2" />
                </div>
              )}
            </For>
          </div>
        }
      >
        <Show
          when={summaryView()}
          fallback={
            <div class="mb-4 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700
                        bg-white dark:bg-gray-900 text-sm text-gray-400 dark:text-gray-500">
              Summary unavailable right now — the log below is unaffected.
            </div>
          }
        >
          {/* Dimmed rather than replaced while a new window loads — no skeleton
              flash and no layout jump on every date change. */}
          <div class={`mb-4 ${summaryRefreshing() ? "opacity-50 transition-opacity" : "transition-opacity"}`}>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard label="Total events" value={fmtCount(summaryView().totalEvents)} />
              <StatCard label="Active users" value={fmtCount(summaryView().activeUsers)} />
              <StatCard
                label="Failed logins"
                value={fmtCount(summaryView().failedLogins)}
                tone={summaryView().failedLogins > 0 ? "alert" : "neutral"}
              />
            </div>

            <Show when={summaryWindow()}>
              <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">
                Window: {summaryWindow()}
              </p>
            </Show>
          </div>
        </Show>
      </Show>

      {/* Filters */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-[300px] max-w-full">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by target, user or action…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        <select
          value={actionFilter()}
          onChange={(e) => onFilterChange(setActionFilter)(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200
                 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">All actions</option>
          <For each={actionOptions()}>
            {(g) => (
              <optgroup label={g.label}>
                <For each={g.actions}>
                  {([value, label]) => <option value={value}>{label}</option>}
                </For>
              </optgroup>
            )}
          </For>
        </select>

        <select
          value={resultFilter()}
          onChange={(e) => onFilterChange(setResultFilter)(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200
                 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">All results</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="info">Info</option>
        </select>

        {/* Who did it → ?actor_role= */}
        <select
          value={actorRoleFilter()}
          onChange={(e) => onFilterChange(setActorRoleFilter)(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200
                 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">All roles</option>
          <For each={ACTOR_ROLES}>
            {(r) => <option value={r.value}>{r.label}</option>}
          </For>
        </select>

        {/* Which client it was about → ?target_id=<client_nomen id>. Falls back
            to a typed id when the client list isn't available for this role. */}
        <Show
          when={hasClientList()}
          fallback={
            <input
              type="text"
              inputmode="numeric"
              placeholder={clients.loading ? "Loading clients…" : "Filter by client ID"}
              value={targetId()}
              onInput={(e) => setTargetId(e.target.value)}
              class="w-[180px] px-3 py-2 text-sm rounded-lg border border-gray-200
                     dark:border-gray-700 dark:bg-gray-800 dark:text-white
                     focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
            />
          }
        >
          <select
            value={targetId()}
            onChange={(e) => pickClient(e.target.value)}
            class="max-w-[220px] px-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          >
            <option value="">All clients</option>
            <For each={clients()}>
              {(c) => <option value={String(c.id)}>{c.name}</option>}
            </For>
          </select>
        </Show>

        <Show when={filtersActive()}>
          <button
            onClick={clearFilters}
            class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                   text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700
                   whitespace-nowrap"
          >
            Clear filters
          </button>
        </Show>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {total()} entr{total() !== 1 ? "ies" : "y"}
        </span>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div class="mb-4 px-4 py-3 rounded-xl border border-red-200 bg-red-50
                    dark:border-red-900/50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          {error()}
        </div>
      </Show>

      {/* Table */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50
                       dark:bg-gray-800/60 text-gray-500 dark:text-gray-400
                       uppercase text-xs tracking-wider">
              <th class="p-3 text-left whitespace-nowrap">Time</th>
              <th class="p-3 text-left whitespace-nowrap">User</th>
              <th class="p-3 text-left whitespace-nowrap">Action</th>
              <th class="p-3 text-left">Target</th>
              <th class="p-3 text-left whitespace-nowrap">Change</th>
              <th class="p-3 text-left whitespace-nowrap">Result</th>
            </tr>
          </thead>

          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <For each={Array(6).fill(0)}>
                        {() => (
                          <td class="p-3"><div class="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={entries()}>
                {(a, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                            ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/60 dark:bg-gray-800/30"}`}
                  >
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {fmtTime(a.timestamp)}
                    </td>
                    <td class="p-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      <div class="flex flex-col">
                        <span class="font-medium">{a.actor ?? "—"}</span>
                        <Show when={a.actorRole}>
                          <span class="text-xs text-gray-400 dark:text-gray-500">
                            {roleLabel(a.actorRole)}
                          </span>
                        </Show>
                      </div>
                    </td>
                    <td class="p-3 text-gray-700 dark:text-gray-300 whitespace-nowrap font-medium">
                      <div class="flex flex-col items-start gap-1">
                        <span>{actionLabel(a.action)}</span>
                        <Show when={a.category && a.category !== "general"}>
                          <span class={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide
                                        ${CATEGORY_STYLES[a.category] ?? "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
                            {a.category}
                          </span>
                        </Show>
                      </div>
                    </td>
                    <td class="p-3 max-w-[320px]">
                      <div class="flex flex-col">
                        <Show
                          when={a.category === "campaign" && a.targetId != null}
                          fallback={<span class="text-gray-700 dark:text-gray-300 line-clamp-1">{a.target ?? "—"}</span>}
                        >
                          <A
                            href={`/campaign/${a.targetId}`}
                            class="text-purple-700 dark:text-purple-300 hover:underline line-clamp-1"
                            title={a.target}
                          >
                            {a.target ?? `#${a.targetId}`}
                          </A>
                        </Show>
                        {/* Non-campaign targets are clients, so the id doubles as
                            a one-click "show everything about this client". */}
                        <Show when={a.category !== "campaign" && a.targetId != null}>
                          <button
                            onClick={() => pickClient(String(a.targetId))}
                            class="self-start text-xs text-gray-400 dark:text-gray-500 hover:text-purple-600
                                   dark:hover:text-purple-300 hover:underline"
                            title="Filter the log to this client"
                          >
                            #{a.targetId}
                          </button>
                        </Show>
                      </div>
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      <Show when={changeSummary(a)} fallback={"—"}>
                        {changeSummary(a)}
                      </Show>
                    </td>
                    <td class="p-3 whitespace-nowrap">
                      <span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${RESULT_STYLES[a.result] ?? RESULT_STYLES.info}`}>
                        {a.result}
                      </span>
                      <Show when={a.result === "failure" && a.details?.error}>
                        <span class="block text-xs text-red-500 dark:text-red-400 mt-1 max-w-[220px] line-clamp-2" title={a.details.error}>
                          {a.details.error}
                        </span>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>

              <Show when={entries().length === 0}>
                <tr>
                  <td colspan="6" class="py-16 text-center text-gray-400 dark:text-gray-500">
                    <svg class="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    No activity matches your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>
        </table>
      </div>

      {/* Pagination */}
      <div class="mt-4 flex items-center justify-between gap-3 text-sm flex-wrap">
        <div class="flex items-center gap-3">
          <span class="text-gray-500 dark:text-gray-400">
            <Show when={pagination()} fallback={`${entries().length} shown`}>
              Page {pagination().page} of {pagination().total_pages || 1} ·{" "}
              {total()} total
            </Show>
          </span>
          <RowsPerPageSelect
            value={pageSize()}
            options={ROWS_PER_PAGE_OPTIONS}
            onChange={changePageSize}
          />
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={() => hasPrev() && setPage((p) => Math.max(1, p - 1))}
            disabled={!hasPrev() || loading()}
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300
                   hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-default"
          >
            Previous
          </button>
          <button
            onClick={() => hasNext() && setPage((p) => p + 1)}
            disabled={!hasNext() || loading()}
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300
                   hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-default"
          >
            Next
          </button>
        </div>
      </div>

      </Show>
    </div>
  );
}
