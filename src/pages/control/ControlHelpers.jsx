import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { callFormHelper, parseControlError } from "../../services/control";

// ─── Django admin dynamic-form helpers in the Data Console ────────────────────
// GET /control/m/{app}/{model}/helper/{name}/ → JSON. Two jobs:
//   projects — narrow the Project picker to the chosen client's projects
//   preview  — live computed figures while typing (amounts, budget, CPL)
//
// PARAMS are exactly what each helper reads (from the backend code, GET
// only): `params` maps query param → form field. They are NOT derivable from
// field names — manual lead batches read client_id from a field called
// target_client. `required` = params that must be filled before the call; a
// helper fired with half its inputs only answers with an error.
// rate config's preview_cpl also takes `window` (days); left out on purpose so
// the helper's own default applies.

const HELPERS = {
  "billing.payment": {
    projects: {
      name: "billing_payment_get_projects",
      target: "project",
      params: { client_nomen_id: "client_nomen" },
    },
    preview: {
      name: "billing_payment_preview_amounts",
      title: "Amounts",
      params: {
        base_amount: "base_amount",
        gst_pct: "gst_pct",
        tds_applied: "tds_applied",
        tds_amount: "tds_amount",
        is_opening_balance: "is_opening_balance",
      },
      required: ["base_amount"],
    },
  },
  "billing.projectbudgetallocation": {
    projects: {
      name: "billing_projectbudgetallocation_get_projects",
      target: "project",
      params: { client_id: "client" },
    },
    preview: {
      name: "billing_projectbudgetallocation_compute_budget",
      title: "Computed budget",
      params: { client_id: "client", project_id: "project", period_year: "period_year", period_month: "period_month" },
      required: ["client_id", "project_id", "period_year", "period_month"],
    },
  },
  "clients.projectdisplayconfig": {
    projects: {
      name: "clients_projectdisplayconfig_get_projects",
      target: "project",
      params: { client_id: "client" },
    },
    preview: {
      name: "clients_projectdisplayconfig_preview_cpl",
      title: "CPL preview",
      params: { client_id: "client", project_id: "project" },
      required: ["client_id", "project_id"],
    },
  },
  "leads.manualleadbatch": {
    projects: {
      name: "leads_manualleadbatch_get_projects",
      target: "project",
      params: { client_id: "target_client" },
    },
  },
};

export const helpersFor = (app, model) => HELPERS[`${app}.${model}`] ?? null;

// One form value → its query-param value, or null when empty. Relations send
// their pk, booleans true/false.
const valueOf = (field, fv) => {
  switch (field.kind) {
    case "relation":
      return fv?.id ?? null;
    case "multi_relation":
    case "json":
      return null;
    case "boolean":
      if (fv === "" || fv == null) return null;
      return fv === true || fv === "true" ? "true" : "false";
    case "datetime":
      return fv ? new Date(fv).toISOString() : null;
    default:
      return fv === "" || fv == null ? null : fv;
  }
};

// A helper spec + the form → { params, ready }. Params whose field isn't on
// this form are skipped; `ready` = every required param is filled (all of
// them when the spec names none).
const buildParams = (spec, byName, form) => {
  const params = {};
  for (const [param, fieldName] of Object.entries(spec.params)) {
    const f = byName.get(fieldName);
    if (!f) continue;
    const v = valueOf(f, form[fieldName]);
    if (v != null) params[param] = v;
  }
  const required = spec.required ?? Object.keys(spec.params);
  return { params, ready: required.every((p) => params[p] != null) };
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
    const { params, ready } = buildParams(p, byName(), props.form());
    const key = ready ? JSON.stringify(params) : "";
    if (key === lastProjectKey) return;
    lastProjectKey = key;
    if (!ready) {
      setProjectOptions(null);
      return;
    }
    callFormHelper(props.app(), props.model(), p.name, params)
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
    const { params, ready } = buildParams(pv, byName(), props.form());
    const key = ready ? JSON.stringify(params) : "";
    if (key === lastPreviewKey) return;
    lastPreviewKey = key;
    clearTimeout(timer);
    if (!ready) {
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

  // Index of the section the preview panel follows: the LAST one holding any
  // of its inputs, so it sits under everything it reads.
  const previewAfter = (sections) => {
    const pv = cfg()?.preview;
    if (!pv) return -1;
    const inputs = Object.values(pv.params);
    let last = -1;
    sections.forEach((s, i) => {
      if (inputs.some((n) => s.fields.includes(n))) last = i;
    });
    return last < 0 ? sections.length - 1 : last;
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
