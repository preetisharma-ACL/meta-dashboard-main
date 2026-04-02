import { For, Show, createSignal, createMemo } from "solid-js";
import Swal from "sweetalert2";
import godrejlogo from "../assets/project-logo/dlf.png";
import birlalogo from "../assets/project-logo/godrej.png";
import prestigelogo from "../assets/project-logo/prestige.png";
import { A, } from "@solidjs/router";
import { DateRangeFilter } from "../components/DateRangeFilter";
export default function ClientDashboard() {

    const [statusFilter, setStatusFilter] = createSignal("all");
    const [searchText, setSearchText] = createSignal("");
    const [showColumnFilter, setShowColumnFilter] = createSignal(false);
    const [selectedColumns, setSelectedColumns] = createSignal([]);
    const [sortType, setSortType] = createSignal("");
    const [fromDate, setFromDate] = createSignal("");
    const [toDate, setToDate] = createSignal("");

    const [viewType, setViewType] = createSignal("table"); // "grid" | "table"
    const storedProjects =
        JSON.parse(localStorage.getItem("projects")) || [];
    const [projects, setProjects] = createSignal([
        ...storedProjects,
        {
            id: 1,
            name: "Birla Trimaya",
            logo: birlalogo,
            location: "Bangalore",
            budget: 100000,
            leadsgenerated: 10,
            type: "Residential",
            uploaddocument: null,
            activeCampaigns: 3,
            pausedCampaigns: 1,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 2,
            name: "Prestige Lakeside",
            logo: prestigelogo,
            location: "Bangalore",
            budget: 95000,
            leadsgenerated: 10,
            type: "Residential",
            uploaddocument: null,
            activeCampaigns: 2,
            pausedCampaigns: 2,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 3,
            name: "Sobha Dream Acres",
            logo: birlalogo,
            location: "Bangalore",
            budget: 85000,
            leadsgenerated: 10,
            type: "Residential",
            uploaddocument: null,
            activeCampaigns: 1,
            pausedCampaigns: 2,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 4,
            name: "Godrej Properties",
            logo: godrejlogo,
            location: "Bangalore",
            budget: 98000,
            leadsgenerated: 10,
            type: "Residential",
            uploaddocument: null,
            activeCampaigns: 1,
            pausedCampaigns: 1,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 5,
            name: "DLF Luxury Homes",
            logo: prestigelogo,
            location: "Bangalore",
            budget: 90000,
            leadsgenerated: 10,
            type: "Residential",
            uploaddocument: null,
            activeCampaigns: 1,
            pausedCampaigns: 2,
            status: "paused",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 6,
            name: "Brigade Orchards",
            logo: birlalogo,
            location: "Bangalore",
            budget: 92000,
            leadsgenerated: 10,
            type: "Residential",
            uploaddocument: null,
            activeCampaigns: 1,
            pausedCampaigns: 2,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
    ]);


    const campaignsData = [
        {
            campaign_name: "Birla 1",
            spent: 34890,
            leadsByDate: {
                "2026-02-05": 12,
                "2026-02-14": 8,
                "2026-02-12": 5
            }
        },
        {
            campaign_name: "Birla 2",
            spent: 34890,
            leadsByDate: {
                "2026-02-13": 20,
                "2026-02-15": 20,
                "2026-02-14": 10
            }
        },
        {
            campaign_name: "Birla 3",
            spent: 34890,
            leadsByDate: {
                "2026-02-13": 20,
                "2026-02-15": 20,
                "2026-02-14": 10
            }
        },
        {
            campaign_name: "Birla 4",
            spent: 34890,
            leadsByDate: {
                "2026-02-13": 20,
                "2026-02-15": 20,
                "2026-02-14": 10
            }
        },
        {
            campaign_name: "Birla 5",
            spent: 34890,
            leadsByDate: {
                "2026-02-13": 20,
                "2026-02-15": 20,
                "2026-02-14": 10
            }
        },
        {
            campaign_name: "Birla 6",
            spent: 34890,
            leadsByDate: {
                "2026-02-13": 20,
                "2026-02-15": 20,
                "2026-02-14": 10
            }
        }
    ]

    const normalizeLocalDate = (d) => {
        const date = new Date(d);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    };

    const getLeadsInRange = (leadsByDate, from, to) => {

        if (!from || !to) return 0;

        const start = normalizeLocalDate(from);
        const end = normalizeLocalDate(to);

        return Object.entries(leadsByDate || {}).reduce(
            (total, [date, leads]) => {

                const current = normalizeLocalDate(date);

                return current >= start && current <= end
                    ? total + leads
                    : total;

            }, 0)

    }

    const dashboardStats = createMemo(() => {

        let totalLeads = 0
        let totalSpent = 0

        campaignsData.forEach(campaign => {

            const leads = getLeadsInRange(
                campaign.leadsByDate,
                fromDate(),
                toDate()
            )

            totalLeads += leads
            totalSpent += campaign.spent

        })

        const avgCPL =
            totalLeads > 0
                ? Math.round(totalSpent / totalLeads)
                : 0

        return {
            totalLeads,
            totalSpent,
            avgCPL
        }

    })

    const handlePriorityChange = (id, value) => {
        setProjects(prev =>
            prev.map(p =>
                p.id === id ? { ...p, priority: value } : p
            )
        );
    };

    const handleClientControlRequest = (id, value) => {
        Swal.fire({
            title: "Are you sure?",
            text: `You want to ${value} this project.`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#16a34a",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes, Send Request"
        }).then((result) => {
            if (result.isConfirmed) {
                Swal.fire(
                    "Request Sent!",
                    "Campaign team will review it.",
                    "success"
                );
            }
        });
    };
    const filteredProjects = createMemo(() => {
        let data = [...projects()];

        // STATUS FILTER
        if (statusFilter() !== "all") {
            data = data.filter(p => p.status === statusFilter());
        }

        // SEARCH FILTER
        if (searchText()) {
            data = data.filter(p =>
                p.name.toLowerCase().includes(searchText().toLowerCase())
            );
        }

        // SORTING
        switch (sortType()) {
            case "budget":
                data.sort((a, b) => b.budget - a.budget);
                break;

            case "leads":
                data.sort((a, b) => b.leadsgenerated - a.leadsgenerated);
                break;

            case "activeCampaigns":
                data.sort((a, b) => b.activeCampaigns - a.activeCampaigns);
                break;

            // case "budgetPerCPL":
            //     data.sort((a, b) => (b.budget / b.cpl) - (a.budget / a.cpl));
            //     break;

            case "cplHigh":
                data.sort((a, b) => b.cpl - a.cpl);
                break;

            case "cplLow":
                data.sort((a, b) => a.cpl - b.cpl);
                break;
        }

        return data;
    });
    const handleClearFilters = () => {
        setStatusFilter("all");
        setSearchText("");
        setSortType("");
        setSelectedColumns([]);
        setFromDate("");
        setToDate("");
    };

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
    return (
        <section class="w-full px-4 sm:px-6 lg:px-8 py-6">

            {/* Section Header */}
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
                <div>
                    <h1 class="text-2xl md:text-2xl font-semibold mb-1"> Active Projects</h1>
                    <p class="text-md text-gray-700 dark:text-gray-400"> All projects with live marketing campaigns.</p>
                    
                </div>
                <div class="flex items-center gap-2">
                    {/* Add New Project Button */}
                    <A
                        href="/add-project"
                        class="bg-blue-900 hover:bg-blue-800 transition-all text-white px-4 py-2 rounded-lg text-sm font-medium shadow"
                    >
                        + Add New Project
                    </A>
                    {/* <button
                        onClick={() => setViewType("table")}
                        class={`p-2 rounded-lg border ${viewType() === "table"
                            ? "bg-green-600 text-white"
                            : "bg-white text-gray-600"
                            }`}
                        title="Table View"
                    >
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <line x1="4" y1="6" x2="20" y2="6" />
                            <line x1="4" y1="12" x2="20" y2="12" />
                            <line x1="4" y1="18" x2="20" y2="18" />
                        </svg>
                    </button> */}
                    {/* <button
                        onClick={() => setViewType("grid")}
                        class={`p-2 rounded-lg border ${viewType() === "grid"
                            ? "bg-green-600 text-white"
                            : "bg-white text-gray-600"
                            }`}
                        title="Grid View"
                    >
                        
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="7" height="7" rx="1" />
                            <rect x="14" y="3" width="7" height="7" rx="1" />
                            <rect x="3" y="14" width="7" height="7" rx="1" />
                            <rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                    </button> */}

                </div>

                {/* <div class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {activeProjects().length} Active
                </div> */}
            </div>

            {/* project Overview */}
            <div class="grid md:grid-cols-4 gap-6 mb-10">
                {/* Total Budget */}
                <div class="bg-blue-50  dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-blue-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-blue-800 dark:text-gray-400">Total Budget Allocated</p>
                        <h3 class="text-xl font-semibold mt-2 dark:text-white">₹1000</h3>
                    </div>
                    <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
                        <svg class="w-5 h-5 text-blue-600 dark:text-blue-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                    </div>
                </div>
                {/* Total Spend */}
                <div class="bg-red-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-red-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-red-800 dark:text-gray-400">Total Spend Till Date</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">30,000</h3>
                    </div>
                    <div class="p-3 rounded-lg bg-red-100 dark:bg-red-300">
                        <svg class="w-5 h-5 text-red-600 dark:text-red-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M17 9V7a5 5 0 00-10 0v2" />
                            <rect x="3" y="9" width="18" height="11" rx="2" />
                        </svg>
                    </div>
                </div>
                {/* Leads */}
                <div class="bg-green-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-green-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-green-800 dark:text-gray-400">Total Leads Generated</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">200</h3>
                    </div>
                    <div class="p-3 rounded-lg bg-green-100 dark:bg-green-300">
                        <svg class="w-5 h-5 text-green-600 dark:text-green-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                    </div>
                </div>
                {/* CPL */}
                <div class="bg-purple-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-purple-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-purple-800 dark:text-gray-400">Average CPL</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">212.20</h3>
                    </div>
                    <div class="p-3 rounded-lg bg-purple-100 dark:bg-purple-300">
                        <svg class="w-5 h-5 text-purple-600 dark:text-purple-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M3 3v18h18" />
                            <path d="M18 17l-5-5-4 4-3-3" />
                        </svg>
                    </div>
                </div>
            </div>
            <div class="grid md:grid-cols-4 gap-6 mb-10">
                {/* Active Campaigns */}
                <div class="bg-blue-50 dark:bg-gray-800 px-3 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-blue-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-blue-800 dark:text-gray-400">Active Campaigns Count</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">12</h3>
                    </div>
                    <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
                        <svg class="w-5 h-5 text-blue-600 dark:text-blue-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 3" />
                        </svg>
                    </div>
                </div>
                {/* Project Status */}
                <div class="bg-red-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-red-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-red-800 dark:text-gray-400">Project Status</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">Running</h3>
                    </div>
                    <div class="p-3 rounded-lg bg-red-100 dark:bg-red-300">
                        <svg class="w-5 h-5 text-red-600 dark:text-red-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-3 mb-4">
                {/* ALL DROPDOWN */}
                <select
                    class="border px-3 py-2 rounded-lg bg-white dark:bg-gray-800"
                    value={statusFilter()}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="all">All</option>
                    <option value="active">Active Project</option>
                    <option value="paused">Paused Project</option>
                </select>

                {/* SEARCH INPUT */}
                <input
                    type="text"
                    placeholder="Search project..."
                    value={searchText()}
                    onInput={(e) => setSearchText(e.target.value)}
                    class="border px-3 py-2 rounded-lg w-60 dark:bg-gray-800"
                />

                {/* SORT DROPDOWN */}
                <select
                    class="border px-3 py-2 rounded-lg dark:bg-gray-800"
                    value={sortType()}
                    onChange={(e) => setSortType(e.target.value)}
                >
                    <option value="">Sort By</option>
                    <option value="budget">Budget High → Low</option>
                    <option value="leads">Leads High → Low</option>
                    <option value="activeCampaigns">Number Of Active Campaigns</option>
                    {/* <option value="budgetPerCPL">Budget ÷ CPL</option> */}
                    <option value="cplHigh">CPL High → Low</option>
                    <option value="cplLow">CPL Low → High</option>
                </select>

                <DateRangeFilter
                    fromDate={fromDate}
                    toDate={toDate}
                    setFromDate={setFromDate}
                    setToDate={setToDate}
                />
                <button
                    onClick={handleClearFilters}
                    class="px-4 py-2 rounded-lg border bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-md font-medium transition"
                >
                    Reset
                </button>

                {/* THREE DOT */}
                {/* <button
                    class="border px-3 py-2 rounded-lg"
                    onClick={() => setShowColumnFilter(!showColumnFilter())}
                >
                    ⋮
                </button> */}
            </div>
            {/* <Show when={showColumnFilter()}>
                <div class="absolute bg-white dark:bg-gray-900 shadow-lg border rounded-lg p-4 z-50 w-60">
                    <p class="font-semibold mb-2">Select Columns</p>

                    {[
                        "location",
                        "type",
                        "status",
                        "budget",
                        "cpl",
                        "leadsgenerated",
                        "activeCampaigns",
                        "pausedCampaigns",
                    ].map((col) => (
                        <div class="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={selectedColumns().includes(col)}
                                onChange={(e) => {
                                    if (e.target.checked) {
                                        setSelectedColumns([...selectedColumns(), col]);
                                    } else {
                                        setSelectedColumns(
                                            selectedColumns().filter((c) => c !== col)
                                        );
                                    }
                                }}
                            />
                            <label class="text-sm capitalize">{col}</label>
                        </div>
                    ))}

                    <button
                        class="mt-3 bg-green-600 text-white px-3 py-1 rounded"
                        onClick={() => setShowColumnFilter(false)}
                    >
                        Apply
                    </button>
                </div>
            </Show> */}
            <Show
                when={viewType() === "grid"}
                fallback={
                    /* TABLE VIEW */
                    <div class="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border">
                        <table class="w-full text-sm table-auto">
                            <thead class="bg-purple-50 dark:bg-gray-800">
                                <tr class="[&_th]:text-center  [&_th]:whitespace-nowrap [&_th:first-child]:text-left text-purple-800 dark:text-gray-200">
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("name")}>
                                        <th class="p-3">Project Name</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("location")}>
                                        <th class="p-3">Location</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("type")}>
                                        <th class="p-3">Type</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("status")}>
                                        <th class="p-3">Status</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("uploaddocument")}>
                                        <th class="p-3">Uploaded Document</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("priority")}>
                                        <th class="p-3">Customer Priority</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("projectControl")}>
                                        <th class="p-3">Project Control</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("budget")}>
                                        <th class="p-3">Budget</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("cpl")}>
                                        <th class="p-3">{rangeLabel()} Total Leads</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("cpl")}>
                                        <th class="p-3">{rangeLabel()} Total Spent</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("cpl")}>
                                        <th class="p-3">{rangeLabel()} AVG CPL</th>
                                    </Show>
                                    {/* <Show when={selectedColumns().length === 0 || selectedColumns().includes("leadsgenerated")}>
                                        <th class="p-3">Leads Generated</th>
                                    </Show> */}
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("activeCampaigns")}>
                                        <th class="p-3">Active Campaigns</th>
                                    </Show>
                                    <Show when={selectedColumns().length === 0 || selectedColumns().includes("pausedCampaigns")}>
                                        <th class="p-3">Paused Campaigns</th>
                                    </Show>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={filteredProjects()}>
                                    {(project, index) => (
                                        <tr
                                            class={`
                                                border-t transition-all duration-300 ease-in-out
                                                [&_td]:text-center [&_td]:px-6 [&_td:first-child]:px-2
                                                [&_td]:whitespace-nowrap [&_td:first-child]:text-left
                                                ${index() % 2 === 0
                                                                            ? "bg-white dark:bg-gray-900"
                                                                            : "bg-purple-50/40 dark:bg-gray-900"}
                                                hover:bg-purple-100/40 dark:hover:bg-gray-800
                                            `}
                                        >
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("name")}>
                                                <td class="p-2 flex items-center gap-2">
                                                    <div class="rounded bg-purple-50 dark:bg-gray-200 p-1 px-1 min-w-max">
                                                        <img
                                                            src={project.logo || "/default-logo.png"}
                                                            class="w-10 h-10 object-fit"
                                                            alt="logo"
                                                        />
                                                    </div>
                                                    <A href={project.url} state={{ project }} class="text-purple-700 dark:text-purple-300 font-medium hover:underline transition">
                                                        {project.name}
                                                    </A>
                                                </td>
                                            </Show>
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("location")}>
                                                <td class="p-2">{project.location}</td>
                                            </Show>
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("type")}>
                                                <td class="p-2">{project.type}</td>
                                            </Show>
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("status")}>
                                                <td class="px-4 py-3">
                                                    <span class="px-3 py-1 text-sm rounded-full capitalize"
                                                        classList={{
                                                            "bg-green-100 text-green-700": project.status === "active",
                                                            "bg-yellow-100 text-yellow-700": project.status === "paused",
                                                            "bg-red-100 text-red-700": project.status === "stopped",
                                                        }}>
                                                        {project.status}
                                                    </span>
                                                </td>
                                            </Show>
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("uploaddocument")}>
                                                <td class="p-2">
                                                    <Show when={project.uploaddocument} fallback={<span class="text-gray-400">No File</span>}>
                                                        <a
                                                            href={project.uploaddocument}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            class="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                                                        >
                                                            View PDF
                                                        </a>
                                                    </Show>
                                                </td>
                                            </Show>
                                            {/* Priority Column */}
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("priority")}>
                                                <td class="p-2">
                                                    <select
                                                        class="border border-purple-200 dark:border-gray-600  rounded px-2 py-1 text-sm bg-purple-100 dark:bg-gray-800 min-w-max"
                                                        value={project.priority}
                                                        onChange={(e) =>
                                                            handlePriorityChange(project.id, e.target.value)
                                                        }
                                                    >
                                                        <option value="Urgent">Urgent</option>
                                                        <option value="High">High Priority</option>
                                                        <option value="Standard">Standard</option>
                                                    </select>
                                                </td>
                                            </Show>
                                            {/* Project Status Dropdown */}
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("status")}>
                                                <td class="p-2">
                                                    <select
                                                        class="border border-blue-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-blue-50 dark:bg-gray-800 min-w-max"
                                                        value={
                                                            project.status === "active"
                                                                ? "Live"
                                                                : project.status === "paused"
                                                                    ? "Temporary Pause"
                                                                    : "Stopped"
                                                        }
                                                        onChange={(e) =>
                                                            handleClientControlRequest(project.id, e.target.value)
                                                        }
                                                    >
                                                        <option value="Live">Live</option>
                                                        <option value="Temporary Pause">Temporary Pause</option>
                                                        <option value="Stopped">Stopped</option>
                                                    </select>
                                                </td>
                                            </Show>
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("budget")}>
                                                <td class="p-2">
                                                    ₹ {project.budget}
                                                </td>
                                            </Show>
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("totalLeads")}>
                                                <td class="p-2">
                                                    {dashboardStats().totalLeads}
                                                </td>
                                            </Show>
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("totalSpent")}>
                                                <td class="p-2">
                                                    ₹{dashboardStats().totalSpent.toLocaleString("en-IN")}
                                                </td>
                                            </Show>
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("avgCPL")}>
                                                <td class="p-2">
                                                    ₹{dashboardStats().avgCPL}
                                                </td>
                                            </Show>

                                            {/* <Show when={selectedColumns().length === 0 || selectedColumns().includes("cpl")}>
                                                <td class="p-2">{project.cpl}</td>
                                            </Show> */}
                                            {/* <Show when={selectedColumns().length === 0 || selectedColumns().includes("leadsgenerated")}>
                                                <td class="p-2">{project.leadsgenerated}</td>
                                            </Show> */}
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("activeCampaigns")}>
                                                <td class="p-2 text-center">
                                                    {project.activeCampaigns}
                                                </td>
                                            </Show>
                                            <Show when={selectedColumns().length === 0 || selectedColumns().includes("pausedCampaigns")}>
                                                <td class="p-2 text-center">
                                                    {project.pausedCampaigns}
                                                </td>
                                            </Show>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                }
            >
            </Show>

            {/* Empty State */}
            <Show when={projects().length === 0}>
                <div class="mt-8 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center">
                    <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                        No active projects found
                    </p>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Your live projects will appear here once campaigns are started
                    </p>
                </div>
            </Show>
        </section>
    );
}

