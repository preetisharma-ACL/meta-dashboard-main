import { For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fmtPayDate, fmtRs } from "../../services/hdfcPay";
import { OrderStatusBadge } from "./payStatus";

// ─── Online payments (client) ─────────────────────────────────────────────────
// The card / UPI payments this client has started, from GET pay/orders/. Server
// order is kept as sent.
//
// This is NOT the existing Payment History block above it, and it must not read
// as a second copy of it: that one is every receipt the accounts desk has
// recorded (bank transfers, points, the opening balance), this one is only what
// went through the gateway. Hence its own heading and its own empty state.
//
// A row opens /payment-result?order_id=<id>, which is the same receipt the
// gateway returns to, so a client can reopen or reprint any payment.
//
// Props: orders (array), loading, error

export default function OnlinePaymentsTable(props) {
  const navigate = useNavigate();
  const open = (order) => {
    if (!order?.order_id) return;
    navigate(`/payment-result?order_id=${encodeURIComponent(order.order_id)}`);
  };

  return (
    <div class="rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-200/80 dark:border-gray-700 flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">
          Online payments
        </h3>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Card and UPI payments you made here
        </p>
      </div>

      <Show
        when={!props.loading}
        fallback={
          <p class="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">
            Loading your online payments…
          </p>
        }
      >
        <Show when={props.error}>
          <p class="px-5 py-6 text-sm font-medium text-red-700 dark:text-red-300">
            Your online payments could not be loaded. Please try again in a
            moment.
          </p>
        </Show>

        <Show when={!props.error}>
          <Show
            when={(props.orders ?? []).length > 0}
            fallback={
              <p class="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">
                You have not made an online payment yet.
              </p>
            }
          >
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                    <th class="px-5 py-3">Date</th>
                    <th class="px-5 py-3">Order ID</th>
                    <th class="px-5 py-3 text-right">You paid</th>
                    <th class="px-5 py-3 text-right">Credited</th>
                    <th class="px-5 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                  <For each={props.orders}>
                    {(o) => (
                      <tr
                        // Keyboard reachable as well as clickable: this row is
                        // the only way back to a receipt.
                        tabIndex={0}
                        role="button"
                        aria-label={`Open receipt for order ${o.order_id}`}
                        onClick={() => open(o)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            open(o);
                          }
                        }}
                        class="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 transition-colors"
                      >
                        <td class="px-5 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {fmtPayDate(o.created_at)}
                        </td>
                        <td class="px-5 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 break-all">
                          {o.order_id || "—"}
                        </td>
                        <td class="px-5 py-3 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                          {fmtRs(o.amount_paid, 2)}
                        </td>
                        <td class="px-5 py-3 text-right tabular-nums font-medium text-green-700 dark:text-green-300">
                          {fmtRs(o.credited, 2)}
                        </td>
                        <td class="px-5 py-3 text-center">
                          <OrderStatusBadge order={o} />
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
