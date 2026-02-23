import { createSignal, createMemo, For } from "solid-js";

const initialData = [
    {

        name: "Godrej Arden",
        status: "Live",
        campaigns: "4 (3 Live / 1 Paused)",
        startDate: "12 Jan 2026",
        leads: 45,
        cpl: "₹1,200",
    },
    {

        name: "Eldeco Omicron",
        status: "Live",
        campaigns: "2 (2 Live)",
        startDate: "20 Jan 2026",
        leads: 25,
        cpl: "₹1,350",
    },
];

export default function LiveProjects() {
    const [search, setSearch] = createSignal("");
    const [statusFilter, setStatusFilter] = createSignal("All");
    const [selectedRows, setSelectedRows] = createSignal([]);
    const [page, setPage] = createSignal(1);

    const rowsPerPage = 5;

    const filteredData = createMemo(() =>
        initialData.filter((item) => {
            const matchesSearch = item.name
                .toLowerCase()
                .includes(search().toLowerCase());

            const matchesStatus =
                statusFilter() === "All" || item.status === statusFilter();

            return matchesSearch && matchesStatus;
        })
    );

    const paginatedData = createMemo(() =>
        filteredData().slice(
            (page() - 1) * rowsPerPage,
            page() * rowsPerPage
        )
    );

    const toggleRow = (name) => {
        setSelectedRows((prev) =>
            prev.includes(name)
                ? prev.filter((n) => n !== name)
                : [...prev, name]
        );
    };

    return (
        <div class="bg-white dark:bg-gray-900 rounded-xl shadow border border-gray-200 dark:border-gray-800">

            {/* Header Controls */}
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 border-b border-gray-200 dark:border-gray-800">

                {/* Search */}
                <input
                    type="text"
                    placeholder="Search projects..."
                    value={search()}
                    onInput={(e) => setSearch(e.target.value)}
                    class="w-full md:w-64 px-3 py-2 text-sm rounded-lg
                 bg-gray-100 dark:bg-gray-800
                 text-gray-900 dark:text-gray-200
                 border border-gray-300 dark:border-gray-700
                 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                {/* Filter */}
                <select
                    value={statusFilter()}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    class="px-3 py-2 text-sm rounded-lg
                 bg-gray-100 dark:bg-gray-800
                 text-gray-900 dark:text-gray-200
                 border border-gray-300 dark:border-gray-700"
                >
                    <option value="All">All Status</option>
                    <option value="Live">Live</option>
                    <option value="Paused">Paused</option>
                </select>
            </div>

            {/* Table */}
            <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                    <thead class="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        <tr>
                            <th class="px-4 py-3 text-left">
                                <input type="checkbox" disabled />
                            </th>
                            <th class="px-4 py-3 text-left">Project Name</th>
                            <th class="px-4 py-3 text-left">Status</th>
                            <th class="px-4 py-3 text-left">Campaigns</th>
                            <th class="px-4 py-3 text-left">Start Date</th>
                            <th class="px-4 py-3 text-left">Leads Delivered</th>
                            <th class="px-4 py-3 text-left">CPL</th>
                        </tr>
                    </thead>

                    <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
                        <For each={paginatedData()}>
                            {(row) => (
                                <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                    <td class="px-4 py-3">
                                        <input
                                            type="checkbox"
                                            checked={selectedRows().includes(row.name)}
                                            onChange={() => toggleRow(row.name)}
                                        />
                                    </td>
                                    <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">
                                        {row.name}
                                    </td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-1 text-xs rounded-full
                      bg-green-100 text-green-700
                      dark:bg-green-900/30 dark:text-green-400">
                                            {row.status}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {row.campaigns}
                                    </td>
                                    <td class="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {row.startDate}
                                    </td>
                                    <td class="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                                        {row.leads}
                                    </td>
                                    <td class="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {row.cpl}
                                    </td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div class="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-800 text-sm">

                {/* Selected count */}
                <p class="text-gray-600 dark:text-gray-400">
                    {selectedRows().length} of {filteredData().length} row(s) selected
                </p>

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
