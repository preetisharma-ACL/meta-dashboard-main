import { api } from "../api/api";

// ─── Fed (synthetic / manually-uploaded) leads ────────────────────────────────
// ONE place that decides which day a manual batch belongs to and which batches
// count at all. Every surface that shows fed leads — the admin "Extra Leads"
// column, the CM project ledger, the CM daily report — must go through here, or
// the same batch lands on different days on different screens.
//
// THE DAY RULE
//   The backend distributes a batch's synthetic leads by `received_date` (shipped
//   22 Jul 2026); `uploaded_at` is merely when someone typed the row in. A batch
//   uploaded today with a backdated received_date therefore shows up in the
//   CLIENT's leads on the backdated day, while any surface still filtering by
//   uploaded_at silently drops it — which is exactly how admin showed "+30" for
//   Bullmen / NoidaEvent on 20 Jul while the client's real fed total was 57.
//   received_date is nullable, so uploaded_at is the fallback, never the primary.
export const batchDay = (b) =>
  b?.received_date || b?.uploaded_at?.split("T")[0] || null;

// A revoked batch was withdrawn: its leads are not delivered and must not be
// counted anywhere. `is_revoked` is a real boolean on the row, so compare to
// true rather than truthiness (a missing field must not read as revoked).
export const isLiveBatch = (b) => b?.is_revoked !== true;

// The list endpoint is paginated; a single page silently truncates the roll-up
// once a client accumulates enough batches. Sweep every page. The cap is a
// runaway guard, not an expected limit.
const MAX_PAGES = 50;

// Pull every manual batch visible to the caller, once.
//   • admin  → all batches (optionally narrowed by client_nomen NAME)
//   • CM     → auto-scoped server-side to their visible clients (GET is allowed
//              since the backend widening; POST stays admin-only)
// Returns a flat array of batch rows — callers filter with the helpers below,
// never with their own date/revoked logic.
export const fetchFedLeadBatches = async ({ clientNomen } = {}) => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let url = `/leads/manual-batches/?page=${page}`;
    if (clientNomen) url += `&client_nomen=${encodeURIComponent(clientNomen)}`;

    const res = await api(url, { method: "GET" });
    const rows = Array.isArray(res?.data?.results)
      ? res.data.results
      : Array.isArray(res?.data)
        ? res.data
        : [];

    all.push(...rows);
    // Stop on the last page, on an empty page, or when the envelope carries no
    // pagination block at all (unpaginated response → the first page is all).
    if (rows.length === 0 || !res?.meta?.pagination?.has_next) break;
  }
  return all;
};

// True when a batch's effective day falls inside [from, to] (inclusive, both
// "YYYY-MM-DD"). An open range (either bound missing) means "no date filter" —
// the same convention the dashboards use for an un-set calendar picker.
const inRange = (b, from, to) => {
  if (!from || !to) return true;
  const day = batchDay(b);
  return !!day && day >= from && day <= to;
};

// { [projectId]: fedLeadCount } for the range. Revoked batches excluded.
// Keys are strings — read them with String(projectId).
export const fedLeadsByProject = (batches, from, to) => {
  const out = {};
  for (const b of batches ?? []) {
    if (!isLiveBatch(b) || !inRange(b, from, to)) continue;
    if (b?.project == null) continue;
    const key = String(b.project);
    out[key] = (out[key] || 0) + (Number(b.synthetic_lead_count) || 0);
  }
  return out;
};

// Fed leads for one project in the range. Revoked batches excluded.
export const fedLeadsForProject = (batches, projectId, from, to) => {
  if (projectId == null) return 0;
  const target = String(projectId);
  let sum = 0;
  for (const b of batches ?? []) {
    if (!isLiveBatch(b) || !inRange(b, from, to)) continue;
    if (String(b?.project) !== target) continue;
    sum += Number(b.synthetic_lead_count) || 0;
  }
  return sum;
};

// Display helper shared by every fed-leads cell: "+N" when there are any, an em
// dash when there are none. Fed leads are NEVER folded into the Meta figure —
// both stay visible so a CM's report reconciles with the client's own view
// without hiding where the difference came from.
export const fmtFed = (n) => (Number(n) > 0 ? `+${Number(n).toLocaleString("en-IN")}` : "—");
