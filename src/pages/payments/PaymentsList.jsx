import { createSignal, createResource, createMemo, Show, For } from "solid-js";
import Swal from "sweetalert2";
import { A } from "@solidjs/router";

import { fetchPayments, deletePayment } from "../../services/payments";
import PaymentsTable from "../../components/payments/PaymentsTable";
import EditPaymentModal from "../../components/payments/EditPaymentModal";
import {
  fmtMoney,
  methodLabel,
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
// FILTER SPLIT, deliberately:
//   • docs_status / date_from / date_to / method / status → SERVER params, so
//     the queue is a real filtered fetch and a completed payment genuinely
//     leaves it on refetch.
//   • the client search box → CLIENT-SIDE, because GET /payments/ exposes no
//     client-name query param. It narrows what's already loaded and says so.
//
// props: lockDocsStatus?  pins docs_status and hides the control (queue mode)
//        title / kicker / blurb / emptyHint  page copy

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

  // ── Server-side filters ───────────────────────────────────────────────────
  const [docsStatus, setDocsStatus] = createSignal(props.lockDocsStatus ?? "");
  const [dateFrom, setDateFrom] = createSignal("");
  const [dateTo, setDateTo] = createSignal("");
  const [method, setMethod] = createSignal("");
  // ── Client-side filter ────────────────────────────────────────────────────
  const [query, setQuery] = createSignal("");

  const [editing, setEditing] = createSignal(null);

  // Re-fetches whenever any SERVER filter changes (the key is a plain object;
  // Solid re-runs the fetcher on identity change, which a fresh literal gives
  // us on every signal read).
  const filterKey = createMemo(() => ({
    docsStatus: queueMode() ? props.lockDocsStatus : docsStatus(),
    dateFrom: dateFrom(),
    dateTo: dateTo(),
    method: method(),
  }));

  const [payload, { refetch, mutate }] = createResource(filterKey, fetchPayments);

  const rows = () => payload()?.rows ?? [];
  const loading = () => payload.loading;

  // Method options for the filter come from the DATA, not a hardcoded list —
  // whatever the backend actually stores is what's offered.
  const methodsSeen = createMemo(() =>
    [...new Set(rows().map((r) => r.method).filter(Boolean))].sort(),
  );

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return rows();
    return rows().filter((r) =>
      [r.clientName, r.project, r.referenceId, r.createdBy, r.notes].some((v) =>
        String(v ?? "").toLowerCase().includes(q),
      ),
    );
  });

  const pendingCount = () =>
    rows().filter((r) => String(r.docsStatus ?? "").toLowerCase() === "pending")
      .length;

  // Totals describe the FILTERED set that's actually on screen — a total that
  // silently covered rows the operator can't see would be worse than useless
  // on a money screen.
  const tiles = createMemo(() => [
    {
      label: "Payments",
      value: String(filtered().length),
      tone: "text-[#14233A] dark:text-white",
    },
    {
      label: "Total recorded",
      value: fmtMoney(sumMoney(filtered(), "finalAmount"), 0),
      tone: "text-[#15966A] dark:text-green-300",
    },
    {
      label: "Awaiting paperwork",
      value: String(
        filtered().filter(
          (r) => String(r.docsStatus ?? "").toLowerCase() === "pending",
        ).length,
      ),
      tone: "text-[#B07A14] dark:text-yellow-300",
    },
  ]);

  const hasFilters = () =>
    query().trim() !== "" ||
    dateFrom() !== "" ||
    dateTo() !== "" ||
    method() !== "" ||
    (!queueMode() && docsStatus() !== "");

  const clearFilters = () => {
    setQuery("");
    setDateFrom("");
    setDateTo("");
    setMethod("");
    if (!queueMode()) setDocsStatus("");
  };

  // Swap the saved row in place using what the SERVER returned. An amount edit
  // recomputes GST/final server-side, so patching a local copy would print a
  // stale total. If the row no longer matches the active filter (e.g. it just
  // completed inside the Needs-Docs queue), refetch so it actually leaves.
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
      mutate((prev) => ({
        ...prev,
        rows: (prev?.rows ?? []).filter((r) => r.id !== row.id),
        count: Math.max(0, (prev?.count ?? 1) - 1),
      }));
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
          <Show when={queueMode() && !loading() && rows().length > 0}>
            <span class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#FBF3E2] dark:bg-yellow-900/25 border border-[#B07A14]/25 text-sm font-bold text-[#B07A14] dark:text-yellow-300">
              {rows().length} awaiting paperwork
            </span>
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
          it as an unpaid or unbanked amount. */}
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

      {/* ════════ SUMMARY TILES ════════ */}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <For each={tiles()}>
          {(t) => (
            <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                {t.label}
              </p>
              <p class={`text-2xl font-bold mt-1.5 tracking-tight tabular-nums ${t.tone}`}>
                <Show
                  when={!loading()}
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

      {/* ════════ FILTERS ════════ */}
      <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-4 mb-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div class={queueMode() ? "lg:col-span-2" : ""}>
            <label class={labelClass}>Search</label>
            <input
              type="search"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Client, project, reference…"
              class={fieldClass}
            />
          </div>

          <Show when={!queueMode()}>
            <div>
              <label class={labelClass}>Docs status</label>
              <select
                value={docsStatus()}
                onChange={(e) => setDocsStatus(e.currentTarget.value)}
                class={fieldClass}
              >
                <option value="">All</option>
                <option value="pending">Needs docs</option>
                <option value="complete">Complete</option>
              </select>
            </div>
          </Show>

          <div>
            <label class={labelClass}>From</label>
            {/* onChange, not onInput: these drive a SERVER refetch, and a date
                field emits an input event per segment typed — that would fire
                a request for every partial date. */}
            <input
              type="date"
              value={dateFrom()}
              onChange={(e) => setDateFrom(e.currentTarget.value)}
              class={fieldClass}
            />
          </div>

          <div>
            <label class={labelClass}>To</label>
            <input
              type="date"
              value={dateTo()}
              onChange={(e) => setDateTo(e.currentTarget.value)}
              class={fieldClass}
            />
          </div>

          <div>
            <label class={labelClass}>Method</label>
            <select
              value={method()}
              onChange={(e) => setMethod(e.currentTarget.value)}
              class={fieldClass}
            >
              <option value="">All</option>
              <For each={methodsSeen()}>
                {(m) => <option value={m}>{methodLabel(m)}</option>}
              </For>
            </select>
          </div>
        </div>

        <Show when={hasFilters()}>
          <div class="mt-4 pt-3 border-t border-[#E2E8F1] dark:border-gray-700 flex flex-wrap items-center gap-3">
            <button
              onClick={clearFilters}
              class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold text-[#AC2334] dark:text-red-300 bg-[#FBEEF0] dark:bg-red-900/30 hover:bg-[#F7DDE1] transition-colors"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
              Clear filters
            </button>
            <Show when={query().trim()}>
              <p class="text-xs text-[#8593A8] dark:text-gray-500">
                Search narrows the {rows().length} loaded rows; the date, method
                and docs filters are applied by the server.
              </p>
            </Show>
          </div>
        </Show>
      </div>

      {/* Non-queue pages still surface the backlog, with a way to act on it. */}
      <Show when={!queueMode() && !loading() && pendingCount() > 0}>
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#B07A14]/25 bg-[#FBF3E2] dark:bg-yellow-900/15 px-4 py-3">
          <p class="text-sm font-semibold text-[#8A6410] dark:text-yellow-200">
            {pendingCount()} payment{pendingCount() === 1 ? "" : "s"} still need
            paperwork.
          </p>
          <A
            href="/payments/needs-docs"
            class="text-sm font-bold text-[#8A6410] dark:text-yellow-200 underline underline-offset-2 hover:text-[#B07A14]"
          >
            Open the queue →
          </A>
        </div>
      </Show>

      {/* ════════ TABLE ════════ */}
      <PaymentsTable
        rows={filtered}
        loading={loading}
        canManage={true}
        onEdit={setEditing}
        onDelete={handleDelete}
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
