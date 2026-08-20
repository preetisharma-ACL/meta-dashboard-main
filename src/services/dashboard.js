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
// this dashboard used to do: for privileged roles fetchAllCampaigns(10_000) plus
// fetchBulkCampaignInsights over every campaign id plus the fed / replacement
// batch sweeps; for a client a per-project campaigns sweep (2N requests on every
// date change), a bulk-insights call and /leads/my-replacements/. All of it is
// now one ~0.2s request per date window.
//
// Both dates are optional — the backend defaults to month-to-date, floors at
// 2026-04-01 and caps at today, so nothing is clamped on this side.
//
// TWO PAYLOAD SHAPES, ONE URL. The money keys differ by role, on purpose:
//
//   privileged (admin / CM / sales / coordination / accounts)
//     `spend` + `cpl` — RAW agency cost. Our true ad spend: no display config,
//     no markup. What these roles are meant to see.
//
//   client
//     `premium_spend` + `premium_cpl`, and NO `spend` / `cpl` keys AT ALL —
//     absent, not zeroed, so a raw figure cannot reach a client through some
//     future change. premium_spend is marked-up spend for a hybrid client,
//     leads × fixed_cpl for a CPL client, and raw spend for a retainer client
//     (they pay a flat fee, so the ad spend genuinely is theirs to see).
//
// Which shape you get is decided server-side by the caller's role — but the
// READER is picked on this side, and the two must agree. readDashboardLedger()
// and readClientLedger() below are deliberately separate functions that each
// look at one set of keys and never fall back to the other's: a mismatch shows
// up as a visible zero, never as a 23% understatement wearing the right label.
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

// ── Ledger readers ───────────────────────────────────────────────────────────
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

// Everything that means the same thing for every role.
const commonRow = (r) => ({
  projectId: r?.project_id ?? null,
  projectName: r?.project_name ?? "",
  metaLeads: num(r?.meta_leads),
  fedLeads: num(r?.fed_leads),
  totalLeads: num(r?.total_leads),
  replacedLeads: num(r?.replaced_leads),
  billableLeads: num(r?.billable_leads),
  impressions: num(r?.impressions),
  clicks: num(r?.clicks),
  campaignsTotal: num(r?.campaigns_total),
  campaignsActive: num(r?.campaigns_active),
  campaignsPaused: num(r?.campaigns_paused),
  campaignsCompleted: num(r?.campaigns_completed),
});

// `spend` / `cpl` on the NORMALISED row mean "the money this viewer is entitled
// to see". Which wire keys that came from is settled here and nowhere else, so
// no render site ever has to know which role it is drawing for.
//
// cpl is null (not 0) when the backend could not divide — no Meta leads in
// range. A 0 there would read as "free leads"; callers decide how to print it.

// PRIVILEGED — raw agency cost, PLUS the marked-up figure alongside it. These
// roles are the only ones who see both, which is the whole point of the Premium
// CPL column: raw is what the ads cost us, premium is what the client is billed.
//
// premiumCpl is null (never 0) when there is nothing to divide, and that happens
// legitimately — a retainer client has no display config by design, and a
// handful of client+project pairs are simply missing one. Null must reach the
// render as null so it can print "—"; a 0 would read as "billed nothing".
const ledgerRow = (r) => ({
  ...commonRow(r),
  spend: num(r?.spend),
  cpl: r?.cpl == null ? null : num(r.cpl),
  premiumSpend: r?.premium_spend == null ? null : num(r.premium_spend),
  premiumCpl: r?.premium_cpl == null ? null : num(r.premium_cpl),
});

// CLIENT — the marked-up / fixed-CPL figure they are billed against. This
// function never reads `spend` or `cpl`, and a client payload never carries
// them. Note there is no second "premium CPL" column for a client: their spend
// already IS the marked-up figure, so premium_cpl is their AVG CPL.
const clientRow = (r) => ({
  ...commonRow(r),
  spend: num(r?.premium_spend),
  cpl: r?.premium_cpl == null ? null : num(r.premium_cpl),
  // No SECOND premium figure for a client: the two above already ARE the premium
  // ones. Null rather than a copy, so nothing downstream can render a client a
  // "Premium CPL" column comparing a number against itself.
  premiumSpend: null,
  premiumCpl: null,
});

const buildLedger = (res, rowOf) => {
  const data = res?.data ?? {};
  const rows = (Array.isArray(data.rows) ? data.rows : []).map(rowOf);

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
      ...rowOf(data.totals ?? {}),
      projectCount: num(data.totals?.project_count),
    },
    dateRange: data.date_range ?? null,
    scope: data.scope ?? null,
    // Distinguishes "the response landed and this client genuinely has nothing"
    // from "nothing has come back yet" — the difference between a truthful 0 and
    // a placeholder, which the loading states key off.
    loaded: true,
    // The request finished. `settled` is also true on a FAILURE (see the
    // caller), which is what stops a count-up animating forever on an error;
    // `loaded` stays false there so nothing treats the zeros as real.
    settled: true,
  };
};

export const readDashboardLedger = (res) => buildLedger(res, ledgerRow);

// A client payload must be free of the raw money keys. The backend keeps them
// out; this is the tripwire for the day something re-introduces one, because the
// failure it guards against is invisible by construction — a plausible number,
// 23% light, under exactly the right label. Dev only.
const assertNoRawMoney = (res) => {
  if (!import.meta.env?.DEV) return;
  const rows = Array.isArray(res?.data?.rows) ? res.data.rows : [];
  const suspect = rows.find(
    (r) => r && ("spend" in r || "cpl" in r || "spend_raw" in r),
  );
  if (suspect) {
    console.error(
      "[ledger] a CLIENT payload carried a raw money key (spend / cpl / " +
        "spend_raw). readClientLedger ignores it, so nothing raw reached the " +
        `screen — but the endpoint should not return it. Project ${suspect.project_id}.`,
    );
  }
};

export const readClientLedger = (res) => {
  assertNoRawMoney(res);
  return buildLedger(res, clientRow);
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
