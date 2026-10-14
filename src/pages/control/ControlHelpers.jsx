import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { callFormHelper, parseControlError } from "../../services/control";

// ─── Django admin dynamic-form helpers in the Data Console ────────────────────
// GET /control/m/{app}/{model}/helper/{name}/ → JSON. Two jobs:
//   projects — narrow the Project picker to the chosen client's projects
//   preview  — live computed figures while typing (amounts, budget, CPL)
//
// PARAMS follow one convention, the one the payments spec states outright:
// a relation field X is sent as `X_id=<pk>` (client_nomen → client_nomen_id),
// any other field under its own name (base_amount, gst_pct, …), booleans as
// true/false. Only payments' params are spelled out in the backend note; the
// other three models use the same convention — if one helper wants a
// different name, it is one line in HELPERS below.

const HELPERS = {
  "billing.payment": {
    projects: { name: "billing_payment_get_projects", target: "project", from: ["client_nomen"] },
    preview: {
      name: "billing_payment_preview_amounts",
      title: "Amounts",
      fields: ["base_amount", "gst_pct", "tds_applied", "tds_amount"],
    },
  },
  "billing.projectbudgetallocation": {
    projects: { name: "billing_projectbudgetallocation_get_projects", target: "project", from: ["client_nomen", "client"] },
    preview: { name: "billing_projectbudgetallocation_compute_budget", title: "Computed budget", fields: null },
  },
  "clients.projectdisplayconfig": {
    projects: { name: "clients_projectdisplayconfig_get_projects", target: "project", from: ["client", "client_nomen"] },
    preview: { name: "clients_projectdisplayconfig_preview_cpl", title: "CPL preview", fields: null },
  },
  "leads.manualleadbatch": {
    projects: { name: "leads_manualleadbatch_get_projects", target: "project", from: ["client_nomen", "client"] },
  },
};

export const helpersFor = (app, model) => HELPERS[`${app}.${model}`] ?? null;

// One form value → its query param (name, value), or null when empty.
const paramOf = (field, fv) => {
  switch (field.kind) {
    case "relation":
      return fv?.id != null ? [`${field.name}_id`, fv.id] : null;
    case "multi_relation":
    case "json":
      return null;
    case "boolean":
      if (fv === "" || fv == null) return null;
      return [field.name, fv === true || fv === "true" ? "true" : "false"];
    case "datetime":
      return fv ? [field.name, new Date(fv).toISOString()] : null;
    default:
      return fv === "" || fv == null ? null : [field.name, fv];
  }
};

// Projects list → [{id, label}], whatever envelope it came in.
const normProjects = (res) => {
  const list = Array.isArray(res)
    ? res
    : (res?.projects ?? res?.results ?? res?.data ?? null);
  if (Array.isArray(list)) {
    return list.map((p) =>
      Array.isArray(p)
        ? { id: p[0], label: String(p[1] ?? p[0]) }
        : { id: p.id ?? p.pk ?? p.value, label: String(p.label ?? p.name ?? p.project_name ?? p.text ?? p.id) },
    );
  }
  if (res && typeof res === "object") {
    // { "12": "Project name", … }
    return Object.entries(res).map(([id, label]) => ({ id, label: String(label) }));
  }
  return [];
};

