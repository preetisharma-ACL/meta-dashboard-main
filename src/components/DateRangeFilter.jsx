import {
  createSignal,
  onMount,
  onCleanup,
  createMemo,
  For,
  Show,
  batch,
} from "solid-js";
import { Portal } from "solid-js/web";

export function DateRangeFilter(props) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [selectedTab, setSelectedTab] = createSignal("date");
  const [currentMonth, setCurrentMonth] = createSignal(new Date());
  const [tempFromDate, setTempFromDate] = createSignal("");
  const [tempToDate, setTempToDate] = createSignal("");
  const [selectionMode, setSelectionMode] = createSignal("preset");
  // values: 'preset' | 'manual'

  // Preset date ranges
  const presetRanges = [
    // { label: 'Last 30 Mins', value: 30 * 60 * 1000 },
    // { label: 'Last 1 Hour', value: 60 * 60 * 1000 },
    // { label: 'Last 6 Hours', value: 6 * 60 * 60 * 1000 },
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "Last 3 Days", value: "last3days" },
    { label: "Last 7 Days", value: "last7days" },
    { label: "Last 1 Month", value: "lastMonth" },
  ];

  // True when a date range / date is currently applied as a filter
  const hasSelection = () => {
    const from = props.fromDate();
    const to = props.toDate();
    return !!from && !!to;
  };

  const formatDisplayDate = () => {
    const from = props.fromDate();
    const to = props.toDate();

    if (!from || !to) return "Select Date Range";

    const fromDate = new Date(from + "T00:00:00");
    const toDate = new Date(to + "T00:00:00");

    const formatDate = (date) =>
      date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }); // "26 May 2026"

    if (from === to) return formatDate(fromDate); // Today/Yesterday — single date

    return `${formatDate(fromDate)} → ${formatDate(toDate)}`;
  };

  const getDaysInMonth = () => {
    const year = currentMonth().getFullYear();
    const month = currentMonth().getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];

    // Add empty cells for days before the first day
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // Add all days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    return days;
  };

  const isDateSelected = (day) => {
    if (!tempFromDate()) return false;

    const year = currentMonth().getFullYear();
    const month = currentMonth().getMonth();
    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);

    const from = new Date(tempFromDate());
    const to = new Date(tempToDate());

    from.setHours(0, 0, 0, 0);
    to.setHours(0, 0, 0, 0);

    return date.getTime() === from.getTime() || date.getTime() === to.getTime();
  };
  const isDateInRange = (day) => {
    if (!tempFromDate() || !tempToDate()) return false;

    const year = currentMonth().getFullYear();
    const month = currentMonth().getMonth();

    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);

    const from = new Date(tempFromDate());
    const to = new Date(tempToDate());

    from.setHours(0, 0, 0, 0);
    to.setHours(0, 0, 0, 0);

    return date > from && date < to;
  };

  const handleDayClick = (day) => {
    const year = currentMonth().getFullYear();
    const month = currentMonth().getMonth();

    // ✅ Future date block
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const clickedDate = new Date(year, month, day);
    clickedDate.setHours(0, 0, 0, 0);

    if (clickedDate > today) return;

    const toLocalDateStr = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const dateStr = toLocalDateStr(clickedDate); // ✅ .toISOString() nahi

    if (!tempFromDate()) {
      setTempFromDate(dateStr);
      setTempToDate("");
      return;
    }

    if (!tempToDate()) {
      const from = tempFromDate(); // already "YYYY-MM-DD" string
      if (dateStr < from) {
        setTempFromDate(dateStr);
        setTempToDate(from);
      } else {
        setTempToDate(dateStr);
      }
      return;
    }

    setTempFromDate(dateStr);
    setTempToDate("");
  };

  const handlePresetClick = (preset) => {
    setSelectionMode("preset");

    const now = new Date();

    const startOfDay = (d) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

    const endOfDay = (d) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    // ✅ Helper PEHLE define karo, batch ke upar
    const toLocalDateStr = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    let from, to;

    switch (preset.value) {
      case "today": {
        from = startOfDay(now);
        to = endOfDay(now);
        break;
      }
      case "yesterday": {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        from = startOfDay(yesterday);
        to = endOfDay(yesterday);
        break;
      }
      case "last3days": {
        const end = new Date(now);
        end.setDate(end.getDate() - 1);
        const start = new Date(end);
        start.setDate(start.getDate() - 2);
        from = startOfDay(start);
        to = endOfDay(end);
        break;
      }
      case "last7days": {
        const end = new Date(now);
        end.setDate(end.getDate() - 1);
        const start = new Date(end);
        start.setDate(start.getDate() - 6);
        from = startOfDay(start);
        to = endOfDay(end);
        break;
      }
      case "lastMonth": {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        from = startOfDay(start);
        to = endOfDay(end);
        break;
      }
      default:
        return;
    }

    batch(() => {
      setTempFromDate(toLocalDateStr(from)); // ✅ "2026-05-26" — UTC issue nahi
      setTempToDate(toLocalDateStr(to)); // ✅ "2026-05-26" — UTC issue nahi
      setCurrentMonth(new Date(from));
    });
  };

  const handleApply = () => {
    if (!tempFromDate()) return;

    const from = tempFromDate();
    const to = tempToDate() || tempFromDate(); // single date support

    // ✅ FIX 3: one atomic update → reportRows memo runs exactly once
    batch(() => {
      props.setFromDate(from);
      props.setToDate(to);
    });

    setIsOpen(false);
  };

  const handleCancel = () => {
    setTempFromDate(props.fromDate());
    setTempToDate(props.toDate());
    setIsOpen(false);
  };

  const handleOpen = () => {
    setTempFromDate(props.fromDate());
    setTempToDate(props.toDate());
    setIsOpen(true);
  };

  const changeMonth = (delta) => {
    const newMonth = new Date(currentMonth());
    newMonth.setMonth(newMonth.getMonth() + delta);
    setCurrentMonth(newMonth);
  };

  const isFutureDateSelected = () => {
    if (!tempFromDate()) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const from = new Date(tempFromDate());
    from.setHours(0, 0, 0, 0);

    const to = tempToDate() ? new Date(tempToDate()) : from;
    to.setHours(0, 0, 0, 0);

    return from > today || to > today;
  };

  const isFutureDate = (day) => {
    const year = currentMonth().getFullYear();
    const month = currentMonth().getMonth();

    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return date > today;
  };

  let calendarRef;

  onMount(() => {
    const handleClickOutside = (event) => {
      if (calendarRef && !calendarRef.contains(event.target)) {
        setIsOpen(false); // calendar close
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    onCleanup(() => {
      document.removeEventListener("mousedown", handleClickOutside);
    });
  });

  return (
    <div class="relative">
      {/* Trigger Button */}
      <button
        onClick={handleOpen}
        class={`flex items-center gap-2 px-3 py-2 text-md rounded-lg border transition-colors ${
          hasSelection()
            ? "bg-blue-900 text-white border-blue-600 hover:bg-blue-800"
            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700"
        }`}
      >
        <svg
          class={`w-5 h-5 ${
            hasSelection() ? "text-white" : "text-gray-900 dark:text-gray-200"
          }`}
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
        <span
          class={`text-md font-medium ${
            hasSelection() ? "text-white" : "text-gray-900 dark:text-gray-200"
          }`}
        >
          {formatDisplayDate()}
        </span>
        <svg
          class={`w-4 h-4 ${
            hasSelection() ? "text-white" : "text-gray-900 dark:text-gray-200"
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Modal */}
      <Show when={isOpen()}>
        <Portal>
          <div class="fixed inset-0 z-50 flex items-end justify-end p-4">
            {/* Backdrop */}
            <div class="fixed  bg-black/20" onClick={handleCancel} />

            {/* Modal Content */}
            <div
              ref={calendarRef}
              class="relative bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-[420px] max-h-[550px] overflow-hidden"
            >
              <div class="flex">
                {/* Left Sidebar - Presets */}
                <div class="w-40 bg-gray-50 dark:bg-gray-700 border-r border-gray-200 dark:border-gray-700 p-2">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Advanced Search
                    </span>
                  </div>
                  <div class="space-y-1">
                    <For each={presetRanges}>
                      {(preset) => (
                        <button
                          onClick={() => handlePresetClick(preset)}
                          class="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 rounded transition-colors"
                        >
                          {preset.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                {/* Right Content - Calendar */}
                <div class="flex-1 p-2">
                  {/* Tabs */}
                  <div class="flex border-b border-gray-200 dark:border-gray-800 mb-3">
                    <button
                      onClick={() => setSelectedTab("date")}
                      class={`px-4 py-2 text-sm font-medium transition-colors ${
                        selectedTab() === "date"
                          ? "text-gray-900 dark:text-gray-200 border-b-2 border-gray-900 dark:border-gray-300"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700"
                      }`}
                    >
                      Date
                    </button>
                    <button
                      onClick={() => setSelectedTab("time")}
                      class={`px-4 py-2 text-sm font-medium transition-colors ${
                        selectedTab() === "time"
                          ? "text-gray-900 dark:text-gray-200 border-b-2 border-gray-900 dark:border-gray-300"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700"
                      }`}
                    >
                      Time
                    </button>
                  </div>

                  <Show when={selectedTab() === "date"}>
                    {/* Month Navigation */}
                    <div class="flex items-center justify-between mb-4">
                      <button
                        onClick={() => changeMonth(-1)}
                        class="p-2 hover:bg-gray-100 rounded transition-colors"
                      >
                        <svg
                          class="w-5 h-5"
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

                      <div class="text-base font-medium text-gray-900 dark:text-gray-200 ">
                        {currentMonth().toLocaleDateString("en-US", {
                          month: "long",
                          year: "numeric",
                        })}
                      </div>

                      <button
                        onClick={() => changeMonth(1)}
                        class="p-2 hover:bg-gray-100 dark:bg-gray-800 rounded transition-colors"
                      >
                        <svg
                          class="w-5 h-5"
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

                    {/* Calendar Grid */}
                    <div class="mb-6">
                      {/* Weekday Headers */}
                      <div class="grid grid-cols-7 gap-1 mb-2">
                        <For each={["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]}>
                          {(day) => (
                            <div class="text-center text-xs font-medium text-gray-500 dark:text-gray-300 py-2">
                              {day}
                            </div>
                          )}
                        </For>
                      </div>

                      {/* Calendar Days */}
                      <div class="grid grid-cols-7 gap-1">
                        <For each={getDaysInMonth()}>
                          {(day) => (
                            <Show
                              when={day !== null}
                              fallback={<div class="aspect-square" />}
                            >
                              <button
                                onClick={() => handleDayClick(day)}
                                disabled={isFutureDate(day)}
                                class={`aspect-rectangle flex items-center justify-center text-sm py-2 rounded-full transition-colors ${
                                  isFutureDate(day)
                                    ? "text-gray-400 cursor-not-allowed opacity-50"
                                    : isDateSelected(day)
                                      ? "bg-blue-600 text-white font-semibold hover:bg-blue-700"
                                      : isDateInRange(day)
                                        ? "bg-blue-100 text-blue-900 hover:bg-blue-200"
                                        : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-900"
                                }`}
                              >
                                {day}
                              </button>
                            </Show>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  <Show when={selectedTab() === "time"}>
                    <div class="py-8 text-center text-gray-500 dark:text-gray-300 ">
                      Time selection interface would go here
                    </div>
                  </Show>

                  {/* Action Buttons */}
                  <div class="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-600">
                    <button
                      onClick={handleCancel}
                      class="px-6 py-2 text-sm font-medium rounded-lg border text-gray-700 dark:text-gray-200 border-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>

                    <button
                      onClick={handleApply}
                      disabled={!tempFromDate() || isFutureDateSelected()}
                      class={`px-6 py-2 text-sm font-medium rounded-lg
                                            ${
                                              !tempFromDate() ||
                                              isFutureDateSelected()
                                                ? "bg-blue-400 cursor-not-allowed"
                                                : "bg-blue-600 text-white hover:bg-blue-700"
                                            }`}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
