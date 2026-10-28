import { createSignal, createResource, createMemo, createEffect, on, onCleanup, For, Show } from "solid-js";
import Swal from "sweetalert2";
import { TriangleAlert, Target, Megaphone, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, ChartColumn, ChevronDown, Check, Search, Users, ChevronsLeftRight, ChevronsRightLeft } from "lucide-solid";
import { fetchCplCampaigns, setCplTarget, fetchHighVolumeClients } from "../../services/cplRules";
import { scopeKey } from "../../stores/cmScope";
import { isAdmin, isCoordination } from "../../stores/currentUser";
import Avatar from "../../components/common/Avatar";

// ─────────────────────────────────────────────────────────────────────────────
// Tier B — CPL Rules & Alerts (admin + coordination + CM-scoped). Campaigns
// ranked by how far over their (client, project) target CPL they run, plus
// high-volume client tags. Project theme (navy/red).
// Every row carries a target_cpl: explicit, or the ₹300 default
// (target_is_default). Three tabs share one endpoint: All (optional cm_id),
// High CPL by CM (cm_id required), Expensive (only=expensive, optional cm_id).
// Sorting is client-side — the list isn't paginated. With no column picked the
// API order (expensiveness desc) stands.
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "all", label: "All campaigns", sort: null },
  { key: "cm", label: "High CPL by CM", sort: { key: "actual_cpl", dir: "desc" } },
  { key: "expensive", label: "Expensive campaigns", sort: { key: "over_target", dir: "desc" } },
];

const numOrNull = (v) => {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
};
const strOrNull = (s) => (s ? String(s).toLowerCase() : null);

// Sort accessors. null = empty → always sorted last whatever the direction.
// Text columns open ascending, numbers descending.
const SORT_COLS = {
  name: { get: (c) => strOrNull(c.name), first: "asc" },
  client: { get: (c) => strOrNull([c.client, c.project].filter(Boolean).join(" ")), first: "asc" },
  project: { get: (c) => strOrNull(c.project), first: "asc" },
  cm: { get: (c) => strOrNull((c.campaign_managers || []).join(", ")), first: "asc" },
  ad_account: { get: (c) => strOrNull(c.ad_account_name || c.ad_account), first: "asc" },
  spend: { get: (c) => numOrNull(c.spend), first: "desc" },
  leads: { get: (c) => numOrNull(c.leads), first: "desc" },
  actual_cpl: { get: (c) => numOrNull(c.actual_cpl), first: "desc" },
  target_cpl: { get: (c) => numOrNull(c.target_cpl), first: "desc" },
  // A flagged no-lead campaign has over_target_pct null but is the worst
  // case → rank it above every real percentage.
  over_target: {
    get: (c) => (c.no_leads && c.needs_attention ? Infinity : numOrNull(c.over_target_pct)),
    first: "desc",
  },
  attention: { get: (c) => (c.needs_attention ? 1 : 0), first: "desc" },
};

const sortRows = (list, sort) => {
  if (!sort) return list;
  const get = SORT_COLS[sort.key].get;
  const mul = sort.dir === "asc" ? 1 : -1;
  // Array.prototype.sort is stable → ties keep the API's expensiveness order.
  return [...list].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (x === y) return 0; // also keeps Infinity − Infinity (NaN) out
    if (typeof x === "string") return x.localeCompare(y) * mul;
    return (x - y) * mul;
  });
};

const WINDOW_DAYS = [2, 4, 7];

// meta.window → "22 Oct – 28 Oct 2026 (7 days)". Dates parsed as local
// calendar days (new Date("YYYY-MM-DD") would be UTC midnight).
const windowCaption = (w) => {
  if (!w?.since || !w?.until) return null;
  const parse = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const a = parse(w.since);
  const b = parse(w.until);
  if (isNaN(a) || isNaN(b)) return null;
  const fmt = (dt, withYear) =>
    dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  const days = w.days != null ? ` (${w.days} day${Number(w.days) === 1 ? "" : "s"})` : "";
  return `${fmt(a, a.getFullYear() !== b.getFullYear())} – ${fmt(b, true)}${days}`;
};

// meta.cms tier ("tier_2", 2, "Tier 2") → "2"
const tierNum = (m) => (m.tier == null ? "" : String(m.tier).replace(/\D/g, ""));
const cmName = (m) => m.name || m.email || `#${m.id}`;

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    toast("success", "Copied");
  } catch {
    toast("error", "Copy failed");
  }
};

const money2 = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const num = (v) => (Number(v) || 0).toLocaleString("en-IN");
const ratioFmt = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `${n.toFixed(2)}×`;
};
const overPctFmt = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
};

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: "top-end", timer: 3200, showConfirmButton: false });

// ─── Table layout ─────────────────────────────────────────────────────────────
const TH = "p-3 text-[13px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap bg-gray-50 dark:bg-gray-800";
const TD = "p-3 align-middle border-b border-gray-100 dark:border-gray-800";

// Numbers pinned to the right edge, left → right. Fixed widths so each
// column's `right` offset is the sum of the widths after it.
const STICKY = [
  { key: "leads", width: 80 },
  { key: "actual_cpl", width: 124 },
  { key: "target_cpl", width: 122 },
  { key: "over_target", width: 136 },
  { key: "action", width: 104 },
];
// Divider + shadow on the two resizable columns — header only, so the body
// reads as a plain table.
const RESIZE_EDGE = "relative z-[1] border-r border-gray-200 dark:border-gray-700 shadow-[6px_0_8px_-6px_rgba(0,0,0,0.18)]";

