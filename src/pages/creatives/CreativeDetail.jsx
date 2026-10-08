import {
  createSignal,
  createResource,
  createEffect,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { useParams, A } from "@solidjs/router";
import ApexCharts from "apexcharts";
import {
  fetchCreative,
  fetchCreativePerformance,
  canWriteCreatives,
  kindLabel,
  fmtMoney,
  fmtCpl,
  fmtInt,
  fmtDate,
} from "../../services/creatives";
import { errorMessage } from "../../utils/apiErrors";
import CreativeModal from "../../components/creatives/CreativeModal";
import {
  PageShell,
  ErrorBox,
  GHOST_BTN,
  DatePresets,
  defaultRange,
  DataTable,
  CopyButton,
  StatusPill,
  OneDriveLink,
  StatCard,
  SectionTitle,
  ROW,
  NUM,
} from "../../components/creatives/CreativeUI";

// ─── Creative detail (/creatives/:id) ─────────────────────────────────────────
// One creative: what it is (header), and how it has done over a date range —
// totals, a daily chart, and the breakdowns by client, campaign and ad.
// Raw Meta spend; a null CPL (0 leads) prints "n/a".

export default function CreativeDetail() {
  const params = useParams();
  const [range, setRange] = createSignal(defaultRange());
  const [editOpen, setEditOpen] = createSignal(false);

  const [creative, { mutate }] = createResource(() => params.id, fetchCreative);
  const [perf] = createResource(
    () => ({ id: params.id, start: range().start, end: range().end }),
    ({ id, start, end }) => fetchCreativePerformance(id, { start, end }),
  );

  // Prefer the dedicated detail call; fall back to the creative block the
  // performance payload carries, so the header still renders if one fails.
  const c = () => (creative.error ? null : creative()) ?? (perf.error ? null : perf()?.creative) ?? null;
  const p = () => (perf.error ? null : perf());
  const totals = () => p()?.totals ?? {};

  return (
    <PageShell
      eyebrow={<A href="/creatives" class="hover:underline">← Creative Library</A>}
      title={
        <span class="inline-flex flex-wrap items-center gap-3">
          <span class="font-mono">{c()?.code ?? "…"}</span>
          <Show when={c()?.code}>
            <CopyButton text={c().code} />
          </Show>
        </span>
      }
      subtitle={c()?.title}
      actions={
        <Show when={canWriteCreatives() && c()}>
          <button type="button" class={GHOST_BTN} onClick={() => setEditOpen(true)}>
            Edit
          </button>
        </Show>
      }
    >
      <ErrorBox
        message={
          creative.error && !c() ? errorMessage(creative.error, "Could not load this creative.") : ""
        }
      />

      <Show when={c()}>
        <div class="mb-6 grid grid-cols-2 md:grid-cols-5 gap-4 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-sm">
          <Meta label="Type">{kindLabel(c().kind)}</Meta>
          <Meta label="Client">{c().client_nomen ?? "—"}</Meta>
          <Meta label="Project">{c().project ?? "—"}</Meta>
          <Meta label="OneDrive">
            <OneDriveLink url={c().onedrive_url} />
          </Meta>
          <Meta label="Status">
            <StatusPill active={c().is_active !== false} />
          </Meta>
          <Show when={c().notes}>
            <div class="col-span-2 md:col-span-5">
              <Meta label="Notes">
                <span class="whitespace-pre-line">{c().notes}</span>
              </Meta>
            </div>
          </Show>
        </div>
      </Show>

      <div class="mb-5">
        <DatePresets value={range()} onChange={setRange} />
      </div>

      <ErrorBox message={perf.error ? errorMessage(perf.error, "Could not load performance.") : ""} />

      <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Leads" value={perf.loading ? "…" : fmtInt(totals().leads)} />
        <StatCard label="Spend" value={perf.loading ? "…" : fmtMoney(totals().spend)} />
        <StatCard label="CPL" value={perf.loading ? "…" : fmtCpl(totals().cpl)} />
        <StatCard label="Ads" value={perf.loading ? "…" : fmtInt(totals().ads)} />
        <StatCard label="Clients" value={perf.loading ? "…" : fmtInt(totals().clients)} />
      </div>

      <SectionTitle>Daily</SectionTitle>
      <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <Show
          when={(p()?.daily ?? []).length}
          fallback={
            <p class="py-10 text-center text-sm text-[#8593A8]">
              {perf.loading ? "Loading…" : "No activity in this range."}
            </p>
          }
        >
          <DailyChart daily={p().daily} />
        </Show>
      </div>

      <SectionTitle>By client</SectionTitle>
      <DataTable
        loading={perf.loading}
        empty={!(p()?.by_client ?? []).length}
        emptyText="No activity in this range."
        cols={[
          { label: "Client" },
          { label: "Leads", align: "right" },
          { label: "Spend", align: "right" },
          { label: "CPL", align: "right" },
          { label: "Ads", align: "right" },
        ]}
      >
        <For each={p()?.by_client ?? []}>
          {(r) => (
            <tr class={ROW}>
              <td class="font-medium">{r.client_nomen ?? "—"}</td>
              <td class={NUM}>{fmtInt(r.leads)}</td>
              <td class={NUM}>{fmtMoney(r.spend)}</td>
              <td class={NUM}>{fmtCpl(r.cpl)}</td>
              <td class={NUM}>{fmtInt(r.ads)}</td>
            </tr>
          )}
        </For>
      </DataTable>

      <SectionTitle>By campaign</SectionTitle>
      <DataTable
        loading={perf.loading}
        empty={!(p()?.by_campaign ?? []).length}
        emptyText="No activity in this range."
        cols={[
          { label: "Campaign" },
          { label: "Client" },
          { label: "Leads", align: "right" },
          { label: "Spend", align: "right" },
          { label: "CPL", align: "right" },
          { label: "Ads", align: "right" },
        ]}
      >
        <For each={p()?.by_campaign ?? []}>
          {(r) => (
            <tr class={ROW}>
              <td class="font-medium max-w-[22rem]">{r.campaign ?? "—"}</td>
              <td class="whitespace-nowrap">{r.client_nomen ?? "—"}</td>
              <td class={NUM}>{fmtInt(r.leads)}</td>
              <td class={NUM}>{fmtMoney(r.spend)}</td>
              <td class={NUM}>{fmtCpl(r.cpl)}</td>
              <td class={NUM}>{fmtInt(r.ads)}</td>
            </tr>
          )}
        </For>
      </DataTable>

      <SectionTitle>By ad</SectionTitle>
      <DataTable
        loading={perf.loading}
        empty={!(p()?.by_ad ?? []).length}
        emptyText="No activity in this range."
        cols={[
          { label: "Ad name" },
          { label: "Ad account" },
          { label: "Campaign" },
          { label: "Leads", align: "right" },
          { label: "Spend", align: "right" },
          { label: "CPL", align: "right" },
          { label: "First date" },
          { label: "Last date" },
        ]}
      >
        <For each={p()?.by_ad ?? []}>
          {(r) => (
            <tr class={ROW}>
              <td class="font-medium max-w-[22rem]">{r.ad_name ?? "—"}</td>
              <td class="whitespace-nowrap">{r.ad_account ?? "—"}</td>
              <td class="max-w-[18rem]">{r.campaign ?? "—"}</td>
              <td class={NUM}>{fmtInt(r.leads)}</td>
              <td class={NUM}>{fmtMoney(r.spend)}</td>
              <td class={NUM}>{fmtCpl(r.cpl)}</td>
              <td class="whitespace-nowrap">{fmtDate(r.first_date)}</td>
              <td class="whitespace-nowrap">{fmtDate(r.last_date)}</td>
            </tr>
          )}
        </For>
      </DataTable>

      <CreativeModal
        open={editOpen()}
        creative={c()}
        onClose={() => setEditOpen(false)}
        onSaved={(row) => row && mutate({ ...c(), ...row })}
      />
    </PageShell>
  );
}

function Meta(props) {
  return (
    <div>
      <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1">
        {props.label}
      </p>
      <div class="font-medium text-[#14233A] dark:text-gray-100">{props.children}</div>
    </div>
  );
}

// Leads as bars on the left axis, CPL as a line on the right. A day with no
// leads has a null CPL and the line gaps there rather than dropping to zero.
function DailyChart(props) {
  let el;
  let chart;

  const isDark = () => document.documentElement.classList.contains("dark");

  createEffect(() => {
    const rows = props.daily ?? [];
    const cats = rows.map((r) => r.date ?? "");
    const leads = rows.map((r) => Number(r.leads) || 0);
    const cpl = rows.map((r) => (r.cpl == null || r.cpl === "" ? null : Number(r.cpl)));
    const label = isDark() ? "#9CA3AF" : "#54657E";

    const options = {
      chart: {
        height: 300,
        type: "line",
        toolbar: { show: false },
        fontFamily: "inherit",
        background: "transparent",
      },
      series: [
        { name: "Leads", type: "column", data: leads },
        { name: "CPL", type: "line", data: cpl },
      ],
      colors: ["#AC2334", "#D89A2B"],
      stroke: { width: [0, 3], curve: "smooth" },
      plotOptions: { bar: { columnWidth: "55%", borderRadius: 3 } },
      dataLabels: { enabled: false },
      markers: { size: [0, 3] },
      xaxis: {
        categories: cats,
        labels: {
          style: { colors: label },
          formatter: (v) => {
            const d = new Date(v);
            return Number.isNaN(d.getTime())
              ? v
              : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
          },
        },
      },
      yaxis: [
        {
          title: { text: "Leads", style: { color: label } },
          labels: { style: { colors: label }, formatter: (v) => Math.round(v) },
          min: 0,
        },
        {
          opposite: true,
          title: { text: "CPL (₹)", style: { color: label } },
          labels: { style: { colors: label }, formatter: (v) => (v == null ? "" : `₹${Math.round(v)}`) },
          min: 0,
        },
      ],
      tooltip: {
        theme: isDark() ? "dark" : "light",
        shared: true,
        intersect: false,
        y: [{ formatter: (v) => fmtInt(v) }, { formatter: (v) => fmtCpl(v) }],
      },
      legend: { labels: { colors: label } },
      grid: { borderColor: isDark() ? "#374151" : "#E2E8F1" },
    };

    if (chart) chart.destroy();
    chart = new ApexCharts(el, options);
    chart.render();
  });

  onCleanup(() => chart?.destroy());

  return <div ref={el} />;
}
