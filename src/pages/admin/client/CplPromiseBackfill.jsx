import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import {
  fetchPromiseBackfill,
  savePromise,
} from "../services/projectDisplayConfig";
import { loadErrorMessage } from "../../../utils/apiErrors";

// ─── CPL Promise % backfill (/cpl-promise) ────────────────────────────────────
// TEMPORARY — for the days it takes to give every active CPL rate a promised
// qualification %. From Oct 2026 an unset promise bills on qualified leads, so
// each missing row is a project billing on the wrong basis until it's set.
//
// The server scopes the rows (CM: own + team; admin / coordination: all) and
// says whether this user may write (can_edit — false for tier 3). Setting a
// promise here is first-time only: once set, it changes in Project Display
// Config (the backend answers 409).

const PROMISE_PCTS = [30, 35, 40, 50];

const fmtRate = (v) =>
  v == null || v === ""
    ? "—"
    : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const isSet = (r) => r.promised_qualification_pct != null && r.promised_qualification_pct !== "";

// What each failed save says, by status.
const saveErrorText = (err) => {
  if (err?.status === 409) return "Already set — change it in Project Display Config.";
  if (err?.status === 404) return "This project is not in your clients.";
  if (err?.status === 403) return "You don't have permission to set promises.";
  return err?.message || "Couldn't save. Please try again.";
};

