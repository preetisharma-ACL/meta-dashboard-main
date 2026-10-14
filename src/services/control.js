import { api } from "../api/api";

// ─── Control Centre (super admins only) ───────────────────────────────────────
// A generic front end over every Django admin model, plus the audit log. Every
// endpoint 403s anyone without is_superuser; the UI gate (isSuperuser) only
// decides whether the screens are offered.
//
// The list endpoint takes DJANGO ADMIN QUERY PARAMS ONLY — q, p, o and the
// filter params exactly as filters[].choices[].query_string hands them out.
// Anything else 400s ("Invalid filter..."), so the list query string is passed
// through verbatim and never assembled from our own names.

const enc = encodeURIComponent;
const modelPath = (app, model) => `/control/m/${enc(app)}/${enc(model)}`;

// Bodies arrive either bare or in the { success, data, meta } envelope.
const unwrap = (res) =>
  res && typeof res === "object" && !Array.isArray(res) && "success" in res && "data" in res
    ? res.data
    : res;

export const fetchControlModels = async () => {
  const d = unwrap(await api(`/control/models/`, { method: "GET" }));
  return Array.isArray(d) ? d : (d?.results ?? d?.models ?? []);
};

// `query` is the Django admin query string ("q=x&o=-3.1&status__exact=paid"),
// with or without the leading "?".
export const fetchControlList = async (app, model, query = "") => {
  const qs = String(query || "").replace(/^\?/, "");
  return unwrap(
    await api(`${modelPath(app, model)}/${qs ? `?${qs}` : ""}`, { method: "GET" }),
  );
};

export const fetchControlMeta = async (app, model) =>
  unwrap(await api(`${modelPath(app, model)}/meta/`, { method: "GET" }));

export const fetchControlRecord = async (app, model, pk) =>
  unwrap(await api(`${modelPath(app, model)}/${enc(pk)}/`, { method: "GET" }));

export const createControlRecord = async (app, model, data, reason) =>
  unwrap(
    await api(`${modelPath(app, model)}/`, {
      method: "POST",
      body: JSON.stringify({ data, reason }),
    }),
  );

// `data` must hold ONLY the changed fields.
export const updateControlRecord = async (app, model, pk, data, reason) =>
  unwrap(
    await api(`${modelPath(app, model)}/${enc(pk)}/`, {
      method: "PATCH",
      body: JSON.stringify({ data, reason }),
    }),
  );

export const fetchDeletePreview = async (app, model, pk) =>
  unwrap(
    await api(`${modelPath(app, model)}/${enc(pk)}/delete-preview/`, { method: "GET" }),
  );

// Reason goes in the body AND the query: the backend reads either, and some
// proxies drop DELETE bodies. 409 = protected by related records.
export const deleteControlRecord = async (app, model, pk, reason) =>
  unwrap(
    await api(`${modelPath(app, model)}/${enc(pk)}/?reason=${enc(reason)}`, {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    }),
  );

export const runControlAction = async (app, model, action, ids, reason) =>
  unwrap(
    await api(`${modelPath(app, model)}/action/`, {
      method: "POST",
      body: JSON.stringify({ action, ids, reason }),
    }),
  );

// Searchable select source for relation / multi_relation fields → [{id, label}].
export const lookupControl = async (app, model, q = "") => {
  const d = unwrap(
    await api(`/control/lookup/${enc(app)}/${enc(model)}/?q=${enc(q)}`, { method: "GET" }),
  );
  const rows = Array.isArray(d) ? d : (d?.results ?? d?.rows ?? []);
  return rows.map((r) => ({
    id: r.id ?? r.pk ?? r.value,
    label: r.label ?? r.str ?? r.text ?? String(r.id ?? r.pk ?? r.value),
  }));
};

// GET /control/audit/ — filters: category, actor, model, action, target_id, q,
// date_from, date_to, page, page_size (max 100). Blank filters are dropped.
export const fetchAuditLog = async (filters = {}) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && String(v).trim() !== "") params.set(k, String(v).trim());
  }
  return unwrap(await api(`/control/audit/?${params.toString()}`, { method: "GET" }));
};

