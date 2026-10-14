import { createResource, createSignal, For, Show } from "solid-js";
import { useLocation } from "@solidjs/router";
import { fetchAuditLog, parseControlError } from "../../services/control";
import { PageHead, Banner, showValue, BTN, BTN_PRIMARY, INPUT, CARD } from "./ControlUI";

// ─── Audit Log (/control/audit) ───────────────────────────────────────────────
// GET /control/audit/. Two categories:
//   control → a Data Console write: details {model, object, reason, before,
//             after, changed[]} — shown as the reason + a before → after table
//             of the CHANGED fields only.
//   api     → any write from any screen: details {status, body}.
// The older Activity Log page is separate and unchanged.

const EMPTY = {
  category: "",
  actor: "",
  model: "",
  action: "",
  target_id: "",
  result: "",
  q: "",
  date_from: "",
  date_to: "",
};
const PAGE_SIZE = 50;

const fmtTime = (t) => {
  if (!t) return "—";
  const d = new Date(t);
  return Number.isNaN(d.getTime())
    ? String(t)
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};
const pretty = (v) => (v == null ? "—" : typeof v === "string" ? v : JSON.stringify(v, null, 2));

function ControlDetails(props) {
  const dt = () => props.details ?? {};
  const changed = () =>
    Array.isArray(dt().changed) && dt().changed.length
      ? dt().changed
      : Object.keys({ ...(dt().before ?? {}), ...(dt().after ?? {}) }).filter(
          (k) => JSON.stringify(dt().before?.[k]) !== JSON.stringify(dt().after?.[k]),
        );
  return (
    <div class="space-y-2">
      <p class="text-sm">
        <span class="font-medium">Reason:</span>{" "}
        <span class="text-gray-700 dark:text-gray-300">{dt().reason || "—"}</span>
      </p>
      <Show when={dt().model || dt().object}>
        <p class="text-xs text-gray-500">
          {dt().model} {dt().object ? `· ${showValue(dt().object)}` : ""}
        </p>
      </Show>
      <Show when={changed().length} fallback={<p class="text-xs text-gray-500">No field changes recorded.</p>}>
        <table class="text-xs w-full max-w-3xl">
          <thead>
            <tr class="text-left text-gray-500 uppercase tracking-wider">
              <th class="py-1 pr-3">Field</th>
              <th class="py-1 pr-3">Before</th>
              <th class="py-1">After</th>
            </tr>
          </thead>
          <tbody>
            <For each={changed()}>
              {(k) => (
                <tr class="border-t border-gray-200 dark:border-gray-700 align-top">
                  <td class="py-1 pr-3 font-medium">{k}</td>
                  <td class="py-1 pr-3 text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">{pretty(dt().before?.[k])}</td>
                  <td class="py-1 text-green-700 dark:text-green-300 whitespace-pre-wrap break-all">{pretty(dt().after?.[k])}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}

function ApiDetails(props) {
  const dt = () => props.details ?? {};
  return (
    <div class="space-y-1">
      <p class="text-sm">
        <span class="font-medium">Status:</span> {dt().status ?? "—"}
      </p>
      <pre class="max-h-64 overflow-auto rounded bg-gray-50 dark:bg-gray-800 p-2 text-xs whitespace-pre-wrap break-all">
        {pretty(dt().body)}
      </pre>
    </div>
  );
}

export default function ControlAudit() {
  const [draft, setDraft] = createSignal({ ...EMPTY });
  // Filters can arrive in the URL (System Health links here with
  // ?result=failure); any EMPTY key present in the query seeds both.
  const location = useLocation();
  const fromUrl = () => {
    const p = new URLSearchParams(location.search);
    const out = { ...EMPTY };
    for (const k of Object.keys(EMPTY)) if (p.get(k)) out[k] = p.get(k);
    return out;
  };
  setDraft(fromUrl());
  const [applied, setApplied] = createSignal(fromUrl());
  const [page, setPage] = createSignal(1);
  const [open, setOpen] = createSignal(null);

  const [log] = createResource(
    () => ({ ...applied(), page: page(), page_size: PAGE_SIZE }),
    fetchAuditLog,
  );
  const d = () => (log.error ? null : log());
  const rows = () => d()?.rows ?? [];
  const pages = () => Math.max(1, Math.ceil((d()?.total ?? 0) / (d()?.page_size ?? PAGE_SIZE)));

  const set = (k, v) => setDraft((s) => ({ ...s, [k]: v }));
  const apply = (e) => {
    e?.preventDefault();
    setApplied({ ...draft() });
    setPage(1);
    setOpen(null);
  };
  const reset = () => {
    setDraft({ ...EMPTY });
    setApplied({ ...EMPTY });
    setPage(1);
    setOpen(null);
  };
  const rowKey = (r, i) => `${r.timestamp}-${r.target_id}-${i}`;

  const text = (k, label, placeholder) => (
    <div>
      <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <input type="text" value={draft()[k]} placeholder={placeholder} onInput={(e) => set(k, e.target.value)} class={INPUT} />
    </div>
  );

  return (
    <div class="min-h-screen p-3 lg:p-8">
      <PageHead
        title="Audit Log"
        subtitle="Data Console changes (with reasons) and every write made from any screen."
      />

      <form onSubmit={apply} class={`${CARD} p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`}>
        <div>
          <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Category</label>
          <select value={draft().category} onChange={(e) => set("category", e.target.value)} class={INPUT}>
            <option value="">All</option>
            <option value="control">Control (Data Console)</option>
            <option value="api">API (all screens)</option>
          </select>
        </div>
        {text("actor", "Actor", "email")}
        {text("model", "Model", "e.g. billing.Payment")}
        {text("action", "Action", "e.g. update")}
        {text("target_id", "Target ID", "")}
        {text("q", "Search", "")}
        <div>
          <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Result</label>
          <select value={draft().result} onChange={(e) => set("result", e.target.value)} class={INPUT}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From</label>
          <input type="date" value={draft().date_from} onInput={(e) => set("date_from", e.target.value)} class={INPUT} />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
          <input type="date" value={draft().date_to} min={draft().date_from || undefined} onInput={(e) => set("date_to", e.target.value)} class={INPUT} />
        </div>
        <div class="sm:col-span-2 lg:col-span-4 flex justify-end gap-2">
          <button type="button" class={BTN} onClick={reset}>
            Reset
          </button>
          <button type="submit" class={BTN_PRIMARY}>
            Apply
          </button>
        </div>
      </form>

      <Banner>{log.error ? parseControlError(log.error, "Couldn't load the audit log.").message : ""}</Banner>

      <div class={`${CARD} overflow-x-auto`}>
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider text-left">
              <th class="p-3">When</th>
              <th class="p-3">Actor</th>
              <th class="p-3">Category</th>
              <th class="p-3">Action</th>
              <th class="p-3">Target</th>
              <th class="p-3">Result</th>
              <th class="p-3" />
            </tr>
          </thead>
          <tbody>
            <Show when={!log.loading} fallback={<tr><td colspan="7" class="p-8 text-center text-gray-400">Loading…</td></tr>}>
              <For each={rows()} fallback={<tr><td colspan="7" class="p-8 text-center text-gray-400">No entries.</td></tr>}>
                {(r, i) => {
                  const key = rowKey(r, i());
                  return (
                    <>
                      <tr
                        class="border-b border-gray-100 dark:border-gray-800 hover:bg-purple-50/50 dark:hover:bg-gray-800/40 cursor-pointer align-top"
                        onClick={() => setOpen(open() === key ? null : key)}
                      >
                        <td class="p-3 whitespace-nowrap text-gray-600 dark:text-gray-400">{fmtTime(r.timestamp)}</td>
                        <td class="p-3">
                          <span class="text-gray-800 dark:text-gray-200">{showValue(r.actor)}</span>
                          <Show when={r.actor_role}>
                            <span class="block text-xs text-gray-400">{r.actor_role}</span>
                          </Show>
                        </td>
                        <td class="p-3">
                          <span
                            class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              r.category === "control"
                                ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                            }`}
                          >
                            {r.category ?? "—"}
                          </span>
                        </td>
                        <td class="p-3 text-gray-700 dark:text-gray-300">{r.action ?? "—"}</td>
                        <td class="p-3 text-gray-700 dark:text-gray-300 max-w-[18rem] truncate" title={showValue(r.target)}>
                          {showValue(r.target)}
                          <Show when={r.target_id != null}>
                            <span class="text-xs text-gray-400"> #{r.target_id}</span>
                          </Show>
                        </td>
                        <td class="p-3 text-gray-700 dark:text-gray-300">{showValue(r.result)}</td>
                        <td class="p-3 text-xs text-purple-700 whitespace-nowrap">{open() === key ? "Hide" : "Details"}</td>
                      </tr>
                      <Show when={open() === key}>
                        <tr class="bg-gray-50/70 dark:bg-gray-800/30">
                          <td colspan="7" class="p-4">
                            <Show when={r.category === "control"} fallback={<ApiDetails details={r.details} />}>
                              <ControlDetails details={r.details} />
                            </Show>
                          </td>
                        </tr>
                      </Show>
                    </>
                  );
                }}
              </For>
            </Show>
          </tbody>
        </table>
      </div>

      <Show when={d()}>
        <div class="mt-4 flex items-center justify-between gap-3">
          <span class="text-sm text-gray-500">{d().total ?? 0} entries</span>
          <div class="flex items-center gap-2">
            <button type="button" class={BTN} disabled={page() <= 1} onClick={() => setPage(page() - 1)}>
              Prev
            </button>
            <span class="text-sm text-gray-500">
              Page {page()} of {pages()}
            </span>
            <button type="button" class={BTN} disabled={page() >= pages()} onClick={() => setPage(page() + 1)}>
              Next
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
