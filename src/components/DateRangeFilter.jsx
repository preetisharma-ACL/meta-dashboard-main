import { createSignal, createMemo, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

export function DateRangeFilter(props) {
    const [isOpen, setIsOpen] = createSignal(false);
    const [selectedTab, setSelectedTab] = createSignal('date');
    const [currentMonth, setCurrentMonth] = createSignal(new Date());
    const [tempFromDate, setTempFromDate] = createSignal('');
    const [tempToDate, setTempToDate] = createSignal('');
    const [selectionMode, setSelectionMode] = createSignal('preset');
    // values: 'preset' | 'manual'

    // Preset date ranges
    const presetRanges = [
        // { label: 'Last 30 Mins', value: 30 * 60 * 1000 },
        // { label: 'Last 1 Hour', value: 60 * 60 * 1000 },
        // { label: 'Last 6 Hours', value: 6 * 60 * 60 * 1000 },
        { label: 'Today', value: 'today' },
        { label: 'Yesterday', value: 'yesterday' },
        { label: 'Last 3 Days', value: 'last3days' },
        { label: 'Last 7 Days', value: 'last7days' },
        { label: 'Last 1 Month', value: 'lastMonth' },

    ];

    const formatDisplayDate = () => {
        const from = props.fromDate();
        const to = props.toDate();

        if (!from || !to) {
            return 'Select Date Range';
        }

        const fromDate = new Date(from);
        const toDate = new Date(to);

        const formatDate = (date) => {
            const month = date.toLocaleDateString('en-US', { month: 'short' });
            const day = date.getDate().toString().padStart(2, '0');
            const year = date.getFullYear();
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            return `${month} ${day}, ${year} ${hours}:${minutes}`;
        };

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
        if (!tempFromDate() && !tempToDate()) return false;

        const year = currentMonth().getFullYear();
        const month = currentMonth().getMonth();
        const date = new Date(year, month, day);
        const dateStr = date.toISOString().split('T')[0];

        const from = tempFromDate() ? new Date(tempFromDate()).toISOString().split('T')[0] : null;
        const to = tempToDate() ? new Date(tempToDate()).toISOString().split('T')[0] : null;

        return dateStr === from || dateStr === to;
    };

    const isDateInRange = (day) => {
        if (!tempFromDate() || !tempToDate()) return false;

        const year = currentMonth().getFullYear();
        const month = currentMonth().getMonth();
        const date = new Date(year, month, day);

        const from = new Date(tempFromDate());
        const to = new Date(tempToDate());

        return date > from && date < to;
    };

    const handleDayClick = (day) => {
        setSelectionMode('manual'); // 👈 important

        const year = currentMonth().getFullYear();
        const month = currentMonth().getMonth();
        const date = new Date(year, month, day);
        const dateStr = date.toISOString();

        if (!tempFromDate() || (tempFromDate() && tempToDate())) {
            setTempFromDate(dateStr);
            setTempToDate('');
        } else {
            if (new Date(dateStr) < new Date(tempFromDate())) {
                setTempToDate(tempFromDate());
                setTempFromDate(dateStr);
            } else {
                setTempToDate(dateStr);
            }
        }
    };


    const handlePresetClick = (preset) => {
        setSelectionMode("preset");

        const now = new Date();

        // helpers (LOCAL TIME ONLY)
        const startOfDay = (d) =>
            new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

        const endOfDay = (d) =>
            new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

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
                end.setDate(end.getDate() - 1); // yesterday

                const start = new Date(end);
                start.setDate(start.getDate() - 2); // 3 days total

                from = startOfDay(start);
                to = endOfDay(end);
                break;
            }

            case "last7days": {
                const end = new Date(now);
                end.setDate(end.getDate() - 1); // yesterday

                const start = new Date(end);
                start.setDate(start.getDate() - 6); // 7 days total

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

        // ⚠️ KEEP ISO ONLY FOR STATE (logic uses local timestamps)
        setTempFromDate(from.toISOString());
        setTempToDate(to.toISOString());
        setCurrentMonth(new Date(from));
    };



    const handleApply = () => {
        if (tempFromDate() && tempToDate()) {
            props.setFromDate(tempFromDate());
            props.setToDate(tempToDate());
        }
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

    return (
        <div class="relative">
            {/* Trigger Button */}
            <button
                onClick={handleOpen}
                class="flex items-center gap-2 px-3 py-2 text-md rounded-lg
                 bg-gray-100 dark:bg-gray-800
                 text-gray-900 dark:text-gray-100
                 border border-gray-300 dark:border-gray-700 transition-colors"
            >
                <svg class="w-5 h-5 text-gray-900 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span class="text-md font-medium text-gray-900 dark:text-gray-200">{formatDisplayDate()}</span>
                <svg class="w-4 h-4 text-gray-900 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Dropdown Modal */}
            <Show when={isOpen()}>
                <Portal>
                    <div class="fixed inset-0 z-50 flex items-end justify-end p-4">
                        {/* Backdrop */}
                        <div
                            class="fixed  bg-black/20"
                            onClick={handleCancel}
                        />

                        {/* Modal Content */}
                        <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-[420px] max-h-[550px] overflow-hidden">
                            <div class="flex">
                                {/* Left Sidebar - Presets */}
                                <div class="w-40 bg-gray-50 dark:bg-gray-700 border-r border-gray-200 dark:border-gray-700 p-2">
                                    <div class="flex items-center gap-2 mb-2">
                                        <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">Advanced Search</span>

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
                                            onClick={() => setSelectedTab('date')}
                                            class={`px-4 py-2 text-sm font-medium transition-colors ${selectedTab() === 'date'
                                                ? 'text-gray-900 dark:text-gray-200 border-b-2 border-gray-900 dark:border-gray-300'
                                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                                                }`}
                                        >
                                            Date
                                        </button>
                                        <button
                                            onClick={() => setSelectedTab('time')}
                                            class={`px-4 py-2 text-sm font-medium transition-colors ${selectedTab() === 'time'
                                                ? 'text-gray-900 dark:text-gray-200 border-b-2 border-gray-900 dark:border-gray-300'
                                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                                                }`}
                                        >
                                            Time
                                        </button>
                                    </div>

                                    <Show when={selectedTab() === 'date'}>
                                        {/* Month Navigation */}
                                        <div class="flex items-center justify-between mb-4">
                                            <button
                                                onClick={() => changeMonth(-1)}
                                                class="p-2 hover:bg-gray-100 rounded transition-colors"
                                            >
                                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                                                </svg>
                                            </button>

                                            <div class="text-base font-medium text-gray-900 dark:text-gray-200 ">
                                                {currentMonth().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                            </div>

                                            <button
                                                onClick={() => changeMonth(1)}
                                                class="p-2 hover:bg-gray-100 dark:bg-gray-800 rounded transition-colors"
                                            >
                                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                                                </svg>
                                            </button>
                                        </div>

                                        {/* Calendar Grid */}
                                        <div class="mb-6">
                                            {/* Weekday Headers */}
                                            <div class="grid grid-cols-7 gap-1 mb-2">
                                                <For each={['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']}>
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
                                                                class={`aspect-rectangle flex items-center justify-center text-sm py-2 rounded-full transition-colors ${isDateSelected(day)
                                                                    ? 'bg-blue-600 text-white font-semibold hover:bg-blue-700'
                                                                    : isDateInRange(day)
                                                                        ? 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                                                                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-900'
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

                                    <Show when={selectedTab() === 'time'}>
                                        <div class="py-8 text-center text-gray-500 dark:text-gray-300 ">
                                            Time selection interface would go here
                                        </div>
                                    </Show>

                                    {/* Action Buttons */}
                                    <div class="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-600">
                                        <button
                                            onClick={handleCancel}
                                            disabled={selectionMode() === 'manual'}
                                            class={`px-6 py-2 text-sm font-medium rounded-lg border transition-colors
                                            ${selectionMode() === 'manual'
                                                    ? 'opacity-50 cursor-not-allowed'
                                                    : 'text-gray-700 dark:text-gray-200 border-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                                                }`}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleApply}
                                            disabled={selectionMode() === 'manual'}
                                            class={`px-6 py-2 text-sm font-medium rounded-lg transition-colors
                                             ${selectionMode() === 'manual'
                                                    ? 'bg-blue-400 cursor-not-allowed'
                                                    : 'bg-blue-600 text-white hover:bg-blue-700'
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