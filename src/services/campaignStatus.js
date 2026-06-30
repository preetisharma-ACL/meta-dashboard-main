import { api } from "../api/api";

// ─── Campaign status writes (Tier-A) ──────────────────────────────────────────
// The FIRST write feature in the dashboard. Two endpoints back the pause/resume
// flow:
//
//   1. preview (GET)  — a dry-run. Tells us what WOULD change without touching
//      Meta. We call it before opening the confirm dialog so the dialog can show
//      the exact Active→Paused (or Paused→Active) transition, and so we can
//      refuse no-ops (e.g. pausing an already-paused campaign) up front.
//
//   2. execute (POST) — the real write to Meta. Requires confirm:true, a
//      server-side safety gate; we only send it AFTER the user confirms.
//
// These endpoints are keyed purely by campaign_id and the backend scope-checks
// the caller server-side (admins → any campaign; CMs → their own, Tier-1 only).
// We deliberately do NOT thread the CM switch-mode scope params here: the
// documented contract takes no scope query, and the write should act on the
// campaign itself, not on an impersonated read view.

const ACTIONS = new Set(["pause", "resume"]);

const assertAction = (action) => {
  if (!ACTIONS.has(action)) {
    throw new Error(`Invalid action "${action}" (expected "pause" or "resume")`);
  }
};

// GET /api/cm/campaigns/{id}/status-preview/?action=pause|resume
// Returns the preview object (res.data), e.g.
//   { valid:true, campaign_id, campaign_name, current_status, target_status, action }
// or { valid:false, reason, is_noop, campaign_id, current_status }
export const previewCampaignStatus = async (campaignId, action) => {
  assertAction(action);
  const res = await api(
    `/cm/campaigns/${campaignId}/status-preview/?action=${action}`,
    { method: "GET" },
  );
  // api() returns undefined only on an auth-failure path (it soft-logs out).
  if (!res) throw new Error("Session expired — please sign in again.");
  return res.data;
};

// POST /api/cm/campaigns/{id}/status/  body { action, confirm:true }
// On success returns res.data:
//   { campaign_id, action, success:true, previous_status, new_status, error:null }
// On failure the backend responds 400; api() throws an Error carrying
//   err.status, err.code ("write_failed"), and err.data.detail.error (Meta msg).
export const executeCampaignStatus = async (campaignId, action) => {
  assertAction(action);
  const res = await api(`/cm/campaigns/${campaignId}/status/`, {
    method: "POST",
    body: JSON.stringify({ action, confirm: true }),
  });
  if (!res) throw new Error("Session expired — please sign in again.");
  return res.data;
};
