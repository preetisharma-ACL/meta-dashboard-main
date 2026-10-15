import { createSignal, createEffect, on, Show } from "solid-js";
import { deleteCreative, updateCreative } from "../../services/creatives";
import { errorMessage } from "../../utils/apiErrors";
import { FIELD, LABEL, GHOST_BTN } from "./CreativeUI";

// ─── Delete a creative (admin / coordination) ─────────────────────────────────
// Step 1: required Reason → DELETE {reason}.
//   200 {deleted, code}                     → onDeleted(code)
//   409 {needs_confirm, ads_using_code, …}  → step 2: the code is in N Meta
//       ads; "Delete anyway" resends {reason, confirm: true}, or "Deactivate
//       instead" PATCHes is_active: false (→ onDeactivated(row)).
//
// Props: open, creative, onClose(), onDeleted(code), onDeactivated(row)

const DANGER_BTN =
  "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white text-sm font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap";

// The flag may sit top-level or inside the error envelope; read both.
const confirmInfo = (err) => {
  const d = err?.data ?? {};
  if (d.needs_confirm) return d;
  if (d.error?.needs_confirm) return d.error;
  if (d.data?.needs_confirm) return d.data;
  return null;
};

export default function DeleteCreativeDialog(props) {
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [inAds, setInAds] = createSignal(null); // ads_using_code awaiting confirm

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setReason("");
        setBusy(false);
        setError("");
        setInAds(null);
      },
    ),
  );

  const fail = (err, fallback) =>
    setError(
      err?.status === 403
        ? "You don't have permission to do this."
        : errorMessage(err, fallback),
    );

  const remove = async (confirm = false) => {
    if (!reason().trim() || busy()) return;
    setBusy(true);
    setError("");
    try {
      const res = await deleteCreative(props.creative.id, {
        reason: reason().trim(),
        confirm,
      });
      props.onDeleted?.(res?.code ?? props.creative.code);
      props.onClose();
    } catch (err) {
      const info = err?.status === 409 ? confirmInfo(err) : null;
      if (info) setInAds(Number(info.ads_using_code) || 0);
      else fail(err, "Could not delete the creative.");
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      const row = await updateCreative(props.creative.id, { is_active: false });
      props.onDeactivated?.(row);
      props.onClose();
    } catch (err) {
      fail(err, "Could not deactivate the creative.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={props.open && props.creative}>
      <div
        class="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto"
        onMouseDown={(e) => e.target === e.currentTarget && !busy() && props.onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          class="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-[#E2E8F1] dark:border-gray-700"
        >
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700">
            <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
              {inAds() != null ? "Code is in use" : "Delete creative"}
            </h2>
            <button
              type="button"
              class="text-2xl leading-none text-[#8593A8] hover:text-[#AC2334]"
              onClick={() => props.onClose()}
              disabled={busy()}
            >
              ×
            </button>
          </div>

          <div class="px-6 py-5 space-y-4">
            <Show
              when={inAds() != null}
              fallback={
                <form
                  class="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    remove(false);
                  }}
                >
                  <p class="text-sm text-[#54657E] dark:text-gray-300">
                    Delete <span class="font-mono font-bold text-[#14233A] dark:text-white">{props.creative.code}</span>
                    {props.creative.title ? ` (${props.creative.title})` : ""} from the library?
                  </p>
                  <div>
                    <label class={LABEL}>Reason</label>
                    <textarea
                      class={FIELD}
                      rows={3}
                      autofocus
                      value={reason()}
                      onInput={(e) => setReason(e.target.value)}
                      placeholder="Why this creative is being deleted"
                    />
                    <p class="mt-1 text-xs text-[#8593A8] dark:text-gray-400">Required. Logged with the delete.</p>
                  </div>
                  <Show when={error()}>
                    <div class="rounded-lg border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 px-3 py-2 text-sm font-medium text-[#AC2334] dark:text-red-300">
                      {error()}
                    </div>
                  </Show>
                  <div class="flex justify-end gap-2 pt-1">
                    <button type="button" class={GHOST_BTN} onClick={() => props.onClose()} disabled={busy()}>
                      Cancel
                    </button>
                    <button type="submit" class={DANGER_BTN} disabled={!reason().trim() || busy()}>
                      {busy() ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </form>
              }
            >
              <div class="rounded-lg border border-[#D89A2B]/40 bg-[#FDF6E9] dark:bg-yellow-900/20 px-4 py-3 text-sm text-[#7A5410] dark:text-yellow-200">
                This code is used in {inAds()} Meta ad{inAds() === 1 ? "" : "s"}. Deleting it makes{" "}
                {inAds() === 1 ? "it" : "them"} show as an unknown code in Ranking. Delete anyway?
              </div>
              <Show when={error()}>
                <div class="rounded-lg border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 px-3 py-2 text-sm font-medium text-[#AC2334] dark:text-red-300">
                  {error()}
                </div>
              </Show>
              <div class="flex flex-wrap justify-end gap-2 pt-1">
                <button type="button" class={GHOST_BTN} onClick={() => props.onClose()} disabled={busy()}>
                  Cancel
                </button>
                <Show when={props.creative.is_active !== false}>
                  <button type="button" class={GHOST_BTN} onClick={deactivate} disabled={busy()}>
                    Deactivate instead
                  </button>
                </Show>
                <button type="button" class={DANGER_BTN} onClick={() => remove(true)} disabled={busy()}>
                  {busy() ? "Working…" : "Delete anyway"}
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
