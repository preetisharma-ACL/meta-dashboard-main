import { createResource, createSignal, createMemo, createEffect, on, For, Show } from "solid-js";
import { A, useParams, useLocation, useNavigate } from "@solidjs/router";
import {
  fetchControlList,
  fetchControlMeta,
  runControlAction,
  parseControlError,
} from "../../services/control";
import {
  PageHead,
  Banner,
  ReasonDialog,
  Cell,
  takeFlash,
  showValue,
  BTN,
  BTN_PRIMARY,
  INPUT,
  CARD,
} from "./ControlUI";

// ─── Data Console: change list (/control/data/:app/:model) ────────────────────
// Django admin's changelist over the API. The page's own URL query string IS
// the list query, in Django admin's vocabulary only (q, p, o + filter params),
// so back/forward/refresh keep the view and a link reproduces it exactly.
// Filter choices are followed by their query_string verbatim — that string
// already carries the other active params (minus p), exactly as in the admin.

// o = "-3.1" → [{ i: 3, desc: true }, { i: 1, desc: false }]. The numbers are
// each column's sort_index from the response, never its position on screen.
const parseOrder = (o) =>
  String(o || "")
    .split(".")
    .filter(Boolean)
    .map((t) => ({ i: Math.abs(parseInt(t, 10)), desc: t.startsWith("-") }))
    .filter((x) => Number.isFinite(x.i) && x.i >= 0); // sort_index starts at 0
const orderString = (list) => list.map((x) => `${x.desc ? "-" : ""}${x.i}`).join(".");

// Actions arrive as [{name, description}] or Django's [[name, label]] pairs.
export const normaliseActions = (acts) =>
  (Array.isArray(acts) ? acts : []).map((a) =>
    Array.isArray(a)
      ? { name: a[0], label: a[1] ?? a[0] }
      : typeof a === "string"
        ? { name: a, label: a }
        : { name: a.name ?? a.action, label: a.description ?? a.label ?? a.verbose_name ?? a.name },
  );

