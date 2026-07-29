import { For, Show, createSignal, createMemo, createEffect, on } from "solid-js";
import {
  fmtMoney,
  fmtNum,
  typeBadge,
  isNegativeMoney,
  isMissing,
} from "./salesFormat";
import Avatar from "../common/Avatar";
import RowsPerPageSelect from "../common/RowsPerPageSelect";

// ─── Shared sales UI ──────────────────────────────────────────────────────────
// One copy of the payments table + money tiles + chips, serving SalesPayments
// (own book) and the admin SalesManagers per-manager detail. Following the
// ClientTypeFilter precedent: extract, don't fork.

// owes → red · low → amber · healthy/other → green
export function StatusBadge(props) {
  const tone = () =>
    props.status === "owes"
      ? "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300"
      : props.status === "low"
        ? "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300"
        : "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300";
  const dot = () =>
    props.status === "owes"
      ? "bg-[#AC2334]"
      : props.status === "low"
        ? "bg-[#B07A14]"
        : "bg-[#15966A]";
  const label = () =>
    props.status === "owes"
      ? "Owes"
      : props.status === "low"
        ? "Low"
        : "Healthy";
  return (
    <span
      class={
        "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wide rounded-full " +
        tone()
      }
    >
      <span class={"w-1.5 h-1.5 rounded-full " + dot()}></span>
      {label()}
    </span>
  );
}

