import { For, Show, createSignal, createMemo } from "solid-js";
import { onMount } from "solid-js";
import Swal from "sweetalert2";
import godrejlogo from "../assets/project-logo/dlf.png";
import birlalogo from "../assets/project-logo/godrej.png";
import prestigelogo from "../assets/project-logo/prestige.png";
import { A } from "@solidjs/router";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { fetchProfiles } from "../services/dashboard";

export default function ClientDashboard() {

    const [statusFilter, setStatusFilter] = createSignal("all");
    const [searchText, setSearchText] = createSignal("");
    const [selectedColumns, setSelectedColumns] = createSignal([]);
    const [projects, setProjects] = createSignal([]);
    const [sortType, setSortType] = createSignal("");
    const [fromDate, setFromDate] = createSignal("");
    const [toDate, setToDate] = createSignal("");
    const [viewType, setViewType] = createSignal("table");

    const loadData = async () => {
        try {
            const data = await fetchProfiles();
            setProjects(
                (data?.data || []).map(item => ({
                    id: item.id,
                    name: item.name,
                    logo: item.logo || "/default-logo.png",
                    location: item.city,
                    budget: item.budget ?? item.budget ?? 0,
                    leadsgenerated: item.leads_generated ?? item.leadsgenerated ?? 0,
                    type: item.property_type ?? item.property_type ?? "N/A",
                    uploaddocument: item.upload_document ?? item.uploaddocument ?? null,
                    activeCampaigns: item.active_campaigns ?? item.activeCampaigns ?? 0,
                    pausedCampaigns: item.paused_campaigns ?? item.pausedCampaigns ?? 0,
                    status: item.status ?? "active",
                    clientRequest: item.client_request ?? null,
                    priority: item.priority_label ?? "Standard",
                    projectControl: item.project_control ?? "Live",
                    url: item.url ?? "/all-campaigns",
                    cpl: item.cpl ?? 0,
                    spent: item.total_spend ?? item.total_spend ?? 0,
                    leadsByDate: item.leads_by_date ?? item.leadsByDate ?? {},
                }))
            );
        } catch (err) {
            console.error(err);
        }
    };

    onMount(() => {
        loadData();
    });

    const normalizeLocalDate = (d) => {
        const date = new Date(d);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    };

    const getLeadsInRange = (leadsByDate, from, to) => {
        if (!from || !to) return 0;
        const start = normalizeLocalDate(from);
        const end = normalizeLocalDate(to);
        return Object.entries(leadsByDate || {}).reduce((total, [date, leads]) => {
            const current = normalizeLocalDate(date);
            return current >= start && current <= end ? total + leads : total;
        }, 0);
    };

    const getProjectStats = (project) => {
        const totalLeads = getLeadsInRange(project.leadsByDate, fromDate(), toDate());
        const totalSpent = project.spent ?? 0;
        const avgCPL = totalLeads > 0 ? Math.round(totalSpent / totalLeads) : 0;
        return { totalLeads, totalSpent, avgCPL };
    };

    const overviewStats = createMemo(() => {
        const all = projects();
        const totalBudget = all.reduce((s, p) => s + (p.budget ?? 0), 0);
        const totalSpent = all.reduce((s, p) => s + (p.spent ?? 0), 0);
        const totalLeads = all.reduce((s, p) => s + getLeadsInRange(p.leadsByDate, fromDate(), toDate()), 0);
        const avgCPL = totalLeads > 0 ? Math.round(totalSpent / totalLeads) : 0;
        const activeCampaigns = all.reduce((s, p) => s + (p.activeCampaigns ?? 0), 0);
        const activeProjects = all.filter(p => p.status === "active").length;
        return { totalBudget, totalSpent, totalLeads, avgCPL, activeCampaigns, activeProjects };
    });

    const filteredProjects = createMemo(() => {
        let data = [...projects()];

        if (statusFilter() !== "all") {
            data = data.filter(p => p.status === statusFilter());
        }

        if (searchText()) {
            data = data.filter(p =>
                (p.name ?? "").toLowerCase().includes(searchText().toLowerCase())
            );
        }

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
            case "cplHigh":
                data.sort((a, b) => b.cpl - a.cpl);
                break;
            case "cplLow":
                data.sort((a, b) => a.cpl - b.cpl);
                break;
        }

        return data;
    });

    const handlePriorityChange = (id, value) => {
        setProjects(prev =>
            prev.map(p => p.id === id ? { ...p, priority: value } : p)
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
                Swal.fire("Request Sent!", "Campaign team will review it.", "success");
            }
        });
    };

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
        from.setHours(0, 0, 0, 0);
        to.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
        if (diffDays === 1) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return from.getTime() === today.getTime() ? "Today" : "Yesterday";
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
                    <h1 class="text-2xl font-semibold mb-1">Active Projects</h1>
                    <p class="text-md text-gray-700 dark:text-gray-400">All projects with live marketing campaigns.</p>
                </div>
                <div class="flex items-center gap-2">
                    <A
                        href="/add-project"
                        class="bg-blue-900 hover:bg-blue-800 transition-all text-white px-4 py-2 rounded-lg text-sm font-medium shadow"
                    >
                        + Add New Project
                    </A>
                </div>
            </div>

            {/* Overview Cards Row 1 */}
            <div class="grid md:grid-cols-4 gap-6 mb-10">
                <div class="bg-blue-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-blue-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-blue-800 dark:text-gray-400">Total Budget Allocated</p>
                        <h3 class="text-xl font-semibold mt-2 dark:text-white">
                            {/* {"₹"}{overviewStats().totalBudget.toLocaleString("en-IN")} */}
                            500.00
                        </h3>
                    </div>
                    <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
                        <svg class="w-5 h-5 text-blue-600 dark:text-blue-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                    </div>
                </div>

                <div class="bg-red-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-red-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-red-800 dark:text-gray-400">Total Spend Till Date</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">
                            {"₹"}{overviewStats().totalSpent.toLocaleString("en-IN")}
                        </h3>
                    </div>
                    <div class="p-3 rounded-lg bg-red-100 dark:bg-red-300">
                        <svg class="w-5 h-5 text-red-600 dark:text-red-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M17 9V7a5 5 0 00-10 0v2" />
                            <rect x="3" y="9" width="18" height="11" rx="2" />
                        </svg>
                    </div>
                </div>

                <div class="bg-green-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-green-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-green-800 dark:text-gray-400">Total Leads Generated</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">
                            {overviewStats().totalLeads}
                        </h3>
                    </div>
                    <div class="p-3 rounded-lg bg-green-100 dark:bg-green-300">
                        <svg class="w-5 h-5 text-green-600 dark:text-green-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                    </div>
                </div>

                <div class="bg-purple-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-purple-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-purple-800 dark:text-gray-400">Average CPL</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">
                            {"₹"}{overviewStats().avgCPL.toLocaleString("en-IN")}
                        </h3>
                    </div>
                    <div class="p-3 rounded-lg bg-purple-100 dark:bg-purple-300">
                        <svg class="w-5 h-5 text-purple-600 dark:text-purple-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M3 3v18h18" />
                            <path d="M18 17l-5-5-4 4-3-3" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Overview Cards Row 2 */}
            <div class="grid md:grid-cols-4 gap-6 mb-10">
                <div class="bg-blue-50 dark:bg-gray-800 px-3 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-blue-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-blue-800 dark:text-gray-400">Active Campaigns Count</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">
                            {overviewStats().activeCampaigns}
                        </h3>
                    </div>
                    <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
                        <svg class="w-5 h-5 text-blue-600 dark:text-blue-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 3" />
                        </svg>
                    </div>
                </div>

                <div class="bg-red-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-red-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-red-800 dark:text-gray-400">Active Projects</p>
                        <h3 class="text-xl font-semibold mt-1 dark:text-white">
                            {overviewStats().activeProjects}
                        </h3>
                    </div>
                    <div class="p-3 rounded-lg bg-red-100 dark:bg-red-300">
                        <svg class="w-5 h-5 text-red-600 dark:text-red-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div class="flex flex-wrap items-center gap-3 mb-4">
                <select
                    class="border px-3 py-2 rounded-lg bg-white dark:bg-gray-800"
                    value={statusFilter()}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="all">All</option>
                    <option value="active">Active Project</option>
                    <option value="paused">Paused Project</option>
                </select>

                <input
                    type="text"
                    placeholder="Search project..."
                    value={searchText()}
                    onInput={(e) => setSearchText(e.target.value)}
                    class="border px-3 py-2 rounded-lg w-60 dark:bg-gray-800"
                />

                {/* ✅ No arrow characters — use plain text */}
                <select
                    class="border px-3 py-2 rounded-lg dark:bg-gray-800"
                    value={sortType()}
                    onChange={(e) => setSortType(e.target.value)}
                >
                    <option value="">Sort By</option>
                    <option value="budget">Budget: High to Low</option>
                    <option value="leads">Leads: High to Low</option>
                    <option value="activeCampaigns">Active Campaigns</option>
                    <option value="cplHigh">CPL: High to Low</option>
                    <option value="cplLow">CPL: Low to High</option>
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
            </div>

            {/* Table */}
            <Show
                when={viewType() === "grid"}
                fallback={
                    <div class="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border">
                        <table class="w-full text-sm table-auto">
                            <thead class="bg-gray-100 dark:bg-gray-800">
                                <tr class="[&_th]:text-center [&_th]:whitespace-nowrap [&_th:first-child]:text-left text-gray-800 dark:text-gray-200">
                                    <th class="p-3">Project Name</th>
                                    <th class="p-3">Location</th>
                                    <th class="p-3">Type</th>
                                    <th class="p-3">Status</th>
                                    <th class="p-3">Uploaded Document</th>
                                    <th class="p-3">Customer Priority</th>
                                    <th class="p-3">Project Control</th>
                                    <th class="p-3">Budget</th>
                                    <th class="p-3">{rangeLabel()} Total Leads</th>
                                    <th class="p-3">{rangeLabel()} Total Spent</th>
                                    <th class="p-3">{rangeLabel()} AVG CPL</th>
                                    <th class="p-3">Active Campaigns</th>
                                    <th class="p-3">Paused Campaigns</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* ✅ For callback with explicit return */}
                                <For each={filteredProjects()}>
                                    {(project, index) => {
                                        const stats = getProjectStats(project);
                                        return (
                                            <tr
                                                class={
                                                    "border-t transition-all duration-300 ease-in-out " +
                                                    "[&_td]:text-center [&_td]:px-6 [&_td:first-child]:px-2 " +
                                                    "[&_td]:whitespace-nowrap [&_td:first-child]:text-left " +
                                                    (index() % 2 === 0
                                                        ? "bg-white dark:bg-gray-900 "
                                                        : "bg-purple-50/40 dark:bg-gray-900 ") +
                                                    "hover:bg-purple-100/40 dark:hover:bg-gray-800"
                                                }
                                            >
                                                {/* Project Name */}
                                                <td class="p-2">
                                                    <div class="flex items-center gap-2">
                                                        <div class="rounded bg-purple-50 dark:bg-gray-200 p-1 min-w-max">
                                                            <img
                                                                src={project.logo}
                                                                class="w-10 h-10 object-contain"
                                                                alt="logo"
                                                            />
                                                        </div>
                                                        <A
                                                            href={project.url}
                                                            state={{ project }}
                                                            class="text-purple-700 dark:text-purple-300 font-medium hover:underline transition"
                                                        >
                                                            {project.name}
                                                        </A>
                                                    </div>
                                                </td>

                                                {/* Location */}
                                                <td class="p-2">{project.location ?? "—"}</td>

                                                {/* Type */}
                                                <td class="p-2">{project.type ?? "—"}</td>

                                                {/* Status Badge */}
                                                <td class="px-4 py-3">
                                                    <span
                                                        class={
                                                            "px-3 py-1 text-sm rounded-full capitalize " +
                                                            (project.status === "active"
                                                                ? "bg-green-100 text-green-700"
                                                                : project.status === "paused"
                                                                ? "bg-yellow-100 text-yellow-700"
                                                                : "bg-red-100 text-red-700")
                                                        }
                                                    >
                                                        {project.status}
                                                    </span>
                                                </td>

                                                {/* Uploaded Document */}
                                                <td class="p-2">
                                                    {project.uploaddocument ? (
                                                        <a
                                                            href={project.uploaddocument}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            class="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                                                        >
                                                            View PDF
                                                        </a>
                                                    ) : (
                                                        <span class="text-gray-400">No File</span>
                                                    )}
                                                </td>

                                                {/* Priority */}
                                                <td class="p-2">
                                                    <select
                                                        class="border border-purple-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-purple-100 dark:bg-gray-800 min-w-max"
                                                        value={project.priority}
                                                        onChange={(e) => handlePriorityChange(project.id, e.target.value)}
                                                    >
                                                        <option value="Urgent">Urgent</option>
                                                        <option value="High">High Priority</option>
                                                        <option value="Standard">Standard</option>
                                                    </select>
                                                </td>

                                                {/* Project Control */}
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
                                                        onChange={(e) => handleClientControlRequest(project.id, e.target.value)}
                                                    >
                                                        <option value="Live">Live</option>
                                                        <option value="Temporary Pause">Temporary Pause</option>
                                                        <option value="Stopped">Stopped</option>
                                                    </select>
                                                </td>

                                                {/* Budget */}
                                                <td class="p-2">
                                                    {"₹"}{(project.budget ?? 0).toLocaleString("en-IN")}
                                                </td>

                                                {/* Date-range Leads */}
                                                <td class="p-2">{stats.totalLeads}</td>

                                                {/* Date-range Spent */}
                                                <td class="p-2">
                                                    {"₹"}{stats.totalSpent.toLocaleString("en-IN")}
                                                </td>

                                                {/* Date-range AVG CPL */}
                                                <td class="p-2">
                                                    {"₹"}{stats.avgCPL}
                                                </td>

                                                {/* Active Campaigns */}
                                                <td class="p-2 text-center">{project.activeCampaigns ?? 0}</td>

                                                {/* Paused Campaigns */}
                                                <td class="p-2 text-center">{project.pausedCampaigns ?? 0}</td>
                                            </tr>
                                        );
                                    }}
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
                    <p class="text-sm font-medium text-gray-700 dark:text-gray-300">No active projects found</p>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Your live projects will appear here once campaigns are started
                    </p>
                </div>
            </Show>
        </section>
    );
}