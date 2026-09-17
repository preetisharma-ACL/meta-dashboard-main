import { api } from "../api/api";

// ─── Campaign-manager PROFILE service ─────────────────────────────────────────
// The profile is the record that decides what a campaign manager may DO and
// whose dashboard their clients appear on. It is not a set of labels, and
// nothing in this file (or the screen above it) should describe it as one.
//
// tier IS A PERMISSION LEVEL. A tier-1 manager may pause and resume campaigns,
// set budgets, record payments, run bulk operations and reassign campaigns
// between clients. A tier-2 manager may do none of it. Moving someone to tier_1
// grants all of that at once, in one PATCH.
//
// team_lead IS A VISIBILITY FILTER, not an org chart. get_visible_client_ids
// walks from a tier-1 lead down to their team, so changing one tier-2 manager's
// lead moves EVERY CLIENT THEY HOLD out of one lead's dashboard and into
// another's — at once, and for all history, not from today forward. That is why
// the detail route returns clients[], and why the screen names those clients
// before it writes.
//
// reason IS REQUIRED whenever tier, team_lead_id or is_active changes. Omitting
// it is a 422 with error.fields.reason, worded per field.
//
// PERMISSIONS (same as the assignments API): read for admin, coordination,
// accounts and campaign managers; write for admin and coordination only.
//
// SERVER-SIDE GUARDS the UI must route rather than crash on — all 422:
//   • a tier-1 lead with active team members cannot be demoted (the response
//     lists the members, who would otherwise report to someone who is no longer
//     a lead)
//   • a tier-2 manager always needs an active tier-1 lead
//   • a tier-1 manager never has one
//   • nobody can be their own lead
//
// ENVELOPE: { success, message, data }. api() throws with .status, the parsed
// body on .data and the field map on .fields; utils/apiErrors reads both.

const BASE = "/cm/profiles";

// List endpoints answer a bare array on `data`; the paginated shape is tolerated
// so a server-side change to page these doesn't blank the screen.
const rows = (res) =>
  Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : [];

const num = (v) => (v == null || v === "" ? null : Number(v));

// First non-empty of several candidate spellings.
//
// The live shape is known and its real spelling always leads the list:
//   list + detail  id, user_id, email, name, tier, tier_label, team_lead_id,
//                  team_lead_email, is_active, client_count; team_size on tier-1
//                  rows; clients (nomen strings) on the detail route only
//   history        id, field, from_value, to_value, reason, clients_affected,
//                  changed_by, at
// The alternates behind them are kept as a floor, not a guess: a serializer
// rename degrades one field to null (rendering "—") instead of throwing halfway
// down a roster.
const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
};

// ── Normalised shapes ────────────────────────────────────────────────────────
// ids are coerced to numbers ONCE, here, so nothing downstream has to guess
// whether it is comparing "7" with 7. Everything else keeps the server's wording.

// The detail route sends `clients` as an array of NOMEN STRINGS, not objects —
// it is a list of names for exactly one purpose, naming what moves. A string is
// lifted into the same shape an object would take so the screens render one
// thing; an object shape is still read, in case the route ever grows fields.
const toClient = (c) => {
  if (typeof c === "string") return { clientId: null, nomen: c, email: null, clientType: null, isActive: true };
  return {
    clientId: num(pick(c, "client_id", "id")),
    nomen: pick(c, "client_nomen", "nomen", "name"),
    email: pick(c, "client_email", "email"),
    clientType: pick(c, "client_type", "type"),
    isActive: c?.is_active !== false,
  };
};

export const toProfile = (p) => {
  const clients = (Array.isArray(p?.clients) ? p.clients : []).map(toClient);

  return {
    // The PROFILE's own primary key — what the detail, history and PATCH routes
    // are addressed by.
    id: num(pick(p, "id", "profile_id")),
    // The USER behind it, and the ONLY id that may be sent as team_lead_id:
    // CampaignManagerProfile.team_lead is an FK to User, the serializer reads
    // that FK, and the PATCH resolves it with User.objects.filter(pk=lead_id).
    // On the live roster the two ranges don't even overlap — profile ids run
    // 1–27, user ids 133–267 — so sending a profile id here would silently
    // point a lead at nobody.
    userId: num(pick(p, "user_id", "cm_id", "user")),
    email: pick(p, "email", "user_email", "cm_email"),
    name: pick(p, "name", "full_name", "user_name", "cm_name", "username"),
    tier: pick(p, "tier"),
    // The server's own wording for the tier, used wherever one is printed as
    // prose. The badge still derives its own from `tier` — it is shared with the
    // assignments screen, which has no tier_label to read.
    tierLabel: pick(p, "tier_label"),
    // A USER id (see above), with the email alongside it so a row can name the
    // lead without a lookup.
    teamLeadId: num(pick(p, "team_lead_id", "team_lead")),
    teamLeadEmail: pick(p, "team_lead_email", "team_lead_name"),
    isActive: p?.is_active !== false,
    // The server's own counts are read rather than derived, so a list row (which
    // carries no clients[]) and a detail row can't disagree. team_size is sent
    // on tier-1 rows only; a tier-2 manager leads nobody, so 0 is the truth
    // rather than a missing value.
    clientCount: num(pick(p, "client_count", "clients_count")) ?? clients.length,
    teamMemberCount: num(pick(p, "team_size", "team_member_count")) ?? 0,
    clients,
  };
};

