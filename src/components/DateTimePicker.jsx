import { createSignal, onMount, onCleanup, For, Show, batch } from "solid-js";

// A custom date + time picker that outputs the same value shape a native
// <input type="datetime-local"> produces: "YYYY-MM-DDTHH:mm" (local wall-clock,
// no timezone). Unlike the native control, it exposes an explicit **Set** button
// so the user commits the chosen date & time deliberately.
//
// Props:
//   value        string   — "YYYY-MM-DDTHH:mm" or "" (reactive)
//   onChange     (v)=>void — called with the committed value ("" when cleared)
//   min          string?   — earliest allowed "YYYY-MM-DDTHH:mm" (day-level gate)
//   max          string?   — latest allowed "YYYY-MM-DDTHH:mm" (day-level gate)
//   disabled     boolean?
//   placeholder  string?
const pad2 = (n) => String(n).padStart(2, "0");

// "YYYY-MM-DDTHH:mm" → { y, m, d, hh, mm } or null.
const parseValue = (val) => {
  if (!val) return null;
  const [date, time] = val.split("T");
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d, hh: hh || 0, mm: mm || 0 };
};

// Date portion only, as "YYYY-MM-DD", for range comparisons.
const dateKey = (val) => (val ? val.split("T")[0] : "");

export default function DateTimePicker(props) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [currentMonth, setCurrentMonth] = createSignal(new Date());
  const [tempDate, setTempDate] = createSignal(""); // "YYYY-MM-DD"
  const [tempHour, setTempHour] = createSignal(0);
  const [tempMin, setTempMin] = createSignal(0);

  // Human-readable trigger label: "DD-MM-YYYY HH:mm".
  const displayLabel = () => {
    const p = parseValue(props.value);
    if (!p) return "";
    return `${pad2(p.d)}-${pad2(p.m)}-${p.y} ${pad2(p.hh)}:${pad2(p.mm)}`;
  };

  // Seed the temp state from the current value (or sensible defaults) on open.
  const seedFromValue = () => {
    const p = parseValue(props.value);
    if (p) {
      batch(() => {
        setTempDate(`${p.y}-${pad2(p.m)}-${pad2(p.d)}`);
        setTempHour(p.hh);
        setTempMin(p.mm);
        setCurrentMonth(new Date(p.y, p.m - 1, 1));
      });
    } else {
      const now = new Date();
      batch(() => {
        setTempDate("");
        setTempHour(now.getHours());
        setTempMin(now.getMinutes());
        setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
      });
    }
  };

  const getDaysInMonth = () => {
    const year = currentMonth().getFullYear();
    const month = currentMonth().getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) days.push(null);
    for (let i = 1; i <= lastDay.getDate(); i++) days.push(i);
    return days;
  };

  const dayToKey = (day) => {
    const year = currentMonth().getFullYear();
    const month = currentMonth().getMonth();
    return `${year}-${pad2(month + 1)}-${pad2(day)}`;
  };

  const isSelected = (day) => tempDate() === dayToKey(day);

  // Disable days outside [min, max] at day granularity.
  const isDisabledDay = (day) => {
    const key = dayToKey(day);
    const minKey = dateKey(props.min);
    const maxKey = dateKey(props.max);
    if (minKey && key < minKey) return true;
    if (maxKey && key > maxKey) return true;
    return false;
  };

  const handleDayClick = (day) => {
    if (isDisabledDay(day)) return;
    setTempDate(dayToKey(day));
  };

  const changeMonth = (delta) => {
    const next = new Date(currentMonth());
    next.setMonth(next.getMonth() + delta);
    setCurrentMonth(next);
  };

  const clampHour = (n) => Math.max(0, Math.min(23, n || 0));
  const clampMin = (n) => Math.max(0, Math.min(59, n || 0));

  const handleSet = () => {
    if (!tempDate()) return;
    const val = `${tempDate()}T${pad2(clampHour(tempHour()))}:${pad2(
      clampMin(tempMin())
    )}`;
    props.onChange?.(val);
    setIsOpen(false);
  };

  const handleClear = () => {
    props.onChange?.("");
    setIsOpen(false);
  };

  const handleToday = () => {
    const now = new Date();
    batch(() => {
      setTempDate(
        `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(
          now.getDate()
        )}`
      );
      setTempHour(now.getHours());
      setTempMin(now.getMinutes());
      setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    });
  };

  const handleOpen = () => {
    if (props.disabled) return;
    seedFromValue();
    setIsOpen(true);
  };

  let rootRef;
  onMount(() => {
    const onDocMouseDown = (e) => {
      if (rootRef && !rootRef.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    onCleanup(() => document.removeEventListener("mousedown", onDocMouseDown));
  });

  return (
    <div class="relative" ref={rootRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={props.disabled}
        class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-left focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span
          class={
            displayLabel()
              ? "text-gray-900 dark:text-gray-100"
              : "text-gray-400 dark:text-gray-500"
          }
        >
          {displayLabel() || props.placeholder || "Select date & time"}
        </span>
        <svg
          class="w-4 h-4 text-gray-400 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </button>

      {/* Popup */}
      <Show when={isOpen()}>
        <div class="absolute z-50 mt-2 w-[300px] bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 p-3">
          {/* Month navigation */}
          <div class="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              class="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {currentMonth().toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </div>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              class="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>

          {/* Weekday headers */}
          <div class="grid grid-cols-7 gap-0.5 mb-1">
            <For each={["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]}>
              {(d) => (
                <div class="text-center text-[11px] font-medium text-gray-400 py-1">
                  {d}
                </div>
              )}
            </For>
          </div>

          {/* Days */}
          <div class="grid grid-cols-7 gap-0.5 mb-3">
            <For each={getDaysInMonth()}>
              {(day) => (
                <Show when={day !== null} fallback={<div />}>
                  <button
                    type="button"
                    onClick={() => handleDayClick(day)}
                    disabled={isDisabledDay(day)}
                    class={`h-8 flex items-center justify-center text-sm rounded-md transition-colors ${
                      isDisabledDay(day)
                        ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                        : isSelected(day)
                          ? "bg-blue-600 text-white font-semibold"
                          : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    {day}
                  </button>
                </Show>
              )}
            </For>
          </div>

          {/* Time selectors */}
          <div class="flex items-center gap-2 mb-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <span class="text-xs text-gray-500 dark:text-gray-400">Time</span>
            <div class="flex items-center gap-1 ml-auto">
              <input
                type="number"
                min="0"
                max="23"
                value={pad2(tempHour())}
                onInput={(e) => setTempHour(clampHour(parseInt(e.target.value, 10)))}
                class="w-14 px-2 py-1 text-sm text-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                aria-label="Hour"
              />
              <span class="text-gray-500">:</span>
              <input
                type="number"
                min="0"
                max="59"
                value={pad2(tempMin())}
                onInput={(e) => setTempMin(clampMin(parseInt(e.target.value, 10)))}
                class="w-14 px-2 py-1 text-sm text-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                aria-label="Minute"
              />
            </div>
          </div>

          {/* Actions */}
          <div class="flex items-center justify-between gap-2">
            <div class="flex gap-2">
              <button
                type="button"
                onClick={handleToday}
                class="px-3 py-1.5 text-xs font-medium text-blue-600 hover:underline"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleClear}
                class="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:underline"
              >
                Clear
              </button>
            </div>
            <button
              type="button"
              onClick={handleSet}
              disabled={!tempDate()}
              class={`px-5 py-1.5 text-sm font-semibold rounded-lg ${
                tempDate()
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-blue-300 text-white cursor-not-allowed"
              }`}
            >
              Set
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
