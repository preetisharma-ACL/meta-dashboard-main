import { api } from "../api/api";

// ─── Dead clients ─────────────────────────────────────────────────────────────
// Backend rule (69b8461): DEAD when the CM sets status "dead" and no campaign
// is live (with one live it is FLAGGED — dead_blocked — and turns dead hourly
// once campaigns stop), or status "completed" with zero spend and zero leads
// for 20 days and no live campaign. Hold / active / unset never go dead.
// Moving the status off dead/completed revives at once.
//
// Dead clients are HIDDEN BY DEFAULT on five lists — admin clients, payments
// overview, command, status board, value tier board. Each takes ?dead=:
//   (absent) → alive only     only → dead only     all → both
// The UI only ever sends "only" (toggle ON) or nothing (toggle OFF).
export const DEAD_ONLY = "only";

// The param value for a toggle state — null means "send nothing".
export const deadParam = (on) => (on ? DEAD_ONLY : null);

// Append ?dead= to a URL that may or may not already carry a query string.
export const withDead = (url, on) => {
  if (!on) return url;
  return `${url}${url.includes("?") ? "&" : "?"}dead=${DEAD_ONLY}`;
};

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const arr = (v) => (Array.isArray(v) ? v : []);

// Newest first is what the backend promises for status_history and
// dead_history; assignment_history has no stated order, so it is sorted here
// oldest-first — it reads as a timeline (who had it, then who next).
const byTime = (key, dir) => (a, b) => {
  const ta = Date.parse(a?.[key] ?? "") || 0;
  const tb = Date.parse(b?.[key] ?? "") || 0;
  return dir === "asc" ? ta - tb : tb - ta;
};

const normaliseRow = (r) => ({
  ...r,
  client_id: r?.client_id ?? null,
  client: r?.client ?? null,
  client_nomen_id: r?.client_nomen_id ?? null,
  client_type: String(r?.client_type ?? "").toLowerCase() || null,
  engagement_status: String(r?.engagement_status ?? "").toLowerCase() || null,
  lifetime_spend: num(r?.lifetime_spend),
  lifetime_leads: num(r?.lifetime_leads),
  campaign_managers: arr(r?.campaign_managers),
  assignment_history: [...arr(r?.assignment_history)].sort(
    byTime("assigned_at", "asc"),
  ),
  status_history: arr(r?.status_history),
  dead_history: arr(r?.dead_history),
});

// The envelope isn't pinned down in the ticket, so accept the two shapes this
// API uses elsewhere: data as the array, or data.clients / data.results.
const readRows = (res) => {
  const d = res?.data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.clients)) return d.clients;
  if (Array.isArray(d?.results)) return d.results;
  console.error("[dead] /clients/dead/ returned no row array. Got:", d);
  return [];
};

// GET /clients/dead/[?q=][&client_id=]
// Server-scoped: admin, coordination and Tier 1 see every dead client; Tier 2/3
// only their own.
// flagged → ?flagged=1: marked Dead but a campaign still live (same fields).
export const fetchDeadClients = async ({ q, clientId, flagged } = {}) => {
  const sp = new URLSearchParams();
  if (flagged) sp.set("flagged", "1");
  if (q) sp.set("q", q);
  if (clientId != null) sp.set("client_id", String(clientId));
  const s = sp.toString();
  const res = await api(`/clients/dead/${s ? `?${s}` : ""}`, { method: "GET" });
  return readRows(res).map(normaliseRow);
};

// ── IST formatting ────────────────────────────────────────────────────────────
// Every timestamp arrives as UTC ISO; the desk reads IST.
const IST = "Asia/Kolkata";

export const istDateTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

export const istDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};
