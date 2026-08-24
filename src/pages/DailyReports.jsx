import { For, Show, createSignal, createMemo, createEffect, batch } from "solid-js";
import { DateRangeFilter } from "../components/DateRangeFilter";
import {
  fetchProjects,
  fetchDashboardLedger,
  readDashboardLedger,
  readClientLedger,
  EMPTY_LEDGER,
} from "../services/dashboard";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import useRole, { clientRole } from "./../hooks/useRole";
import { createResource } from "solid-js"; // add to existing solid-js import
import { fetchAllAdminClients } from "./admin/services/fetchClients";
import {
  money,
  count,
  credit,
  exp,
  makeLedgerCells,
} from "../services/ledgerCells";
const logoUrl = "/logo.webp";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
// The cell accessor and its renderers now live in services/ledgerCells, shared
// with /cm-daily-report — the two pages draw the same table from the same
// endpoint, and the guarantee only holds if they read it the same way. The
// rationale (every column that was once computed here, and what it printed) is
// in that file's header.

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
  const [loading, setLoading] = createSignal(false);
  const [statusFilter, setStatusFilter] = createSignal("all");
  // No default range — the report shows nothing until the user picks a range
  // (avoids the all-time dump). Gated by ready()/the empty-state prompt below.
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");
  const [showPreview, setShowPreview] = createSignal(false);
  const [previewGenerating, setPreviewGenerating] = createSignal(false);
  const [exportOpen, setExportOpen] = createSignal(false); // download-report format menu
  const { isRetainer, iscpl: iscplRole, ishybrid, isAdmin } = clientRole();
  // A client logging in sees a finished report, not a report builder — the
  // column toggles are an internal trimming tool for admin/CM before sharing.
  // Hidden for clients; the underlying signals stay ON so every column their
  // type allows still renders.
  const { isClient } = useRole();

  // The `meta.report_summary` block off the PROJECTS response — the client's
  // service-charge rate and type. It is now only a fallback: the ledger carries
  // the same block, arriving with the figures the rate multiplies, and that is
  // what scPct() reads first. See the summary chain below for when this still
  // gets used and why it hasn't simply been deleted.
  const [projectsSummary, setProjectsSummary] = createSignal(null);

  // ── Where every figure on this report comes from ──────────────────────────
  // ONE call: GET /dashboard/ledger/?start_date&end_date, range-scoped and
  // role-scoped server-side. It replaced fetchAllCampaigns + a bulk-insights
  // sweep over every campaign id (reduced and date-filtered in the browser) and
  // a per-project /reports/project/{id}/ sweep for the replacement trio.
  //
  // Three bugs died with that pipeline, all on the same row:
  //   • Generated came from the insight rows while Replaced / Billable came from
  //     the project report — DIFFERENT LEAD SETS, so the subtraction printed on
  //     screen didn't hold (621 − 40 showing 381).
  //   • The range re-filtered CLIENT-SIDE over rows fetched once, so an August
  //     filter still counted a July block (621 against a real 382).
  //   • Spend matched neither the raw nor the client-facing figure.
  // All three columns now come off ONE row of ONE payload, so they cannot
  // disagree about the period or the lead set they describe.
  //
  // The lead arithmetic is TAKEN, not recomputed: meta_leads + fed_leads =
  // total_leads (fed leads are ADDITIVE — synthetic leads live only as a count
  // on ManualLeadBatch, and Meta's own numbers cannot know about them), and
  // billable_leads = total_leads − replaced_leads.
  // (the loading flag is the resource's own — see ledgerLoading below)

  // Include raw (agency-cost) columns — Raw Spend + Raw CPL — in the on-screen
  // table AND all downloads. ON by default = internal report (shows the agency's
  // cost/margin); untick for a client-facing report (safe to share). Admin/CM
  // only (there's no raw data for a client's own login).
  const [includeRaw, setIncludeRaw] = createSignal(true);

  // Per-column show/hide for the three money columns (Client Billed, + S.C,
  // + S.C + GST). Purely presentational: they only ever REMOVE a column that
  // the client-type / role gating already allows, and they apply everywhere the
  // table is rendered — on-screen, Preview, PDF, CSV and Excel — so what you
  // tick is exactly what you hand over.
  const [showBilledCol, setShowBilledCol] = createSignal(true);
  const [showScCol, setShowScCol] = createSignal(true);
  const [showGstCol, setShowGstCol] = createSignal(true);

  // ── Admin client picker ────────────────────────────────────────────────────
  // Admin `/daily-reports` is otherwise an all-clients aggregate that can't show
  // a correct service charge (S.C is per-client, and some projects span clients)
  // → it read "0% S.C". So admins pick ONE client; passing its id as client_id
  // scopes the report and returns that client's meta.report_summary. Non-admins
  // never see this — their own scoped data loads on mount as before.
  const [selectedAdminClientId, setSelectedAdminClientId] = createSignal("");
  const [adminClientQuery, setAdminClientQuery] = createSignal("");
  const [adminClientOpen, setAdminClientOpen] = createSignal(false);
  const [adminClientsRes] = createResource(
    () => (isAdmin() ? "admin" : null),
    async () => {
      try {
        return await fetchAllAdminClients();
      } catch (err) {
        console.error("DailyReports: failed to load admin clients", err);
        return [];
      }
    },
  );
  const adminClients = () => adminClientsRes() ?? [];
  const filteredAdminClients = createMemo(() => {
    const q = adminClientQuery().trim().toLowerCase();
    const list = adminClients();
    if (!q) return list;
    return list.filter(
      (c) =>
        (c.client_nomen_name || "").toLowerCase().includes(q) ||
        (c.organization_name || "").toLowerCase().includes(q),
    );
  });
  const selectAdminClient = (c) => {
    batch(() => {
      setSelectedAdminClientId(String(c.id));
      setAdminClientQuery(c.client_nomen_name || c.organization_name || "");
      setAdminClientOpen(false);
    });
    // The projects call is scoped by client_id — the Client PK (c.id), NOT the
    // nomen (a nomen value collides with a different client). The campaigns /
    // insights sweep, though, scopes off localStorage.selectedClientNomen (see
    // getClientNomen in services/campaigns), so also set the global selection to
    // the same client — the exact pattern the admin Clients page uses — so leads
    // / spend line up with the scoped projects instead of summing all clients.
    if (c.client_nomen_name)
      localStorage.setItem("selectedClientNomen", c.client_nomen_name);
    if (c.client_nomen != null)
      localStorage.setItem("selectedClientNomenId", String(c.client_nomen));
    // Client PK (c.id) — what as_client_id expects, and NOT the nomen id above
    // (they differ for all but one client). Keeps the ledger / ProjectDetails
    // preview-as-client scoping working off the same selection.
    if (c.id != null) localStorage.setItem("selectedClientId", String(c.id));
    // NOTE: loading is triggered by the ready() effect below (needs a date range
    // too), NOT here — picking a client alone doesn't load data (FIX 2).
  };
  const clearAdminClient = () => {
    batch(() => {
      setSelectedAdminClientId("");
      setAdminClientQuery("");
      setAdminClientOpen(true);
      setProjects([]);
      setProjectsSummary(null);
      setShowPreview(false);
    });
    loadedKey = null; // allow a fresh load when a client is re-picked
  };
  // Admin must pick a client before the report is meaningful.
  const adminNeedsClient = () => isAdmin() && !selectedAdminClientId();

  // FIX 2: nothing loads until a date range is chosen (everyone) and, for
  // admins, a client too. ready() gates both the fetch (effect below) and the
  // report display; otherwise the empty-state prompt shows.
  const needsRange = () => !fromDate() || !toDate();
  const ready = () => !adminNeedsClient() && !needsRange();

  // Fetch when the selection becomes complete. Guarded so changing ONLY the date
  // range re-filters client-side (reportRows) without refetching; changing the
  // client refetches. Reset / clear reset the guard.
  let loadedKey = null;
  createEffect(() => {
    const admin = isAdmin();
    const cid = selectedAdminClientId();
    const hasRange = !!fromDate() && !!toDate();
    if (!hasRange || (admin && !cid)) return;
    const key = admin ? `client:${cid}` : "self";
    if (loadedKey === key) return;
    loadedKey = key;
    loadAllData(admin ? cid : null);
  });

  /* ── data fetching ── */
  const loadAllData = async (clientId = null) => {
    try {
      setLoading(true);

      // ① fetch projects (all pages). clientId (admin picker) scopes the list to
      //    one client and makes the backend return meta.report_summary for it.
      let allProjects = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const res = await fetchProjects(page, "", 20, clientId);
        const apiData = res?.data || [];
        const meta = res?.meta?.pagination;
        // The per-client service-charge / client-type live in the response's
        // `meta.report_summary` block. Capture it once (page 1); it's identical
        // across pages. `/projects/` is client-scoped (client_nomen for admins),
        // so this is the SELECTED client's rate even in the admin/CM view. It's
        // absent when not scoped to one client (admin viewing all) → null, and
        // scPct()/iscplReport() fall back to the billing overview / role flag.
        if (page === 1) {
          setProjectsSummary(res?.meta?.report_summary ?? null);
        }
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

      // Nothing chains off this. Every number on the report comes from the
      // ledger resource below, which is keyed on the client AND the date range —
      // so changing the range refetches instead of re-filtering rows that were
      // fetched for a different window. That re-filter is what put July leads
      // under an August heading.
    } catch (err) {
      console.error("DailyReports: loadAllData error", err);
    } finally {
      setLoading(false);
    }
  };

  // ── THE one request ────────────────────────────────────────────────────────
  // Keyed on the client AND the range, so narrowing the dates refetches rather
  // than re-slicing rows fetched for another window. The admin picker's Client
  // PK goes out as as_client_id; a client's own login and a CM are already
  // scoped server-side and send nothing.
  //
  // A CLIENT reads a different payload from everyone else — premium_spend /
  // premium_cpl with no raw keys at all — so the decoder is chosen by role, the
  // same way ClientDashboard does it. Reading with the wrong one totals ₹0,
  // which is visible, rather than showing agency cost under a client's heading.
  const ledgerKey = () => {
    const from = fromDate();
    const to = toDate();
    if (!from || !to) return false;
    if (isAdmin() && !selectedAdminClientId()) return false;
    return {
      clientId: isAdmin() ? selectedAdminClientId() : null,
      from,
      to,
    };
  };

  const [ledgerRes] = createResource(ledgerKey, async (key) => {
    try {
      const res = await fetchDashboardLedger({
        startDate: key.from,
        endDate: key.to,
        asClientId: key.clientId,
      });
      return isClientViewer() ? readClientLedger(res) : readDashboardLedger(res);
    } catch (err) {
      // Never let a failed report read as "this client spent nothing".
      console.error("DailyReports: /dashboard/ledger/ failed", err);
      return EMPTY_LEDGER;
    }
  });

  const ledger = () => ledgerRes() ?? EMPTY_LEDGER;
  const ledgerLoading = () => ledgerRes.loading;

  // A client's own login never receives raw agency cost — see the decoder split
  // above — so the internal Raw columns are keyed off the role rather than off
  // whether a key happened to be present on a row.
  const isClientViewer = () => {
    try {
      return (
        JSON.parse(localStorage.getItem("auth") || "{}")?.role === "client"
      );
    } catch {
      return false;
    }
  };

  // ── Service charge + client type — ONE summary, per client ────────────────
  // The rate is the SELECTED client's own, set at onboarding, read from
  // meta.report_summary.service_charge — a percentage string like "10.00", or
  // null when the client has no service charge (CPL, by design).
  //
  // The LEDGER's own summary is read first. It arrives on the same response as
  // the figures the rate multiplies, for the same client over the same range,
  // which is the only arrangement that can't drift.
  //
  // The projects-response summary stays as a fallback for exactly one path: the
  // admin picker scopes the ledger with as_client_id, and the backend populates
  // report_summary for client_id / client_nomen_id / client_nomen. If as_client_id
  // joins that list this fallback can go, and with it the last rate source
  // outside the ledger.
  //
  // What was removed, and why it mattered:
  //   • `Number(s.service_charge ?? 0)` — a summary with a null rate became a
  //     confident 0% S.C. That is the same fabricated-rate bug the CM report
  //     had, in a column headed "+ N% S.C" that would have read "+ 0% S.C".
  //   • the viewer's billing overview, for BOTH the S.C rate and the GST rate.
  //     That overview belongs to whoever is logged in. For an admin or a CM
  //     looking at a client it is not that client's rate at all, and it was
  //     wired in as the fallback for precisely the case where the viewer isn't
  //     the client. A wrong rate is worse than no rate: no rate shows a gap.
  const reportSummary = () => ledger().summary ?? projectsSummary();
  const scPct = () => {
    const v = reportSummary()?.service_charge;
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // GST is a flat 18% platform-wide — a policy constant, not a per-client rate,
  // so there is nothing to resolve and nothing that can come back missing.
  const GST_PCT = 18;
  const scMult = () => {
    const p = scPct();
    return p == null ? null : 1 + p / 100;
  };
  const gstMult = () => 1 + GST_PCT / 100;
  // Labels name the rate only when there IS one; an unresolved rate must not
  // print as "+ 0% S.C" in a header any more than in a cell.
  const scColLabel = () =>
    scPct() == null ? "Amt Spent + S.C" : `Amt Spent + ${scPct()}% S.C`;
  const finalColLabel = () => {
    if (iscplReport()) return `Amt Spent + ${GST_PCT}% GST`;
    return scPct() == null
      ? `Amt Spent + S.C + ${GST_PCT}% GST`
      : `Amt Spent + ${scPct()}% S.C + ${GST_PCT}% GST`;
  };

  // ── Why the S.C columns are a gap, when they are ──────────────────────────
  // Same three-way split as the CM report: a null rate has three meanings and
  // only one is a bug.
  //   "n/a"      CPL client — null BY DESIGN, the rate is set only for
  //              hybrid/retainer at onboarding. These columns are hidden for
  //              CPL anyway, so this state never reaches a note.
  //   "missing"  a hybrid/retainer client came back with no rate. A bug in the
  //              client record: someone needs to go set it.
  //   "unknown"  no summary block at all, so the two can't be told apart.
  const scState = () => {
    if (scPct() != null) return "ok";
    if (!reportSummary()) return "unknown";
    if (iscplReport()) return "n/a";
    return "missing";
  };

  // CPL clients (service_charge null / client_type "cpl") pay per lead — no
  // service-charge or GST markup, so their S.C/GST columns are hidden. Keyed to
  // the REPORTED client's type (summary), not the viewer's role — this is what
  // stops the admin/CM view from showing S.C/GST columns for a CPL client.
  // Falls back to the viewer's role flag until the report response lands.
  //
  // client_type DECIDES when it is present. The old rule also treated a null
  // service_charge as CPL, which is true for a CPL client and wrong for anyone
  // else: a hybrid client whose rate failed to resolve was silently reclassified
  // as CPL and had its S.C/GST columns hidden — the missing rate disappearing
  // instead of showing as the gap it is. The null-rate test survives only for a
  // summary that carries no client_type at all.
  const iscplReport = () => {
    const s = reportSummary();
    if (!s) return iscplRole();
    if (s.client_type) return String(s.client_type).toLowerCase() === "cpl";
    return s.service_charge == null;
  };

  // Raw (agency-cost) spend is on the privileged ledger payload and absent from
  // the client one BY CONSTRUCTION, so this is a question about the viewer, not
  // about whether a key happened to appear on a row. A client login never
  // renders the internal Raw columns.
  const hasRawSpend = () => !isClientViewer();

  // Raw columns (Raw Spend + Raw CPL) render — on-screen AND in every download —
  // only when raw data exists (admin/CM) AND the user opted in via the toggle.
  // OFF → client-facing report (no raw anywhere, safe to share).
  const showRaw = () => hasRawSpend() && includeRaw();

  // The Amount Spent / Client Billed column (the spend the client is charged)
  // is AVAILABLE for admin/CM (raw data present → any client type, incl. CPL)
  // OR when the client has a service charge (hybrid/retainer — covers a hybrid
  // client's own login). Only the S.C + GST columns stay gated on
  // service_charge (i.e. !iscplReport). This is what lets CPL clients show
  // Raw/Client-Billed while still hiding S.C/GST.
  const canShowBilled = () => hasRawSpend() || !iscplReport();
  const canShowScGst = () => !iscplReport();

  // ── Lead replacement columns ──────────────────────────────────────────────
  // Shown when the client is CPL/hybrid (it's how they're billed, even at zero
  // replacements) OR when a replacement has actually been recorded. Retainer
  // clients have no replacement concept — the fields come back absent/zero and
  // these columns stay off. Keyed to the REPORTED client's type, not the
  // viewer's role, so an admin looking at a CPL client sees them.
  const reportClientType = () => {
    const s = reportSummary();
    if (s?.client_type) return String(s.client_type).toLowerCase();
    if (iscplReport()) return "cpl";
    if (ishybrid()) return "hybrid";
    if (isRetainer()) return "retainer";
    return "";
  };
  const anyReplaced = () => ledger().rows.some((r) => r.replacedLeads > 0);
  const showReplacement = () =>
    ledger().rows.length > 0 &&
    (reportClientType() === "cpl" ||
      reportClientType() === "hybrid" ||
      anyReplaced());
  // The spend after the replacement credit — max(0, premium_spend −
  // replaced_cost), straight off the ledger row.
  //
  // It is NOT an invoice: no service charge, no GST. The Billing page is the
  // authoritative billed figure, which the footnote under the table already
  // says. That distinction is why the column carries a tooltip rather than
  // sitting there looking like a total someone could pay against.
  //
  // It briefly had no source at all: the old per-project lead_breakdown block
  // was returning a wrong billable count (381 where the truth was 342 on
  // DholeraEvent), so it stopped being trustworthy for money and the column was
  // hidden rather than reconstructed from billable × a guessed rate. The ledger
  // carries it now. Worth noting the old column was not uniformly wrong —
  // GwaliorEvent's 86,802 was right — which is exactly why a partly-correct
  // money source is the dangerous kind.
  const showBilledAmount = () =>
    showReplacement() && ledger().rows.some((r) => r.billedAmount != null);

  // One sentence, used on the column header and its preview/PDF counterparts,
  // so the same caveat travels with the number wherever it is read.
  const BILLED_HINT =
    "Client-facing spend less the credit for replaced leads " +
    "(premium spend − replaced cost). Not an invoice: no service charge, " +
    "no GST. The Billing page is the authoritative billed amount.";

  // …and these are what the table actually renders: availability AND the user's
  // per-column checkbox. Checking a box can never reveal a column the gating
  // above forbids.
  const showBilled = () => canShowBilled() && showBilledCol();
  const showSc = () => canShowScGst() && showScCol();
  const showGst = () => canShowScGst() && showGstCol();
  // The per-project S.C/GST footnote only makes sense while one of them shows.
  const showScGstNote = () => showSc() || showGst();

  // Column-toggle checkbox (filters bar) — same look as the raw-spend toggle.
  const ColToggle = (props) => (
    <label class="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700 dark:text-gray-300">
      <input
        type="checkbox"
        checked={props.checked()}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
        class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
      />
      <span>{props.label()}</span>
    </label>
  );

  // True when from/to span exactly one whole calendar month (1st → last day).
  // Billing is strictly monthly, so a partial range gets an extra "indicative"
  // line under the table. No range selected → also not a month.
  const isFullMonthRange = () => {
    const from = fromDate();
    const to = toDate();
    if (!from || !to) return false;
    const f = new Date(from + "T00:00:00");
    const t = new Date(to + "T00:00:00");
    const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    return (
      f.getFullYear() === t.getFullYear() &&
      f.getMonth() === t.getMonth() &&
      f.getDate() === 1 &&
      t.getDate() === lastDay
    );
  };

  /* ── derived: ONE row per project (aggregated over selected date range) ── */
  // Every cell on this page — rows AND the TOTAL row — comes out of the shared
  // reader in services/ledgerCells: one named payload key per column, no
  // division, "—" for anything the payload didn't send. The three inputs below
  // are the only things about this table that are page-specific.
  const { rowOf } = makeLedgerCells({
    // A client's own login never receives raw agency cost.
    hasRaw: hasRawSpend,
    clientType: reportClientType,
    // The SELECTED client's own rate, from the report's meta.report_summary,
    // falling back to the viewer's billing overview until that lands.
    scMult,
    gstMult,
    iscpl: iscplReport,
  });

  const reportRows = createMemo(() => {
    const led = ledger();
    const rows = [];

    for (const project of projects()) {
      const row = led.byProject[String(project.id)];

      // ── Status filter ──────────────────────────────────────────────────
      // A campaign's active/paused state is NOT date-dependent, so the ledger's
      // campaign counts drive it — the same rule the dashboard uses. Falls back
      // to the projects API's own (stale) status before the ledger lands.
      if (statusFilter() !== "all") {
        const status = row
          ? row.campaignsActive > 0
            ? "active"
            : "paused"
          : (project.status ?? "").toLowerCase();
        if (statusFilter() !== status) continue;
      }

      // ── "Running in range" filter ──────────────────────────────────────
      // Only projects that actually did something in the selected window. The
      // range is the SERVER's now, so this is a presence test on the row rather
      // than a client-side date sweep — which is what used to let a July block
      // through an August filter.
      const active =
        !!row &&
        (row.totalLeads > 0 ||
          row.spend > 0 ||
          row.impressions > 0 ||
          row.clicks > 0);
      if (!active) continue;

      // ── Every figure on this row, TAKEN from that one payload row ───────
      // Generated, Replaced and Billable are three fields of ONE row, so the
      // subtraction shown on screen holds by construction. The money columns
      // beside them are now read the same way, which leaves no division on this
      // path to be wrong about.
      //
      // How it used to fail is worth knowing, because the shape of the bug was
      // not "a wrong number" but "two sources, one of them invisible": the row
      // carried a generatedLeads field from the SAME block as replaced and
      // billable — the correct, self-consistent figure — and the table never
      // rendered it. It printed the bulk-insights lead count beside them
      // instead, from a different endpoint over a different window. So the two
      // numbers a reader subtracted had never met, and 621 − 40 showed 381.
      // Anything that reintroduces a second source here reintroduces that.
      rows.push({
        projectId: project.id,
        projectName: project.name,
        projectStatus: project.status,
        ...rowOf(row.wire),
      });
    }

    // Sort alphabetically by project name (matches Main Dashboard feel)
    return rows.sort((a, b) => a.projectName.localeCompare(b.projectName));
  });

  /* ── footer totals ── */
  // The TOTAL row is the response's own `totals` block, read through the SAME
  // cellsOf() the rows use. It is not a roll-up of what is on screen, and that
  // is the point: the roll-up is where the second source got in. The footer's
  // raw CPL used to be Σ raw spend ÷ (meta + fed leads) and printed ₹137.13
  // beneath a single project row reading ₹147.05 — a one-row table whose total
  // disagreed with its only row, because fed leads are hand-entered and were
  // never bought with ad spend.
  //
  // Consequence worth stating: `totals` describes the whole period the backend
  // returned, so when a filter hides rows the footer is wider than the table
  // above it. That is disclosed under the table (see totalsCoversAll) rather
  // than papered over by re-summing — a footer that silently follows the
  // filters is exactly how the previous version justified computing its own.
  const totals = createMemo(() => rowOf(ledger().totals?.wire));

  // True when the rows on screen are the same set the totals block describes.
  // False whenever the status filter or the "ran in this range" test has
  // dropped a project the backend counted.
  const totalsCoversAll = () =>
    reportRows().length === ledger().rows.length;
  // How many projects the TOTAL row covers, straight off the payload.
  const totalsProjectCount = () =>
    ledger().totals?.projectCount ?? ledger().rows.length;

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

  // ── Hidden PDF template width ──────────────────────────────────────────────
  // html2canvas captures the element's box and the template clips its overflow,
  // so a fixed 900px box silently CROPS the right-hand columns once enough of
  // them are on (raw + billed + S.C + GST = 9 columns). Size the template to
  // the columns actually being rendered instead; downloadPDF then flips to
  // landscape when that's wide, so the extra columns stay legible after the
  // capture is scaled down to the page width.
  const pdfWidth = () => {
    let w = 155 + 180 + 80 + 110; // Date, Project, Leads, CPL — always present
    if (showReplacement()) w += 100 + 100; // Replaced + Billable
    if (showRaw()) w += 110 + 130; // Raw CPL + Raw Spend
    if (showBilled()) w += 140;
    if (showBilledAmount()) w += 140;
    if (showSc()) w += 175;
    if (showGst()) w += 215;
    return Math.max(900, w + 72); // + the template's 36px side padding
  };
  const pdfLandscape = () => pdfWidth() > 1000;

  const downloadPDF = async () => {
    const el = document.getElementById("pdf-daily-report");
    if (!el) return;

    const canvas = await html2canvas(el, {
      scale: 2, // keep 2 so text stays sharp; size is controlled by JPEG below
      backgroundColor: "#ffffff",
      useCORS: true, // lets the /logo.webp render into the canvas
      width: el.scrollWidth, // belt-and-braces: never clip the table
      windowWidth: el.scrollWidth,
    });

    // JPEG ~0.85 + jsPDF compression: this is where the size saving comes from
    const imgData = canvas.toDataURL("image/jpeg", 0.85);

    // Landscape once the table is wide — a 1300px-wide capture squeezed into a
    // 210mm portrait page renders the money columns too small to read.
    const landscape = pdfLandscape();
    const pdf = new jsPDF({
      orientation: landscape ? "l" : "p",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const pageW = landscape ? 297 : 210;
    const pageH = landscape ? 210 : 297;
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

  // ─── CSV / Excel export ────────────────────────────────────────────────────
  // Mirrors exactly what's in the table: the same columns (Spent columns only
  // for non-CPL clients, with their dynamic S.C / GST labels) plus the totals
  // row. Money leaves as plain numbers so a spreadsheet can sum/sort.
  const exportDateLabel = () =>
    fromDate() && toDate()
      ? `${new Date(fromDate()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} - ${new Date(toDate()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
      : "All Dates";
  const exportColumns = () => {
    const cols = [
      "Date",
      "Project",
      showReplacement() ? "Leads Generated" : "Leads",
    ];
    if (showReplacement()) cols.push("Replaced", "Billable");
    cols.push("CPL");
    if (showRaw()) cols.push("Raw CPL", "Raw Spend");
    if (showBilled()) cols.push(showRaw() ? "Client Billed" : "Amount Spent");
    if (showBilledAmount()) cols.push("Billed");
    if (showSc()) cols.push(scColLabel());
    if (showGst()) cols.push(finalColLabel());
    return cols;
  };
  // Rows and the TOTAL row are the same shape, so ONE cell list serves both —
  // which is what stops a downloaded sheet from carrying a total the screen
  // never showed. exp() blanks a null so a spreadsheet can still sum a column.
  const exportCells = (r) => {
    const base = [exp(r.leads)];
    if (showReplacement()) base.push(exp(r.replacedLeads), exp(r.billableLeads));
    base.push(exp(r.cpl));
    if (showRaw()) base.push(exp(r.rawCpl), exp(r.rawSpent));
    if (showBilled()) base.push(exp(r.spent));
    if (showBilledAmount()) base.push(exp(r.billedAmount));
    if (showSc()) base.push(exp(r.spentwithServiceCharge));
    if (showGst()) base.push(exp(r.spentwithservice_gst));
    return base;
  };
  const exportRow = (r) => [
    exportDateLabel(),
    r.projectName,
    ...exportCells(r),
  ];
  const exportTotalsRow = () => ["TOTAL", "", ...exportCells(totals())];
  const exportFileDate = () => new Date().toISOString().split("T")[0];
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
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, `daily-report-${exportFileDate()}.csv`);
  };

  const downloadExcel = () => {
    const rows = reportRows();
    if (!rows.length) return;
    const meta = [
      ["Daily Report"],
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
    XLSX.writeFile(wb, `daily-report-${exportFileDate()}.xlsx`);
  };

  const runExport = (fmt) => {
    setExportOpen(false);
    if (fmt === "csv") downloadCSV();
    else if (fmt === "excel") downloadExcel();
    else if (fmt === "pdf") downloadPDF();
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
        <Show when={ledgerLoading()}>
          <div class="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
            <div class="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Loading insights…
          </div>
        </Show>
      </div>

      {/* ── Filters ── */}
      <div class="flex flex-wrap items-center gap-3 mb-3">
        {/* Admin-only client selector — scopes the report + its service charge
            to one client (see selectedAdminClientId). */}
        <Show when={isAdmin()}>
          <div class="relative w-full sm:w-72">
            <input
              type="text"
              value={adminClientQuery()}
              disabled={adminClientsRes.loading}
              placeholder={
                adminClientsRes.loading
                  ? "Loading clients…"
                  : "Select a client…"
              }
              onInput={(e) => {
                setAdminClientQuery(e.currentTarget.value);
                setAdminClientOpen(true);
                if (selectedAdminClientId()) setSelectedAdminClientId("");
              }}
              onFocus={() => setAdminClientOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setAdminClientOpen(false);
                else if (e.key === "Enter") {
                  const f = filteredAdminClients();
                  if (f.length > 0) selectAdminClient(f[0]);
                }
              }}
              class="w-full border border-gray-300 dark:border-gray-600 px-3 py-2 pr-16 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500/25 focus:border-purple-500 disabled:opacity-60 placeholder:text-gray-400"
            />
            <div class="absolute inset-y-0 right-2.5 flex items-center gap-1">
              <Show when={adminClientQuery()}>
                <button
                  type="button"
                  onClick={clearAdminClient}
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

            <Show when={adminClientOpen() && !adminClientsRes.loading}>
              <div
                class="fixed inset-0 z-40"
                onClick={() => setAdminClientOpen(false)}
              />
              <div class="absolute left-0 right-0 top-full mt-1 z-50 max-h-64 overflow-y-auto rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-[0_10px_40px_rgba(16,29,49,0.18)] py-1">
                <Show
                  when={filteredAdminClients().length > 0}
                  fallback={
                    <div class="px-3 py-3 text-sm text-gray-400 dark:text-gray-500">
                      {adminClients().length === 0
                        ? "No clients"
                        : "No clients match your search"}
                    </div>
                  }
                >
                  <For each={filteredAdminClients()}>
                    {(c) => (
                      <button
                        type="button"
                        onClick={() => selectAdminClient(c)}
                        class={
                          "w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors " +
                          (String(c.id) === String(selectedAdminClientId())
                            ? "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-semibold"
                            : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800")
                        }
                      >
                        <span class="truncate">
                          {c.client_nomen_name || c.organization_name || "—"}
                        </span>
                        <Show when={c.client_type}>
                          <span class="flex-none text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
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
        </Show>

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
            // FIX 3: return to the initial empty state — clear the range (no
            // default), and for admins the picked client, plus any loaded data,
            // so the prompt(s) show again with no stale rows.
            batch(() => {
              setStatusFilter("all");
              setFromDate("");
              setToDate("");
              setShowPreview(false);
              setProjects([]);
              setInsightsMap({});
              setProjectsSummary(null);
              if (isAdmin()) {
                setSelectedAdminClientId("");
                setAdminClientQuery("");
                setAdminClientOpen(false);
              }
            });
            loadedKey = null; // let a fresh selection load again
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

      {/* ── Column toggles (own rows, under the filters) ───────────────────
          Row 1: raw spend/CPL (client-vs-internal). Row 2: one checkbox per
          money column, so a report can be trimmed to just the figures you want
          to share. Like the raw toggle, these only exist once a client + date
          range are picked and the report has loaded — until then there's no
          client type / S.C rate to label them with. Each checkbox also only
          appears when that column is available at all for this client / role.
          Applies to the table, Preview, PDF, CSV and Excel alike. */}
      <Show when={ready() && !loading() && !isClient()}>
        <div class="space-y-2 mb-5">
          <Show when={hasRawSpend()}>
            <div class="flex flex-wrap items-center justify-start sm:justify-end gap-x-5 gap-y-2">
              <label class="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={includeRaw()}
                  onChange={(e) => setIncludeRaw(e.currentTarget.checked)}
                  class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
                />
                <span>
                  Include raw spend / CPL
                  <span class="text-gray-400 dark:text-gray-500">
                    {" "}
                    — internal (off = client-facing)
                  </span>
                </span>
              </label>
            </div>
          </Show>

          <Show when={canShowBilled() || canShowScGst()}>
            <div class="flex flex-wrap items-center justify-start sm:justify-end gap-x-5 gap-y-2">
              <Show when={canShowBilled()}>
                <ColToggle
                  checked={showBilledCol}
                  onChange={setShowBilledCol}
                  label={() => (showRaw() ? "Client Billed" : "Amount Spent")}
                />
              </Show>
              <Show when={canShowScGst()}>
                <ColToggle
                  checked={showScCol}
                  onChange={setShowScCol}
                  label={scColLabel}
                />
                <ColToggle
                  checked={showGstCol}
                  onChange={setShowGstCol}
                  label={finalColLabel}
                />
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* ── Empty state: prompt until the selection is complete ──
             Admins need a client first, then everyone needs a date range.
             Nothing loads until ready() (FIX 2). ── */}
      <Show when={!ready()}>
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
              d={
                adminNeedsClient()
                  ? "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z"
                  : "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              }
            />
          </svg>
          <p class="mt-3 text-sm font-semibold text-gray-600 dark:text-gray-300">
            {adminNeedsClient() ? "Select a client" : "Select a date range"}
          </p>
          <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {adminNeedsClient()
              ? "Pick a client above, then choose a date range to load their report — the report is per-client."
              : "Choose a date range above to load the report. Nothing is shown until a range is selected."}
          </p>
        </div>
      </Show>

      {/* ── Report body (hidden until client + date range are selected) ── */}
      <Show when={ready()}>
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
        <div class="overflow-x-auto overflow-y-auto max-h-[500px] bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <table class="w-full text-sm table-auto">
            <thead class="bg-gray-100 dark:bg-gray-800 sticky top-0 z-10">
              <tr class="[&_th]:text-center [&_th:first-child]:text-left text-gray-700 dark:text-gray-200 [&_th]:whitespace-nowrap [&_th]:font-semibold">
                <th class="p-3 pl-4">Date</th>
                <th class="p-3">Project</th>
                <th class="p-3">{showReplacement() ? "Leads Generated" : "Leads"}</th>
                {/* Generated → Replaced → Billable reads left to right */}
                <Show when={showReplacement()}>
                  <th class="p-3 text-[#AC2334] dark:text-red-400">Replaced</th>
                  <th class="p-3">Billable</th>
                </Show>
                <th class="p-3">CPL</th>
                {/* Raw (agency cost) — admin/CM, toggle on; all client types */}
                <Show when={showRaw()}>
                  <th class="p-3">Raw CPL</th>
                  <th class="p-3">Raw Spend</th>
                </Show>
                <Show when={showBilled()}>
                  <th class="p-3">
                    {showRaw() ? "Client Billed" : "Amount Spent"}
                  </th>
                </Show>
                {/* Ad spend (above) vs Billed (after the replacement credit) */}
                <Show when={showBilledAmount()}>
                  <th class="p-3" title={BILLED_HINT}>
                    Billed
                  </th>
                </Show>
                {/* S.C + GST only when the client has a service charge */}
                <Show when={showSc()}>
                  <th class="p-3">{scColLabel()}</th>
                </Show>
                <Show when={showGst()}>
                  <th class="p-3">{finalColLabel()}</th>
                </Show>
              </tr>
            </thead>

            <Show when={!ledgerLoading()} fallback={<SkeletonRows />}>
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
                              : "All Dates"}
                          </span>
                        </td>

                        {/* Project name — status badge removed */}
                        <td class="p-3">
                          <span class="font-medium text-purple-700 dark:text-purple-300">
                            {row.projectName}
                          </span>
                        </td>

                        {/* Leads generated */}
                        <td class="p-3 font-bold text-gray-800 dark:text-gray-100">
                          {count(row.leads)}
                        </td>

                        {/* Replaced → Billable */}
                        <Show when={showReplacement()}>
                          <td class="p-3 font-semibold text-[#AC2334] dark:text-red-400">
                            {credit(row.replacedLeads)}
                          </td>
                          <td class="p-3 font-bold text-gray-800 dark:text-gray-100">
                            {count(row.billableLeads)}
                          </td>
                        </Show>

                        {/* CPL — premium_cpl, the client-facing figure */}
                        <td class="p-3 text-purple-700 dark:text-purple-300">
                          {money(row.cpl)}
                        </td>

                        {/* Spent */}
                        {/* Raw (agency cost) — admin/CM, toggle on */}
                        <Show when={showRaw()}>
                          <td class="p-3 text-amber-700 dark:text-amber-400">
                            {money(row.rawCpl)}
                          </td>
                          <td class="p-3 text-amber-700 dark:text-amber-400">
                            {money(row.rawSpent)}
                          </td>
                        </Show>
                        <Show when={showBilled()}>
                          <td class="p-3 text-green-700 dark:text-green-400">
                            {money(row.spent)}
                          </td>
                        </Show>
                        <Show when={showBilledAmount()}>
                          <td class="p-3 font-semibold text-green-800 dark:text-green-300">
                            {money(row.billedAmount)}
                          </td>
                        </Show>
                        <Show when={showSc()}>
                          <td class="p-3 text-green-700 dark:text-green-400">
                            {money(row.spentwithServiceCharge)}
                          </td>
                        </Show>
                        {/* spent + service charge + GST  */}
                        <Show when={showGst()}>
                          <td class="p-3 text-green-900 dark:text-green-400">
                            {money(row.spentwithservice_gst)}
                          </td>
                        </Show>
                      </tr>
                    )}
                  </For>
                </tbody>

                {/* Footer totals */}
                <tfoot class="sticky bottom-0 z-10">
                  <tr class="bg-gradient-to-r from-purple-100 to-purple-50 dark:from-gray-800 dark:to-gray-900 border-t-2 border-purple-300 dark:border-gray-600 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] [&_td]:text-center [&_td:first-child]:text-left font-semibold">
                    <td class="p-3 pl-4">
                      <span class="px-3 py-1 bg-purple-600 text-white rounded-lg text-xs font-bold tracking-wide">
                        TOTAL
                      </span>
                    </td>
                    <td class="p-3" />
                    <td class="p-3 text-green-700 dark:text-green-300 font-bold text-base">
                      {count(totals().leads)}
                    </td>
                    <Show when={showReplacement()}>
                      <td class="p-3 text-[#AC2334] dark:text-red-400 font-bold">
                        {credit(totals().replacedLeads)}
                      </td>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold text-base">
                        {count(totals().billableLeads)}
                      </td>
                    </Show>
                    <td class="p-3 text-purple-700 dark:text-purple-300 font-bold">
                      {money(totals().cpl)}
                    </td>
                    <Show when={showRaw()}>
                      <td class="p-3 text-amber-700 dark:text-amber-400 font-bold">
                        {money(totals().rawCpl)}
                      </td>
                      <td class="p-3 text-amber-700 dark:text-amber-400 font-bold">
                        {money(totals().rawSpent)}
                      </td>
                    </Show>
                    <Show when={showBilled()}>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold">
                        {money(totals().spent)}
                      </td>
                    </Show>
                    <Show when={showBilledAmount()}>
                      <td class="p-3 text-green-800 dark:text-green-300 font-bold">
                        {money(totals().billedAmount)}
                      </td>
                    </Show>
                    <Show when={showSc()}>
                      <td class="p-3 text-green-700 dark:text-green-300 font-bold">
                        {money(totals().spentwithServiceCharge)}
                      </td>
                    </Show>
                    <Show when={showGst()}>
                      <td class="p-3 text-green-900 dark:text-green-400 font-bold">
                        {money(totals().spentwithservice_gst)}
                      </td>
                    </Show>
                  </tr>
                </tfoot>
              </Show>
            </Show>
          </table>
        </div>
        </Show>

        {/* What the TOTAL row is, when it isn't what's on screen. The footer
            reads the payload's own totals block, so it covers every project in
            the period — including any the status filter or the "ran in range"
            test has hidden. Saying so is the price of not re-summing: a footer
            that quietly followed the filters is what made computing one look
            reasonable, and computing one is what printed ₹137.13 under a
            ₹147.05 row. */}
        <Show when={reportRows().length > 0 && !totalsCoversAll()}>
          <p class="mt-3 text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
            The <b class="font-semibold">TOTAL</b> row is the period total for
            all {totalsProjectCount()} projects, as sent by the server — the
            table above is filtered to {reportRows().length}. The two are not
            meant to add up.
          </p>
        </Show>

        {/* Lead-replacement footnote — what the three columns mean. Every
            column on the row is scoped to the selected range, so there is no
            scope caveat to give; these daily figures roll up to the monthly
            invoice on the Billing page. */}
        <Show when={showReplacement() && reportRows().length > 0}>
          <p class="mt-3 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            Billable leads = generated − replaced. CPL and utilisation stay on
            true ad spend; <b class="font-semibold">Billed</b> is the amount
            charged after the replacement credit.
          </p>
        </Show>

        {/* Why the S.C columns are a gap, when they are. Same split as the CM
            report, and for the same reason: "no rate applies" and "the rate is
            missing" are both an em dash on screen, and only the second is
            something to go and fix. The "n/a" case doesn't appear here — these
            columns are hidden for CPL clients entirely. */}
        <Show when={showScGstNote() && reportRows().length > 0}>
          <Show when={scState() === "missing"}>
            <p class="mt-3 text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
              This client is{" "}
              <b class="font-semibold">{reportClientType() || "not CPL"}</b>, so
              a service-charge rate should be set against it — none came back
              with this report. The S.C and GST columns show “—” rather than
              assuming 0%; the rate needs setting on the client record. Client
              Billed beside them is unaffected.
            </p>
          </Show>
          <Show when={scState() === "unknown"}>
            <p class="mt-3 text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
              No client summary came back with this report, so the
              service-charge rate is unknown. The S.C and GST columns show “—”
              rather than assuming 0%. Client Billed beside them is unaffected.
            </p>
          </Show>
        </Show>

        {/* Indicative-figures footnote — only when the S.C/GST columns show
            (hybrid/retainer) and there's data. The report computes S.C/GST per
            project (rounded per row) while Billing rounds once on the whole
            month, so the two can differ by a few paise; Billing is the source
            of truth. Purely explanatory — the numbers above are unchanged. */}
        <Show when={showScGstNote() && reportRows().length > 0}>
          <p class="mt-3 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            <svg
              class="inline-block w-3.5 h-3.5 -mt-0.5 mr-1 text-gray-400 dark:text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Service charge and GST shown are indicative, computed per project.
            The authoritative billed amount (rounded at the client/month level)
            appears on the{" "}
            <span class="font-medium text-gray-500 dark:text-gray-400">
              Billing
            </span>{" "}
            page.
            <Show when={!isFullMonthRange()}>
              {" "}
              Billing is calculated monthly; figures for a partial range are
              indicative.
            </Show>
          </p>
        </Show>

      {/* ── Action Buttons ── */}
      <div class="sticky bottom-0 z-20 flex items-center gap-3 mt-6 flex-wrap -mx-4 px-4 py-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-t border-gray-200 dark:border-gray-700">
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

        {/* Download report — PDF / CSV / Excel dropdown */}
        <div class="relative">
          <button
            onClick={() => setExportOpen((v) => !v)}
            disabled={reportRows().length === 0}
            aria-haspopup="true"
            aria-expanded={exportOpen()}
            class={
              "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shadow-sm " +
              (reportRows().length === 0
                ? "opacity-40 cursor-not-allowed bg-blue-900 text-white"
                : "bg-purple-900 hover:bg-purple-700 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-white hover:shadow-md")
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
            {/* click-away catcher */}
            <div class="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
            <div class="absolute left-0 bottom-full mb-2 w-60 z-50 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-[0_10px_40px_rgba(16,29,49,0.18)] overflow-hidden py-1.5">
              <p class="px-3.5 pt-1.5 pb-2 text-[12px] font-bold uppercase tracking-wider text-gray-700 dark:text-gray-500">
                Export {reportRows().length} row{reportRows().length !== 1 ? "s" : ""} as
              </p>
              <For each={[
                { fmt: "pdf", label: "PDF", sub: "Branded A4 document", tint: "#6B21A8" },
                { fmt: "csv", label: "CSV", sub: "Comma-separated values", tint: "#15966A" },
                { fmt: "excel", label: "Excel", sub: "Formatted .xlsx workbook", tint: "#1D7044" },
              ]}>
                {(o) => (
                  <button
                    onClick={() => runExport(o.fmt)}
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <span class="w-8 h-8 flex-none rounded-lg grid place-items-center text-[11px] font-extrabold text-white" style={`background:${o.tint}`}>{o.label.slice(0, 3).toUpperCase()}</span>
                    <span class="min-w-0">
                      <span class="block text-[13px] font-bold text-gray-900 dark:text-gray-100">{o.label}</span>
                      <span class="block text-[11px] text-gray-400 dark:text-gray-500">{o.sub}</span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

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
                    {showReplacement() ? "Leads Generated" : "Leads"}
                  </th>
                  <Show when={showReplacement()}>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      Replaced
                    </th>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      Billable
                    </th>
                  </Show>
                  <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                    CPL
                  </th>
                  <Show when={showRaw()}>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      Raw CPL
                    </th>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      Raw Spend
                    </th>
                  </Show>
                  <Show when={showBilled()}>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      {showRaw() ? "Client Billed" : "Amount Spent"}
                    </th>
                  </Show>
                  <Show when={showBilledAmount()}>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      Billed
                    </th>
                  </Show>
                  <Show when={showSc()}>
                    <th class="px-4 py-3 text-center text-white text-md  uppercase font-semibold border-r border-white/10">
                      {scColLabel()}
                    </th>
                  </Show>
                  <Show when={showGst()}>
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
                            : "All Dates"}
                        </span>
                      </td>
                      {/* Project */}
                      <td class="px-4 py-3 text-center text-[#333] font-medium text-md whitespace-nowrap border-r border-[rgba(123,28,28,0.1)]">
                        {row.projectName}
                      </td>
                      {/* Leads — maroon accent */}
                      <td class="px-4 py-3 text-center font-bold text-[#7B1C1C] text-md border-r border-[rgba(123,28,28,0.1)]">
                        {count(row.leads)}
                      </td>
                      <Show when={showReplacement()}>
                        <td class="px-4 py-3 text-center font-semibold text-[#AC2334] text-md border-r border-[rgba(123,28,28,0.1)]">
                          {credit(row.replacedLeads)}
                        </td>
                        <td class="px-4 py-3 text-center font-bold text-[#1a1a1a] text-md border-r border-[rgba(123,28,28,0.1)]">
                          {count(row.billableLeads)}
                        </td>
                      </Show>
                      <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                        {money(row.cpl)}
                      </td>
                      <Show when={showRaw()}>
                        <td class="px-4 py-3 text-center text-[#8a5a00] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                          {money(row.rawCpl)}
                        </td>
                        <td class="px-4 py-3 text-center text-[#8a5a00] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                          {money(row.rawSpent)}
                        </td>
                      </Show>
                      <Show when={showBilled()}>
                        <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                          {money(row.spent)}
                        </td>
                      </Show>
                      <Show when={showBilledAmount()}>
                        <td class="px-4 py-3 text-center text-[#1a1a1a] font-semibold text-md border-r border-[rgba(123,28,28,0.1)]">
                          {money(row.billedAmount)}
                        </td>
                      </Show>
                      <Show when={showSc()}>
                        <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                          {money(row.spentwithServiceCharge)}
                        </td>
                      </Show>
                      {/* GST — warm gold tint */}
                      <Show when={showGst()}>
                        <td class="px-4 py-3 text-center text-[#333] font-medium text-md border-r border-[rgba(123,28,28,0.1)]">
                          {money(row.spentwithservice_gst)}
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
                    {count(totals().leads)}
                  </td>
                  <Show when={showReplacement()}>
                    <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                      {credit(totals().replacedLeads)}
                    </td>
                    <td class="px-4 py-3 text-center text-white font-bold text-sm border-r border-white/10">
                      {count(totals().billableLeads)}
                    </td>
                  </Show>
                  <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                    {money(totals().cpl)}
                  </td>
                  <Show when={showRaw()}>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {money(totals().rawCpl)}
                    </td>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {money(totals().rawSpent)}
                    </td>
                  </Show>
                  <Show when={showBilled()}>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {money(totals().spent)}
                    </td>
                  </Show>
                  <Show when={showBilledAmount()}>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {money(totals().billedAmount)}
                    </td>
                  </Show>
                  <Show when={showSc()}>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {money(totals().spentwithServiceCharge)}
                    </td>
                  </Show>
                  <Show when={showGst()}>
                    <td class="px-4 py-3 text-center text-white font-bold text-md border-r border-white/10">
                      {money(totals().spentwithservice_gst)}
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
        style={`position:absolute;left:-9999px;top:0;width:${pdfWidth()}px;`}
      >
        <div
          style={`width:${pdfWidth()}px;background:#ffffff;font-family:Arial,sans-serif;position:relative;box-sizing:border-box;border:1px solid rgba(123,28,28,0.15);border-radius:12px;overflow:hidden;`}
        >
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
                      {showReplacement() ? "Leads Gen." : "Leads"}
                    </th>
                    <Show when={showReplacement()}>
                      <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        Replaced
                      </th>
                      <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        Billable
                      </th>
                    </Show>
                    <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                      CPL
                    </th>
                    <Show when={showRaw()}>
                      <th style="padding:11px 14px;text-align:center;color:#f5d9a0;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        Raw CPL
                      </th>
                      <th style="padding:11px 14px;text-align:center;color:#f5d9a0;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        Raw Spend
                      </th>
                    </Show>
                    <Show when={showBilled()}>
                      <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        {showRaw() ? "Client Billed" : "Amt Spent"}
                      </th>
                    </Show>
                    <Show when={showBilledAmount()}>
                      <th style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.12);">
                        Billed
                      </th>
                    </Show>
                    <Show when={showSc()}>
                      <th style="padding:11px 14px;text-align:center;color:#f5d9a0;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;">
                        {scColLabel()}
                      </th>
                    </Show>
                    <Show when={showGst()}>
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
                      <td style="padding:10px 14px;font-size:14px;font-weight:600;color:#1a1a1a;white-space:nowrap;border-right:1px solid rgba(123,28,28,0.1);border-left:3px solid #7B1C1C;">
                        {fromDate() && toDate()
                          ? `${new Date(fromDate()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} - ${new Date(toDate()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                          : "All Dates"}
                      </td>
                      <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;font-weight:500;border-right:1px solid rgba(123,28,28,0.1);">
                        {row.projectName}
                      </td>
                      <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:700;color:#7B1C1C;border-right:1px solid rgba(123,28,28,0.1);">
                        {count(row.leads)}
                      </td>
                      <Show when={showReplacement()}>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#AC2334;border-right:1px solid rgba(123,28,28,0.1);">
                          {credit(row.replacedLeads)}
                        </td>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:700;color:#1a1a1a;border-right:1px solid rgba(123,28,28,0.1);">
                          {count(row.billableLeads)}
                        </td>
                      </Show>
                      <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                        {money(row.cpl)}
                      </td>
                      <Show when={showRaw()}>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;color:#8a5a00;font-weight:600;border-right:1px solid rgba(123,28,28,0.1);">
                          {money(row.rawCpl)}
                        </td>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;color:#8a5a00;font-weight:600;border-right:1px solid rgba(123,28,28,0.1);">
                          {money(row.rawSpent)}
                        </td>
                      </Show>
                      <Show when={showBilled()}>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;color:#333;border-right:1px solid rgba(123,28,28,0.1);">
                          {money(row.spent)}
                        </td>
                      </Show>
                      <Show when={showBilledAmount()}>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#1a1a1a;border-right:1px solid rgba(123,28,28,0.1);">
                          {money(row.billedAmount)}
                        </td>
                      </Show>
                      <Show when={showSc()}>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#6b4c10;background:rgba(201,168,76,0.10);">
                          {money(row.spentwithServiceCharge)}
                        </td>
                      </Show>
                      <Show when={showGst()}>
                        <td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:600;color:#6b4c10;background:rgba(201,168,76,0.10);">
                          {money(row.spentwithservice_gst)}
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
                      {count(totals().leads)}
                    </td>
                    <Show when={showReplacement()}>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {credit(totals().replacedLeads)}
                      </td>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {count(totals().billableLeads)}
                      </td>
                    </Show>
                    <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                      {money(totals().cpl)}
                    </td>
                    <Show when={showRaw()}>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {money(totals().rawCpl)}
                      </td>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {money(totals().rawSpent)}
                      </td>
                    </Show>
                    <Show when={showBilled()}>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {money(totals().spent)}
                      </td>
                    </Show>
                    <Show when={showBilledAmount()}>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {money(totals().billedAmount)}
                      </td>
                    </Show>
                    <Show when={showSc()}>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;">
                        {money(totals().spentwithServiceCharge)}
                      </td>
                    </Show>
                    <Show when={showGst()}>
                      <td style="padding:11px 14px;text-align:center;color:#fff;font-size:14px;font-weight:700;border-right:1px solid rgba(255,255,255,0.12);">
                        {money(totals().spentwithservice_gst)}
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
      </Show>
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
