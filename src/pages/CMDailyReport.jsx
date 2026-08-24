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
import { fetchHierarchyClients } from "../services/cm";
import {
  fetchDashboardLedger,
  readDashboardLedger,
  EMPTY_LEDGER,
} from "../services/dashboard";
import {
  money,
  count,
  credit,
  added,
  exp,
  makeLedgerCells,
} from "../services/ledgerCells";
import { scopeKey } from "../stores/cmScope";
import { currentUser } from "../stores/currentUser";

const logoUrl = "/logo.webp";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
// Every figure on this page comes off ONE ledger row through the shared reader
// in services/ledgerCells — the same reader /daily-reports uses, so the CM view
// and the admin view of the same client and range agree cell for cell. What
// this page used to do instead, and what it printed, is in that file's header.
//
// fetchHierarchyClients stays: it fills the client dropdown. That is a picker,
// not a figure.

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

// The premium floor (2026-04-01) that used to be clamped here is the backend's
// now — /dashboard/ledger/ floors and caps its own window — so there is nothing
// left on this side to keep in step with it.

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

  // ── What used to live here, and why it doesn't ────────────────────────────
  // Three resources and two lookup memos: a lifetime-scoped campaign sweep for
  // project status, a second range-scoped campaign sweep for premium spend, and
  // a fed-lead batch fetch reduced per project in the browser. All three are
  // gone, replaced by the single ledger call in generate() below. Two of them
  // were not merely redundant, they were wrong:
  //
  //   • fetchAllCampaignsScoped walks campaign-level data scoped by each
  //     campaign's CURRENT client_nomen_id. Campaigns move between clients, and
  //     the backend scopes raw insights by who owned the campaign ON EACH DAY.
  //     So the sweep counted days belonging to a previous owner: 333 Meta leads
  //     and ₹52,255.26 where the truth for that client and range was 104 and
  //     ₹20,880.06.
  //
  //   • fedLeadsByProject summed ManualLeadBatch rows by project without
  //     filtering target_client. Projects are shared between clients, so ten of
  //     client 181's fed leads were printed on another client's report. That is
  //     client data crossing between clients, not a rounding difference.
  //
  // Neither was fixable by patching the reduction, because the reduction was
  // the bug: both figures are day-scoped ownership questions that only the
  // server can answer. Project status now comes off the ledger row's own
  // campaigns_active count, the same rule /daily-reports uses.
  //
  // fetchHierarchyClients above stays. It fills the dropdown, and a picker is
  // not a figure.
  const canGenerate = () =>
    !!selectedClientId() && !!fromDate() && !!toDate() && !generating();

  // ── The generated report's ledger ─────────────────────────────────────────
  // One decoded payload — rows keyed by project, plus the response's own totals
  // block. EMPTY_LEDGER until a report is generated, so nothing has to
  // null-check its way through a render.
  const ledger = () => report()?.ledger ?? EMPTY_LEDGER;

  // The response's per-client summary — the same `meta.report_summary` block the
  // admin Daily Report reads, carrying client_type and the service-charge rate.
  const reportSummary = () => report()?.summary ?? null;

  // ── Client-type gate (drives which columns show, exactly like the client's
  //    own Daily Report where iscpl() hides the spend columns). Keyed to the
  //    SELECTED client's type, not the logged-in user's. The response's summary
  //    wins; the picker row (which carries client_type from the hierarchy) is
  //    the fallback, and is what the page used before the migration. ─────────
  const clientType = () =>
    String(
      reportSummary()?.client_type ?? report()?.client?.client_type ?? "",
    ).toLowerCase();
  const iscpl = () => clientType() === "cpl";

  // ── Service charge ────────────────────────────────────────────────────────
  // The rate is the VIEWED client's own, off meta.report_summary.service_charge
  // — the same field and the same source as /daily-reports, which is what lets
  // the two pages print the same number.
  //
  // It used to be scavenged: read the Client PK off a campaign row in the CM's
  // whole scope, then GET /projects/?client_id=<PK> and hope for a summary. Both
  // halves failed for a CM token — the PK is not exposed on those rows and the
  // projects response carried no report_summary — so the page fell back to 0%
  // and printed a confident wrong number in a column headed "incl S.C + GST".
  //
  // Now: null means unknown, and unknown renders "—". A 0% fallback is the one
  // outcome worse than a gap, because nobody can see it.
  //
  // null and zero are DIFFERENT answers here, deliberately. The rate is
  // per-client from the DB — hybrids and retainers run 10%, 13% and 15%, and a
  // few clients are set to 0.00 on purpose. "0.00" is a real rate and prints
  // "incl 0% S.C"; a null prints "—". Collapsing them is what the old `?? 0`
  // fallback did, and it made a missing rate look exactly like a genuine zero.
  const scPct = () => {
    const v = reportSummary()?.service_charge;
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // GST is a flat 18% platform-wide — a policy constant, not a per-client rate,
  // so there is nothing to resolve and nothing that can come back missing. Note
  // it is deliberately NOT read from the viewer's billing overview the way
  // /daily-reports reads it: that overview belongs to the CM, not to the client
  // this report is about.
  const GST_PCT = 18;
  const scMult = () => {
    const p = scPct();
    return p == null ? null : 1 + p / 100;
  };
  const gstMult = () => 1 + GST_PCT / 100;
  const billedInclLabel = () => {
    if (iscpl()) return `Client Billed (incl ${GST_PCT}% GST)`;
    const p = scPct();
    return p == null
      ? `Client Billed (incl S.C + ${GST_PCT}% GST)`
      : `Client Billed (incl ${p}% S.C + ${GST_PCT}% GST)`;
  };
  // ── Why the S.C column is a gap, when it is ───────────────────────────────
  // A null rate has three meanings and only one of them is a bug, so the note
  // under the table has to say which:
  //
  //   "ok"       a rate came back. Nothing to explain.
  //   "n/a"      the client is CPL. service_charge is null BY DESIGN — the rate
  //              is only set for hybrid/retainer at onboarding — so a CPL client
  //              having none is correct, not missing. This page hides the spend
  //              and billed columns for CPL anyway; the note says why.
  //   "missing"  a summary came back for a HYBRID or RETAINER client with no
  //              rate on it. That is a bug: the rate should have been set at
  //              onboarding, and someone needs to go set it.
  //   "unknown"  no summary block at all, so we cannot tell "n/a" from
  //              "missing". This is the state until the backend adds
  //              report_summary to /dashboard/ledger/ — meta comes back null
  //              there today for every role, which is what the old Client PK
  //              scavenging was working around, and answering with 0%.
  //
  // The distinction matters because "normal" and "go fix your data" look
  // identical on screen: both are an em dash.
  const scState = () => {
    if (scPct() != null) return "ok";
    if (!reportSummary()) return "unknown";
    if (iscpl()) return "n/a";
    return "missing";
  };

  // ── Every cell on this page ───────────────────────────────────────────────
  // The shared reader: one named payload key per column, no division, "—" for
  // anything the payload didn't send. A CM is a privileged role, so the raw
  // agency-cost keys are on their payload — whether the raw COLUMNS render is
  // the toggle's business (showRaw), not the reader's.
  //
  // The S.C / GST column loads onto premium_spend — the "Spent" column, before
  // the replacement credit — which is what /daily-reports loads onto too. This
  // page briefly loaded onto billed_amount instead; the two agree only where
  // replaced_leads is 0, so that was the same disagreement this migration
  // exists to remove, in a column nobody would have thought to compare.
  const { rowOf: rowCells } = makeLedgerCells({
    hasRaw: () => true,
    clientType,
    scMult,
    gstMult,
    iscpl,
  });

  // ── Lead replacement (Replaced / Billable) ────────────────────────────────
  // Replacements apply to CPL and hybrid clients only — a retainer row comes
  // back 0/absent, so the columns stay off for them rather than printing a
  // column of zeros that can never be anything else. We also require at least
  // one row to actually carry the field, so a client whose rows predate the
  // backend change doesn't get two empty columns.
  const isReplaceableType = () =>
    clientType() === "cpl" || clientType() === "hybrid";
  const showReplaced = () =>
    isReplaceableType() &&
    reportRows().some((r) => r.replacedLeads != null || r.billableLeads != null);

  // Raw (agency-cost) columns render — on-screen AND in every download — only
  // when the "Include raw" toggle is on. Off → client-facing report (no raw).
  const showRaw = () => includeRaw();

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
  // ONE request. GET /dashboard/ledger/?start_date&end_date&client_nomen_id —
  // range-scoped and client-scoped server-side, returning the finished
  // per-project ledger plus its own totals block. A CM token gets the
  // privileged payload (raw AND premium keys), so every column this page shows
  // is already in the response and nothing here reduces anything.
  //
  // It replaces four calls: a hierarchy projects fetch, two campaign sweeps
  // (one lifetime for status, one range-scoped for premium), and a fed-lead
  // batch fetch reduced in the browser — plus a fifth, /projects/?client_id=,
  // that existed only to scavenge a service-charge rate it never returned.
  //
  // The summary rides on the same response, so the client's type and S.C rate
  // can no longer disagree with the figures they qualify: they arrived
  // together, for this client, for this range.
  const generate = async () => {
    if (!canGenerate()) return;
    const client = selectedClient();
    const from = fromDate();
    const to = toDate();
    setGenerating(true);
    setGenError(false);
    setShowPreview(false);
    try {
      const res = await fetchDashboardLedger({
        startDate: from,
        endDate: to,
        clientNomenId: client.client_nomen_id,
      });
      const summary = res?.meta?.report_summary ?? null;
      // Only the states that are actually wrong get a console line. A CPL
      // client with no service_charge is correct by design, and warning about
      // it would train everyone to ignore the warning that matters.
      if (!summary) {
        console.warn(
          "[CMDailyReport] /dashboard/ledger/ returned no meta.report_summary for client_nomen_id=%s — the S.C/GST column will render '—' rather than assume 0%%.",
          client.client_nomen_id,
        );
      } else if (
        summary.service_charge == null &&
        String(summary.client_type || "").toLowerCase() !== "cpl"
      ) {
        console.warn(
          "[CMDailyReport] client_nomen_id=%s is '%s' but carries no service_charge — a rate should be set on the client record. Rendering '—' rather than assuming 0%%.",
          client.client_nomen_id,
          summary.client_type,
        );
      }
      setReport({
        client,
        from,
        to,
        ledger: readDashboardLedger(res),
        summary,
      });
    } catch (err) {
      console.error("[CMDailyReport] ledger failed:", err);
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

  // ── Report rows ───────────────────────────────────────────────────────────
  // One row of the ledger → one row on screen, through the shared reader. The
  // only thing this memo does besides read is decide which rows to SHOW; it
  // computes no figure, and the two filters below deliberately test the
  // normalised row rather than a rendered cell.
  const reportRows = createMemo(() => {
    const sf = statusFilter();
    const rows = [];

    for (const row of ledger().rows) {
      // ── Status filter (active / paused) ─────────────────────────────────
      // A campaign's active/paused state is NOT date-dependent, so the ledger
      // row's own campaign counts drive it — the same rule /daily-reports uses,
      // and the reason the lifetime campaign sweep is gone.
      if (sf !== "all") {
        const status = row.campaignsActive > 0 ? "active" : "paused";
        if (sf !== status) continue;
      }

      // ── "Ran in this range" ─────────────────────────────────────────────
      // The response is already windowed server-side, so a project that wasn't
      // running in the range has nothing on its row. This is a presence test,
      // not a date sweep.
      const active =
        row.totalLeads > 0 ||
        row.spend > 0 ||
        row.impressions > 0 ||
        row.clicks > 0;
      if (!active) continue;

      rows.push({
        projectId: row.projectId,
        projectName: row.projectName,
        ...rowCells(row.wire),
      });
    }

    return rows.sort((a, b) => a.projectName.localeCompare(b.projectName));
  });

  // ── TOTAL row ─────────────────────────────────────────────────────────────
  // The response's own totals block, read through the SAME function the rows
  // use. Never summed from the rows: that roll-up is where the second source
  // got in on every other surface, and there is no version of it that survives
  // a lead set and a spend figure disagreeing about whose days they count.
  //
  // Consequence, stated rather than papered over: `totals` describes the whole
  // period the backend returned, so when a filter hides rows the footer is
  // wider than the table above it. The note under the table says so.
  const totals = createMemo(() => rowCells(ledger().totals?.wire));

  // True when the rows on screen are the same set the totals block describes.
  const totalsCoversAll = () => reportRows().length === ledger().rows.length;
  const totalsProjectCount = () =>
    ledger().totals?.projectCount ?? ledger().rows.length;

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
    if (showReplaced()) cols.push("Replaced", "Billable");
    if (showRaw()) cols.push("Raw CPL");
    cols.push("CPL");
    if (!iscpl()) {
      if (showRaw()) cols.push("Raw Amount Spent");
      if (showSpent()) cols.push("Spent");
      if (showBilled()) cols.push("Client Billed", billedInclLabel());
    }
    return cols;
  };
  // Rows and the TOTAL row are the same shape, so ONE cell list serves both —
  // which is what stops a downloaded sheet from carrying a total the screen
  // never showed. exp() blanks a null so a spreadsheet can still sum a column,
  // and the counts go out as plain integers rather than the "+N" / "−N" display
  // forms so the columns stay sum-able.
  const exportCells = (r) => {
    const base = [];
    if (showRaw()) base.push(exp(r.metaLeads), exp(r.fedLeads));
    base.push(exp(r.leads));
    if (showReplaced()) base.push(exp(r.replacedLeads), exp(r.billableLeads));
    if (showRaw()) base.push(exp(r.rawCpl));
    base.push(exp(r.cpl));
    if (!iscpl()) {
      if (showRaw()) base.push(exp(r.rawSpent));
      if (showSpent()) base.push(exp(r.spent));
      if (showBilled())
        base.push(exp(r.billedAmount), exp(r.spentwithservice_gst));
    }
    return base;
  };
  const exportRow = (r) => [dateCellLabel(), r.projectName, ...exportCells(r)];
  const exportTotalsRow = () => ["TOTAL", "", ...exportCells(totals())];

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

  // Hidden PDF template width. The template is captured as an image and scaled
  // to the page, so the box has to be wide enough for the columns actually
  // rendered — at 900px the two extra replacement columns squeezed the money
  // headers into three-line wraps. Scale off the real column count rather than
  // a single flag, now that Client Billed and its loaded twin can also be on.
  const pdfWidth = () => Math.max(900, 620 + colCount() * 80);

  const downloadPDF = async () => {
    const el = document.getElementById("cm-pdf-daily-report");
    if (!el) return;
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      // Belt-and-braces once the template can be wider than 900px: capture the
      // element's real width instead of the viewport's, so nothing is clipped.
      width: el.scrollWidth,
      windowWidth: el.scrollWidth,
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

  // Column span for empty/placeholder table rows. It is the export's own column
  // list, counted — one definition, so a column added to the table can't leave
  // the empty state spanning the wrong width.
  const colCount = () => exportColumns().length;

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
                    — billed_amount, and the same figure loaded with S.C + GST
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
                {/* Total Leads → Replaced → Billable reads as one progression */}
                <Show when={showReplaced()}>
                  <th class="p-3 text-[#AC2334] dark:text-red-400">Replaced</th>
                  <th class="p-3">Billable</th>
                </Show>
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
                    <th class="p-3">Client Billed</th>
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
                          {count(row.metaLeads)}
                        </td>
                        <td class="p-3 font-medium text-green-700 dark:text-green-400">
                          {added(row.fedLeads)}
                        </td>
                      </Show>
                      <td class="p-3 font-bold text-gray-900 dark:text-white">
                        {count(row.leads)}
                      </td>
                      <Show when={showReplaced()}>
                        <td class="p-3 font-semibold text-[#AC2334] dark:text-red-400">
                          {credit(row.replacedLeads)}
                        </td>
                        <td class="p-3 font-bold text-gray-900 dark:text-white">
                          {count(row.billableLeads)}
                        </td>
                      </Show>
                      <Show when={showRaw()}>
                        <td class="p-3 text-purple-700 dark:text-purple-300">
                          {money(row.rawCpl)}
                        </td>
                      </Show>
                      <td class="p-3 font-medium text-amber-700 dark:text-amber-400">
                        {money(row.cpl)}
                      </td>
                      <Show when={!iscpl()}>
                        <Show when={showRaw()}>
                          <td class="p-3 text-green-700 dark:text-green-400">
                            {money(row.rawSpent)}
                          </td>
                        </Show>
                        <Show when={showSpent()}>
                          <td class="p-3 text-green-700 dark:text-green-400">
                            {money(row.spent)}
                          </td>
                        </Show>
                        <Show when={showBilled()}>
                          <td class="p-3 text-green-700 dark:text-green-400">
                            {money(row.billedAmount)}
                          </td>
                          <td class="p-3 text-green-900 dark:text-green-400 font-semibold">
                            {money(row.spentwithservice_gst)}
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
                      {count(totals().metaLeads)}
                    </td>
                    <td class="p-3 text-green-700 dark:text-green-400 font-bold">
                      {added(totals().fedLeads)}
                    </td>
                  </Show>
                  <td class="p-3 text-gray-900 dark:text-white font-bold text-base">
                    {count(totals().leads)}
                  </td>
                  <Show when={showReplaced()}>
                    <td class="p-3 text-[#AC2334] dark:text-red-400 font-bold">
                      {credit(totals().replacedLeads)}
                    </td>
                    <td class="p-3 text-gray-900 dark:text-white font-bold text-base">
                      {count(totals().billableLeads)}
                    </td>
                  </Show>
                  <Show when={showRaw()}>
                    <td class="p-3 text-purple-700 dark:text-purple-300 font-bold">
                      {money(totals().rawCpl)}
                    </td>
                  </Show>
                  <td class="p-3 text-amber-700 dark:text-amber-400 font-bold">
                    {money(totals().cpl)}
                  </td>
                  <Show when={!iscpl()}>
                    <Show when={showRaw()}>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold">
                        {money(totals().rawSpent)}
                      </td>
                    </Show>
                    <Show when={showSpent()}>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold">
                        {money(totals().spent)}
                      </td>
                    </Show>
                    <Show when={showBilled()}>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold">
                        {money(totals().billedAmount)}
                      </td>
                      <td class="p-3 text-green-900 dark:text-green-400 font-bold">
                        {money(totals().spentwithservice_gst)}
                      </td>
                    </Show>
                  </Show>
                </tr>
              </tfoot>
            </Show>
          </table>
        </div>

        {/* What the TOTAL row is, when it isn't what's on screen. The footer
            reads the payload's own totals block, so it covers every project in
            the period — including any the status filter or the "ran in range"
            test has hidden. Saying so is the price of not re-summing. */}
        <Show when={reportRows().length > 0 && !totalsCoversAll()}>
          <p class="mt-3 text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
            The <b class="font-semibold">TOTAL</b> row is the period total for
            all {totalsProjectCount()} projects, as sent by the server — the
            table above is filtered to {reportRows().length}. The two are not
            meant to add up.
          </p>
        </Show>

        {/* Why the loaded column is a gap — three states, one note each, and
            only "missing" is a problem. Better a visible gap than 0%: the old
            code charged 0% silently, and a column headed "incl S.C" reading
            exactly the un-loaded figure is the kind of wrong that survives
            review. */}
        <Show when={reportRows().length > 0}>
          {/* Normal: CPL clients are billed per lead and have no S.C rate. */}
          <Show when={scState() === "n/a"}>
            <p class="mt-3 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
              This client is billed per lead (CPL), so no service charge applies
              — the rate is set only for hybrid and retainer clients at
              onboarding. The spend and billed columns don't apply to a CPL
              contract and aren't shown.
            </p>
          </Show>

          {/* A bug in the client's own record: this type should carry a rate. */}
          <Show when={scState() === "missing"}>
            <p class="mt-3 text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
              This client is <b class="font-semibold">{clientType()}</b>, so a
              service-charge rate should be set against it — none came back with
              this report. <b class="font-semibold">{billedInclLabel()}</b>{" "}
              shows “—” rather than assuming 0%; the rate needs setting on the
              client record. Spent and Client Billed beside it are the figures
              before service charge and GST, and are unaffected.
            </p>
          </Show>

          {/* Can't tell the two apart — no summary came back at all. */}
          <Show when={scState() === "unknown"}>
            <p class="mt-3 text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
              No client summary came back with this report, so the
              service-charge rate is unknown — it may be genuinely absent (a CPL
              client) or simply not surfaced.{" "}
              <b class="font-semibold">{billedInclLabel()}</b> shows “—” rather
              than assuming 0%. Spent and Client Billed beside it are the
              figures before service charge and GST, and are unaffected.
            </p>
          </Show>
        </Show>

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
                    <Show when={showReplaced()}>
                      <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                        Replaced
                      </th>
                      <th class="px-4 py-3 text-center text-white text-md uppercase font-semibold border-r border-white/10">
                        Billable
                      </th>
                    </Show>
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
                          Client Billed
                        </th>
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
                            {count(row.metaLeads)}
                          </td>
                          <td class="px-4 py-3 text-center font-semibold text-[#1D7044] text-md border-r border-[rgba(123,28,28,0.1)]">
                            {added(row.fedLeads)}
                          </td>
                        </Show>
                        <td class="px-4 py-3 text-center font-bold text-[#1a1a1a] text-md border-r border-[rgba(123,28,28,0.1)]">
                          {count(row.leads)}
                        </td>
                        <Show when={showReplaced()}>
                          <td class="px-4 py-3 text-center font-semibold text-[#AC2334] text-md border-r border-[rgba(123,28,28,0.1)]">
                            {credit(row.replacedLeads)}
                          </td>
                          <td class="px-4 py-3 text-center font-bold text-[#1a1a1a] text-md border-r border-[rgba(123,28,28,0.1)]">
                            {count(row.billableLeads)}
                          </td>
                        </Show>
                        <Show when={showRaw()}>
                          <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                            {money(row.rawCpl)}
                          </td>
                        </Show>
                        <td class="px-4 py-3 text-center text-[#8a5a00] font-semibold text-md border-r border-[rgba(123,28,28,0.1)]">
                          {money(row.cpl)}
                        </td>
                        <Show when={!iscpl()}>
                          <Show when={showRaw()}>
                            <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                              {money(row.rawSpent)}
                            </td>
                          </Show>
                          <Show when={showSpent()}>
                            <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                              {money(row.spent)}
                            </td>
                          </Show>
                          <Show when={showBilled()}>
                            <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                              {money(row.billedAmount)}
                            </td>
                            <td class="px-4 py-3 text-center text-[#1a1a1a] font-semibold text-md border-r border-[rgba(123,28,28,0.1)]">
                              {money(row.spentwithservice_gst)}
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
                        {count(totals().metaLeads)}
                      </td>
                      <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                        {added(totals().fedLeads)}
                      </td>
                    </Show>
                    <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                      {count(totals().leads)}
                    </td>
                    <Show when={showReplaced()}>
                      <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                        {credit(totals().replacedLeads)}
                      </td>
                      <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                        {count(totals().billableLeads)}
                      </td>
                    </Show>
                    <Show when={showRaw()}>
                      <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                        {money(totals().rawCpl)}
                      </td>
                    </Show>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {money(totals().cpl)}
                    </td>
                    <Show when={!iscpl()}>
                      <Show when={showRaw()}>
                        <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                          {money(totals().rawSpent)}
                        </td>
                      </Show>
                      <Show when={showSpent()}>
                        <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                          {money(totals().spent)}
                        </td>
                      </Show>
                      <Show when={showBilled()}>
                        <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                          {money(totals().billedAmount)}
                        </td>
                        <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                          {money(totals().spentwithservice_gst)}
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
          style={`position:absolute;left:-9999px;top:0;width:${pdfWidth()}px;`}
        >
          <div style={`width:${pdfWidth()}px;background:#ffffff;font-family:Arial,sans-serif;position:relative;box-sizing:border-box;border:1px solid rgba(123,28,28,0.15);border-radius:12px;overflow:hidden;`}>
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
                      <Show when={showReplaced()}>
                        <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                          Replaced
                        </th>
                        <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                          Billable
                        </th>
                      </Show>
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
                          <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                            Client Billed
                          </th>
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
                            {count(row.metaLeads)}
                          </td>
                          <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#1D7044;border-right:1px solid rgba(123,28,28,0.1);">
                            {added(row.fedLeads)}
                          </td>
                        </Show>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:700;color:#1a1a1a;border-right:1px solid rgba(123,28,28,0.1);">
                          {count(row.leads)}
                        </td>
                        <Show when={showReplaced()}>
                          <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#AC2334;border-right:1px solid rgba(123,28,28,0.1);">
                            {credit(row.replacedLeads)}
                          </td>
                          <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:700;color:#1a1a1a;border-right:1px solid rgba(123,28,28,0.1);">
                            {count(row.billableLeads)}
                          </td>
                        </Show>
                        <Show when={showRaw()}>
                          <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                            {money(row.rawCpl)}
                          </td>
                        </Show>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#8a5a00;border-right:1px solid rgba(123,28,28,0.1);">
                          {money(row.cpl)}
                        </td>
                        <Show when={!iscpl()}>
                          <Show when={showRaw()}>
                            <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                              {money(row.rawSpent)}
                            </td>
                          </Show>
                          <Show when={showSpent()}>
                            <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                              {money(row.spent)}
                            </td>
                          </Show>
                          <Show when={showBilled()}>
                            <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                              {money(row.billedAmount)}
                            </td>
                            <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#6b4c10;background:rgba(201,168,76,0.10);">
                              {money(row.spentwithservice_gst)}
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
                          {count(totals().metaLeads)}
                        </td>
                        <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                          {added(totals().fedLeads)}
                        </td>
                      </Show>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {count(totals().leads)}
                      </td>
                      <Show when={showReplaced()}>
                        <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                          {credit(totals().replacedLeads)}
                        </td>
                        <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                          {count(totals().billableLeads)}
                        </td>
                      </Show>
                      <Show when={showRaw()}>
                        <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                          {money(totals().rawCpl)}
                        </td>
                      </Show>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {money(totals().cpl)}
                      </td>
                      <Show when={!iscpl()}>
                        <Show when={showRaw()}>
                          <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                            {money(totals().rawSpent)}
                          </td>
                        </Show>
                        <Show when={showSpent()}>
                          <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                            {money(totals().spent)}
                          </td>
                        </Show>
                        <Show when={showBilled()}>
                          <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                            {money(totals().billedAmount)}
                          </td>
                          <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;">
                            {money(totals().spentwithservice_gst)}
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