// ─── Drag-resizable column (same behaviour as the Campaigns page) ────────────
const COL_MIN = 160;
const COL_MAX = 900;
// `min` is the narrowest the column may go — at least its header (label, sort
// arrows, expand button), so the divider never cuts across them.
function createResizableCol(storageKey, def, wide, min = COL_MIN) {
  const read = () => {
    try {
      const v = Number(localStorage.getItem(storageKey));
      return v >= min && v <= COL_MAX ? v : def;
    } catch {
      return def;
    }
  };
  const [width, setWidth] = createSignal(read());
  const [active, setActive] = createSignal(false);
  const save = (w) => {
    try {
      localStorage.setItem(storageKey, String(w));
    } catch {
      /* storage unavailable — width just won't persist */
    }
  };
  const start = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = width();
    setActive(true);
    const onMove = (ev) => setWidth(Math.min(COL_MAX, Math.max(min, startW + ev.clientX - startX)));
    const onUp = () => {
      setActive(false);
      save(width());
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  // Double-click the divider: toggle between default and wide.
  const toggle = (e) => {
    e.stopPropagation();
    const w = width() > def ? def : wide;
    setWidth(w);
    save(w);
  };
  const style = () => ({ width: `${width()}px`, "min-width": `${width()}px`, "max-width": `${width()}px` });
  const expanded = () => width() > def;
  return { active, start, toggle, style, expanded };
}

function ResizeHandle(props) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to toggle width"
      class="absolute top-0 -right-1.5 h-full w-3 z-10 cursor-col-resize group/rs flex justify-center"
      onPointerDown={props.col.start}
      onClick={(e) => e.stopPropagation()}
      onDblClick={props.col.toggle}
    >
      <span class={`h-full w-0.5 transition-colors ${props.col.active() ? "bg-[#AC2334]" : "bg-gray-300 dark:bg-gray-600 group-hover/rs:bg-[#AC2334]"}`} />
    </span>
  );
}

// Header button: expand / collapse the column (same as double-clicking the edge).
function ExpandBtn(props) {
  return (
    <button type="button" onClick={props.col.toggle}
      title={props.col.expanded() ? "Collapse column" : "Expand column"}
      class={`ml-1.5 p-0.5 rounded transition-colors hover:text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/20 ${props.col.expanded() ? "text-[#AC2334]" : "text-gray-400"}`}>
      <Show when={props.col.expanded()} fallback={<ChevronsLeftRight size={14} />}>
        <ChevronsRightLeft size={14} />
      </Show>
    </button>
  );
}

