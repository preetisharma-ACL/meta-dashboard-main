import { api } from "../api/api";
import { fetchClientsForLeadAction } from "./leadReplacement";

// ─── Campaign ownership / reassignment service ────────────────────────────────
// Ownership NO LONGER FOLLOWS THE CAMPAIGN NAME. The sync keeps the name current
// as a label but stopped moving campaigns between clients when it changes
// (backend 5ea2a08). Moving a campaign is now an explicit, audited action, which
// is the whole reason this module exists.
//
// What a reassignment actually moves: the campaign's LEADS AND SPEND, on both
// clients' ledgers, for the whole period from `effective_from` onward. It is not
// a re-label. The backend scopes raw insights by who owned the campaign ON EACH
// DAY — the same day-scoped rule that made CMDailyReport drop its local campaign
// sweep (the comment there is worth reading: a current-owner sweep counted days
// belonging to a previous owner, 333 leads where the truth was 104). So a
// handover is a real movement of delivery and money between two ledgers.
//
// OWNERSHIP IS TRACKED BY WHOLE DAYS — Meta serves one insight row per campaign
// per day, so a day cannot be split. A handover part-way through a day gives
// that ENTIRE day's leads and spend to the new owner. A day boundary is the only
// exact option, and the UI says so rather than leaving the operator to discover
// it in a reconciliation.
//
// THE META RENAME rides along with the same action: the FIRST PIPE SEGMENT of
// the campaign name is rewritten, everything after the first "|" is untouched,
// and a name with no pipe is left completely alone. If Meta refuses the rename
// the REASSIGNMENT STILL STANDS and `rename_error` carries why — which is worth
// surfacing loudly, because the campaign then carries a stale client label in
// Ads Manager until a human fixes it there.
//
// ENVELOPE: { success, message, data } — read `.data`. api() throws with .status
// set, the parsed body on .data (4xx) and the field map on .fields; callers read
// those through utils/apiErrors.

const num = (v) => (v == null || v === "" ? null : Number(v));

// ── Local-safe YYYY-MM-DD ────────────────────────────────────────────────────
// Deliberately NOT toISOString().slice(0,10): that converts to UTC first, so for
// anyone east of Greenwich (this is an en-IN app, UTC+5:30) an evening "today"
// serialises as YESTERDAY. On an endpoint that day-scopes ownership, a one-day
// slip hands a whole day's leads to the wrong client.
export const toLocalYMD = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const today = () => toLocalYMD();

// The endpoint refuses a future date; the picker caps at the same value so the
// rejection is a disabled state rather than a round-trip.
export const isFutureDate = (ymd) => !!ymd && ymd > today();

// ── Response readers ─────────────────────────────────────────────────────────
// VERIFIED on a live payload: `from` and `to` are plain NAME strings — the
// endpoint serialises old_nomen.name and nomen.name directly, not objects and
// not ids. So a string is always a name, never a numeric id to be resolved; a
// nomen named "12345" reads as the name it is.
//
// The object branch is kept as a cheap tolerance in case the endpoint ever grows
// a richer shape — it costs a type check and it means a change there degrades to
// "shows the label the screen already had" rather than to "moved to —", which
// would read as a failure on a call that in fact succeeded.
const readSide = (v) => {
  if (v == null) return { id: null, name: null };
  if (typeof v === "object") {
    return {
      id: num(v.client_nomen_id ?? v.id ?? v.nomen_id),
      name: v.client_nomen_name ?? v.client_name ?? v.name ?? null,
    };
  }
  return { id: null, name: String(v) };
};

// POST /campaigns/{id}/reassign/
//   { client_nomen_id, effective_from?, reason }
//
// `reason` is REQUIRED — the endpoint 422s without it. It is sent trimmed and
// the caller is expected to have blocked an empty one, because a 422 is a poor
// way to learn that the box you left blank was mandatory.
//
// `effectiveFrom` is optional and defaults to today server-side. We send it
// explicitly anyway: "today" on the server and "today" in an en-IN browser are
// not always the same date, and on a day-scoped ledger that difference is a
// day's leads.
//
// Documented rejections the caller routes rather than crashes on:
//   422 no reason given, or effective_from in the future
//   403 anyone without a tier-1 CampaignManagerProfile who isn't an admin —
//       tier-2 CMs, and also coordination/accounts/sales, who hold no CM profile
//       at all. Plus a tier-1 CM where EITHER the current or the target client
//       sits outside their team: they cannot hand a campaign to a client they
//       have no standing over.
//   404 campaign or target client not found
export const reassignCampaign = async ({
  campaignId,
  clientNomenId,
  effectiveFrom,
  reason,
}) => {
  const body = {
    client_nomen_id: Number(clientNomenId),
    reason: typeof reason === "string" ? reason.trim() : "",
  };
  if (effectiveFrom) body.effective_from = effectiveFrom;

  const res = await api(`/campaigns/${campaignId}/reassign/`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const d = res?.data ?? res ?? {};
  return {
    from: readSide(d.from),
    to: readSide(d.to),
    effectiveFrom: d.effective_from ?? effectiveFrom ?? null,
    oldName: d.old_name ?? null,
    newName: d.new_name ?? null,
    // Present ONLY when Meta refused the rename. The move itself succeeded
    // regardless — never treat this as a failed reassignment.
    renameError: d.rename_error ?? null,
  };
};

// GET /campaigns/{id}/ownership-history/
// Open to any campaign manager, tier-2 included: seeing who owned a campaign is
// information, not an action. It is still behind IsCampaignManagerOrAdmin though
// — coordination, accounts and sales 403 here just as they do on the reassign.
// `notes` carries who did it, when, and the reason they gave.
export const fetchCampaignOwnershipHistory = async (campaignId) => {
  const res = await api(`/campaigns/${campaignId}/ownership-history/`, {
    method: "GET",
  });

  const rows = Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : [];

  return rows
    .map((r) => ({
      clientNomenId: num(r?.client_nomen_id),
      clientNomenName: r?.client_nomen_name ?? null,
      validFrom: r?.valid_from ?? null,
      // null on the open-ended current row — "still owns it", not missing data.
      validTo: r?.valid_to ?? null,
      isCurrent: r?.is_current === true,
      // The name AS IT WAS during that span, which is the point of keeping it:
      // the label used to move with ownership, so an old row shows the old label.
      campaignName: r?.campaign_name ?? null,
      notes: r?.notes ?? null,
    }))
    .sort((a, b) => {
      // Newest first: the current (open-ended) span leads, then by start date
      // descending. Defensive — the endpoint's own order is trusted when it
      // already descends.
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return String(b.validFrom ?? "").localeCompare(String(a.validFrom ?? ""));
    });
};

// ── Target-client roster ─────────────────────────────────────────────────────
// The clients a campaign may be handed to, as { nomenId, name }.
//
// Sourced through fetchClientsForLeadAction so the admin→hierarchy fallback and
// the PK-vs-nomen normalisation live in ONE place (see leadReplacement.js — the
// two ids differ for all but one client, and that is exactly the confusion that
// has bitten before). Passing no type set keeps every client: unlike a lead
// replacement, any client type can own a campaign.
//
// The source also happens to match the permission rule. An admin reads the full
// admin roster; a CM 403s off it and falls back to the CM hierarchy, which
// serves only their own team's clients — precisely the set a tier-1 lead may
// reassign into. The backend remains the authority.
export const fetchReassignTargets = async () => {
  const rows = await fetchClientsForLeadAction(null);
  return rows
    .filter((c) => c.nomenId != null)
    .map((c) => ({ nomenId: c.nomenId, name: c.name }));
};
