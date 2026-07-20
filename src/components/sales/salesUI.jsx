import { For, Show } from "solid-js";
import { fmtMoney, fmtNum, typeBadge, isNegativeMoney } from "./salesFormat";

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

// Per-client payments table (server order preserved — debtors first). Columns:
// Client · Type · Opening · Received · Billed · Remaining · Leads · Status.
// props.rows(): overview clients[]; props.loading(): bool.
export function PaymentsTable(props) {
  const cellTone = (v, negTone, posTone) =>
    "px-4 py-3 text-right tabular-nums font-medium " +
    (isNegativeMoney(v) ? negTone : posTone);

  return (
    <div class="overflow-x-auto bg-gray-50 dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
      <table class="w-full text-sm table-auto">
        <thead class="bg-[#F8FAFC] dark:bg-gray-800">
          <tr class="[&_th]:whitespace-nowrap [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:px-4 [&_th]:py-3.5 text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700">
            <th class="text-left">Client</th>
            <th class="text-center">Type</th>
            <th class="text-right">Opening</th>
            <th class="text-right">Received</th>
            <th class="text-right">Billed</th>
            <th class="text-right">Remaining</th>
            <th class="text-right">Leads</th>
            <th class="text-center">Status</th>
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
            <For each={props.rows()}>
              {(c, i) => (
                <tr
                  class={
                    "border-t border-[#E2E8F1] dark:border-gray-700 " +
                    (i() % 2 === 0
                      ? "bg-gray-50 dark:bg-gray-800"
                      : "bg-[#FAFBFD] dark:bg-gray-800")
                  }
                >
                  {/* Client */}
                  <td class="px-4 py-3">
                    <div class="font-semibold text-blue-900 dark:text-gray-100">
                      {c.client_nomen || "—"}
                    </div>
                    <Show when={c.client_email}>
                      <div class="text-xs text-[#8593A8] dark:text-gray-400">
                        {c.client_email}
                      </div>
                    </Show>
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
  );
}
