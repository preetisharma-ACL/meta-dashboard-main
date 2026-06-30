import { api } from "../api/api";

// ─── Admin “Campaign Managers” service layer ──────────────────────────────────
// This screen lets an ADMIN view any campaign manager's own dashboard via
// `?as_team_member_id=<cm_id>` — the SAME switch-mode a Tier-1 team lead uses.
//
// As of the backend deploy that widened `resolve_cm_scope_user`, GLOBAL_READ
// roles (admin / coordination / accounts) may now switch to ANY active campaign
// manager (not just their own team). Every CM-scoped endpoint honours the param
// for admins, so the embedded CMDashboard / AlertsPanel render that manager's
// scoped data once the global cmScope signal is set.
//
// The allocated-budget total is now served directly on the roster
// (`allocated_budget` per manager, `total_allocated_budget` in the summary), so
// no per-manager budget sweep is needed any more — read it off the roster row.

// One-shot capability probe. Calls a CM-scoped endpoint with an explicit
// as_team_member_id and reports whether the backend honoured it. Kept as a
// lightweight defensive gate: in normal operation it now resolves `allowed:true`,
// but if an unexpected 403 ever returns we degrade gracefully instead of
// rendering a broken dashboard.
//   { allowed: true,  viewingAs, clientCount }
//   { allowed: false, status, message }   ← unexpected rejection
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

// Fetch ONE manager's directly-assigned (own) clients — the explicit-scope
// hierarchy call (does not touch the global cmScope signal). Used to assemble a
// client-nomen → owning-CM map so the hierarchy can tag each client with its CM
// in the admin "Full team" view (the hierarchy response itself carries no owner
// field). Returns [] on any error so a single failed manager can't break the map.
export const fetchManagerOwnClients = async (managerId) => {
  try {
    const res = await api(
      `/cm/hierarchy/clients/?1=1&as_team_member_id=${managerId}&scope=own`,
      { method: "GET" },
    );
    return Array.isArray(res?.data) ? res.data : [];
  } catch {
    return [];
  }
};
