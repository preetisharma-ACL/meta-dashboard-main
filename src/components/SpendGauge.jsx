import { createSignal, createEffect, For, Show, onCleanup, untrack } from "solid-js";

// ─── Spend comparison gauge (dashboard hero) ──────────────────────────────────
// A half-circle of radial bars showing spend in this window as a share of the
// PREVIOUS window's spend (100% = matched last month). Purely presentational:
// the page works out both sides from the same ledger endpoint and passes the
// ratios in; nothing is re-derived here.
//
// The scale is 0–100% until the current window has already out-spent the
// previous one, then it extends to the next step (125 / 150 / 200 / 300 /
// 500 / 1000%), always printed at the ends and the top, so a full arc is never
// mistaken for "100%".
//
// A tick outside the arc marks where the previous window stood after the SAME
// number of days. Fill past the tick = ahead of last month's pace; short of it
// = behind. Every change sweeps (value and scale are tweened), so a filter
// that moves the figure reads as movement.
//
// Props:
//   pct          current ÷ previous × 100, or null when there is no previous
//                spend to compare against
//   markPct      previous-same-days ÷ previous × 100 (optional tick)
//   markLabel    tooltip for the tick, e.g. "Sep 1–27"
//   refLabel     what 100% means, e.g. "Sep 2026" — printed under the figure
//   status       { tone: "good" | "bad" | "neutral", text } or null
//   loading      boolean — dims the gauge while either side is loading

const BARS = 41;
const CX = 150;
const CY = 150;
const R_IN = 96;
const R_OUT = 128;
const OVER_STEPS = [125, 150, 200, 300, 500, 1000];