// CM chips from campaign_managers:[{name,email,tier}]. tier_1 → "Lead" badge;
// tier_2 → plain chip. Empty / absent → a single "—" placeholder.
export function CMChips(props) {
  return (
    <Show
      when={Array.isArray(props.managers) && props.managers.length > 0}
      fallback={<span class="text-[#8593A8] dark:text-gray-500">—</span>}
    >
      <div class="flex flex-wrap gap-1.5">
        <For each={props.managers}>
          {(cm) => (
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F1F4F9] text-[#54657E] dark:bg-gray-700 dark:text-gray-200">
              {cm?.name || cm?.email || "Unknown"}
              <Show when={String(cm?.tier || "").toLowerCase() === "tier_1"}>
                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/40 dark:text-blue-300">
                  Lead
                </span>
              </Show>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

// Three-up money tiles. props.tiles(): [{label, value, tone}]; props.loading():
// bool → shows a skeleton in each tile.
export function MoneyTilesRow(props) {
  return (
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <For each={props.tiles()}>
        {(t) => (
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5">
            <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              {t.label}
            </p>
            <p class={`text-2xl font-bold mt-1.5 tracking-tight ${t.tone}`}>
              <Show
                when={!props.loading()}
                fallback={
                  <span class="inline-block h-8 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
                }
              >
                {t.value}
              </Show>
            </p>
          </div>
        )}
      </For>
    </div>
  );
}

// Column definitions for the payments table — drives both the sortable headers
// and the sort accessors. `num` columns sort largest-first on the first click;
// `str` columns A→Z. `align` mirrors the cell alignment so headers line up.
const PAY_COLUMNS = [
  { key: "client", label: "Client", align: "left", type: "str", get: (c) => c.client_nomen },
  { key: "type", label: "Type", align: "center", type: "str", get: (c) => c.client_type },
  { key: "opening", label: "Opening", align: "right", type: "num", get: (c) => c.opening_balance_inc_gst },
  { key: "received", label: "Received", align: "right", type: "num", get: (c) => c.received_inc_gst },
  { key: "billed", label: "Billed", align: "right", type: "num", get: (c) => c.utilized_inc_gst },
  { key: "remaining", label: "Remaining", align: "right", type: "num", get: (c) => c.closing_balance_inc_gst },
  { key: "leads", label: "Leads", align: "right", type: "num", get: (c) => c.total_leads },
  { key: "status", label: "Status", align: "center", type: "str", get: (c) => c.status },
];
const PAY_COL = Object.fromEntries(PAY_COLUMNS.map((c) => [c.key, c]));

// Per-client payments table. Server order (debtors first) is the DEFAULT — sort
// is opt-in: click a header to sort, click again to reverse, a third time to
// restore the server order. Columns: Client · Type · Opening · Received ·
// Billed · Remaining · Leads · Status.
//
// props.rows(): clients[]; props.loading(); props.emptyHint;
// props.storageKey — where the rows-per-page choice is remembered (one key per
// screen, so Client Payments and Sales Payments don't overwrite each other).
export function PaymentsTable(props) {
  const cellTone = (v, negTone, posTone) =>
    "px-4 py-3 text-right tabular-nums font-medium " +
    (isNegativeMoney(v) ? negTone : posTone);

  // null sortKey → preserve the server's debtors-first order.
  const [sortKey, setSortKey] = createSignal(null);
  const [sortDir, setSortDir] = createSignal("asc");

  const toggleSort = (key) => {
    const primary = PAY_COL[key].type === "num" ? "desc" : "asc";
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

  const sortIcon = (key) => {
    if (sortKey() !== key)
      return <span class="ml-1 text-[#C3CDDB] dark:text-gray-600">⇅</span>;
    return (
      <span class="ml-1 text-[#AC2334] dark:text-red-300">
        {sortDir() === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  // Missing money/leads always sort to the bottom, regardless of direction.
  const compare = (a, b, col) => {
    if (col.type === "num") {
      const na = isMissing(col.get(a)) ? null : Number(col.get(a));
      const nb = isMissing(col.get(b)) ? null : Number(col.get(b));
      if (na === null && nb === null) return 0;
      if (na === null) return 1;
      if (nb === null) return -1;
      return na - nb;
    }
    const sa = String(col.get(a) ?? "").toLowerCase();
    const sb = String(col.get(b) ?? "").toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  };

  const sortedRows = createMemo(() => {
    const rows = props.rows() ?? [];
    const key = sortKey();
    if (!key) return rows; // server order
    const col = PAY_COL[key];
    const dir = sortDir() === "asc" ? 1 : -1;
    const missingLast = (a, b) => {
      // keep "missing last" stable even when direction flips
      if (col.type === "num") {
        const ma = isMissing(col.get(a));
        const mb = isMissing(col.get(b));
        if (ma && !mb) return 1;
        if (!ma && mb) return -1;
      }
      return compare(a, b, col) * dir;
    };
    return [...rows].sort(missingLast);
  });

  // ── Pagination (client-side) ───────────────────────────────────────────────
  // Every screen that mounts this table already has the whole month in one
  // payload, so paging is a slice: no refetch, and sorting still spans all rows.
  const storageKey = () => props.storageKey ?? "salesPaymentsRowsPerPage";

  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(
    Number(localStorage.getItem(storageKey())) || 20,
  );

  const changePageSize = (size) => {
    setPageSize(size);
    localStorage.setItem(storageKey(), String(size));
    setPage(1); // the old page number can be past the end once rows grow
  };

  const totalRows = () => sortedRows().length;
  const totalPages = createMemo(() =>
    Math.max(1, Math.ceil(totalRows() / pageSize())),
  );
  // Clamped: a filter can shrink the set below the page we were on.
  const currentPage = () => Math.min(page(), totalPages());
  const rowOffset = () => (currentPage() - 1) * pageSize();

  const pagedRows = createMemo(() =>
    sortedRows().slice(rowOffset(), rowOffset() + pageSize()),
  );

  // A new month, search or filter replaces the row set → back to page 1.
  createEffect(on(() => props.rows(), () => setPage(1), { defer: true }));

  return (
    <>
    <div class="overflow-x-auto bg-gray-50 dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
      <table class="w-full text-sm table-auto">
        <thead class="bg-[#F8FAFC] dark:bg-gray-800">
          <tr class="[&_th]:whitespace-nowrap [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:px-4 [&_th]:py-3.5 text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700">
            <th class="text-center w-12">S.No</th>
            <For each={PAY_COLUMNS}>
              {(col) => (
                <th
                  class={
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                        ? "text-center"
                        : "text-left"
                  }
                >
                  <button
                    onClick={() => toggleSort(col.key)}
                    class="inline-flex items-center uppercase tracking-wider font-bold hover:text-[#AC2334] dark:hover:text-red-300 transition"
                  >
                    {col.label}
                    {sortIcon(col.key)}
                  </button>
                </th>
              )}
            </For>
          </tr>
        </thead>

        <Show
          when={!props.loading()}
          fallback={
            <tbody>
              <For each={Array(8).fill(0)}>
                {() => (
                  <tr class="border-t border-[#E2E8F1] dark:border-gray-700 animate-pulse">
                    <td class="p-3">
                      <div class="h-7 w-7 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto"></div>
                    </td>
                    <td class="p-3">
                      <div class="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    </td>
                    <td class="p-3">
                      <div class="h-4 w-14 bg-gray-200 dark:bg-gray-700 rounded mx-auto"></div>
                    </td>
                    <For each={Array(5).fill(0)}>
                      {() => (
                        <td class="p-3">
                          <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded ml-auto"></div>
                        </td>
                      )}
                    </For>
                    <td class="p-3">
                      <div class="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto"></div>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          }
        >
          <tbody>
            <For each={pagedRows()}>
              {(c, i) => (
                <tr
                  class={
                    "border-t border-[#E2E8F1] dark:border-gray-700 " +
                    (i() % 2 === 0
                      ? "bg-gray-50 dark:bg-gray-800"
                      : "bg-[#FAFBFD] dark:bg-gray-800")
                  }
                >
                  {/* S.No — keeps counting across pages */}
                  <td class="px-4 py-3 text-center">
                    <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-xs font-bold">
                      {rowOffset() + i() + 1}
                    </span>
                  </td>
                  {/* Client */}
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                      <Avatar name={c.client_nomen || c.client_email} />
                      <div class="min-w-0">
                        <div class="font-semibold text-blue-900 dark:text-gray-100 truncate">
                          {c.client_nomen || "—"}
                        </div>
                        <Show when={c.client_email}>
                          <div class="text-xs text-[#8593A8] dark:text-gray-400 truncate">
                            {c.client_email}
                          </div>
                        </Show>
                      </div>
                    </div>
                  </td>
                  {/* Type */}
                  <td class="px-4 py-3 text-center">
                    <span
                      class={`inline-block px-2.5 py-1 text-xs font-bold rounded-full uppercase tracking-wide ${typeBadge(c.client_type)}`}
                    >
                      {c.client_type || "—"}
                    </span>
                  </td>
                  {/* Opening (incl GST) */}
                  <td
                    class={cellTone(
                      c.opening_balance_inc_gst,
                      "text-[#AC2334] dark:text-red-300",
                      "text-[#14233A] dark:text-gray-300",
                    )}
                  >
                    {fmtMoney(c.opening_balance_inc_gst, 2)}
                  </td>
                  {/* Received (incl GST) */}
                  <td class="px-4 py-3 text-right tabular-nums font-medium text-[#15966A] dark:text-green-300">
                    {fmtMoney(c.received_inc_gst, 2)}
                  </td>
                  {/* Billed / utilized (incl GST) */}
                  <td class="px-4 py-3 text-right tabular-nums font-medium text-[#14233A] dark:text-gray-300">
                    {fmtMoney(c.utilized_inc_gst, 2)}
                  </td>
                  {/* Remaining / closing (incl GST) */}
                  <td
                    class={cellTone(
                      c.closing_balance_inc_gst,
                      "text-[#AC2334] dark:text-red-300",
                      "text-[#15966A] dark:text-green-300",
                    )}
                  >
                    {fmtMoney(c.closing_balance_inc_gst, 2)}
                  </td>
                  {/* Leads */}
                  <td class="px-4 py-3 text-right tabular-nums text-[#14233A] dark:text-gray-300">
                    {fmtNum(c.total_leads)}
                  </td>
                  {/* Status */}
                  <td class="px-4 py-3 text-center">
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </Show>
      </table>

      <Show when={!props.loading() && props.rows().length === 0}>
        <div class="p-8 text-center">
          <p class="text-sm font-semibold text-[#14233A] dark:text-gray-300">
            No clients to show
          </p>
          <p class="mt-1 text-sm text-[#8593A8] dark:text-gray-400">
            {props.emptyHint ?? "There is no payments data for this month yet."}
          </p>
        </div>
      </Show>
    </div>

    {/* ── Paginator ── */}
    <Show when={!props.loading() && totalRows() > 0}>
      <div class="flex items-center justify-between mt-4 flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <span class="text-sm text-[#8593A8] dark:text-gray-400">
            {`Showing ${rowOffset() + 1}–${Math.min(
              rowOffset() + pageSize(),
              totalRows(),
            )} of ${totalRows()} clients`}
          </span>

          <RowsPerPageSelect value={pageSize()} onChange={changePageSize} />
        </div>

        <Show when={totalPages() > 1}>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={() => currentPage() > 1 && setPage(currentPage() - 1)}
              disabled={currentPage() === 1}
              class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 text-[#54657E] dark:text-gray-200 hover:bg-[#F6F9FC] dark:hover:bg-gray-800 disabled:opacity-35 disabled:cursor-default transition-colors"
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
              Page {currentPage()} of {totalPages()}
            </span>

            <button
              type="button"
              onClick={() =>
                currentPage() < totalPages() && setPage(currentPage() + 1)
              }
              disabled={currentPage() >= totalPages()}
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
    </>
  );
}
