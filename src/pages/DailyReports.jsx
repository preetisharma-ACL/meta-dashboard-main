import { For, Show, createSignal, createMemo, onMount, batch } from "solid-js";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { fetchProjects } from "../services/dashboard";
import {
  fetchAllCampaigns,
  fetchBulkCampaignInsights,
} from "../services/campaigns";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import useRole, { clientRole } from "./../hooks/useRole";
import { createResource } from "solid-js"; // add to existing solid-js import
import { fetchBillingOverview } from "../services/billing-service";
const logoUrl = "/logo.webp";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (val) =>
  `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
  const [insightsMap, setInsightsMap] = createSignal({}); // projectId → [{date, leads, spend, …}]
  const [loading, setLoading] = createSignal(false);
  const [loadingInsights, setLoadingInsights] = createSignal(false);
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");
  const [showPreview, setShowPreview] = createSignal(false);
  const [previewGenerating, setPreviewGenerating] = createSignal(false);
  const { isRetainer, iscpl, ishybrid, isAdmin } = clientRole();

  // inside DailyReports(), near the other state:
  const [billingOverview] = createResource(() => fetchBillingOverview());
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
          status: item.status, // "active" | "paused"
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
    // Seed every project so it always emits a row, even with no campaigns.
    for (const project of projectList) {
      result[project.id] = { insights: [], status: "paused" };
    }

    // 1. Fetch ALL campaigns for the client in ONE paginated sweep, then group
    //    them by project_id locally (was: one /campaigns/?project=N per project).
    let allCampaigns = [];
    try {
      allCampaigns = await fetchAllCampaigns(1000);
    } catch (err) {
      console.error("DailyReports: failed to load campaigns", err);
    }

    const projectCampaigns = {};
    for (const c of allCampaigns) {
      const pid = c.project_id;
      if (pid == null) continue;
      if (!projectCampaigns[pid]) projectCampaigns[pid] = [];
      projectCampaigns[pid].push(c);
    }

    // Derive each project's status from its grouped campaigns.
    for (const project of projectList) {
      const camps = projectCampaigns[project.id] || [];
      const activeCampaigns = camps.filter(
        (c) => c.status?.toLowerCase() === "active",
      ).length;
      result[project.id].status = activeCampaigns > 0 ? "active" : "paused";
    }

    // 2. Build a campaign → {project, canonical id} lookup + the full ID list.
    const campaignById = {};
    const allCampaignIds = [];
    for (const project of projectList) {
      for (const c of projectCampaigns[project.id] || []) {
        campaignById[String(c.id)] = { campaign: c, projectId: project.id };
        allCampaignIds.push(c.id);
      }
    }

    // 3. ONE bulk insights call for every campaign across all projects
    //    (replaces the old per-campaign fetch loop — same fix as the dashboard).
    if (allCampaignIds.length > 0) {
      try {
        const bulk = await fetchBulkCampaignInsights(allCampaignIds);
        const rows = bulk.data || [];

        // 4. Group rows back onto their project. Synthetic (is_manual) rows are
        //    skipped to mirror the dashboard's handling. NOTE: this page has no
        //    separate manual-lead path, so confirm totals still match the old
        //    report — if they drop, remove this `is_manual` skip.
        for (const row of rows) {
          if (row.is_manual) continue;
          const entry = campaignById[String(row.campaign_id)];
          if (!entry) continue;
          result[entry.projectId].insights.push({
            ...row,
            campaignId: entry.campaign.id,
          });
        }
      } catch (err) {
        console.error("DailyReports: bulk insights error", err);
      }
    }

    setInsightsMap(result);
  };

  // Same defaults as the Billing page: SC 0 unless API says otherwise, GST 18.
  const monthSpendInfo = () => billingOverview()?.data?.month_spend || {};
  const scPct = () => Number(monthSpendInfo().service_charge_pct ?? 0);
  const gstPctNum = () => Number(monthSpendInfo().gst_pct ?? 18);
  const scMult = () => 1 + scPct() / 100;
  const gstMult = () => 1 + gstPctNum() / 100;
  const scColLabel = () => `Amt Spent + ${scPct()}% S.C`;
  const finalColLabel = () =>
    iscpl()
      ? `Amt Spent + ${gstPctNum()}% GST`
      : `Amt Spent + ${scPct()}% S.C + ${gstPctNum()}% GST`;

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
      const insights = insightsMap()[project.id]?.insights ?? []; // default [] so 0-row still emits

      const filtered =
        !from || !to
          ? insights
          : insights.filter((d) => {
              if (!d.date) return false;
              const date = normaliseDate(
                d.date.includes("T") ? d.date : d.date + "T00:00:00",
              );
              const start = normaliseDate(new Date(from));
              const end = new Date(to);
              end.setHours(23, 59, 59, 999);
              return date >= start && date <= end;
            });

      // ── Aggregate all filtered insight rows into one project total ─────
      const leads = filtered.reduce((s, d) => s + (d.leads || 0), 0);
      const spent = parseFloat(
        filtered.reduce((s, d) => s + parseFloat(d.spend || 0), 0).toFixed(2),
      );
      const cpl = leads > 0 ? parseFloat((spent / leads).toFixed(2)) : 0;
      const spentwithServiceCharge = parseFloat((spent * scMult()).toFixed(2));
      const spentwithservice_gst = parseFloat(
        (iscpl() ? spent * gstMult() : spent * scMult() * gstMult()).toFixed(2),
      );

      // Always push — even when leads === 0 and spent === 0
      rows.push({
        projectId: project.id,
        projectName: project.name,
        projectStatus: project.status,
        leads,
        cpl,
        spent,
        spentwithServiceCharge,
        spentwithservice_gst,
      });
    }

    // Sort alphabetically by project name (matches Main Dashboard feel)
    return rows.sort((a, b) => a.projectName.localeCompare(b.projectName));
  });

  /* ── footer totals ── */
  const totals = createMemo(() => {
    const rows = reportRows();
    const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
    const totalSpent = parseFloat(
      rows.reduce((s, r) => s + r.spent, 0).toFixed(2),
    );
    const totalspentwithServiceCharge = parseFloat(
      rows.reduce((s, r) => s + r.spentwithServiceCharge, 0).toFixed(2),
    );
    const totalspentwithservice_gst = parseFloat(
      rows.reduce((s, r) => s + r.spentwithservice_gst, 0).toFixed(2),
    );
    const avgCPL =
      totalLeads > 0 ? parseFloat((totalSpent / totalLeads).toFixed(2)) : 0;
    return {
      totalLeads,
      totalSpent,
      avgCPL,
      totalspentwithServiceCharge,
      totalspentwithservice_gst,
    };
  });

  /* ── range label ── */
  const rangeLabel = createMemo(() => {
    if (!fromDate() || !toDate()) return "All Dates";

    const from = normaliseDate(new Date(fromDate()));
    const to = normaliseDate(new Date(toDate()));

    // current date based ranges
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Last 3 Days = yesterday + previous 2 days
    const last3Start = new Date(today);
    last3Start.setDate(last3Start.getDate() - 3);

    // Last 7 Days
    const last7Start = new Date(today);
    last7Start.setDate(last7Start.getDate() - 7);

    // Today
    if (
      from.getTime() === today.getTime() &&
      to.getTime() === today.getTime()
    ) {
      return "Today";
    }

    // Yesterday
    if (
      from.getTime() === yesterday.getTime() &&
      to.getTime() === yesterday.getTime()
    ) {
      return "Yesterday";
    }

    // Last 3 Days
    if (
      from.getTime() === last3Start.getTime() &&
      to.getTime() === yesterday.getTime()
    ) {
      return "Last 3 Days";
    }

    // Last 7 Days
    if (
      from.getTime() === last7Start.getTime() &&
      to.getTime() === yesterday.getTime()
    ) {
      return "Last 7 Days";
    }

    return `${fmtDate(fromDate())} – ${fmtDate(toDate())}`;
  });

  const downloadPDF = async () => {
    const el = document.getElementById("pdf-daily-report");
    if (!el) return;

    const canvas = await html2canvas(el, {
      scale: 2, // keep 2 so text stays sharp; size is controlled by JPEG below
      backgroundColor: "#ffffff",
      useCORS: true, // lets the /logo.webp render into the canvas
    });

    // JPEG ~0.85 + jsPDF compression: this is where the size saving comes from
    const imgData = canvas.toDataURL("image/jpeg", 0.85);

    const pdf = new jsPDF({
      orientation: "p",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const pageW = 210;
    const pageH = 297;
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;

    // Multi-page: instead of squeezing the whole report onto one page (which is
    // what shrank and clipped your text), draw the full-height image and shift
    // it up by one page-height per page.
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH, undefined, "FAST");
    let remaining = imgH - pageH;

    while (remaining > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH, undefined, "FAST");
      remaining -= pageH;
    }

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
          <tr
            class={`border-t animate-pulse ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-purple-50 dark:bg-gray-900"}`}
          >
            <td class="p-3">
              <div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
            </td>
            <td class="p-3">
              <div class="h-4 w-36 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
            </td>
            <td class="p-3">
              <div class="h-4 w-10 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
            </td>
            <td class="p-3">
              <div class="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
            </td>
            <td class="p-3">
              <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
            </td>
            <td class="p-3">
              <div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
            </td>
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
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">
            Daily Reports
          </h1>
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
            <option value="active">Active Projects</option>
            <option value="paused">Paused Projects</option>
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
            batch(() => {
              setStatusFilter("all");
              setFromDate("");
              setToDate("");
              setShowPreview(false);
            });
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
            <span class="ml-3 text-gray-500 dark:text-gray-400">
              Loading project data…
            </span>
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
                <Show when={!iscpl()}>
                  <th class="p-3">Amount Spent</th>
                  <th class="p-3">{scColLabel()}</th>
                  <th class="p-3">{finalColLabel()}</th>
                </Show>
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
                          <svg
                            class="w-12 h-12 text-gray-300 dark:text-gray-600"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="1.5"
                              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          <p class="text-gray-500 dark:text-gray-400 font-medium">
                            No projects found
                          </p>
                          <p class="text-gray-400 dark:text-gray-500 text-xs">
                            Try adjusting the status filter or selecting a
                            different date range.
                          </p>
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
                            {fromDate() && toDate()
                              ? `${new Date(fromDate()).toLocaleDateString(
                                  "en-IN",
                                  {
                                    day: "numeric",
                                    month: "short",
                                  },
                                )} - ${new Date(toDate()).toLocaleDateString(
                                  "en-IN",
                                  {
                                    day: "numeric",
                                    month: "short",
                                  },
                                )}`
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
                        <Show when={!iscpl()}>
                          <td class="p-3 text-green-700 dark:text-green-400">
                            {fmt(row.spent)}
                          </td>

                          <td class="p-3 text-green-700 dark:text-green-400">
                            {fmt(row.spentwithServiceCharge)}
                          </td>

                          {/* spent + service charge + GST  */}
                          <td class="p-3 text-green-900 dark:text-green-400">
                            {fmt(row.spentwithservice_gst)}
                          </td>
                        </Show>
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
                    <Show when={!iscpl()}>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold">
                        {fmt(totals().totalSpent)}
                      </td>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold">
                        {fmt(totals().totalspentwithServiceCharge)}
                      </td>
                      <td class="p-3 text-green-900 dark:text-green-400 font-bold">
                        {fmt(totals().totalspentwithservice_gst)}
                      </td>
                    </Show>
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
                ? "bg-white text-purple-900 dark:text-gray-200 border-purple-900 dark:border-gray-600  dark:bg-gray-800 "
                : "border-purple-600 text-purple-700 dark:text-gray-100 bg-purple-50 dark:border-gray-600  dark:bg-gray-800  ")
          }
        >
          <Show
            when={!previewGenerating()}
            fallback={
              <div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
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
              : "bg-purple-900 hover:bg-purple-700 border dark:border-gray-600  dark:bg-gray-800  dark:text-gray-200 text-white hover:shadow-md")
          }
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4"
            />
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
      {/* ════════════════════════════════════════════════════════
        PREVIEW PANEL  (in-page white + minimal maroon report)
    ════════════════════════════════════════════════════════ */}
      <Show when={showPreview()}>
        <div class="mt-8 rounded-2xl border border-[rgba(123,28,28,0.15)] overflow-hidden shadow-lg bg-white">
          {/* ── HEADER: white background so maroon logo shows clearly ── */}
          <div class="relative bg-white px-8 py-6 border-b-[3px] border-[#7B1C1C]">
            {/* top maroon bar */}
            <div class="absolute top-0 left-0 right-0 h-[4px] bg-[#7B1C1C]" />

            <div class="flex items-center gap-5 relative">
              {/* Logo mark — replace inner content with your actual <img> tag */}
              <div class="w-[120px]  flex items-center justify-center flex-shrink-0">
                <img
                  src={logoUrl}
                  alt="Aajneeti Connect"
                  class="w-full h-full object-contain p-1"
                />
              </div>

              {/* Title block */}
              <div class="flex-1">
                <p class="text-[#7B1C1C] text-[14px] tracking-[0.18em] uppercase font-semibold mb-1">
                  Aajneeti Connect Ltd.
                </p>
                <h2 class="text-[#1a1a1a] text-2xl font-bold tracking-[0.05em] uppercase font-serif">
                  Daily Report
                </h2>
                <p class="text-[#888] text-xs mt-0.5 tracking-wide">
                  {rangeLabel()} &nbsp;·&nbsp; Generated on{" "}
                  {new Date().toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>

              {/* Period badge */}
              <div class="bg-[#f9f0f0] border border-[rgba(123,28,28,0.15)] rounded-lg px-4 py-2 text-center">
                <p class="text-[10px] text-[#999] tracking-[0.1em] uppercase">
                  Period
                </p>
                <p class="text-[13px] font-semibold text-[#7B1C1C] mt-0.5">
                  {new Date().toLocaleDateString("en-GB", {
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* ── TABLE ── */}
          <div class="overflow-x-auto bg-white">
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr class="bg-[#7B1C1C]">
                  <th class="px-4 py-3 text-left text-white text-md  uppercase font-semibold border-r border-white/10">
                    Date
                  </th>
                  <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                    Project
                  </th>
                  <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                    Leads
                  </th>
                  <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                    CPL
                  </th>
                  <Show when={!iscpl()}>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      Amount Spent
                    </th>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      {scColLabel()}
                    </th>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      {finalColLabel()}
                    </th>
                  </Show>
                </tr>
              </thead>
              <tbody>
                <For each={reportRows()}>
                  {(row, i) => (
                    <tr
                      class="border-b border-[rgba(123,28,28,0.1)]"
                      style={{
                        background: i() % 2 === 0 ? "#ffffff" : "#fafafa",
                      }}
                    >
                      {/* Date — maroon left accent */}
                      <td class="px-4 py-3 text-left relative whitespace-nowrap border-r border-[rgba(123,28,28,0.1)]">
                        <span class="absolute left-0 top-0 bottom-0 w-[3px] bg-[#7B1C1C]" />
                        <span class="font-semibold text-[#1a1a1a] text-md">
                          {fromDate() && toDate()
                            ? `${new Date(fromDate()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} - ${new Date(toDate()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                            : new Date().toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                              })}
                        </span>
                      </td>
                      {/* Project */}
                      <td class="px-4 py-3 text-center text-[#333] font-medium text-md whitespace-nowrap border-r border-[rgba(123,28,28,0.1)]">
                        {row.projectName}
                      </td>
                      {/* Leads — maroon accent */}
                      <td class="px-4 py-3 text-center font-bold text-[#7B1C1C] text-md border-r border-[rgba(123,28,28,0.1)]">
                        {row.leads}
                      </td>
                      <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                        {fmt(row.cpl)}
                      </td>
                      <Show when={!iscpl()}>
                        <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                          {fmt(row.spent)}
                        </td>
                        {/* GST — warm gold tint */}
                        <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                          {fmt(row.spentwithServiceCharge)}
                        </td>
                        <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                          {fmt(row.spentwithservice_gst)}
                        </td>
                      </Show>
                    </tr>
                  )}
                </For>
              </tbody>
              {/* totals row */}
              <tfoot>
                <tr class="bg-[#7B1C1C]">
                  <td class="px-4 py-3 text-left text-white font-bold text-[10.5px] tracking-widest uppercase border-r border-white/10">
                    Total
                  </td>
                  <td class="px-4 py-3 border-r border-white/10" />
                  <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                    {totals().totalLeads}
                  </td>
                  <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                    {fmt(totals().avgCPL)}
                  </td>
                  <Show when={!iscpl()}>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {fmt(totals().totalSpent)}
                    </td>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {fmt(totals().totalspentwithServiceCharge)}
                    </td>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {fmt(totals().totalspentwithservice_gst)}
                    </td>
                  </Show>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── FOOTER ── */}
          <div class="bg-white border-t border-[rgba(123,28,28,0.15)] px-8 py-3 flex items-center justify-between">
            <div class="w-[6px] h-[6px] bg-[#7B1C1C] rotate-45" />
            <p class="text-[#aaa] text-[10.5px] tracking-[0.18em] uppercase font-medium">
              © {new Date().getFullYear()} Project Analytics · Aajneeti Connect
              Ltd.
            </p>
            <div class="w-[6px] h-[6px] bg-[#7B1C1C] rotate-45" />
          </div>
        </div>
      </Show>

      {/* ════════════════════════════════════════════════════════
        HIDDEN PDF TEMPLATE  (off-screen, captured by html2canvas)
    ════════════════════════════════════════════════════════ */}
      <div
        id="pdf-daily-report"
        style="position:absolute;left:-9999px;top:0;width:900px;"
      >
        <div style="width:900px;background:#ffffff;font-family:Arial,sans-serif;position:relative;box-sizing:border-box;border:1px solid rgba(123,28,28,0.15);border-radius:12px;overflow:hidden;">
          {/* ── PDF HEADER: white so maroon logo is visible ── */}
          <div style="background:#ffffff;border-bottom:3px solid #7B1C1C;padding:28px 40px 24px;position:relative;display:flex;align-items:center;gap:20px;">
            {/* top maroon bar */}
            <div style="position:absolute;top:0;left:0;right:0;height:4px;background:#7B1C1C;" />

            {/* Logo box — swap the inner span for your <img> */}
            <div style="width:120px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <img
                src={logoUrl}
                alt="Aajneeti Connect"
                style="width:100%;height:100%;object-fit:contain;padding:4px;"
              />
            </div>

            {/* Title */}
            <div style="flex:1;">
              <p style="color:#7B1C1C;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;font-weight:600;margin:0 0 4px;">
                Aajneeti Connect Ltd.
              </p>
              <h1 style="color:#1a1a1a;font-size:26px;font-family:Georgia,serif;letter-spacing:2px;margin:0 0 4px;font-weight:700;text-transform:uppercase;">
                Daily Report
              </h1>
              <p style="color:#888;font-size:12px;margin:0;letter-spacing:1px;">
                {rangeLabel()} &nbsp;·&nbsp; Generated on:{" "}
                {new Date().toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>

            {/* Period badge */}
            <div style="background:#f9f0f0;border:1px solid rgba(123,28,28,0.15);border-radius:8px;padding:8px 16px;text-align:center;">
              <p style="font-size:10px;color:#999;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 2px;">
                Period
              </p>
              <p style="font-size:13px;font-weight:600;color:#7B1C1C;margin:0;">
                {new Date().toLocaleDateString("en-GB", {
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>

          {/* ── PDF TABLE ── */}
          <div style="padding:28px 36px 0;">
            {/* section label */}
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
              <div style="width:6px;height:6px;background:#7B1C1C;transform:rotate(45deg);flex-shrink:0;" />
              <div style="flex:1;height:1px;background:rgba(123,28,28,0.2);" />
              <div style="background:#7B1C1C;padding:5px 14px;padding-bottom:20px;border-radius:20px;">
                <span style="color:#fff;font-size:10px;font-family:Arial;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;">
                  DETAILED BREAKDOWN
                </span>
              </div>
              <div style="flex:1;height:1px;background:rgba(123,28,28,0.2);" />
              <div style="width:6px;height:6px;background:#7B1C1C;transform:rotate(45deg);flex-shrink:0;" />
            </div>

            <div style="border-radius:8px;overflow:hidden;border:1px solid rgba(123,28,28,0.2);box-shadow:3px 3px 0 rgba(123,28,28,0.08);">
              <table style="width:100%;border-collapse:collapse;font-family:Arial;">
                <thead>
                  <tr style="background:#7B1C1C;">
                    <th style="padding:11px 14px;text-align:left;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                      Date
                    </th>
                    <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                      Project
                    </th>
                    <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                      Leads
                    </th>
                    <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                      CPL
                    </th>
                    <Show when={!iscpl()}>
                      <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        Amt Spent
                      </th>
                      <th style="padding:11px 14px;text-align:center;color:#f5d9a0;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;">
                        {scColLabel()}
                      </th>
                      <th style="padding:11px 14px;text-align:center;color:#f5d9a0;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;">
                        {finalColLabel()}
                      </th>
                    </Show>
                  </tr>
                </thead>
                <tbody>
                  {reportRows().map((row, i) => (
                    <tr
                      style={{
                        background: i % 2 === 0 ? "#ffffff" : "#fafafa",
                        borderBottom: "1px solid rgba(123,28,28,0.08)",
                      }}
                    >
                      <td style="padding:10px 14px;font-size:14px;font-weight:600;color:#1a1a1a;border-right:1px solid rgba(123,28,28,0.1);border-left:3px solid #7B1C1C;">
                        {fromDate() && toDate()
                          ? `${new Date(fromDate()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} - ${new Date(toDate()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                          : new Date().toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                      </td>
                      <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;font-weight:500;border-right:1px solid rgba(123,28,28,0.1);">
                        {row.projectName}
                      </td>
                      <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:700;color:#7B1C1C;border-right:1px solid rgba(123,28,28,0.1);">
                        {row.leads}
                      </td>
                      <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                        {fmt(row.cpl)}
                      </td>
                      <Show when={!iscpl()}>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                          {fmt(row.spent)}
                        </td>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#6b4c10;background:rgba(201,168,76,0.10);">
                          {fmt(row.spentwithServiceCharge)}
                        </td>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#6b4c10;background:rgba(201,168,76,0.10);">
                          {fmt(row.spentwithservice_gst)}
                        </td>
                      </Show>
                    </tr>
                  ))}
                  {/* totals */}
                  <tr style="background:#7B1C1C;">
                    <td style="padding:11px 14px;text-align:left;color:#fff;font-size:10.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                      Total
                    </td>
                    <td style="padding:11px 14px;border-right:1px solid rgba(255,255,255,0.12);" />
                    <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                      {totals().totalLeads}
                    </td>
                    <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                      {fmt(totals().avgCPL)}
                    </td>
                    <Show when={!iscpl()}>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {fmt(totals().totalSpent)}
                      </td>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;">
                        {fmt(totals().totalspentwithServiceCharge)}
                      </td>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {fmt(totals().totalspentwithservice_gst)}
                      </td>
                    </Show>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── PDF FOOTER ── */}
          <div style="margin:20px 36px 28px;padding-top:12px;border-top:1px solid rgba(123,28,28,0.2);display:flex;align-items:center;justify-content:space-between;">
            <div style="width:6px;height:6px;background:#7B1C1C;transform:rotate(45deg);" />
            <p style="color:#aaa;font-size:10.5px;font-family:Arial;letter-spacing:2px;text-align:center;margin:0;text-transform:uppercase;">
              © {new Date().getFullYear()} Project Analytics · Aajneeti Connect
              Ltd.
            </p>
            <div style="width:6px;height:6px;background:#7B1C1C;transform:rotate(45deg);" />
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
  blue: {
    card: "bg-blue-50 dark:bg-gray-800 border-blue-200 dark:border-gray-600",
    text: "text-blue-800 dark:text-gray-300",
    icon: "bg-blue-100 dark:bg-blue-300",
    iconColor: "text-blue-600 dark:text-blue-800",
  },
  purple: {
    card: "bg-purple-50 dark:bg-gray-800 border-purple-200 dark:border-gray-600",
    text: "text-purple-800 dark:text-gray-300",
    icon: "bg-purple-100 dark:bg-purple-300",
    iconColor: "text-purple-600 dark:text-purple-800",
  },
  red: {
    card: "bg-red-50 dark:bg-gray-800 border-red-200 dark:border-gray-600",
    text: "text-red-800 dark:text-gray-300",
    icon: "bg-red-100 dark:bg-red-300",
    iconColor: "text-red-600 dark:text-red-800",
  },
  orange: {
    card: "bg-orange-50 dark:bg-gray-800 border-orange-200 dark:border-gray-600",
    text: "text-orange-800 dark:text-gray-300",
    icon: "bg-orange-100 dark:bg-orange-300",
    iconColor: "text-orange-600 dark:text-orange-800",
  },
};
