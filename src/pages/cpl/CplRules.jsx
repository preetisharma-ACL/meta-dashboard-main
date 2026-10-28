import { createSignal, createResource, createMemo, createEffect, on, For, Show } from "solid-js";
import Swal from "sweetalert2";
import { fetchCplCampaigns, setCplTarget, fetchHighVolumeClients } from "../../services/cplRules";
import { scopeKey } from "../../stores/cmScope";
import { isAdmin, isCoordination } from "../../stores/currentUser";

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
  cm: { get: (c) => strOrNull((c.campaign_managers || []).join(", ")), first: "asc" },
  ad_account: { get: (c) => strOrNull(c.ad_account_name || c.ad_account), first: "asc" },
  actual_cpl: { get: (c) => numOrNull(c.actual_cpl), first: "desc" },
  target_cpl: { get: (c) => numOrNull(c.target_cpl), first: "desc" },
  over_target: { get: (c) => numOrNull(c.over_target_pct), first: "desc" },
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
    if (typeof x === "string") return x.localeCompare(y) * mul;
    return (x - y) * mul;
  });
};

// "sonu · Tier 2 · 106 campaigns · 3 expensive"
const cmLabel = (m) => {
  const tierN = m.tier == null ? "" : String(m.tier).replace(/\D/g, "");
  return [
    m.name || m.email || `#${m.id}`,
    tierN ? `Tier ${tierN}` : null,
    `${num(m.campaigns)} campaigns`,
    `${num(m.expensive)} expensive`,
  ].filter(Boolean).join(" · ");
};

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
    <Show when={ratioFmt(a().expensiveness_ratio) != null} fallback={<span class="text-[#8593A8] dark:text-gray-500 text-xs">—</span>}>
      <span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold tabular-nums ${tone()}`}>{ratioFmt(a().expensiveness_ratio)}</span>
    </Show>
  );
}

// ─── Sortable column header ───────────────────────────────────────────────────
function SortTh(props) {
  const active = () => props.sort?.key === props.col;
  const justify = { left: "justify-start", right: "justify-end", center: "justify-center" }[props.align];
  return (
    <th class={`p-0 text-${props.align} whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 ${props.extra || ""}`}>
      <button type="button" onClick={() => props.onSort(props.col)}
        class={`w-full p-4 inline-flex items-center gap-1 ${justify} uppercase font-bold tracking-wider hover:text-[#AC2334] ${active() ? "text-[#AC2334] dark:text-red-400" : ""}`}>
        {props.label}
        <span class={`text-[10px] ${active() ? "" : "opacity-30"}`}>{active() ? (props.sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
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
      <div class="relative z-10 w-full max-w-md bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-2xl">
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
  const [tab, setTab] = createSignal("all");
  const [cmId, setCmId] = createSignal("");
  const [sort, setSort] = createSignal(null);
  const [search, setSearch] = createSignal("");
  const [attentionOnly, setAttentionOnly] = createSignal(false);
  const [targetCampaign, setTargetCampaign] = createSignal(null);
  const [cms, setCms] = createSignal([]);

  // High CPL by CM needs a CM before it shows anything.
  const needsCm = () => tab() === "cm" && !cmId();

  // A different Viewing scope has a different CM list — drop the pick.
  createEffect(on(scopeKey, () => setCmId(""), { defer: true }));

  const [data, { refetch }] = createResource(
    () => ({ scope: scopeKey(), tab: tab(), cmId: cmId() }),
    async ({ tab: t, cmId: id }) => {
      // With no CM picked on the CM tab we still fetch unfiltered — that's
      // where the dropdown options (meta.cms) come from.
      const res = await fetchCplCampaigns({ cmId: id || undefined, only: t === "expensive" ? "expensive" : undefined });
      if (Array.isArray(res?.meta?.cms)) setCms(res.meta.cms);
      return { rows: Array.isArray(res?.data) ? res.data : [], summary: res?.meta?.summary ?? null };
    },
  );

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
  const colCount = () => (canSetTarget() ? 9 : 8);

  const attnThreshold = () => {
    const t = summary()?.attention_threshold_pct;
    return t == null ? null : `${Number(t)}%`;
  };

  return (
    <div class="font-sans min-h-screen bg-[#F4F6FA] dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div class="mb-5">
        <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">Performance · CPL Rules</p>
        <h1 class="text-2xl font-bold text-[#14233A] dark:text-white tracking-tight">CPL Rules &amp; Alerts</h1>
        <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">
          Campaigns ranked by how far over their target CPL they run. Most over-target first.
        </p>
      </div>

      {/* Tabs */}
      <div class="flex flex-wrap gap-1 mb-5 border-b border-[#E2E8F1] dark:border-gray-700">
        <For each={TABS}>
          {(t) => (
            <button onClick={() => pickTab(t.key)}
              class={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${tab() === t.key ? "border-[#AC2334] text-[#AC2334] dark:text-red-400" : "border-transparent text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-white"}`}>
              {t.label}
            </button>
          )}
        </For>
      </div>

      {/* High-volume clients */}
      <Show when={!highVol.loading && (highVol()?.rows?.length ?? 0) > 0}>
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 py-4 mb-5">
          <div class="flex items-center gap-2 mb-2.5">
            <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">High-volume clients</span>
            <Show when={highVol()?.meta?.threshold != null}>
              <span class="text-[11px] text-[#8593A8]">· &gt; {num(highVol().meta.threshold)} leads/day</span>
            </Show>
          </div>
          <div class="flex flex-wrap gap-2">
            <For each={highVol().rows}>
              {(hv) => (
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/40 dark:text-blue-300">
                  {hv.name}
                  <span class="text-[10px] font-extrabold bg-[#3E6FB0]/15 px-1.5 py-px rounded-full tabular-nums">{num(hv.leads_today)} leads</span>
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Summary band */}
      <Show when={!needsCm()}>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
        <Show when={!data.loading && summary()} fallback={
          <For each={Array(3).fill(0)}>{() => <div class="h-24 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 animate-pulse" />}</For>
        }>
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 py-5">
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Needs attention</p>
            <p class="text-3xl font-extrabold text-[#AC2334] dark:text-red-400 mt-2 tabular-nums">{num(summary().needs_attention)}</p>
            <Show when={attnThreshold()}><p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">≥ {attnThreshold()} over target</p></Show>
          </div>
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 py-5">
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">No explicit target</p>
            <p class="text-3xl font-extrabold text-[#14233A] dark:text-white mt-2 tabular-nums">{num(summary().no_target_set)}</p>
            <p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">rated against the {defaultTarget()} default</p>
          </div>
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 py-5">
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Campaigns</p>
            <p class="text-3xl font-extrabold text-[#14233A] dark:text-white mt-2 tabular-nums">{num(summary().campaigns)}</p>
            <p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">in scope</p>
          </div>
        </Show>
      </div>
      </Show>

      {/* Filter toolbar */}
      <div class="bg-gray-50 dark:bg-gray-900 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-3.5 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[220px]">
          <svg class="w-4 h-4 text-[#8593A8] absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input type="text" placeholder="Search campaign, client, project, CM or ad account…" value={search()} onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-white placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]" />
        </div>
        <select value={cmId()} onChange={(e) => setCmId(e.target.value)}
          class={`max-w-[320px] px-3 py-2.5 text-sm rounded-lg border bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] ${needsCm() ? "border-[#AC2334]" : "border-[#E2E8F1] dark:border-gray-700"}`}>
          <option value="">{tab() === "cm" ? "Select a campaign manager" : "All campaign managers"}</option>
          <For each={cmOptions()}>{(m) => <option value={String(m.id)}>{cmLabel(m)}</option>}</For>
        </select>
        <button onClick={() => setAttentionOnly((v) => !v)}
          class={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${attentionOnly() ? "bg-[#AC2334] text-white border-[#AC2334]" : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#AC2334]/40"}`}>
          Needs attention
          <span class={`text-[11px] font-extrabold px-1.5 py-px rounded-full ${attentionOnly() ? "bg-white/20 text-white" : "bg-[#F1F4F9] dark:bg-gray-700 text-[#8593A8]"}`}>{campaigns().filter((c) => c.needs_attention).length}</span>
        </button>
        <span class="ml-auto text-sm font-bold text-[#8593A8] dark:text-gray-500 whitespace-nowrap"><b class="text-[#14233A] dark:text-white">{rows().length}</b> shown</span>
      </div>

      <Show when={data.error}>
        <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
          {cmId() && /403|permission|not allowed/i.test(String(data.error?.message || data.error))
            ? "You don't have access to that campaign manager's campaigns."
            : "Failed to load CPL rules. Please try again."}
        </div>
      </Show>

      {/* Table */}
      <Show when={!needsCm()} fallback={
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 py-16 text-center text-sm font-medium text-[#8593A8] dark:text-gray-500">
          Select a campaign manager to see their campaigns, highest CPL first.
        </div>
      }>
      <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] overflow-x-auto">
        <table class="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr class="bg-[#F8FAFC] dark:bg-gray-800 text-[#54657E] dark:text-gray-400 uppercase text-xs font-bold tracking-wider">
              <SortTh col="name" label="Campaign" align="left" extra="min-w-[240px]" sort={sort()} onSort={toggleSort} />
              <SortTh col="client" label="Client / Project" align="left" sort={sort()} onSort={toggleSort} />
              <SortTh col="cm" label="CM" align="left" sort={sort()} onSort={toggleSort} />
              <SortTh col="ad_account" label="Ad account" align="left" extra="min-w-[220px]" sort={sort()} onSort={toggleSort} />
              <SortTh col="actual_cpl" label="Actual CPL" align="right" sort={sort()} onSort={toggleSort} />
              <SortTh col="target_cpl" label="Target CPL" align="right" sort={sort()} onSort={toggleSort} />
              <SortTh col="over_target" label="Over Target" align="center" sort={sort()} onSort={toggleSort} />
              <SortTh col="attention" label="Attention" align="center" sort={sort()} onSort={toggleSort} />
              <Show when={canSetTarget()}><th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">Target</th></Show>
            </tr>
          </thead>
          <Show when={!data.loading} fallback={
            <tbody>
              <For each={Array(8).fill(0)}>{() => <tr class="animate-pulse"><For each={Array(colCount()).fill(0)}>{(_, idx) => <td class="p-4 border-b border-[#E2E8F1] dark:border-gray-800"><div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${idx() === 0 ? "w-48" : "w-16 ml-auto"}`} /></td>}</For></tr>}</For>
            </tbody>
          }>
            <tbody>
              <For each={rows()}>
                {(c) => {
                  const hasTarget = c.target_cpl != null;
                  return (
                    <tr class={`group transition-colors ${c.needs_attention ? "bg-[#FFF8F9] dark:bg-red-900/5 hover:bg-[#FDEFF1] dark:hover:bg-red-900/10" : "hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40"}`}>
                      <td class="p-4 align-middle border-b border-[#E2E8F1] dark:border-gray-800 max-w-[320px]">
                        <span class="block font-semibold text-[#14233A] dark:text-gray-100 truncate" title={c.name}>{c.name}</span>
                      </td>
                      <td class="p-4 align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <span class="block text-[13px] font-medium text-[#1A2B45] dark:text-gray-200 truncate">{c.client}</span>
                        <span class="block text-[11px] text-[#8593A8] dark:text-gray-500 truncate">{c.project}</span>
                      </td>
                      <td class="p-4 align-middle border-b border-[#E2E8F1] dark:border-gray-800 text-[13px] text-[#1A2B45] dark:text-gray-200">
                        {(c.campaign_managers || []).length ? c.campaign_managers.join(", ") : <span class="text-[#8593A8] dark:text-gray-500">—</span>}
                      </td>
                      <td class="p-4 align-middle border-b border-[#E2E8F1] dark:border-gray-800 max-w-[280px]">
                        <Show when={c.ad_account || c.ad_account_name} fallback={<span class="text-[#8593A8] dark:text-gray-500">—</span>}>
                          <div class="flex items-start gap-2">
                            <div class="min-w-0">
                              <span class="block text-[13px] font-medium text-[#1A2B45] dark:text-gray-200 truncate" title={c.ad_account_name}>{c.ad_account_name || c.ad_account}</span>
                              <Show when={c.ad_account}>
                                <span class="flex items-center gap-1 text-[11px] text-[#8593A8] dark:text-gray-500 font-mono">
                                  {c.ad_account}
                                  <button type="button" title="Copy account id" onClick={() => copyText(c.ad_account)} class="p-0.5 rounded hover:text-[#AC2334]">
                                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                                  </button>
                                </span>
                              </Show>
                              <Show when={c.portfolio}>
                                <span class="inline-block mt-1 px-1.5 py-px rounded text-[10px] font-semibold bg-[#F1F4F9] text-[#8593A8] dark:bg-gray-800 dark:text-gray-400">{c.portfolio}</span>
                              </Show>
                            </div>
                            <Show when={c.ads_manager_url}>
                              <a href={c.ads_manager_url} target="_blank" rel="noopener noreferrer" title="Open in Ads Manager"
                                class="shrink-0 mt-0.5 p-1 rounded text-[#8593A8] hover:text-[#AC2334] hover:bg-[#F1F4F9] dark:hover:bg-gray-800">
                                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                              </a>
                            </Show>
                          </div>
                        </Show>
                      </td>
                      <td class="p-4 text-right align-middle whitespace-nowrap tabular-nums font-bold text-[#1A2B45] dark:text-gray-100 border-b border-[#E2E8F1] dark:border-gray-800">{money2(c.actual_cpl) ?? "—"}</td>
                      <td class="p-4 text-right align-middle whitespace-nowrap tabular-nums border-b border-[#E2E8F1] dark:border-gray-800">
                        <Show when={hasTarget} fallback={<span class="text-[#8593A8] dark:text-gray-500">—</span>}>
                          <Show when={c.target_is_default} fallback={<span class="font-bold text-[#1A2B45] dark:text-gray-100">{money2(c.target_cpl)}</span>}>
                            <span class="text-xs text-[#8593A8] dark:text-gray-500">{money2(c.target_cpl)} (default)</span>
                          </Show>
                        </Show>
                      </td>
                      <td class="p-4 text-center align-middle whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800">
                        <Show when={hasTarget} fallback={<span class="text-[#8593A8] dark:text-gray-500">—</span>}>
                          <div class="inline-flex items-center gap-2">
                            <span class={`text-xs font-bold tabular-nums ${c.needs_attention ? "text-[#AC2334] dark:text-red-400" : "text-[#15966A] dark:text-green-400"}`}>{overPctFmt(c.over_target_pct) ?? "—"}</span>
                            <RatioBadge campaign={c} />
                          </div>
                        </Show>
                      </td>
                      <td class="p-4 text-center align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <Show when={c.needs_attention} fallback={
                          <Show when={hasTarget} fallback={<span class="text-[#8593A8] dark:text-gray-500 text-xs">—</span>}>
                            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300">On target</span>
                          </Show>
                        }>
                          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300">
                            <span class="w-1.5 h-1.5 rounded-full bg-[#AC2334]" /> Needs attention
                          </span>
                        </Show>
                      </td>
                      <Show when={canSetTarget()}>
                        <td class="p-4 text-right align-middle whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800">
                          <button onClick={() => setTargetCampaign(c)} class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-[#54657E] dark:text-gray-300 hover:border-[#AC2334]/40 hover:text-[#AC2334]">
                            {c.has_target ? "Edit" : "Set target"}
                          </button>
                        </td>
                      </Show>
                    </tr>
                  );
                }}
              </For>
              <Show when={rows().length === 0}>
                <tr><td colspan={colCount()} class="py-16 text-center text-[#8593A8] dark:text-gray-500">{search().trim() || attentionOnly() ? "No campaigns match the current filters." : "No campaigns to show."}</td></tr>
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
