import { onMount, onCleanup, createEffect } from "solid-js";
import ApexCharts from "apexcharts";

// Donut splitting spend across the four buckets. Renders inside an ApexCharts
// instance (the established chart lib in this app). Clicking a segment calls
// props.onSelect(bucketKey). Series/colors/labels come in via props.
//
// Props:
//   buckets  — [{ key, label, value(number), color }]
//   total    — number (center label)
//   onSelect — (key) => void
export default function SpendDonut(props) {
  let ref;
  let chart = null;

  const money = (v) =>
    `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const build = () => {
    const buckets = props.buckets ?? [];
    return {
      chart: {
        type: "donut",
        height: 240,
        background: "transparent",
        animations: { enabled: true, speed: 300 },
        events: {
          dataPointSelection: (_e, _ctx, cfg) => {
            const b = (props.buckets ?? [])[cfg.dataPointIndex];
            if (b && props.onSelect) props.onSelect(b.key);
          },
        },
      },
      series: buckets.map((b) => Number(b.value) || 0),
      labels: buckets.map((b) => b.label),
      colors: buckets.map((b) => b.color),
      stroke: { width: 2, colors: ["transparent"] },
      legend: { show: false },
      dataLabels: { enabled: false },
      plotOptions: {
        pie: {
          expandOnClick: true,
          donut: {
            size: "68%",
            labels: {
              show: true,
              total: {
                show: true,
                label: "Total",
                color: "#9CA3AF",
                fontSize: "12px",
                formatter: () => money(props.total),
              },
              value: {
                color: "#6B7280",
                fontSize: "16px",
                fontWeight: 600,
                formatter: (v) => money(v),
              },
            },
          },
        },
      },
      tooltip: {
        y: { formatter: (v) => money(v) },
      },
      states: { active: { filter: { type: "darken", value: 0.85 } } },
    };
  };

  const render = () => {
    if (!ref) return;
    if (chart) {
      chart.destroy();
      chart = null;
    }
    chart = new ApexCharts(ref, build());
    chart.render();
  };

  onMount(render);

  createEffect(() => {
    // Track props so the donut re-renders when data changes.
    void props.buckets;
    void props.total;
    if (ref) render();
  });

  onCleanup(() => {
    if (chart) {
      chart.destroy();
      chart = null;
    }
  });

  return <div ref={ref} class="flex justify-center" />;
}