// GET /cm/profiles/ — every campaign manager profile.
// tier / isActive map to the documented ?tier= and ?is_active= filters. The
// profiles screen deliberately passes NEITHER and narrows in memory instead: it
// has to count the inactive managers still holding clients, and a server-side
// filter would hide exactly the rows that warning exists to surface.
export const fetchCmProfiles = async ({ tier, isActive } = {}) => {
  const params = new URLSearchParams();
  if (tier) params.set("tier", String(tier));
  if (isActive != null) params.set("is_active", isActive ? "true" : "false");
  const qs = params.toString();

  const res = await api(`${BASE}/${qs ? `?${qs}` : ""}`, { method: "GET" });
  return rows(res).map(toProfile);
};

// GET /cm/profiles/{id}/ — one profile plus the clients[] it holds.
// The client list is the whole reason this route is called before a write: a
// confirmation that says "16 clients" asks the operator to take the number on
// trust, and the names are what make the change reviewable.
export const fetchCmProfile = async (id) => {
  const res = await api(`${BASE}/${id}/`, { method: "GET" });
  return toProfile(res?.data ?? {});
};

// PATCH /cm/profiles/{id}/ — {tier?, team_lead_id?, is_active?, reason}.
//
// Only the keys the caller actually passed are sent, so a tier change can't
// silently restate a lead. `teamLeadId: null` IS a change (it clears the lead)
// and is told apart from "not passed" by undefined — which is why these are
// checked with `!== undefined` rather than for truthiness.
//
// Returns the whole envelope: `message` is the server's own sentence naming what
// moved ("… 16 client(s) moved from … to …'s dashboard"), and that is the one
// the screen shows, in preference to anything we could compose locally.
export const updateCmProfile = async (
  id,
  { tier, teamLeadId, isActive, reason } = {},
) => {
  const body = {};
  if (tier !== undefined) body.tier = tier;
  if (teamLeadId !== undefined)
    body.team_lead_id = teamLeadId == null ? null : Number(teamLeadId);
  if (isActive !== undefined) body.is_active = !!isActive;
  if (reason !== undefined)
    body.reason = typeof reason === "string" ? reason.trim() : reason;

  return await api(`${BASE}/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
};

// GET /cm/profiles/{id}/history/ — every tier / lead / active change on this
// profile, with the reason given at the time and the clients it moved.
//
// `field` is tier | team_lead | is_active — note team_lead WITHOUT the _id the
// PATCH body uses: the log records the field, not the payload key. Both
// spellings are handled downstream so a screen never prints a raw column name.
//
// clients_affected is an ARRAY (a bare count is tolerated), and it is kept as
// both a length and a list: a change that moved nothing and a change that moved
// sixteen clients' data between dashboards are not the same event, and this log
// is the only place that distinction survives.
export const fetchCmProfileHistory = async (id) => {
  const res = await api(`${BASE}/${id}/history/`, { method: "GET" });

  return rows(res).map((h) => {
    const affected = h?.clients_affected;
    return {
      id: pick(h, "id"),
      field: pick(h, "field", "field_name"),
      // from/to are kept RAW — null is a real value here ("had no lead"), so
      // they can't go through pick(), and rendering is the screen's job.
      fromValue: h?.from_value ?? null,
      toValue: h?.to_value ?? null,
      reason: pick(h, "reason", "notes"),
      clientsAffected: Array.isArray(affected) ? affected.length : num(affected),
      affectedClients: Array.isArray(affected) ? affected.map(toClient) : [],
      changedBy: pick(h, "changed_by_email", "changed_by_name", "changed_by"),
      at: pick(h, "at", "changed_at", "created_at"),
    };
  });
};