// Crimson (little of last month's spend reached) → gold → green (matched it).
const STOPS = [
  [0, [172, 35, 52]], // #AC2334
  [0.3, [217, 87, 43]], // ember
  [0.55, [224, 161, 46]], // gold
  [0.78, [167, 184, 58]], // lime
  [1, [21, 150, 106]], // #15966A
];
const colorAt = (t) => {
  const k0 = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (k0 <= t1) {
      const k = (k0 - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return STOPS[STOPS.length - 1][1];
};

// arc position 0 → left end (180°), 100 → right end (0°).
const point = (pos, r) => {
  const a = Math.PI * (1 - pos / 100);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};

const BAR_SPECS = Array.from({ length: BARS }, (_, i) => {
  const at = (i / (BARS - 1)) * 100;
  const [x1, y1] = point(at, R_IN);
  const [x2, y2] = point(at, R_OUT);
  return { i, at, x1, y1, x2, y2 };
});
const SLICE = 100 / (BARS - 1);

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
const ceilFor = (pct) =>
  pct == null || pct <= 100 ? 100 : (OVER_STEPS.find((s) => s >= pct) ?? Math.ceil(pct / 100) * 100);
const fmtScale = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

export default function SpendGauge(props) {
  const target = () => num(props.pct);
  const ceilTarget = () => ceilFor(target());

  // Tweened value AND scale, so both a filter change and a scale change sweep.
  const [shownV, setShownV] = createSignal(0);
  const [shownC, setShownC] = createSignal(100);

  createEffect(() => {
    const toV = target() ?? 0;
    const toC = ceilTarget();
    const fromV = untrack(shownV);
    const fromC = untrack(shownC);
    if (Math.abs(toV - fromV) < 0.0001 && Math.abs(toC - fromC) < 0.0001) return;
    const started = performance.now();
    const dur = 900;
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - started) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setShownV(fromV + (toV - fromV) * eased);
      setShownC(fromC + (toC - fromC) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const hasRef = () => target() != null;
  // Where on the arc the value sits, 0–100, under the scale in use.
  const pos = () => Math.min(100, (shownV() / shownC()) * 100);

  // 0–1: how much of bar i is lit. Bar i is centred on i·SLICE, so it starts
  // lighting half a slice before that — the first bar shows even near zero.
  const litOf = (i) => {
    const start = i * SLICE - SLICE / 2;
    return Math.max(0, Math.min(1, (pos() - start) / SLICE));
  };

  // A bar's colour is the value it stands for (its arc position × scale), so
  // the ramp always means "share of last month", whatever the scale.
  const barRgb = (b) => colorAt(((b.at / 100) * shownC()) / 100).join(",");
  const valueRgb = () => colorAt(shownV() / 100).join(",");

  const marker = () => point(pos(), (R_IN + R_OUT) / 2);
  const markPos = () => {
    const m = num(props.markPct);
    return m == null ? null : Math.min(100, (m / shownC()) * 100);
  };
  const mark = (r) => point(markPos(), r);
  const hundredPos = () => (100 / shownC()) * 100; // where "100%" sits once over

  const pctText = () => {
    const v = shownV();
    if (v > 0 && v < 1) return v.toFixed(2);
    return v.toFixed(1);
  };

  const pillCls = () =>
    ({
      good: "bg-[#E7F6EF] text-[#0F7A55] border-[#15966A]/25 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
      bad: "bg-[#FBEEF0] text-[#AC2334] border-[#AC2334]/25 dark:bg-red-900/25 dark:text-red-300 dark:border-red-800",
      neutral:
        "bg-[#FBF3E6] text-[#9A6512] border-[#D89A2B]/30 dark:bg-amber-900/25 dark:text-amber-300 dark:border-amber-800",
    })[props.status?.tone ?? "neutral"];

  const labelCls = "fill-[#8593A8] dark:fill-gray-500";
  const labelStyle = "font-size:11px;font-weight:600";

  return (
    <div
      class={`relative w-full max-w-[340px] mx-auto transition-opacity duration-300 ${
        props.loading ? "opacity-50" : "opacity-100"
      }`}
    >
      <svg
        viewBox="0 0 300 172"
        class="w-full h-auto overflow-visible"
        role="img"
        aria-label={
          hasRef()
            ? `Spend is ${target().toFixed(1)}% of ${props.refLabel ?? "the previous period"}`
            : "No previous spend to compare against"
        }
      >
        <defs>
          <filter id="sg-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        <For each={BAR_SPECS}>
          {(b) => (
            <>
              {/* Unlit track */}
              <line
                x1={b.x1}
                y1={b.y1}
                x2={b.x2}
                y2={b.y2}
                stroke={`rgb(${barRgb(b)})`}
                stroke-opacity="0.14"
                stroke-width="4.5"
                stroke-linecap="round"
              />
              {/* Lit share of this bar */}
              <line
                x1={b.x1}
                y1={b.y1}
                x2={b.x2}
                y2={b.y2}
                stroke={`rgb(${barRgb(b)})`}
                stroke-opacity={hasRef() ? litOf(b.i) : 0}
                stroke-width="4.5"
                stroke-linecap="round"
              />
            </>
          )}
        </For>

        {/* Once the scale runs past 100%, keep the 100% line visible inside */}
        <Show when={shownC() > 100.5}>
          <line
            x1={point(hundredPos(), R_IN - 6)[0]}
            y1={point(hundredPos(), R_IN - 6)[1]}
            x2={point(hundredPos(), R_IN - 14)[0]}
            y2={point(hundredPos(), R_IN - 14)[1]}
            class="stroke-[#8593A8] dark:stroke-gray-500"
            stroke-width="2"
            stroke-linecap="round"
          />
        </Show>

        {/* Same-days-last-period tick, outside the arc */}
        <Show when={hasRef() && markPos() != null}>
          <g class="text-[#14233A] dark:text-white">
            <line
              x1={mark(R_OUT + 6)[0]}
              y1={mark(R_OUT + 6)[1]}
              x2={mark(R_OUT + 17)[0]}
              y2={mark(R_OUT + 17)[1]}
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            />
            <circle
              cx={mark(R_OUT + 17)[0]}
              cy={mark(R_OUT + 17)[1]}
              r="3"
              fill="currentColor"
            />
            <title>
              {props.markLabel} spend: {num(props.markPct)?.toFixed(1)}% of{" "}
              {props.refLabel}
            </title>
          </g>
        </Show>

        {/* Value marker at the exact angle */}
        <Show when={hasRef()}>
          <circle
            cx={marker()[0]}
            cy={marker()[1]}
            r="9"
            fill={`rgb(${valueRgb()})`}
            opacity="0.45"
            filter="url(#sg-glow)"
          />
          <circle
            cx={marker()[0]}
            cy={marker()[1]}
            r="6"
            fill="white"
            stroke={`rgb(${valueRgb()})`}
            stroke-width="3"
          />
        </Show>

        {/* Scale labels: both ends and the midpoint at the top */}
        <text x={CX - (R_IN + R_OUT) / 2} y={CY + 20} text-anchor="middle" class={labelCls} style={labelStyle}>
          0%
        </text>
        <text x={CX} y={CY - R_OUT - 8} text-anchor="middle" class={labelCls} style={labelStyle}>
          {fmtScale(ceilTarget() / 2)}
        </text>
        <text x={CX + (R_IN + R_OUT) / 2} y={CY + 20} text-anchor="middle" class={labelCls} style={labelStyle}>
          {fmtScale(ceilTarget())}
        </text>
      </svg>

      {/* Centre readout */}
      <div class="absolute inset-x-0 top-[47%] flex flex-col items-center pointer-events-none px-14 text-center">
        <Show
          when={hasRef()}
          fallback={
            <span class="text-[28px] leading-none font-bold text-[#8593A8] dark:text-gray-500">
              —
            </span>
          }
        >
          <span class="text-[28px] sm:text-[32px] leading-none font-bold tracking-tight text-[#14233A] dark:text-white tabular-nums">
            {pctText()}
            <span class="text-base font-semibold text-[#8593A8] dark:text-gray-400">
              %
            </span>
          </span>
        </Show>
        <span class="mt-1 text-[11px] font-semibold text-[#8593A8] dark:text-gray-400 leading-tight">
          of {props.refLabel ?? "previous period"} spend
        </span>
        <Show when={props.status?.text}>
          <span
            class={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${pillCls()}`}
          >
            {props.status.text}
          </span>
        </Show>
      </div>
    </div>
  );
}