// ── Part 2: dedicated tools ──────────────────────────────────────────────────

// GET /control/health/ → { now, scheduled_tasks[], last_data{}, ad_accounts{},
// credentials[], failures_24h }.
export const fetchControlHealth = async () =>
  unwrap(await api(`/control/health/`, { method: "GET" }));

// POST /control/credentials/{id}/test/ → { ok, meta_user_name } | { ok:false, error }.
// A failed token can come back as 200 {ok:false} or as an HTTP error; both
// resolve to the same { ok:false, error } here so the row shows Meta's text.
export const testCredential = async (id) => {
  try {
    const d = unwrap(await api(`/control/credentials/${enc(id)}/test/`, { method: "POST" }));
    return d ?? { ok: false, error: "No response." };
  } catch (err) {
    const body = err?.data ?? {};
    return {
      ok: false,
      error: body.error && typeof body.error === "string" ? body.error : parseControlError(err, "Test failed.").message,
    };
  }
};

// POST /control/users/{id}/password/ {password1, password2, reason} → {ok:true};
// 400 carries Django's password-rule field errors.
export const resetUserPassword = async (id, password1, password2, reason) =>
  unwrap(
    await api(`/control/users/${enc(id)}/password/`, {
      method: "POST",
      body: JSON.stringify({ password1, password2, reason }),
    }),
  );

// Recompute a client's monthly openings from `from` (YYYY-MM). GET previews
// (nothing written); POST applies. Locked openings are never changed.
export const previewRecomputeOpenings = async (clientId, from) =>
  unwrap(
    await api(`/control/clients/${enc(clientId)}/recompute-openings/?from=${enc(from)}`, {
      method: "GET",
    }),
  );
export const applyRecomputeOpenings = async (clientId, from, reason) =>
  unwrap(
    await api(`/control/clients/${enc(clientId)}/recompute-openings/`, {
      method: "POST",
      body: JSON.stringify({ from, reason }),
    }),
  );

// Django admin's dynamic-form helpers: GET /control/m/{app}/{model}/helper/{name}/
// with the same query params the admin page sends. Returns the JSON as-is.
export const callFormHelper = async (app, model, name, params = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  return unwrap(
    await api(`${modelPath(app, model)}/helper/${enc(name)}/?${qs.toString()}`, { method: "GET" }),
  );
};

// ── Errors ───────────────────────────────────────────────────────────────────
// A 400 comes in one of two shapes, and both are read:
//   { detail, errors: { field: [{message}] }, fields: {} }
//   { message, error: { detail, fields } }               (the envelope)
// Returns { message, fields: { name: "text" } }. Non-field errors (__all__ /
// non_field_errors) join the banner — they are the record's own rules, e.g.
// "Lead disqualification applies only to CPL clients."
const textOf = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(" ");
  if (typeof v === "object") return textOf(v.message ?? v.detail ?? v.msg ?? JSON.stringify(v));
  return String(v);
};

const NON_FIELD = new Set(["__all__", "non_field_errors", "detail"]);

export const parseControlError = (err, fallback = "Request failed.") => {
  const body = err?.data ?? {};
  const fields = {};
  const banner = [];
  const absorb = (obj) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
      const t = textOf(v);
      if (!t) continue;
      if (NON_FIELD.has(k)) banner.push(t);
      else fields[k] = fields[k] ? `${fields[k]} ${t}` : t;
    }
  };
  absorb(body.errors);
  absorb(body.fields);
  absorb(body.error?.fields);
  absorb(body.error?.errors);

  const top =
    textOf(body.detail) ||
    textOf(body.error?.detail) ||
    textOf(body.message) ||
    textOf(body.error?.message) ||
    (err?.message && err.message !== "API Error" ? err.message : "");
  const message = [...new Set([top, ...banner].filter(Boolean))].join(" ");
  return {
    status: err?.status ?? null,
    message: message || (Object.keys(fields).length ? "" : fallback),
    fields,
  };
};