// ─── Expensiveness ratio badge ────────────────────────────────────────────────
function RatioBadge(props) {
  const a = () => props.campaign;
  const ratio = () => parseFloat(a().expensiveness_ratio);
  const tone = () => {
    if (!a().needs_attention) return "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300";
    const r = ratio();
    return isFinite(r) && r >= 1.5
      ? "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300"
      : "bg-[#FBF3E2] text-[#B07A14] dark:bg-amber-900/30 dark:text-amber-300";
  };
  return (
    <Show when={ratioFmt(a().expensiveness_ratio) != null} fallback={<span class="text-gray-400 dark:text-gray-500 text-xs">—</span>}>
      <span class={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${tone()}`}>{ratioFmt(a().expensiveness_ratio)}</span>
    </Show>
  );
}

// ─── Sort button — same ⇅ / ↑ ↓ markers as the Campaigns page ──────────────
function SortBtn(props) {
  const active = () => props.sort?.key === props.col;
  return (
    <button type="button" onClick={() => props.onSort(props.col)}
      class="inline-flex items-center uppercase tracking-wider transition-colors hover:text-purple-600">
      {props.label}
      {active() ? <span class="ml-1 text-purple-600">{props.sort.dir === "asc" ? "↑" : "↓"}</span> : <span class="text-gray-300 ml-1">⇅</span>}
    </button>
  );
}

// ─── Totals card with tinted background shapes ───────────────────────────────
const SHAPE_TONES = {
  crimson: {
    color: "#D92D45",
    card: "from-[#FDEEF1] via-white to-[#FDF3F5] border-[#F6D3D9] dark:from-red-950/40 dark:via-gray-900 dark:to-gray-900 dark:border-red-900/50",
    chip: "bg-[#FBDDE2] text-[#C8243B] dark:bg-red-900/40 dark:text-red-300",
    value: "text-[#C8243B] dark:text-[#F06A7E]",
  },
  gold: {
    color: "#E0A030",
    card: "from-[#FEF6E7] via-white to-[#FEF9EF] border-[#F5E2BC] dark:from-amber-950/40 dark:via-gray-900 dark:to-gray-900 dark:border-amber-900/50",
    chip: "bg-[#FCEBC8] text-[#C4801A] dark:bg-amber-900/40 dark:text-amber-300",
    value: "text-[#C4801A] dark:text-[#E9AE5C]",
  },
  blue: {
    color: "#3B6FE0",
    card: "from-[#EDF3FE] via-white to-[#F2F6FE] border-[#D3E0FA] dark:from-blue-950/40 dark:via-gray-900 dark:to-gray-900 dark:border-blue-900/50",
    chip: "bg-[#DCE7FC] text-[#2F5FCC] dark:bg-blue-900/40 dark:text-blue-300",
    value: "text-[#2F5FCC] dark:text-[#7FA6F0]",
  },
};

function ShapeTile(props) {
  const tone = () => SHAPE_TONES[props.tone] ?? SHAPE_TONES.blue;
  const Icon = props.icon;
  return (
    <div class={`relative rounded-xl border bg-gradient-to-br px-5 py-4 shadow-[0_1px_2px_rgba(20,35,58,0.04)] hover:shadow-[0_6px_18px_rgba(20,35,58,0.08)] transition-shadow ${tone().card}`}
      style={{ "--tile-accent": tone().color }}>
      {/* Moving border trace — same as the Campaign Analysis tiles */}
      <span class="tile-trace" aria-hidden="true" />
      {/* Shapes are clipped in their own layer so the trace, which sits on the
          border, isn't clipped with them. */}
      <span class="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden="true">
      {/* Soft wave shapes, bottom-right */}
      <svg class="pointer-events-none absolute right-0 bottom-0 h-full w-[70%]" viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true">
        <path d="M60 120 C 120 70, 180 110, 240 60 S 300 20, 300 20 L300 120 Z" fill={tone().color} fill-opacity="0.07" />
        <path d="M0 120 C 90 95, 150 120, 220 85 S 300 60, 300 55 L300 120 Z" fill={tone().color} fill-opacity="0.06" />
        <circle cx="270" cy="18" r="46" fill={tone().color} fill-opacity="0.05" />
      </svg>
      </span>
      <div class="relative flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-[13px] font-semibold text-gray-700 dark:text-gray-200 truncate">{props.label}</p>
          <p class={`mt-1 text-3xl font-bold tabular-nums ${tone().value}`}>{props.value}</p>
          <Show when={props.sub}>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{props.sub}</p>
          </Show>
        </div>
        <Show when={Icon}>
          <span class={`flex h-11 w-11 flex-none items-center justify-center rounded-xl ${tone().chip}`}>
            <Icon size={20} stroke-width={2} />
          </span>
        </Show>
      </div>
    </div>
  );
}

// ─── High-volume client chips — muted dot + count tint, cycled ──────────────
const HV_TONES = [
  { dot: "#6B7A99", chip: "#F5F6F9", line: "#E3E7EE", bg: "#E9ECF2", fg: "#4F5D78" }, // slate blue
  { dot: "#9A7480", chip: "#FAF6F7", line: "#EEE2E5", bg: "#F1E9EB", fg: "#7A5662" }, // dusty rose
  { dot: "#6F8C7B", chip: "#F5F8F6", line: "#E0EAE3", bg: "#E8EFEA", fg: "#52705F" }, // sage
  { dot: "#9A8468", chip: "#FAF8F4", line: "#EDE6DA", bg: "#F1ECE4", fg: "#79654C" }, // taupe
  { dot: "#80739A", chip: "#F7F6FA", line: "#E6E2EE", bg: "#ECE9F1", fg: "#615679" }, // plum
  { dot: "#5F8A90", chip: "#F4F8F8", line: "#DDE9EA", bg: "#E6EEEF", fg: "#466D72" }, // steel teal
];

// ─── Custom range calendar ────────────────────────────────────────────────────
// One month at a time: first click picks the start, second the end (swapped if
// earlier). Dates are local "YYYY-MM-DD"; nothing after today is pickable.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shortDate = (s) => (s ? parseYmd(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function RangeCalendar(props) {
  const today = ymd(new Date());
  const [since, setSince] = createSignal(props.since || "");
  const [until, setUntil] = createSignal(props.until || "");
  const [hover, setHover] = createSignal("");
  const start = parseYmd(props.until || props.since || today);
  const [month, setMonth] = createSignal(new Date(start.getFullYear(), start.getMonth(), 1));
  let root;

  const onDoc = (e) => {
    if (root && !root.contains(e.target) && !props.anchor?.contains(e.target)) props.onClose();
  };
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));

  // 6 rows × 7, Monday-first, padded with the neighbouring months.
  const cells = createMemo(() => {
    const m = month();
    const offset = (m.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(m.getFullYear(), m.getMonth(), 1 - offset + i);
      return { key: ymd(d), day: d.getDate(), inMonth: d.getMonth() === m.getMonth() };
    });
  });
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const canNext = () => ymd(new Date(month().getFullYear(), month().getMonth() + 1, 1)) <= today;

  const pick = (key) => {
    if (key > today) return;
    if (!since() || until()) {
      setSince(key);
      setUntil("");
    } else if (key < since()) {
      setUntil(since());
      setSince(key);
    } else {
      setUntil(key);
    }
  };
  // While choosing the end, preview the range up to the hovered day.
  const rangeEnd = () => until() || (since() && hover() >= since() ? hover() : "");
  const inRange = (k) => since() && rangeEnd() && k > since() && k < rangeEnd();
  const isEdge = (k) => k === since() || k === rangeEnd();

  return (
    <div ref={root} class="absolute left-0 top-full mt-2 z-40 w-[300px] bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-[0_12px_32px_rgba(20,35,58,0.14)] p-3">
      <div class="flex items-center justify-between mb-2">
        <button type="button" onClick={() => shift(-1)} class="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {month().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </span>
        <button type="button" onClick={() => canNext() && shift(1)} disabled={!canNext()} class="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent" aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>
      <div class="grid grid-cols-7 mb-1">
        <For each={WEEKDAYS}>{(w) => <span class="text-center text-[11px] font-semibold uppercase text-gray-400 py-1">{w}</span>}</For>
      </div>
      <div class="grid grid-cols-7 gap-y-0.5" onPointerLeave={() => setHover("")}>
        <For each={cells()}>
          {(c) => {
            const future = c.key > today;
            return (
              <button type="button" disabled={future} onClick={() => pick(c.key)} onPointerEnter={() => setHover(c.key)}
                class={`h-8 text-[13px] tabular-nums transition-colors ${
                  isEdge(c.key)
                    ? "bg-[#14233A] text-white font-semibold rounded-md"
                    : inRange(c.key)
                      ? "bg-[#EEF1F5] text-[#14233A] dark:bg-gray-800 dark:text-gray-100"
                      : future
                        ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                        : `${c.inMonth ? "text-gray-700 dark:text-gray-200" : "text-gray-300 dark:text-gray-600"} rounded-md hover:bg-gray-100 dark:hover:bg-gray-800`
                } ${c.key === today && !isEdge(c.key) ? "ring-1 ring-inset ring-[#AC2334]/50 rounded-md" : ""}`}>
                {c.day}
              </button>
            );
          }}
        </For>
      </div>
      <div class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
        <span class="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
          {shortDate(since())} <span class="text-gray-300">→</span> {shortDate(until())}
        </span>
        <div class="flex gap-1.5">
          <button type="button" onClick={props.onClose} class="px-2.5 py-1 text-xs font-semibold rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
          <button type="button" disabled={!since() || !until()} onClick={() => props.onApply(since(), until())}
            class="px-3 py-1 text-xs font-bold rounded-md bg-[#AC2334] text-white hover:bg-[#921d2c] disabled:opacity-50">Apply</button>
        </div>
      </div>
    </div>
  );
}

// ─── Campaign-manager picker ─────────────────────────────────────────────────
function CmPicker(props) {
  const [open, setOpen] = createSignal(false);
  const [q, setQ] = createSignal("");
  let root;

  const onDoc = (e) => {
    if (root && !root.contains(e.target)) setOpen(false);
  };
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));

  const selected = () => props.options.find((m) => String(m.id) === String(props.value)) || null;
  const filtered = () => {
    const s = q().trim().toLowerCase();
    if (!s) return props.options;
    return props.options.filter((m) => cmName(m).toLowerCase().includes(s));
  };
  const pick = (id) => {
    props.onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div class="relative" ref={root}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        class={`min-w-[260px] max-w-[320px] inline-flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg border bg-white dark:bg-gray-800 text-sm text-left transition-colors ${props.highlight ? "border-[#AC2334] ring-2 ring-[#AC2334]/20" : "border-gray-200 dark:border-gray-700 hover:border-[#AC2334]/40"}`}>
        <Show when={selected()} fallback={
          <>
            <span class="w-7 h-7 rounded-full flex items-center justify-center bg-[#F1F4F9] dark:bg-gray-700 text-[#54657E] dark:text-gray-300 flex-shrink-0"><Users size={14} /></span>
            <span class="flex-1 truncate font-medium text-gray-600 dark:text-gray-300">{props.placeholder}</span>
          </>
        }>
          <Avatar name={cmName(selected())} size="w-7 h-7" textSize="text-[10px]" />
          <span class="flex-1 min-w-0">
            <span class="block truncate font-semibold text-gray-800 dark:text-gray-100 leading-tight capitalize">{cmName(selected())}</span>
            <span class="block text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
              {tierNum(selected()) ? `Tier ${tierNum(selected())} · ` : ""}{num(selected().campaigns)} campaigns
            </span>
          </span>
        </Show>
        <ChevronDown size={16} class={`flex-shrink-0 text-gray-400 transition-transform ${open() ? "rotate-180" : ""}`} />
      </button>

      <Show when={open()}>
        <div class="absolute left-0 top-full mt-1.5 z-40 w-[360px] bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-[0_12px_32px_rgba(20,35,58,0.14)] overflow-hidden">
          <div class="p-2 border-b border-gray-100 dark:border-gray-800">
            <div class="relative">
              <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Find a campaign manager…" value={q()} onInput={(e) => setQ(e.target.value)} autofocus
                class="w-full pl-8 pr-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]" />
            </div>
          </div>
          <div class="max-h-[340px] overflow-y-auto py-1">
            <Show when={props.allowAll}>
              <button type="button" onClick={() => pick("")}
                class={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 ${!props.value ? "bg-[#FBEEF0]/60 dark:bg-red-900/10" : ""}`}>
                <span class="w-7 h-7 rounded-full flex items-center justify-center bg-[#F1F4F9] dark:bg-gray-700 text-[#54657E] dark:text-gray-300 flex-shrink-0"><Users size={14} /></span>
                <span class="flex-1 text-sm font-semibold text-gray-800 dark:text-gray-100">All campaign managers</span>
                <Show when={!props.value}><Check size={15} class="text-[#AC2334]" /></Show>
              </button>
              <div class="my-1 border-t border-gray-100 dark:border-gray-800" />
            </Show>
            <For each={filtered()} fallback={<p class="px-3 py-4 text-center text-xs text-gray-400">No match</p>}>
              {(m) => {
                const on = () => String(m.id) === String(props.value);
                const exp = () => Number(m.expensive) || 0;
                return (
                  <button type="button" onClick={() => pick(String(m.id))}
                    class={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 ${on() ? "bg-[#FBEEF0]/60 dark:bg-red-900/10" : ""}`}>
                    <Avatar name={cmName(m)} size="w-7 h-7" textSize="text-[10px]" />
                    <span class="flex-1 min-w-0">
                      <span class="flex items-center gap-1.5">
                        <span class="truncate text-sm font-semibold text-gray-800 dark:text-gray-100 capitalize">{cmName(m)}</span>
                        <Show when={tierNum(m)}>
                          <span class="flex-shrink-0 px-1.5 py-px rounded text-[10px] font-bold bg-[#EEF2F7] text-[#14233A] dark:bg-[#1A2B45] dark:text-[#A9C1E0]">T{tierNum(m)}</span>
                        </Show>
                      </span>
                      <span class="block text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">{num(m.campaigns)} campaigns</span>
                    </span>
                    <span title="Expensive campaigns"
                      class={`flex-shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${exp() > 0 ? "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300" : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"}`}>
                      {num(exp())} expensive
                    </span>
                    <span class="w-4 flex-shrink-0"><Show when={on()}><Check size={15} class="text-[#AC2334]" /></Show></span>
                  </button>
                );
              }}
            </For>
          </div>
          <div class="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-400 flex justify-between">
            <span>Sorted by most expensive campaigns</span>
          </div>
        </div>
      </Show>
    </div>
  );
}

// ─── Set-target modal (admin + coordination) — client_id + project_id from the feed ─
function TargetModal(props) {
  const c = () => props.campaign;
  // The ₹300 default isn't a saved target — start blank so saving is deliberate.
  const [value, setValue] = createSignal(c()?.target_is_default ? "" : (c()?.target_cpl ?? ""));
  const [saving, setSaving] = createSignal(false);

  const submit = async (e) => {
    e.preventDefault();
    if (value() === "") return;
    setSaving(true);
    try {
      await setCplTarget({
        client_id: c().client_id,
        project_id: c().project_id,
        target_cpl: String(value()),
      });
      toast("success", "Target CPL saved");
      props.onSaved();
      props.onClose();
    } catch (err) {
      toast("error", err?.message || "Failed to save target");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={props.onClose} />
      <div class="relative z-10 w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-2xl">
        <div class="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F1] dark:border-gray-800">
          <div>
            <h2 class="text-base font-bold text-[#14233A] dark:text-white">Set target CPL</h2>
            <p class="text-xs text-[#54657E] dark:text-gray-400">{c()?.client} · {c()?.project}</p>
          </div>
          <button onClick={props.onClose} class="w-8 h-8 rounded-full flex items-center justify-center text-[#8593A8] hover:bg-[#F1F4F9] dark:hover:bg-gray-800">✕</button>
        </div>
        <form onSubmit={submit} class="px-5 py-5 space-y-4">
          <div>
            <label class="block text-sm font-semibold text-[#1A2B45] dark:text-gray-300 mb-1">Target CPL (₹)</label>
            <input type="number" min="0" step="0.01" required value={value()} onInput={(e) => setValue(e.target.value)}
              class="w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]" />
            <p class="text-xs text-[#8593A8] mt-1">Applies to every campaign under this client + project.</p>
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" onClick={props.onClose} class="px-4 py-2 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-[#54657E] dark:text-gray-300 hover:bg-[#F1F4F9] dark:hover:bg-gray-800">Cancel</button>
            <button type="submit" disabled={saving() || value() === ""} class="px-4 py-2 text-sm rounded-lg bg-[#AC2334] text-white font-bold hover:bg-[#921d2c] disabled:opacity-60">{saving() ? "Saving…" : "Save target"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CplRules() {
  // Backend allows target writes for admin + coordination; CMs get 403.
  const canSetTarget = () => isAdmin() || isCoordination();
  // Opens on Expensive — the list someone lands here to act on.
  const [tab, setTab] = createSignal("expensive");
  const [cmId, setCmId] = createSignal("");
  const [sort, setSort] = createSignal(TABS.find((t) => t.key === "expensive").sort);
  const [search, setSearch] = createSignal("");
  const [attentionOnly, setAttentionOnly] = createSignal(false);
  const [targetCampaign, setTargetCampaign] = createSignal(null);
  const [cms, setCms] = createSignal([]);

  const nameCol = createResizableCol("cplRules.nameColWidth.v2", 220, 520);
  const clientCol = createResizableCol("cplRules.clientColWidth.v2", 228, 440, 228);

  // Right offsets for the pinned number columns (the action column only
  // exists for admin + coordination).
  const stickyCols = () => STICKY.filter((s) => s.key !== "action" || canSetTarget());
  const stickyStyle = (key) => {
    const cols = stickyCols();
    const i = cols.findIndex((s) => s.key === key);
    const right = cols.slice(i + 1).reduce((t, s) => t + s.width, 0);
    const w = `${cols[i].width}px`;
    return { right: `${right}px`, width: w, "min-width": w, "max-width": w };
  };
  // px-2 (not p-3) keeps the pinned block tight.
  const stickyCls = () => "sticky px-2";

  // High CPL by CM needs a CM before it shows anything.
  const needsCm = () => tab() === "cm" && !cmId();

  // A different Viewing scope has a different CM list — drop the pick.
  createEffect(on(scopeKey, () => setCmId(""), { defer: true }));

  // Date window — shared by all three tabs and kept across tab / CM / search.
  // { days } or { since, until }. Custom is staged in drafts until Apply.
  const [win, setWin] = createSignal({ days: 7 });
  const [calOpen, setCalOpen] = createSignal(false);
  let customBtn;
  const [draftSince, setDraftSince] = createSignal("");
  const [draftUntil, setDraftUntil] = createSignal("");

  const [data, { refetch }] = createResource(
    () => ({ scope: scopeKey(), tab: tab(), cmId: cmId(), win: win() }),
    async ({ tab: t, cmId: id, win: w }) => {
      // With no CM picked on the CM tab we still fetch unfiltered — that's
      // where the dropdown options (meta.cms) come from.
      // Errors are returned, not thrown: a 422 on a bad custom range is an
      // expected outcome and its message is shown as-is.
      try {
        const res = await fetchCplCampaigns({ cmId: id || undefined, only: t === "expensive" ? "expensive" : undefined, ...w });
        // CM counts are per window, so refresh them on every load.
        if (Array.isArray(res?.meta?.cms)) setCms(res.meta.cms);
        return {
          rows: Array.isArray(res?.data) ? res.data : [],
          summary: res?.meta?.summary ?? null,
          window: res?.meta?.window ?? null,
        };
      } catch (err) {
        return { rows: [], summary: null, window: null, error: err };
      }
    },
  );

  const loadError = () => {
    const err = data()?.error;
    if (!err) return null;
    if (err.status === 422) return err.message || "Invalid date range.";
    if (err.status === 403 && cmId()) return "You don't have access to that campaign manager's campaigns.";
    return "Failed to load CPL rules. Please try again.";
  };

  const windowKey = () => (win().days ? String(win().days) : "custom");
  const pickDays = (d) => {
    setCalOpen(false);
    if (win().days !== d) setWin({ days: d });
  };
  const openCustom = () => {
    // Seed the picker with the window currently shown.
    const w = data()?.window;
    if (!draftSince() && w?.since) setDraftSince(w.since);
    if (!draftUntil() && w?.until) setDraftUntil(w.until);
    setCalOpen((v) => !v);
  };

  const cmOptions = createMemo(() =>
    [...cms()].sort((a, b) =>
      (Number(b.expensive) || 0) - (Number(a.expensive) || 0) ||
      String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")),
    ),
  );

  const pickTab = (key) => {
    if (key === tab()) return;
    setTab(key);
    setSort(TABS.find((t) => t.key === key).sort);
  };

  const toggleSort = (key) => {
    const cur = sort();
    if (cur?.key === key) setSort({ key, dir: cur.dir === "asc" ? "desc" : "asc" });
    else setSort({ key, dir: SORT_COLS[key].first });
  };

  const [highVol] = createResource(
    () => ({ scope: scopeKey() }),
    async () => {
      const res = await fetchHighVolumeClients();
      return { rows: Array.isArray(res?.data) ? res.data : [], meta: res?.meta ?? null };
    },
  );

  const campaigns = () => data()?.rows ?? [];
  const summary = () => data()?.summary ?? null;

  const rows = createMemo(() => {
    if (needsCm()) return [];
    const q = search().trim().toLowerCase();
    const filtered = campaigns().filter((c) => {
      if (q) {
        const hay = [c.name, c.client, c.project, ...(c.campaign_managers || []), c.ad_account_name, c.ad_account];
        if (!hay.some((s) => s && String(s).toLowerCase().includes(q))) return false;
      }
      if (attentionOnly() && !c.needs_attention) return false;
      return true;
    });
    return sortRows(filtered, sort());
  });

  const defaultTarget = () => money2(summary()?.default_target_cpl ?? 300);
  const colCount = () => (canSetTarget() ? 11 : 10);

  const attnThreshold = () => {
    const t = summary()?.attention_threshold_pct;
    return t == null ? null : `${Number(t)}%`;
  };

  const pill = (on) =>
    `px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
      on
        ? "bg-[#14233A] text-white border-[#14233A]"
        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
    }`;

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6 lg:p-8">
      {/* ══ Header ══ */}
      <div class="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
              <Target size={20} stroke-width={2} />
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              CPL Rules &amp; Alerts
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Campaigns ranked by how far over their target CPL they run. Most over-target first.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={data.loading}
          class="px-3.5 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-[#AC2334]/40 disabled:opacity-50 transition"
        >
          {data.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* ══ Date window ══ */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] font-bold uppercase tracking-wider text-gray-400 mr-1">Range</span>
          <For each={WINDOW_DAYS}>
            {(d) => (
              <button type="button" onClick={() => pickDays(d)} aria-pressed={windowKey() === String(d)}
                class={pill(windowKey() === String(d))}>
                Last {d} days
              </button>
            )}
          </For>
          <div class="relative">
            <button type="button" ref={customBtn} onClick={openCustom} class={`${pill(windowKey() === "custom" || calOpen())} inline-flex items-center gap-1.5`}>
              <CalendarDays size={14} />
              Custom
            </button>
            <Show when={calOpen()}>
              <RangeCalendar
                anchor={customBtn}
                since={draftSince()}
                until={draftUntil()}
                onClose={() => setCalOpen(false)}
                onApply={(s, u) => {
                  setDraftSince(s);
                  setDraftUntil(u);
                  setWin({ since: s, until: u });
                  setCalOpen(false);
                }}
              />
            </Show>
          </div>
          <Show when={windowCaption(data()?.window)}>
            <span class="ml-auto text-[13px] font-medium tabular-nums text-gray-600 dark:text-gray-300">{windowCaption(data()?.window)}</span>
          </Show>
        </div>
      </div>

      {/* ══ Tabs ══ */}
      <div class="flex flex-wrap gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        <For each={TABS}>
          {(t) => (
            <button onClick={() => pickTab(t.key)}
              class={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${tab() === t.key ? "border-[#AC2334] text-[#AC2334] dark:text-red-400" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-[#14233A] dark:hover:text-white"}`}>
              {t.label}
            </button>
          )}
        </For>
      </div>

      {/* ══ High-volume clients ══ */}
      <Show when={!highVol.loading && (highVol()?.rows?.length ?? 0) > 0}>
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 mb-4 flex flex-wrap items-center gap-x-2 gap-y-2">
          <span class="inline-flex items-center gap-2 mr-2">
            <span class="flex h-6 w-6 items-center justify-center rounded-md bg-[#EEF1F5] text-[#5B6B85] dark:bg-gray-800 dark:text-gray-300">
              <ChartColumn size={13} stroke-width={2.2} />
            </span>
            <span class="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">High-volume clients</span>
            <Show when={highVol()?.meta?.threshold != null}>
              <span class="text-xs text-gray-400">&gt; {num(highVol().meta.threshold)}/day</span>
            </Show>
          </span>
          <For each={highVol().rows}>
            {(hv, i) => {
              const t = HV_TONES[i() % HV_TONES.length];
              return (
                <span class="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-md border text-xs font-medium text-gray-700 dark:text-gray-200" style={{ background: t.chip, "border-color": t.line }}>
                  <span class="flex h-3 w-3 flex-none items-center justify-center rounded-full border" style={{ "border-color": t.dot }}>
                    <span class="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} />
                  </span>
                  {hv.name}
                  <span class="ml-0.5 px-1.5 py-px rounded text-[11px] font-semibold tabular-nums" style={{ background: t.bg, color: t.fg }}>{num(hv.leads_today)}</span>
                </span>
              );
            }}
          </For>
        </div>
      </Show>

      {/* ══ Totals ══ */}
      <Show when={!needsCm() && !loadError()}>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Show when={!data.loading && summary()} fallback={
            <For each={Array(3).fill(0)}>{() => <div class="h-[112px] rounded-xl bg-white dark:bg-gray-900 border border-[#E2E8F1] dark:border-gray-700 animate-pulse" />}</For>
          }>
            <ShapeTile label="Needs attention" icon={TriangleAlert} tone="crimson"
              value={num(summary().needs_attention)}
              sub={attnThreshold() ? (
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 font-medium">
                  <ArrowUp size={12} stroke-width={2.5} /> ≥ {attnThreshold()} over target
                </span>
              ) : undefined} />
            <ShapeTile label="No explicit target" icon={Target} tone="gold"
              value={num(summary().no_target_set)}
              sub={`rated against the ${defaultTarget()} default`} />
            <ShapeTile label="Campaigns" icon={Megaphone} tone="blue"
              value={num(summary().campaigns)}
              sub="in scope" />
          </Show>
        </div>
      </Show>

      {/* ══ Search · CM · attention ══ */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-full sm:w-[340px]">
          <Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search campaign, client, project, CM or ad account…" value={search()} onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]" />
        </div>
        <CmPicker
          value={cmId()}
          options={cmOptions()}
          onChange={setCmId}
          allowAll={tab() !== "cm"}
          highlight={needsCm()}
          placeholder={tab() === "cm" ? "Select a campaign manager" : "All campaign managers"}
        />
        <button onClick={() => setAttentionOnly((v) => !v)}
          class={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${attentionOnly() ? "bg-[#AC2334] text-white border-[#AC2334]" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#AC2334]/40"}`}>
          Needs attention
          <span class={`text-[11px] font-extrabold px-1.5 py-px rounded-full ${attentionOnly() ? "bg-white/20 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>{campaigns().filter((c) => c.needs_attention).length}</span>
        </button>
        <span class="ml-auto text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap"><b class="text-gray-800 dark:text-white tabular-nums">{rows().length}</b> shown</span>
      </div>

      <Show when={loadError()}>
        <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
          {loadError()}
        </div>
      </Show>

      {/* ══ Table ══ */}
      <Show when={!needsCm()} fallback={
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 py-16 text-center text-sm font-medium text-gray-400 dark:text-gray-500">
          Select a campaign manager to see their campaigns, highest CPL first.
        </div>
      }>
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-auto max-h-[calc(100vh-12rem)]">
        <table class="min-w-full text-sm border-separate border-spacing-0">
          <thead class="sticky top-0 z-30">
            <tr>
              <th class={`${TH} text-left relative border-b border-gray-200 dark:border-gray-700 ${RESIZE_EDGE}`} style={nameCol.style()}>
                <span class="inline-flex items-center">
                  <SortBtn col="name" label="Campaign" sort={sort()} onSort={toggleSort} />
                  <ExpandBtn col={nameCol} />
                </span>
                <ResizeHandle col={nameCol} />
              </th>
              <th class={`${TH} text-left relative border-b border-gray-200 dark:border-gray-700 ${RESIZE_EDGE}`} style={clientCol.style()}>
                <span class="inline-flex items-center gap-1.5">
                  <SortBtn col="client" label="Client" sort={sort()} onSort={toggleSort} />
                  <span class="text-gray-300 dark:text-gray-600">/</span>
                  <SortBtn col="project" label="Project" sort={sort()} onSort={toggleSort} />
                  <ExpandBtn col={clientCol} />
                </span>
                <ResizeHandle col={clientCol} />
              </th>
              <th class={`${TH} text-left border-b border-gray-200 dark:border-gray-700`}><SortBtn col="cm" label="CM" sort={sort()} onSort={toggleSort} /></th>
              <th class={`${TH} text-left min-w-[230px] border-b border-gray-200 dark:border-gray-700`}><SortBtn col="ad_account" label="Ad account" sort={sort()} onSort={toggleSort} /></th>
              <th class={`${TH} text-center border-b border-gray-200 dark:border-gray-700`}><SortBtn col="attention" label="Attention" sort={sort()} onSort={toggleSort} /></th>
              <th class={`${TH} text-right border-b border-gray-200 dark:border-gray-700`}><SortBtn col="spend" label="Spend" sort={sort()} onSort={toggleSort} /></th>
              <th class={`${TH} text-right z-20 border-b border-gray-200 dark:border-gray-700 ${stickyCls("leads")}`} style={stickyStyle("leads")}><SortBtn col="leads" label="Leads" sort={sort()} onSort={toggleSort} /></th>
              <th class={`${TH} text-right z-20 border-b border-gray-200 dark:border-gray-700 ${stickyCls("actual_cpl")}`} style={stickyStyle("actual_cpl")}><SortBtn col="actual_cpl" label="Actual CPL" sort={sort()} onSort={toggleSort} /></th>
              <th class={`${TH} text-right z-20 border-b border-gray-200 dark:border-gray-700 ${stickyCls("target_cpl")}`} style={stickyStyle("target_cpl")}><SortBtn col="target_cpl" label="Target CPL" sort={sort()} onSort={toggleSort} /></th>
              <th class={`${TH} text-center z-20 border-b border-gray-200 dark:border-gray-700 ${stickyCls("over_target")}`} style={stickyStyle("over_target")}><SortBtn col="over_target" label="Over target" sort={sort()} onSort={toggleSort} /></th>
              <Show when={canSetTarget()}>
                <th class={`${TH} text-right z-20 border-b border-gray-200 dark:border-gray-700 ${stickyCls("action")}`} style={stickyStyle("action")}>Target</th>
              </Show>
            </tr>
          </thead>
          <Show when={!data.loading} fallback={
            <tbody>
              <For each={Array(8).fill(0)}>{() => <tr class="animate-pulse"><For each={Array(colCount()).fill(0)}>{(_, idx) => <td class={TD}><div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${idx() === 0 ? "w-48" : "w-16 ml-auto"}`} /></td>}</For></tr>}</For>
            </tbody>
          }>
            <tbody>
              <For each={rows()}>
                {(c, i) => {
                  const hasTarget = c.target_cpl != null;
                  // Opaque per-cell background so the pinned columns cover
                  // what scrolls underneath them.
                  const bg = () =>
                    `${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800"}`;
                  const td = (extra = "") => `${TD} ${bg()} ${extra}`;
                  const pinned = (key, extra = "") => `${td(extra)} z-10 ${stickyCls(key)}`;
                  const cmsList = c.campaign_managers || [];
                  return (
                    <tr class="group">
                      <td class={td()} style={nameCol.style()}>
                        <span class="font-medium text-gray-800 dark:text-gray-100 line-clamp-2 break-words" title={c.name}>{c.name}</span>
                      </td>
                      <td class={td()} style={clientCol.style()}>
                        <div class="flex items-center gap-2.5 min-w-0">
                          <Avatar name={c.client} />
                          <div class="min-w-0">
                            <span class="block text-[13px] font-medium text-gray-800 dark:text-gray-200 truncate" title={c.client}>{c.client || "—"}</span>
                            <span class="block text-[11px] text-gray-500 dark:text-gray-400 truncate" title={c.project}>{c.project}</span>
                          </div>
                        </div>
                      </td>
                      <td class={td("text-[13px] text-gray-700 dark:text-gray-200")}>
                        <Show when={cmsList.length} fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}>
                          <div class="flex flex-col gap-1">
                            <For each={cmsList}>
                              {(n) => (
                                <span class="inline-flex items-center gap-1.5 whitespace-nowrap capitalize">
                                  <Avatar name={n} size="w-6 h-6" textSize="text-[9px]" />
                                  {n}
                                </span>
                              )}
                            </For>
                          </div>
                        </Show>
                      </td>
                      <td class={td("max-w-[280px]")}>
                        <Show when={c.ad_account || c.ad_account_name} fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}>
                          <div class="flex items-start gap-2">
                            <div class="min-w-0">
                              <span class="block text-[13px] font-medium text-gray-800 dark:text-gray-200 truncate" title={c.ad_account_name}>{c.ad_account_name || c.ad_account}</span>
                              <Show when={c.ad_account}>
                                <span class="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                                  {c.ad_account}
                                  <button type="button" title="Copy account id" onClick={() => copyText(c.ad_account)} class="p-0.5 rounded hover:text-[#AC2334]">
                                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                                  </button>
                                </span>
                              </Show>
                              <Show when={c.portfolio}>
                                <span class="inline-block mt-1 px-1.5 py-px rounded text-[10px] font-semibold bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">{c.portfolio}</span>
                              </Show>
                            </div>
                            <Show when={c.ads_manager_url}>
                              <a href={c.ads_manager_url} target="_blank" rel="noopener noreferrer" title="Open in Ads Manager"
                                class="shrink-0 mt-0.5 p-1 rounded text-gray-400 hover:text-[#AC2334] hover:bg-gray-100 dark:hover:bg-gray-800">
                                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                              </a>
                            </Show>
                          </div>
                        </Show>
                      </td>
                      <td class={td("text-center whitespace-nowrap")}>
                        <Show when={c.needs_attention} fallback={
                          <Show when={hasTarget} fallback={<span class="text-gray-400 dark:text-gray-500 text-xs">—</span>}>
                            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300">On target</span>
                          </Show>
                        }>
                          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300">
                            <span class="w-1.5 h-1.5 rounded-full bg-[#AC2334]" /> Needs attention
                          </span>
                        </Show>
                      </td>
                      <td class={td("text-right whitespace-nowrap tabular-nums text-gray-800 dark:text-gray-200")}>{money2(c.spend) ?? "—"}</td>
                      <td class={pinned("leads", "text-right whitespace-nowrap tabular-nums text-gray-800 dark:text-gray-200")} style={stickyStyle("leads")}>{c.leads == null ? "—" : num(c.leads)}</td>
                      <td class={pinned("actual_cpl", "text-right whitespace-nowrap tabular-nums font-semibold text-gray-800 dark:text-gray-100")} style={stickyStyle("actual_cpl")}>
                        <Show when={c.no_leads} fallback={money2(c.actual_cpl) ?? "—"}>
                          <span class="text-[#AC2334] dark:text-red-400">No leads</span>
                        </Show>
                      </td>
                      <td class={pinned("target_cpl", "text-right whitespace-nowrap tabular-nums")} style={stickyStyle("target_cpl")}>
                        <Show when={hasTarget} fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}>
                          <Show when={c.target_is_default} fallback={<span class="font-semibold text-gray-800 dark:text-gray-100">{money2(c.target_cpl)}</span>}>
                            <span class="text-gray-500 dark:text-gray-400">{money2(c.target_cpl)}</span>
                            <span class="block text-[10px] uppercase tracking-wide text-gray-400">default</span>
                          </Show>
                        </Show>
                      </td>
                      <td class={pinned("over_target", "text-center whitespace-nowrap")} style={stickyStyle("over_target")}>
                        <Show when={hasTarget} fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}>
                          <div class="inline-flex items-center gap-2">
                            <span class={`text-xs font-bold tabular-nums ${c.needs_attention ? "text-[#AC2334] dark:text-red-400" : "text-[#15966A] dark:text-green-400"}`}>{overPctFmt(c.over_target_pct) ?? (c.no_leads && c.needs_attention ? "0 leads" : "—")}</span>
                            <RatioBadge campaign={c} />
                          </div>
                        </Show>
                      </td>
                      <Show when={canSetTarget()}>
                        <td class={pinned("action", "text-right whitespace-nowrap")} style={stickyStyle("action")}>
                          <button onClick={() => setTargetCampaign(c)} class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-[#AC2334]/40 hover:text-[#AC2334]">
                            {c.has_target ? "Edit" : "Set target"}
                          </button>
                        </td>
                      </Show>
                    </tr>
                  );
                }}
              </For>
              <Show when={rows().length === 0}>
                <tr><td colspan={colCount()} class="py-16 text-center text-gray-400 dark:text-gray-500">{search().trim() || attentionOnly() ? "No campaigns match the current filters." : "No campaigns to show."}</td></tr>
              </Show>
            </tbody>
          </Show>
        </table>
      </div>
      </Show>

      <Show when={targetCampaign()}>
        <TargetModal campaign={targetCampaign()} onClose={() => setTargetCampaign(null)} onSaved={refetch} />
      </Show>
    </div>
  );
}
