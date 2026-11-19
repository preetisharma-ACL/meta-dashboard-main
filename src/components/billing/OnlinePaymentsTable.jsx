import { For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fmtPayDate, fmtRs, mergeHistory } from "../../services/hdfcPay";
import { OrderStatusBadge, TransferStatusBadge } from "./payStatus";

// ─── Payments you made here (client) ──────────────────────────────────────────
// ONE table for both ways of paying: card/UPI orders through the gateway
// (GET pay/orders/) and bank transfers the client reported (GET
// pay/bank-transfers/). They are merged newest-first by mergeHistory(), which
// normalises each source into the same row shape.
//
// EACH ROW COMES ENTIRELY FROM ONE PAYLOAD ROW. An order's amount_paid and a
// transfer's amount_transferred are different keys for different things, and a
// row assembled from both is how two adjacent columns end up describing two
// different payments. The `kind` on each row is what the renderer branches on,
// so nothing is sniffed.
//
// This is NOT the existing Payment History block above it and must not read as
// a second copy of it: that one is every receipt the accounts desk has recorded
// (bank transfers THEY keyed in, points, the opening balance), this one is only
// what the client did from this screen.
//
// Props: orders, transfers, loading, error

export default function OnlinePaymentsTable(props) {
  const navigate = useNavigate();
  const rows = () => mergeHistory(props.orders, props.transfers);

  // Only a gateway order has a receipt page. A reported transfer has nowhere to
  // go, so its row is inert rather than linking somewhere that would 404.
  const open = (row) => {
    if (row.kind !== "online" || !row.reference) return;
    navigate(`/payment-result?order_id=${encodeURIComponent(row.reference)}`);
  };

  return (
    <div class="rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-200/80 dark:border-gray-700 flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">
          Payments you made here
        </h3>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Card, UPI and bank transfers you reported
        </p>
      </div>

      <Show
        when={!props.loading}
        fallback={
          <p class="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">
            Loading your payments…
          </p>
        }
      >
        <Show when={props.error}>
          <p class="px-5 py-6 text-sm font-medium text-red-700 dark:text-red-300">
            Your payments could not be loaded. Please try again in a moment.
          </p>
        </Show>

        <Show when={!props.error}>
          <Show
            when={rows().length > 0}
            fallback={
              <p class="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">
                You have not made a payment from this page yet.
              </p>
            }
          >
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                    <th class="px-5 py-3">Date</th>
                    <th class="px-5 py-3">Reference</th>
                    <th class="px-5 py-3">Method</th>
                    <th class="px-5 py-3 text-right">You paid</th>
                    <th class="px-5 py-3 text-right">Credited</th>
                    <th class="px-5 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                  <For each={rows()}>
                    {(row) => (
                      <tr
                        tabIndex={row.kind === "online" ? 0 : undefined}
                        role={row.kind === "online" ? "button" : undefined}
                        aria-label={
                          row.kind === "online"
                            ? `Open receipt for order ${row.reference}`
                            : undefined
                        }
                        onClick={() => open(row)}
                        onKeyDown={(e) => {
                          if (row.kind !== "online") return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            open(row);
                          }
                        }}
                        class={
                          "transition-colors " +
                          (row.kind === "online"
                            ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                            : "")
                        }
                      >
                        <td class="px-5 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {fmtPayDate(row.at)}
                          {/* A reported transfer carries TWO dates: when it was
                              submitted here and when the money actually moved.
                              Accounts match on the second one, so it is shown
                              rather than hidden behind the first. */}
                          <Show
                            when={row.transferDate && row.transferDate !== row.at}
                          >
                            <span class="block text-[11px] text-gray-400 dark:text-gray-500">
                              Paid {fmtPayDate(row.transferDate)}
                            </span>
                          </Show>
                        </td>
                        <td class="px-5 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 break-all">
                          {row.reference || "—"}
                        </td>
                        <td class="px-5 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {row.method || "—"}
                        </td>
                        <td class="px-5 py-3 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                          {fmtRs(row.paid, 2)}
                        </td>
                        {/* A pending or rejected transfer has credited nothing
                            and the server sends null, which renders "—". Never
                            a 0 and never the transferred amount: both would
                            claim money that is not in the balance. */}
                        <td class="px-5 py-3 text-right tabular-nums font-medium text-green-700 dark:text-green-300">
                          {fmtRs(row.credited, 2)}
                        </td>
                        <td class="px-5 py-3 text-center">
                          <Show
                            when={row.kind === "transfer"}
                            fallback={<OrderStatusBadge order={row.raw} />}
                          >
                            <TransferStatusBadge transfer={row.raw} />
                            {/* The reason a transfer was rejected is the only
                                thing that tells the client what to do next, so
                                it sits with the chip rather than anywhere they
                                have to go looking. */}
                            <Show when={String(row.reviewNote ?? "").trim()}>
                              <p class="mt-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400 max-w-[18rem] mx-auto">
                                {row.reviewNote}
                              </p>
                            </Show>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
