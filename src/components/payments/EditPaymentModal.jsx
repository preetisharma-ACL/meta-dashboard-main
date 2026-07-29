import { Show, createSignal, onMount, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import PaymentForm from "./PaymentForm";
import { updatePayment } from "../../services/payments";
import { fmtMoney, DocsBadge } from "./paymentsFormat";

// ─── Edit payment (accounts / admin only) ─────────────────────────────────────
// Opens over the ledger so the operator keeps their place in the list. The form
// is the SAME component as Record Payment, with canFillDocs on — which is what
// adds reference_id / invoice_url / paid_at.
//
// After a successful PATCH we hand the caller the row the SERVER returned, not
// a locally merged copy: an amount edit recomputes GST and final_amount
// server-side, so a client-side merge would print a stale total.
//
// props: payment (normalized row | null), onClose(), onSaved(updatedRow)
export default function EditPaymentModal(props) {
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal(null);

  onMount(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !submitting()) props.onClose?.();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  const handleSubmit = async (patch) => {
    // Nothing changed — close rather than firing an empty PATCH.
    if (!patch || Object.keys(patch).length === 0) {
      props.onClose?.();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updatePayment(props.payment.id, patch);
      props.onSaved?.(updated);
    } catch (err) {
      setError(
        err?.status === 403
          ? "You don't have permission to edit payments."
          : (err?.message ?? "Could not save the changes. Please retry."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // `keyed` so the form is rebuilt whenever a DIFFERENT payment is opened.
  // PaymentForm seeds its signals from props.payment once at setup, so without
  // this a row-to-row switch that never passes through null would show the
  // previous payment's values in the inputs.
  return (
    <Show when={props.payment} keyed>
      <Portal>
        <div class="fixed inset-0 z-[80] overflow-y-auto">
          <div
            class="fixed inset-0 bg-[#14233A]/50 backdrop-blur-[2px]"
            onClick={() => !submitting() && props.onClose?.()}
          />
          <div class="relative min-h-full flex items-start justify-center p-4 sm:p-6">
            <div class="relative w-full max-w-4xl rounded-2xl bg-white dark:bg-gray-900 border border-[#E2E8F1] dark:border-gray-700 shadow-2xl">
              {/* Header */}
              <div class="flex items-start justify-between gap-4 px-6 py-5 border-b border-[#E2E8F1] dark:border-gray-700">
                <div>
                  <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1">
                    Edit payment
                  </p>
                  <h2 class="text-xl font-bold text-[#14233A] dark:text-white">
                    {props.payment.clientName ??
                      `Client #${props.payment.clientNomen}`}
                  </h2>
                  <div class="mt-2 flex flex-wrap items-center gap-3">
                    <DocsBadge value={props.payment.docsStatus} />
                    <span class="text-sm text-[#54657E] dark:text-gray-400">
                      Currently recorded at{" "}
                      <b class="text-[#14233A] dark:text-gray-200 tabular-nums">
                        {fmtMoney(props.payment.finalAmount, 0)}
                      </b>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => props.onClose?.()}
                  disabled={submitting()}
                  aria-label="Close"
                  class="flex-none w-9 h-9 grid place-items-center rounded-lg text-[#8593A8] hover:text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div class="px-6 py-6">
                {/* Edit is accounts/admin-only (a CM PATCH 403s), so both
                    accounts-gated field groups are on. */}
                <PaymentForm
                  mode="edit"
                  payment={props.payment}
                  canFillDocs={true}
                  canSetStatus={true}
                  submitting={submitting()}
                  error={error()}
                  onSubmit={handleSubmit}
                  onCancel={() => props.onClose?.()}
                />
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
