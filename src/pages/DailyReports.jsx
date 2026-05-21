import { For, Show, createSignal, createMemo, onMount } from "solid-js";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { fetchProjects } from "../services/dashboard";
import { fetchCampaigns, fetchCampaignInsights } from "../services/campaigns";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const GST_RATE = 0.18;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (val) =>
    `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const normaliseDate = (d) => {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function DailyReports() {
    /* ── state ── */
    const [projects, setProjects] = createSignal([]);
    const [insightsMap, setInsightsMap] = createSignal({});   // projectId → [{date, leads, spend, …}]
    const [loading, setLoading] = createSignal(false);
    const [loadingInsights, setLoadingInsights] = createSignal(false);
    const [statusFilter, setStatusFilter] = createSignal("all");
    const [fromDate, setFromDate] = createSignal("");
    const [toDate, setToDate] = createSignal("");
    const [showPreview, setShowPreview] = createSignal(false);
    const [previewGenerating, setPreviewGenerating] = createSignal(false);

    /* ── lifecycle ── */
    onMount(() => {
        loadAllData();
    });

    /* ── data fetching ── */
    const loadAllData = async () => {
        try {
            setLoading(true);

            // ① fetch projects (all pages)
            let allProjects = [];
            let page = 1;
            let hasMore = true;
            while (hasMore) {
                const res = await fetchProjects(page, "");
                const apiData = res?.data || [];
                const meta = res?.meta?.pagination;
                const mapped = apiData.map((item) => ({
                    id: item.id,
                    name: item.name,
                    status: item.status,          // "active" | "paused"
                    location: item.city ?? "",
                }));
                allProjects = [...allProjects, ...mapped];
                hasMore = meta?.has_next ?? false;
                page++;
            }
            setProjects(allProjects);

            // ② fetch insights (fire-and-forget — table shows skeleton until done)
            setLoadingInsights(true);
            loadAllInsights(allProjects).finally(() => setLoadingInsights(false));
        } catch (err) {
            console.error("DailyReports: loadAllData error", err);
        } finally {
            setLoading(false);
        }
    };

    const loadAllInsights = async (projectList) => {
        const result = {};

        await Promise.all(
            projectList.map(async (project) => {
                try {
                    // collect all campaigns for this project (paginated)
                    let allCampaigns = [];
                    let cp = 1;
                    let more = true;
                    while (more) {
                        const res = await fetchCampaigns(cp, project.id, "", 20);
                        const batch = res.data?.results || res.data || [];
                        if (!Array.isArray(batch) || batch.length === 0) break;
                        allCampaigns = [...allCampaigns, ...batch];
                        more = res.meta?.pagination?.has_next ?? false;
                        cp++;
                    }
                    const activeCampaigns = allCampaigns.filter(
                        (c) => c.status?.toLowerCase() === "active"
                    ).length;

                    const derivedStatus =
                        activeCampaigns > 0 ? "active" : "paused";

                    if (allCampaigns.length === 0) {
                        result[project.id] = {
                            insights: [],
                            status: "paused",
                        };
                        return;
                    }

                    // fetch insights for every campaign in parallel
                    const insightArrays = await Promise.all(
                        allCampaigns.map((c) =>
                            fetchCampaignInsights(c.id)
                                .then((r) =>
                                    (r.data || []).map((d) => ({ ...d, campaignId: c.id }))
                                )
                                .catch(() => [])
                        )
                    );

                    result[project.id] = {
                        insights: insightArrays.flat(),
                        status: derivedStatus,
                    };
                } catch {
                    result[project.id] = [];
                }
            })
        );

        setInsightsMap(result);
    };

    /* ── derived: ONE row per project (aggregated over selected date range) ── */
    const reportRows = createMemo(() => {
        const from = fromDate();
        const to = toDate();
        const rows = [];

        for (const project of projects()) {
            // ── Status filter ──────────────────────────────────────────────────
            // The API returns "active" or "paused". We always emit a row even
            // when insights are empty, so filter happens here — NOT inside the
            // insights loop. This is the root cause of paused rows disappearing.
            if (statusFilter() !== "all") {
                const status =
                    insightsMap()[project.id]?.status?.toLowerCase() ||
                    project.status?.toLowerCase();

                if (statusFilter() === "active" && status !== "active") {
                    continue;
                }

                if (statusFilter() === "paused" && status !== "paused") {
                    continue;
                }
            }

            // ── Date filter ────────────────────────────────────────────────────
            const insights =
                insightsMap()[project.id]?.insights ?? [];  // default [] so 0-row still emits

            const filtered =
                !from || !to
                    ? insights
                    : insights.filter((d) => {
                        if (!d.date) return false;
                        const date = normaliseDate(d.date.includes("T") ? d.date : d.date + "T00:00:00");
                        const start = normaliseDate(new Date(from));
                        const end = new Date(to); end.setHours(23, 59, 59, 999);
                        return date >= start && date <= end;
                    });

            // ── Aggregate all filtered insight rows into one project total ─────
            const leads = filtered.reduce((s, d) => s + (d.leads || 0), 0);
            const spent = parseFloat(
                filtered.reduce((s, d) => s + parseFloat(d.spend || 0), 0).toFixed(2)
            );
            const cpl = leads > 0 ? parseFloat((spent / leads).toFixed(2)) : 0;
            const spentWithGST = parseFloat((spent * (1 + GST_RATE)).toFixed(2));

            // Always push — even when leads === 0 and spent === 0
            rows.push({
                projectId: project.id,
                projectName: project.name,
                projectStatus: project.status,
                leads,
                cpl,
                spent,
                spentWithGST,
            });
        }

        // Sort alphabetically by project name (matches Main Dashboard feel)
        return rows.sort((a, b) => a.projectName.localeCompare(b.projectName));
    });

    /* ── footer totals ── */
    const totals = createMemo(() => {
        const rows = reportRows();
        const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
        const totalSpent = parseFloat(rows.reduce((s, r) => s + r.spent, 0).toFixed(2));
        const totalSpentGST = parseFloat(rows.reduce((s, r) => s + r.spentWithGST, 0).toFixed(2));
        const avgCPL = totalLeads > 0 ? parseFloat((totalSpent / totalLeads).toFixed(2)) : 0;
        return { totalLeads, totalSpent, totalSpentGST, avgCPL };
    });

    /* ── range label ── */
    const rangeLabel = createMemo(() => {
        if (!fromDate() || !toDate()) return "All Dates";
        const from = normaliseDate(new Date(fromDate()));
        const to = normaliseDate(new Date(toDate()));
        const diffDays = Math.floor((to - from) / 86400000) + 1;
        if (diffDays === 1) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            return from.getTime() === today.getTime() ? "Today" : "Yesterday";
        }
        if (diffDays === 3) return "Last 3 Days";
        if (diffDays === 7) return "Last 7 Days";
        if (diffDays >= 28 && diffDays <= 31) return "Last Month";
        return `${fmtDate(fromDate())} – ${fmtDate(toDate())}`;
    });

    /* ── PDF download ── */
    const downloadPDF = async () => {
        const el = document.getElementById("pdf-daily-report");
        if (!el) return;
        const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#fbfbfb" });
        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF("p", "mm", "a4");
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
        pdf.save("daily-report.pdf");
    };

    const handlePreview = () => {
        setPreviewGenerating(true);
        // small delay so the button state renders first
        setTimeout(() => {
            setShowPreview((p) => !p);
            setPreviewGenerating(false);
        }, 80);
    };

    /* ── skeleton rows ── */
    const SkeletonRows = () => (
        <tbody>
            <For each={Array(7).fill(0)}>
                {(_, i) => (
                    <tr class={`border-t animate-pulse ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-purple-50 dark:bg-gray-900"}`}>
                        <td class="p-3"><div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                        <td class="p-3"><div class="h-4 w-36 bg-gray-200 dark:bg-gray-700 rounded mx-auto" /></td>
                        <td class="p-3"><div class="h-4 w-10 bg-gray-200 dark:bg-gray-700 rounded mx-auto" /></td>
                        <td class="p-3"><div class="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded mx-auto" /></td>
                        <td class="p-3"><div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded mx-auto" /></td>
                        <td class="p-3"><div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded mx-auto" /></td>
                    </tr>
                )}
            </For>
        </tbody>
    );

    /* ════════════════════════════════════════════════════════════════════════
       RENDER
    ════════════════════════════════════════════════════════════════════════ */
    return (
        <section class="w-full px-4 sm:px-6 lg:px-8 py-6">

            {/* ── Page Header ── */}
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
                <div>
                    <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">Daily Reports</h1>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        View leads, CPL, and spend grouped by date and project.
                    </p>
                </div>

                {/* live indicator */}
                <Show when={loadingInsights()}>
                    <div class="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                        <div class="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        Loading insights…
                    </div>
                </Show>
            </div>


            {/* ── Filters ── */}
            <div class="flex flex-wrap items-center gap-3 mb-5">
                {/* Status Filter */}
                <div class="relative inline-block">
                    <select
                        class="border px-3 py-2 pr-10 rounded-lg bg-white dark:bg-gray-800 appearance-none text-sm text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600"
                        value={statusFilter()}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">All Projects</option>
                        <option value="active">live Projects</option>
                        <option value="paused">Paused Projects</option>
                    </select>
                    <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>

                {/* Date Range */}
                <DateRangeFilter
                    fromDate={fromDate}
                    toDate={toDate}
                    setFromDate={setFromDate}
                    setToDate={setToDate}
                />

                {/* Reset */}
                <button
                    onClick={() => {
                        setStatusFilter("all");
                        setFromDate("");
                        setToDate("");
                        setShowPreview(false);
                    }}
                    class="px-4 py-2 rounded-lg border bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition border-gray-300 dark:border-gray-600"
                >
                    Reset
                </button>

                {/* Active range badge */}
                <Show when={fromDate() && toDate()}>
                    <span class="px-3 py-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium border border-blue-200 dark:border-blue-700">
                        {rangeLabel()}
                    </span>
                </Show>
            </div>

            {/* ── Main Table ── */}
            <Show
                when={!loading()}
                fallback={
                    <div class="flex items-center justify-center py-24">
                        <div class="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <span class="ml-3 text-gray-500 dark:text-gray-400">Loading project data…</span>
                    </div>
                }
            >
                <div class="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                    <table class="w-full text-sm table-auto">
                        <thead class="bg-gray-100 dark:bg-gray-800">
                            <tr class="[&_th]:text-center [&_th:first-child]:text-left text-gray-700 dark:text-gray-200 [&_th]:whitespace-nowrap [&_th]:font-semibold">
                                <th class="p-3 pl-4">Date</th>
                                <th class="p-3">Project</th>
                                <th class="p-3">Leads</th>
                                <th class="p-3">CPL</th>
                                <th class="p-3">Amount Spent</th>
                                <th class="p-3">Amount Spent (with GST)</th>
                            </tr>
                        </thead>

                        <Show when={!loadingInsights()} fallback={<SkeletonRows />}>
                            <Show
                                when={reportRows().length > 0}
                                fallback={
                                    <tbody>
                                        <tr>
                                            <td colspan="6" class="py-20 text-center">
                                                <div class="flex flex-col items-center gap-2">
                                                    <svg class="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                                            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                    </svg>
                                                    <p class="text-gray-500 dark:text-gray-400 font-medium">No projects found</p>
                                                    <p class="text-gray-400 dark:text-gray-500 text-xs">Try adjusting the status filter or selecting a different date range.</p>
                                                </div>
                                            </td>
                                        </tr>
                                    </tbody>
                                }
                            >
                                <tbody>
                                    <For each={reportRows()}>
                                        {(row, i) => (
                                            <tr
                                                class={
                                                    "border-t [&_td]:text-center [&_td:first-child]:text-left [&_td]:whitespace-nowrap transition-colors " +
                                                    (i() % 2 === 0
                                                        ? "bg-white dark:bg-gray-900 hover:bg-blue-50/40 dark:hover:bg-gray-800/60"
                                                        : "bg-purple-50 dark:bg-gray-900 hover:bg-purple-100/60 dark:hover:bg-gray-800/60")
                                                }
                                            >

                                                {/* Date column */}
                                                <td class="p-3 pl-4 text-left">
                                                    <span class="font-medium text-gray-700 dark:text-gray-300">
                                                        {fromDate()
                                                            ? new Date(fromDate()).toLocaleDateString("en-IN", {
                                                                day: "numeric",
                                                                month: "short",
                                                            })
                                                            : new Date().toLocaleDateString("en-IN", {
                                                                day: "numeric",
                                                                month: "short",
                                                            })}
                                                    </span>
                                                </td>

                                                {/* Project name — status badge removed */}
                                                <td class="p-3">
                                                    <span class="font-medium text-purple-700 dark:text-purple-300">
                                                        {row.projectName}
                                                    </span>
                                                </td>

                                                {/* Leads */}
                                                <td class="p-3 font-bold text-gray-800 dark:text-gray-100">
                                                    {row.leads}
                                                </td>

                                                {/* CPL */}
                                                <td class="p-3 text-purple-700 dark:text-purple-300">
                                                    {fmt(row.cpl)}
                                                </td>

                                                {/* Spent */}
                                                <td class="p-3 text-red-600 dark:text-red-400">
                                                    {fmt(row.spent)}
                                                </td>

                                                {/* Spent + GST */}
                                                <td class="p-3 font-semibold text-orange-600 dark:text-orange-400">
                                                    {fmt(row.spentWithGST)}
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>

                                {/* Footer totals */}
                                <tfoot>
                                    <tr class="bg-gradient-to-r from-purple-100 to-purple-50 dark:from-gray-800 dark:to-gray-900 border-t-2 border-purple-300 dark:border-gray-600 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] [&_td]:text-center [&_td:first-child]:text-left font-semibold">
                                        <td class="p-3 pl-4">
                                            <span class="px-3 py-1 bg-purple-600 text-white rounded-lg text-xs font-bold tracking-wide">
                                                TOTAL
                                            </span>
                                        </td>
                                        <td class="p-3" />
                                        <td class="p-3 text-green-700 dark:text-green-300 font-bold text-base">
                                            {totals().totalLeads}
                                        </td>
                                        <td class="p-3 text-purple-700 dark:text-purple-300 font-bold">
                                            {fmt(totals().avgCPL)}
                                        </td>
                                        <td class="p-3 text-red-700 dark:text-red-300 font-bold">
                                            {fmt(totals().totalSpent)}
                                        </td>
                                        <td class="p-3 text-orange-700 dark:text-orange-300 font-bold">
                                            {fmt(totals().totalSpentGST)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </Show>
                        </Show>
                    </table>
                </div>
            </Show>

            {/* ── Action Buttons ── */}
            <div class="flex items-center gap-3 mt-6 flex-wrap">
                {/* Preview */}
                <button
                    onClick={handlePreview}
                    disabled={previewGenerating() || reportRows().length === 0}
                    class={
                        "flex items-center gap-2 px-5 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200 shadow-sm " +
                        (reportRows().length === 0
                            ? "opacity-40 cursor-not-allowed border-blue-300 text-blue-500 bg-blue-50 dark:bg-blue-900/10"
                            : showPreview()
                                ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
                                : "border-blue-600 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40")
                    }
                >
                    <Show
                        when={!previewGenerating()}
                        fallback={<div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    </Show>
                    {showPreview() ? "Hide Preview" : "Preview Report"}
                </button>

                {/* Download */}
                <button
                    onClick={downloadPDF}
                    disabled={reportRows().length === 0}
                    class={
                        "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shadow-sm " +
                        (reportRows().length === 0
                            ? "opacity-40 cursor-not-allowed bg-blue-900 text-white"
                            : "bg-blue-900 hover:bg-blue-800 text-white hover:shadow-md")
                    }
                >
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
                    </svg>
                    Download Report
                </button>

                {/* row count */}
                <Show when={reportRows().length > 0}>
                    <span class="text-xs text-gray-400 dark:text-gray-500 ml-1">
                        {reportRows().length} row{reportRows().length !== 1 ? "s" : ""}
                    </span>
                </Show>
            </div>

            {/* ════════════════════════════════════════════════════════
                PREVIEW PANEL  (in-page premium gold report)
            ════════════════════════════════════════════════════════ */}
            <Show when={showPreview()}>
                <div class="mt-8 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-xl">
                    {/* header band */}
                    <div class="relative bg-[#0A1628] px-8 py-6 text-center overflow-hidden">
                        <div class="absolute top-0 left-0 right-0 h-[5px] bg-[#C9A84C]" />
                        <div
                            class="absolute inset-0 opacity-[0.03]"
                            style="background-image: repeating-linear-gradient(135deg, transparent, transparent 18px, white 18px, white 19px);"
                        />
                        <p class="relative text-[#E8D5A3] text-xs tracking-[0.2em] uppercase mb-1">
                            Aajneeti Connect Ltd.
                        </p>
                        <h2 class="relative text-white text-2xl font-bold tracking-[0.15em] uppercase">
                            Daily Report
                        </h2>
                        <p class="relative text-[#E8D5A3] text-xs mt-1.5 tracking-wide">
                            {rangeLabel()} &nbsp;·&nbsp; Generated on{" "}
                            {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                        </p>
                        <div class="absolute bottom-0 left-0 right-0 h-[4px] bg-[#C9A84C]" />
                    </div>

                    {/* table */}
                    <div class="overflow-x-auto bg-[#FDF8EE]">
                        <table class="w-full text-sm border-collapse">
                            <thead>
                                <tr class="bg-[#0A1628]">
                                    <th class="px-5 py-4 text-left text-[#C9A84C] font-bold text-xs tracking-widest uppercase whitespace-nowrap border-r border-[rgba(201,168,76,0.2)]">
                                        Date
                                    </th>
                                    <th class="px-5 py-4 text-center text-[#C9A84C] font-bold text-xs tracking-widest uppercase whitespace-nowrap border-r border-[rgba(201,168,76,0.2)]">
                                        Project
                                    </th>
                                    <th class="px-5 py-4 text-center text-[#C9A84C] font-bold text-xs tracking-widest uppercase whitespace-nowrap border-r border-[rgba(201,168,76,0.2)]">
                                        Leads
                                    </th>
                                    <th class="px-5 py-4 text-center text-[#C9A84C] font-bold text-xs tracking-widest uppercase whitespace-nowrap border-r border-[rgba(201,168,76,0.2)]">
                                        CPL
                                    </th>
                                    <th class="px-5 py-4 text-center text-[#C9A84C] font-bold text-xs tracking-widest uppercase whitespace-nowrap border-r border-[rgba(201,168,76,0.2)]">
                                        Amount Spent
                                    </th>
                                    <th class="px-5 py-4 text-center text-[#E8D5A3] font-bold text-xs tracking-widest uppercase whitespace-nowrap">
                                        Amount Spent (GST)
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={reportRows()}>
                                    {(row, i) => (
                                        <tr
                                            class="border-b border-[rgba(201,168,76,0.15)]"
                                            style={{ background: i() % 2 === 0 ? "#F5EDD8" : "#FDF8EE" }}
                                        >
                                            {/* S.No with gold left accent */}
                                            <td class="px-5 py-3 text-left relative whitespace-nowrap border-r border-[rgba(201,168,76,0.2)]">
                                                <span class="absolute left-0 top-0 bottom-0 w-[3px] bg-[#C9A84C]" />
                                                <span class="font-bold text-[#0A1628] text-xs">
                                                    {fromDate()
                                                        ? new Date(fromDate()).toLocaleDateString("en-IN", {
                                                            day: "numeric",
                                                            month: "short",
                                                        })
                                                        : new Date().toLocaleDateString("en-IN", {
                                                            day: "numeric",
                                                            month: "short",
                                                        })}
                                                </span>
                                            </td>
                                            {/* Project name — no badge */}
                                            <td class="px-5 py-3 text-center text-[#1E3A5F] font-medium text-xs whitespace-nowrap border-r border-[rgba(201,168,76,0.2)]">
                                                {row.projectName}
                                            </td>
                                            <td class="px-5 py-3 text-center font-bold text-[#1E3A5F] text-xs border-r border-[rgba(201,168,76,0.2)]">
                                                {row.leads}
                                            </td>
                                            <td class="px-5 py-3 text-center text-[#1E3A5F] font-medium text-xs border-r border-[rgba(201,168,76,0.2)]">
                                                {fmt(row.cpl)}
                                            </td>
                                            <td class="px-5 py-3 text-center text-[#1E3A5F] font-medium text-xs border-r border-[rgba(201,168,76,0.2)]">
                                                {fmt(row.spent)}
                                            </td>
                                            <td class="px-5 py-3 text-center font-bold text-[#7A5C1E] text-xs" style="background: rgba(201,168,76,0.10);">
                                                {fmt(row.spentWithGST)}
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                            {/* totals row */}
                            <tfoot>
                                <tr class="bg-[#0A1628]">
                                    <td class="px-5 py-4 text-left text-[#C9A84C] font-bold text-xs tracking-widest uppercase border-r border-[rgba(201,168,76,0.2)]">
                                        TOTAL
                                    </td>
                                    <td class="px-5 py-4 border-r border-[rgba(201,168,76,0.2)]" />
                                    <td class="px-5 py-4 text-center text-[#C9A84C] font-bold text-sm border-r border-[rgba(201,168,76,0.2)]">
                                        {totals().totalLeads}
                                    </td>
                                    <td class="px-5 py-4 text-center text-[#C9A84C] font-bold text-xs border-r border-[rgba(201,168,76,0.2)]">
                                        {fmt(totals().avgCPL)}
                                    </td>
                                    <td class="px-5 py-4 text-center text-[#C9A84C] font-bold text-xs border-r border-[rgba(201,168,76,0.2)]">
                                        {fmt(totals().totalSpent)}
                                    </td>
                                    <td class="px-5 py-4 text-center text-[#E8D5A3] font-bold text-xs">
                                        {fmt(totals().totalSpentGST)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* footer band */}
                    <div class="bg-[#FDF8EE] border-t border-[rgba(201,168,76,0.3)] px-8 py-3 flex items-center justify-between">
                        <div class="w-2 h-2 bg-[#C9A84C] rotate-45" />
                        <p class="text-[#645132] text-[11px] tracking-[0.2em] uppercase font-medium">
                            © {new Date().getFullYear()} Project Analytics · Aajneeti Connect Ltd.
                        </p>
                        <div class="w-2 h-2 bg-[#C9A84C] rotate-45" />
                    </div>
                </div>
            </Show>

            {/* ════════════════════════════════════════════════════════
                HIDDEN PDF TEMPLATE  (off-screen, captured by html2canvas)
            ════════════════════════════════════════════════════════ */}
            <div id="pdf-daily-report" style="position:absolute;left:-9999px;top:0;width:900px;">
                <div style="width:900px;background:#fbfbfb;padding:32px;font-family:'Georgia',serif;position:relative;box-sizing:border-box;">

                    {/* texture overlay */}
                    <div style="position:absolute;inset:0;background-image:repeating-linear-gradient(135deg,transparent,transparent 18px,rgba(255,255,255,0.015) 18px,rgba(255,255,255,0.015) 19px);pointer-events:none;" />

                    {/* outer gold border */}
                    <div style="position:absolute;inset:20px;border:2.5px solid #C9A84C;border-radius:10px;pointer-events:none;" />
                    <div style="position:absolute;inset:30px;border:0.8px solid #C9A84C;border-radius:7px;pointer-events:none;" />

                    {/* corners TL */}
                    <div style="position:absolute;top:20px;left:20px;pointer-events:none;">
                        <div style="position:absolute;top:-1px;left:-1px;width:22px;height:3px;background:#C9A84C;" />
                        <div style="position:absolute;top:-1px;left:-1px;width:3px;height:22px;background:#C9A84C;" />
                        <div style="position:absolute;top:6px;left:6px;width:8px;height:8px;background:#C9A84C;transform:rotate(45deg);" />
                    </div>
                    {/* TR */}
                    <div style="position:absolute;top:20px;right:20px;pointer-events:none;">
                        <div style="position:absolute;top:-1px;right:-1px;width:22px;height:3px;background:#C9A84C;" />
                        <div style="position:absolute;top:-1px;right:-1px;width:3px;height:22px;background:#C9A84C;" />
                        <div style="position:absolute;top:6px;right:6px;width:8px;height:8px;background:#C9A84C;transform:rotate(45deg);" />
                    </div>
                    {/* BL */}
                    <div style="position:absolute;bottom:20px;left:20px;pointer-events:none;">
                        <div style="position:absolute;bottom:-1px;left:-1px;width:22px;height:3px;background:#C9A84C;" />
                        <div style="position:absolute;bottom:-1px;left:-1px;width:3px;height:22px;background:#C9A84C;" />
                        <div style="position:absolute;bottom:6px;left:6px;width:8px;height:8px;background:#C9A84C;transform:rotate(45deg);" />
                    </div>
                    {/* BR */}
                    <div style="position:absolute;bottom:20px;right:20px;pointer-events:none;">
                        <div style="position:absolute;bottom:-1px;right:-1px;width:22px;height:3px;background:#C9A84C;" />
                        <div style="position:absolute;bottom:-1px;right:-1px;width:3px;height:22px;background:#C9A84C;" />
                        <div style="position:absolute;bottom:6px;right:6px;width:8px;height:8px;background:#C9A84C;transform:rotate(45deg);" />
                    </div>

                    {/* cream inner area */}
                    <div style="position:relative;margin:14px;background:#FDF8EE;border-radius:6px;padding:0 0 36px 0;overflow:hidden;z-index:1;">

                        {/* header */}
                        <div style="background:#0A1628;padding:28px 40px 22px;position:relative;overflow:hidden;">
                            <div style="position:absolute;inset:0;background-image:repeating-linear-gradient(135deg,transparent,transparent 18px,rgba(255,255,255,0.02) 18px,rgba(255,255,255,0.02) 19px);" />
                            <div style="position:absolute;top:0;left:0;right:0;height:5px;background:#C9A84C;" />
                            <div style="position:absolute;bottom:0;left:0;right:0;height:4px;background:#C9A84C;" />
                            <p style="text-align:center;color:#E8D5A3;font-size:14px;font-family:Arial,sans-serif;margin:0 0 6px;letter-spacing:2px;">
                                [Aajneeti Connect Ltd.]
                            </p>
                            <h1 style="text-align:center;color:white;font-size:28px;font-family:'Georgia',serif;letter-spacing:3px;margin:0 0 8px;font-weight:bold;text-transform:uppercase;">
                                Daily Report
                            </h1>
                            <p style="text-align:center;color:#E8D5A3;font-size:13px;font-family:Arial,sans-serif;margin:0;letter-spacing:1px;">
                                {rangeLabel()} &nbsp;·&nbsp; Generated on: {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                            </p>
                        </div>

                        {/* table */}
                        <div style="padding:24px 36px 0;">

                            {/* section divider */}
                            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                                <div style="width:8px;height:8px;background:#C9A84C;transform:rotate(45deg);flex-shrink:0;" />
                                <div style="flex:1;height:1px;background:#C9A84C;opacity:0.4;" />
                                <div style="display:flex;align-items:center;justify-content:center;background:#0A1628;padding:6px 16px;border-radius:20px;height:28px;">
                                    <span style="color:#C9A84C;font-size:11px;font-family:Arial;font-weight:bold;line-height:1;margin-bottom:12px;">
                                        DETAILED BREAKDOWN
                                    </span>
                                </div>
                                <div style="flex:1;height:1px;background:#C9A84C;opacity:0.4;" />
                                <div style="width:8px;height:8px;background:#C9A84C;transform:rotate(45deg);flex-shrink:0;" />
                            </div>

                            <div style="border-radius:8px;overflow:hidden;box-shadow:4px 4px 0 #C8B89A;border:1px solid #C9A84C;">
                                <table style="width:100%;border-collapse:collapse;font-family:Arial;">
                                    <thead>
                                        <tr style="background:#0A1628;">
                                            <th style="padding:12px 14px 20px;text-align:left;color:#C9A84C;font-size:12px;border-right:1px solid rgba(201,168,76,0.2);">S.No</th>
                                            <th style="padding:12px 14px 20px;text-align:center;color:#C9A84C;font-size:12px;border-right:1px solid rgba(201,168,76,0.2);">Project</th>
                                            <th style="padding:12px 14px 20px;text-align:center;color:#C9A84C;font-size:12px;border-right:1px solid rgba(201,168,76,0.2);">Leads</th>
                                            <th style="padding:12px 14px 20px;text-align:center;color:#C9A84C;font-size:12px;border-right:1px solid rgba(201,168,76,0.2);">CPL</th>
                                            <th style="padding:12px 14px 20px;text-align:center;color:#C9A84C;font-size:12px;border-right:1px solid rgba(201,168,76,0.2);">Amt Spent</th>
                                            <th style="padding:12px 14px 20px;text-align:center;color:#E8D5A3;font-size:12px;">Amt Spent (GST)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reportRows().map((row, i) => (
                                            <tr style={{ background: i % 2 === 0 ? "#F5EDD8" : "#FDF8EE" }}>
                                                <td style="padding:10px 14px 18px;font-size:12px;font-weight:bold;color:#0A1628;border-right:1px solid rgba(201,168,76,0.2);position:relative;">
                                                    <span style="position:absolute;left:0;top:0;bottom:0;width:3px;background:#C9A84C;" />
                                                    {i + 1}
                                                </td>
                                                <td style="padding:10px 14px 18px;text-align:center;font-size:12px;color:#1E3A5F;font-weight:bold;border-right:1px solid rgba(201,168,76,0.2);">
                                                    {row.projectName}
                                                </td>
                                                <td style="padding:10px 14px 18px;text-align:center;font-size:13px;font-weight:bold;color:#1E3A5F;border-right:1px solid rgba(201,168,76,0.2);">
                                                    {row.leads}
                                                </td>
                                                <td style="padding:10px 14px 18px;text-align:center;font-size:12px;color:#1E3A5F;border-right:1px solid rgba(201,168,76,0.2);">
                                                    {fmt(row.cpl)}
                                                </td>
                                                <td style="padding:10px 14px 18px;text-align:center;font-size:12px;color:#1E3A5F;border-right:1px solid rgba(201,168,76,0.2);">
                                                    {fmt(row.spent)}
                                                </td>
                                                <td style="padding:10px 14px 18px;text-align:center;font-size:12px;font-weight:bold;color:#7A5C1E;background:rgba(201,168,76,0.10);">
                                                    {fmt(row.spentWithGST)}
                                                </td>
                                            </tr>
                                        ))}
                                        {/* totals */}
                                        <tr style="background:#0A1628;">
                                            <td style="padding:12px 14px 20px;text-align:left;color:#C9A84C;font-size:12px;font-weight:bold;border-right:1px solid rgba(201,168,76,0.2);">TOTAL</td>
                                            <td style="padding:12px 14px 20px;border-right:1px solid rgba(201,168,76,0.2);" />
                                            <td style="padding:12px 14px 20px;text-align:center;color:#C9A84C;font-size:14px;font-weight:bold;border-right:1px solid rgba(201,168,76,0.2);">{totals().totalLeads}</td>
                                            <td style="padding:12px 14px 20px;text-align:center;color:#C9A84C;font-size:12px;font-weight:bold;border-right:1px solid rgba(201,168,76,0.2);">{fmt(totals().avgCPL)}</td>
                                            <td style="padding:12px 14px 20px;text-align:center;color:#C9A84C;font-size:12px;font-weight:bold;border-right:1px solid rgba(201,168,76,0.2);">{fmt(totals().totalSpent)}</td>
                                            <td style="padding:12px 14px 20px;text-align:center;color:#E8D5A3;font-size:12px;font-weight:bold;">{fmt(totals().totalSpentGST)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* footer */}
                        <div style="margin:24px 36px 0;padding-top:14px;border-top:1px solid rgba(201,168,76,0.4);display:flex;align-items:center;justify-content:space-between;">
                            <div style="width:8px;height:8px;background:#C9A84C;transform:rotate(45deg);" />
                            <p style="color:#645132;font-size:11px;font-family:Arial;letter-spacing:2px;text-align:center;margin:0;text-transform:uppercase;">
                                © {new Date().getFullYear()} Project Analytics · Aajneeti Connect Ltd.
                            </p>
                            <div style="width:8px;height:8px;background:#C9A84C;transform:rotate(45deg);" />
                        </div>

                    </div>
                </div>
            </div>

        </section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Card sub-component
// ─────────────────────────────────────────────────────────────────────────────
const colorMap = {
    blue: { card: "bg-blue-50 dark:bg-gray-800 border-blue-200 dark:border-gray-600", text: "text-blue-800 dark:text-gray-300", icon: "bg-blue-100 dark:bg-blue-300", iconColor: "text-blue-600 dark:text-blue-800" },
    purple: { card: "bg-purple-50 dark:bg-gray-800 border-purple-200 dark:border-gray-600", text: "text-purple-800 dark:text-gray-300", icon: "bg-purple-100 dark:bg-purple-300", iconColor: "text-purple-600 dark:text-purple-800" },
    red: { card: "bg-red-50 dark:bg-gray-800 border-red-200 dark:border-gray-600", text: "text-red-800 dark:text-gray-300", icon: "bg-red-100 dark:bg-red-300", iconColor: "text-red-600 dark:text-red-800" },
    orange: { card: "bg-orange-50 dark:bg-gray-800 border-orange-200 dark:border-gray-600", text: "text-orange-800 dark:text-gray-300", icon: "bg-orange-100 dark:bg-orange-300", iconColor: "text-orange-600 dark:text-orange-800" },
};

function SummaryCard(props) {
    const c = colorMap[props.color] ?? colorMap.blue;
    return (
        <div class={`${c.card} px-5 py-6 rounded-xl border shadow-sm hover:shadow-lg transition-all flex justify-between items-center gap-4`}>
            <div>
                <p class={`text-sm ${c.text}`}>{props.label}</p>
                <h3 class="text-xl font-semibold mt-1.5 dark:text-white">{props.value}</h3>
            </div>
            <div class={`p-3 rounded-lg ${c.icon} flex-shrink-0`}>
                <svg class={`w-5 h-5 ${c.iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    {props.icon}
                </svg>
            </div>
        </div>
    );
}