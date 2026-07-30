import {
  createSignal,
  createResource,
  createMemo,
  For,
  Show,
  batch,
} from "solid-js";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { DateRangeFilter } from "../components/DateRangeFilter";
import {
  fetchHierarchyClients,
  fetchHierarchyProjects,
  fetchAllCampaignsScoped,
} from "../services/cm";
import { fetchProjects } from "../services/dashboard";
import {
  fetchFedLeadBatches,
  fedLeadsByProject,
  fmtFed,
} from "../services/fedLeads";
import { scopeKey } from "../stores/cmScope";
import { currentUser } from "../stores/currentUser";

const logoUrl = "/logo.webp";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (mirror the client-facing DailyReports page)
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (val) =>
  `₹${Number(val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (v) => (Number(v) || 0).toLocaleString("en-IN");

// Premium CPL (marked-up) may be absent for a project → render an em dash
// rather than "₹0.00" so it reads as "no premium attribution" not "free".
const fmtPrem = (v) => (v == null ? "—" : fmt(v));

const fmtDate = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const today = () => new Date().toISOString().split("T")[0];

// A far-back window so the dropdown lists every client the CM is assigned to,
// not just ones active in the server's default 14-day window.
const CLIENT_LOOKBACK = "2020-01-01";

// Premium (marked-up) attribution only exists from this date on — the markup
// config didn't exist before it, so premium_metrics is empty for earlier days.
// We clamp the premium campaign fetch's start to this floor, exactly like the
// ClientDashboard / ProjectDetails ledgers, so the numbers line up.
const PREMIUM_FLOOR = "2026-04-01";

// project nodes expose avg_cpl; campaign leaves expose cpl.
const cplOf = (g) => (g?.cpl != null ? g.cpl : g?.avg_cpl);

const TYPE_CHIP = {
  hybrid:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

export default function CMDailyReport() {
  // ── Filter state ──────────────────────────────────────────────────────────
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");
  const [selectedClientId, setSelectedClientId] = createSignal("");
  const [clientQuery, setClientQuery] = createSignal(""); // searchable dropdown text
  const [clientOpen, setClientOpen] = createSignal(false);
  const [statusFilter, setStatusFilter] = createSignal("all"); // all | active | paused
  const [activePreset, setActivePreset] = createSignal(null);

  // ── Report state ──────────────────────────────────────────────────────────
  const [report, setReport] = createSignal(null); // { client, projects, from, to }
  const [generating, setGenerating] = createSignal(false);
  const [genError, setGenError] = createSignal(false);
  const [showPreview, setShowPreview] = createSignal(false);
  const [previewGenerating, setPreviewGenerating] = createSignal(false);
  const [exportOpen, setExportOpen] = createSignal(false);

  // Include the raw (agency-cost) columns — Raw CPL + Raw Amount Spent — in the
  // on-screen table AND all downloads. ON by default = internal report (shows
  // cost/margin); untick for a client-facing report (Premium CPL + Client Billed
  // only), safe to share with the client.
  const [includeRaw, setIncludeRaw] = createSignal(true);

  // Per-column visibility for the two money columns — "Spent" (premium spend)
  // and "Client Billed (incl S.C + GST)". Independent of includeRaw (which
  // governs the RAW cost columns): a client-facing report may want leads + CPL
  // only, or billed without the spend line. Applies to the on-screen table, the
  // preview, the PDF template and every download.
  const [showSpent, setShowSpent] = createSignal(true);
  const [showBilled, setShowBilled] = createSignal(true);

  // ── Assigned clients for the dropdown ─────────────────────────────────────
  // Server-scoped + switch-mode aware: the backend only returns clients this CM
  // is authorised to see, so we never filter by role on the client. Keyed on
  // scopeKey so the list refreshes if the CM changes switch scope.
  const [clientsRes] = createResource(scopeKey, async () => {
    try {
      const res = await fetchHierarchyClients({
        startDate: CLIENT_LOOKBACK,
        endDate: today(),
      });
      return Array.isArray(res?.data) ? res.data : [];
    } catch (err) {
      console.error("[CMDailyReport] clients failed:", err);
      return [];
    }
  });

  const clients = () => clientsRes() ?? [];
  const selectedClient = createMemo(() =>
    clients().find(
      (c) => String(c.client_nomen_id) === String(selectedClientId()),
    ),
  );

  // ── Searchable client dropdown (combobox) ─────────────────────────────────
  const filteredClients = createMemo(() => {
    const q = clientQuery().trim().toLowerCase();
    const list = clients();
    if (!q) return list;
    return list.filter((c) =>
      (c.client_name || "").toLowerCase().includes(q),
    );
  });

  const selectClientOption = (c) => {
    batch(() => {
      setSelectedClientId(c.client_nomen_id);
      setClientQuery(c.client_name || "");
      setClientOpen(false);
    });
  };

  const clearClient = () => {
    batch(() => {
      setSelectedClientId("");
      setClientQuery("");
      setClientOpen(true);
    });
  };

  // ── Scoped campaigns (once per switch scope) ──────────────────────────────
  // The hierarchy project node has no status, so we derive each project's
  // active/paused state from the CM's campaigns (a project is "active" if it
  // has ≥1 active campaign — same rule the client Daily Report uses). Fetched
  // once and reused across generates; date-independent because status is a
  // current attribute, not a per-day value.
  const [campaignsRes] = createResource(scopeKey, async () => {
    try {
      const res = await fetchAllCampaignsScoped({});
      return Array.isArray(res?.data) ? res.data : [];
    } catch (err) {
      console.error("[CMDailyReport] campaigns failed:", err);
      return [];
    }
  });

  // ── Fed (manually-uploaded) lead batches ──────────────────────────────────
  // Fetched ONCE per switch scope and reused for every generate — the endpoint
  // has no date filter, so the report's range is applied client-side. The
  // backend auto-scopes it to the CM's visible clients; we then join by project
  // id against the selected client's own hierarchy rows, so no other client's
  // batch can reach this report. A failure degrades to "no fed leads".
  const [fedBatchesRes] = createResource(scopeKey, async () => {
    try {
      return await fetchFedLeadBatches();
    } catch (err) {
      console.error("[CMDailyReport] fed lead batches failed:", err);
      return [];
    }
  });

  // { [projectId]: fedLeads } for the GENERATED report's range (not the live
  // pickers) so the table can't drift from the range in its own header.
  const fedByProject = createMemo(() => {
    const r = report();
    if (!r) return {};
    return fedLeadsByProject(fedBatchesRes() ?? [], r.from, r.to);
  });

  // Per-project active/paused lookup for the currently-generated client. Keyed
  // by project_id AND normalised project_name so it matches the hierarchy rows
  // regardless of which key the campaign list carries.
  const statusInfo = createMemo(() => {
    const r = report();
    const camps = campaignsRes();
    if (!r || !camps) return null;
    const cid = String(r.client.client_nomen_id);
    const byId = {};
    const byName = {};
    for (const c of camps) {
      if (String(c.client_nomen) !== cid) continue;
      const idk = c.project_id != null ? String(c.project_id) : null;
      const nk = (c.project_name || "").trim().toLowerCase();
      const active = String(c.status).toLowerCase() === "active";
      if (idk) {
        if (!byId[idk]) byId[idk] = { active: 0, total: 0 };
        byId[idk].total += 1;
        if (active) byId[idk].active += 1;
      }
      if (nk) {
        if (!byName[nk]) byName[nk] = { active: 0, total: 0 };
        byName[nk].total += 1;
        if (active) byName[nk].active += 1;
      }
    }
    return { byId, byName };
  });

  // "active" | "paused" | null (null = no campaign data matched → not filtered).
  const statusOfProject = (p) => {
    const info = statusInfo();
    if (!info) return null;
    const e =
      info.byId[String(p.project_id)] ||
      info.byName[(p.project_name || "").trim().toLowerCase()];
    if (!e) return null;
    return e.active > 0 ? "active" : "paused";
  };

  // ── Per-project premium (marked-up) spend/leads lookup ──────────────────────
  // Aggregated from the range-scoped premium campaigns captured at generate
  // time. Keyed by project_id AND normalised project_name, mirroring statusInfo,
  // so it matches the hierarchy rows regardless of which key the campaign carries.
  const premiumInfo = createMemo(() => {
    const r = report();
    if (!r) return null;
    const camps = r.premiumCampaigns || [];
    const cid = String(r.client.client_nomen_id);
    const byId = {};
    const byName = {};
    for (const c of camps) {
      if (String(c.client_nomen) !== cid) continue;
      const pm = c.premium_metrics;
      if (!pm || pm.spend == null || pm.leads_count == null) continue;
      const spend = Number(pm.spend) || 0;
      const leads = Number(pm.leads_count) || 0;
      const idk = c.project_id != null ? String(c.project_id) : null;
      const nk = (c.project_name || "").trim().toLowerCase();
      if (idk) {
        if (!byId[idk]) byId[idk] = { spend: 0, leads: 0 };
        byId[idk].spend += spend;
        byId[idk].leads += leads;
      }
      if (nk) {
        if (!byName[nk]) byName[nk] = { spend: 0, leads: 0 };
        byName[nk].spend += spend;
        byName[nk].leads += leads;
      }
    }
    return { byId, byName };
  });

  // { spend, leads } of premium attribution for a project (zeros = none matched).
  const premiumOfProject = (p) => {
    const info = premiumInfo();
    if (!info) return { spend: 0, leads: 0 };
    return (
      info.byId[String(p.project_id)] ||
      info.byName[(p.project_name || "").trim().toLowerCase()] || {
        spend: 0,
        leads: 0,
      }
    );
  };

  const canGenerate = () =>
    !!selectedClientId() && !!fromDate() && !!toDate() && !generating();

  // ── Client-type gate (drives which columns show, exactly like the client's
  //    own Daily Report where iscpl() hides the spend columns). Keyed to the
  //    SELECTED client's type, not the logged-in user's. ─────────────────────
  const clientType = () => (report()?.client?.client_type || "").toLowerCase();
  const iscpl = () => clientType() === "cpl";

  // Raw (agency-cost) columns render — on-screen AND in every download — only
  // when the "Include raw" toggle is on. Off → client-facing report (no raw).
  const showRaw = () => includeRaw();

  // Per-client service charge (fetched at generate → report.serviceCharge) drives
  // the fully-loaded "Client Billed (incl S.C & GST)" column: Premium Spent ×
  // (1 + S.C%) × 1.18. GST is a flat 18%. Never hardcoded — falls back to 0% S.C
  // only if the rate couldn't be fetched (shows GST-only, not a fabricated rate).
  const scRate = () => Number(report()?.serviceCharge ?? 0);
  const billedInclLabel = () =>
    `Client Billed (incl ${scRate()}% S.C + 18% GST)`;
  const billedIncl = (billed) =>
    parseFloat((billed * (1 + scRate() / 100) * 1.18).toFixed(2));

  // ── Quick-pick presets (same semantics as the CM dashboard pills) ─────────
  const setPreset = (value) => {
    const now = new Date();
    const toStr = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    };
    let from = new Date();
    let to = new Date();
    switch (value) {
      case "today":
        break;
      case "yesterday":
        from.setDate(now.getDate() - 1);
        to = new Date(from);
        break;
      case "last7":
        to.setDate(now.getDate() - 1);
        from.setDate(now.getDate() - 7);
        break;
      case "thisMonth":
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "lastMonth":
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      default:
        break;
    }
    batch(() => {
      setActivePreset(value);
      setFromDate(toStr(from));
      setToDate(toStr(to));
    });
  };

  // ── Generate ──────────────────────────────────────────────────────────────
  const generate = async () => {
    if (!canGenerate()) return;
    const client = selectedClient();
    const from = fromDate();
    const to = toDate();
    setGenerating(true);
    setGenError(false);
    setShowPreview(false);
    try {
      const res = await fetchHierarchyProjects(client.client_nomen_id, {
        startDate: from,
        endDate: to,
      });
      const projects = Array.isArray(res?.data) ? res.data : [];

      // ── Premium (marked-up) campaigns for the SAME range ──────────────────
      // premium_metrics is server-computed per date window, so it must be
      // fetched for the report's own range (NOT reused from campaignsRes, which
      // is lifetime-scoped for status only). Start is clamped to PREMIUM_FLOOR;
      // if the whole range predates the floor there's no premium to fetch.
      // A premium failure must NOT sink the report — fall back to no premium.
      let premiumCampaigns = [];
      if (to >= PREMIUM_FLOOR) {
        try {
          const premRes = await fetchAllCampaignsScoped({
            startDate: from > PREMIUM_FLOOR ? from : PREMIUM_FLOOR,
            endDate: to,
          });
          premiumCampaigns = Array.isArray(premRes?.data) ? premRes.data : [];
        } catch (err) {
          console.error("[CMDailyReport] premium campaigns failed:", err);
        }
      }

      // Per-client service charge for the "Client Billed (incl S.C & GST)"
      // column. The hierarchy response carries no S.C rate, so fetch it the way
      // the admin daily report does: /projects/?client_id=<Client PK> →
      // meta.report_summary.service_charge. The Client PK isn't on report.client
      // (only client_nomen_id) — it rides on the campaign rows.
      //
      // IMPORTANT: premiumCampaigns is the CM's WHOLE scope (every assigned
      // client — fetchAllCampaignsScoped takes no client filter), so the PK MUST
      // be scavenged from a campaign belonging to the SELECTED client. The old
      // code took the first campaign with any client_id, which could hand back a
      // DIFFERENT client's PK (→ wrong S.C) or, if that field is absent, null
      // (→ silent 0% S.C). Match on client_nomen first, then read the PK from
      // premium_metrics.client_id, falling back to a top-level client_id if the
      // backend exposes it there instead.
      let serviceCharge = null;
      const cid = String(client.client_nomen_id);
      const ownRows = premiumCampaigns.filter(
        (c) => String(c.client_nomen) === cid,
      );
      const clientPK =
        ownRows.find((c) => c?.premium_metrics?.client_id != null)
          ?.premium_metrics?.client_id ??
        ownRows.find((c) => c?.client_id != null)?.client_id ??
        null;
      if (clientPK != null) {
        try {
          const projRes = await fetchProjects(1, "", 20, clientPK);
          serviceCharge = projRes?.meta?.report_summary?.service_charge ?? null;
          if (serviceCharge == null) {
            console.warn(
              "[CMDailyReport] /projects/?client_id=%s returned no report_summary.service_charge (backend did not surface the S.C rate for this CM token).",
              clientPK,
            );
          }
        } catch (err) {
          console.error("[CMDailyReport] service charge fetch failed:", err);
        }
      } else {
        console.warn(
          "[CMDailyReport] could not resolve a Client PK for '%s' (client_nomen=%s): no campaign in the CM scope carries premium_metrics.client_id / client_id. Falling back to 0%% S.C.",
          client.client_name,
          cid,
        );
      }
      setReport({ client, projects, from, to, premiumCampaigns, serviceCharge });
    } catch (err) {
      console.error("[CMDailyReport] project report failed:", err);
      setGenError(true);
      setReport(null);
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => {
    batch(() => {
      setSelectedClientId("");
      setClientQuery("");
      setClientOpen(false);
      setFromDate("");
      setToDate("");
      setStatusFilter("all");
      setActivePreset(null);
      setReport(null);
      setGenError(false);
      setShowPreview(false);
    });
  };

  // ── Report rows ────────────────────────────────────────────────────────────
  // Leads/CPL/Amount-Spent come from the raw (actual) figures, exactly like the
  // client report. "Client Billed" is the client-facing total (spend + service
  // charge + GST, applied server-side) — the equivalent of the client report's
  // final "Amt Spent + S.C + GST" column.
  const reportRows = createMemo(() => {
    const sf = statusFilter();
    const fed = fedByProject();
    return (report()?.projects ?? [])
      .map((p) => {
        const raw = p.raw ?? {};
        const billed = p.client_facing ?? {};
        const leads = Number(raw.leads) || 0;
        // Fed leads for this project in the report's range. Kept in its own
        // field and its own column: the client's dashboard counts Meta + fed,
        // so a Meta-only report reads short — but folding fed into `leads`
        // would hide where the difference came from (and would corrupt CPL,
        // which is cost per Meta lead).
        const fedLeads = fed[String(p.project_id)] || 0;
        const spent = parseFloat(raw.spend) || 0;
        const cpl = leads > 0 ? parseFloat((spent / leads).toFixed(2)) : 0;
        const billedSpend = parseFloat(billed.spend) || 0;
        // Premium CPL = Σ premium spend ÷ Σ premium leads for this project
        // (aggregated, never an average of per-campaign CPLs). null when the
        // project has no premium attribution in the range.
        const prem = premiumOfProject(p);
        const premiumCpl =
          prem.leads > 0
            ? parseFloat((prem.spend / prem.leads).toFixed(2))
            : null;
        return {
          projectId: p.project_id,
          projectName: p.project_name,
          campaigns: Number(p.campaign_count) || 0,
          leads,
          fedLeads,
          totalLeads: leads + fedLeads,
          cpl,
          premiumCpl,
          premiumSpend: prem.spend,
          premiumLeads: prem.leads,
          spent,
          billed: billedSpend,
          status: statusOfProject(p),
        };
      })
      .filter((r) => {
        // ── Date-range visibility (matches the client Daily Report) ──────────
        // The hierarchy call is date-windowed server-side, so a project's
        // figures already reflect ONLY the selected range. A project that
        // wasn't running in the range therefore has zero leads AND zero spend —
        // drop it so, e.g., "This Month" never shows last month's projects and
        // "Last Month" shows only last-month activity. Fed leads count as
        // activity too: a project whose only delivery in the range was a fed
        // batch is on the client's dashboard, so it has to be on this report.
        if (r.leads === 0 && r.spent === 0 && r.fedLeads === 0) return false;

        // ── Status filter (active / paused) ─────────────────────────────────
        // Unknown status (no matched campaign data) is kept so we never hide
        // real activity behind a missing-status gap.
        if (sf !== "all" && r.status != null && r.status !== sf) return false;

        return true;
      });
  });

  const totals = createMemo(() => {
    const rows = reportRows();
    const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
    const totalFedLeads = rows.reduce((s, r) => s + r.fedLeads, 0);
    const totalSpent = parseFloat(
      rows.reduce((s, r) => s + r.spent, 0).toFixed(2),
    );
    const totalBilled = parseFloat(
      rows.reduce((s, r) => s + r.billed, 0).toFixed(2),
    );
    // Fully-loaded total = Σ per-row (Premium Spent + S.C + GST), so it matches
    // the sum of the displayed rows.
    const totalBilledIncl = parseFloat(
      rows.reduce((s, r) => s + billedIncl(r.billed), 0).toFixed(2),
    );
    const totalCampaigns = rows.reduce((s, r) => s + r.campaigns, 0);
    const avgCPL =
      totalLeads > 0 ? parseFloat((totalSpent / totalLeads).toFixed(2)) : 0;
    // Premium CPL total: Σ premium spend ÷ Σ premium leads across all rows
    // (aggregated, matching the per-row rule). null when nothing premium-matched.
    const premiumSpend = rows.reduce((s, r) => s + (r.premiumSpend || 0), 0);
    const premiumLeads = rows.reduce((s, r) => s + (r.premiumLeads || 0), 0);
    const avgPremiumCPL =
      premiumLeads > 0
        ? parseFloat((premiumSpend / premiumLeads).toFixed(2))
        : null;
    return {
      totalLeads,
      totalFedLeads,
      // Total = Meta + fed. This is the figure that has to match what the
      // client sees on their own dashboard for the same client and range.
      totalAllLeads: totalLeads + totalFedLeads,
      totalSpent,
      totalBilled,
      totalBilledIncl,
      totalCampaigns,
      avgCPL,
      avgPremiumCPL,
    };
  });

  // ── Labels ─────────────────────────────────────────────────────────────────
  const rangeLabel = () => {
    const r = report();
    if (!r) return "All Dates";
    if (r.from === r.to) return fmtDate(r.from);
    return `${fmtDate(r.from)} – ${fmtDate(r.to)}`;
  };

  // Short "10 Jul - 12 Jul" label used inside each table Date cell.
  const dateCellLabel = () => {
    const r = report();
    if (!r) return "";
    const short = (d) =>
      new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      });
    return r.from === r.to ? short(r.from) : `${short(r.from)} - ${short(r.to)}`;
  };

  // ── Exports ───────────────────────────────────────────────────────────────
  const exportFileBase = () => {
    const name = (report()?.client?.client_name || "client")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return `daily-report-${name}-${today()}`;
  };

  const exportColumns = () => {
    const cols = ["Date", "Project"];
    if (showRaw()) cols.push("Meta Leads", "Fed Leads");
    cols.push("Total Leads");
    if (showRaw()) cols.push("Raw CPL");
    cols.push("Premium CPL");
    if (!iscpl()) {
      if (showRaw()) cols.push("Raw Amount Spent");
      if (showSpent()) cols.push("Premium Spent");
      if (showBilled()) cols.push(billedInclLabel());
    }
    return cols;
  };
  const exportRow = (r) => {
    // Numeric in exports (not the "+N" display form) so the columns stay
    // sum-able in Excel; Total is always Meta + Fed.
    const base = [dateCellLabel(), r.projectName];
    if (showRaw()) base.push(r.leads, r.fedLeads);
    base.push(r.totalLeads);
    if (showRaw()) base.push(r.cpl);
    base.push(r.premiumCpl ?? "");
    if (!iscpl()) {
      if (showRaw()) base.push(r.spent);
      if (showSpent()) base.push(r.billed);
      if (showBilled()) base.push(billedIncl(r.billed));
    }
    return base;
  };
  const exportTotalsRow = () => {
    const t = totals();
    const base = ["TOTAL", ""];
    if (showRaw()) base.push(t.totalLeads, t.totalFedLeads);
    base.push(t.totalAllLeads);
    if (showRaw()) base.push(t.avgCPL);
    base.push(t.avgPremiumCPL ?? "");
    if (!iscpl()) {
      if (showRaw()) base.push(t.totalSpent);
      if (showSpent()) base.push(t.totalBilled);
      if (showBilled()) base.push(t.totalBilledIncl);
    }
    return base;
  };

  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadCSV = () => {
    const rows = reportRows();
    if (!rows.length) return;
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      exportColumns().join(","),
      ...rows.map((r) => exportRow(r).map(esc).join(",")),
      exportTotalsRow().map(esc).join(","),
    ];
    const blob = new Blob(["﻿" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    triggerDownload(blob, `${exportFileBase()}.csv`);
  };

  const downloadExcel = () => {
    const rows = reportRows();
    if (!rows.length) return;
    const meta = [
      ["Daily Report"],
      ["Client", report()?.client?.client_name || ""],
      ["Range", rangeLabel()],
      ["Generated", new Date().toLocaleString("en-IN")],
      [],
    ];
    const ws = XLSX.utils.aoa_to_sheet([
      ...meta,
      exportColumns(),
      ...rows.map(exportRow),
      exportTotalsRow(),
    ]);
    ws["!cols"] = exportColumns().map((_, i) => ({ wch: i === 1 ? 28 : 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily Report");
    XLSX.writeFile(wb, `${exportFileBase()}.xlsx`);
  };

  const downloadPDF = async () => {
    const el = document.getElementById("cm-pdf-daily-report");
    if (!el) return;
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
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
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH, undefined, "FAST");
    let remaining = imgH - pageH;
    while (remaining > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH, undefined, "FAST");
      remaining -= pageH;
    }
    pdf.save(`${exportFileBase()}.pdf`);
  };

  const runExport = (f) => {
    setExportOpen(false);
    if (f === "csv") downloadCSV();
    else if (f === "excel") downloadExcel();
    else if (f === "pdf") downloadPDF();
  };

  const handlePreview = () => {
    setPreviewGenerating(true);
    setTimeout(() => {
      setShowPreview((p) => !p);
      setPreviewGenerating(false);
    }, 80);
  };

  // Column span for empty/placeholder table rows.
  // Base: Date, Project, Total Leads, Premium CPL. Meta Leads / Fed Leads / Raw
  // CPL (+ Raw Amount Spent when !cpl) ride showRaw(); Spent and Client Billed
  // ride their own per-column toggles.
  const colCount = () => {
    let n = 4;
    if (showRaw()) n += 3;
    if (!iscpl()) {
      if (showRaw()) n += 1;
      if (showSpent()) n += 1;
      if (showBilled()) n += 1;
    }
    return n;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6">
      {/* ── Header ── */}
      <div class="mb-6">
        <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
          Campaign manager · Reporting
        </p>
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">
          Daily Report
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Pick one of your assigned clients and a date range, then generate the
          client's daily report.
          <Show when={currentUser.email}>
            <span class="text-gray-400 dark:text-gray-500">
              {" "}
              · {currentUser.email}
            </span>
          </Show>
        </p>
      </div>

      {/* ── Filter card ── */}
      <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-5 sm:p-6 mb-6">
        <div class="flex flex-col lg:flex-row lg:items-end gap-4">
          {/* Client dropdown — searchable combobox */}
          <div class="flex-1 min-w-[220px]">
            <label class="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Client
            </label>
            <div class="relative">
              <input
                type="text"
                value={clientQuery()}
                disabled={clientsRes.loading}
                placeholder={
                  clientsRes.loading
                    ? "Loading your clients…"
                    : clients().length === 0
                      ? "No assigned clients"
                      : "Search a client…"
                }
                onInput={(e) => {
                  setClientQuery(e.currentTarget.value);
                  setClientOpen(true);
                  if (selectedClientId()) setSelectedClientId("");
                }}
                onFocus={() => setClientOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setClientOpen(false);
                  else if (e.key === "Enter") {
                    const f = filteredClients();
                    if (f.length > 0) selectClientOption(f[0]);
                  }
                }}
                class="w-full border border-gray-300 dark:border-gray-600 px-3 py-2.5 pr-16 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] disabled:opacity-60 placeholder:text-gray-400"
              />
              <div class="absolute inset-y-0 right-2.5 flex items-center gap-1">
                <Show when={clientQuery()}>
                  <button
                    type="button"
                    onClick={clearClient}
                    aria-label="Clear client"
                    class="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </Show>
                <svg
                  class="w-4 h-4 text-gray-500 pointer-events-none"
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

              {/* Options */}
              <Show when={clientOpen() && !clientsRes.loading}>
                <div
                  class="fixed inset-0 z-40"
                  onClick={() => setClientOpen(false)}
                />
                <div class="absolute left-0 right-0 top-full mt-1 z-50 max-h-64 overflow-y-auto rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-[0_10px_40px_rgba(16,29,49,0.18)] py-1">
                  <Show
                    when={filteredClients().length > 0}
                    fallback={
                      <div class="px-3 py-3 text-sm text-gray-400 dark:text-gray-500">
                        {clients().length === 0
                          ? "No assigned clients"
                          : "No clients match your search"}
                      </div>
                    }
                  >
                    <For each={filteredClients()}>
                      {(c) => (
                        <button
                          type="button"
                          onClick={() => selectClientOption(c)}
                          class={
                            "w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors " +
                            (String(c.client_nomen_id) === String(selectedClientId())
                              ? "bg-[#FBEEF0] dark:bg-red-900/20 text-[#AC2334] dark:text-red-300 font-semibold"
                              : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800")
                          }
                        >
                          <span class="truncate">{c.client_name}</span>
                          <Show when={c.client_type}>
                            <span
                              class={`flex-none text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${TYPE_CHIP[(c.client_type || "").toLowerCase()] ?? TYPE_CHIP.retainer}`}
                            >
                              {c.client_type}
                            </span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          {/* Status filter */}
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Status
            </label>
            <div class="relative">
              <select
                value={statusFilter()}
                onChange={(e) => setStatusFilter(e.target.value)}
                class="border border-gray-300 dark:border-gray-600 px-3 py-2.5 pr-10 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200 appearance-none focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
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
          </div>

          {/* Date range */}
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Date range
            </label>
            <DateRangeFilter
              fromDate={fromDate}
              toDate={toDate}
              setFromDate={setFromDate}
              setToDate={setToDate}
            />
          </div>

          {/* Actions */}
          <div class="flex items-center gap-2">
            <button
              onClick={generate}
              disabled={!canGenerate()}
              class={
                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm " +
                (canGenerate()
                  ? "bg-[#AC2334] text-white hover:bg-[#8f1c2b]"
                  : "bg-[#AC2334]/40 text-white cursor-not-allowed")
              }
            >
              <Show
                when={!generating()}
                fallback={
                  <span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                }
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </Show>
              {generating() ? "Generating…" : "Generate Report"}
            </button>
            <button
              onClick={reset}
              class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-medium transition"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Quick presets + toggle stack. The presets live in their own flex row
            so they keep their pill height instead of stretching to match the
            taller toggle column beside them. */}
        <div class="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 mt-4">
          <div class="flex flex-wrap items-center gap-2">
            <For
              each={[
                { label: "Today", value: "today" },
                { label: "Yesterday", value: "yesterday" },
                { label: "Last 7 Days", value: "last7" },
                { label: "This Month", value: "thisMonth" },
                { label: "Last Month", value: "lastMonth" },
              ]}
            >
              {(item) => (
                <button
                  onClick={() => setPreset(item.value)}
                  class={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border ${
                    activePreset() === item.value
                      ? "bg-[#AC2334] text-white border-[#AC2334] shadow-sm"
                      : "bg-gray-50 text-gray-600 border-gray-200 hover:border-[#AC2334]/40 hover:text-[#AC2334] dark:bg-gray-900 dark:text-gray-300 dark:border-gray-600"
                  }`}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>

          {/* Toggle stack — sits at the right edge of the presets row.
              Row 1: client-vs-internal (raw CPL / spend + Meta / Fed split).
              Row 2: per-column toggles for the two money columns. */}
          <div class="sm:ml-auto flex flex-col items-start sm:items-end gap-2">
            {/* ON shows Raw CPL, Raw Amount Spent and the Meta / Fed lead split
                in the table AND all downloads; OFF = client-facing (Total Leads
                + Premium CPL + Client Billed only), safe to share. */}
            <label class="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={includeRaw()}
                onChange={(e) => setIncludeRaw(e.currentTarget.checked)}
                class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-[#AC2334] focus:ring-[#AC2334]"
              />
              <span>
                Include raw CPL / spend, Meta Leads, Fed Leads
                <span class="text-gray-400 dark:text-gray-500">
                  {" "}
                  — internal (off = client-facing)
                </span>
              </span>
            </label>

            {/* Hidden for CPL clients, whose report never carries these
                columns at all. */}
            <Show when={!iscpl()}>
              <label class="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={showSpent()}
                  onChange={(e) => setShowSpent(e.currentTarget.checked)}
                  class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-[#AC2334] focus:ring-[#AC2334]"
                />
                <span>
                  Include Spent
                  <span class="text-gray-400 dark:text-gray-500">
                    {" "}
                    — premium spend column
                  </span>
                </span>
              </label>

              <label class="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={showBilled()}
                  onChange={(e) => setShowBilled(e.currentTarget.checked)}
                  class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-[#AC2334] focus:ring-[#AC2334]"
                />
                <span>
                  Include Client Billed
                  <span class="text-gray-400 dark:text-gray-500">
                    {" "}
                    — incl {scRate()}% S.C + 18% GST
                  </span>
                </span>
              </label>
            </Show>
          </div>
        </div>
      </div>

      {/* ── Generate error ── */}
      <Show when={genError()}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6 text-sm font-medium text-red-600 dark:text-red-400">
          Couldn't generate the report. Please try again.
        </div>
      </Show>

      {/* ── Empty prompt (before first generate) ── */}
      <Show when={!report() && !genError()}>
        <div class="bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-12 text-center">
          <svg
            class="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p class="mt-3 text-sm font-semibold text-gray-600 dark:text-gray-300">
            No report yet
          </p>
          <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Select a client and a date range, then choose{" "}
            <span class="font-semibold text-[#AC2334]">Generate Report</span>.
          </p>
        </div>
      </Show>

      {/* ══════════════════════════════════════════════════════════════════════
          REPORT
         ══════════════════════════════════════════════════════════════════════ */}
      <Show when={report()}>
        {/* Client + range banner */}
        <div class="flex items-center gap-2 flex-wrap mb-4">
          <span class="font-bold text-gray-900 dark:text-white">
            {report().client.client_name}
          </span>
          <Show when={report().client.client_type}>
            <span
              class={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${TYPE_CHIP[clientType()] ?? TYPE_CHIP.retainer}`}
            >
              {report().client.client_type}
            </span>
          </Show>
          <span class="text-gray-300">·</span>
          <span class="px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium border border-blue-200 dark:border-blue-700">
            {rangeLabel()}
          </span>
          <Show when={statusFilter() !== "all"}>
            <span
              class={
                "px-3 py-1 rounded-full text-xs font-medium border capitalize " +
                (statusFilter() === "active"
                  ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700"
                  : "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700")
              }
            >
              {statusFilter()} only
            </span>
          </Show>
        </div>

        {/* On-screen table (same look as the client Daily Report) */}
        <div class="overflow-x-auto overflow-y-auto max-h-[500px] bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <table class="w-full text-sm table-auto">
            <thead class="bg-gray-100 dark:bg-gray-800 sticky top-0 z-10">
              <tr class="[&_th]:text-center [&_th:first-child]:text-left text-gray-700 dark:text-gray-200 [&_th]:whitespace-nowrap [&_th]:font-semibold">
                <th class="p-3 pl-4">Date</th>
                <th class="p-3">Project</th>
                {/* Meta / Fed split is internal — it rides the same toggle as
                    raw CPL / spend. Client-facing view shows Total Leads only.
                 */}
                <Show when={showRaw()}>
                  <th class="p-3">Meta Leads</th>
                  <th class="p-3">Fed Leads</th>
                </Show>
                <th class="p-3">Total Leads</th>
                <Show when={showRaw()}>
                  <th class="p-3">Raw CPL</th>
                </Show>
                <th class="p-3">CPL</th>
                <Show when={!iscpl()}>
                  <Show when={showRaw()}>
                    <th class="p-3">Raw Amount Spent</th>
                  </Show>
                  <Show when={showSpent()}>
                    <th class="p-3">Spent</th>
                  </Show>
                  <Show when={showBilled()}>
                    <th class="p-3">{billedInclLabel()}</th>
                  </Show>
                </Show>
              </tr>
            </thead>

            <Show
              when={reportRows().length > 0}
              fallback={
                <tbody>
                  <tr>
                    <td colspan={colCount()} class="py-20 text-center">
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
                          No activity for this client in the selected range
                        </p>
                        <p class="text-gray-400 dark:text-gray-500 text-xs">
                          {statusFilter() === "all"
                            ? "Try a different date range."
                            : "Try a different date range or set Status to All."}
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
                      <td class="p-3 pl-4 text-left">
                        <span class="font-medium text-gray-700 dark:text-gray-300">
                          {dateCellLabel()}
                        </span>
                      </td>
                      <td class="p-3">
                        <span class="font-medium text-purple-700 dark:text-purple-300">
                          {row.projectName}
                        </span>
                      </td>
                      <Show when={showRaw()}>
                        <td class="p-3 font-bold text-gray-800 dark:text-gray-100">
                          {row.leads}
                        </td>
                        <td class="p-3 font-medium text-green-700 dark:text-green-400">
                          {fmtFed(row.fedLeads)}
                        </td>
                      </Show>
                      <td class="p-3 font-bold text-gray-900 dark:text-white">
                        {row.totalLeads}
                      </td>
                      <Show when={showRaw()}>
                        <td class="p-3 text-purple-700 dark:text-purple-300">
                          {fmt(row.cpl)}
                        </td>
                      </Show>
                      <td class="p-3 font-medium text-amber-700 dark:text-amber-400">
                        {fmtPrem(row.premiumCpl)}
                      </td>
                      <Show when={!iscpl()}>
                        <Show when={showRaw()}>
                          <td class="p-3 text-green-700 dark:text-green-400">
                            {fmt(row.spent)}
                          </td>
                        </Show>
                        <Show when={showSpent()}>
                          <td class="p-3 text-green-700 dark:text-green-400">
                            {fmt(row.billed)}
                          </td>
                        </Show>
                        <Show when={showBilled()}>
                          <td class="p-3 text-green-900 dark:text-green-400 font-semibold">
                            {fmt(billedIncl(row.billed))}
                          </td>
                        </Show>
                      </Show>
                    </tr>
                  )}
                </For>
              </tbody>

              <tfoot class="sticky bottom-0 z-10">
                <tr class="bg-gradient-to-r from-purple-100 to-purple-50 dark:from-gray-800 dark:to-gray-900 border-t-2 border-purple-300 dark:border-gray-600 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] [&_td]:text-center [&_td:first-child]:text-left font-semibold">
                  <td class="p-3 pl-4">
                    <span class="px-3 py-1 bg-purple-600 text-white rounded-lg text-xs font-bold tracking-wide">
                      TOTAL
                    </span>
                  </td>
                  <td class="p-3" />
                  <Show when={showRaw()}>
                    <td class="p-3 text-green-700 dark:text-green-300 font-bold text-base">
                      {totals().totalLeads}
                    </td>
                    <td class="p-3 text-green-700 dark:text-green-400 font-bold">
                      {fmtFed(totals().totalFedLeads)}
                    </td>
                  </Show>
                  <td class="p-3 text-gray-900 dark:text-white font-bold text-base">
                    {totals().totalAllLeads}
                  </td>
                  <Show when={showRaw()}>
                    <td class="p-3 text-purple-700 dark:text-purple-300 font-bold">
                      {fmt(totals().avgCPL)}
                    </td>
                  </Show>
                  <td class="p-3 text-amber-700 dark:text-amber-400 font-bold">
                    {fmtPrem(totals().avgPremiumCPL)}
                  </td>
                  <Show when={!iscpl()}>
                    <Show when={showRaw()}>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold">
                        {fmt(totals().totalSpent)}
                      </td>
                    </Show>
                    <Show when={showSpent()}>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold">
                        {fmt(totals().totalBilled)}
                      </td>
                    </Show>
                    <Show when={showBilled()}>
                      <td class="p-3 text-green-900 dark:text-green-400 font-bold">
                        {fmt(totals().totalBilledIncl)}
                      </td>
                    </Show>
                  </Show>
                </tr>
              </tfoot>
            </Show>
          </table>
        </div>

        {/* ── Action Buttons (Preview + Download PDF/CSV/Excel) ── */}
        <div class="flex items-center gap-3 mt-6 flex-wrap">
          {/* Preview */}
          <button
            onClick={handlePreview}
            disabled={previewGenerating() || reportRows().length === 0}
            class={
              "flex items-center gap-2 px-5 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200 shadow-sm " +
              (reportRows().length === 0
                ? "opacity-40 cursor-not-allowed border-purple-300 text-purple-500 bg-purple-50 dark:bg-purple-900/10"
                : showPreview()
                  ? "bg-white text-purple-900 dark:text-gray-200 border-purple-900 dark:border-gray-600 dark:bg-gray-800"
                  : "border-purple-600 text-purple-700 dark:text-gray-100 bg-purple-50 dark:border-gray-600 dark:bg-gray-800")
            }
          >
            <Show
              when={!previewGenerating()}
              fallback={
                <div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              }
            >
              <svg
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

          {/* Download dropdown — PDF / CSV / Excel */}
          <div class="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              disabled={reportRows().length === 0}
              aria-haspopup="true"
              aria-expanded={exportOpen()}
              class={
                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shadow-sm " +
                (reportRows().length === 0
                  ? "opacity-40 cursor-not-allowed bg-purple-900 text-white"
                  : "bg-purple-900 hover:bg-purple-700 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-white hover:shadow-md")
              }
            >
              <svg
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
              <svg
                class={`w-3.5 h-3.5 transition-transform duration-200 ${exportOpen() ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            <Show when={exportOpen()}>
              <div
                class="fixed inset-0 z-40"
                onClick={() => setExportOpen(false)}
              />
              <div class="absolute left-0 top-full mt-2 w-60 z-50 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-[0_10px_40px_rgba(16,29,49,0.18)] overflow-hidden py-1.5">
                <p class="px-3.5 pt-1.5 pb-2 text-[12px] font-bold uppercase tracking-wider text-gray-700 dark:text-gray-500">
                  Export {reportRows().length} row
                  {reportRows().length !== 1 ? "s" : ""} as
                </p>
                <For
                  each={[
                    { fmt: "pdf", label: "PDF", sub: "Branded A4 document", tint: "#7B1C1C" },
                    { fmt: "csv", label: "CSV", sub: "Comma-separated values", tint: "#15966A" },
                    { fmt: "excel", label: "Excel", sub: "Formatted .xlsx workbook", tint: "#1D7044" },
                  ]}
                >
                  {(o) => (
                    <button
                      onClick={() => runExport(o.fmt)}
                      class="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <span
                        class="w-8 h-8 flex-none rounded-lg grid place-items-center text-[11px] font-extrabold text-white"
                        style={`background:${o.tint}`}
                      >
                        {o.label.slice(0, 3).toUpperCase()}
                      </span>
                      <span class="min-w-0">
                        <span class="block text-[13px] font-bold text-gray-900 dark:text-gray-100">
                          {o.label}
                        </span>
                        <span class="block text-[11px] text-gray-400 dark:text-gray-500">
                          {o.sub}
                        </span>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <span class="text-xs text-gray-400 dark:text-gray-500 ml-1">
            {reportRows().length} row{reportRows().length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ════════════════════════════════════════════════════════
              PREVIEW PANEL (in-page white + minimal maroon report)
           ════════════════════════════════════════════════════════ */}
        <Show when={showPreview()}>
          <div class="mt-8 rounded-2xl border border-[rgba(123,28,28,0.15)] overflow-hidden shadow-lg bg-white">
            {/* HEADER */}
            <div class="relative bg-white px-8 py-6 border-b-[3px] border-[#7B1C1C]">
              <div class="absolute top-0 left-0 right-0 h-[4px] bg-[#7B1C1C]" />
              <div class="flex items-center gap-5 relative">
                <div class="w-[120px] flex items-center justify-center flex-shrink-0">
                  <img
                    src={logoUrl}
                    alt="Aajneeti Connect"
                    class="w-full h-full object-contain p-1"
                  />
                </div>
                <div class="flex-1">
                  <p class="text-[#7B1C1C] text-[14px] tracking-[0.18em] uppercase font-semibold mb-1">
                    Aajneeti Connect Ltd.
                  </p>
                  <h2 class="text-[#1a1a1a] text-2xl font-bold tracking-[0.05em] uppercase font-serif">
                    Daily Report
                  </h2>
                  <p class="text-[#555] text-[13px] font-semibold mt-0.5">
                    {report().client.client_name}
                  </p>
                  <p class="text-[#888] text-xs mt-0.5 tracking-wide">
                    {rangeLabel()} &nbsp;·&nbsp; Generated on{" "}
                    {new Date().toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
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

            {/* TABLE */}
            <div class="overflow-x-auto bg-white">
              <table class="w-full text-sm border-collapse">
                <thead>
                  <tr class="bg-[#7B1C1C]">
                    <th class="px-4 py-3 text-left text-white text-md uppercase font-semibold border-r border-white/10">
                      Date
                    </th>
                    <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                      Project
                    </th>
                    <Show when={showRaw()}>
                      <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                        Meta Leads
                      </th>
                      <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                        Fed Leads
                      </th>
                    </Show>
                    <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                      Total Leads
                    </th>
                    <Show when={showRaw()}>
                      <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                        Raw CPL
                      </th>
                    </Show>
                    <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                      CPL
                    </th>
                    <Show when={!iscpl()}>
                      <Show when={showRaw()}>
                        <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                          Raw Amount Spent
                        </th>
                      </Show>
                      <Show when={showSpent()}>
                        <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                          Spent
                        </th>
                      </Show>
                      <Show when={showBilled()}>
                        <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                          {billedInclLabel()}
                        </th>
                      </Show>
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
                        <td class="px-4 py-3 text-left relative whitespace-nowrap border-r border-[rgba(123,28,28,0.1)]">
                          <span class="absolute left-0 top-0 bottom-0 w-[3px] bg-[#7B1C1C]" />
                          <span class="font-semibold text-[#1a1a1a] text-md">
                            {dateCellLabel()}
                          </span>
                        </td>
                        <td class="px-4 py-3 text-center text-[#333] font-medium text-md whitespace-nowrap border-r border-[rgba(123,28,28,0.1)]">
                          {row.projectName}
                        </td>
                        <Show when={showRaw()}>
                          <td class="px-4 py-3 text-center font-bold text-[#7B1C1C] text-md border-r border-[rgba(123,28,28,0.1)]">
                            {row.leads}
                          </td>
                          <td class="px-4 py-3 text-center font-semibold text-[#1D7044] text-md border-r border-[rgba(123,28,28,0.1)]">
                            {fmtFed(row.fedLeads)}
                          </td>
                        </Show>
                        <td class="px-4 py-3 text-center font-bold text-[#1a1a1a] text-md border-r border-[rgba(123,28,28,0.1)]">
                          {row.totalLeads}
                        </td>
                        <Show when={showRaw()}>
                          <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                            {fmt(row.cpl)}
                          </td>
                        </Show>
                        <td class="px-4 py-3 text-center text-[#8a5a00] font-semibold text-md border-r border-[rgba(123,28,28,0.1)]">
                          {fmtPrem(row.premiumCpl)}
                        </td>
                        <Show when={!iscpl()}>
                          <Show when={showRaw()}>
                            <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                              {fmt(row.spent)}
                            </td>
                          </Show>
                          <Show when={showSpent()}>
                            <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                              {fmt(row.billed)}
                            </td>
                          </Show>
                          <Show when={showBilled()}>
                            <td class="px-4 py-3 text-center text-[#1a1a1a] font-semibold text-md border-r border-[rgba(123,28,28,0.1)]">
                              {fmt(billedIncl(row.billed))}
                            </td>
                          </Show>
                        </Show>
                      </tr>
                    )}
                  </For>
                </tbody>
                <tfoot>
                  <tr class="bg-[#7B1C1C]">
                    <td class="px-4 py-3 text-left text-white font-bold text-[10.5px] tracking-widest uppercase border-r border-white/10">
                      Total
                    </td>
                    <td class="px-4 py-3 border-r border-white/10" />
                    <Show when={showRaw()}>
                      <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                        {totals().totalLeads}
                      </td>
                      <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                        {fmtFed(totals().totalFedLeads)}
                      </td>
                    </Show>
                    <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                      {totals().totalAllLeads}
                    </td>
                    <Show when={showRaw()}>
                      <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                        {fmt(totals().avgCPL)}
                      </td>
                    </Show>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {fmtPrem(totals().avgPremiumCPL)}
                    </td>
                    <Show when={!iscpl()}>
                      <Show when={showRaw()}>
                        <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                          {fmt(totals().totalSpent)}
                        </td>
                      </Show>
                      <Show when={showSpent()}>
                        <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                          {fmt(totals().totalBilled)}
                        </td>
                      </Show>
                      <Show when={showBilled()}>
                        <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                          {fmt(totals().totalBilledIncl)}
                        </td>
                      </Show>
                    </Show>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* FOOTER */}
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
      </Show>

      {/* ════════════════════════════════════════════════════════
            HIDDEN PDF TEMPLATE (off-screen, captured by html2canvas)
         ════════════════════════════════════════════════════════ */}
      <Show when={report()}>
        <div
          id="cm-pdf-daily-report"
          style="position:absolute;left:-9999px;top:0;width:900px;"
        >
          <div style="width:900px;background:#ffffff;font-family:Arial,sans-serif;position:relative;box-sizing:border-box;border:1px solid rgba(123,28,28,0.15);border-radius:12px;overflow:hidden;">
            {/* HEADER */}
            <div style="background:#ffffff;border-bottom:3px solid #7B1C1C;padding:28px 40px 24px;position:relative;display:flex;align-items:center;gap:20px;">
              <div style="position:absolute;top:0;left:0;right:0;height:4px;background:#7B1C1C;" />
              <div style="width:120px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <img
                  src={logoUrl}
                  alt="Aajneeti Connect"
                  style="width:100%;height:100%;object-fit:contain;padding:4px;"
                />
              </div>
              <div style="flex:1;">
                <p style="color:#7B1C1C;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;font-weight:600;margin:0 0 4px;">
                  Aajneeti Connect Ltd.
                </p>
                <h1 style="color:#1a1a1a;font-size:26px;font-family:Georgia,serif;letter-spacing:2px;margin:0 0 4px;font-weight:700;text-transform:uppercase;">
                  Daily Report
                </h1>
                <p style="color:#555;font-size:13px;margin:0 0 2px;font-weight:600;">
                  {report().client.client_name}
                </p>
                <p style="color:#888;font-size:12px;margin:0;letter-spacing:1px;">
                  {rangeLabel()} &nbsp;·&nbsp; Generated on:{" "}
                  {new Date().toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
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

            {/* TABLE */}
            <div style="padding:28px 36px 0;">
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
                      <Show when={showRaw()}>
                        <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                          Meta Leads
                        </th>
                        <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                          Fed Leads
                        </th>
                      </Show>
                      <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        Total Leads
                      </th>
                      <Show when={showRaw()}>
                        <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                          Raw CPL
                        </th>
                      </Show>
                      <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        CPL
                      </th>
                      <Show when={!iscpl()}>
                        <Show when={showRaw()}>
                          <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                            Raw Amount Spent
                          </th>
                        </Show>
                        <Show when={showSpent()}>
                          <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                            Spent
                          </th>
                        </Show>
                        <Show when={showBilled()}>
                          <th style="padding:11px 14px;text-align:center;color:#f5d9a0;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;">
                            {billedInclLabel()}
                          </th>
                        </Show>
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
                          {dateCellLabel()}
                        </td>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;font-weight:500;border-right:1px solid rgba(123,28,28,0.1);">
                          {row.projectName}
                        </td>
                        <Show when={showRaw()}>
                          <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:700;color:#7B1C1C;border-right:1px solid rgba(123,28,28,0.1);">
                            {row.leads}
                          </td>
                          <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#1D7044;border-right:1px solid rgba(123,28,28,0.1);">
                            {fmtFed(row.fedLeads)}
                          </td>
                        </Show>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:700;color:#1a1a1a;border-right:1px solid rgba(123,28,28,0.1);">
                          {row.totalLeads}
                        </td>
                        <Show when={showRaw()}>
                          <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                            {fmt(row.cpl)}
                          </td>
                        </Show>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#8a5a00;border-right:1px solid rgba(123,28,28,0.1);">
                          {fmtPrem(row.premiumCpl)}
                        </td>
                        <Show when={!iscpl()}>
                          <Show when={showRaw()}>
                            <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                              {fmt(row.spent)}
                            </td>
                          </Show>
                          <Show when={showSpent()}>
                            <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                              {fmt(row.billed)}
                            </td>
                          </Show>
                          <Show when={showBilled()}>
                            <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#6b4c10;background:rgba(201,168,76,0.10);">
                              {fmt(billedIncl(row.billed))}
                            </td>
                          </Show>
                        </Show>
                      </tr>
                    ))}
                    <tr style="background:#7B1C1C;">
                      <td style="padding:11px 14px;text-align:left;color:#fff;font-size:10.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        Total
                      </td>
                      <td style="padding:11px 14px;border-right:1px solid rgba(255,255,255,0.12);" />
                      <Show when={showRaw()}>
                        <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                          {totals().totalLeads}
                        </td>
                        <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                          {fmtFed(totals().totalFedLeads)}
                        </td>
                      </Show>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {totals().totalAllLeads}
                      </td>
                      <Show when={showRaw()}>
                        <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                          {fmt(totals().avgCPL)}
                        </td>
                      </Show>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {fmtPrem(totals().avgPremiumCPL)}
                      </td>
                      <Show when={!iscpl()}>
                        <Show when={showRaw()}>
                          <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                            {fmt(totals().totalSpent)}
                          </td>
                        </Show>
                        <Show when={showSpent()}>
                          <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                            {fmt(totals().totalBilled)}
                          </td>
                        </Show>
                        <Show when={showBilled()}>
                          <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;">
                            {fmt(totals().totalBilledIncl)}
                          </td>
                        </Show>
                      </Show>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* FOOTER */}
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
      </Show>
    </section>
  );
}
