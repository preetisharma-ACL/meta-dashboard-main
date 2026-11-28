import { api } from "../api/api";

// ─── Nomen issues (wrong campaign names) ──────────────────────────────────────
// Backend 25ff471. Envelope { success, message, data }.
//
// GET  /campaigns/nomen-issues/?state=open    (default) open issues
// GET  /campaigns/nomen-issues/?state=fixed   fixed in the last 30 days
//      data = { state, count, rows: [...], last_run_at }   last_run_at ISO UTC | null
//      row  = { id, campaign_id, campaign_name, ad_account,
//               status: "Active"|"Paused"|"Completed", started_on,
//               client_nomen, project_nomen, problem, hint ("" = none),
//               first_seen, last_seen, resolved_at,
//               days_incorrect (0 = found today), ads_manager_url ("" = none) }
//      Rows arrive in server order (oldest problem first); never re-sorted.
// POST /campaigns/nomen-issues/run/            re-check now (~4 s), never emails
//      200 data = { checked, incorrect, new, fixed }
//      409 a check is already running   502 sheet/check failed
//
// SCOPE IS THE BACKEND'S: admin, coordination and Tier 1 CMs get every issue,
// Tier 2/3 CMs only their own clients / ad accounts. Every other role 403s, so
// nothing here is called for them (NOMEN_ISSUE_ROLES).

export const NOMEN_ISSUE_ROLES = ["admin", "coordination", "campaign_manager"];

export const canSeeNomenIssues = () => {
  try {
    const auth = JSON.parse(localStorage.getItem("auth") || "{}");
    return !!auth?.token && NOMEN_ISSUE_ROLES.includes(auth?.role);
  } catch {
    return false;
  }
};

const dataOf = (res, what) => {
  if (res && typeof res === "object" && res.data && typeof res.data === "object") return res.data;
  console.error(`[nomen issues] ${what}: expected { success, message, data }, got:`, res);
  throw new Error("The nomen issues check answered in an unexpected shape.");
};

export const fetchNomenIssues = async (state = "open") => {
  const d = dataOf(await api(`/campaigns/nomen-issues/?state=${state}`), state);
  return {
    state: d.state ?? state,
    count: Number(d.count ?? 0),
    rows: Array.isArray(d.rows) ? d.rows : [],
    lastRunAt: d.last_run_at ?? null,
  };
};

export const runNomenCheck = async () =>
  dataOf(await api("/campaigns/nomen-issues/run/", { method: "POST", body: "{}" }), "run");

// The sentence for a failed run. 409 and 502 carry the backend's own message;
// these only cover a body without one.
export const runErrorMessage = (err) => {
  const said = err?.data?.message || err?.data?.detail || err?.data?.error?.message;
  if (typeof said === "string" && said) return said;
  if (err?.status === 409) return "A check is already running. Try again in a minute.";
  if (err?.status === 502) return "The check couldn't read the Nomenclature sheet. Try again later.";
  return err?.message || "The check failed.";
};
