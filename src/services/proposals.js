import { api, BASE_URL } from "../api/api";

// ─── Proposals (sales + admin) ────────────────────────────────────────────────
// Everything lives under /api/proposals/ in the usual envelope. Verified live
// (OPTIONS) on 2026-10-30:
//   /                      GET, POST        /meta/            GET, PUT
//   /{id}/                 GET, PATCH, DELETE
//   /{id}/confirm|chat|undo|restore|duplicate/                POST
//   /{id}/preview|download/                                   GET
//   /library/              GET              /library/{key}/   GET, PUT
//   /library/{key}/revisions/{rev}/  GET    /library/{key}/restore/  POST
//
// Sales see only their own proposals, admin sees all; everyone else is 403ed.
// The library is admin only. Every write on a proposal (POST/PATCH/confirm/
// chat/undo/restore/duplicate) answers with the same DETAIL object, so callers
// replace their state with it whole.

export const PROPOSAL_ROLES = ["sales", "admin"];
export const LIBRARY_ROLES = ["admin"];

const BASE = "/proposals";

// The AI calls (confirm, chat, undo) take 5–20 s; give them a minute before
// giving up. api() forwards `signal` straight to fetch.
const AI_TIMEOUT_MS = 60_000;

const withTimeout = async (endpoint, options, ms = AI_TIMEOUT_MS) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await api(endpoint, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      const e = new Error(`No answer after ${Math.round(ms / 1000)} s. Reload to see whether it finished.`);
      e.status = 0;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

// ── Meta ──────────────────────────────────────────────────────────────────────
// { me:{name,designation,phone,email}, is_admin, themes[], models[],
//   categories[], ai:{spent_today_usd, cap_usd|null}, brochure_upload,
//   salespeople[] (admin only) }
export const fetchProposalMeta = async () => (await api(`${BASE}/meta/`))?.data ?? null;

// "Save as my profile" — returns the whole meta again.
export const saveMyProfile = async ({ name, designation, phone }) =>
  (await api(`${BASE}/meta/`, json("PUT", { name, designation, phone })))?.data ?? null;

// ── List ──────────────────────────────────────────────────────────────────────
// Returns the full envelope: rows in data, paging in meta.pagination.
export const fetchProposals = async ({ q, by, page } = {}) => {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (by) p.set("by", by);
  if (page && page > 1) p.set("page", page);
  const qs = p.toString();
  return api(`${BASE}/${qs ? `?${qs}` : ""}`);
};

// ── Create ────────────────────────────────────────────────────────────────────
// JSON unless files are attached; then multipart, with prepared_by sent as a
// JSON string. Files: "images" repeated once per screenshot of the brief (sales
// and admin; the brief text may then be empty) and "brochure" (admin only).
// Reading the brief takes ~5 s, a few more with images.
export const createProposal = async ({ brief, preparedBy, brochure, images = [] }) => {
  if (brochure || images.length) {
    const fd = new FormData();
    fd.append("brief", brief);
    if (preparedBy) fd.append("prepared_by", JSON.stringify(preparedBy));
    for (const img of images) fd.append("images", img);
    if (brochure) fd.append("brochure", brochure);
    return (await withTimeout(`${BASE}/`, { method: "POST", body: fd }))?.data;
  }
  const body = { brief };
  if (preparedBy) body.prepared_by = preparedBy;
  return (await withTimeout(`${BASE}/`, json("POST", body)))?.data;
};

export const BROCHURE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const BROCHURE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
export const BROCHURE_MAX_BYTES = 15 * 1024 * 1024;

// Brief screenshots. Limits come from meta.image_upload {max_files, max_mb};
// these are the values the backend publishes there today.
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";
export const IMAGE_DEFAULTS = { max_files: 4, max_mb: 5 };

// ── One proposal ──────────────────────────────────────────────────────────────
const one = (id) => `${BASE}/${encodeURIComponent(id)}`;

export const fetchProposal = async (id) => (await api(`${one(id)}/`))?.data;

// patch: { fields?, content?, theme?, validity_days? } — lists replace whole.
export const patchProposal = async (id, patch) =>
  (await api(`${one(id)}/`, json("PATCH", patch)))?.data;

export const deleteProposal = (id) => api(`${one(id)}/`, { method: "DELETE" });

export const confirmProposal = async (id) =>
  (await withTimeout(`${one(id)}/confirm/`, json("POST")))?.data;

export const chatProposal = async (id, text) =>
  (await withTimeout(`${one(id)}/chat/`, json("POST", { text })))?.data;

export const undoProposal = async (id) =>
  (await withTimeout(`${one(id)}/undo/`, json("POST")))?.data;

export const restoreProposal = async (id, version) =>
  (await withTimeout(`${one(id)}/restore/`, json("POST", { version })))?.data;

// "Use as new" — returns the NEW proposal; the caller opens it.
export const duplicateProposal = async (id) =>
  (await withTimeout(`${one(id)}/duplicate/`, json("POST")))?.data;

// { html } for an <iframe srcdoc>. 400 = no numbers yet (err.message says why).
export const fetchProposalPreview = async (id) => (await api(`${one(id)}/preview/`))?.data?.html ?? "";

// ── PDF ───────────────────────────────────────────────────────────────────────
// api() parses JSON, so the PDF is fetched directly with the same bearer. A 400
// means the download is blocked: the reasons ride in error.fields.issues[] and
// error.fields.layout.overflow[], which are turned into readable lines here.
export const downloadProposalPdf = async (id, fallbackName = "proposal") => {
  const auth = JSON.parse(localStorage.getItem("auth") || "null");
  const res = await fetch(`${BASE_URL}${one(id)}/download/`, {
    headers: auth?.token ? { Authorization: `Bearer ${auth.token}` } : {},
  });
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {}
    const err = new Error(
      res.status === 401
        ? "Session expired. Reload the page and try again."
        : body?.error?.message || body?.message || body?.error?.detail || "Download failed.",
    );
    err.status = res.status;
    err.lines = blockedReasons(body?.error?.fields);
    throw err;
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : `${fallbackName}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// fields.issues[] {message} and fields.layout.overflow[] (a page and the slots
// that ran past it) as plain sentences.
export const blockedReasons = (fields) => {
  const out = [];
  for (const i of fields?.issues ?? []) {
    const msg = typeof i === "string" ? i : i?.message;
    if (msg) out.push(msg);
  }
  for (const o of fields?.layout?.overflow ?? []) {
    if (typeof o === "string") {
      out.push(o);
      continue;
    }
    const slots = Array.isArray(o?.slots) ? o.slots.join(", ") : o?.slots ?? o?.slot ?? "";
    out.push(`Text too long on page ${o?.page ?? "?"}${slots ? `: ${slots}` : ""}`);
  }
  return out;
};

// ── Library (admin) ───────────────────────────────────────────────────────────
const lib = (key) => `${BASE}/library/${encodeURIComponent(key)}`;

export const fetchLibrary = async () => {
  const res = await api(`${BASE}/library/`);
  return Array.isArray(res?.data) ? res.data : res?.data?.results ?? res?.data?.items ?? [];
};

export const fetchLibraryEntry = async (key) => (await api(`${lib(key)}/`))?.data;

export const saveLibraryEntry = async (key, value, note) =>
  (await api(`${lib(key)}/`, json("PUT", { value, note })))?.data;

export const fetchLibraryRevision = async (key, revId) =>
  (await api(`${lib(key)}/revisions/${encodeURIComponent(revId)}/`))?.data;

export const restoreLibraryRevision = async (key, revision) =>
  (await api(`${lib(key)}/restore/`, json("POST", { revision })))?.data;

// ── Small readers ─────────────────────────────────────────────────────────────
// meta.models / categories / themes may arrive as plain strings or as
// {key|value, label|name} objects; read both the same way.
export const optionsOf = (list) =>
  (Array.isArray(list) ? list : []).map((o) => {
    if (o == null || typeof o !== "object") return { value: String(o), label: humanize(String(o)), raw: o };
    const value = o.key ?? o.value ?? o.id ?? o.slug ?? o.name;
    return { value: String(value), label: o.label ?? o.name ?? humanize(String(value)), raw: o };
  });

export const humanize = (s) =>
  String(s ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Dotted-path read: get(obj, "project.facts").
export const getPath = (obj, path) =>
  String(path)
    .split(".")
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);

const IST = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export const fmtWhen = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : IST.format(d);
};

// "by" fields arrive as a name, or as {id, name}.
export const nameOf = (v) => (v && typeof v === "object" ? v.name ?? v.email ?? "" : v ?? "");
