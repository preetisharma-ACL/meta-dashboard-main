import { createSignal, createResource, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { showToast } from "../../components/common/SuccessToast";
import { errorMessage } from "../../utils/apiErrors";
import { TransferStatusBadge } from "../../components/billing/payStatus";
import {
  VerifyTransferModal,
  RejectTransferModal,
} from "../../components/billing/TransferReviewModals";
import { refreshBankTransfersBadge } from "../../stores/bankTransfersBadge";
import {
  fetchBankTransfers,
  fetchProofBlobUrl,
  transferModeLabel,
  fmtRs,
  fmtPayDate,
  fmtPayDateTime,
  payNum,
  TRANSFER_STATUS_TABS,
} from "../../services/hdfcPay";

// ─── Bank transfers to verify (accounts + admin) ──────────────────────────────
// The queue where a client's reported NEFT / RTGS / IMPS / UPI payment becomes
// real money in their balance. Route-gated to admin and accounts ONLY: this is
// the one screen in the payments feature that CREDITS an account, and the
// backend 403s every other role.
//
// Nothing here is a single click. Verify opens a dialog showing what the client
// reported against the figures that will actually be credited; Reject demands a
// reason the client will read.
//
// The proof file is AUTHENTICATED (prod answers 401 without a token), so "View
// proof" fetches it with the header, makes a blob URL and opens that. An
// <a href> or an <img src> straight at proof_url would show the browser a 401.

const SECTION =
  "rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm";

const TH =
  "px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider " +
  "text-[#8593A8] dark:text-gray-400 whitespace-nowrap";

const TD = "px-4 py-3 text-sm text-[#14233A] dark:text-gray-100 align-top";

export default function BankTransfers() {
  const [status, setStatus] = createSignal("pending");
  const [verifyRow, setVerifyRow] = createSignal(null);
  const [rejectRow, setRejectRow] = createSignal(null);
  const [proofBusy, setProofBusy] = createSignal(null);
  const [pageError, setPageError] = createSignal(null);
  // A verify can come back with data.warning (for example: this credits more
  // than the client reported). Amber, and it stays until the next action rather
  // than flashing past in a toast.
  const [warning, setWarning] = createSignal(null);

  const [rows, { refetch }] = createResource(status, (s) =>
    fetchBankTransfers({ status: s }),
  );

  const list = () => (rows.error ? [] : rows()) ?? [];

  const afterReview = (res, verb) => {
    setVerifyRow(null);
    setRejectRow(null);
    setWarning(res?.warning ?? null);
    showToast(
      verb === "verified"
        ? "The amount has been credited to the client's balance."
        : "The client will see the reason on their billing page.",
      verb === "verified" ? "Transfer verified" : "Transfer rejected",
    );
    refetch();
    // The sidebar count is the only thing telling anyone this queue has work in
    // it, so it is corrected immediately rather than at the next 60 s poll.
    refreshBankTransfersBadge();
  };

  const openProof = async (row) => {
    setProofBusy(row.id);
    setPageError(null);
    let url = null;
    try {
      url = await fetchProofBlobUrl(row);
      if (!url) return;
      const win = window.open(url, "_blank", "noopener");
      if (!win)
        setPageError(
          "The proof opened in a blocked tab. Allow pop-ups for this site and try again.",
        );
    } catch (err) {
      setPageError(errorMessage(err, "The proof file could not be opened."));
    } finally {
      setProofBusy(null);
      // Revoked on a delay rather than immediately: the new tab has to finish
      // reading the blob first, and revoking straight away gives it a blank
      // page. The URL dies with the session either way.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Client Billing
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Bank transfers to verify
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            Payments clients made by NEFT, RTGS, IMPS or UPI and reported here.
            Nothing is credited until you verify it against the bank statement.
          </p>
        </div>

        <div class="flex items-center gap-3">
          <A
            href="/billing/bank-details"
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6" />
            </svg>
            Bank details
          </A>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={rows.loading}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] disabled:opacity-60 transition-colors"
          >
            {rows.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ════════ TABS ════════ */}
      <div class="mb-5 inline-flex items-center gap-1 bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-600 rounded-full p-1">
        <For each={TRANSFER_STATUS_TABS}>
          {(t) => (
            <button
              type="button"
              onClick={() => {
                setStatus(t.value);
                setWarning(null);
                setPageError(null);
              }}
              aria-pressed={status() === t.value}
              class={
                "px-4 py-1.5 rounded-full text-xs font-bold transition-colors " +
                (status() === t.value
                  ? "bg-[#14233A] text-white"
                  : "text-[#54657E] dark:text-gray-300 hover:text-[#14233A] dark:hover:text-gray-100")
              }
            >
              {t.label}
            </button>
          )}
        </For>
      </div>

      <Show when={warning()}>
        <div
          role="alert"
          class="mb-4 rounded-xl border border-[#B07A14]/30 bg-[#FBF3E2] dark:bg-yellow-900/20 dark:border-yellow-800 px-4 py-3 text-sm font-semibold text-[#B07A14] dark:text-yellow-300"
        >
          {warning()}
        </div>
      </Show>

      <Show when={pageError()}>
        <div
          role="alert"
          class="mb-4 rounded-xl border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
        >
          {pageError()}
        </div>
      </Show>

      {/* ════════ TABLE ════════ */}
      <div class={`${SECTION} overflow-hidden`}>
        <Show
          when={!rows.loading}
          fallback={
            <p class="px-5 py-8 text-sm text-[#54657E] dark:text-gray-400">
              Loading transfers…
            </p>
          }
        >
          <Show when={rows.error}>
            <p class="px-5 py-8 text-sm font-medium text-[#AC2334] dark:text-red-300">
              {errorMessage(rows.error, "The transfers could not be loaded.")}
            </p>
          </Show>

          <Show when={!rows.error}>
            <Show
              when={list().length > 0}
              fallback={
                <p class="px-5 py-10 text-center text-sm text-[#54657E] dark:text-gray-400">
                  {status() === "pending"
                    ? "Nothing is waiting to be verified."
                    : `No ${status()} transfers.`}
                </p>
              }
            >
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead class="bg-[#F8FAFC] dark:bg-gray-900/40">
                    <tr>
                      <th class={TH}>Client</th>
                      <th class={TH}>UTR</th>
                      <th class={TH}>Paid via</th>
                      <th class={TH}>Transfer date</th>
                      <th class={`${TH} text-right`}>Amount</th>
                      <th class={`${TH} text-right`}>TDS</th>
                      <th class={`${TH} text-right`}>Credited</th>
                      <th class={TH}>Submitted by</th>
                      <th class={TH}>Submitted</th>
                      <th class={`${TH} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-[#E2E8F1] dark:divide-gray-700">
                    <For each={list()}>
                      {(row) => (
                        <tr class="hover:bg-[#F8FAFC] dark:hover:bg-gray-700/40 transition-colors">
                          <td class={`${TD} font-semibold`}>
                            {row.client || "—"}
                            <Show when={String(row.note ?? "").trim()}>
                              <span
                                class="block mt-0.5 text-xs font-normal text-[#8593A8] dark:text-gray-400 max-w-[14rem] truncate"
                                title={row.note}
                              >
                                {row.note}
                              </span>
                            </Show>
                          </td>
                          <td class={`${TD} font-mono text-xs break-all`}>
                            {row.utr || "—"}
                          </td>
                          <td class={`${TD} whitespace-nowrap`}>
                            {transferModeLabel(row)}
                          </td>
                          <td class={`${TD} whitespace-nowrap`}>
                            {fmtPayDate(row.transfer_date)}
                          </td>
                          <td class={`${TD} text-right tabular-nums font-semibold`}>
                            {fmtRs(row.amount_transferred, 2)}
                          </td>
                          <td class={`${TD} text-right tabular-nums`}>
                            {/* A genuine 0% is meaningful and prints as "0%";
                                an absent tds_pct prints a dash. */}
                            {payNum(row.tds_pct) === null
                              ? "—"
                              : `${payNum(row.tds_pct)}%`}
                          </td>
                          <td class={`${TD} text-right tabular-nums`}>
                            {fmtRs(row.credited, 2)}
                          </td>
                          <td class={`${TD} whitespace-nowrap`}>
                            {row.submitted_by || "—"}
                          </td>
                          <td class={`${TD} whitespace-nowrap`}>
                            {fmtPayDateTime(row.created_at)}
                          </td>
                          <td class={`${TD} text-right whitespace-nowrap`}>
                            <div class="inline-flex items-center gap-2">
                              <Show when={row.proof_url}>
                                <button
                                  type="button"
                                  onClick={() => openProof(row)}
                                  disabled={proofBusy() === row.id}
                                  class="px-2.5 py-1.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-xs font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                                >
                                  {proofBusy() === row.id
                                    ? "Opening…"
                                    : "View proof"}
                                </button>
                              </Show>

                              <Show
                                when={
                                  String(row.status ?? "").toLowerCase() ===
                                  "pending"
                                }
                                fallback={<TransferStatusBadge transfer={row} />}
                              >
                                <button
                                  type="button"
                                  onClick={() => setVerifyRow(row)}
                                  class="px-2.5 py-1.5 rounded-lg bg-[#15966A] text-white text-xs font-bold hover:bg-[#0f7a55] transition-colors"
                                >
                                  Verify
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRejectRow(row)}
                                  class="px-2.5 py-1.5 rounded-lg border border-[#AC2334]/30 text-xs font-semibold text-[#AC2334] dark:text-red-300 hover:bg-[#FBEEF0] dark:hover:bg-red-900/30 transition-colors"
                                >
                                  Reject
                                </button>
                              </Show>
                            </div>

                            {/* Why it was rejected, visible on the row that was
                                rejected, so the desk can answer a client who
                                rings up about it. */}
                            <Show when={String(row.review_note ?? "").trim()}>
                              <p class="mt-1.5 text-[11px] leading-snug text-[#8593A8] dark:text-gray-400 max-w-[16rem] ml-auto text-right">
                                {row.review_note}
                              </p>
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

      <VerifyTransferModal
        open={!!verifyRow()}
        row={verifyRow()}
        onClose={() => setVerifyRow(null)}
        onDone={(res) => afterReview(res, "verified")}
      />
      <RejectTransferModal
        open={!!rejectRow()}
        row={rejectRow()}
        onClose={() => setRejectRow(null)}
        onDone={(res) => afterReview(res, "rejected")}
      />
    </section>
  );
}
