import { api } from "../api/api";

// ─── Admin “Campaign Managers” service layer ──────────────────────────────────
// This screen lets an ADMIN view any campaign manager's own dashboard. The
// backend mechanism is `?as_team_member_id=<cm_id>` — the SAME switch-mode a
// Tier-1 team lead uses. The catch (see the build prompt, §6): switch-mode is
// gated to campaign managers viewing their OWN team. An admin is not a team
// lead, so the backend currently rejects admin switch-mode with 403.
//
// Everything here is written so the screen "lights up" automatically the day
// the backend permits GLOBAL_READ roles (admin / coordination / accounts) to
// switch to any CM — no frontend change required. Until then `probeAdminSwitchMode`
// reports `allowed:false` and the page shows a graceful "not enabled yet" state.
//
// NB: these helpers pass the id EXPLICITLY in the URL and do NOT touch the
// global cmScope signal — so the roster can compute per-manager numbers without
// flipping the app-wide "viewing as" scope. The page sets the global scope only
// when it actually renders a selected manager's embedded dashboard.

const today = () => new Date().toISOString().split("T")[0];

// One-shot capability probe. Calls a CM-scoped endpoint with an explicit
// as_team_member_id and reports whether the backend honoured it.
//   { allowed: true,  viewingAs, clientCount }   ← switch-mode permitted
//   { allowed: false, status, message }          ← 403 / rejected (today's reality)
// A 403 is the expected "admin can't switch" signal; anything else that throws
// is surfaced too so the page can show a generic error instead of a false flag.
export const probeAdminSwitchMode = async (managerId) => {
  try {
    const res = await api(
      `/cm/hierarchy/clients/?1=1&as_team_member_id=${managerId}`,
      { method: "GET" },
    );
    if (!res) return { allowed: false, status: null, message: "No response" };

    // The server confirms the switch by echoing meta.viewing_as. If it scoped
    // to the requested manager, switch-mode is genuinely working.
    const va = res?.meta?.viewing_as ?? null;
    const honoured = va == null || Number(va.user_id) === Number(managerId);
    return {
      allowed: honoured,
      viewingAs: va,
      clientCount: Array.isArray(res?.data) ? res.data.length : 0,
    };
  } catch (err) {
    return {
      allowed: false,
      status: err?.status ?? null,
      message: err?.message || "Switch mode not permitted",
    };
  }
};

// Sweep a single manager's campaigns with an explicit scope (independent of the
// global cmScope signal). Used to assemble the per-manager allocated budget.
// Returns { data: [...campaigns], meta } — or throws (e.g. 403 while admin
// switch-mode is still disabled).
export const fetchManagerCampaignsDirect = async (
  managerId,
  { pageSize = 1000 } = {},
) => {
  let page = 1;
  let all = [];
  let lastRes = null;

  while (true) {
    const url =
      `/campaigns/?page=${page}&page_size=${pageSize}` +
      `&start_date=2020-01-01&end_date=${today()}` +
      `&as_team_member_id=${managerId}`;
    const res = await api(url, { method: "GET" });
    if (!res) break; // auth redirect
    lastRes = res;
    const batch = res?.data?.results ?? (Array.isArray(res?.data) ? res.data : []);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all = [...all, ...batch];
    if (!res?.meta?.pagination?.has_next) break;
    page += 1;
  }

  return { data: all, meta: lastRes?.meta ?? null };
};

// Allocated budget = sum of each campaign's configured daily budget. The flat
// campaigns endpoint exposes this as `budget` (verified live: e.g. "300.00" on
// a campaign whose name carries "300" as its daily budget). We prefer an
// explicit `daily_budget` if the backend ever adds one, else fall back to
// `budget`. Spend is deliberately NEVER used — spend ≠ allocated budget.
//   → { total, count, basis: "daily_budget" | "budget" | null }
// basis === null means no budget figure was present on any campaign, so the
// caller should render "—" rather than a misleading ₹0.
export const sumAllocatedBudget = (campaigns) => {
  const rows = Array.isArray(campaigns) ? campaigns : [];
  let total = 0;
  let count = 0;
  let basis = null;
  for (const c of rows) {
    const raw = c?.daily_budget ?? c?.budget;
    const n = parseFloat(raw);
    if (!isFinite(n)) continue;
    total += n;
    count += 1;
    if (basis == null) basis = c?.daily_budget != null ? "daily_budget" : "budget";
  }
  return { total, count, basis };
};

// Assemble one manager's allocated budget end-to-end. Throws on 403 (admin
// switch-mode disabled) so the caller can fall back to "—".
export const fetchManagerAllocatedBudget = async (managerId) => {
  const { data } = await fetchManagerCampaignsDirect(managerId);
  return sumAllocatedBudget(data);
};
