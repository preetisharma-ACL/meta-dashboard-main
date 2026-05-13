import { For, Show, createSignal, createMemo } from "solid-js";
import { onMount } from "solid-js";
import Swal from "sweetalert2";
import godrejlogo from "../assets/project-logo/dlf.png";
import birlalogo from "../assets/project-logo/godrej.png";
import prestigelogo from "../assets/project-logo/prestige.png";
import { A } from "@solidjs/router";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { fetchProjects } from "../services/dashboard";
import { fetchCampaigns } from "../services/campaigns";
import { fetchCampaignInsights } from "../services/campaigns";
import {
    projectsCache, setProjectsCache, isCacheStale
} from "../cacheStore/appStore";

// fetchCampaigns is already imported, just ADD fetchCampaignInsights

export default function MainDashboard() {

    const [statusFilter, setStatusFilter] = createSignal("all");
    const [searchText, setSearchText] = createSignal("");
    const [selectedColumns, setSelectedColumns] = createSignal([]);
    // const [projects, setProjects] = createSignal([]);
    const [sortType, setSortType] = createSignal("");
    const [fromDate, setFromDate] = createSignal("");
    const [toDate, setToDate] = createSignal("");
    const [viewType, setViewType] = createSignal("table");
    // const [page, setPage] = createSignal(1);
    // const [hasNext, setHasNext] = createSignal(false);
    // const [hasPrev, setHasPrev] = createSignal(false);
    // const [pageSize, setPageSize] = createSignal(20);
    // const [total, setTotal] = createSignal(0);
    // const [totalPages, setTotalPages] = createSignal(1);
    // const [projectInsightsMap, setProjectInsightsMap] = createSignal({});
    // { projectId: [ ...all flattened insight records ] }
    // const [insightsLoading, setInsightsLoading] = createSignal(false);
    // const [loading, setLoading] = createSignal(true);
    // Add near your other signals
    const [userRole, setUserRole] = createSignal("client");
    const [cardRange, setCardRange] = createSignal(null);
    // values: today, yesterday, last7, lastMonth, thisMonth, custom
    const [columnSort, setColumnSort] = createSignal({
        key: "",
        direction: "desc",
    });
    // ── Read from global store via accessors ─────────────────────────────────────
    const projects = () => projectsCache.data;
    const projectInsightsMap = () => projectsCache.insightsMap;
    const loading = () => projectsCache.loading;
    const page = () => projectsCache.meta?.page ?? 1;
    const pageSize = () => projectsCache.meta?.page_size ?? 20;
    const total = () => projectsCache.meta?.total ?? 0;
    const totalPages = () => projectsCache.meta?.total_pages ?? 1;
    const hasNext = () => projectsCache.meta?.has_next ?? false;
    const hasPrev = () => projectsCache.meta?.has_prev ?? false;
    const insightsLoading = () => false; // handled inside loadAllProjectInsights

    const textColumns = new Set(["name", "location", "type", "status"]);

    const handleColumnSort = (key) => {
        setColumnSort((prev) => {
            if (prev.key === key) {
                return {
                    key,
                    direction: prev.direction === "asc" ? "desc" : "asc",
                };
            }
            // ✅ text columns default to asc (A→Z), numeric columns default to desc (high→low)
            const defaultDirection = textColumns.has(key) ? "asc" : "desc";
            return { key, direction: defaultDirection };
        });
    };

    // Update onMount to read the role
    onMount(() => {
        const auth = JSON.parse(localStorage.getItem("auth"));
        setUserRole(auth?.role ?? "client");

        // ✅ Only fetch if cache is missing or stale
        if (isCacheStale(projectsCache.lastFetched)) {
            loadData(1);
        }
    });

    // const loadData = async (pageNo = 1, search = "") => {
    //     try {
    //         setLoading(true);
    //         const res = await fetchProjects(pageNo, search);
    //         const apiData = res?.data || [];
    //         const meta = res?.meta?.pagination;

    //         const mappedProjects = (apiData || []).map(item => ({
    //             id: item.id,
    //             name: item.name,
    //             logo: item.logo || "/default-logo.png",
    //             location: item.city,
    //             budget: parseFloat(item.budget) || 0,
    //             leadsgenerated: item.leads_count ?? 0,
    //             type: item.property_type ?? "N/A",
    //             uploaddocument: item.upload_document ?? null,
    //             activeCampaigns: item.campaign_count ?? 0,
    //             pausedCampaigns: item.paused_campaigns ?? 0,
    //             status: item.status,
    //             clientRequest: item.client_request ?? null,
    //             priority: item.priority_label ?? "Standard",
    //             projectControl: item.project_control ?? "Live",
    //             url: item.url ?? "/all-campaigns",
    //             cpl: parseFloat(item.cpl) || 0,

    //             modifiedCpl: item.modified_cpl ?? null,
    //             spent: parseFloat(item.total_spend) || 0,
    //             leadsByDate: item.leads_by_date ?? {},
    //         }));

    //         setProjects(mappedProjects);

    //         deriveProjectStatuses(mappedProjects),
    //             loadAllProjectInsights(mappedProjects)


    //         if (meta) {
    //             setPage(meta.page);
    //             setPageSize(meta.page_size);
    //             setTotal(meta.total);
    //             setTotalPages(meta.total_pages);
    //             setHasNext(meta.has_next);
    //             setHasPrev(meta.has_prev);
    //         }
    //     } catch (err) {
    //         console.error(err);
    //     }
    //     finally {
    //         setLoading(false);   
    //     }
    // };

    const loadData = async (pageNo = 1, search = "") => {
        try {
            setProjectsCache("loading", true);
            const res = await fetchProjects(pageNo, search);
            const apiData = res?.data || [];
            const meta = res?.meta?.pagination;

            const mappedProjects = (apiData || []).map(item => ({
                id: item.id,
                name: item.name,
                logo: item.logo || "/default-logo.png",
                location: item.city,
                budget: parseFloat(item.budget) || 0,
                leadsgenerated: item.leads_count ?? 0,
                type: item.property_type ?? "N/A",
                uploaddocument: item.upload_document ?? null,
                activeCampaigns: item.campaign_count ?? 0,
                pausedCampaigns: item.paused_campaigns ?? 0,
                status: item.status,
                clientRequest: item.client_request ?? null,
                priority: item.priority_label ?? "Standard",
                projectControl: item.project_control ?? "Live",
                url: item.url ?? "/all-campaigns",
                cpl: parseFloat(item.cpl) || 0,

                modifiedCpl: item.modified_cpl ?? null,
                spent: parseFloat(item.total_spend) || 0,
                leadsByDate: item.leads_by_date ?? {},
            }));

            setProjectsCache({
                data: mappedProjects,
                meta: meta ?? projectsCache.meta,
                lastFetched: Date.now(),   // ✅ stamp the cache
                insightsMap: {}, // ✅ ADD THIS — wipe stale insights on fresh load
            });

            // kick off async enrichment (status + insights)
            deriveProjectStatuses(mappedProjects);
            loadAllProjectInsights(mappedProjects);

        } catch (err) {
            console.error(err);
        } finally {
            setProjectsCache("loading", false);
        }
    };

    const getCardDateRange = () => {
        const today = new Date();
        let from, to = new Date();

        switch (cardRange()) {
            case "today":
                from = new Date();
                break;

            case "yesterday":
                from = new Date();
                from.setDate(today.getDate() - 1);
                to = new Date(from);
                break;

            case "last7":
                from = new Date();
                from.setDate(today.getDate() - 6);
                break;

            case "thisMonth":
                from = new Date(today.getFullYear(), today.getMonth(), 1);
                break;

            case "lastMonth":
                from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                to = new Date(today.getFullYear(), today.getMonth(), 0);
                break;

            default:
                return { from: fromDate(), to: toDate() }; // fallback to calendar
        }

        return { from, to };
    };

    const cardStats = createMemo(() => {
        const map = projectInsightsMap();
        const { from, to } = getCardDateRange();

        const result = {};

        for (const project of projects()) {
            const insights = map[project.id] || [];

            const filtered = insights.filter(d => {
                if (!from || !to) return true;

                if (!d.date) return false; // ❗ important safeguard

                const date = new Date(d.date + "T00:00:00");

                const start = new Date(from);
                const end = new Date(to);

                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);

                return date >= start && date <= end;
            });

            const totalLeads = filtered.reduce((s, d) => s + (d.leads || 0), 0);
            const totalSpent = filtered.reduce((s, d) => s + parseFloat(d.spend || 0), 0);
            const avgCPL = totalLeads > 0
                ? parseFloat(totalSpent / totalLeads).toFixed(2)
                : 0;

            result[project.id] = { totalLeads, totalSpent, avgCPL };
        }

        return result;
    });

    // After setProjects(...) inside loadData, add:
    // const deriveProjectStatuses = async (projectList) => {
    //     const statusUpdates = await Promise.all(
    //         projectList.map(async (project) => {
    //             try {

    //                 const res = await fetchCampaigns(1, project.id, "", 1000);
    //                 const campaigns = res.data.results || res.data || [];

    //                 if (!Array.isArray(campaigns) || campaigns.length === 0) {
    //                     return {
    //                         id: project.id,
    //                         status: "paused",
    //                         activeCampaigns: 0,
    //                         pausedCampaigns: 0,
    //                     };
    //                 }

    //                 const activeCampaigns = campaigns.filter(c => c.status === "active").length;
    //                 const pausedCampaigns = campaigns.filter(c => c.status === "paused").length;
    //                 const hasActive = activeCampaigns > 0;

    //                 return {
    //                     id: project.id,
    //                     status: hasActive ? "active" : "paused",
    //                     activeCampaigns,
    //                     pausedCampaigns,
    //                 };

    //             } catch (err) {
    //                 return {
    //                     id: project.id,
    //                     status: project.status,
    //                     activeCampaigns: project.activeCampaigns,
    //                     pausedCampaigns: project.pausedCampaigns,
    //                 };
    //             }
    //         })
    //     );

    //     setProjects(prev =>
    //         prev.map(p => {
    //             const update = statusUpdates.find(u => u.id === p.id);
    //             return update ? {
    //                 ...p,
    //                 status: update.status,
    //                 activeCampaigns: update.activeCampaigns,
    //                 pausedCampaigns: update.pausedCampaigns,
    //             } : p;
    //         })
    //     );
    // };
    const deriveProjectStatuses = async (projectList) => {
        const statusUpdates = await Promise.all(
            projectList.map(async (project) => {
                try {
                    const res = await fetchCampaigns(1, project.id, "", 1000);
                    const campaigns = res.data.results || res.data || [];
                    const activeCampaigns = campaigns.filter(c => c.status === "active").length;
                    const pausedCampaigns = campaigns.filter(c => c.status === "paused").length;
                    return { id: project.id, status: activeCampaigns > 0 ? "active" : "paused", activeCampaigns, pausedCampaigns };
                } catch {
                    return { id: project.id, status: project.status, activeCampaigns: project.activeCampaigns, pausedCampaigns: project.pausedCampaigns };
                }
            })
        );

        // ✅ write into the global store
        setProjectsCache("data", prev =>
            prev.map(p => {
                const update = statusUpdates.find(u => u.id === p.id);
                return update ? { ...p, ...update } : p;
            })
        );
    };

    // const loadAllProjectInsights = async (projectList) => {
    //     setInsightsLoading(true);
    //     const result = {};

    //     await Promise.all(
    //         projectList.map(async (project) => {
    //             try {
    //                 const res = await fetchCampaigns(1, project.id, "", 1000);
    //                 const campaigns = res.data?.results || res.data || [];

    //                 if (!Array.isArray(campaigns) || campaigns.length === 0) {
    //                     result[project.id] = [];
    //                     return;
    //                 }

    //                 const insightArrays = await Promise.all(
    //                     campaigns.map(c =>
    //                         fetchCampaignInsights(c.id)
    //                             .then(r => r.data || [])
    //                             .catch(() => [])
    //                     )
    //                 );

    //                 result[project.id] = insightArrays.flat();
    //             } catch {
    //                 result[project.id] = [];
    //             }
    //         })
    //     );

    //     setProjectInsightsMap(result);
    //     setInsightsLoading(false);
    // };


    const loadAllProjectInsights = async (projectList) => {
        const result = {};

        await Promise.all(
            projectList.map(async (project) => {
                try {
                    let currentPage = 1;
                    let allCampaigns = [];
                    let hasMore = true;

                    // Paginate through ALL campaign pages (backend caps page_size at 20)
                    while (hasMore) {
                        const res = await fetchCampaigns(currentPage, project.id, "", 20);
                        const campaigns = res.data?.results || res.data || [];

                        if (!Array.isArray(campaigns) || campaigns.length === 0) break;

                        allCampaigns = [...allCampaigns, ...campaigns];

                        hasMore = res.meta?.pagination?.has_next ?? false;
                        currentPage++;
                    }

                    if (allCampaigns.length === 0) {
                        result[project.id] = [];
                        return;
                    }

                    const insightArrays = await Promise.all(
                        allCampaigns.map(c =>
                            fetchCampaignInsights(c.id)
                                .then(r => r.data || [])
                                .catch(() => [])
                        )
                    );

                    result[project.id] = insightArrays.flat();
                } catch {
                    result[project.id] = [];
                }
            })
        );

        setProjectsCache("insightsMap", result);
    };

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

    const allProjectStats = createMemo(() => {
        const map = projectInsightsMap(); // reactive dependency
        const from = fromDate();
        const to = toDate();
        const result = {};

        for (const project of projects()) {
            const insights = map[project.id] || [];

            const filtered = (!from || !to)
                ? insights
                : insights.filter(d => {
                    const date = new Date(d.date + "T00:00:00");
                    const start = new Date(from);
                    const end = new Date(to);
                    start.setHours(0, 0, 0, 0);
                    end.setHours(23, 59, 59, 999);
                    return date >= start && date <= end;
                });

            const totalLeads = filtered.reduce((s, d) => s + (d.leads || 0), 0);
            const totalSpent = filtered.reduce((s, d) => s + parseFloat(d.spend || 0), 0);
            const avgCPL = totalLeads > 0 ? parseFloat(totalSpent / totalLeads).toFixed(2) : 0;

            result[project.id] = { totalLeads, totalSpent, avgCPL };
        }

        return result;
    });

    const filteredProjects = createMemo(() => {
        let data = [...projects()];

        if (statusFilter() !== "all") {
            data = data.filter(p => p.status === statusFilter());
        }

        // if (searchText()) {
        //     data = data.filter(p =>
        //         (p.name ?? "").toLowerCase().includes(searchText().toLowerCase())
        //     );
        // }

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

        // 🔥 NEW COLUMN SORTING (ADD THIS)
        const { key, direction } = columnSort();

        if (key) {   // ✅ ADD THIS GUARD
            data.sort((a, b) => {
                let valA = a[key];
                let valB = b[key];

                if (key === "totalLeads") {
                    valA = allProjectStats()[a.id]?.totalLeads || 0;
                    valB = allProjectStats()[b.id]?.totalLeads || 0;
                }

                if (key === "totalSpent") {
                    valA = allProjectStats()[a.id]?.totalSpent || 0;
                    valB = allProjectStats()[b.id]?.totalSpent || 0;
                }

                if (key === "avgCPL") {
                    valA = parseFloat(allProjectStats()[a.id]?.avgCPL || 0);
                    valB = parseFloat(allProjectStats()[b.id]?.avgCPL || 0);
                }

                const isNumber = typeof valA === "number" && typeof valB === "number";

                if (isNumber) {
                    return direction === "asc" ? valA - valB : valB - valA;
                }

                return direction === "asc"
                    ? String(valA || "").localeCompare(String(valB || ""), undefined, { sensitivity: "base" })
                    : String(valB || "").localeCompare(String(valA || ""), undefined, { sensitivity: "base" });
            });
        }   // ✅ close the guard
        return data;
    });

    const getSortIcon = (key) => {
        const current = columnSort();
        if (current.key !== key) return "⇅";
        return current.direction === "asc" ? "↑" : "↓";
    };

    const overviewStats = createMemo(() => {
        const all = filteredProjects();
        const statsMap = allProjectStats();

        const totalBudget = all.reduce((s, p) => s + (p.budget ?? 0), 0);
        const activeCampaigns = all.reduce((s, p) => s + (p.activeCampaigns ?? 0), 0);
        const pausedCampaigns = all.reduce((s, p) => s + (p.pausedCampaigns ?? 0), 0);
        const activeProjects = all.filter(p => p.status === "active").length;
        const totalLeads = all.reduce((s, p) => s + (statsMap[p.id]?.totalLeads ?? 0), 0);
        const totalSpent = all.reduce((s, p) => s + (statsMap[p.id]?.totalSpent ?? 0), 0);
        const avgCPL = totalLeads > 0 ? parseFloat(totalSpent / totalLeads).toFixed(2) : 0;

        return { totalBudget, totalSpent, totalLeads, avgCPL, activeCampaigns, pausedCampaigns, activeProjects };
    });

    const overviewStatsCards = createMemo(() => {
        const all = filteredProjects();
        const statsMap = cardStats();
        const totalBudget = all.reduce((s, p) => s + (p.budget ?? 0), 0);
        const activeCampaigns = all.reduce((s, p) => s + (p.activeCampaigns ?? 0), 0);
        const pausedCampaigns = all.reduce((s, p) => s + (p.pausedCampaigns ?? 0), 0);
        const activeProjects = all.filter(p => p.status === "active").length;
        const totalLeads = all.reduce((s, p) => s + (statsMap[p.id]?.totalLeads ?? 0), 0);
        const totalSpent = all.reduce((s, p) => s + (statsMap[p.id]?.totalSpent ?? 0), 0);
        const avgCPL = totalLeads > 0 ? (totalSpent / totalLeads).toFixed(2) : 0;
        return { totalLeads, totalSpent, avgCPL, activeCampaigns, pausedCampaigns, activeProjects, totalBudget };
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
        if (!fromDate() || !toDate()) return "";
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

    const getColor = (name) => {
        const colors = ["bg-red-100 text-red-600", "bg-blue-100 text-blue-600", "bg-green-100 text-green-600", "bg-yellow-100 text-yellow-600"];
        const index = name ? name.charCodeAt(0) % colors.length : 0;
        return colors[index];
    };

    const TableSkeleton = () => {
        return (
            <tbody>
                <For each={Array(8).fill(0)}>
                    {(_, i) => (
                        <tr class="border-t animate-pulse">
                            <td class="p-3"><div class="h-6 w-6 bg-gray-300 dark:bg-gray-700 rounded-full"></div></td>
                            <td class="p-3"><div class="h-4 w-32 bg-gray-300 dark:bg-gray-700 rounded"></div></td>
                            <td class="p-3"><div class="h-4 w-24 bg-gray-300 dark:bg-gray-700 rounded"></div></td>
                            <td class="p-3"><div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div></td>
                            <td class="p-3"><div class="h-6 w-16 bg-gray-300 dark:bg-gray-700 rounded-full"></div></td>
                            <td class="p-3"><div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div></td>
                            <td class="p-3"><div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div></td>
                            <td class="p-3"><div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div></td>
                            <td class="p-3"><div class="h-4 w-16 bg-gray-300 dark:bg-gray-700 rounded"></div></td>
                            <td class="p-3"><div class="h-4 w-16 bg-gray-300 dark:bg-gray-700 rounded"></div></td>
                            <td class="p-3"><div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div></td>
                        </tr>
                    )}
                </For>
            </tbody>
        );
    };

    return (
        <section class="w-full px-4 sm:px-6 lg:px-8 py-6">

            {/* Section Header */}
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
                <div>
                    <h1 class="text-2xl font-semibold mb-1">Active Projects</h1>
                    <p class="text-md text-gray-700 dark:text-gray-400">All projects with live marketing campaigns.</p>
                </div>
                {/* <div class="flex items-center gap-2">
                    <A
                        href="/add-project"
                        class="bg-blue-900 hover:bg-blue-800 transition-all text-white px-4 py-2 rounded-lg text-sm font-medium shadow"
                    >
                        + Add New Project
                    </A>
                </div> */}
            </div>

            <div class="flex flex-wrap gap-2 mb-5">

                {[
                    { label: "Today", value: "today" },
                    { label: "Yesterday", value: "yesterday" },
                    { label: "Last 7 Days", value: "last7" },
                    { label: "This Month", value: "thisMonth" },
                    { label: "Last Month", value: "lastMonth" }
                ].map((item) => (
                    <button
                        onClick={() => setCardRange(item.value)}
                        class={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 border

            ${cardRange() === item.value
                                ? "bg-blue-600 text-white border-blue-600 shadow-md"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50 hover:text-blue-700 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white"
                            }
            `}
                    >
                        {item.label}
                    </button>
                ))}

                {/* Clear Button */}
                <button
                    onClick={() => setCardRange(null)}
                    class="px-4 py-2 rounded-lg text-sm font-medium border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 transition dark:bg-red-900/30 dark:text-red-300 dark:border-red-700 dark:hover:bg-red-900/50"
                >
                    Clear
                </button>

            </div>

            {/* Overview Cards Row 1 */}
            <div class="grid md:grid-cols-4 gap-6 mb-10">
                <div class="bg-blue-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-blue-200 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <p class="text-md text-blue-800 dark:text-gray-400">Total Budget Allocated</p>
                        <h3 class="text-xl font-semibold mt-2 dark:text-white">
                            {"₹"}{overviewStatsCards().totalBudget.toLocaleString("en-IN")}
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
                            {"₹"}{overviewStatsCards().totalSpent.toLocaleString("en-IN")}
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
                            {overviewStatsCards().totalLeads}
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
                            {"₹"}{overviewStatsCards().avgCPL.toLocaleString("en-IN")}
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
                            {overviewStatsCards().activeCampaigns}
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
                            {overviewStatsCards().activeProjects}
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
                <div class="relative inline-block">
                    <select
                        class="border px-3 py-2 pr-10 rounded-lg bg-white dark:bg-gray-800 appearance-none"
                        value={statusFilter()}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">All</option>
                        <option value="active">Active Project</option>
                        <option value="paused">Paused Project</option>
                    </select>

                    <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        <svg
                            class="w-4 h-4 text-gray-500"
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
                    </div>
                </div>

                <input
                    type="text"
                    placeholder="Search project..."
                    value={searchText()}
                    onInput={(e) => {
                        const value = e.target.value;
                        setSearchText(value);
                        loadData(1, value);
                    }}
                    class="border px-3 py-2 rounded-lg w-60 dark:bg-gray-800"
                />

                {/* No arrow characters — use plain text */}
                <div class="relative inline-block">
                    <select
                        class="border px-3 py-2 pr-10 rounded-lg dark:bg-gray-800 appearance-none"
                        value={sortType()}
                        onChange={(e) => setSortType(e.target.value)}
                    >
                        <option value="">Sort by</option>
                    <option value="budget">Budget: High to Low</option>
                    <option value="leads">Leads: High to Low</option>
                    <option value="activeCampaigns">Active Campaigns</option>
                    <option value="cplHigh">CPL: High to Low</option>
                    <option value="cplLow">CPL: Low to High</option>
                </select>

                <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg
                        class="w-4 h-4 text-gray-500"
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
                </div>
                </div>

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
            <div class="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border">
                <table class="w-full text-sm table-auto">
                    <thead class="bg-gray-100 dark:bg-gray-800">
                        <tr class="[&_th]:text-center [&_th]:cursor-pointer [&_th]:whitespace-nowrap [&_th:first-child]:text-left text-gray-800 dark:text-gray-200">
                            <th class="p-3 w-12 sticky left-0 z-20 bg-gray-100 dark:bg-gray-800">S.No</th>
                            <th class="p-3 sticky left-[57px] z-20 bg-gray-100 dark:bg-gray-800 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.10)]" onClick={() => handleColumnSort("name")}>
                                Project Name {getSortIcon("name")}
                            </th>
                            <th class="p-3" onClick={() => handleColumnSort("location")}>
                                Location {getSortIcon("location")}
                            </th>
                            <th class="p-3" onClick={() => handleColumnSort("type")}>
                                Type {getSortIcon("type")}
                            </th>
                            <th class="p-3" onClick={() => handleColumnSort("status")}>
                                Status {getSortIcon("status")}
                            </th>
                            {/* <th class="p-3">Uploaded Document</th> */}
                            {/* <th class="p-3">Customer Priority</th> */}
                            {/* <th class="p-3">Project Control</th> */}
                            <th class="p-3" onClick={() => handleColumnSort("budget")}>
                                Budget {getSortIcon("budget")}
                            </th>
                            <th class="p-3" onClick={() => handleColumnSort("totalLeads")}>
                                {rangeLabel()} Total Leads {getSortIcon("totalLeads")}
                            </th>
                            <th class="p-3" onClick={() => handleColumnSort("totalSpent")}>
                                {rangeLabel()} Total Spent {getSortIcon("totalSpent")}
                            </th>
                            <th class="p-3" onClick={() => handleColumnSort("avgCPL")}>
                                {rangeLabel()} AVG CPL {getSortIcon("avgCPL")}
                            </th>
                            {userRole() === "admin" && (
                                <th class="p-3" onClick={() => handleColumnSort("premiumCPL")}>
                                    Premium CPL {getSortIcon("premiumCPL")}
                                </th>
                            )}
                            <th class="p-3" onClick={() => handleColumnSort("activeCampaigns")}>
                                Active Campaigns {getSortIcon("activeCampaigns")}
                            </th>
                            <th class="p-3" onClick={() => handleColumnSort("pausedCampaigns")}>
                                Paused Campaigns {getSortIcon("pausedCampaigns")}
                            </th>
                        </tr>
                    </thead>
                    <Show when={!loading()} fallback={<TableSkeleton />}>
                        <tbody>
                            {/*  For callback with explicit return */}
                            <For each={filteredProjects()}>
                                {(project, index) => {
                                    const stats = () => allProjectStats()[project.id] || { totalLeads: 0, totalSpent: 0, avgCPL: 0 }; //  changed

                                    return (
                                        <tr
                                            class={
                                                "border-t transition-all duration-300 ease-in-out group " +
                                                "[&_td]:text-center [&_td]:px-6 [&_td:first-child]:px-2 " +
                                                "[&_td]:whitespace-nowrap [&_td:first-child]:text-left " +
                                                (index() % 2 === 0
                                                    ? "bg-white dark:bg-gray-900 "
                                                    : "bg-purple-50 dark:bg-gray-900 ")

                                            }
                                        >

                                            <td class={
                                                "px-1 py-2 w-12 text-center sticky left-0 z-10 " +
                                                " " +
                                                (index() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-purple-50 dark:bg-gray-900")
                                            }>
                                                <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-semibold">
                                                    {(page() - 1) * pageSize() + index() + 1}
                                                </span>
                                            </td>
                                            {/* Project Name */}
                                            <td class={
                                                "px-2 py-2 sticky left-[57px] z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] " +
                                                " " +
                                                (index() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-purple-50 dark:bg-gray-900")
                                            }>
                                                <div class="flex items-center gap-2">
                                                    <div class={`rounded flex items-center justify-center w-10 h-10 font-bold text-lg uppercase ${getColor(project.name)}`}>
                                                        {project.name ? project.name.charAt(0) : "?"}
                                                    </div>
                                                    <A
                                                        href={`/project/${project.id}`}   //  ADD THIS
                                                        state={{ project }}
                                                        class="text-purple-700 dark:text-purple-300 font-medium hover:underline transition"
                                                    >
                                                        {project.name}
                                                    </A>
                                                </div>
                                            </td>

                                            {/* Location */}
                                            <td class="p-2">Mumbai</td>

                                            {/* Type */}
                                            <td class="p-2">Residential</td>

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
                                            {/* <td class="p-2">
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
                                        </td> */}

                                            {/* Priority */}
                                            {/* <td class="p-2">
                                            <select
                                                class="border border-purple-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-purple-100 dark:bg-gray-800 min-w-max"
                                                value={project.priority}
                                                onChange={(e) => handlePriorityChange(project.id, e.target.value)}
                                            >
                                                <option value="Urgent">Urgent</option>
                                                <option value="High">High Priority</option>
                                                <option value="Standard">Standard</option>
                                            </select>
                                        </td> */}

                                            {/* Project Control */}
                                            {/* <td class="p-2">
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
                                        </td> */}

                                            {/* Budget */}
                                            <td class="p-2">
                                                {"₹"}{(project.budget ?? 0).toLocaleString("en-IN")}
                                            </td>

                                            {/* Date-range Leads */}
                                            <td class="p-2">{stats().totalLeads}</td>

                                            {/* Date-range Spent */}
                                            <td class="p-2">
                                                {"₹"}{stats().totalSpent.toLocaleString("en-IN")}
                                            </td>

                                            {/* Date-range AVG CPL */}
                                            <td class="p-2">
                                                {"₹"}{stats().avgCPL}
                                            </td>
                                            {userRole() === "admin" && (
                                                <td class="p-2">
                                                    {"₹"}{project.modifiedCpl ?? "—"}
                                                </td>
                                            )}

                                            {/* Active Campaigns */}
                                            <td class="p-2 text-center">{project.activeCampaigns ?? 0}</td>

                                            {/* Paused Campaigns */}
                                            <td class="p-2 text-center">{project.pausedCampaigns ?? 0}</td>
                                        </tr>
                                    );
                                }}
                            </For>
                        </tbody>
                        <tfoot class="bg-gray-100 dark:bg-gray-800 font-semibold">
                            <tr class="[&_td]:text-center [&_td]:px-6 [&_td]:py-3">

                                <td class="sticky left-0 bg-gray-100 dark:bg-gray-800 z-20"></td>

                                <td class="sticky left-[57px] bg-gray-100 dark:bg-gray-800 z-20 text-left">
                                    Total
                                </td>

                                <td></td>
                                <td></td>
                                <td></td>

                                {/* Budget Total */}
                                <td>
                                    {"₹"}{overviewStats().totalBudget.toLocaleString("en-IN")}
                                </td>

                                {/* Leads Total */}
                                <td>
                                    {overviewStats().totalLeads}
                                </td>

                                {/* Spent Total */}
                                <td>
                                    {"₹"}{overviewStats().totalSpent.toLocaleString("en-IN")}
                                </td>

                                {/* Avg CPL */}
                                <td>
                                    {"₹"}{overviewStats().avgCPL}
                                </td>

                                {userRole() === "admin" && <td></td>}

                                {/* Active Campaigns */}
                                <td>
                                    {overviewStats().activeCampaigns}
                                </td>

                                {/* Paused Campaigns */}
                                <td> {overviewStats().pausedCampaigns}</td>

                            </tr>
                        </tfoot>
                    </Show>
                </table>

            </div>
            <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
                <span class="text-sm text-gray-500">
                    {total() === 0
                        ? "No results"
                        : `Showing ${(page() - 1) * pageSize() + 1}–${Math.min(page() * pageSize(), total())} of ${total()} results`
                    }
                </span>

                <div class="flex items-center gap-2">
                    <button
                        onClick={() => hasPrev() && loadData(page() - 1)}
                        disabled={!hasPrev()}
                        class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-35 disabled:cursor-default transition-colors"
                    >
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.8">
                            <path d="M10 12L6 8l4-4" />
                        </svg>
                        Prev
                    </button>

                    <span class="text-sm text-gray-500 px-1">Page {page()} of {totalPages()}</span>

                    <button
                        onClick={() => hasNext() && loadData(page() + 1)}
                        disabled={!hasNext()}
                        class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg bg-blue-600 border border-blue-600 text-white hover:bg-blue-700 disabled:opacity-35 disabled:cursor-default transition-colors"
                    >
                        Next
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.8">
                            <path d="M6 4l4 4-4 4" />
                        </svg>
                    </button>
                </div>
            </div>
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
