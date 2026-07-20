import { createSignal, createResource, createMemo, For, Show } from "solid-js";

import { fetchSalesPayments } from "../../services/sales";

// ─── Money helpers (match CoordinationDashboard) ──────────────────────────────
const toNum = (v) => parseFloat(v ?? 0) || 0;
const fmtINR0 = (v) => `₹${Math.round(toNum(v)).toLocaleString("en-IN")}`;
const fmtINR = (v) => {
  const n = toNum(v);
  const abs = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}₹${abs}`;
};
const fmtNum = (v) => (Number(v) || 0).toLocaleString("en-IN");

const TYPE_BADGE = {
  cpl: "bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/40 dark:text-blue-300",
  hybrid: "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300",
  retainer: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
};
const typeBadge = (t) =>
  TYPE_BADGE[String(t || "").toLowerCase()] ??
  "bg-[#F1F4F9] text-[#54657E] dark:bg-gray-700 dark:text-gray-300";

const StatusBadge = (props) => {
  const tone =
    props.status === "owes"
      ? "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300"
      : props.status === "low"
        ? "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300"
        : "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300";
  const dot =
    props.status === "owes"
      ? "bg-[#AC2334]"
      : props.status === "low"
        ? "bg-[#B07A14]"
        : "bg-[#15966A]";
  const label =
    props.status === "owes" ? "Owes" : props.status === "low" ? "Low" : "Healthy";
  return (
    <span
      class={
        "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wide rounded-full " +
        tone
      }
    >
      <span class={"w-1.5 h-1.5 rounded-full " + dot}></span>
      {label}
    </span>
  );
};

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function SalesPayments() {
  const [month, setMonth] = createSignal(currentMonthStr());
  const [refreshing, setRefreshing] = createSignal(false);

  // Resource keyed on month → switching months refetches automatically (cached,
  // no refresh param). The Refresh button calls refetch(true); the fetcher reads
  // info.refetching to append refresh=1 (bypasses the server's 10-min cache).
  const [payload, { refetch }] = createResource(month, async (m, info) => {
    const refresh = info?.refetching === true;
    const res = await fetchSalesPayments(m, refresh);
    return res?.data ?? {};
  });

  const totals = () => payload()?.totals ?? {};
  // Keep the server's order — debtors first. No client-side sort.
  const rows = () => payload()?.clients ?? [];
  const loading = () => payload.loading;

  const monthLabel = createMemo(() => {
    const m = payload()?.month || month();
    const [y, mo] = String(m).split("-");
    if (!y || !mo) return m;
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  });

  const handleMonthChange = (value) => {
    if (!value) return;
    if (value > currentMonthStr()) value = currentMonthStr(); // no future months
    setMonth(value);
  };

  const handleRefresh = async () => {
    if (loading() || refreshing()) return;
    setRefreshing(true);
    try {
      await refetch(true);
    } finally {
      setRefreshing(false);
    }
  };

  // Remaining tile: totals.closing_balance_inc_gst. A negative closing means the
  // book owes money — render "Owes ₹X" in crimson instead of a plain balance.
  const remaining = () => toNum(totals().closing_balance_inc_gst);
  const owes = () => remaining() < 0;

  const tiles = createMemo(() => [
    {
      label: "Received",
      value: fmtINR0(totals().received_inc_gst),
      tone: "text-[#15966A] dark:text-green-300",
    },
    {
      label: "Billed spend (incl. S.C + GST)",
      value: fmtINR0(totals().utilized_inc_gst),
      tone: "text-[#14233A] dark:text-white",
    },
    {
      label: "Remaining",
      value: owes()
        ? `Owes ${fmtINR0(Math.abs(remaining()))}`
        : fmtINR0(remaining()),
      tone: owes()
        ? "text-[#AC2334] dark:text-red-300"
        : "text-[#15966A] dark:text-green-300",
    },
  ]);

  const TILE_SKELETON = (
    <span class="inline-block h-8 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
  );

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Sales manager · Payments
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Payments Overview
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400">
            Received, billed spend and remaining balances for your clients in{" "}
            <span class="font-semibold text-[#14233A] dark:text-gray-200">
              {monthLabel()}
            </span>
            .
          </p>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <input
            type="month"
            value={month()}
            max={currentMonthStr()}
            onInput={(e) => handleMonthChange(e.currentTarget.value)}
            class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
          />
          <button
            onClick={handleRefresh}
            disabled={refreshing()}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] disabled:opacity-60 disabled:cursor-default transition-colors"
          >
            <svg
              class={"w-4 h-4 " + (refreshing() ? "animate-spin" : "")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 4v5h5M20 20v-5h-5M5.5 9a7 7 0 0112.9-2M18.5 15a7 7 0 01-12.9 2"
              />
            </svg>
            {refreshing() ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <Show when={payload.error}>
        <div class="mb-6 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300">
          Could not load payments overview. Please try again.
        </div>
      </Show>

      {/* ════════ HERO STRIP — three tiles from totals ════════ */}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
        <For each={tiles()}>
          {(t) => (
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                {t.label}
              </p>
              <p class={`text-2xl font-bold mt-1.5 tracking-tight ${t.tone}`}>
                <Show when={!loading()} fallback={TILE_SKELETON}>
                  {t.value}
                </Show>
              </p>
            </div>
          )}
        </For>
      </div>

      {/* owes / low / healthy count line */}
      <p class="text-sm text-[#54657E] dark:text-gray-400 mb-8 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          <b class="text-[#AC2334]">{totals().clients_owing ?? 0}</b> owing
        </span>
        <span>
          <b class="text-[#B07A14]">{totals().clients_low ?? 0}</b> low
        </span>
        <span>
          <b class="text-[#15966A]">{totals().clients_healthy ?? 0}</b> healthy
        </span>
        <Show when={totals().client_count != null}>
          <span class="text-[#8593A8]">· {totals().client_count} clients</span>
        </Show>
      </p>

      {/* ════════ PER-CLIENT TABLE (server order — debtors first) ════════ */}
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
            when={!loading()}
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
              <For each={rows()}>
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
                      class={
                        "px-4 py-3 text-right tabular-nums font-medium " +
                        (toNum(c.opening_balance_inc_gst) < 0
                          ? "text-[#AC2334] dark:text-red-300"
                          : "text-[#14233A] dark:text-gray-300")
                      }
                    >
                      {fmtINR(c.opening_balance_inc_gst)}
                    </td>
                    {/* Received (incl GST) */}
                    <td class="px-4 py-3 text-right tabular-nums font-medium text-[#15966A] dark:text-green-300">
                      {fmtINR(c.received_inc_gst)}
                    </td>
                    {/* Billed / utilized (incl GST) */}
                    <td class="px-4 py-3 text-right tabular-nums font-medium text-[#14233A] dark:text-gray-300">
                      {fmtINR(c.utilized_inc_gst)}
                    </td>
                    {/* Remaining / closing (incl GST) */}
                    <td
                      class={
                        "px-4 py-3 text-right tabular-nums font-medium " +
                        (toNum(c.closing_balance_inc_gst) < 0
                          ? "text-[#AC2334] dark:text-red-300"
                          : "text-[#15966A] dark:text-green-300")
                      }
                    >
                      {fmtINR(c.closing_balance_inc_gst)}
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

        <Show when={!loading() && rows().length === 0}>
          <div class="p-8 text-center">
            <p class="text-sm font-semibold text-[#14233A] dark:text-gray-300">
              No clients to show
            </p>
            <p class="mt-1 text-sm text-[#8593A8] dark:text-gray-400">
              There is no payments data for this month yet.
            </p>
          </div>
        </Show>
      </div>
    </section>
  );
}
