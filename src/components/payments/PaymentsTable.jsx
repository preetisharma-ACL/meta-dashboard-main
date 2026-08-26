import { For, Show, createSignal, createMemo } from "solid-js";
import RowsPerPageSelect from "../common/RowsPerPageSelect";
import Avatar from "../common/Avatar";
import {
  fmtMoney,
  fmtDate,
  methodLabel,
  moneyTone,
  DocsBadge,
} from "./paymentsFormat";

// ─── Payments ledger table ────────────────────────────────────────────────────
// One table behind the accounts ledger, the Needs-Docs queue and the tier-1 CM
// "My Entries" list. The read-only variant is not a fork — it's this same table
// with `canManage` false, which is the ONLY thing that renders the Edit/Delete
// buttons. A CM therefore has no edit/delete affordance at all, and the API's
// 403 remains the backstop rather than the first line of defence.
//
// PAGINATION IS CONTROLLED AND SERVER-SIDE. This component no longer slices
// rows: `rows()` IS one page as the server returned it, and every count comes
// from meta.pagination. The previous version paginated a single fetched page
// client-side, which is what produced "20 of 20" on a 264-row ledger.
//
// STATUS COLUMN — there is exactly one, and it shows DOCS status. The API also
// returns `status`/`status_label` (payment settlement: pending/succeeded), but
// that is a different question from "has accounts filed the paperwork", and
// showing both made an accounts entry read as "pending" when only its
// settlement was. This dashboard is the docs workflow, so it shows the docs
// axis. (statusLabel is still on the normalized row if it's ever wanted.)
//
// props:
//   rows() / loading()          current page + load state
//   canManage, onEdit, onDelete row actions (accounts/admin)
//   page(), pageSize(), total(), totalPages(), hasNext(), hasPrev()
//   onPageChange(n) / onPageSizeChange(n)
//   emptyHint

const TH =
  "px-4 py-4 text-[12.5px] font-bold uppercase tracking-wide text-[#54657E] dark:text-gray-300 whitespace-nowrap";
const TD = "px-4 py-3 text-sm text-[#14233A] dark:text-gray-200 align-middle";

// Money cells carry NO colour in their base class — the tone is appended per
// row by moneyTone(). Reusing TD here would leave two text-colour utilities on
// the same element and let stylesheet order, not intent, pick the winner.
const TD_MONEY = "px-4 py-3 text-sm align-middle text-right tabular-nums";
const TONE_NAVY = "text-[#14233A] dark:text-gray-200";
const TONE_GREEN = "text-[#15966A] dark:text-green-300";

// ── Sortable columns ──────────────────────────────────────────────────────────
// Header metadata + sort accessors only — the cells themselves stay hand-written
// below (they carry sub-lines: +TDS, @gst%, "by <who>", "Ref …"). The order here
// MUST match the order of the <td>s in the row.
//
// `num`/`date` columns open largest/newest-first; `str` columns A→Z.
// The company the payment is booked under — the serializer's organization_name,
// nothing else. It deliberately sends null for clients with no real company
// (the "NA" and "Aajneeti_Meta" placeholder orgs), and the column prints "—"
// for those. No synthetic "Organization #<id>": the row can carry an org id
// whose name was nulled on purpose, and labelling it by id would put a company
// back on a row the backend just said has none. Nor a fall back to the client
// name — the dash is the intended output.
const orgLabel = (p) => p.organizationName ?? null;

const COLUMNS = [
  {
    key: "client",
    label: "Client",
    align: "left",
    type: "str",
    get: (p) => p.clientName ?? (p.clientNomen != null ? `Client #${p.clientNomen}` : null),
  },
  {
    key: "organization",
    label: "Organization",
    align: "left",
    type: "str",
    get: orgLabel,
  },
  { key: "base", label: "Base", align: "right", type: "num", get: (p) => p.baseAmount },
  { key: "gst", label: "GST", align: "right", type: "num", get: (p) => p.gstAmount },
  { key: "final", label: "Final", align: "right", type: "num", get: (p) => p.finalAmount },
  { key: "method", label: "Method", align: "left", type: "str", get: (p) => methodLabel(p.method) },
  {
    key: "docs",
    label: "Docs status",
    align: "center",
    type: "str",
    get: (p) => p.docsStatusLabel ?? p.docsStatus,
  },
  { key: "date", label: "Date", align: "left", type: "date", get: (p) => p.paidAt },
  { key: "recordedBy", label: "Recorded by", align: "left", type: "str", get: (p) => p.createdBy },
];
const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));

