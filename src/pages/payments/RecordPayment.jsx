import { createSignal, Show } from "solid-js";
import { A } from "@solidjs/router";
import Swal from "sweetalert2";

import { recordPayment } from "../../services/payments";
import PaymentForm from "../../components/payments/PaymentForm";
import {
  fmtMoney,
  fmtDate,
  methodLabel,
  DocsBadge,
} from "../../components/payments/paymentsFormat";
import { isAccountsDesk } from "../../stores/currentUser";

// ─── Record Payment (accounts + tier-1 CM) ────────────────────────────────────
// ONE page for both roles. The role only decides two things:
//   • canFillDocs — accounts see reference / invoice / date; a CM does not,
//     because accounts owns the paperwork (and a CM PATCH 403s anyway).
//   • the copy explaining what happens to the entry after it's saved.
// Everything else — the picker, the GST preview, the validation — is identical,
// which is exactly why it isn't forked.
//
// docs_status is NEVER sent: the server derives it from the caller's role
// (accounts → complete, tier-1 CM → pending). We just report what came back.

export default function RecordPayment() {
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [lastSaved, setLastSaved] = createSignal(null);

  let formApi;

  const isAccounts = () => isAccountsDesk();

  const handleSubmit = async (values) => {
    setSubmitting(true);
    setError(null);
    try {
      const saved = await recordPayment(values);
      setLastSaved(saved);
      formApi?.reset();

      Swal.fire({
        icon: "success",
        title: "Payment recorded",
        text: saved?.finalAmount
          ? `${fmtMoney(saved.finalAmount, 0)} booked for ${saved.clientName ?? "the client"}.`
          : "The payment has been saved.",
        toast: true,
        position: "top-end",
        timer: 3600,
        timerProgressBar: true,
        showConfirmButton: false,
      });

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      // A 403 here is the scoping rule doing its job — most likely a CM picked
      // (or forced) a client outside their set. Name that instead of a generic
      // failure so the operator knows it isn't a transient error.
      setError(
        err?.status === 403
          ? "You can't record a payment for that client — it's outside the clients assigned to you."
          : (err?.message ??
            "Could not record the payment. Check the values and try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            {isAccounts() ? "Accounts" : "Campaign Manager"}
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Record Payment
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            <Show
              when={isAccounts()}
              fallback="Enter the amount a client has paid. It counts towards their received total straight away — accounts will add the reference and invoice afterwards."
            >
              Enter a payment against a client. It counts towards their received
              total immediately and is filed as complete.
            </Show>
          </p>
        </div>

        <A
          href={isAccounts() ? "/payments" : "/payments/my-entries"}
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
        >
          {isAccounts() ? "View all payments" : "View my entries"}
        </A>
      </div>

      {/* ════════ LAST SAVED RECEIPT ════════
          Shows the SERVER's row, not the values that were typed — the server
          computes GST and the final amount, and this is the operator's proof of
          what was actually booked. */}
      <Show when={lastSaved()}>
        <div class="mb-6 rounded-2xl border border-[#15966A]/25 bg-[#E9F7F1] dark:bg-green-900/15 px-5 py-4">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <span class="w-9 h-9 flex-none rounded-xl bg-[#15966A] text-white grid place-items-center">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <div>
                <p class="text-sm font-bold text-[#14233A] dark:text-white">
                  Recorded {fmtMoney(lastSaved().finalAmount, 0)} for{" "}
                  {lastSaved().clientName ??
                    `Client #${lastSaved().clientNomen}`}
                </p>
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                  {methodLabel(lastSaved().method)} ·{" "}
                  {fmtDate(lastSaved().paidAt)} · GST{" "}
                  {fmtMoney(lastSaved().gstAmount, 2)}
                  <Show when={lastSaved().gstPct != null}>
                    {" "}
                    @ {lastSaved().gstPct}%
                  </Show>
                </p>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <DocsBadge value={lastSaved().docsStatus} />
              <button
                type="button"
                onClick={() => setLastSaved(null)}
                class="text-xs font-semibold text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-gray-200"
              >
                Dismiss
              </button>
            </div>
          </div>

          <Show
            when={
              String(lastSaved().docsStatus ?? "").toLowerCase() === "pending"
            }
          >
            <p class="mt-3 pt-3 border-t border-[#15966A]/20 text-xs font-medium text-[#8A6410] dark:text-yellow-200">
              The money is booked. Accounts will add the reference and invoice —
              until then it sits in their Needs-Docs queue.
            </p>
          </Show>
        </div>
      </Show>

      {/* ════════ FORM ════════ */}
      <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6">
        {/* Accounts get the paperwork fields; a tier-1 CM does not (accounts
            owns the reference, and a CM PATCH 403s anyway). add-funds accepts
            reference_id / invoice_url / paid_at as of the 655cc1e backend — it
            previously dropped them, which is why this was hard-off. They stay
            optional: an accounts entry saves as complete either way. */}
        <PaymentForm
          mode="create"
          canFillDocs={isAccounts()}
          canSetStatus={isAccounts()}
          submitting={submitting()}
          error={error()}
          onSubmit={handleSubmit}
          onReady={(api) => (formApi = api)}
        />
      </div>
    </section>
  );
}
