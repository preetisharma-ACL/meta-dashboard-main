import { api } from "../api/api";

// ─── Coordination desk (coordination's /dashboard) ────────────────────────────
// GET /clients/coordination/home/[?refresh=1]  →  { success, message, data }
//
// data = {
//   generated_at, window: { from, to },
//   counts: { setup_gaps, billing_gaps, no_delivery, project_info, drive },
//   setup_gaps:   [{ client_id, nomen_id, client_nomen, client_type,
//                    gaps: ["no_login"|"no_cm"|"no_drive_folder"|"no_rate_config"],
//                    created_at }],
//   billing_gaps: [{ client_id, nomen_id, client_nomen, client_type, project_id,
//                    project_name, kind: "no_config"|"not_covered",
//                    has_open_config, uncovered_days, uncovered_spend,
//                    first_uncovered, last_uncovered }],
//   no_delivery:  [{ client_id, nomen_id, client_nomen, client_type,
//                    engagement_status, last_delivery, idle_days }],  idle_days null = never
//   project_info: [{ project_id, project_name, missing: ["city"|"property_type"],
//                    location, spend_30d }],
//   drive:        [{ client_id, nomen_id, client_nomen, client_type, status,
//                    message, refreshed_at }],
// }
// ROLE SHAPES (backend 26a3ce0): coordination's payload has NO billing_gaps key,
// no billing_gaps count, and its setup_gaps never carry "no_rate_config". Only
// admin gets billing_gaps (read on Project Display Config, BillingGapsPanel).
// Money fields are 2-decimal strings. Each list arrives sorted (most important
// first) and capped at 300, so the page keeps the order and never re-sorts.
// client_id is the Client PK, nomen_id the client_nomen id.
//
// Read-only: nothing here writes.

export const SECTIONS = ["billing_gaps", "setup_gaps", "no_delivery", "project_info", "drive"];

export const fetchCoordinationHome = async ({ refresh = false } = {}) => {
  const res = await api(`/clients/coordination/home/${refresh ? "?refresh=1" : ""}`);
  if (!res || typeof res !== "object" || !("data" in res) || !res.data) {
    console.error("[coordination home] expected { success, message, data }, got:", res);
    throw new Error("The coordination desk answered in an unexpected shape.");
  }
  return res.data;
};