const alignClass = (a) =>
  a === "right" ? " text-right" : a === "center" ? " text-center" : " text-left";

const isMissing = (v) => v === null || v === undefined || v === "";

// Comparable value, or null for "missing". Missing never coerces to 0 — a row
// with no base amount must sort to the bottom, not sit among the ₹0s.
const sortValue = (row, col) => {
  const v = col.get(row);
  if (isMissing(v)) return null;
  if (col.type === "num") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (col.type === "date") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return String(v).toLowerCase();
};

export default function PaymentsTable(props) {
  const rows = () => props.rows?.() ?? [];
  const page = () => props.page?.() ?? 1;
  const pageSize = () => props.pageSize?.() ?? 20;
  // null total = the server didn't send meta.pagination. Say "unknown" rather
  // than substituting the row count, which is the bug this replaced.
  const total = () => props.total?.() ?? null;
  const totalPages = () => {
    const tp = props.totalPages?.();
    if (tp != null) return tp;
    const t = total();
    return t != null ? Math.max(1, Math.ceil(t / pageSize())) : null;
  };
  const hasNext = () =>
    props.hasNext?.() ??
    (totalPages() != null ? page() < totalPages() : rows().length >= pageSize());
  const hasPrev = () => props.hasPrev?.() ?? page() > 1;

  const rangeStart = () =>
    rows().length === 0 ? 0 : (page() - 1) * pageSize() + 1;
  const rangeEnd = () => rangeStart() === 0 ? 0 : rangeStart() + rows().length - 1;

  // Derived, not counted by hand — the skeleton and the empty-state colSpan
  // silently went wrong every time a column was added.
  const colCount = () => COLUMNS.length + (props.canManage ? 1 : 0);

  // ── Sorting ───────────────────────────────────────────────────────────────
  // SCOPE: this reorders THE CURRENT PAGE ONLY. `rows()` is one server slice —
  // the service sends no ordering param, so there is nothing here that could
  // reorder the other 200-odd rows sitting on later pages. Rather than let that
  // read as a whole-ledger sort, the default is the server's own order and an
  // explicit "this page only" note appears the moment a sort is on.
  //
  // Click a header to sort, again to reverse, a third time to restore the
  // server order.
  const [sortKey, setSortKey] = createSignal(null);
  const [sortDir, setSortDir] = createSignal("asc");

  const toggleSort = (key) => {
    const primary = COL[key].type === "str" ? "asc" : "desc";
    const secondary = primary === "asc" ? "desc" : "asc";
    if (sortKey() !== key) {
      setSortKey(key);
      setSortDir(primary);
    } else if (sortDir() === primary) {
      setSortDir(secondary);
    } else {
      setSortKey(null); // third click → back to server order
      setSortDir("asc");
    }
  };

  const sortedRows = createMemo(() => {
    const list = rows();
    const key = sortKey();
    if (!key) return list; // server order
    const col = COL[key];
    const dir = sortDir() === "asc" ? 1 : -1;
    // Missing values pin to the bottom in BOTH directions, so reversing a sort
    // never floats a row of "—" to the top.
    return [...list].sort((a, b) => {
      const va = sortValue(a, col);
      const vb = sortValue(b, col);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  });

  // Only worth saying when there ARE other pages to be wrong about.
  const sortIsPartial = () =>
    sortKey() !== null && total() != null && total() > rows().length;

  return (
    <div>
      <div class="overflow-x-auto rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
        <table class="w-full min-w-[1100px]">
          <thead class="bg-[#E8EEF6] dark:bg-gray-900/80 border-b border-[#D3DDEA] dark:border-gray-700">
            <tr>
              <For each={COLUMNS}>
                {(col) => (
                  <th
                    class={TH + alignClass(col.align)}
                    aria-sort={
                      sortKey() === col.key
                        ? sortDir() === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      title={`Sort by ${col.label} (this page)`}
                      class="inline-flex items-center uppercase tracking-wider font-bold hover:text-[#AC2334] dark:hover:text-red-300 transition-colors"
                    >
                      {col.label}
                      <Show
                        when={sortKey() === col.key}
                        fallback={
                          <span class="ml-1 text-[#C3CDDB] dark:text-gray-600">
                            ⇅
                          </span>
                        }
                      >
                        <span class="ml-1 text-[#AC2334] dark:text-red-300">
                          {sortDir() === "asc" ? "↑" : "↓"}
                        </span>
                      </Show>
                    </button>
                  </th>
                )}
              </For>
              <Show when={props.canManage}>
                <th class={TH + " text-right"}>Actions</th>
              </Show>
            </tr>
          </thead>

          <tbody class="divide-y divide-[#E2E8F1] dark:divide-gray-700">
            {/* Loading skeleton */}
            <Show when={props.loading?.()}>
              <For each={Array.from({ length: 6 })}>
                {() => (
                  <tr>
                    <For each={Array.from({ length: colCount() })}>
                      {() => (
                        <td class={TD}>
                          <span class="inline-block h-4 w-full max-w-[110px] bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </Show>

            {/* Empty */}
            <Show when={!props.loading?.() && rows().length === 0}>
              <tr>
                <td colSpan={colCount()} class="px-4 py-14 text-center">
                  <p class="text-sm font-semibold text-[#54657E] dark:text-gray-300">
                    No payments to show
                  </p>
                  <p class="mt-1 text-sm text-[#8593A8] dark:text-gray-500">
                    {props.emptyHint ?? "Nothing has been recorded yet."}
                  </p>
                </td>
              </tr>
            </Show>

            {/* Rows */}
            <Show when={!props.loading?.()}>
              <For each={sortedRows()}>
                {(p) => {
                  // One read, shared by the avatar and the label, so the
                  // initials can never disagree with the name beside them.
                  const clientLabel =
                    p.clientName ??
                    (p.clientNomen != null ? `Client #${p.clientNomen}` : null);
                  return (
                  <tr class="hover:bg-[#F6F9FC] dark:hover:bg-gray-900/40 transition-colors">
                    <td class={TD}>
                      <div class="flex items-center gap-3">
                        {/* An unattributed row gets a neutral placeholder, not
                            a coloured avatar for a client that isn't there. */}
                        <Show
                          when={clientLabel}
                          fallback={
                            <span class="w-8 h-8 flex-shrink-0 rounded-full bg-[#E2E8F1] dark:bg-gray-700 grid place-items-center text-xs font-bold text-[#8593A8] dark:text-gray-500">
                              —
                            </span>
                          }
                        >
                          <Avatar name={clientLabel} />
                        </Show>
                        <div class="min-w-0">
                          <span
                            class="font-semibold block truncate max-w-[200px]"
                            title={clientLabel ?? undefined}
                          >
                            {clientLabel ?? "—"}
                          </span>
                          {/* The organization moved out to its own column —
                              printing it here too would just be the same string
                              twice on one row. */}
                          <Show when={p.project}>
                            <span class="block text-xs text-[#8593A8] dark:text-gray-500 truncate max-w-[200px]">
                              {p.project}
                            </span>
                          </Show>
                        </div>
                      </div>
                    </td>

                    <td class={TD}>
                      <Show
                        when={orgLabel(p)}
                        fallback={
                          <span class="text-[#8593A8] dark:text-gray-500">—</span>
                        }
                      >
                        <span
                          class="block truncate max-w-[180px]"
                          title={orgLabel(p)}
                        >
                          {orgLabel(p)}
                        </span>
                      </Show>
                    </td>

                    <td class={TD_MONEY + " " + moneyTone(p.baseAmount, TONE_NAVY)}>
                      {fmtMoney(p.baseAmount, 2)}
                      <Show when={p.tdsApplied}>
                        <span
                          class="block text-[11px] font-semibold text-[#B07A14] dark:text-yellow-300"
                          title="TDS was added back before GST"
                        >
                          +TDS {fmtMoney(p.tdsAmount, 2)}
                        </span>
                      </Show>
                    </td>

                    <td class={TD_MONEY + " " + moneyTone(p.gstAmount, TONE_NAVY)}>
                      {fmtMoney(p.gstAmount, 2)}
                      <Show when={p.gstPct != null}>
                        <span class="block text-[11px] text-[#8593A8] dark:text-gray-500">
                          @ {p.gstPct}%
                        </span>
                      </Show>
                    </td>

                    {/* Green only when money actually came IN. A negative final
                        is a reversal and reads red. */}
                    <td
                      class={
                        TD_MONEY +
                        " font-bold " +
                        moneyTone(p.finalAmount, TONE_GREEN)
                      }
                    >
                      {fmtMoney(p.finalAmount, 0)}
                    </td>

                    <td class={TD}>{methodLabel(p.method)}</td>

                    <td class={TD + " text-center"}>
                      <DocsBadge
                        value={p.docsStatus}
                        label={p.docsStatusLabel}
                      />
                      {/* Who cleared the paperwork — only meaningful once it's
                          actually complete. */}
                      <Show when={p.completedBy}>
                        <span
                          class="block mt-1 text-[11px] text-[#8593A8] dark:text-gray-500 truncate max-w-[150px]"
                          title={`Completed by ${p.completedBy}`}
                        >
                          by {p.completedBy}
                        </span>
                      </Show>
                    </td>

                    <td class={TD + " whitespace-nowrap"}>
                      {fmtDate(p.paidAt)}
                      <Show when={p.referenceId}>
                        <span
                          class="block text-[11px] text-[#8593A8] dark:text-gray-500 truncate max-w-[140px]"
                          title={p.referenceId}
                        >
                          Ref {p.referenceId}
                        </span>
                      </Show>
                    </td>

                    {/* created_by_name only — never the created_by id. A null
                        here is a genuinely unattributed historical row. */}
                    <td class={TD}>
                      <span
                        class="text-[#54657E] dark:text-gray-400 truncate block max-w-[180px]"
                        title={p.createdBy ?? undefined}
                      >
                        {p.createdBy ?? "—"}
                      </span>
                    </td>

                    <Show when={props.canManage}>
                      <td class={TD + " text-right whitespace-nowrap"}>
                        <div class="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => props.onEdit?.(p)}
                            class="px-3 py-1.5 rounded-lg text-xs font-bold text-[#14233A] dark:text-gray-200 border border-[#E2E8F1] dark:border-gray-700 hover:bg-white dark:hover:bg-gray-800 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => props.onDelete?.(p)}
                            aria-label="Delete payment"
                            class="px-2.5 py-1.5 rounded-lg text-xs font-bold text-[#AC2334] dark:text-red-300 border border-[#AC2334]/25 hover:bg-[#FBEEF0] dark:hover:bg-red-900/30 transition-colors"
                          >
                            <svg
                              class="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </Show>
                  </tr>
                  );
                }}
              </For>
            </Show>
          </tbody>
        </table>
      </div>

      {/* ── Paginator (server-driven) ──────────────────────────────────────── */}
      <Show when={!props.loading?.() && rows().length > 0}>
        <div class="mt-5 mb-4 flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-3">
            <span class="text-sm text-[#8593A8] dark:text-gray-400">
              Showing {rangeStart()}–{rangeEnd()} of{" "}
              <Show when={total() != null} fallback={<>many</>}>
                {total()}
              </Show>{" "}
              results
            </span>
            <RowsPerPageSelect
              value={pageSize()}
              onChange={(n) => props.onPageSizeChange?.(n)}
            />
            {/* The ledger is server-paginated, so a header click can only
                reorder the slice in hand. Say so rather than let it read as a
                whole-ledger sort — clearing it restores the server order. */}
            <Show when={sortIsPartial()}>
              <button
                type="button"
                onClick={() => {
                  setSortKey(null);
                  setSortDir("asc");
                }}
                title="Clear the sort and restore the server order"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-[#8A6410] dark:text-yellow-200 bg-[#FBF3E2] dark:bg-yellow-900/15 border border-[#B07A14]/30 hover:bg-[#F7E9C9] dark:hover:bg-yellow-900/25 transition-colors"
              >
                Sorted within this page only
                <span class="text-[#B07A14] dark:text-yellow-300">✕</span>
              </button>
            </Show>
          </div>

          <Show when={hasNext() || hasPrev()}>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={() => props.onPageChange?.(Math.max(1, page() - 1))}
                disabled={!hasPrev()}
                class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-200 hover:bg-[#F6F9FC] disabled:opacity-35 disabled:cursor-default transition-colors"
              >
                <svg
                  class="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  stroke-width="1.8"
                >
                  <path d="M10 12L6 8l4-4" />
                </svg>
                Prev
              </button>
              <span class="text-sm text-[#8593A8] dark:text-gray-400 px-1">
                Page {page()}
                <Show when={totalPages() != null}> of {totalPages()}</Show>
              </span>
              <button
                type="button"
                onClick={() => props.onPageChange?.(page() + 1)}
                disabled={!hasNext()}
                class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg bg-[#AC2334] border border-[#AC2334] text-white hover:bg-[#8E1C2B] disabled:opacity-35 disabled:cursor-default transition-colors"
              >
                Next
                <svg
                  class="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  stroke-width="1.8"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
