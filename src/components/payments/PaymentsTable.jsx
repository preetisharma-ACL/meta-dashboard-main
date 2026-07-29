import { For, Show, createSignal, createMemo, createEffect } from "solid-js";
import RowsPerPageSelect from "../common/RowsPerPageSelect";
import {
  fmtMoney,
  fmtDate,
  methodLabel,
  DocsBadge,
  StatusBadge,
} from "./paymentsFormat";

// ─── Payments ledger table ────────────────────────────────────────────────────
// One table behind the accounts ledger, the Needs-Docs queue and the tier-1 CM
// "My Entries" list. The read-only variant is not a fork — it's this same table
// with `canManage` false, which is the ONLY thing that renders the Edit/Delete
// buttons. A CM therefore has no edit/delete affordance at all, and the API's
// 403 remains the backstop rather than the first line of defence.
//
// props:
//   rows()      normalized payment[] (see services/payments)
//   loading()   bool
//   canManage   accounts/admin → row actions
//   onEdit(row) / onDelete(row)
//   emptyHint   copy for the empty state
//   pageSize    initial rows per page (default 20)

const TH =
  "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 whitespace-nowrap";
const TD = "px-4 py-3 text-sm text-[#14233A] dark:text-gray-200 align-middle";

export default function PaymentsTable(props) {
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(props.pageSize ?? 20);

  const all = () => props.rows?.() ?? [];
  const total = () => all().length;

  // Filters upstream can shrink the set under the current page — snap back so
  // the operator never lands on a blank page after narrowing a search.
  createEffect(() => {
    const maxPage = Math.max(1, Math.ceil(total() / pageSize()));
    if (page() > maxPage) setPage(maxPage);
  });

  const paged = createMemo(() => {
    const start = (page() - 1) * pageSize();
    return all().slice(start, start + pageSize());
  });

  const rangeStart = () => (total() === 0 ? 0 : (page() - 1) * pageSize() + 1);
  const rangeEnd = () => Math.min(page() * pageSize(), total());
  const pageCount = () => Math.max(1, Math.ceil(total() / pageSize()));

  const colCount = () => (props.canManage ? 10 : 9);

  return (
    <div>
      <div class="overflow-x-auto rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
        <table class="w-full min-w-[1000px]">
          <thead class="bg-[#F6F9FC] dark:bg-gray-900/60 border-b border-[#E2E8F1] dark:border-gray-700">
            <tr>
              <th class={TH + " text-left"}>Client</th>
              <th class={TH + " text-right"}>Base</th>
              <th class={TH + " text-right"}>GST</th>
              <th class={TH + " text-right"}>Final</th>
              <th class={TH + " text-left"}>Method</th>
              <th class={TH + " text-center"}>Status</th>
              <th class={TH + " text-center"}>Docs</th>
              <th class={TH + " text-left"}>Date</th>
              <th class={TH + " text-left"}>Recorded by</th>
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
            <Show when={!props.loading?.() && total() === 0}>
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
              <For each={paged()}>
                {(p) => (
                  <tr class="hover:bg-[#F6F9FC] dark:hover:bg-gray-900/40 transition-colors">
                    <td class={TD}>
                      <span class="font-semibold">
                        {p.clientName ??
                          (p.clientNomen != null
                            ? `Client #${p.clientNomen}`
                            : "—")}
                      </span>
                      <Show when={p.project}>
                        <span class="block text-xs text-[#8593A8] dark:text-gray-500">
                          {p.project}
                        </span>
                      </Show>
                    </td>

                    <td class={TD + " text-right tabular-nums"}>
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

                    <td class={TD + " text-right tabular-nums"}>
                      {fmtMoney(p.gstAmount, 2)}
                      <Show when={p.gstPct != null}>
                        <span class="block text-[11px] text-[#8593A8] dark:text-gray-500">
                          @ {p.gstPct}%
                        </span>
                      </Show>
                    </td>

                    <td
                      class={
                        TD +
                        " text-right tabular-nums font-bold text-[#15966A] dark:text-green-300"
                      }
                    >
                      {fmtMoney(p.finalAmount, 0)}
                    </td>

                    <td class={TD}>{methodLabel(p.method)}</td>

                    <td class={TD + " text-center"}>
                      <StatusBadge value={p.status} />
                    </td>

                    <td class={TD + " text-center"}>
                      <DocsBadge value={p.docsStatus} />
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

                    <td class={TD}>
                      <span class="text-[#54657E] dark:text-gray-400">
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
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Show when={!props.loading?.() && total() > 0}>
        <div class="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div class="flex items-center gap-3">
            <p class="text-sm text-[#54657E] dark:text-gray-400">
              Showing{" "}
              <b class="text-[#14233A] dark:text-gray-200">
                {rangeStart()}–{rangeEnd()}
              </b>{" "}
              of {total()}
            </p>
            <RowsPerPageSelect
              value={pageSize()}
              onChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </div>

          <Show when={pageCount() > 1}>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page() === 1}
                class="px-3 h-9 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                Previous
              </button>
              <span class="text-sm text-[#54657E] dark:text-gray-400 tabular-nums px-1">
                {page()} / {pageCount()}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount(), p + 1))}
                disabled={page() === pageCount()}
                class="px-3 h-9 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                Next
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
