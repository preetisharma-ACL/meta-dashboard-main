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
  useDialog,
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

// ── Table cell styles ──
// border-separate (set on the table) keeps cell borders attached to sticky
// cells; collapsed borders scroll away from them.
const TH =
  "sticky top-0 z-20 p-3 text-left whitespace-nowrap font-semibold bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700";
const TD =
  "p-3 whitespace-nowrap text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 group-hover:bg-purple-50 dark:group-hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800";
const PIN_TH = "sticky z-30";
const PIN_TD = "sticky z-10";
const EDGE = "shadow-[1px_0_0_#E5E7EB] dark:shadow-[1px_0_0_#374151]";

// ── Filters ──
// A filter is "active" when a choice other than its leading "All" is selected.
const isAll = (c, i) => i === 0 && /^all$/i.test(String(c.display ?? "").trim());
export const activeChoice = (f) => (f.choices ?? []).find((c, i) => c.selected && !isAll(c, i)) ?? null;

// One filter: collapsible, searchable past 10 choices, scrolls past a max
// height, and its selected choice is always visible — in the header when
// collapsed, pinned first when a search would otherwise hide it.
function FilterGroup(props) {
  const choices = () => props.f.choices ?? [];
  const many = () => choices().length > 10;
  const active = () => activeChoice(props.f);
  const [open, setOpen] = createSignal(!many());
  const [q, setQ] = createSignal("");
  const shown = () => {
    const t = q().trim().toLowerCase();
    if (!t) return choices();
    const hits = choices().filter((c) => String(c.display).toLowerCase().includes(t));
    return active() && !hits.includes(active()) ? [active(), ...hits] : hits;
  };
  const id = `flt-${String(props.f.title).replace(/\W+/g, "-")}`;
  return (
    <div class="border-t first:border-t-0 border-gray-100 dark:border-gray-800 py-2">
      <button
        type="button"
        aria-expanded={open()}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        class="flex w-full min-h-[40px] items-center justify-between gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
      >
        <span class="min-w-0">
          <span class="block text-xs font-semibold text-gray-700 dark:text-gray-300">By {props.f.title}</span>
          <Show when={active()}>
            <span class="block truncate text-xs text-purple-700 dark:text-purple-300" title={active().display}>
              {active().display}
            </span>
          </Show>
        </span>
        <span class="shrink-0 text-xs text-gray-400" aria-hidden="true">
          {open() ? "▴" : "▾"} {choices().length}
        </span>
      </button>
      <Show when={open()}>
        <div id={id}>
          <Show when={many()}>
            <input
              type="search"
              value={q()}
              onInput={(e) => setQ(e.target.value)}
              placeholder={`Search ${props.f.title}…`}
              aria-label={`Search ${props.f.title} filter`}
              class={`${INPUT} mt-1`}
            />
          </Show>
          <ul class="mt-1 max-h-64 overflow-y-auto space-y-0.5 pr-1">
            <For each={shown()} fallback={<li class="px-2 py-1 text-xs text-gray-400">No match.</li>}>
              {(c) => (
                <li>
                  <button
                    type="button"
                    aria-pressed={!!c.selected}
                    onClick={() => props.go(c.query_string)}
                    title={c.display}
                    class={`block w-full truncate text-left text-sm rounded px-2 py-2 lg:py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
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
      </Show>
    </div>
  );
}

function FilterPanel(props) {
  return (
    <>
      <div class="flex items-center justify-between mb-1">
        <h2 class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Filter</h2>
        <Show when={props.canClear}>
          <button
            type="button"
            class="min-h-[32px] px-1 text-xs text-purple-700 dark:text-purple-300 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            onClick={() => props.go("")}
          >
            Clear all
          </button>
        </Show>
      </div>
      <For each={props.filters}>{(f) => <FilterGroup f={f} go={props.go} />}</For>
    </>
  );
}

// Below lg the panel opens as a right-hand drawer.
function FilterDrawer(props) {
  let box;
  useDialog(() => props.open, () => props.onClose(), () => box);
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[60] flex justify-end bg-black/40 lg:hidden" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div
          ref={box}
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          class="h-full w-[min(22rem,100%)] overflow-y-auto bg-white dark:bg-gray-900 p-4 shadow-xl"
        >
          <div class="mb-2 flex justify-end">
            <button type="button" class={BTN} onClick={props.onClose}>
              Close
            </button>
          </div>
          {props.children}
        </div>
      </div>
    </Show>
  );
}

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
  // Reading a Solid resource while it is errored throws; meta is secondary
  // (actions, perms, title), so a failure just leaves those out.
  const m = () => (meta.error ? null : meta());
  const perms = () => m()?.perms ?? {};
  const actions = createMemo(() => normaliseActions(m()?.actions));
  const title = () => {
    const t = String(m()?.verbose_name_plural ?? m()?.verbose_name ?? d()?.verbose_name_plural ?? params.model);
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

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
      <span class="ml-1 text-purple-600 dark:text-purple-300">
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

  const filters = () => d()?.filters ?? [];
  const activeFilters = () => filters().filter((f) => activeChoice(f)).length;
  const [drawer, setDrawer] = createSignal(false);
  const ariaSort = (c) => {
    const o = order().find((x) => x.i === Number(c.sort_index));
    return o ? (o.desc ? "descending" : "ascending") : undefined;
  };

  const changeHref = (pk) => `${base()}/${encodeURIComponent(pk)}/change`;
  const hasActions = () => actions().length > 0;
  const colCount = () => (d()?.columns?.length ?? 0) + (hasActions() ? 1 : 0);

  return (
    <div class="min-h-screen min-w-0 overflow-x-clip p-3 lg:p-8">
      <PageHead
        crumbs={
          <>
            <A href="/control/data" class="inline-block py-3 sm:py-0 hover:underline">Data Console</A> › {params.app}
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
              <form onSubmit={submitSearch} role="search" class="flex gap-2 flex-1 min-w-[14rem]">
                <input
                  type="search"
                  aria-label={`Search ${title()}`}
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
            <Show when={filters().length}>
              <button
                type="button"
                class={`${BTN} lg:hidden`}
                aria-haspopup="dialog"
                aria-expanded={drawer()}
                onClick={() => setDrawer(true)}
              >
                Filters
                <Show when={activeFilters() > 0}>
                  <span class="rounded-full bg-purple-600 px-1.5 text-[11px] font-semibold text-white">{activeFilters()}</span>
                </Show>
              </button>
            </Show>
            <Show when={hasActions()}>
              <div class="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Bulk action"
                  value={action()}
                  onChange={(e) => setAction(e.target.value)}
                  class={INPUT.replace("w-full", "w-auto max-w-full")}
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
                <span class="text-xs text-gray-500 dark:text-gray-400">{selected().size} selected</span>
              </div>
            </Show>
          </div>
          <Show when={d()?.search && d()?.search_help}>
            <p class="-mt-1 mb-3 text-xs text-gray-500 dark:text-gray-400">{d().search_help}</p>
          </Show>

          {/* Table — its own scroll area (both axes), so the header row can
              stick to its top and the record-link column to its left while the
              rest scrolls. Sticky cells need OPAQUE backgrounds, hover included,
              or the scrolled columns show through. */}
          <div class={`${CARD} overflow-auto max-h-[calc(100dvh-11rem)] min-h-[10rem]`}>
            <table class="min-w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr class="text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider">
                  <Show when={hasActions()}>
                    <th class={`${TH} ${PIN_TH} left-0 w-12 min-w-[3rem] !p-0`}>
                      <label class="flex h-10 w-12 items-center justify-center cursor-pointer">
                        <input type="checkbox" checked={allOnPage()} onChange={toggleAll} aria-label="Select all on page" />
                      </label>
                    </th>
                  </Show>
                  <For each={d()?.columns ?? []}>
                    {(c, i) => (
                      <th
                        class={`${TH} ${i() === 0 ? `${PIN_TH} ${hasActions() ? "left-12" : "left-0"} ${EDGE}` : ""}`}
                        aria-sort={ariaSort(c)}
                      >
                        <Show when={c.sortable === true && c.sort_index != null} fallback={c.label}>
                          <button
                            type="button"
                            onClick={() => sortBy(Number(c.sort_index))}
                            class="inline-flex items-center uppercase tracking-wider rounded hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
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
                        <td colspan={Math.max(colCount(), 1)} class="p-8 text-center text-gray-500 dark:text-gray-400">
                          {list.error ? "Couldn't load records." : location.search ? "No records match these filters." : "No records."}
                        </td>
                      </tr>
                    }
                  >
                    {(r) => (
                      <tr class="group">
                        <Show when={hasActions()}>
                          <td class={`${TD} ${PIN_TD} left-0 w-12 min-w-[3rem] !p-0`}>
                            <label class="flex h-10 w-12 items-center justify-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selected().has(r.pk)}
                                onChange={() => toggle(r.pk)}
                                aria-label={`Select ${r.str ?? r.pk}`}
                              />
                            </label>
                          </td>
                        </Show>
                        <For each={d().columns}>
                          {(c, i) => (
                            <td class={`${TD} ${i() === 0 ? `${PIN_TD} ${hasActions() ? "left-12" : "left-0"} ${EDGE}` : ""}`}>
                              {/* First column opens the record, as list_display_links does.
                                  Long text cuts off at 22rem; the full value is on hover. */}
                              <span class="block max-w-[22rem] truncate" title={showValue(i() === 0 ? (r.cells?.[c.name] ?? r.str ?? r.pk) : r.cells?.[c.name])}>
                                <Show when={i() === 0} fallback={<Cell value={r.cells?.[c.name]} />}>
                                  <A href={changeHref(r.pk)} class="font-medium text-purple-700 dark:text-purple-300 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500">
                                    {showValue(r.cells?.[c.name] ?? r.str ?? r.pk)}
                                  </A>
                                </Show>
                              </span>
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
              <span class="text-sm text-gray-500 dark:text-gray-400">
                {d().count} record{d().count === 1 ? "" : "s"} · {d().per_page} per page
              </span>
              <div class="flex items-center gap-2">
                <button type="button" class={BTN} disabled={d().page <= 1} onClick={() => goPage(d().page - 1)}>
                  Prev
                </button>
                <span class="text-sm text-gray-500 dark:text-gray-400">
                  Page {d().page} of {d().pages}
                </span>
                <button type="button" class={BTN} disabled={d().page >= d().pages} onClick={() => goPage(d().page + 1)}>
                  Next
                </button>
              </div>
            </div>
          </Show>
        </div>

        {/* Filters — Django admin's right-hand panel on desktop; below lg the
            same panel lives in a drawer behind the "Filters" button. */}
        <Show when={filters().length}>
          <aside class={`${CARD} hidden lg:block w-72 shrink-0 p-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto`} aria-label="Filters">
            <FilterPanel filters={filters()} go={go} canClear={!!location.search} />
          </aside>
        </Show>
      </div>

      <FilterDrawer open={drawer()} onClose={() => setDrawer(false)}>
        <FilterPanel
          filters={filters()}
          canClear={!!location.search}
          go={(qs) => {
            setDrawer(false);
            go(qs);
          }}
        />
      </FilterDrawer>

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
