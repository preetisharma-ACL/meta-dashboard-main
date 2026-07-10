import { api } from "../api/api";

// ─── Single-campaign budget writes (Tier-A) ───────────────────────────────────
// The second single-campaign write control (pause/resume was the first). Mirrors
// campaignStatus.js exactly — two endpoints back the edit-budget flow:
//
//   1. preview (GET)  — a dry-run. Given a target rupee amount it tells us what
//      WOULD change without touching Meta: the current budget, the target, and
//      whether the change is valid (in bounds, not CBO-managed, above the Meta
//      minimum). We call it before showing the confirm step so the user sees the
//      exact current → new transition and any blocking reason up front.
//
//   2. write (POST) — the real write to Meta. Requires confirm:true, a
//      server-side safety gate; we only send it AFTER the user confirms.
//
// Keyed purely by campaign_id; the backend scope-checks the caller server-side
// (admins → any campaign; CMs → their own, Tier-1 only). Same gate as the
// status control, so no scope query is threaded here.

// GET /api/cm/campaigns/{id}/budget-preview/?budget=<rupees>
// Returns the preview object (res.data), e.g.
//   { valid:true, campaign_id, campaign_name, current_budget, target_budget, budget_source }
// or { valid:false, reason, campaign_id, current_budget, ... } when out of bounds,
// CBO-managed, or below the Meta minimum.
export const previewCampaignBudget = async (campaignId, budget) => {
  const res = await api(
    `/cm/campaigns/${campaignId}/budget-preview/?budget=${encodeURIComponent(budget)}`,
    { method: "GET" },
  );
  // api() returns undefined only on an auth-failure path (it soft-logs out).
  if (!res) throw new Error("Session expired — please sign in again.");
  return res.data;
};

// POST /api/cm/campaigns/{id}/budget/  body { budget:<number>, confirm:true }
// On success returns res.data: { success:true, ... }.
// On failure the backend responds with { success:false, error, detail } (or an
// HTTP error); api() surfaces that as a thrown Error carrying err.status,
// err.code and err.data (with err.data.detail / err.data.error).
export const executeCampaignBudget = async (campaignId, budget) => {
  const res = await api(`/cm/campaigns/${campaignId}/budget/`, {
    method: "POST",
    body: JSON.stringify({ budget: Number(budget), confirm: true }),
  });
  if (!res) throw new Error("Session expired — please sign in again.");
  return res.data;
};
