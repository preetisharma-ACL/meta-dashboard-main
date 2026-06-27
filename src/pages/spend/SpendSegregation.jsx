import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { fetchSpendSegregation, fetchSpendSegregationClients } from "../../services/spendSegregation";
import { fetchHierarchyClients, fetchHierarchyProjects, fetchHierarchyCampaigns } from "../../services/cm";
import SpendDonut from "../../components/SpendDonut";
import Avatar from "../../components/common/Avatar";

// ─────────────────────────────────────────────────────────────────────────────
// Themed to the project (ClientDashboard family): navy ink (#14233A), brand red
// (#AC2334), slate text (#54657E/#8593A8), light surfaces, font-sans. Logic,
// resources, drill-down and the yesterday derivation are UNCHANGED.
// ─────────────────────────────────────────────────────────────────────────────

const CARD_SHADOW = "shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]";

// ─── Formatters ───────────────────────────────────────────────────────────────
const moneyWhole = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const money2 = (v) => {
  if (v == null) return "—";
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const num = (v) => (Number(v) || 0).toLocaleString("en-IN");

// Business calls `cpl` "CP". CP + Hybrid = agency cost (own-pocket spend).
// Colours drawn from the project palette.
const BUCKETS = [
  { key: "cpl", label: "CP", color: "#15966A", agency: true },
  { key: "hybrid", label: "Hybrid", color: "#3E6FB0", agency: true },
  { key: "retainer", label: "Retainer", color: "#8593A8", agency: false },
  { key: "unclassified", label: "Unclassified", color: "#B07A14", agency: false },
];
const BUCKET_BY_KEY = Object.fromEntries(BUCKETS.map((b) => [b.key, b]));

// ─── Today-vs-yesterday delta (informational, not judgmental) ─────────────────
function Delta(props) {
  const t = () => parseFloat(props.today);
  const y = () => parseFloat(props.yesterday);
  const ok = () => isFinite(t()) && isFinite(y());
  const diff = () => t() - y();
  const pct = () => (y() > 0 ? (diff() / y()) * 100 : null);
  const up = () => diff() > 0;
  return (
    <Show when={ok() && Math.abs(diff()) > 0.005}>
      <span class={`inline-flex items-center gap-0.5 text-xs font-semibold mt-1 ${up() ? "text-[#B07A14] dark:text-amber-400" : "text-[#15966A] dark:text-green-400"}`}>
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d={up() ? "M12 19V5M5 12l7-7 7 7" : "M12 5v14M19 12l-7 7-7-7"} />
        </svg>
        <Show when={pct() != null} fallback={<span>vs yest.</span>}>
          {Math.abs(pct()).toFixed(1)}% vs yest.
        </Show>
      </span>
    </Show>
  );
}

// ─── A single period panel (Today / Yesterday) ────────────────────────────────
function PeriodPanel(props) {
  const period = () => props.data ?? {};
  const byType = () => period().by_type ?? {};
  const buckets = createMemo(() =>
    BUCKETS.map((b) => ({
      ...b,
      value: parseFloat(byType()[b.key]?.spend) || 0,
      clients: Number(byType()[b.key]?.clients) || 0,
    })),
  );

  return (
    <div class={`bg-gray-50 dark:bg-gray-800 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 ${CARD_SHADOW} p-5`}>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-bold text-[#14233A] dark:text-gray-100">{props.title}</h2>
        <Show when={props.live}>
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300">
            <span class="w-1.5 h-1.5 rounded-full bg-[#15966A] animate-pulse" /> Live
          </span>
        </Show>
      </div>

      {/* Headline metrics */}
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
          <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Total Spend</p>
          <p class="text-2xl font-extrabold text-[#14233A] dark:text-white mt-1 tabular-nums">{moneyWhole(period().total)}</p>
          <Show when={props.compare}><Delta today={period().total} yesterday={props.compare.total} /></Show>
        </div>
        <div class="rounded-xl border border-[#AC2334]/20 dark:border-red-900/50 bg-[#FBEEF0]/70 dark:bg-red-900/15 px-4 py-3">
          <p class="text-[11px] font-bold uppercase tracking-wider text-[#AC2334] dark:text-red-300">Agency Cost <span class="text-[#AC2334]/60">(CP + Hybrid)</span></p>
          <p class="text-2xl font-extrabold text-[#AC2334] dark:text-red-300 mt-1 tabular-nums">{moneyWhole(period().agency_cost)}</p>
          <Show when={props.compare}><Delta today={period().agency_cost} yesterday={props.compare.agency_cost} /></Show>
        </div>
      </div>

      {/* Donut + clickable legend */}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
        <SpendDonut buckets={buckets()} total={parseFloat(period().total) || 0} onSelect={props.onSelect} />
        <div class="space-y-1">
          <For each={buckets()}>
            {(b) => (
              <button
                onClick={() => props.onSelect?.(b.key)}
                class={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors border ${
                  props.selected === b.key
                    ? "bg-white dark:bg-gray-900 border-[#14233A]/30 dark:border-gray-600"
                    : "border-transparent hover:bg-white/60 dark:hover:bg-gray-800/50"
                }`}
              >
                <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ "background-color": b.color }} />
                <span class="flex-1 min-w-0">
                  <span class="text-sm font-semibold text-[#1A2B45] dark:text-gray-200">{b.label}</span>
                  <span class="text-[11px] text-[#8593A8] dark:text-gray-500 ml-1">· {num(b.clients)} clients</span>
                </span>
                <span class="text-sm font-bold text-[#14233A] dark:text-gray-100 whitespace-nowrap tabular-nums">{moneyWhole(b.value)}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// ─── Client drill-down row: expands to projects → campaigns (hierarchy reuse) ──
function ClientRow(props) {
  const c = () => props.client;
  const [open, setOpen] = createSignal(false);
  const [projects, setProjects] = createSignal(null); // null = not loaded
  const [campaignsByProject, setCampaignsByProject] = createSignal({});
  const [openProjects, setOpenProjects] = createSignal({});

  const toggle = async () => {
    const next = !open();
    setOpen(next);
    if (next && projects() == null) {
      setProjects({ loading: true, error: false, data: [] });
      try {
        const res = await fetchHierarchyProjects(c().client_nomen_id);
        setProjects({ loading: false, error: false, data: Array.isArray(res?.data) ? res.data : [] });
      } catch {
        setProjects({ loading: false, error: true, data: [] });
      }
    }
  };

  const toggleProject = async (p) => {
    const pid = p.project_id;
    const isOpen = !!openProjects()[pid];
    setOpenProjects((o) => ({ ...o, [pid]: !isOpen }));
    if (!isOpen && !campaignsByProject()[pid]) {
      setCampaignsByProject((m) => ({ ...m, [pid]: { loading: true, error: false, data: [] } }));
      try {
        const res = await fetchHierarchyCampaigns(pid, c().client_nomen_id);
        setCampaignsByProject((m) => ({ ...m, [pid]: { loading: false, error: false, data: Array.isArray(res?.data) ? res.data : [] } }));
      } catch {
        setCampaignsByProject((m) => ({ ...m, [pid]: { loading: false, error: true, data: [] } }));
      }
    }
  };

  return (
    <div class="border-b border-[#E2E8F1] dark:border-gray-800 last:border-b-0">
      <button onClick={toggle} class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40 transition-colors">
        <svg class="w-4 h-4 flex-shrink-0 text-[#8593A8] transition-transform" style={{ transform: open() ? "rotate(90deg)" : "rotate(0deg)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <Avatar name={c().name} size="w-8 h-8" />
        <span class="flex-1 min-w-0 font-semibold text-blue-900 dark:text-gray-100 truncate" title={c().name}>{c().name}</span>
        <span class="hidden sm:block text-right text-[13px] font-semibold text-[#54657E] dark:text-gray-300 w-24 tabular-nums">{money2(c().spend_today)}</span>
        <span class="hidden md:block text-right text-[13px] font-semibold text-[#54657E] dark:text-gray-300 w-24 tabular-nums">{money2(props.yesterday) ?? "—"}</span>
        <span class="hidden md:block text-right text-[13px] font-semibold text-[#1A2B45] dark:text-gray-200 w-28 tabular-nums">{money2(c().spend_7d)}</span>
        <span class="text-right text-sm font-extrabold text-[#14233A] dark:text-gray-100 w-32 tabular-nums">{money2(c().spend_30d)}</span>
      </button>

      <Show when={open()}>
        <div class="pl-8 pr-3 pb-2 ml-3 border-l-2 border-[#E2E8F1] dark:border-gray-800">
          <Show when={projects()?.loading}>
            <div class="px-3 py-2 text-sm text-[#8593A8] dark:text-gray-500">Loading projects…</div>
          </Show>
          <Show when={projects()?.error}>
            <div class="px-3 py-2 text-sm text-[#AC2334]">Failed to load projects.</div>
          </Show>
          <Show when={projects() && !projects().loading && !projects().error && projects().data.length === 0}>
            <div class="px-3 py-2 text-sm text-[#8593A8] dark:text-gray-500">No projects.</div>
          </Show>
          <For each={projects()?.data ?? []}>
            {(p) => {
              const cs = () => campaignsByProject()[p.project_id];
              return (
                <div>
                  <button onClick={() => toggleProject(p)} class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40 transition-colors">
                    <svg class="w-3.5 h-3.5 flex-shrink-0 text-[#8593A8] transition-transform" style={{ transform: openProjects()[p.project_id] ? "rotate(90deg)" : "rotate(0deg)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span class="flex-1 min-w-0 text-sm font-medium text-[#1A2B45] dark:text-gray-200 truncate">{p.project_name}</span>
                    <span class="text-[11px] text-[#8593A8] dark:text-gray-500">{num(p.campaign_count)} campaigns</span>
                  </button>
                  <Show when={openProjects()[p.project_id]}>
                    <div class="pl-6 ml-3 border-l-2 border-[#E2E8F1] dark:border-gray-800">
                      <Show when={cs()?.loading}><div class="px-3 py-1.5 text-xs text-[#8593A8]">Loading campaigns…</div></Show>
                      <Show when={cs()?.error}><div class="px-3 py-1.5 text-xs text-[#AC2334]">Failed to load campaigns.</div></Show>
                      <Show when={cs() && !cs().loading && !cs().error && cs().data.length === 0}><div class="px-3 py-1.5 text-xs text-[#8593A8]">No campaigns.</div></Show>
                      <For each={cs()?.data ?? []}>
                        {(cmp) => (
                          <div class="flex items-center gap-2 px-3 py-1.5">
                            <span class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cmp.status === "active" ? "bg-[#15966A]" : "bg-[#B07A14]"}`} />
                            <A href={`/campaign/${cmp.campaign_id}`} class="text-xs font-medium text-[#3E6FB0] dark:text-blue-300 hover:underline truncate flex-1" title={cmp.campaign_name}>{cmp.campaign_name}</A>
                            <span class="text-[11px] text-[#54657E] dark:text-gray-400 tabular-nums">{moneyWhole(cmp.raw?.spend)}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function SpendSegregation() {
  const [selected, setSelected] = createSignal(null);

  const [summary] = createResource(async () => {
    try {
      const res = await fetchSpendSegregation();
      return { data: res?.data ?? null, forbidden: false };
    } catch (err) {
      if (err?.status === 403) return { data: null, forbidden: true };
      throw err;
    }
  });

  // Client list for the selected bucket; refetches when selection changes.
  const [clients] = createResource(selected, async (type) => {
    if (!type) return null;
    const res = await fetchSpendSegregationClients(type);
    return Array.isArray(res?.data) ? res.data : [];
  });

  // Per-client YESTERDAY spend — the bucket endpoint doesn't carry it, so we
  // derive it from the date-windowed hierarchy clients endpoint (yesterday →
  // yesterday) and key it by client_nomen_id. raw.spend = actual ad spend,
  // matching the segregation's spend semantics.
  const [yesterdayMap] = createResource(async () => {
    const d = new Date(Date.now() - 86400000);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      const res = await fetchHierarchyClients({ startDate: ymd, endDate: ymd });
      const map = {};
      for (const cl of Array.isArray(res?.data) ? res.data : []) {
        if (cl?.client_nomen_id != null) map[cl.client_nomen_id] = cl.raw?.spend ?? null;
      }
      return map;
    } catch {
      return {};
    }
  });

  // The server authoritatively returns 403 for non-admins; trust that rather
  // than a client-side role guess (which can race the currentUser load).
  const forbidden = () => summary()?.forbidden === true;
  const today = () => summary()?.data?.today ?? null;
  const yesterday = () => summary()?.data?.yesterday ?? null;

  return (
    <div class="font-sans min-h-screen bg-[#F4F6FA] dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      <div class="mb-5">
        <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">Leadership · Spend</p>
        <h1 class="text-2xl font-bold text-[#14233A] dark:text-white tracking-tight">Company Spend Segregation</h1>
        <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">
          Total ad spend split by client commercial type — CP + Hybrid is the agency's own cost.
        </p>
      </div>

      {/* 403 / role-gated state */}
      <Show when={forbidden()}>
        <div class={`bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 ${CARD_SHADOW} py-16 px-6 text-center`}>
          <div class="mx-auto w-12 h-12 rounded-full bg-[#F1F4F9] dark:bg-gray-800 flex items-center justify-center mb-3">
            <svg class="w-6 h-6 text-[#8593A8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 class="text-base font-bold text-[#14233A] dark:text-gray-100">Available to admins only</h3>
          <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">This view is restricted to admin and global-read roles.</p>
        </div>
      </Show>

      <Show when={!forbidden()}>
        {/* Loading */}
        <Show when={summary.loading}>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <For each={Array(2).fill(0)}>
              {() => <div class={`h-80 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 ${CARD_SHADOW} animate-pulse`} />}
            </For>
          </div>
        </Show>

        <Show when={summary.error}>
          <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
            Failed to load spend segregation. Please try again.
          </div>
        </Show>

        {/* Two period panels */}
        <Show when={!summary.loading && summary()?.data}>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <PeriodPanel title="Today" live data={today()} compare={yesterday()} selected={selected()} onSelect={setSelected} />
            <PeriodPanel title="Yesterday" data={yesterday()} selected={selected()} onSelect={setSelected} />
          </div>

          {/* Bucket client drill-down */}
          <Show
            when={selected()}
            fallback={
              <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-dashed border-[#D4DDE9] dark:border-gray-700 py-10 text-center text-sm text-[#8593A8] dark:text-gray-500">
                Click a bucket above to see its clients.
              </div>
            }
          >
            <div class={`bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 ${CARD_SHADOW} overflow-hidden`}>
              <div class="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#E2E8F1] dark:border-gray-800">
                <div class="flex items-center gap-2">
                  <span class="w-3 h-3 rounded-sm" style={{ "background-color": BUCKET_BY_KEY[selected()]?.color }} />
                  <h3 class="text-sm font-bold text-[#14233A] dark:text-gray-100">
                    {BUCKET_BY_KEY[selected()]?.label} clients
                  </h3>
                  <Show when={clients() && !clients.loading}>
                    <span class="text-xs text-[#8593A8] dark:text-gray-500">· {clients().length}</span>
                  </Show>
                </div>
                <button onClick={() => setSelected(null)} class="text-xs font-semibold text-[#AC2334] hover:underline">Clear</button>
              </div>

              {/* Column header */}
              <div class="hidden sm:flex items-center gap-3 px-3 py-2 bg-[#F8FAFC] dark:bg-gray-800/60 text-[11px] font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-400">
                <span class="w-4" />
                <span class="w-8" />
                <span class="flex-1">Client</span>
                <span class="text-right w-24">Today</span>
                <span class="hidden md:block text-right w-24">Yesterday</span>
                <span class="hidden md:block text-right w-28">7-day</span>
                <span class="text-right w-32">30-day</span>
              </div>

              <Show when={clients.loading}>
                <div class="px-4 py-8 text-center text-sm text-[#8593A8] dark:text-gray-500">Loading clients…</div>
              </Show>
              <Show when={clients.error}>
                <div class="px-4 py-6 text-center text-sm text-[#AC2334]">Failed to load clients.</div>
              </Show>
              <Show when={clients() && !clients.loading && clients().length === 0}>
                <div class="px-4 py-10 text-center text-sm text-[#8593A8] dark:text-gray-500">No clients in this bucket.</div>
              </Show>

              <For each={clients() ?? []}>
                {(client) => <ClientRow client={client} yesterday={yesterdayMap()?.[client.client_nomen_id]} />}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
