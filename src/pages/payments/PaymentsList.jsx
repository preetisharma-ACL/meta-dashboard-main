import {
  createSignal,
  createResource,
  createMemo,
  createEffect,
  onCleanup,
  batch,
  Show,
  For,
} from "solid-js";
import Swal from "sweetalert2";
import { A } from "@solidjs/router";

import {
  fetchPayments,
  fetchPaymentsCount,
  deletePayment,
} from "../../services/payments";
import PaymentsTable from "../../components/payments/PaymentsTable";
import EditPaymentModal from "../../components/payments/EditPaymentModal";
import MonthPicker from "../../components/sales/MonthPicker";
import {
  fmtMoney,
  PAYMENT_METHODS,
  fieldClass,
  labelClass,
} from "../../components/payments/paymentsFormat";
import { sumMoney } from "../../components/sales/salesFormat";

// ─── Payments ledger (accounts / admin) ───────────────────────────────────────
// The accounts desk's primary screen, and — with `lockDocsStatus="pending"` —
// the Needs-Docs queue too. Both are the same feed with a different server-side
// filter, so they share this component rather than forking a near-identical
// page.
//
// EVERYTHING IS SERVER-SIDE: pagination, month, client type, docs status,
// method, and the client search. Under pagination a client-side filter would
// narrow only the 20-50 rows currently in hand while the tiles claimed to
// describe all 264 — so narrowing happens where the total is computed, and the
// tiles read meta.pagination.total.
//
// props: lockDocsStatus?  pins docs_status and hides the control (queue mode)
//        title / kicker / blurb / emptyHint  page copy

const CLIENT_TYPE_OPTIONS = [
  { key: "", label: "All types" },
  { key: "cpl", label: "CPL" },
  { key: "hybrid", label: "Hybrid" },
  { key: "retainer", label: "Retainer" },
];

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// "YYYY-MM" → the first and last calendar day of that month. Day 0 of the NEXT
// month is the last day of this one, which handles 28/29/30/31 without a table.
const monthRange = (m) => {
  if (!m) return { from: "", to: "" };
  const [y, mo] = String(m).split("-").map(Number);
  if (!y || !mo) return { from: "", to: "" };
  const last = new Date(y, mo, 0).getDate();
  const p = (n) => String(n).padStart(2, "0");
  return { from: `${y}-${p(mo)}-01`, to: `${y}-${p(mo)}-${p(last)}` };
};

const toast = (icon, title, text) =>
  Swal.fire({
    icon,
    title,
    text,
    toast: true,
    position: "top-end",
    timer: icon === "error" ? 6000 : 3200,
    timerProgressBar: true,
    showConfirmButton: false,
  });