export default function ControlChangeList() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const base = () => `/control/data/${encodeURIComponent(params.app)}/${encodeURIComponent(params.model)}`;

  const [flashMsg, setFlashMsg] = createSignal(takeFlash());
  const [list, { refetch }] = createResource(
    () => ({ app: params.app, model: params.model, qs: location.search }),
    ({ app, model, qs }) => fetchControlList(app, model, qs),
  );
  const [meta] = createResource(
    () => ({ app: params.app, model: params.model }),
    ({ app, model }) => fetchControlMeta(app, model),
  );
  const d = () => (list.error ? null : list());
  const perms = () => meta()?.perms ?? {};
  const actions = createMemo(() => normaliseActions(meta()?.actions));
  const title = () =>
    meta()?.verbose_name_plural ?? meta()?.verbose_name ?? d()?.verbose_name_plural ?? params.model;

  // ── Query string ──
  const query = () => new URLSearchParams(location.search);
  const go = (qs) => navigate(`${base()}${qs ? `?${String(qs).replace(/^\?/, "")}` : ""}`);
  const setParam = (mut) => {
    const p = query();
    mut(p);
    go(p.toString());
  };

  const [search, setSearch] = createSignal(query().get("q") ?? "");
  createEffect(on(() => location.search, () => setSearch(query().get("q") ?? "")));
  const submitSearch = (e) => {
    e.preventDefault();
    setParam((p) => {
      const v = search().trim();
      v ? p.set("q", v) : p.delete("q");
      p.delete("p");
    });
  };

  // The current sort comes from the server's ordering[] ({sort_index, dir}) —
  // it already accounts for Django's row-checkbox column on models with
  // actions, and reflects a default ordering the URL doesn't carry. The URL's
  // own o is only the fallback for a response without it.
  const order = () =>
    Array.isArray(d()?.ordering)
      ? d().ordering.map((x) => ({ i: Number(x.sort_index), desc: x.dir === "desc" }))
      : parseOrder(query().get("o"));
  const sortBy = (i) =>
    setParam((p) => {
      const cur = order();
      const head = cur[0];
      const rest = cur.filter((x) => x.i !== i);
      const next =
        head && head.i === i ? [{ i, desc: !head.desc }, ...rest] : [{ i, desc: false }, ...rest];
      p.set("o", orderString(next));
      p.delete("p");
    });
  const sortMark = (i) => {
    const idx = order().findIndex((x) => x.i === i);
    if (idx < 0) return <span class="ml-1 text-gray-300">⇅</span>;
    return (
      <span class="ml-1 text-purple-600">
        {order()[idx].desc ? "↓" : "↑"}
        <Show when={order().length > 1}>
          <sup class="text-[9px]">{idx + 1}</sup>
        </Show>
      </span>
    );
  };
  const goPage = (n) => setParam((p) => (n > 1 ? p.set("p", String(n)) : p.delete("p")));

  // ── Selection + bulk actions ──
  const [selected, setSelected] = createSignal(new Set());
  createEffect(on(() => location.search, () => setSelected(new Set())));
  const rows = () => d()?.rows ?? [];
  const allOnPage = () => rows().length > 0 && rows().every((r) => selected().has(r.pk));
  const toggle = (pk) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(pk) ? n.delete(pk) : n.add(pk);
      return n;
    });
  const toggleAll = () =>
    setSelected(allOnPage() ? new Set() : new Set(rows().map((r) => r.pk)));

  const [action, setAction] = createSignal("");
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal("");
  const [result, setResult] = createSignal(null);
  const actionLabel = () => actions().find((a) => a.name === action())?.label ?? action();

  const runAction = async (reason) => {
    setBusy(true);
    setActionError("");
    try {
      const res = await runControlAction(params.app, params.model, action(), [...selected()], reason);
      const msgs = (res?.messages ?? []).map((m) => (typeof m === "string" ? m : (m.message ?? showValue(m))));
      setResult({
        tone: "success",
        text: msgs.length ? msgs.join(" ") : `${actionLabel()}: ${res?.count ?? 0} record(s).`,
      });
      setConfirming(false);
      setSelected(new Set());
      setAction("");
      refetch();
    } catch (err) {
      setActionError(parseControlError(err, "The action failed.").message);
    } finally {
      setBusy(false);
    }
  };

  const changeHref = (pk) => `${base()}/${encodeURIComponent(pk)}/change`;
  const hasActions = () => actions().length > 0;
  const colCount = () => (d()?.columns?.length ?? 0) + (hasActions() ? 1 : 0);

  return (
    <div class="min-h-screen p-3 lg:p-8">
      <PageHead
        crumbs={
          <>
            <A href="/control/data" class="hover:underline">Data Console</A> › {params.app}
          </>
        }
        title={title()}
        subtitle={
          d()
            ? `${d().count} of ${d().total} · page ${d().page} of ${d().pages || 1}`
            : undefined
        }
        actions={
          <Show when={perms().add}>
            <A href={`${base()}/add`} class={BTN_PRIMARY}>
              + Add
            </A>
          </Show>
        }
      />

      <Banner tone={flashMsg()?.tone}>{flashMsg()?.text}</Banner>
      <Banner tone={result()?.tone}>{result()?.text}</Banner>
      <Banner>{list.error ? parseControlError(list.error, "Couldn't load the list.").message : ""}</Banner>

      <div class="flex flex-col lg:flex-row gap-4 items-start">
        <div class="flex-1 min-w-0 w-full">
          {/* Search + bulk action bar */}
          <div class={`${CARD} p-3 mb-3 flex flex-wrap items-center gap-2`}>
            <Show when={d()?.search}>
              <form onSubmit={submitSearch} class="flex gap-2 flex-1 min-w-[16rem]">
                <input
                  type="search"
                  value={search()}
                  onInput={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  class={INPUT}
                />
                <button type="submit" class={BTN}>
                  Search
                </button>
              </form>
            </Show>
            <Show when={hasActions()}>
              <div class="flex items-center gap-2">
                <select
                  value={action()}
                  onChange={(e) => setAction(e.target.value)}
                  class={`${INPUT} w-auto`}
                >
                  <option value="">Action…</option>
                  <For each={actions()}>{(a) => <option value={a.name}>{a.label}</option>}</For>
                </select>
                <button
                  type="button"
                  class={BTN}
                  disabled={!action() || selected().size === 0}
                  onClick={() => {
                    setActionError("");
                    setConfirming(true);
                  }}
                >
                  Go
                </button>
                <span class="text-xs text-gray-500">{selected().size} selected</span>
              </div>
            </Show>
          </div>
          <Show when={d()?.search && d()?.search_help}>
            <p class="-mt-1 mb-3 text-xs text-gray-500 dark:text-gray-400">{d().search_help}</p>
          </Show>

          {/* Table */}
          <div class={`${CARD} overflow-x-auto`}>
            <table class="min-w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider">
                  <Show when={hasActions()}>
                    <th class="p-3 w-10">
                      <input type="checkbox" checked={allOnPage()} onChange={toggleAll} aria-label="Select all on page" />
                    </th>
                  </Show>
                  <For each={d()?.columns ?? []}>
                    {(c, i) => (
                      <th class="p-3 text-left whitespace-nowrap">
                        <Show when={c.sortable === true && c.sort_index != null} fallback={c.label}>
                          <button
                            type="button"
                            onClick={() => sortBy(Number(c.sort_index))}
                            class="inline-flex items-center uppercase tracking-wider hover:text-blue-600"
                          >
                            {c.label}
                            {sortMark(Number(c.sort_index))}
                          </button>
                        </Show>
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={!list.loading}
                  fallback={
                    <tr>
                      <td colspan={Math.max(colCount(), 1)} class="p-8 text-center text-gray-400">
                        Loading…
                      </td>
                    </tr>
                  }
                >
                  <For
                    each={rows()}
                    fallback={
                      <tr>
                        <td colspan={Math.max(colCount(), 1)} class="p-8 text-center text-gray-400">
                          No records.
                        </td>
                      </tr>
                    }
                  >
                    {(r) => (
                      <tr class="border-b border-gray-100 dark:border-gray-800 hover:bg-purple-50/50 dark:hover:bg-gray-800/40">
                        <Show when={hasActions()}>
                          <td class="p-3">
                            <input
                              type="checkbox"
                              checked={selected().has(r.pk)}
                              onChange={() => toggle(r.pk)}
                              aria-label={`Select ${r.str ?? r.pk}`}
                            />
                          </td>
                        </Show>
                        <For each={d().columns}>
                          {(c, i) => (
                            <td class="p-3 text-gray-700 dark:text-gray-300 max-w-[22rem] truncate" title={showValue(r.cells?.[c.name])}>
                              {/* First column opens the record, as list_display_links does. */}
                              <Show when={i() === 0} fallback={<Cell value={r.cells?.[c.name]} />}>
                                <A href={changeHref(r.pk)} class="font-medium text-purple-700 dark:text-purple-300 hover:underline">
                                  {showValue(r.cells?.[c.name] ?? r.str ?? r.pk)}
                                </A>
                              </Show>
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </Show>
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Show when={d() && d().pages > 1}>
            <div class="mt-4 flex items-center justify-between gap-3">
              <span class="text-sm text-gray-500">
                {d().count} record{d().count === 1 ? "" : "s"} · {d().per_page} per page
              </span>
              <div class="flex items-center gap-2">
                <button type="button" class={BTN} disabled={d().page <= 1} onClick={() => goPage(d().page - 1)}>
                  Prev
                </button>
                <span class="text-sm text-gray-500">
                  Page {d().page} of {d().pages}
                </span>
                <button type="button" class={BTN} disabled={d().page >= d().pages} onClick={() => goPage(d().page + 1)}>
                  Next
                </button>
              </div>
            </div>
          </Show>
        </div>

        {/* Filters — Django admin's right-hand panel */}
        <Show when={(d()?.filters ?? []).length}>
          <aside class={`${CARD} w-full lg:w-64 shrink-0 p-4`}>
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-xs font-bold uppercase tracking-wider text-gray-500">Filter</h2>
              <Show when={location.search}>
                <button type="button" class="text-xs text-purple-700 hover:underline" onClick={() => go("")}>
                  Clear all
                </button>
              </Show>
            </div>
            <For each={d().filters}>
              {(f) => (
                <div class="mt-3">
                  <p class="text-xs font-semibold text-gray-700 dark:text-gray-300">By {f.title}</p>
                  <ul class="mt-1 space-y-0.5">
                    <For each={f.choices ?? []}>
                      {(c) => (
                        <li>
                          <button
                            type="button"
                            onClick={() => go(c.query_string)}
                            class={`text-left text-sm w-full rounded px-2 py-0.5 ${
                              c.selected
                                ? "bg-purple-100 text-purple-800 font-medium dark:bg-purple-900/40 dark:text-purple-200"
                                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                            }`}
                          >
                            {c.display}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </aside>
        </Show>
      </div>

      <ReasonDialog
        open={confirming()}
        title={`Run "${actionLabel()}"?`}
        confirmLabel="Run action"
        danger={/delete/i.test(action())}
        busy={busy()}
        error={actionError()}
        onCancel={() => setConfirming(false)}
        onConfirm={runAction}
      >
        On {selected().size} selected record{selected().size === 1 ? "" : "s"}.
      </ReasonDialog>
    </div>
  );
}
