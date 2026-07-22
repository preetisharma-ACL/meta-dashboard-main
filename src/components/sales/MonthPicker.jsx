import { createSignal, createMemo, Show, For, onCleanup } from "solid-js";

// A polished, self-contained month picker that replaces the browser's native
// `<input type="month">`. Value + onChange use the same "YYYY-MM" contract, so
// it is a drop-in swap. Future months (beyond `max`) are disabled.
//
//   <MonthPicker value={month()} max={currentMonthStr()} onChange={setMonth} />

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const parseYM = (s) => {
  const [y, m] = String(s || "").split("-").map(Number);
  if (!y || !m) {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }
  return { year: y, month: m };
};

const ym = (year, month) => `${year}-${String(month).padStart(2, "0")}`;

export default function MonthPicker(props) {
  const [open, setOpen] = createSignal(false);

  // The year currently shown in the popup grid (independent of the selection,
  // so users can browse other years before committing).
  const selected = createMemo(() => parseYM(props.value));
  const [viewYear, setViewYear] = createSignal(selected().year);

  const maxYM = () => parseYM(props.max || "9999-12");

  const label = createMemo(() => {
    const { year, month } = selected();
    return `${MONTHS_SHORT[month - 1]} ${year}`;
  });

  // A month is disabled when it is strictly after `max`.
  const isDisabled = (m) => {
    const cap = maxYM();
    return viewYear() > cap.year || (viewYear() === cap.year && m > cap.month);
  };

  const isSelected = (m) => {
    const s = selected();
    return s.year === viewYear() && s.month === m;
  };

  const canNextYear = () => viewYear() < maxYM().year;

  let rootEl;
  const onDocClick = (e) => {
    if (rootEl && !rootEl.contains(e.target)) setOpenBound(false);
  };
  const onKey = (e) => {
    if (e.key === "Escape") setOpenBound(false);
  };

  // Attach global listeners only while open, and always tear them down.
  const setOpenBound = (v) => {
    if (v) {
      document.addEventListener("mousedown", onDocClick);
      document.addEventListener("keydown", onKey);
    } else {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    }
    setOpen(v);
  };
  onCleanup(() => setOpenBound(false));

  const pick = (m) => {
    if (isDisabled(m)) return;
    props.onChange?.(ym(viewYear(), m));
    setOpenBound(false);
  };

  const jumpToThisMonth = () => {
    const d = new Date();
    setViewYear(d.getFullYear());
    props.onChange?.(ym(d.getFullYear(), d.getMonth() + 1));
    setOpenBound(false);
  };

  return (
    <div class="relative" ref={rootEl}>
      {/* ── Trigger ── */}
      <button
        type="button"
        onClick={() => {
          const next = !open();
          if (next) setViewYear(selected().year); // re-anchor to selection on open
          setOpenBound(next);
        }}
        aria-haspopup="dialog"
        aria-expanded={open()}
        class={`group inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-lg bg-white dark:bg-gray-800 border text-xs font-semibold text-[#14233A] dark:text-gray-100 shadow-sm transition-all ${
          open()
            ? "border-[#AC2334] ring-2 ring-[#AC2334]/20"
            : "border-[#E2E8F1] dark:border-gray-600 hover:border-[#AC2334]/50 hover:shadow"
        }`}
      >
        <svg
          class="w-3.5 h-3.5 text-[#AC2334]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span class="tabular-nums">{label()}</span>
        <svg
          class={`w-3.5 h-3.5 text-[#8593A8] transition-transform ${open() ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2.2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* ── Popup ── */}
      <Show when={open()}>
        <div
          role="dialog"
          class="absolute right-0 z-50 mt-1.5 w-56 origin-top-right rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 p-2 animate-[mpFade_120ms_ease-out]"
        >
          {/* Year header with steppers */}
          <div class="flex items-center justify-between mb-2 px-0.5">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              aria-label="Previous year"
              class="w-6 h-6 grid place-items-center rounded-md text-[#54657E] dark:text-gray-300 hover:bg-[#F3F6FB] dark:hover:bg-gray-700 hover:text-[#14233A] dark:hover:text-white transition-colors"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span class="text-xs font-bold text-[#14233A] dark:text-white tabular-nums tracking-wide">
              {viewYear()}
            </span>
            <button
              type="button"
              onClick={() => canNextYear() && setViewYear((y) => y + 1)}
              disabled={!canNextYear()}
              aria-label="Next year"
              class="w-6 h-6 grid place-items-center rounded-md text-[#54657E] dark:text-gray-300 hover:bg-[#F3F6FB] dark:hover:bg-gray-700 hover:text-[#14233A] dark:hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Month grid */}
          <div class="grid grid-cols-3 gap-1">
            <For each={MONTHS_SHORT}>
              {(name, i) => {
                const m = i() + 1;
                const disabled = () => isDisabled(m);
                const sel = () => isSelected(m);
                return (
                  <button
                    type="button"
                    onClick={() => pick(m)}
                    disabled={disabled()}
                    aria-pressed={sel()}
                    class={`h-8 rounded-lg text-xs font-semibold transition-all ${
                      sel()
                        ? "bg-[#14233A] text-white shadow-sm ring-2 ring-[#AC2334]/40"
                        : disabled()
                          ? "text-[#C3CBD8] dark:text-gray-600 cursor-default"
                          : "text-[#37475F] dark:text-gray-200 hover:bg-[#F3F6FB] dark:hover:bg-gray-700 hover:text-[#14233A] dark:hover:text-white"
                    }`}
                  >
                    {name}
                  </button>
                );
              }}
            </For>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-end mt-2 pt-2 border-t border-[#EEF1F6] dark:border-gray-700">
            <button
              type="button"
              onClick={jumpToThisMonth}
              class="text-[11px] font-semibold text-[#AC2334] dark:text-red-300 hover:underline underline-offset-2"
            >
              This month
            </button>
          </div>
        </div>
      </Show>

      <style>{`
        @keyframes mpFade {
          from { opacity: 0; transform: translateY(-4px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
