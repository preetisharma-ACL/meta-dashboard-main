import { createSignal, createEffect, onMount } from "solid-js";
import ApexCharts from "apexcharts";

export default function PerformanceChart(props) {


  let chartRef;
  let chart;

  const [tab, setTab] = createSignal("leads");
  const [range, setRange] = createSignal("day");

  // ---------------- DATA ----------------
  const dataMap = {
    leads: [2, 2, 0, 2, 0, 2, 2, 5, 3, 0, 3, 6, 1, 0, 1, 2, 0, 4, 1, 2, 1],
    perLead: [280, 210, 250, 0, 190, 0, 260, 210, 110, 210, 0, 350, 60, 0, 260, 0, 210, 330, 150, 270, 320],
    spent: [560, 420, 510, 40, 390, 360, 510, 410, 550, 640, 430, 450, 370, 360, 100, 260, 420, 800, 340, 280, 320]
  };

  const categories = {
    day: ["13 Feb", "14 Feb", "15 Feb", "16 Feb", "17 Feb", "18 Feb", "19 Feb", "20 Feb", "21 Feb", "22 Feb", "23 Feb", "24 Feb", "25 Feb", "26 Feb", "27 Feb", "28 Feb", "1 Mar", "7 Mar", "10 Mar", "12 Mar", "14 Mar"],
    week: ["Week 1", "Week 2", "Week 3", "Week 4"],
    month: ["Jan", "Feb", "Mar"]
  };

  const totalLeads = () => props.campaign?.leads_count || 0;
  const totalSpend = () => props.campaign?.spend || 0;
  const costPerResult = () => props.campaign?.cpl || 0;

  // ---------------- DATA ----------------
  // const dataMap = {
  //   leads: props.campaign?.leads_chart || [],
  //   perLead: props.campaign?.cpl_chart || [],
  //   spent: props.campaign?.spend_chart || []
  // };

  const getFilteredData = () => {
    const baseData = dataMap[tab()];

    if (range() === "day") return baseData;

    if (range() === "week") {
      return [
        baseData.slice(0, 5).reduce((a, b) => a + b, 0),
        baseData.slice(5, 10).reduce((a, b) => a + b, 0),
        baseData.slice(10, 15).reduce((a, b) => a + b, 0),
        baseData.slice(15, 21).reduce((a, b) => a + b, 0),
      ];
    }

    if (range() === "month") {
      return [
        baseData.slice(0, 10).reduce((a, b) => a + b, 0),
        baseData.slice(10, 21).reduce((a, b) => a + b, 0),
        0 // or add real next month data
      ];
    }
  };

  // ---------------- TOOLTIP ----------------
  const getTooltip = () => {
    if (tab() === "leads") {
      return {
        custom: undefined, //  IMPORTANT FIX
        y: {
          formatter: (val) => `${val} Leads`
        }
      };
    }

    if (tab() === "perLead") {
      return {
        custom: function ({ series, seriesIndex, dataPointIndex, w }) {
          const value = series[seriesIndex][dataPointIndex];
          const date = w.globals.categoryLabels[dataPointIndex];

          return `
          <div class="p-2 text-sm">
            <div>${date}</div>
            <div>Cost Per Result</div>
            <div>₹ ${value}</div>
          </div>
        `;
        }
      };
    }

    if (tab() === "spent") {
      return {
        custom: function ({ series, seriesIndex, dataPointIndex, w }) {
          const value = series[seriesIndex][dataPointIndex];
          const date = w.globals.categoryLabels[dataPointIndex];

          return `
          <div class="p-2 text-sm">
            <div>${date}</div>
           <div>Spend</div>
            <div>₹ ${value}</div>
          </div>
        `;
        }
      };
    }
  };
  // ---------------- INIT CHART ----------------
  onMount(() => {
    chart = new ApexCharts(chartRef, {
      chart: {
        type: "line",
        height: 350,
        toolbar: { show: false },
        background: "transparent"
      },

      series: [{
        name: tab(),
        data: getFilteredData()
      }],

      colors: ["#7BC5C1"],

      stroke: {
        curve: "smooth",
        width: 3
      },

      markers: { size: 4 },

      dataLabels: { enabled: false },

      xaxis: {
        categories: categories[range()],
        labels: {
          style: { colors: "#6B7280" }
        }
      },

      yaxis: {
        labels: {
          style: { colors: "#6B7280" }
        }
      },

      grid: {
        borderColor: "#E5E7EB",
        strokeDashArray: 3
      },

      tooltip: getTooltip(),

      legend: { position: "bottom" }
    });

    chart.render();
  });

  // ---------------- UPDATE ----------------
  createEffect(() => {
    if (chart) {
      chart.updateOptions({
        chart: {
          animations: {
            enabled: true,
            easing: "easeinout",
            speed: 400
          }
        },
        series: [{
          name: tab(),
          data: getFilteredData()
        }],
        xaxis: {
          categories: categories[range()]
        },
        tooltip: getTooltip()
      });
    }
  });

  // ---------------- UI ----------------
  return (
    <div class="bg-white dark:bg-gray-900 p-2 rounded-lg shadow">

      {/* HEADER */}
      <div class="flex justify-between items-center mb-4">

        <h2 class="text-lg font-semibold text-gray-800 dark:text-white">
          Performance overview
        </h2>

        <div class="flex gap-2">

          {["day", "week", "month"].map(r => (
            <button
              onClick={() => setRange(r)}
              class={`px-3 py-1 rounded border text-sm
              ${range() === r
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

        {/* Leads */}
        <div
          onClick={() => setTab("leads")}
          class={`cursor-pointer p-4 rounded-lg border transition
    ${tab() === "leads"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-200 dark:border-gray-700"
            }`}
        >
          <p class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
            Total Leads
            <span class="text-xs">ℹ️</span>
          </p>

          <h3 class="text-2xl font-semibold text-gray-800 dark:text-white mt-1">
            {totalLeads()}
          </h3>
        </div>

        {/* Per Lead */}
        <div
          onClick={() => setTab("perLead")}
          class={`cursor-pointer p-4 rounded-lg border transition
    ${tab() === "perLead"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-200 dark:border-gray-700"
            }`}
        >
          <p class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
            Cost Per Result
            <span class="text-xs">ℹ️</span>
          </p>

          <h3 class="text-2xl font-semibold text-gray-800 dark:text-white mt-1">
            ₹{costPerResult()}
          </h3>
        </div>

        {/* Amount Spent */}
        <div
          onClick={() => setTab("spent")}
          class={`cursor-pointer p-4 rounded-lg border transition
    ${tab() === "spent"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-200 dark:border-gray-700"
            }`}
        >
          <p class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
            Spend
            <span class="text-xs">ℹ️</span>
          </p>

          <h3 class="text-2xl font-semibold text-gray-800 dark:text-white mt-1">
            ₹{totalSpend()}
          </h3>
        </div>

      </div>

      {/* CHART */}
      <div ref={chartRef}></div>
    </div>
  );
}