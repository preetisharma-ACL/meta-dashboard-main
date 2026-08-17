import { api } from "../api/api";

// ─── User Onboarding service ──────────────────────────────────────────────────
// Creates a login + its role profile in ONE atomic backend transaction. Admin
// and coordination only; every other role 403s at the endpoint.
//
// "admin" is never offered as a creatable role — the backend rejects it with a
// 400 regardless of who is calling, so listing it would only hand the operator
// a guaranteed failure. `creatable_roles` from the options endpoint is the
// authority; ADMIN_ROLE is stripped defensively in case it ever appears there.
//
// ENVELOPE: both endpoints answer { success, message, data } — read `.data`.

const ADMIN_ROLE = "admin";

// Sane fallbacks so a partial options payload degrades to "the operator can
// still work" rather than an empty form. The backend stays the authority — it
// re-validates every one of these.
const DEFAULT_ROLES = [
  "client",
  "campaign_manager",
  "sales",
  "coordination",
  "accounts",
];
const DEFAULT_CLIENT_TYPES = ["cpl", "hybrid", "retainer"];

const asArray = (v) => (Array.isArray(v) ? v : []);

// GET /auth/onboarding/options/ — everything the wizard's dropdowns need, in
// one round trip. Shapes:
//   organizations           [{ id, name }]
//   unassigned_nomens       [{ id, name }]   ← nomens with no client yet
//   tier1_campaign_managers [{ id, email }]  ← eligible CM team leads
//   campaign_managers       [{ id, email, tier }]
//   sales_users             [{ id, email }]  ← eligible onboarded_by
export const fetchOnboardingOptions = async () => {
  const res = await api(`/auth/onboarding/options/`, { method: "GET" });
  const d = res?.data ?? {};

  const roles = asArray(d.creatable_roles).filter((r) => r !== ADMIN_ROLE);

  return {
    organizations: asArray(d.organizations),
    unassignedNomens: asArray(d.unassigned_nomens),
    tier1CampaignManagers: asArray(d.tier1_campaign_managers),
    campaignManagers: asArray(d.campaign_managers),
    salesUsers: asArray(d.sales_users),
    creatableRoles: roles.length ? roles : DEFAULT_ROLES,
    clientTypes: asArray(d.client_types).length
      ? asArray(d.client_types)
      : DEFAULT_CLIENT_TYPES,
  };
};

// POST /auth/onboarding/users/ — create the user + its role profile.
// The caller builds the body; only ONE nested object may be present and it must
// match `role` (a client:{} on a non-client role is a 400). Returns the `data`
// block: { role, user_id, client_id?, client_nomen?, nomen_created?,
//           campaign_managers?, billing_setup_pending?, cm_profile_id?, tier?,
//           team_lead?, staff_profile? }.
//
// The whole creation is ONE transaction — a failure creates nothing, so it is
// safe for the caller to let the operator fix the error and resubmit.
export const createOnboardedUser = async (payload) => {
  const res = await api(`/auth/onboarding/users/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res?.data ?? null;
};

// ── Error plumbing ───────────────────────────────────────────────────────────
// Lives in utils/apiErrors now — the nested-field-map envelope is not specific
// to onboarding (the assignment endpoints answer the same way), so the readers
// are shared rather than reimplemented per screen. Re-exported here so callers
// keep importing them alongside the endpoints they belong to.
export { collectFieldErrors, errorBanner } from "../utils/apiErrors";
