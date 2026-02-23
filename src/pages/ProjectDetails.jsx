import { For, Show, createMemo, createSignal } from "solid-js";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { A } from "@solidjs/router";

/* ================= STATIC PROJECT INFO ================= */

const project = {
    name: "Godrej Arden",
    location: "Greater Noida",
    propertyType: "Residential Apartment",
    campaignManager: "Rishabh Pandey",
    model: "Hybrid",
};

const leadStats = {
    total: 65,
    delivered: 45,
    replaced: 5,
};

export default function ProjectDetails() {
    const today = new Date();

    /* ================= FILTER STATES ================= */

    const [fromDate, setFromDate] = createSignal("");
    const [toDate, setToDate] = createSignal("");
    const [search, setSearch] = createSignal("");
    const [statusFilter, setStatusFilter] = createSignal("All");
    const [page, setPage] = createSignal(1);

    const rowsPerPage = 5;

    /* ================= RAW CAMPAIGN DATA ================= */

    const initialData = [
        {
            number: 1,
            id: "birla-1",
            campaign_name: "Birla 1",
            location: "Noida NCR",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            cpl: 200,
            spent: 34890,
            leadsByDate: {
                "2026-02-05": 12,
                "2026-02-14": 8,
                "2026-02-12": 5,
            },
        },
        {
            number: 2,
            id: "birla-2",
            campaign_name: "Birla 2",
            location: "Noida NCR",
            ad_account: "preeti sharma",
            status: "paused",
            reach: "20",
            clicks: "40",
            cpl: 150,
            spent: 34890,
            leadsByDate: {
                "2026-02-13": 20,
                "2026-02-15": 20,
                "2026-02-14": 10,
                "2026-02-16": 6,
            },
        },
        {
            number: 3,
            id: "birla-3",
            campaign_name: "Birla 3",
            location: "Noida NCR",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            cpl: 250,
            spent: 34890,
            leadsByDate: {
                "2026-02-02": 20,
                "2026-02-14": 10,
                "2026-02-11": 6,
            },
        },
        {
            number: 4,
            id: "birla-4",
            campaign_name: "Birla 4",
            location: "Noida NCR",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            cpl: 150,
            spent: 34890,
            leadsByDate: {
                "2026-02-02": 20,
                "2026-02-14": 10,
                "2026-02-16": 6,
            },
        },
        {
            number: 5,
            id: "birla-5",
            campaign_name: "Birla 5",
            location: "Noida NCR",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            spent: 34890,
            cpl: 200,
            leadsByDate: {
                "2026-02-02": 20,
                "2026-02-14": 10,
                "2026-02-16": 6,
            },
        },
        {
            number: 6,
            id: "birla-6",
            campaign_name: "Birla 6",
            location: "Noida NCR",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            cpl: 200,
            spent: 34890,
            leadsByDate: {
                "2026-02-02": 20,
                "2026-02-14": 10,
                "2026-02-17": 6,
            },
        },
        {
            number: 7,
            id: "birla-7",
            campaign_name: "Birla 7",
            location: "Noida NCR",
            ad_account: "preeti sharma",
            status: "Live",
            reach: "20",
            clicks: "40",
            cpl: 200,
            spent: 34890,
            leadsByDate: {
                "2026-02-02": 20,
                "2026-02-15": 10,
                "2026-02-16": 6,
            },
        },
    ];

    /* ================= UTILITY ================= */

    const normalizeLocalDate = (d) => {
        const date = new Date(d);
        date.setHours(0, 0, 0, 0);
        return date.getTime(); // number (safe)
    };

    const getLeadsInRange = (leadsByDate, from, to) => {
        if (!from || !to) return 0;

        const start = normalizeLocalDate(from);
        const end = normalizeLocalDate(to);

        return Object.entries(leadsByDate || {}).reduce(
            (total, [dateStr, leads]) => {
                const current = normalizeLocalDate(dateStr);
                return current >= start && current <= end
                    ? total + leads
                    : total;
            },
            0
        );
    };


    /* ================= BASE FILTER (SEARCH + STATUS) ================= */

    const baseFilteredData = createMemo(() => {
        return initialData.filter((item) => {
            const matchesSearch = item.campaign_name
                .toLowerCase()
                .includes(search().toLowerCase());

            const matchesStatus =
                statusFilter() === "All" || item.status === statusFilter();

            return matchesSearch && matchesStatus;
        });
    });

    /* ================= GROUP + AGGREGATE + SORT ================= */

    const sortedCampaigns = createMemo(() => {
        const map = new Map();

        for (const row of baseFilteredData()) {
            const key = row.campaign_name;

            if (!map.has(key)) {
                map.set(key, {
                    ...row,
                    totalLeads: 0,
                    totalClicks: 0,
                    totalReach: 0,
                    totalSpent: 0,
                });
            }

            const entry = map.get(key);

            entry.totalLeads += getLeadsInRange(
                row.leadsByDate,
                fromDate(),
                toDate()
            );
            entry.totalClicks += Number(row.clicks || 0);
            entry.totalReach += Number(row.reach || 0);
            entry.totalSpent += Number(row.spent || 0);
        }

        // MOST LEADS ON TOP
        return Array.from(map.values()).sort(
            (a, b) => b.totalLeads - a.totalLeads
        );
    });

    /* ================= PAGINATION ================= */

    const paginatedData = createMemo(() =>
        sortedCampaigns().slice(
            (page() - 1) * rowsPerPage,
            page() * rowsPerPage
        )
    );

    /* ================= CLEAR FILTERS ================= */

    const clearFilters = () => {
        setSearch("");
        setStatusFilter("All");
        setFromDate("");
        setToDate("");
        setPage(1);
    };

    /* ================= RANGE LABEL ================= */

    const rangeLabel = createMemo(() => {
        if (!fromDate() || !toDate()) return "Today";

        const from = new Date(fromDate());
        const to = new Date(toDate());

        // normalize to local midnight
        from.setHours(0, 0, 0, 0);
        to.setHours(0, 0, 0, 0);

        const diffDays =
            Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;

        // today check
        if (diffDays === 1) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (from.getTime() === today.getTime()) {
                return "Today";
            }
            return "Yesterday";
        }

        if (diffDays === 3) return "Last 3 Days";
        if (diffDays === 7) return "Last 7 Days";
        if (diffDays >= 28 && diffDays <= 31) return "Last Month";

        return "Custom Range";
    });



    /* ================= UI ================= */

    return (
        <div class="space-y-6 m-4">

            {/* ================= PROJECT OVERVIEW ================= */}
            <section class="bg-white dark:bg-gray-900 border rounded-xl p-4">
                <h2 class="text-lg font-semibold mb-4">Project Overview</h2>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <Info label="Project Name" value={project.name} />
                    <Info label="Location" value={project.location} />
                    <Info label="Property Type" value={project.propertyType} />
                    <Info label="Campaign Manager" value={project.campaignManager} />
                    <Info label="Model" value={project.model} badge />
                </div>
            </section>

            {/* ================= FILTERS ================= */}
            <div class="flex flex-wrap gap-2 items-center">
                <input
                    placeholder="Search campaign..."
                    value={search()}
                    onInput={(e) => setSearch(e.target.value)}
                    class="px-3 py-2 border rounded-lg dark:bg-gray-800"
                />

                <select
                    value={statusFilter()}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    class="px-3 py-2 border rounded-lg dark:bg-gray-800"
                >
                    <option value="All">All</option>
                    <option value="Live">Live</option>
                    <option value="paused">Paused</option>
                </select>

                <DateRangeFilter
                    fromDate={fromDate}
                    toDate={toDate}
                    setFromDate={setFromDate}
                    setToDate={setToDate}
                />

                <button
                    onClick={clearFilters}
                    class="px-3 py-2 bg-red-100 text-red-700 rounded-lg"
                >
                    Clear
                </button>
            </div>

            {/* ================= TABLE ================= */}
            <div class="overflow-x-auto border rounded-xl">
                <table class="min-w-full text-sm">
                    <thead class="bg-gray-100 dark:bg-gray-800">
                        <tr class="[&_th]:text-center [&_th:first-child]:text-left">
                            <th class="p-3">Campaign</th>
                            <th class="p-3">Ad Account</th>
                            <th class="p-3">Status</th>
                            <th class="p-3">{rangeLabel()} Leads</th>
                            <th class="p-3">{rangeLabel()} Clicks</th>
                            <th class="p-3">{rangeLabel()} Reach</th>
                            <th class="p-3">{rangeLabel()} Spent</th>
                        </tr>
                    </thead>
                    <tbody>
                        <For each={paginatedData()}>
                            {(row, i) => (
                                <tr class=" [&_td]:text-center [&_td:first-child]:text-left border-t">
                                    <td class="p-3 font-medium">
                                        <A href={`/campaign/${row.id}`} class="text-blue-600  dark:text-blue-400">
                                            {row.campaign_name}
                                        </A>
                                        <Show when={i() === 0}>
                                            <span class="ml-2 px-2 py-0.5 text-xs rounded bg-green-100 text-green-700">
                                                Top Leads
                                            </span>
                                        </Show>
                                    </td>
                                    <td class="p-3 ">{row.ad_account}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-1 text-sm rounded-full capitalize"
                                            classList={{
                                                "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400": row.status === "Live",
                                                "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400": row.status === "paused",
                                            }}>
                                            {row.status}
                                        </span>
                                    </td>
                                    <td class="p-3 font-semibold">{row.totalLeads}</td>
                                    <td class="p-3">{row.totalClicks}</td>
                                    <td class="p-3">{row.totalReach}</td>
                                    <td class="p-3">₹{row.totalSpent.toLocaleString("en-IN")}</td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ================= SMALL COMPONENTS ================= */

function Info(props) {
    return (
        <div>
            <p class="text-xs text-gray-500">{props.label}</p>
            <p class="font-medium">{props.value}</p>
        </div>
    );
}
