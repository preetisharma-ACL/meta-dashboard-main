import { createSignal, createMemo, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { DateRangeFilter } from "../components/DateRangeFilter";

export default function Dashboard() {
    // const [selectedYear, setSelectedYear] = createSignal('2024');
    // In your component:
    const today = new Date();
    const [fromDate, setFromDate] = createSignal('');
    const [toDate, setToDate] = createSignal('');

    const project = {
        name: "Godrej Arden",
        location: "Greater Noida",
        propertyType: "Residential Apartment",
        campaignManager: "Rishabh Pandey",
        model: "Hybrid",
    };
    const initialData = [
        {
            number: 1,
            campaign_name: "Godrej Arden",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            leads: 45,
            cpl: "₹200",
            spent: 34890,
            date: new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() - 1
            ),
        },
        {
            number: 2,
            campaign_name: "Eldeco Omicron",
            ad_account: "preeti sharma",
            status: "paused",
            reach: "20",
            clicks: "40",
            leads: 45,
            cpl: "₹200",
            spent: 34890,
            date: new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() - 3
            ),
        },
        {
            number: 3,
            campaign_name: "Godrej Arden",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            leads: 45,
            cpl: "₹200",
            spent: 34890,
            date: new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() - 3
            ),
        },
        {
            number: 4,
            campaign_name: "Godrej Arden",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "40",
            clicks: "55",
            leads: 45,
            cpl: "₹200",
            spent: 34890,
            date: new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() - 1
            ),
        },
        {
            number: 5,
            campaign_name: "Godrej Arden",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            leads: 45,
            cpl: "₹200",
            spent: 34890,
            date: new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate()
            ),
        },
        {
            number: 6,
            campaign_name: "Godrej Arden",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            leads: 45,
            cpl: "₹200",
            spent: 34890,
            date: new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate()
            ),
        },
        {
            number: 7,
            campaign_name: "Godrej Arden",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            leads: 45,
            cpl: "₹200",
            spent: 34890,
            date: new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() - 7
            ),
        },
        {
            number: 8,
            campaign_name: "Godrej Arden",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            leads: 45,
            cpl: "₹200",
            spent: 34890,
            date: new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() - 7
            ),
        }
    ];
    const [search, setSearch] = createSignal("");
    const [statusFilter, setStatusFilter] = createSignal("All");
    const [page, setPage] = createSignal(1);

    const rowsPerPage = 5;

    const filteredData = createMemo(() => {
        return initialData.filter((item) => {
            const matchesSearch = item.campaign_name
                .toLowerCase()
                .includes(search().toLowerCase());

            const matchesStatus =
                statusFilter() === "All" || item.status === statusFilter();
            let matchesDate = true;
            if (fromDate() && toDate()) {
                const itemDate = new Date(item.date);
                const from = new Date(fromDate());
                const to = new Date(toDate());

                // Normalize all to midnight
                itemDate.setHours(0, 0, 0, 0);
                from.setHours(0, 0, 0, 0);
                to.setHours(23, 59, 59, 999);

                matchesDate = itemDate >= from && itemDate <= to;
            }

            return matchesSearch && matchesStatus && matchesDate;
        });
    });

    const clearFilters = () => {
        setStatusFilter("All");
        setFromDate("");
        setToDate("");
        setSearch("");
        setPage(1);
    };
    const hasActiveFilters = createMemo(() =>
        statusFilter() !== "All" || fromDate() || toDate() || search()
    );

    const paginatedData = createMemo(() =>
        filteredData().slice(
            (page() - 1) * rowsPerPage,
            page() * rowsPerPage
        )
    );

    const rangeLabel = createMemo(() => {
        if (!fromDate() || !toDate()) return "Today";

        const from = new Date(fromDate());
        const to = new Date(toDate());

        // Normalize dates WITHOUT mutating originals
        const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
        const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
        const diffDays =
            Math.round((end - start) / 86400000) + 1;

        if (diffDays === 1) return "Today";
        if (diffDays === 2) return "Yesterday";
        if (diffDays === 3) return "Last 3 Days";
        if (diffDays === 7) return "Last 7 Days";
        if (diffDays >= 28 && diffDays <= 31) return "Last Month";
        return `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`;
    });


    return (
        <div class="p-6 space-y-6">
            {/* Header */}
            <div>
                <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Client Dashboard</h1>
                <p class="text-gray-600 dark:text-gray-400 mt-1">
                    Welcome back! Here's what's happening with your sales pipeline today.
                </p>
            </div>

            {/* ================= Project Overview ================= */}
            <section class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Project Overview
                </h2>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
                    <Info label="Project Name" value={project.name} />
                    <Info label="Location" value={project.location} />
                    <Info label="Property Type" value={project.propertyType} />
                    <Info label="Campaign Manager" value={project.campaignManager} />
                    <Info label="Model" value={project.model} badge />
                </div>
            </section>

            {/* Header Controls */}
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 border-b border-gray-200 dark:border-gray-800">
                {/* Search */}
                <input
                    type="text"
                    placeholder="Search projects..."
                    value={search()}
                    onInput={(e) => setSearch(e.target.value)}
                    class="w-full md:w-64 px-3 py-2 text-md rounded-lg
                 bg-gray-100 dark:bg-gray-800
                 text-gray-900 dark:text-gray-200
                 border border-gray-300 dark:border-gray-700
                 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div class="flex flex-wrap md:flex-row md:items-center gap-2">

                    {/* Status Filter */}
                    <select
                        value={statusFilter()}
                        onChange={(e) => {
                            setStatusFilter(e.target.value);
                            setPage(1);
                        }}
                        class="px-3 py-2 text-md rounded-lg
        bg-gray-100 dark:bg-gray-800
        text-gray-900 dark:text-gray-200
        border border-gray-300 dark:border-gray-700"
                    >
                        <option value="All">All Status</option>
                        <option value="paused">Paused</option>
                        <option value="Live">Live</option>
                    </select>

                    {/* Date Filter */}
                    <DateRangeFilter
                        fromDate={fromDate}
                        toDate={toDate}
                        setFromDate={(v) => {
                            setFromDate(v);
                            setPage(1);
                        }}
                        setToDate={(v) => {
                            setToDate(v);
                            setPage(1);
                        }}
                    />

                    {/* Clear Filters */}
                    <Show when={hasActiveFilters()}>
                        <button
                            onClick={clearFilters}
                            class="px-3 py-2 text-md rounded-lg
            bg-red-100 text-red-700
            hover:bg-red-200
            dark:bg-red-900/30 dark:text-red-400"
                        >
                            Clear Filters
                        </button>
                    </Show>
                </div>
            </div>

            {/* Table */}
            <div class="overflow-x-auto overflow-y-auto  scrollbar-thin
    scrollbar-thumb-green-100 dark:scrollbar-thumb-gray-700
    scrollbar-track-transparent
    hover:scrollbar-thumb-green-900 dark:hover:scrollbar-thumb-gray-800 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
                <table class="min-w-full text-sm">
                    <thead class="bg-primary-50 dark:bg-gray-800 text-primary-900 dark:text-gray-400">
                        <tr class="[&_th]:whitespace-nowrap [&_th]:text-center">
                            <th class="px-4 py-3 text-left">Number</th>
                            <th class="px-4 py-3 text-left">Campaign Name</th>
                            <th class="px-4 py-3 text-left">Ad Account</th>
                            <th class="px-4 py-3 text-left">Status</th>
                            <th class="px-4 py-3 text-left">Date</th>
                            <th class="px-4 py-3 text-left">{rangeLabel()} Reach</th>
                            <th class="px-4 py-3 text-left">{rangeLabel()} Clicks</th>
                            <th class="px-4 py-3 text-left">{rangeLabel()} Leads</th>
                            <th class="px-4 py-3 text-left">{rangeLabel()} CPL</th>
                            <th class="px-4 py-3 text-left">{rangeLabel()} Spent</th>
                        </tr>
                    </thead>

                    <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
                        <For each={paginatedData()}>
                            {(row) => (
                                <tr class="[&_td]:whitespace-nowrap [&_td]:text-center text-center hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                    <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">
                                        {row.number}
                                    </td>
                                    <td class="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {row.campaign_name}
                                    </td>
                                    <td class="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {row.ad_account}
                                    </td>
                                    <td class="px-4 py-3">
                                        <span
                                            class="px-2 py-1 text-sm rounded-full capitalize"
                                            classList={{
                                                "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400":
                                                    row.status === "Live",

                                                "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400":
                                                    row.status === "paused",
                                            }}
                                        >
                                            {row.status}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {row.date.toLocaleDateString('en-IN', {
                                            day: "2-digit",
                                            month: "short",
                                            year: "numeric"
                                        })}
                                    </td>
                                    <td
                                        class="px-4 py-3 text-gray-700  dark:text-gray-300">
                                        {row.reach}
                                    </td>
                                    <td class="px-4 py-3 font-semibold text-gray-900  dark:text-white">
                                        {row.clicks}
                                    </td>
                                    <td class="px-4 py-3 text-gray-700 dark:text-gray-300 ">
                                        {row.leads}
                                    </td>
                                    <td class="px-4 py-3 text-gray-700 dark:text-gray-300 ">
                                        {row.cpl}
                                    </td>
                                    <td class="px-4 py-3 text-gray-700 dark:text-gray-300 ">
                                        {row.spent}
                                    </td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div class="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-800 text-md">
                {/* Pagination */}
                <div class="flex gap-2">
                    <button
                        onClick={() => setPage(Math.max(1, page() - 1))}
                        class="px-3 py-1.5 rounded-lg border
                   border-gray-300 dark:border-gray-700
                   text-gray-700 dark:text-gray-300
                   hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        Prev
                    </button>
                    <button
                        onClick={() =>
                            setPage(
                                page() * rowsPerPage < filteredData().length
                                    ? page() + 1
                                    : page()
                            )
                        }
                        class="px-3 py-1.5 rounded-lg border
                   border-gray-300 dark:border-gray-700
                   text-gray-700 dark:text-gray-300
                   hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}
function Info(props) {
    return (
        <div>
            <p class="text-sm text-gray-500 dark:text-gray-400">
                {props.label}
            </p>
            <p
                class={`mt-1 font-medium ${props.badge
                    ? "inline-block px-2 py-1 text-sm rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : "text-gray-900 dark:text-white"
                    }`}
            >
                {props.value}
            </p>
        </div>
    );
}