import { api } from "../api/api";

// ─── Creative Library + Ranking ───────────────────────────────────────────────
// Every creative gets a CODE at save time. CMs start the Meta ad name with that
// code ("CODE | short description"), and the backend joins Meta ad insights back
// to the library by parsing it out of the ad name. Ranking, the per-creative
// performance page and the Untagged Ads audit all hang off that join.
//
// Endpoints all live under /api/creatives/ and answer in the usual
// { success, data } envelope. Verified live (OPTIONS) on 2026-10-08:
//   /                 GET, POST        /ranking/        GET
//   /untagged/        GET              /options/nomens/ GET
//   /code-preview/    GET
//
// Money is RAW Meta spend (no markup) — shown as ₹ with 2 decimals. A null cpl
// (0 leads) prints "n/a", never ₹0.

// ── Roles ─────────────────────────────────────────────────────────────────────
// "creative" is a login that the backend 403s everywhere except /creatives/ and
// /auth/*. Read access is the creative desk plus the four internal roles below;
// accounts, sales and clients are 403ed. WRITE (add / edit) is admin + creative
// only — a CM or coordination sees the library read only.
const readRole = () => {
  try {
    return JSON.parse(localStorage.getItem("auth") || "null")?.role ?? null;
  } catch {
    return null;
  }
};

export const CREATIVE_READ_ROLES = [
  "admin",
  "campaign_manager",
  "coordination",
  "creative",
];
export const UNTAGGED_ROLES = ["admin", "campaign_manager", "coordination"];

export const isCreativeRole = () => readRole() === "creative";
export const canWriteCreatives = () => {
  const r = readRole();
  return r === "admin" || r === "creative";
};
export const isCMRole = () => readRole() === "campaign_manager";

// ── Kinds ─────────────────────────────────────────────────────────────────────
export const KINDS = [
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "carousel", label: "Carousel" },
];
export const kindLabel = (k) =>
  KINDS.find((x) => x.value === k)?.label ?? (k ? String(k) : "—");

// ── Formatting ────────────────────────────────────────────────────────────────
const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const fmtMoney = (v) => {
  const n = num(v);
  return n == null
    ? "—"
    : `₹${n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
};

// cpl is null when leads are 0 — that is "not applicable", not "free".
export const fmtCpl = (v) => (num(v) == null ? "n/a" : fmtMoney(v));

export const fmtInt = (v) => {
  const n = num(v);
  return n == null ? "—" : n.toLocaleString("en-IN");
};

export const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// ── Date presets ──────────────────────────────────────────────────────────────
// Backend default (no params) is the last 7 days INCLUDING today, so the "7d"
// preset sends start = today − 6. Dates are local YYYY-MM-DD.
export const ymd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const presetRange = (days) => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { start: ymd(start), end: ymd(end) };
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const qs = (params) => {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
};

// Lists come back as data: [...]; tolerate a paginated data.results too so a
// pagination switch on the backend degrades to "still a list".
const asList = (res) => {
  const d = res?.data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.results)) return d.results;
  return [];
};

// ── Project filter options ────────────────────────────────────────────────────
// The Library / Ranking project filter is built from the distinct
// project_id / project of a loaded creatives list — NOT /options/projects/
// ?all=1, which returns every project in the system (hundreds).
export const distinctProjects = (rows) => {
  const seen = new Map();
  (rows ?? []).forEach((r) => {
    if (r?.project_id == null || seen.has(String(r.project_id))) return;
    seen.set(String(r.project_id), { id: r.project_id, name: r.project ?? `#${r.project_id}` });
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
};

// ── Library ───────────────────────────────────────────────────────────────────
export const fetchCreatives = async (filters = {}) =>
  asList(await api(`/creatives/${qs(filters)}`));

export const fetchCreative = async (id) =>
  (await api(`/creatives/${id}/`))?.data ?? null;

// POST. A 409 with needs_confirmation means the same OneDrive link is already
// in the library (existing_code says which); the caller confirms and resends
// with confirm: true. Errors propagate with err.status / err.data intact.
export const createCreative = async (body) =>
  (await api(`/creatives/`, { method: "POST", body: JSON.stringify(body) }))
    ?.data ?? null;

// PATCH — only title, onedrive_url, notes, is_active. code / kind / client /
// project are fixed once created and the backend 400s if they are sent.
export const EDITABLE_FIELDS = ["title", "onedrive_url", "notes", "is_active"];
export const updateCreative = async (id, patch) => {
  const body = {};
  EDITABLE_FIELDS.forEach((k) => {
    if (k in patch) body[k] = patch[k];
  });
  return (
    (
      await api(`/creatives/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
    )?.data ?? null
  );
};

// ── Options ───────────────────────────────────────────────────────────────────
export const fetchNomenOptions = async (q = "") =>
  asList(await api(`/creatives/options/nomens/${qs({ q })}`));

export const fetchProjectOptions = async (nomenId, all = false) =>
  asList(
    await api(
      `/creatives/options/projects/${qs({ nomen_id: nomenId, all: all ? 1 : "" })}`,
    ),
  );

export const fetchCodePreview = async ({ nomen_id, project_id, kind }) =>
  (await api(`/creatives/code-preview/${qs({ nomen_id, project_id, kind })}`))
    ?.data?.code ?? null;

// ── Performance ───────────────────────────────────────────────────────────────
export const fetchRanking = async (params = {}) =>
  (await api(`/creatives/ranking/${qs(params)}`))?.data ?? null;

export const fetchCreativePerformance = async (id, params = {}) =>
  (await api(`/creatives/${id}/performance/${qs(params)}`))?.data ?? null;

export const fetchUntagged = async (params = {}) =>
  (await api(`/creatives/untagged/${qs(params)}`))?.data ?? null;
