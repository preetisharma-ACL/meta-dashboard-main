import { For, Show, createMemo, createSignal } from "solid-js";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { A } from "@solidjs/router";
import { useLocation } from "@solidjs/router";
import { Users, PhoneCall, BadgeCheck, MapPin, Home, TrendingUp } from "lucide-solid";
import {
    IndianRupee,
    Clock,
    XCircle,
    User,
} from "lucide-solid";

/* ================= STATIC PROJECT INFO ================= */

// const project = {
//     name: "Godrej Arden",
//     location: "Greater Noida",
//     propertyType: "Residential Apartment",
//     campaignManager: "Rishabh Pandey",
//     model: "Hybrid",
// };



const leadStats = {
    total: 65,
    delivered: 45,
    replaced: 5,
};

export default function ProjectDetails() {
    const location = useLocation();
    const project = location.state?.project;
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
    const metricIcons = {
        "Total Leads Generated": Users,
        "Average CPL": TrendingUp,
        "Total Spent Amount": IndianRupee,
        "Total Qualified Leads": BadgeCheck,
        "Follow ups / Interested": PhoneCall,
        "Delay in Feedback": Clock,
        "Not Interested": XCircle,
        "Call Not Picked / Call Later": PhoneCall,
        "Broker": User,
    };


    /* ================= UI ================= */

    return (
        <div class="space-y-6 m-4">

            {/* ================= PROJECT OVERVIEW ================= */}
            <Show when={project} fallback={<p>No project selected</p>}>
                <section class="bg-white dark:bg-gray-900 border rounded-xl p-4">
                    <h2 class="text-lg font-semibold mb-4">Project Overview</h2>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        <Info label="Project Name" value={project?.name} />
                        <Info label="Location" value={project?.location} />
                        <Info label="Property Type" value={project?.type} />
                        <Info label="Priority" value={project?.priority} />
                        <Info label="Project Control" value={project?.projectControl} />
                        <Info label="Project Pricing & Typology" value={project?.summary} />
                    </div>
                </section>
            </Show>

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
                            <th class="p-3">{rangeLabel()} CPL</th>
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
                                    <td class="p-3">₹{row.cpl}</td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
            </div>

            {/* ================= Lead Quality Insights ================= */}
            <h3 class="mt-8 mb-4 text-lg font-semibold text-gray-800 dark:text-white">
                Lead Quality Insights
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

                {/* Total Leads */}
                <div class="p-4 rounded-lg bg-blue-50 dark:bg-gray-800 border border-blue-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
                    <div class="flex items-center justify-between">
                        <p class="text-sm text-gray-600 dark:text-gray-400">Total Leads</p>
                        <div class="p-2 bg-blue-100 dark:bg-blue-500 rounded">
                            <Users size={18} class="text-blue-500 dark:text-blue-100" />
                        </div>
                    </div>
                    <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">120</h3>
                </div>

                {/* Contacted */}
                <div class="p-4 rounded-lg bg-purple-50 dark:bg-gray-800 border border-purple-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
                    <div class="flex items-center justify-between">
                        <p class="text-sm text-gray-600 dark:text-gray-400">Contacted</p>
                        <div class="p-2 bg-purple-100 dark:bg-purple-500 rounded">
                            <PhoneCall size={18} class="text-purple-500 dark:text-purple-100" />
                        </div>
                    </div>
                    <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">95</h3>
                </div>
                {/* Qualified */}
                <div class="p-4 rounded-lg bg-green-50 dark:bg-gray-800 border border-green-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
                    <div class="flex items-center justify-between">
                        <p class="text-sm text-gray-600 dark:text-gray-400">Qualified</p>
                        <div class="p-2 bg-green-100 dark:bg-green-500 rounded">
                            <BadgeCheck size={18} class="text-green-500 dark:text-green-100" />
                        </div>
                    </div>
                    <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">60</h3>
                </div>

                {/* Site Visits */}
                <div class="p-4 rounded-lg bg-yellow-50 dark:bg-gray-800 border border-yellow-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
                    <div class="flex items-center justify-between">
                        <p class="text-sm text-gray-600 dark:text-gray-400">Site Visits</p>
                        <div class="p-2 bg-yellow-100 dark:bg-yellow-500 rounded">
                            <MapPin size={18} class="text-yellow-500 dark:text-yellow-100" />
                        </div>
                    </div>
                    <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">30</h3>
                </div>

                {/* Bookings */}
                <div class="p-4 rounded-lg bg-pink-50 dark:bg-gray-800 border border-pink-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
                    <div class="flex items-center justify-between">
                        <p class="text-sm text-gray-600 dark:text-gray-400">Bookings</p>
                        <div class="p-2 bg-pink-100 dark:bg-pink-500 rounded">
                            <Home size={18} class="text-pink-500 dark:text-pink-100" />
                        </div>
                    </div>
                    <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">12</h3>
                </div>

                {/* Conversion */}
                <div class="p-4 rounded-lg bg-emerald-50 dark:bg-gray-800 border border-emerald-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
                    <div class="flex items-center justify-between">
                        <p class="text-sm text-gray-600 dark:text-gray-400">Conversion %</p>
                        <div class="p-2 bg-emerald-100 dark:bg-emerald-500 rounded">
                            <TrendingUp size={18} class="text-emerald-500 dark:text-emerald-100" />
                        </div>
                    </div>
                    <h3 class="mt-2 text-xl font-semibold text-emerald-600 dark:text-emerald-400">
                        10%
                    </h3>
                </div>
            </div>


            {/* leads report */}
            <h3 class="mt-8 text-lg font-semibold text-gray-800 dark:text-white">
                Project Leads Report
            </h3>
            <div class="mt-4 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden  dark:bg-gray-900">
                <table class="w-full text-sm">
                    <thead class="border-b border-gray-200 dark:border-gray-700">
                        <tr class="text-md font-bold text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-800  ">

                            {[
                                "Total Leads",
                                "Follow Up / Interested",
                                "Delay in Feedback",
                                "Qualified Leads",
                                "Call Later / CNP",
                                "Not Interested",
                                "Broker",
                            ].map((head) => (
                                <th class="p-3 text-center whitespace-nowrap">
                                    {head}
                                </th>
                            ))}

                        </tr>
                    </thead>

                    {/*  VALUES */}
                    <tbody>
                        <tr class="text-center hover:bg-gray-50 dark:hover:bg-gray-800/40 transition">

                            {[
                                115,
                                40,
                                17,
                                57,
                                31,
                                24,
                                3,
                            ].map((val) => (
                                <td class="p-3  text-gray-900 dark:text-gray-100">
                                    {val}
                                </td>
                            ))}

                        </tr>
                    </tbody>

                </table>
            </div>


            {/* Payment report */}
            <h3 class="mt-8 text-lg font-semibold text-gray-800 dark:text-white">
                Project Payment Report
            </h3>
            <div class="mt-8 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="border-b border-gray-200 dark:border-gray-700">
                            <tr class="text-gray-800 dark:text-gray-300 text-md bg-gray-100 dark:bg-gray-800">
                                <th class="px-4 py-3 text-left">Metric</th>
                                <th class="px-4 py-3 text-center">Birla 1</th>
                                <th class="px-4 py-3 text-center">Birla 2</th>
                                <th class="px-4 py-3 text-center">Birla 3</th>
                                <th class="px-4 py-3 text-center">Birla 4</th>
                                <th class="px-4 py-3 text-center">Birla 5</th>
                                <th class="px-4 py-3 text-center">Total</th>
                            </tr>
                        </thead>

                        <tbody class="[&_tr]:border-b [&_tr]:border-gray-200 dark:[&_tr]:border-gray-700">

                            {[
                                ["Total Leads Generated", 40, 93, 20, 67, 32, 120],
                                ["Average CPL", 251, 210, 150, 320, 300, 300],
                                ["Total Spent Amount", 10049, 19571, 17324, 21000, 1567, 80000],
                                ["Total Qualified Leads", 21, 29, 45, 30, 55, "-"],
                                ["Follow ups / Interested", 22, 39, 65, 70, 15, "-"],
                                ["Delay in Feedback", 14, 22, 39, 65, 70, "-"],
                                ["Not Interested", 20, 42, 29, 25, 50, "-"],
                                ["Call Not Picked / Call Later", 25, 22, 32, 49, 35, "-"],
                                ["Broker", 17, 65, 32, 32, 49, "-"],
                            ].map((row) => {
                                const Icon = metricIcons[row[0]];

                                return (
                                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition">

                                        {/*  Metric with Icon */}
                                        <td class="px-4 py-3">
                                            <div class="flex items-center gap-2 text-gray-700 dark:text-gray-300 font-medium">

                                                {Icon && (
                                                    <Icon class="w-4 h-4 text-gray-500 dark:text-gray-400" />
                                                )}

                                                {row[0]}
                                            </div>
                                        </td>

                                        {/* Values */}
                                        <td class="px-4 py-3 text-center text-gray-800 dark:text-gray-200">
                                            {row[1]}
                                        </td>
                                        <td class="px-4 py-3 text-center text-gray-800 dark:text-gray-200">
                                            {row[2]}
                                        </td>
                                        <td class="px-4 py-3 text-center text-gray-800 dark:text-gray-200">
                                            {row[3]}
                                        </td>
                                        <td class="px-4 py-3 text-center text-gray-800 dark:text-gray-200">
                                            {row[4]}
                                        </td>
                                        <td class="px-4 py-3 text-center text-gray-800 dark:text-gray-200">
                                            {row[5]}
                                        </td>
                                        <td class="px-4 py-3 text-center font-semibold text-gray-900 dark:text-gray-100">
                                            {row[6]}
                                        </td>

                                    </tr>
                                );
                            })}

                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

/* ================= SMALL COMPONENTS ================= */

function Info(props) {
    return (
        <div>
            <p class="text-sm text-gray-400">{props.label}</p>
            <p class="font-medium">{props.value}</p>
        </div>
    );
}