// Wires a form to its helpers. Returns reactive accessors the form renders.
export function useFormHelpers(props) {
  const cfg = () => helpersFor(props.app(), props.model());
  const byName = () => new Map(props.fields().map((f) => [f.name, f]));

  // ── projects ──
  const [projectOptions, setProjectOptions] = createSignal(null); // null = use lookup
  let lastProjectKey = null;
  createEffect(() => {
    const p = cfg()?.projects;
    if (!p) return;
    const fromName = p.from.find((n) => byName().has(n));
    const f = fromName ? byName().get(fromName) : null;
    const kv = f ? paramOf(f, props.form()[fromName]) : null;
    const key = kv ? `${kv[0]}=${kv[1]}` : "";
    if (key === lastProjectKey) return;
    lastProjectKey = key;
    if (!kv) {
      setProjectOptions(null);
      return;
    }
    callFormHelper(props.app(), props.model(), p.name, { [kv[0]]: kv[1] })
      .then((res) => {
        if (lastProjectKey === key) setProjectOptions(normProjects(res));
      })
      .catch(() => {
        if (lastProjectKey === key) setProjectOptions(null); // fall back to lookup
      });
  });
  const optionsFor = (name) => (cfg()?.projects?.target === name ? projectOptions() : undefined);

  // ── live preview ──
  const [preview, setPreview] = createSignal(null); // { data } | { error }
  let timer;
  let lastPreviewKey = null;
  let seq = 0;
  onCleanup(() => clearTimeout(timer));
  createEffect(() => {
    const pv = cfg()?.preview;
    if (!pv) return;
    const names = pv.fields ?? props.fields().map((f) => f.name);
    const params = {};
    // A plain checkbox always has a value, so it alone is not "something
    // typed" — the preview waits for at least one other input.
    let typed = false;
    for (const n of names) {
      const f = byName().get(n);
      if (!f || f.sensitive) continue;
      const kv = paramOf(f, props.form()[n]);
      if (!kv) continue;
      params[kv[0]] = kv[1];
      if (f.kind !== "boolean") typed = true;
    }
    const key = JSON.stringify(params);
    if (key === lastPreviewKey) return;
    lastPreviewKey = key;
    clearTimeout(timer);
    if (!typed) {
      setPreview(null);
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await callFormHelper(props.app(), props.model(), pv.name, params);
        if (mine === seq) setPreview({ data: res });
      } catch (err) {
        if (mine === seq) setPreview({ error: parseControlError(err, "Preview unavailable.").message });
      }
    }, 400);
  });

  // Index of the section the preview panel follows: the first one holding any
  // of its inputs, or the first section when it reads the whole form.
  const previewAfter = (sections) => {
    const pv = cfg()?.preview;
    if (!pv) return -1;
    if (!pv.fields) return 0;
    const i = sections.findIndex((s) => pv.fields.some((n) => s.fields.includes(n)));
    return i < 0 ? sections.length - 1 : i;
  };

  return { optionsFor, preview, previewTitle: () => cfg()?.preview?.title, previewAfter };
}

// Generic renderer for a helper's JSON: whatever figures it returns, labelled
// by key — no assumption about which keys exist. One level of nesting is
// flattened ("gst.amount" → "Gst amount").
const label = (k) => k.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const fmt = (v) =>
  typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    ? Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })
    : typeof v === "boolean"
      ? (v ? "Yes" : "No")
      : v == null
        ? "—"
        : String(v);
const flatten = (obj, prefix = "") => {
  if (obj == null || typeof obj !== "object") return [[prefix || "value", obj]];
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) && !prefix
      ? flatten(v, k)
      : [[prefix ? `${prefix}.${k}` : k, Array.isArray(v) ? v.map(fmt).join(", ") : v]],
  );
};

export function HelperPreview(props) {
  const p = () => props.preview;
  const err = () => p()?.error ?? (typeof p()?.data?.error === "string" ? p().data.error : null);
  const rows = () => (p()?.data && !err() ? flatten(p().data).filter(([k]) => k !== "ok" && k !== "success") : []);
  return (
    <Show when={p()}>
      <div class="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/10 p-4">
        <p class="text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300">
          {props.title ?? "Preview"} · live
        </p>
        <Show when={!err()} fallback={<p class="mt-1 text-sm text-red-600 dark:text-red-400">{err()}</p>}>
          <dl class="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            <For each={rows()}>
              {([k, v]) => (
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">{label(k)}</dt>
                  <dd class="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{fmt(v)}</dd>
                </div>
              )}
            </For>
          </dl>
        </Show>
      </div>
    </Show>
  );
}