export default function CplPromiseBackfill() {
  const [rows, setRows] = createSignal([]);
  const [missingCount, setMissingCount] = createSignal(0);
  const [doneCount, setDoneCount] = createSignal(0);
  const [canEdit, setCanEdit] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal(null);

  const [onlyMissing, setOnlyMissing] = createSignal(true);
  const [search, setSearch] = createSignal("");
  const [clientFilter, setClientFilter] = createSignal("");
  const [reason, setReason] = createSignal("");

  // Per-row UI state, keyed by config_id: the chosen % and the save outcome.
  const [picks, setPicks] = createSignal({});
  const [rowState, setRowState] = createSignal({}); // { [id]: { saving, error, saved } }
  const patchRowState = (id, v) => setRowState((s) => ({ ...s, [id]: { ...(s[id] ?? {}), ...v } }));

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await fetchPromiseBackfill(onlyMissing());
      setRows(Array.isArray(d?.rows) ? d.rows : []);
      setMissingCount(Number(d?.missing_count ?? 0));
      setDoneCount(Number(d?.done_count ?? 0));
      setCanEdit(d?.can_edit === true);
    } catch (err) {
      console.error("Failed to load promise backfill:", err);
      setLoadError(err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };
  onMount(load);

  const total = () => missingCount() + doneCount();
  const pctDone = () => (total() ? Math.round((doneCount() / total()) * 100) : 0);

  // Client filter options from the rows on screen.
  const clients = createMemo(() => {
    const seen = new Map();
    for (const r of rows()) if (!seen.has(r.client_id)) seen.set(r.client_id, r.client_nomen ?? `Client #${r.client_id}`);
    return [...seen.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  });

  // Missing first (the server's order), then set — a row saved here drops below
  // the ones still waiting.
  const shown = createMemo(() => {
    const q = search().trim().toLowerCase();
    const c = clientFilter();
    const list = rows().filter(
      (r) =>
        (!c || String(r.client_id) === c) &&
        (!q ||
          String(r.client_nomen ?? "").toLowerCase().includes(q) ||
          String(r.project_name ?? "").toLowerCase().includes(q)),
    );
    return [...list.filter((r) => !isSet(r)), ...list.filter(isSet)];
  });

  const save = async (r) => {
    const pct = picks()[r.config_id];
    if (!pct) return;
    patchRowState(r.config_id, { saving: true, error: "", saved: false });
    try {
      await savePromise(r.config_id, Number(pct), reason());
      setRows((list) => list.map((x) => (x.config_id === r.config_id ? { ...x, promised_qualification_pct: Number(pct) } : x)));
      setMissingCount((n) => Math.max(0, n - 1));
      setDoneCount((n) => n + 1);
      patchRowState(r.config_id, { saving: false, saved: true });
    } catch (err) {
      patchRowState(r.config_id, { saving: false, error: saveErrorText(err) });
      // 409: someone set it meanwhile — pull the row's real value back in.
      if (err?.status === 409) {
        try {
          const all = await fetchPromiseBackfill(false);
          const fresh = (all?.rows ?? []).find((x) => x.config_id === r.config_id);
          if (fresh) setRows((list) => list.map((x) => (x.config_id === r.config_id ? fresh : x)));
          setMissingCount(Number(all?.missing_count ?? missingCount()));
          setDoneCount(Number(all?.done_count ?? doneCount()));
        } catch {
          /* the message on the row already says what happened */
        }
      }
    }
  };

  const toggleMissing = () => {
    setOnlyMissing((v) => !v);
    load();
  };

  const field =
    "min-h-[40px] px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500";

  return (
    <div class="min-h-screen min-w-0 p-3 lg:p-8">
      <div class="mb-5">
        <h1 class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">CPL Promise %</h1>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Every active CPL rate needs a promised qualification %. Until it's set, the project bills on
          qualified leads.
        </p>
      </div>

      <Show when={loadError()}>
        <div role="alert" class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          <span>Couldn't load the list. {loadErrorMessage(loadError())}</span>
          <button type="button" onClick={load} class="min-h-[40px] rounded-lg border border-red-300 dark:border-red-700 px-3 text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900/40">
            Retry
          </button>
        </div>
      </Show>

      {/* Progress */}
      <Show when={!loadError() && !loading()}>
        <section class="mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5" aria-label="Progress">
          <p class="text-base font-semibold text-gray-900 dark:text-white">
            <Show when={missingCount() > 0} fallback="Every project has a promise %.">
              {missingCount()} of {total()} project{total() === 1 ? "" : "s"} still need{missingCount() === 1 ? "s" : ""} a promise %
            </Show>
          </p>
          <div
            class="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={pctDone()}
            aria-label={`${pctDone()}% done`}
          >
            <div class="h-full rounded-full bg-green-600 dark:bg-green-500 transition-all" style={{ width: `${pctDone()}%` }} />
          </div>
          <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {doneCount()} done · {pctDone()}%
          </p>
        </section>
      </Show>

      <Show when={!canEdit() && !loading() && !loadError()}>
        <div class="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          View only — you can see these rates but can't set a promise.
        </div>
      </Show>

      {/* Filters */}
      <div class="mb-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        <input
          type="search"
          aria-label="Search client or project"
          placeholder="Search client or project…"
          value={search()}
          onInput={(e) => setSearch(e.target.value)}
          class={`${field} w-full sm:w-72`}
        />
        <select
          aria-label="Filter by client"
          value={clientFilter()}
          onChange={(e) => setClientFilter(e.target.value)}
          class={`${field} w-full sm:w-64`}
        >
          <option value="">All clients</option>
          <For each={clients()}>{([id, name]) => <option value={String(id)}>{name}</option>}</For>
        </select>
        <label class="inline-flex min-h-[40px] items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" checked={onlyMissing()} onChange={toggleMissing} />
          Only missing
        </label>
        <Show when={canEdit()}>
          <input
            type="text"
            aria-label="Reason (optional, saved with each change)"
            placeholder="Reason (optional)"
            value={reason()}
            onInput={(e) => setReason(e.target.value)}
            class={`${field} w-full sm:w-64 sm:ml-auto`}
          />
        </Show>
      </div>

      {/* Rows */}
      <div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <th class="p-3">Client</th>
              <th class="p-3">Project</th>
              <th class="p-3 text-right whitespace-nowrap">CPL rate</th>
              <th class="p-3 whitespace-nowrap">Promise %</th>
              <th class="p-3" />
            </tr>
          </thead>
          <tbody>
            <Show
              when={!loading()}
              fallback={
                <tr>
                  <td colspan="5" class="p-8 text-center text-gray-400">Loading…</td>
                </tr>
              }
            >
              <For
                each={shown()}
                fallback={
                  <tr>
                    <td colspan="5" class="p-8 text-center text-gray-500 dark:text-gray-400">
                      {loadError()
                        ? "Nothing loaded — see the error above."
                        : onlyMissing() && !search() && !clientFilter()
                          ? "Nothing missing — every project you handle has a promise %."
                          : "No projects match."}
                    </td>
                  </tr>
                }
              >
                {(r) => {
                  const st = () => rowState()[r.config_id] ?? {};
                  const done = () => isSet(r);
                  return (
                    <tr class={`border-b border-gray-100 dark:border-gray-800 align-top ${done() ? "bg-gray-50/60 dark:bg-gray-800/30" : ""}`}>
                      <td class="p-3 max-w-[16rem]">
                        <span class="block truncate font-medium text-gray-800 dark:text-gray-200" title={r.client_nomen ?? ""}>
                          {r.client_nomen ?? `Client #${r.client_id}`}
                        </span>
                      </td>
                      <td class="p-3 max-w-[18rem]">
                        <span class="block truncate text-gray-700 dark:text-gray-300" title={r.project_name ?? ""}>
                          {r.project_name ?? `Project #${r.project_id}`}
                        </span>
                        <span class="block text-xs text-gray-400 dark:text-gray-500">from {fmtDate(r.valid_from)}</span>
                      </td>
                      <td class="p-3 text-right tabular-nums whitespace-nowrap text-gray-700 dark:text-gray-300">{fmtRate(r.fixed_cpl)}</td>
                      <td class="p-3 whitespace-nowrap">
                        <Show
                          when={canEdit() && !done()}
                          fallback={
                            <span class={done() ? "font-semibold text-gray-800 dark:text-gray-200" : "text-xs text-amber-600 dark:text-amber-400"}>
                              {done() ? `${Number(r.promised_qualification_pct)}%` : "Not set"}
                            </span>
                          }
                        >
                          <select
                            aria-label={`Promise % for ${r.project_name ?? r.config_id}`}
                            value={picks()[r.config_id] ?? ""}
                            onChange={(e) => {
                              setPicks((p) => ({ ...p, [r.config_id]: e.target.value }));
                              patchRowState(r.config_id, { error: "" });
                            }}
                            class={`${field} w-28`}
                          >
                            <option value="">—</option>
                            <For each={PROMISE_PCTS}>{(v) => <option value={String(v)}>{v}%</option>}</For>
                          </select>
                        </Show>
                      </td>
                      <td class="p-3 min-w-[9rem]">
                        <Show
                          when={canEdit() && !done()}
                          fallback={
                            <Show when={st().saved}>
                              <span class="text-xs font-medium text-green-700 dark:text-green-400">Saved</span>
                            </Show>
                          }
                        >
                          <button
                            type="button"
                            disabled={!picks()[r.config_id] || st().saving}
                            onClick={() => save(r)}
                            class="min-h-[40px] px-3.5 rounded-lg bg-blue-900 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {st().saving ? "Saving…" : "Save"}
                          </button>
                        </Show>
                        <Show when={st().error}>
                          <p class="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
                            {st().error}
                            <Show when={/Project Display Config/.test(st().error)}>
                              {" "}
                              <A href="/project-display-config" class="underline">Open</A>
                            </Show>
                          </p>
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </Show>
          </tbody>
        </table>
      </div>
    </div>
  );
}
