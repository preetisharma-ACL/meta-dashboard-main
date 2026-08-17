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
// VERIFIED envelope: a 4xx answers
//   { success:false, message:"Validation failed",
//     error:{ code, detail, fields:{ <field>:[msg],
//                                    client:{<field>:[msg]},
//                                    campaign_manager:{<field>:[msg]},
//                                    non_field_errors:[msg] } } }
// api() attaches the WHOLE parsed body to err.data for an HTTP 4xx, and lifts
// only the WRAPPER string ("Validation failed") onto err.message — so reading
// err.message alone throws away every actual reason. The field map is read
// first, both transports of it:
//   err.fields          → 200-envelope failure ({ success:false, error:{fields} })
//   err.data.error.fields → HTTP 4xx
// Same helper shape as RecordDisqualificationModal's fieldErrors().
const rawFieldErrors = (err) =>
  err?.fields ?? err?.data?.error?.fields ?? err?.data?.fields ?? null;

// DRF gives a list per key; take the first non-empty entry, but tolerate a bare
// string so a shape change degrades to "shown verbatim" rather than "[object]".
const firstMessage = (v) => {
  if (!v) return null;
  if (Array.isArray(v)) return v.find((s) => typeof s === "string" && s) || null;
  return typeof v === "string" ? v : null;
};

// Flatten the field map to dotted paths so each message can be pinned to the
// one input that produced it, NESTED ONES INCLUDED:
//   fields.email                     → "email"
//   fields.client.onboarded_by_id    → "client.onboarded_by_id"
//   fields.campaign_manager.team_lead_id → "campaign_manager.team_lead_id"
// Messages are never rewritten on the way through — the backend's wording names
// the offending value (which nomen is taken, which user isn't a sales user), and
// paraphrasing it away is exactly what makes these errors unactionable.
export const collectFieldErrors = (err) => {
  const fields = rawFieldErrors(err);
  const out = {};
  if (!fields || typeof fields !== "object") return out;

  for (const [key, val] of Object.entries(fields)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const [sub, subVal] of Object.entries(val)) {
        const msg = firstMessage(subVal);
        if (msg) out[`${key}.${sub}`] = msg;
      }
    } else {
      const msg = firstMessage(val);
      if (msg) out[key] = msg;
    }
  }
  return out;
};

// The banner text: the most specific thing the server said that ISN'T already
// pinned to a field. non_field_errors first (that's where cross-field rules
// land), then error.detail, then the wrapper message as a last resort.
export const errorBanner = (err, pinned = {}) => {
  const nonField =
    pinned["non_field_errors"] ??
    pinned["client.non_field_errors"] ??
    pinned["campaign_manager.non_field_errors"] ??
    pinned["staff_profile.non_field_errors"];
  if (nonField) return nonField;

  const detail = err?.data?.error?.detail ?? err?.data?.detail;
  if (typeof detail === "string" && detail) return detail;

  // err.message is only the wrapper ("Validation failed") on the 4xx path, so
  // it is worth showing only when nothing more specific exists at all.
  return err?.message || "Could not create the user.";
};
