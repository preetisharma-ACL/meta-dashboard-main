import { api } from "../api/api";
import { fetchFedLeadBatches } from "./fedLeads";
import { scopeQuery, applyMeta } from "../stores/cmScope";

const getClientNomen = () => {
  const auth = JSON.parse(localStorage.getItem("auth") || "{}");

  // Admins AND campaign managers view clients through a switchable context, so
  // both scope off selectedClientNomen. A CM is not a client — auth.clientNomen
  // is null for them — so gating this on admin alone sent no client_nomen at all
  // and the request came back with the CM's whole book of business (every client
  // they manage) under one client's page. A CM passing client_nomen still can't
  // widen past their own scope: the backend intersects the two.
  // Sales views clients through the same switchable context; backend intersects
  // with their onboarded scope, so this can never widen.
  if (
    auth?.role === "admin" ||
    auth?.role === "campaign_manager" ||
    auth?.role === "sales"
  ) {
    return localStorage.getItem("selectedClientNomen") || null;
  }

  return auth?.clientNomen || null;
};

export const fetchProjects = async (
  page = 1,
  search = "",
  pageSize = 20,
  clientId = null,
) => {
  let url = `/projects/?page=${page}&page_size=${pageSize}`;

  if (search) {
    url += `&search=${search}`;
  }

  // An explicit client_id (the admin Daily Report's client picker) scopes the
  // list to that one client and makes the backend return its per-client
  // meta.report_summary (client_type + service_charge). It takes precedence over
  // the global selectedClientNomen so the picker is authoritative.
  if (clientId != null && clientId !== "") {
    url += `&client_id=${encodeURIComponent(clientId)}`;
  } else {
    const selectedClientNomen = localStorage.getItem("selectedClientNomen");
    if (selectedClientNomen) {
      url += `&client_nomen=${selectedClientNomen}`;
    }
  }

  return await api(url, {
    method: "GET",
  });
};

// Manual (fed) lead batches for the client currently in context. Delegates to
// the shared fed-leads service so the fetch is paginated — a single page
// silently truncated the roll-up once a client had enough batches — and so every
// surface reads batches the same way. Returns the usual { data } envelope shape
// the callers already unwrap.
export const fetchManualBatches = async () => {
  const rows = await fetchFedLeadBatches({ clientNomen: getClientNomen() });
  return { data: rows };
};

// ── Project ledger (server-aggregated) ───────────────────────────────────────
// GET /dashboard/ledger/?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
//
// Returns the FINISHED per-project ledger — spend, Meta / fed / total /
// replaced / billable leads, CPL, impressions, clicks and campaign status
// counts — plus a matching `totals` block. It replaces the browser-side join
// this dashboard used to do: fetchAllCampaigns(10_000) + fetchBulkCampaignInsights
// over every campaign id + the manual / fed / replacement batch sweeps, all
// reduced in the tab. For an admin that was the whole agency's data over the
// wire; this is one ~0.2s request.
//
// Both dates are optional — the backend defaults to month-to-date, floors at
// 2026-04-01 and caps at today, so nothing is clamped on this side.
//
// NOT FOR CLIENT LOGINS. This sums CampaignInsight.spend RAW — the agency's own
// cost, with no display config and no markup — which is correct for admin / CM /
// sales / coordination / accounts and ~23% under what a client is billed. The
// backend 403s clients; callers must also make sure the request cannot fire (see
// ClientDashboard's ledger resources, whose source is false for a client).
//
// SCOPING IS SERVER-SIDE. The same URL returns each role its own slice, so
// nothing here filters by role. We still send the CLIENT CONTEXT — client_nomen
// plus the CM switch-mode params — because this dashboard renders ONE client at
// a time. Verified live against backend aba2257: with no param the caller gets
// their whole scope (448 projects for admin), and client_nomen / client_nomen_id
// / as_client_id each narrow it to that one client. The param can only NARROW —
// a CM passing another CM's client id gets 0 projects and 0.00 spend — so
// sending it can never widen what the role may already see.
export const fetchDashboardLedger = async ({ startDate, endDate } = {}) => {
  let url = `/dashboard/ledger/?1=1`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
  if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;

  const nomen = getClientNomen();
  if (nomen) url += `&client_nomen=${encodeURIComponent(nomen)}`;
  url += scopeQuery();

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// ── Ledger reader ────────────────────────────────────────────────────────────
// Envelope-proof read of a ledger response into the shape the dashboard renders.
// Every numeric field is coerced HERE and nowhere else, so a string "912874.47"
// can't reach a .toLocaleString() as a string (a silent no-op that drops the
// thousands grouping) or a sort comparison as text.
//
// The per-row RULES are the backend's and are deliberately NOT re-derived:
//   • cpl divides by META leads (fed leads cost nothing on Meta)
//   • fed_leads is ALREADY INSIDE total_leads — never added on top
//   • campaign status counts are NOT date-filtered
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const ledgerRow = (r) => ({
  projectId: r?.project_id ?? null,
  projectName: r?.project_name ?? "",
  spend: num(r?.spend),
  metaLeads: num(r?.meta_leads),
  fedLeads: num(r?.fed_leads),
  totalLeads: num(r?.total_leads),
  replacedLeads: num(r?.replaced_leads),
  billableLeads: num(r?.billable_leads),
  // null (not 0) when the backend could not divide — no Meta leads in range.
  // A 0 here would read as "free leads"; callers decide how to print the gap.
  cpl: r?.cpl == null ? null : num(r.cpl),
  impressions: num(r?.impressions),
  clicks: num(r?.clicks),
  campaignsTotal: num(r?.campaigns_total),
  campaignsActive: num(r?.campaigns_active),
  campaignsPaused: num(r?.campaigns_paused),
  campaignsCompleted: num(r?.campaigns_completed),
});

export const readDashboardLedger = (res) => {
  const data = res?.data ?? {};
  const rows = (Array.isArray(data.rows) ? data.rows : []).map(ledgerRow);

  // project_id → row, for the join against the projects list (which carries the
  // city / type / budget / logo the ledger response doesn't).
  const byProject = {};
  for (const row of rows) {
    if (row.projectId != null) byProject[String(row.projectId)] = row;
  }

  return {
    rows,
    byProject,
    totals: {
      ...ledgerRow(data.totals ?? {}),
      projectCount: num(data.totals?.project_count),
    },
    dateRange: data.date_range ?? null,
    scope: data.scope ?? null,
    // Distinguishes "the response landed and this client genuinely has nothing"
    // from "nothing has come back yet" — the difference between a truthful 0 and
    // a placeholder, which the loading states below key off.
    loaded: true,
    // The request finished. `settled` is also true on a FAILURE (see the
    // caller), which is what stops a count-up animating forever on an error;
    // `loaded` stays false there so nothing treats the zeros as real.
    settled: true,
  };
};

// The shape every consumer reads BEFORE the first response lands, so no memo has
// to null-check its way through a render. loaded:false marks it as a placeholder,
// and settled:false says the request is still out — nothing may animate to these
// zeros, because they are not data.
export const EMPTY_LEDGER = {
  rows: [],
  byProject: {},
  totals: { ...ledgerRow({}), projectCount: 0 },
  dateRange: null,
  scope: null,
  loaded: false,
  settled: false,
};