export default function PaymentsList(props) {
  const queueMode = () => !!props.lockDocsStatus;

  // ── Filters (all server-side) ─────────────────────────────────────────────
  const [docsStatus, setDocsStatus] = createSignal(props.lockDocsStatus ?? "");
  const [month, setMonth] = createSignal(""); // "" = all time
  const [clientType, setClientType] = createSignal("");
  const [method, setMethod] = createSignal("");
  const [query, setQuery] = createSignal(""); // what's in the box
  const [search, setSearch] = createSignal(""); // debounced → sent as ?client=

  // ── Pagination ────────────────────────────────────────────────────────────
  // 50 by default: 264 payments over 20-row pages is 14 pages of clicking.
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(50);

  const [editing, setEditing] = createSignal(null);

  // Debounce the search box: it drives a server request, so a fetch per
  // keystroke would be both wasteful and racy.
  let searchTimer;
  const onSearchInput = (v) => {
    setQuery(v);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      applyFilter(() => setSearch(v.trim()));
    }, 350);
  };
  onCleanup(() => clearTimeout(searchTimer));

  // Filters WITHOUT page/pageSize — shared by the list fetch and the count
  // probe, so the count tile describes the same set the table is showing.
  const baseFilters = createMemo(() => {
    const { from, to } = monthRange(month());
    return {
      docsStatus: queueMode() ? props.lockDocsStatus : docsStatus(),
      dateFrom: from,
      dateTo: to,
      method: method(),
      client: search(),
      clientType: clientType(),
    };
  });

  const listKey = createMemo(() => ({
    ...baseFilters(),
    page: page(),
    pageSize: pageSize(),
  }));

  const [payload, { refetch, mutate }] = createResource(listKey, fetchPayments);

  // True count of rows still awaiting paperwork across the WHOLE filtered set.
  // In queue mode that's just the list's own total, so the probe is skipped
  // (a `false` source tells Solid not to run the fetcher).
  const pendingKey = createMemo(() =>
    queueMode() ? false : { ...baseFilters(), docsStatus: "pending" },
  );
  const [pendingTotal] = createResource(pendingKey, fetchPaymentsCount);

  const rows = () => payload()?.rows ?? [];
  const pagination = () => payload()?.pagination ?? {};
  const loading = () => payload.loading;
  // ── Page safety ───────────────────────────────────────────────────────────
  // Any filter change invalidates the current page number — page 7 of an
  // unfiltered ledger is usually past the end of a filtered one, and the API
  // answers an out-of-range page with "Invalid page".
  //
  // The reset MUST be batched with the filter write. listKey reads both, so two
  // unbatched writes recompute it twice and fire an interim request for
  // (new filter, OLD page) — which is exactly the out-of-range combination.
  // batch() collapses them into one recompute, so only (new filter, page 1)
  // is ever requested.
  const applyFilter = (fn) =>
    batch(() => {
      fn();
      setPage(1);
    });

  // Never ask for a page outside [1, total_pages].
  const gotoPage = (n) => {
    const target = Math.max(1, Math.floor(Number(n)) || 1);
    const tp = pagination().totalPages;
    setPage(tp != null && tp >= 1 ? Math.min(target, tp) : target);
  };

  // Backstop for the case the clamp can't see: the page count SHRANK under us
  // (another operator deleted rows, or a refetch returned fewer pages). Snap
  // back to the last real page. Converges — the new page is <= tp by
  // construction, so this can't ping-pong.
  createEffect(() => {
    const tp = pagination().totalPages;
    if (tp != null && tp >= 1 && page() > tp) setPage(tp);
  });


  const total = () => pagination().total ?? null;
  const awaitingDocs = () =>
    queueMode() ? total() : (pendingTotal() ?? null);

  const fmtCount = (v) => (v == null ? "—" : String(v));

  const tiles = createMemo(() => [
    {
      label: "Payments",
      value: fmtCount(total()),
      tone: "text-[#14233A] dark:text-white",
      caption: "matching the current filters",
    },
    {
      label: "Awaiting paperwork",
      value: fmtCount(awaitingDocs()),
      tone: "text-[#B07A14] dark:text-yellow-300",
      caption: "across all pages",
      divider: true, // vertical rule before this stat (matches the billing panel)
    },
    {
      // Deliberately page-scoped and LABELLED page-scoped. There's no
      // server-side sum, and a "Total recorded" that silently covered 50 of
      // 264 rows would be exactly the kind of confident-but-wrong money figure
      // this codebase has been bitten by before.
      label: "Recorded on this page",
      value: fmtMoney(sumMoney(rows(), "finalAmount"), 0),
      tone: "text-[#15966A] dark:text-green-300",
      caption: `${rows().length} row${rows().length === 1 ? "" : "s"} shown`,
      divider: true,
    },
  ]);

  // ── Focal ratio for the summary panel ─────────────────────────────────────
  // Share of the filtered ledger that has its paperwork in. Both reads are
  // server totals for the WHOLE filtered set (not the current page), so this
  // describes every matching payment. null whenever it can't be computed
  // honestly — total/pending still loading, or nothing matches — so the donut
  // prints "—" rather than a fake 0%. NOTE the `== null` guards: Number(null)
  // is 0, so a plain isFinite check would read "loading" as "zero payments".
  const docsComplete = createMemo(() => {
    const t = total();
    const p = awaitingDocs();
    if (t == null || p == null) return null;
    return Number(t) - Number(p);
  });

  const docsCompletePct = createMemo(() => {
    const t = Number(total());
    const done = docsComplete();
    if (done == null || !Number.isFinite(t) || t <= 0) return null;
    return (done / t) * 100;
  });

  const hasFilters = () =>
    query().trim() !== "" ||
    month() !== "" ||
    clientType() !== "" ||
    method() !== "" ||
    (!queueMode() && docsStatus() !== "");

  const clearFilters = () =>
    applyFilter(() => {
      setQuery("");
      setSearch("");
      setMonth("");
      setClientType("");
      setMethod("");
      if (!queueMode()) setDocsStatus("");
    });

  // Swap the saved row in place using what the SERVER returned. An amount edit
  // recomputes GST/final server-side, so patching a local copy would print a
  // stale total. If the row no longer matches the active filter (e.g. it just
  // completed inside the Needs-Docs queue), refetch so it actually leaves and
  // the totals follow.
  const handleSaved = (updated) => {
    const activeDocs = queueMode() ? props.lockDocsStatus : docsStatus();
    setEditing(null);
    toast("success", "Payment updated", "The saved figures are now live.");

    if (!updated) {
      refetch();
      return;
    }
    const stillMatches =
      !activeDocs ||
      String(updated.docsStatus ?? "").toLowerCase() ===
        String(activeDocs).toLowerCase();

    if (!stillMatches) {
      refetch();
      return;
    }
    mutate((prev) => ({
      ...prev,
      rows: (prev?.rows ?? []).map((r) => (r.id === updated.id ? updated : r)),
    }));
  };

  const handleDelete = async (row) => {
    const { isConfirmed } = await Swal.fire({
      title: "Delete this payment?",
      html: `<div style="text-align:left;font-size:13px;line-height:1.6">
        <b>${fmtMoney(row.finalAmount, 0)}</b> for
        <b>${(row.clientName ?? `Client #${row.clientNomen}`).replace(/[<>&]/g, "")}</b>
        will be removed.<br/>
        <span style="color:#AC2334;font-size:12px">The client's received total drops by this amount. This can't be undone.</span>
      </div>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete payment",
      cancelButtonText: "Keep it",
      confirmButtonColor: "#AC2334",
    });
    if (!isConfirmed) return;

    try {
      await deletePayment(row.id);
      // Refetch rather than splice: the page is a server slice, so removing a
      // row locally would leave a short page and a total that's one too high.
      await refetch();
      toast("success", "Payment deleted", "The ledger has been updated.");
    } catch (err) {
      toast(
        "error",
        "Could not delete",
        err?.status === 403
          ? "You don't have permission to delete payments."
          : (err?.message ?? "Please try again."),
      );
    }
  };

  const loadError = () => {
    const e = payload.error;
    if (!e) return null;
    if (e.status === 403)
      return "You don't have access to the payments ledger.";
    return "Could not load payments. Please try again.";
  };

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            {props.kicker ?? "Accounts"}
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            {props.title ?? "Payments"}
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            {props.blurb ??
              "Every payment recorded across all clients. Amounts count towards the client's received total as soon as they're entered."}
          </p>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          {/* Month filter — OFF by default, so the ledger opens on everything
              rather than silently hiding all but the current month. */}
          <Show
            when={month()}
            fallback={
              <button
                onClick={() => {
                  applyFilter(() => setMonth(currentMonthStr()));
                }}
                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors"
              >
                <svg class="w-4 h-4 text-[#AC2334]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Filter by month
              </button>
            }
          >
            <div class="inline-flex items-center gap-1.5">
              <MonthPicker
                value={month()}
                max={currentMonthStr()}
                onChange={(m) => {
                  applyFilter(() => setMonth(m));
                }}
              />
              <button
                onClick={() => {
                  applyFilter(() => setMonth(""));
                }}
                aria-label="Show all months"
                title="Show all months"
                class="w-8 h-8 grid place-items-center rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-[#8593A8] hover:text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/30 transition-colors"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </Show>

          <A
            href="/payments/record"
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] transition-colors"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            Record payment
          </A>
          <button
            onClick={() => refetch()}
            disabled={loading()}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-60 transition-colors"
          >
            <svg
              class={"w-4 h-4 " + (loading() ? "animate-spin" : "")}
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
            Refresh
          </button>
        </div>
      </div>

      <Show when={loadError()}>
        <div class="mb-6 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300">
          {loadError()}
        </div>
      </Show>

      {/* Queue explainer — says what "pending" actually means, so nobody reads
          it as an unpaid or unsettled amount. */}
      <Show when={queueMode()}>
        <div class="mb-6 rounded-xl border border-[#B07A14]/25 bg-[#FBF3E2] dark:bg-yellow-900/15 px-4 py-3">
          <p class="text-sm text-[#8A6410] dark:text-yellow-200 leading-relaxed">
            These payments were entered by campaign managers and are{" "}
            <b>already counted in the client's received total</b>. They're
            listed here only because they still need a reference or invoice.
            Adding a reference marks one complete and removes it from this
            queue.
          </p>
        </div>
      </Show>

      {/* ════════ SUMMARY PANEL (focal donut + stats + backlog pill) ═══════════
          Same shape as the Client Billing summary panel: one card, a focal
          ring, divider-separated stats, and a progress band along the bottom.
          The numbers are the exact same three reads as the old tiles — only
          the presentation changed.

          The donut is HIDDEN in queue mode: there every row is pending by
          construction, so "paperwork complete" would be a permanent 0% that
          says nothing about the backlog. */}
      <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 sm:px-7 py-5 mb-6">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-4">
          {/* focal — share of the filtered ledger whose paperwork is in */}
          <Show when={!queueMode()}>
            <div class="flex items-center gap-4 sm:pr-6 sm:border-r border-[#E2E8F1] dark:border-gray-700">
              <div class="relative w-14 h-14 grid place-items-center flex-none">
                <svg viewBox="0 0 56 56" class="absolute inset-0 -rotate-90">
                  <circle cx="28" cy="28" r="25" fill="none" stroke="#D8EFE6" stroke-width="5" />
                  <circle
                    cx="28"
                    cy="28"
                    r="25"
                    fill="none"
                    stroke="#15966A"
                    stroke-width="5"
                    stroke-linecap="round"
                    stroke-dasharray={2 * Math.PI * 25}
                    stroke-dashoffset={
                      2 *
                      Math.PI *
                      25 *
                      (1 -
                        Math.max(
                          0,
                          Math.min((docsCompletePct() ?? 0) / 100, 1),
                        ))
                    }
                  />
                </svg>
                <span class="text-[15px] font-extrabold text-[#15966A] dark:text-green-300 tabular-nums">
                  <Show when={!loading()} fallback="…">
                    <Show when={docsCompletePct() !== null} fallback="—">
                      {Math.round(docsCompletePct())}%
                    </Show>
                  </Show>
                </span>
              </div>
              <div>
                <p class="text-[15px] font-extrabold text-[#14233A] dark:text-white">
                  Documented
                </p>
                <p class="text-xs text-[#54657E] dark:text-gray-400 max-w-[180px]">
                  of every payment matching these filters
                </p>
              </div>
            </div>
          </Show>

          {/* stats — same tiles(), laid out as minis */}
          <div class="flex flex-wrap gap-x-7 gap-y-3">
            <For each={tiles()}>
              {(t) => (
                <div
                  class={
                    t.divider
                      ? "sm:pl-7 sm:border-l border-[#E2E8F1] dark:border-gray-700"
                      : ""
                  }
                >
                  <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                    {t.label}
                  </p>
                  <p class={`text-xl font-bold mt-1 tabular-nums ${t.tone}`}>
                    <Show
                      when={!loading()}
                      fallback={
                        <span class="inline-block h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
                      }
                    >
                      {t.value}
                    </Show>
                  </p>
                  <p class="text-xs text-[#54657E] dark:text-gray-400">
                    {t.caption}
                  </p>
                </div>
              )}
            </For>
          </div>

          {/* A healthy-looking ledger can still hide a paperwork backlog —
              surface it, and make the pill itself the way into the queue. */}
          <Show when={!queueMode() && !loading() && (awaitingDocs() ?? 0) > 0}>
            <A
              href="/payments/needs-docs"
              class="ml-auto inline-flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#FBF3E2] dark:bg-yellow-900/15 border border-[#B07A14]/30 dark:border-yellow-800 hover:bg-[#F7E9C9] dark:hover:bg-yellow-900/25 transition-colors"
            >
              <span class="w-8 h-8 flex-none rounded-lg bg-[#B07A14] text-white grid place-items-center font-extrabold text-sm tabular-nums">
                {awaitingDocs()}
              </span>
              <span class="text-left">
                <span class="block text-[13px] font-bold text-[#8A6410] dark:text-yellow-200">
                  of {fmtCount(total())} still need paperwork
                </span>
                <span class="block text-[11.5px] font-semibold text-[#54657E] dark:text-gray-400">
                  Open the queue →
                </span>
              </span>
            </A>
          </Show>
        </div>

        {/* paperwork band — the focal ratio, drawn wide */}
        <Show when={!queueMode() && !loading() && docsCompletePct() !== null}>
          <div class="mt-5 pt-4 border-t border-[#E2E8F1] dark:border-gray-700">
            <div class="flex items-center justify-between mb-2.5">
              <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Paperwork progress
              </span>
              <span class="text-xs font-semibold text-[#54657E] dark:text-gray-400 tabular-nums">
                {fmtCount(docsComplete())} documented of {fmtCount(total())}{" "}
                payments
              </span>
            </div>
            <div class="h-1.5 rounded-full overflow-hidden bg-[#E2E8F1] dark:bg-gray-700">
              <div
                class="h-full rounded-full bg-[#15966A]"
                style={`width:${Math.max(0, Math.min(docsCompletePct(), 100))}%`}
              />
            </div>
          </div>
        </Show>
      </div>

      {/* ════════ CLIENT TYPE ════════ */}
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mr-1">
          Client type
        </span>
        <For each={CLIENT_TYPE_OPTIONS}>
          {(t) => {
            const on = () => clientType() === t.key;
            return (
              <button
                onClick={() => {
                  applyFilter(() => setClientType(t.key));
                }}
                aria-pressed={on()}
                class={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                  on()
                    ? "bg-[#14233A] text-white border-[#14233A]"
                    : "bg-white dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
                }`}
              >
                {t.label}
              </button>
            );
          }}
        </For>
      </div>

      {/* ════════ FILTERS ════════ */}
      <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-4 mb-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label class={labelClass}>Client search</label>
            <input
              type="search"
              value={query()}
              onInput={(e) => onSearchInput(e.currentTarget.value)}
              placeholder="Client name…"
              class={fieldClass}
            />
          </div>

          <Show when={!queueMode()}>
            <div>
              <label class={labelClass}>Docs status</label>
              <select
                value={docsStatus()}
                onChange={(e) => {
                  applyFilter(() => setDocsStatus(e.currentTarget.value));
                }}
                class={fieldClass}
              >
                <option value="">All</option>
                <option value="pending">Needs docs</option>
                <option value="complete">Complete</option>
              </select>
            </div>
          </Show>

          <div>
            <label class={labelClass}>Method</label>
            <select
              value={method()}
              onChange={(e) => {
                applyFilter(() => setMethod(e.currentTarget.value));
              }}
              class={fieldClass}
            >
              {/* The six PaymentMethod enum values — the same list the form
                  offers. Previously this was scraped from the current page,
                  which meant the options changed as you paged. */}
              <option value="">All</option>
              <For each={PAYMENT_METHODS}>
                {(m) => <option value={m.value}>{m.label}</option>}
              </For>
            </select>
          </div>
        </div>

        <Show when={hasFilters()}>
          <div class="mt-4 pt-3 border-t border-[#E2E8F1] dark:border-gray-700">
            <button
              onClick={clearFilters}
              class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold text-[#AC2334] dark:text-red-300 bg-[#FBEEF0] dark:bg-red-900/30 hover:bg-[#F7DDE1] transition-colors"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
              Clear filters
            </button>
          </div>
        </Show>
      </div>

      {/* The backlog callout that used to live here is now the pill inside the
          summary panel above — same count, same link into the queue. */}

      {/* ════════ TABLE ════════ */}
      <PaymentsTable
        rows={rows}
        loading={loading}
        canManage={true}
        onEdit={setEditing}
        onDelete={handleDelete}
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={() => pagination().totalPages}
        hasNext={() => pagination().hasNext}
        hasPrev={() => pagination().hasPrev}
        onPageChange={gotoPage}
        onPageSizeChange={(n) => {
          applyFilter(() => setPageSize(n));
        }}
        emptyHint={
          hasFilters()
            ? "No payments match the current filters."
            : (props.emptyHint ??
              "Payments recorded by accounts and campaign managers will appear here.")
        }
      />

      <EditPaymentModal
        payment={editing()}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />
    </section>
  );
}
