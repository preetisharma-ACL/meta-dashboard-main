import { createSignal, createEffect, createMemo, onMount, onCleanup } from "solid-js";
import ApexCharts from "apexcharts";

/**
 * LeadsChart — driven by real date-wise insights from the API.
 *
 * Props:
 *   campaign  — campaign object (aggregate KPIs + start_date)
 *   insights  — array of { date, leads, spend, clicks, impressions }
 */
export default function LeadsChart(props) {
  let chartRef;
  let chartInstance = null;

  const [tab, setTab] = createSignal("leads");
  const [range, setRange] = createSignal("day");

  // ── KPI cards (aggregate) ────────────────────────────────────────────────
  const totalLeads    = () => props.campaign?.leads_count || 0;
  const totalSpend    = () => props.campaign?.spend       || 0;
  const costPerResult = () => props.campaign?.cpl         || 0;

  // ── Date helpers (pure, no signals) ─────────────────────────────────────
  const toDate = (str) =>
    new Date(str.includes("T") ? str : str + "T00:00:00");

  const fmtDay = (str) =>
    toDate(str).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  const fmtWeekKey = (str) => {
    const d    = toDate(str);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - jan1) / 86_400_000 + jan1.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${week}`;
  };

  // ── Sorted insights ───────────────────────────────────────────────────────
  const sortedInsights = createMemo(() =>
    [...(props.insights ?? [])].sort(
      (a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()
    )
  );

  // ── 30-day window for "month" range ──────────────────────────────────────
  const monthWindow = createMemo(() => {
    const ins = sortedInsights();
    if (!ins.length) return { from: null, to: null };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rawStart      = props.campaign?.start_date ?? ins[0].date;
    const campaignStart = toDate(rawStart);
    campaignStart.setHours(0, 0, 0, 0);

    const daysSinceStart = Math.floor((today - campaignStart) / 86_400_000);

    const windowStart = daysSinceStart >= 30
      ? (() => { const d = new Date(today); d.setDate(d.getDate() - 29); return d; })()
      : campaignStart;

    return { from: windowStart, to: today };
  });

  // ── Core data memo ────────────────────────────────────────────────────────
  const chartData = createMemo(() => {
    const ins = sortedInsights();
    if (!ins.length) return { labels: [], leads: [], spend: [], cpl: [] };

    const makeCPL = (spend, leads) =>
      spend > 0 && leads > 0 ? parseFloat((spend / leads).toFixed(2)) : 0;

    // DAY
    if (range() === "day") {
      return {
        labels: ins.map((d) => fmtDay(d.date)),
        leads : ins.map((d) => d.leads || 0),
        spend : ins.map((d) => parseFloat(d.spend || 0)),
        cpl   : ins.map((d) => makeCPL(parseFloat(d.spend || 0), d.leads || 0)),
      };
    }

    // WEEK
    if (range() === "week") {
      const buckets = new Map();
      ins.forEach((d) => {
        const key = fmtWeekKey(d.date);
        if (!buckets.has(key))
          buckets.set(key, { label: `Wk ${key.split("-W")[1]}`, leads: 0, spend: 0 });
        const b = buckets.get(key);
        b.leads += d.leads || 0;
        b.spend += parseFloat(d.spend || 0);
      });
      const arr = Array.from(buckets.values());
      return {
        labels: arr.map((b) => b.label),
        leads : arr.map((b) => b.leads),
        spend : arr.map((b) => parseFloat(b.spend.toFixed(2))),
        cpl   : arr.map((b) => makeCPL(b.spend, b.leads)),
      };
    }

    // MONTH — 30-day window, day-level granularity
    const { from, to } = monthWindow();
    const windowed = from && to
      ? ins.filter((d) => {
          const dt = toDate(d.date);
          dt.setHours(0, 0, 0, 0);
          return dt >= from && dt <= to;
        })
      : ins;

    return {
      labels: windowed.map((d) => fmtDay(d.date)),
      leads : windowed.map((d) => d.leads || 0),
      spend : windowed.map((d) => parseFloat(d.spend || 0)),
      cpl   : windowed.map((d) => makeCPL(parseFloat(d.spend || 0), d.leads || 0)),
    };
  });

  // ── Derive active series for the selected tab ─────────────────────────────
  const activeValues = () => {
    const d = chartData();
    if (tab() === "leads")   return d.leads;
    if (tab() === "perLead") return d.cpl;
    return d.spend;
  };

  // ── Y-axis label formatter per tab ───────────────────────────────────────
  const yFormatter = (currentTab) => (val) => {
    if (currentTab === "leads")   return `${val} Leads`;
    if (currentTab === "perLead") return `₹${val}`;
    return `₹${val}`;
  };

  // ── Tooltip label per tab ─────────────────────────────────────────────────
  const tooltipLabel = (currentTab) => {
    if (currentTab === "leads")   return "Leads";
    if (currentTab === "perLead") return "Cost Per Result";
    return "Spend";
  };

  // ── Build complete ApexCharts options object ──────────────────────────────
  // Called fresh every time — no shared state, no stale closures.
  const buildOptions = (currentTab) => {
    const data     = chartData();
    const values   = currentTab === "leads"
      ? data.leads
      : currentTab === "perLead"
        ? data.cpl
        : data.spend;
    const labels   = data.labels;
    const isRupee  = currentTab !== "leads";
    const tipLabel = tooltipLabel(currentTab);

    return {
      chart: {
        type      : "line",
        height    : 350,
        toolbar   : { show: false },
        background: "transparent",
        animations: { enabled: true, easing: "easeinout", speed: 350 },
      },
      series: [{ name: tipLabel, data: values }],
      colors: ["#7BC5C1"],
      stroke: { curve: "smooth", width: 3 },
      markers: { size: 4 },
      dataLabels: { enabled: false },
      xaxis: {
        categories: labels,
        labels: {
          style : { colors: "#6B7280", fontSize: "11px" },
          rotate: -30,
        },
      },
      yaxis: {
        labels: {
          style    : { colors: "#6B7280" },
          formatter: yFormatter(currentTab),
        },
      },
      grid  : { borderColor: "#E5E7EB", strokeDashArray: 3 },
      legend: { position: "bottom" },

      // ── Tooltip — always use the `y.formatter` path ──────────────────────
      // Never mix `custom` + `y` across updates; always build from scratch.
      tooltip: {
        shared: false,
        y: {
          formatter: (val, { dataPointIndex, w }) => {
            const dateLabel = w.globals.categoryLabels?.[dataPointIndex]
                           ?? w.globals.labels?.[dataPointIndex]
                           ?? "";
            // Build a multi-line tooltip via the title + value approach
            return isRupee ? `₹${val}` : `${val} Leads`;
          },
          title: {
            formatter: () => tipLabel,
          },
        },
      },
    };
  };

  // ── Destroy old chart + render new one ───────────────────────────────────
  const renderChart = () => {
    if (!chartRef) return;

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    const currentTab = tab(); // read signal once — passed as plain value
    const opts       = buildOptions(currentTab);
    chartInstance    = new ApexCharts(chartRef, opts);
    chartInstance.render();
  };

  // ── Mount: render once (insights may be empty initially — that's fine) ───
  onMount(() => {
    renderChart();
  });

  // ── Re-render whenever tab, range, or insights change ────────────────────
  createEffect(() => {
    // Touch all reactive sources so SolidJS tracks them
    tab();
    range();
    sortedInsights(); // depends on props.insights

    // Don't run before the DOM ref is ready
    if (!chartRef) return;

    renderChart();
  });

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  onCleanup(() => {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  });

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div class="bg-white dark:bg-gray-900 p-2 rounded-lg shadow">

      {/* HEADER */}
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-semibold text-gray-800 dark:text-white">
          Performance overview
        </h2>
        <div class="flex gap-2">
          {["day", "week", "month"].map((r) => (
            <button
              onClick={() => setRange(r)}
              class={`px-3 py-1 rounded border text-sm ${
                range() === r
                  ? "bg-blue-500 text-white"
                  : "text-gray-600 dark:text-gray-300"
              }`}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* METRIC TABS */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">

        <div
          onClick={() => setTab("leads")}
          class={`cursor-pointer p-4 rounded-lg border transition ${
            tab() === "leads"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-200 dark:border-gray-700"
          }`}
        >
          <p class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
            Total Leads <span class="text-xs">ℹ️</span>
          </p>
          <h3 class="text-2xl font-semibold text-gray-800 dark:text-white mt-1">
            {totalLeads()}
          </h3>
        </div>

        <div
          onClick={() => setTab("perLead")}
          class={`cursor-pointer p-4 rounded-lg border transition ${
            tab() === "perLead"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-200 dark:border-gray-700"
          }`}
        >
          <p class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
            Cost Per Result <span class="text-xs">ℹ️</span>
          </p>
          <h3 class="text-2xl font-semibold text-gray-800 dark:text-white mt-1">
            ₹{costPerResult()}
          </h3>
        </div>

        <div
          onClick={() => setTab("spent")}
          class={`cursor-pointer p-4 rounded-lg border transition ${
            tab() === "spent"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-200 dark:border-gray-700"
          }`}
        >
          <p class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
            Spend <span class="text-xs">ℹ️</span>
          </p>
          <h3 class="text-2xl font-semibold text-gray-800 dark:text-white mt-1">
            ₹{totalSpend()}
          </h3>
        </div>

      </div>

      {/* CHART — div is kept stable; ApexCharts manages its own inner DOM */}
      <div ref={chartRef} />
    </div>
  );
}