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
import { onMount, onCleanup } from "solid-js";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

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

    const [showNotifications, setShowNotifications] = createSignal(false);


    /* ================= FILTER STATES ================= */

    const [fromDate, setFromDate] = createSignal("");
    const [toDate, setToDate] = createSignal("");
    const [search, setSearch] = createSignal("");
    const [statusFilter, setStatusFilter] = createSignal("All");
    const [page, setPage] = createSignal(1);

    const rowsPerPage = 10;

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


    onMount(() => {
        const handleClickOutside = (e) => {
            if (!e.target.closest(".notification-wrapper")) {
                setShowNotifications(false);
            }
        };

        document.addEventListener("click", handleClickOutside);

        onCleanup(() => {
            document.removeEventListener("click", handleClickOutside);
        });
    });

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

    const suggestions = createMemo(() => {
        const result = [];

        const data = sortedCampaigns();

        data.forEach((campaign) => {
            // 1. Zero Leads
            if (campaign.totalLeads === 0) {
                result.push(`${campaign.campaign_name} has zero leads`);
            }

            // 2. High CPL
            if (campaign.cpl > 250) {
                result.push(`${campaign.campaign_name} CPL is high (₹${campaign.cpl}) - Need attention`);
            }

            // 3. Low performance suggestion
            if (campaign.totalLeads < 10 && campaign.cpl > 200) {
                result.push(`Improve performance in ${campaign.campaign_name}`);
            }

            // 4. Good campaign → suggest scaling
            if (campaign.totalLeads > 50 && campaign.cpl < 200) {
                result.push(` Increase budget in ${campaign.campaign_name}`);
            }

            // dummy logic
            if (campaign.cpl > 1.2 * 200) {
                result.push(` ${campaign.campaign_name} CPL increased significantly`);
            }
        });

        return result;
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

    async function downloadPDF(elementId, fileName) {
        const element = document.getElementById(elementId);

        const canvas = await html2canvas(element, {
            scale: 2,
            backgroundColor: "#ffffff",
        });

        const imgData = canvas.toDataURL("image/png");

        const pdf = new jsPDF("p", "mm", "a4");

        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);

        pdf.save(fileName);
    }
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
            <div class="flex justify-between">
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
                <div class="relative notification-wrapper">
                    <div class="flex justify-end items-center gap-4  relative">

                        <h3 class="text-lg font-semibold text-gray-800 dark:text-white">
                            Notifications & Recommendations
                        </h3>

                        <button
                            onClick={() => setShowNotifications(!showNotifications())}
                            class="relative p-2 m-2 rounded-full bg-blue-100 dark:bg-blue-800 hover:scale-105 transition"
                        >
                            {/* Bell SVG */}
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-blue-900 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14V11a6 6 0 10-12 0v3c0 .386-.149.735-.405 1.001L4 17h5m6 0a3 3 0 11-6 0h6z" />
                            </svg>

                            {/* Badge */}
                            <Show when={suggestions().length > 0}>
                                <span class="absolute -top-1 -right-1 bg-red-500 text-white text-xs px-1.5 rounded-full">
                                    {suggestions().length}
                                </span>
                            </Show>
                        </button>
                    </div>

                    <Show when={showNotifications()}>
                        <div class="absolute right-0 mt-3 w-90 bg-white dark:bg-gray-900 
              rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50">

                            {/* Header (RED like your image) */}
                            <div class="bg-blue-800 text-white px-4 py-3 rounded-t-xl flex justify-between items-center">
                                <span class="font-semibold">Notifications</span>
                                <span class="text-sm">
                                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </span>
                            </div>

                            {/* List */}
                            <div class="max-h-80 overflow-y-auto">

                                <For each={suggestions()}>
                                    {(item) => (
                                        <div class="flex items-start gap-3 px-4 py-3 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                                            {/* Avatar circle */}
                                            <div class="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-900 text-xs font-bold">
                                                B
                                            </div>

                                            {/* Content */}
                                            <div class="flex-1">
                                                <p class="text-sm text-gray-800 dark:text-gray-200">
                                                    {item}
                                                </p>
                                                <span class="text-xs text-gray-400">just now</span>
                                            </div>
                                        </div>
                                    )}
                                </For>
                            </div>

                            {/* Footer */}
                            <div class="text-center text-sm text-blue-500 py-2 hover:underline cursor-pointer">
                                See all recent activity
                            </div>
                        </div>
                    </Show>
                </div>
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
            <div class="flex justify-end gap-2 mt-4">
                <button
                    onClick={() => setPage(page() - 1)}
                    disabled={page() === 1}
                    class="px-3 py-1 border rounded"
                >
                    Prev
                </button>
                <button
                    onClick={() => setPage(page() + 1)}
                    disabled={page() * rowsPerPage >= sortedCampaigns().length}
                    class="px-3 py-1 border rounded"
                >
                    Next
                </button>
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
            <div class="flex items-center justify-between mt-8">
                <h3 class="text-lg font-semibold text-gray-800 dark:text-white">
                    Project Leads Report
                </h3>
                <button
                    onClick={() => downloadPDF("pdf-leads", "leads-report.pdf")}
                    class="flex items-center gap-2 px-4 py-2 rounded-lg 
                    bg-green-600 hover:bg-green-700 
                    text-white text-sm font-medium 
                    shadow-sm hover:shadow-md 
                    transition-all duration-200"
                >
                    {/* Download Icon */}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
                    </svg>
                    Download Report
                </button>

            </div>
            <div class="mt-4 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden  dark:bg-gray-900">
                <table class="w-full text-sm" id="leads-report">
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
            {/* pdf leads report start */}
            <div id="pdf-leads" style="position: absolute; left: -9999px; top: 0;">
                <div style="width: 950px; background: #fbfbfb; padding: 32px; font-family: 'Georgia', serif; position: relative; box-sizing: border-box;">

                    {/* Diagonal stripe texture overlay */}
                    <div style="position: absolute; inset: 0; background-image: repeating-linear-gradient(135deg, transparent, transparent 18px, rgba(255,255,255,0.015) 18px, rgba(255,255,255,0.015) 19px); pointer-events: none;" />

                    {/* Outer gold border frame */}
                    <div style="position: absolute; inset: 20px; border: 2.5px solid #C9A84C; border-radius: 10px; pointer-events: none;" />

                    {/* Inner gold thin border */}
                    <div style="position: absolute; inset: 30px; border: 0.8px solid #C9A84C; border-radius: 7px; pointer-events: none;" />

                    {/* Corner ornaments - Top Left */}
                    <div style="position: absolute; top: 20px; left: 20px; width: 40px; height: 40px; pointer-events: none;">
                        <div style="position: absolute; top: -1px; left: -1px; width: 22px; height: 3px; background: #C9A84C;" />
                        <div style="position: absolute; top: -1px; left: -1px; width: 3px; height: 22px; background: #C9A84C;" />
                        <div style="position: absolute; top: 6px; left: 6px; width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                    </div>

                    {/* Corner ornaments - Top Right */}
                    <div style="position: absolute; top: 20px; right: 20px; width: 40px; height: 40px; pointer-events: none;">
                        <div style="position: absolute; top: -1px; right: -1px; width: 22px; height: 3px; background: #C9A84C;" />
                        <div style="position: absolute; top: -1px; right: -1px; width: 3px; height: 22px; background: #C9A84C;" />
                        <div style="position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                    </div>

                    {/* Corner ornaments - Bottom Left */}
                    <div style="position: absolute; bottom: 20px; left: 20px; width: 40px; height: 40px; pointer-events: none;">
                        <div style="position: absolute; bottom: -1px; left: -1px; width: 22px; height: 3px; background: #C9A84C;" />
                        <div style="position: absolute; bottom: -1px; left: -1px; width: 3px; height: 22px; background: #C9A84C;" />
                        <div style="position: absolute; bottom: 6px; left: 6px; width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                    </div>

                    {/* Corner ornaments - Bottom Right */}
                    <div style="position: absolute; bottom: 20px; right: 20px; width: 40px; height: 40px; pointer-events: none;">
                        <div style="position: absolute; bottom: -1px; right: -1px; width: 22px; height: 3px; background: #C9A84C;" />
                        <div style="position: absolute; bottom: -1px; right: -1px; width: 3px; height: 22px; background: #C9A84C;" />
                        <div style="position: absolute; bottom: 6px; right: 6px; width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                    </div>

                    {/* Inner cream content area */}
                    <div style="position: relative; margin: 14px; background: #FDF8EE; border-radius: 6px; padding: 0 0 36px 0; overflow: hidden; z-index: 1;">
                        {/* ── HEADER BAND ── */}
                        <div style="background: #0A1628; padding: 28px 40px 22px; position: relative; overflow: hidden;">
                            {/* Header stripe texture */}
                            <div style="position: absolute; inset: 0; background-image: repeating-linear-gradient(135deg, transparent, transparent 18px, rgba(255,255,255,0.02) 18px, rgba(255,255,255,0.02) 19px);" />
                            {/* Gold top bar */}
                            <div style="position: absolute; top: 0; left: 0; right: 0; height: 5px; background: #C9A84C;" />
                            {/* Gold bottom bar */}
                            <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: #C9A84C;" />

                            {/* Tag line */}
                            {/* <p style="text-align: center; color: #d8b75b; font-size: 20px; font-family: 'Arial', sans-serif;  font-weight: bold; margin: 0 0 10px; text-transform: uppercase;">
                                Real Estate Analytics
                            </p> */}
                            <p style="text-align: center; color: #E8D5A3; font-size: 18px; font-family: 'Arial', sans-serif; margin: 0; letter-spacing: 1px;">
                                [Aajneeti Connect Ltd.]
                            </p>

                            {/* Main title */}
                            <h1 style="text-align: center; color: white; font-size: 32px; font-family: 'Georgia', serif; letter-spacing: 2px; margin: 0 0 8px; font-weight: bold; text-transform: uppercase;">
                                Project Leads Report
                            </h1>
                            {/* Date */}
                            <p style="text-align: center; color: #E8D5A3; font-size: 18px; font-family: 'Arial', sans-serif; margin: 0; letter-spacing: 1px;">
                                Generated on: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                            </p>
                        </div>
                        {/* ── CLIENT INFO BAND ── */}
                        <div style="background: #F5EDD8; padding: 15px 30px 15px; position: relative; border-bottom: 2px solid #C9A84C; border-top: 1px solid rgba(201,168,76,0.3);">
                            <div style="position: absolute; inset: 0; background-image: radial-gradient(circle, rgba(201,168,76,0.1) 1px, transparent 1px); background-size: 18px 18px; pointer-events: none;" />

                            <div style="position: relative; display: flex; align-items: center; gap: 0;">

                                {/* LEFT — client fields */}
                                <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px;">

                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color: #7A5C1E;  font-size: 12px; font-family: 'Arial', sans-serif; margin: 0;margin-bottom:2px; letter-spacing: 1px;">Client Name</span>
                                        <span style="flex: 1; height: 1px; background: rgba(201,168,76,0.4);" />
                                        <span style="color: #0A1628; font-size: 12px; font-family: Georgia; font-weight: bold;">ABC sdxd ddgdfhgh</span>
                                    </div>

                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color: #7A5C1E;  font-size: 12px; font-family: 'Arial', sans-serif; margin: 0;margin-bottom:2px; letter-spacing: 1px;">Company</span>
                                        <span style="flex: 1; height: 1px; background: rgba(201,168,76,0.4);" />
                                        <span style="color: #0A1628; font-size: 12px; font-family: Georgia; font-weight: bold;">ABC pvt ltd</span>
                                    </div>

                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color: #7A5C1E;  font-size: 12px; font-family: 'Arial', sans-serif; margin: 0;margin-bottom:2px; letter-spacing: 1px;">City</span>
                                        <span style="flex: 1; height: 1px; background: rgba(201,168,76,0.4);" />
                                        <span style="color: #0A1628; font-size: 12px; font-family: Georgia; font-weight: bold;">Greater Noida</span>
                                    </div>

                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color: #7A5C1E;  font-size: 12px; font-family: 'Arial', sans-serif; margin: 0;margin-bottom:2px; letter-spacing: 1px;">Mobile No</span>
                                        <span style="flex: 1; height: 1px; background: rgba(201,168,76,0.4);" />
                                        <span style="color: #0A1628; font-size: 12px; font-family: Georgia; font-weight: bold;">9292876787</span>
                                    </div>

                                </div>

                                {/* VERTICAL DIVIDER */}
                                <div style="width: 1px; background: linear-gradient(to bottom, transparent, #C9A84C, transparent); height: 60px; margin: 0 28px; flex-shrink: 0;" />

                                {/* RIGHT — project name badge */}
                                <div style="flex-shrink: 0; text-align: center;">
                                    <div style="display: inline-block; border: 1.5px solid #C9A84C; border-radius: 6px; padding: 10px 20px; background: white; position: relative; box-shadow: 2px 2px 0 #C9A84C;">
                                        <div style="position: absolute; top: 0; left: 12px; right: 12px; height: 2px; background: #C9A84C; border-radius: 2px;" />
                                        <div style="position: absolute; bottom: 0; left: 12px; right: 12px; height: 2px; background: #C9A84C; border-radius: 2px;" />
                                        <p style="color: #7A5C1E; font-size: 10px; font-family: Arial; font-weight: bold;  text-transform: uppercase; margin: 0 0 5px;">Project</p>
                                        <p style="color: #0A1628; font-size: 13px; font-family: Georgia; font-weight: bold; margin: 0;  white-space: nowrap;">Birla Estates Campaign</p>
                                    </div>
                                </div>

                            </div>
                        </div>
                        {/* ── DETAILED TABLE ── */}
                        <div style="padding: 24px 36px 0;">
                            {/* Section divider */}
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                                <div style="width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg); flex-shrink: 0;" />
                                <div style="flex: 1; height: 1px; background: #C9A84C; opacity: 0.4;" />
                                <div style="
                                            display:flex;
                                            align-items:center;
                                            justify-content:center;
                                            background:#0A1628;
                                            padding:6px 16px;
                                            border-radius:20px;
                                            height:28px;   /* IMPORTANT */
                                        ">
                                    <span style="
                                            color:#C9A84C;
                                            font-size:12px;
                                            font-family:Arial;
                                            font-weight:bold;
                                            line-height:1;   /* IMPORTANT */
                                            margin-bottom:12px;
                                        ">
                                        DETAILED BREAKDOWN
                                    </span>
                                </div>
                                <div style="flex: 1; height: 1px; background: #C9A84C; opacity: 0.4;" />
                                <div style="width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg); flex-shrink: 0;" />
                            </div>

                            {/* Table */}
                            <div style="border-radius: 8px; overflow: hidden; box-shadow: 4px 4px 0 #C8B89A; border: 1px solid #C9A84C;">
                                <table style="width: 100%; border-collapse: collapse; font-family: Arial;">
                                    <thead>
                                        <tr style="background: #0A1628;">
                                            <th style="padding: 11px 16px; text-align: left; color:   #C9A84C; padding-bottom:25px; font-size: 18px;   border-right: 1px solid rgba(201,168,76,0.2);">Category</th>
                                            <th style="padding: 11px 16px; text-align: center; color: #C9A84C; padding-bottom:25px; font-size: 18px;   border-right: 1px solid rgba(201,168,76,0.2);">Count</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            { cat: "Total Leads", count: 115, even: true },
                                            { cat: "Follow Up / Interested", count: 40, even: false },
                                            { cat: "Delay in Feedback	", count: 17, even: true },
                                            { cat: "Qualified Leads", count: 57, even: false },
                                            { cat: "Call Later / CNP", count: 31, even: true },
                                            { cat: "Not Interested", count: 24, even: false },
                                            { cat: "Broker", count: 3, even: true },
                                        ].map((row) => (
                                            <tr style={`background: ${row.even ? '#F5EDD8' : '#FDF8EE'};`}>
                                                <td style="padding: 10px 16px; align-items:center; padding-bottom:25px; font-size: 18px; font-weight: bold; color: #0A1628; border-right: 1px solid rgba(201,168,76,0.2); position: relative;">
                                                    <span style="position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: #C9A84C;" />
                                                    {row.cat}
                                                </td>
                                                <td style="padding: 10px 16px; text-align: center; padding-bottom:25px; font-size: 18px; font-weight: bold; color: #1E3A5F; border-right: 1px solid rgba(201,168,76,0.2);">{row.count}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* ── FOOTER ── */}
                        <div style="margin: 28px 36px 0; padding-top: 16px; border-top: 1px solid rgba(201,168,76,0.4); display: flex; align-items: center; justify-content: space-between;">
                            <div style="width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                            <p style="color: #645132; font-size: 12px; font-family: Arial; letter-spacing: 1.5px; text-align: center; margin: 0; text-transform: uppercase;">
                                © 2026 Project Analytics
                            </p>
                            <div style="width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                        </div>
                    </div>
                </div>
            </div>
            {/* pdf leads report end */}


            {/* Payment report */}
            <div class="flex items-center justify-between mt-8">
                <h3 class="text-lg font-semibold text-gray-800 dark:text-white">
                    Project Payment Report
                </h3>
                <button
                    onClick={() => downloadPDF("pdf-budget", "payment-report.pdf")}
                    class="flex items-center gap-2 px-4 py-2 rounded-lg 
                        bg-green-600 hover:bg-green-700 
                        text-white text-sm font-medium 
                        shadow-sm hover:shadow-md 
                        transition-all duration-200"
                >
                    {/* Download Icon */}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
                    </svg>
                    Download Report
                </button>
            </div>
            <div class="mt-8 rounded-xl overflow-hidden border border-amber-200/60 dark:border-gray-700 ">
                <div class="overflow-x-auto">
                    <table class="w-full text-sm" id="budget-report">
                        <thead>
                            <tr class="bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200">
                                <th class="px-5 py-4 text-left font-bold text-md   whitespace-nowrap">
                                    <div class="flex items-center gap-2">
                                       
                                        Metric
                                    </div>
                                </th>

                                <th class="px-5 py-4 text-center font-bold text-md   whitespace-nowrap">Birla 1</th>
                                <th class="px-5 py-4 text-center font-bold text-md   whitespace-nowrap">Birla 2</th>
                                <th class="px-5 py-4 text-center font-bold text-md   whitespace-nowrap">Birla 3</th>
                                <th class="px-5 py-4 text-center font-bold text-md   whitespace-nowrap">Birla 4</th>
                                <th class="px-5 py-4 text-center font-bold text-md   whitespace-nowrap">Birla 5</th>

                                <th class="px-5 py-4 text-center font-bold text-md  text-gray-900 dark:text-gray-200 whitespace-nowrap bg-amber-900/20">
                                    Total
                                </th>
                            </tr>

                            {/* Gold accent line under header */}
                            <tr class="bg-amber-200 dark:bg-gray-700">
                                <td colspan="7" class="h-[1px] p-0"></td>
                            </tr>
                        </thead> 

                        <tbody>
                            {[
                                ["Total Leads Generated", 40, 93, 20, 17324, 32, 120],
                                ["Average CPL", 251, 210, 150, 320, 300, 300],
                                ["Total Spent Amount", 10049, 19571, 17324, 21000, 1567, 80000],
                                ["Total Qualified Leads", 21, 29, 45, 30, 55, "-"],
                                ["Follow ups / Interested", 22, 39, 65, 70, 15, "-"],
                                ["Delay in Feedback", 14, 22, 39, 65, 70, "-"],
                                ["Not Interested", 20, 42, 29, 25, 50, "-"],
                                ["Call Not Picked / Call Later", 25, 22, 32, 49, 35, "-"],
                                ["Broker", 17, 65, 32, 32, 49, "-"],
                            ].map((row, i) => {
                                const Icon = metricIcons[row[0]];
                                const isEven = i % 2 === 0;

                                return (
                                    <tr class={`
                            border-b border-amber-100 dark:border-amber-900/20
                            transition-colors duration-150
                            hover:bg-amber-50 dark:hover:bg-amber-900/10
                            ${isEven
                                            ? 'bg-gray-50 dark:bg-gray-900'
                                            : 'bg-[#FBF7ED] dark:bg-gray-800/60'
                                        }
                        `}>

                                        {/* Metric with icon */}
                                        <td class="px-5 py-3.5 ">
                                            <div class="flex items-center gap-2.5">
                                              
                                               

                                                {Icon && (
                                                    <Icon class="w-4 h-4 text-[#C9A84C] dark:text-amber-500 flex-shrink-0" />
                                                )}

                                                <span class="font-semibold text-[#0A1628] dark:text-gray-200 text-sm whitespace-nowrap">
                                                    {row[0]}
                                                </span>
                                            </div>
                                        </td>

                                        {/* Birla 1 */}
                                        <td class="px-5 py-3.5 text-center text-[#1E3A5F] dark:text-gray-200 font-medium ">
                                            {row[1]}
                                        </td>

                                        {/* Birla 2 */}
                                        <td class="px-5 py-3.5 text-center text-[#1E3A5F] dark:text-gray-200 font-medium ">
                                            {row[2]}
                                        </td>

                                        {/* Birla 3 */}
                                        <td class="px-5 py-3.5 text-center text-[#1E3A5F] dark:text-gray-200 font-medium ">
                                            {row[3]}
                                        </td>

                                        {/* Birla 4 */}
                                        <td class="px-5 py-3.5 text-center text-[#1E3A5F] dark:text-gray-200 font-medium ">
                                            {row[4]}
                                        </td>

                                        {/* Birla 5 */}
                                        <td class="px-5 py-3.5 text-center text-[#1E3A5F] dark:text-gray-200 font-medium ">
                                            {row[5]}
                                        </td>

                                        {/* Total — gold highlighted column */}
                                        <td class="px-5 py-3.5 text-center font-bold text-[#7A5C1E] dark:text-amber-400 bg-amber-50/80 dark:bg-amber-900/10">
                                            {row[6]}
                                        </td>

                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* pdf payment report start */}
            <div id="pdf-budget" style="position: absolute; left: -9999px; top: 0;">
                <div style="width: 950px; background: #fbfbfb; padding: 32px; font-family: 'Georgia', serif; position: relative; box-sizing: border-box;">

                    {/* Diagonal stripe texture overlay */}
                    <div style="position: absolute; inset: 0; background-image: repeating-linear-gradient(135deg, transparent, transparent 18px, rgba(255,255,255,0.015) 18px, rgba(255,255,255,0.015) 19px); pointer-events: none;" />

                    {/* Outer gold border frame */}
                    <div style="position: absolute; inset: 20px; border: 2.5px solid #C9A84C; border-radius: 10px; pointer-events: none;" />

                    {/* Inner gold thin border */}
                    <div style="position: absolute; inset: 30px; border: 0.8px solid #C9A84C; border-radius: 7px; pointer-events: none;" />

                    {/* Corner ornaments - Top Left */}
                    <div style="position: absolute; top: 20px; left: 20px; width: 40px; height: 40px; pointer-events: none;">
                        <div style="position: absolute; top: -1px; left: -1px; width: 22px; height: 3px; background: #C9A84C;" />
                        <div style="position: absolute; top: -1px; left: -1px; width: 3px; height: 22px; background: #C9A84C;" />
                        <div style="position: absolute; top: 6px; left: 6px; width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                    </div>

                    {/* Corner ornaments - Top Right */}
                    <div style="position: absolute; top: 20px; right: 20px; width: 40px; height: 40px; pointer-events: none;">
                        <div style="position: absolute; top: -1px; right: -1px; width: 22px; height: 3px; background: #C9A84C;" />
                        <div style="position: absolute; top: -1px; right: -1px; width: 3px; height: 22px; background: #C9A84C;" />
                        <div style="position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                    </div>

                    {/* Corner ornaments - Bottom Left */}
                    <div style="position: absolute; bottom: 20px; left: 20px; width: 40px; height: 40px; pointer-events: none;">
                        <div style="position: absolute; bottom: -1px; left: -1px; width: 22px; height: 3px; background: #C9A84C;" />
                        <div style="position: absolute; bottom: -1px; left: -1px; width: 3px; height: 22px; background: #C9A84C;" />
                        <div style="position: absolute; bottom: 6px; left: 6px; width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                    </div>

                    {/* Corner ornaments - Bottom Right */}
                    <div style="position: absolute; bottom: 20px; right: 20px; width: 40px; height: 40px; pointer-events: none;">
                        <div style="position: absolute; bottom: -1px; right: -1px; width: 22px; height: 3px; background: #C9A84C;" />
                        <div style="position: absolute; bottom: -1px; right: -1px; width: 3px; height: 22px; background: #C9A84C;" />
                        <div style="position: absolute; bottom: 6px; right: 6px; width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                    </div>

                    {/* Inner cream content area */}
                    <div style="position: relative; margin: 14px; background: #FDF8EE; border-radius: 6px; padding: 0 0 36px 0; overflow: hidden; z-index: 1;">

                        {/* ── HEADER BAND ── */}
                        <div style="background: #0A1628; padding: 28px 40px 22px; position: relative; overflow: hidden;">
                            <div style="position: absolute; inset: 0; background-image: repeating-linear-gradient(135deg, transparent, transparent 18px, rgba(255,255,255,0.02) 18px, rgba(255,255,255,0.02) 19px);" />
                            <div style="position: absolute; top: 0; left: 0; right: 0; height: 5px; background: #C9A84C;" />
                            <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: #C9A84C;" />

                            <p style="text-align: center; color: #E8D5A3; font-size: 18px; font-family: 'Arial', sans-serif; margin: 0 0 6px; letter-spacing: 1px;">
                                [Aajneeti Connect Ltd.]
                            </p>
                            <h1 style="text-align: center; color: white; font-size: 32px; font-family: 'Georgia', serif; letter-spacing: 2px; margin: 0 0 8px; font-weight: bold; text-transform: uppercase;">
                                Payment Report
                            </h1>
                            <p style="text-align: center; color: #E8D5A3; font-size: 18px; font-family: 'Arial', sans-serif; margin: 0; letter-spacing: 1px;">
                                Generated on: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                            </p>
                        </div>

                        {/* ── CLIENT INFO BAND ── */}
                        <div style="background: #F5EDD8; padding: 15px 30px 15px; position: relative; border-bottom: 2px solid #C9A84C; border-top: 1px solid rgba(201,168,76,0.3);">
                            <div style="position: absolute; inset: 0; background-image: radial-gradient(circle, rgba(201,168,76,0.1) 1px, transparent 1px); background-size: 18px 18px; pointer-events: none;" />

                            <div style="position: relative; display: flex; align-items: center; gap: 0;">

                                {/* LEFT — client fields */}
                                <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px;">

                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color: #7A5C1E; font-size: 12px; font-family: 'Arial', sans-serif; margin: 0; letter-spacing: 1px;">Client Name</span>
                                        <span style="flex: 1; height: 1px; background: rgba(201,168,76,0.4);" />
                                        <span style="color: #0A1628; font-size: 12px; font-family: Georgia; font-weight: bold;">ABC sdxd ddgdfhgh</span>
                                    </div>

                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color: #7A5C1E; font-size: 12px; font-family: 'Arial', sans-serif; margin: 0; letter-spacing: 1px;">Company</span>
                                        <span style="flex: 1; height: 1px; background: rgba(201,168,76,0.4);" />
                                        <span style="color: #0A1628; font-size: 12px; font-family: Georgia; font-weight: bold;">ABC pvt ltd</span>
                                    </div>

                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color: #7A5C1E; font-size: 12px; font-family: 'Arial', sans-serif; margin: 0; letter-spacing: 1px;">City</span>
                                        <span style="flex: 1; height: 1px; background: rgba(201,168,76,0.4);" />
                                        <span style="color: #0A1628; font-size: 12px; font-family: Georgia; font-weight: bold;">Greater Noida</span>
                                    </div>

                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color: #7A5C1E; font-size: 12px; font-family: 'Arial', sans-serif; margin: 0; letter-spacing: 1px;">Mobile No</span>
                                        <span style="flex: 1; height: 1px; background: rgba(201,168,76,0.4);" />
                                        <span style="color: #0A1628; font-size: 12px; font-family: Georgia; font-weight: bold;">9292876787</span>
                                    </div>

                                </div>

                                {/* VERTICAL DIVIDER */}
                                <div style="width: 1px; background: linear-gradient(to bottom, transparent, #C9A84C, transparent); height: 60px; margin: 0 28px; flex-shrink: 0;" />

                                {/* RIGHT — project name badge */}
                                <div style="flex-shrink: 0; text-align: center;">
                                    <div style="display: inline-block; border: 1.5px solid #C9A84C; border-radius: 6px; padding: 10px 20px; background: white; position: relative; box-shadow: 2px 2px 0 #C9A84C;">
                                        <div style="position: absolute; top: 0; left: 12px; right: 12px; height: 2px; background: #C9A84C; border-radius: 2px;" />
                                        <div style="position: absolute; bottom: 0; left: 12px; right: 12px; height: 2px; background: #C9A84C; border-radius: 2px;" />
                                        <p style="color: #7A5C1E; font-size: 10px; font-family: Arial; font-weight: bold; text-transform: uppercase; margin: 0 0 5px;">Project</p>
                                        <p style="color: #0A1628; font-size: 13px; font-family: Georgia; font-weight: bold; margin: 0; white-space: nowrap;">Birla Estates </p>
                                    </div>
                                </div>

                            </div>
                        </div>

                        {/* ── DETAILED TABLE ── */}
                        <div style="padding: 24px 36px 0;">

                            {/* Section divider */}
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                                <div style="width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg); flex-shrink: 0;" />
                                <div style="flex: 1; height: 1px; background: #C9A84C; opacity: 0.4;" />
                                <div style="display: flex; align-items: center; justify-content: center; background: #0A1628; padding: 6px 16px; border-radius: 20px; height: 28px;">
                                    <span style="color: #C9A84C; font-size: 12px; font-family: Arial; margin-bottom:12px; font-weight: bold; line-height: 1;">
                                        CAMPAIGN PERFORMANCE BREAKDOWN
                                    </span>
                                </div>
                                <div style="flex: 1; height: 1px; background: #C9A84C; opacity: 0.4;" />
                                <div style="width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg); flex-shrink: 0;" />
                            </div>

                            {/* Table */}
                            <div style="border-radius: 8px; overflow: hidden; box-shadow: 4px 4px 0 #C8B89A; border: 1px solid #C9A84C;">
                                <table style="width: 100%; border-collapse: collapse; font-family: Arial;">
                                    <thead>
                                        <tr style="background: #0A1628;">
                                            <th style="padding: 12px 16px 20px; text-align: left;   color: #C9A84C; font-size: 14px; border-right: 1px solid rgba(201,168,76,0.2); white-space: nowrap;">Metric</th>
                                            <th style="padding: 12px 16px 20px; text-align: center; color: #C9A84C; font-size: 14px; border-right: 1px solid rgba(201,168,76,0.2); white-space: nowrap;">Birla 1</th>
                                            <th style="padding: 12px 16px 20px; text-align: center; color: #C9A84C; font-size: 14px; border-right: 1px solid rgba(201,168,76,0.2); white-space: nowrap;">Birla 2</th>
                                            <th style="padding: 12px 16px 20px; text-align: center; color: #C9A84C; font-size: 14px; border-right: 1px solid rgba(201,168,76,0.2); white-space: nowrap;">Birla 3</th>
                                            <th style="padding: 12px 16px 20px; text-align: center; color: #C9A84C; font-size: 14px; border-right: 1px solid rgba(201,168,76,0.2); white-space: nowrap;">Birla 4</th>
                                            <th style="padding: 12px 16px 20px; text-align: center; color: #C9A84C; font-size: 14px; border-right: 1px solid rgba(201,168,76,0.2); white-space: nowrap;">Birla 5</th>
                                            <th style="padding: 12px 16px 20px; text-align: center; color: #E8D5A3; font-size: 14px; white-space: nowrap;">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            { metric: "Total Leads Generated", b1: 40, b2: 93, b3: 20, b4: 67, b5: 32, total: 120, even: true },
                                            { metric: "Average CPL", b1: 251, b2: 210, b3: 150, b4: 320, b5: 300, total: 300, even: false },
                                            { metric: "Total Spent Amount", b1: 10049, b2: 19571, b3: 17324, b4: 21000, b5: 1567, total: 80000, even: true },
                                            { metric: "Total Qualified Leads", b1: 21, b2: 29, b3: 45, b4: 30, b5: 55, total: "—", even: false },
                                            { metric: "Follow Ups / Interested", b1: 22, b2: 39, b3: 65, b4: 70, b5: 15, total: "—", even: true },
                                            { metric: "Delay in Feedback", b1: 14, b2: 22, b3: 39, b4: 65, b5: 70, total: "—", even: false },
                                            { metric: "Not Interested", b1: 20, b2: 42, b3: 29, b4: 25, b5: 50, total: "—", even: true },
                                            { metric: "Call Not Picked / Call Later", b1: 25, b2: 22, b3: 32, b4: 49, b5: 35, total: "—", even: false },
                                            { metric: "Broker", b1: 17, b2: 65, b3: 32, b4: 32, b5: 49, total: "—", even: true },
                                        ].map((row) => (
                                            <tr style={`background: ${row.even ? '#F5EDD8' : '#FDF8EE'};`}>

                                                {/* Metric */}
                                                <td style="padding: 10px 16px 22px; font-size: 14px; font-weight: bold; color: #0A1628; border-right: 1px solid rgba(201,168,76,0.2); position: relative; white-space: nowrap;">
                                                    <span style="position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: #C9A84C;" />
                                                    {row.metric}
                                                </td>

                                                {/* Birla columns */}
                                                <td style="padding: 10px 16px 22px; text-align: center; font-size: 14px; font-weight: bold; color: #1E3A5F; border-right: 1px solid rgba(201,168,76,0.2);">{row.b1}</td>
                                                <td style="padding: 10px 16px 22px; text-align: center; font-size: 14px; font-weight: bold; color: #1E3A5F; border-right: 1px solid rgba(201,168,76,0.2);">{row.b2}</td>
                                                <td style="padding: 10px 16px 22px; text-align: center; font-size: 14px; font-weight: bold; color: #1E3A5F; border-right: 1px solid rgba(201,168,76,0.2);">{row.b3}</td>
                                                <td style="padding: 10px 16px 22px; text-align: center; font-size: 14px; font-weight: bold; color: #1E3A5F; border-right: 1px solid rgba(201,168,76,0.2);">{row.b4}</td>
                                                <td style="padding: 10px 16px 22px; text-align: center; font-size: 14px; font-weight: bold; color: #1E3A5F; border-right: 1px solid rgba(201,168,76,0.2);">{row.b5}</td>

                                                {/* Total — highlighted */}
                                                <td style="padding: 10px 16px 22px; text-align: center; font-size: 14px; font-weight: bold; color: #7A5C1E; background: rgba(201,168,76,0.12);">{row.total}</td>

                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* ── FOOTER ── */}
                        <div style="margin: 28px 36px 0; padding-top: 16px; border-top: 1px solid rgba(201,168,76,0.4); display: flex; align-items: center; justify-content: space-between;">
                            <div style="width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                            <p style="color: #604c2c; font-size: 12px; font-family: Arial; letter-spacing: 1.5px; text-align: center; margin: 0; text-transform: uppercase;">
                                © 2026 Project Analytics
                            </p>
                            <div style="width: 8px; height: 8px; background: #C9A84C; transform: rotate(45deg);" />
                        </div>

                    </div>
                </div>
            </div>
            {/* pdf payment report end */}
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
