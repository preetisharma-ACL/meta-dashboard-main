import { createSignal, createEffect, Show } from "solid-js";
import {
  revokeAdditionalService,
  serviceLabel,
  fmtChargeDate,
  asNum,
} from "../../services/additionalServices";
import { collectFieldErrors, errorBanner } from "../../utils/apiErrors";

// ─── Revoke an additional service ─────────────────────────────────────────────
// There is no DELETE on these entries — the API exposes PATCH and revoke, and
// nothing else. A revoked entry stays on the record and stops being charged, so
// the client's balance goes back up by its inc-GST total in the month of the
// charge date.
//
// The reason is REQUIRED (422 without one). It is kept rather than prompted-and-
// discarded because this reverses money on a client's statement.
//
// Props: open, onClose(), onRevoked()?, row (the entry being revoked)

const fmtMoney = (v) => {
  const n = asNum(v);
  return n == null
    ? "—"
    : `₹${n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
};

export default function RevokeServiceModal(props) {
  const [reason, setReason] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [banner, setBanner] = createSignal(null);
  const [reasonError, setReasonError] = createSignal(null);

  createEffect(() => {
    if (!props.open) return;
    setReason("");
    setBanner(null);
    setReasonError(null);
  });

  const close = () => {
    setReason("");
    setBanner(null);
    setReasonError(null);
    props.onClose?.();
  };

  const submit = async () => {
    const text = reason().trim();
    setBanner(null);
    setReasonError(null);
    if (!text) {
      setReasonError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await revokeAdditionalService(props.row.id, text);
      close();
      props.onRevoked?.();
    } catch (err) {
      const pinned = collectFieldErrors(err);
      // The server names the field revoke_reason; the box on screen is the
      // reason, so its message belongs there rather than in a banner.
      const pinnedReason = pinned.revoke_reason ?? pinned.reason ?? null;
      if (pinnedReason) setReasonError(pinnedReason);
      if (!pinnedReason)
        setBanner(errorBanner(err, pinned, "Could not revoke this service."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={props.open && props.row}>
      <div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div
          class="fixed inset-0 bg-black/45 backdrop-blur-sm"
          aria-hidden="true"
          onClick={close}
        />
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Revoke additional service"
          class="relative w-full max-w-md rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl"
        >
          <div class="px-6 pt-5">
            <h3 class="text-lg font-bold text-[#14233A] dark:text-white">
              Revoke this service
            </h3>
            <p class="mt-1 text-sm text-[#54657E] dark:text-gray-400">
              The charge stops applying and the client's balance goes back up by
              its total.
            </p>

            <div class="mt-4 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60 px-3.5 py-3">
              <p class="text-sm font-semibold text-[#14233A] dark:text-gray-100">
                {serviceLabel(props.row)}
              </p>
              <p class="mt-0.5 text-xs text-[#54657E] dark:text-gray-400">
                {fmtChargeDate(props.row?.charge_date)} ·{" "}
                {fmtMoney(props.row?.total_inc_gst)} inc GST
              </p>
            </div>

            <Show when={banner()}>
              <div
                role="alert"
                class="mt-4 rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
              >
                {banner()}
              </div>
            </Show>

            <div class="mt-4">
              <label class="block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5">
                Reason <span class="text-[#AC2334]">*</span>
              </label>
              <textarea
                rows="3"
                value={reason()}
                onInput={(e) => {
                  setReason(e.currentTarget.value);
                  setReasonError(null);
                }}
                placeholder="Why is this charge being reversed?"
                aria-invalid={!!reasonError()}
                class={
                  "w-full px-3 py-2.5 rounded-lg border bg-white dark:bg-gray-800 " +
                  "text-[#14233A] dark:text-gray-100 resize-none outline-none transition " +
                  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] " +
                  (reasonError()
                    ? "border-[#AC2334] ring-1 ring-[#AC2334]/30"
                    : "border-[#E2E8F1] dark:border-gray-600")
                }
              />
              <Show
                when={reasonError()}
                fallback={
                  <p class="text-xs text-[#8593A8] mt-1">
                    Required. Kept on the record — the client never sees it.
                  </p>
                }
              >
                <p
                  role="alert"
                  class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                >
                  {reasonError()}
                </p>
              </Show>
            </div>
          </div>

          <div class="mt-5 px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 flex gap-3">
            <button
              onClick={close}
              class="flex-1 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1]/60 dark:hover:bg-gray-700 transition"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting() || reason().trim() === ""}
              class="flex-1 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {submitting() ? "Revoking…" : "Revoke service"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
