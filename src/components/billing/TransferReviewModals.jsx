import { createSignal, createEffect, createMemo, For, Show } from "solid-js";
import { useDialog } from "../../utils/useDialog";
import { errorMessage, collectFieldMessages } from "../../utils/apiErrors";
import {
  verifyBankTransfer,
  rejectBankTransfer,
  rejectReasonError,
  transferModeLabel,
  wholeRupees,
  payNum,
  fmtRs,
  fmtPayDate,
  STAFF_TDS_OPTIONS,
  REJECT_REASON_MIN,
} from "../../services/hdfcPay";

// ─── Verify / reject a reported bank transfer (accounts + admin) ──────────────
// Two dialogs over one row. Both are the moment real money is added to, or
// withheld from, a client's balance, so neither has a single-click path.
//
// Props (both): open, row, onClose(), onDone()

const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 " +
  "bg-white dark:bg-gray-900 text-sm text-[#14233A] dark:text-gray-100 " +
  "focus:outline-none focus:ring-2 focus:ring-[#14233A]/20 disabled:opacity-60 transition";

const LABEL =
  "block text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5";

function Shell(props) {
  let box;
  useDialog(
    () => props.open,
    () => {
      if (!props.busy) props.onClose();
    },
    () => box,
  );

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.45)", "backdrop-filter": "blur(4px)" }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !props.busy) props.onClose();
        }}
      >
        <div
          ref={box}
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
          class="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl"
        >
          <div class="px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 flex items-start justify-between gap-3">
            <h3 class="text-base font-bold text-[#14233A] dark:text-white">
              {props.title}
            </h3>
            <button
              type="button"
              onClick={props.onClose}
              disabled={props.busy}
              aria-label="Close"
              class="w-8 h-8 shrink-0 rounded-full bg-[#F1F4F9] dark:bg-gray-700 flex items-center justify-center text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1] dark:hover:bg-gray-600 disabled:opacity-40 transition-colors"
            >
              ✕
            </button>
          </div>
          <div class="px-6 py-5 space-y-4">{props.children}</div>
        </div>
      </div>
    </Show>
  );
}

// What the client reported, so the reviewer is comparing against it rather than
// remembering it from the row behind the dialog.
function Reported(props) {
  const r = () => props.row ?? {};
  return (
    <dl class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-900/40 divide-y divide-[#E2E8F1] dark:divide-gray-700 text-sm">
      <Line label="Client" value={r().client} />
      <Line label="UTR" value={r().utr} mono />
      <Line label="Paid via" value={transferModeLabel(r())} />
      <Line label="Transfer date" value={fmtPayDate(r().transfer_date)} />
      <Line label="Amount reported" value={fmtRs(r().amount_transferred, 2)} strong />
    </dl>
  );
}

function Line(props) {
  const missing = () =>
    props.value === null || props.value === undefined || props.value === "";
  return (
    <div class="flex items-baseline justify-between gap-4 px-3.5 py-2">
      <dt class="text-[#54657E] dark:text-gray-400">{props.label}</dt>
      <dd
        class={
          "text-right tabular-nums " +
          (props.mono ? "font-mono text-xs break-all " : "") +
          (props.strong
            ? "font-bold text-[#14233A] dark:text-white"
            : "font-semibold text-[#14233A] dark:text-gray-100")
        }
      >
        {missing() ? "—" : props.value}
      </dd>
    </div>
  );
}

// ════════ VERIFY ════════
export function VerifyTransferModal(props) {
  const row = () => props.row ?? {};
  const [amount, setAmount] = createSignal("");
  const [tds, setTds] = createSignal("");
  const [note, setNote] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [fieldErrors, setFieldErrors] = createSignal({});

  // Prefilled from the row, which is the point: the reviewer confirms what the
  // client said unless the bank says otherwise.
  //
  // The amount box is prefilled with amount_EX_GST, not amount_transferred.
  // Those are different numbers (the second includes GST and is net of TDS),
  // and posting the transferred figure into an ex-GST field would re-apply GST
  // to a total that already had it. This is exactly the kind of adjacent-field
  // mix-up that reads fine and credits the wrong amount.
  createEffect(() => {
    if (!props.open) return;
    const ex = payNum(row().amount_ex_gst);
    setAmount(ex === null ? "" : String(Math.round(ex)));
    const pct = payNum(row().tds_pct);
    setTds(pct === null ? "" : String(pct));
    setNote("");
    setError(null);
    setFieldErrors({});
    setBusy(false);
  });

  // The rates the dropdown offers: the staff set (0 / 2), plus the row's OWN
  // rate when it is not one of them.
  //
  // 1% was a valid submission before backend fd948f4 removed it. Without this,
  // a transfer submitted at 1% would land on a select whose options are 0 and
  // 2, the browser would show the first one, tdsTouched() would read that as a
  // deliberate change from 1 to 0, and verifying would silently send tds_pct 0
  // and credit a different amount than the client declared. The rate is shown
  // as submitted and marked, so changing it has to be a decision.
  const tdsOptions = createMemo(() => {
    const own = payNum(row().tds_pct);
    if (own === null || STAFF_TDS_OPTIONS.includes(own))
      return STAFF_TDS_OPTIONS;
    return [...STAFF_TDS_OPTIONS, own].sort((a, b) => a - b);
  });

  const amountTouched = () => {
    const ex = payNum(row().amount_ex_gst);
    const typed = wholeRupees(amount());
    if (typed === null) return amount().trim() !== "";
    return ex === null || Math.round(ex) !== typed;
  };
  const tdsTouched = () => {
    const was = payNum(row().tds_pct);
    const now = tds() === "" ? null : Number(tds());
    return (was ?? 0) !== (now ?? 0);
  };

  const amountError = () =>
    fieldErrors().amount_ex_gst ??
    (amount().trim() !== "" && wholeRupees(amount()) === null
      ? "Enter the amount in whole rupees, or leave it as it is."
      : null);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy() || amountError()) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      // Only CHANGED figures are sent. An untouched dialog posts just the note,
      // so the server keeps its own numbers rather than being handed back a
      // rounded copy of them.
      const res = await verifyBankTransfer(row().id, {
        amountExGst: amountTouched() ? wholeRupees(amount()) : undefined,
        tdsPct: tdsTouched() ? Number(tds() || 0) : undefined,
        note: note(),
      });
      props.onDone?.(res);
    } catch (err) {
      const messages = collectFieldMessages(err);
      const flat = {};
      for (const [k, msgs] of Object.entries(messages))
        flat[k.split(".").pop()] = msgs.join(" ");
      setFieldErrors(flat);
      setError(errorMessage(err, "Could not verify this transfer."));
      setBusy(false);
    }
  };

  return (
    <Shell
      open={props.open}
      busy={busy()}
      onClose={props.onClose}
      title="Verify bank transfer"
    >
      <Reported row={row()} />

      <p class="text-xs text-[#54657E] dark:text-gray-400">
        Verifying credits the client's balance. Change the figures below only if
        the bank credited something other than what was reported.
      </p>

      <form onSubmit={submit} class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class={LABEL} for="vt-amount">
              Amount ex GST
            </label>
            <input
              id="vt-amount"
              data-autofocus
              type="text"
              inputMode="numeric"
              value={amount()}
              disabled={busy()}
              onInput={(e) => {
                const cleaned = e.currentTarget.value.replace(/[^\d]/g, "");
                e.currentTarget.value = cleaned;
                setAmount(cleaned);
              }}
              class={FIELD + (amountError() ? " border-[#AC2334]" : "")}
            />
          </div>
          <div>
            <label class={LABEL} for="vt-tds">
              TDS
            </label>
            <select
              id="vt-tds"
              value={tds()}
              disabled={busy()}
              onChange={(e) => setTds(e.currentTarget.value)}
              class={FIELD + (fieldErrors().tds_pct ? " border-[#AC2334]" : "")}
            >
              <For each={tdsOptions()}>
                {(pct) => (
                  <option value={String(pct)}>
                    {pct === 0 ? "No TDS" : `${pct}%`}
                    {STAFF_TDS_OPTIONS.includes(pct) ? "" : " (as submitted)"}
                  </option>
                )}
              </For>
            </select>
          </div>
        </div>

        <Show when={amountError() || fieldErrors().tds_pct}>
          <p role="alert" class="text-xs font-medium text-[#AC2334] dark:text-red-400">
            {amountError() ?? fieldErrors().tds_pct}
          </p>
        </Show>

        <Show when={amountTouched() || tdsTouched()}>
          <p class="text-xs font-semibold text-[#B07A14] dark:text-yellow-300">
            These differ from what the client reported. The balance will be
            credited from the figures above.
          </p>
        </Show>

        <div>
          <label class={LABEL} for="vt-note">
            Note <span class="font-normal normal-case">(optional)</span>
          </label>
          <input
            id="vt-note"
            type="text"
            value={note()}
            disabled={busy()}
            onInput={(e) => setNote(e.currentTarget.value)}
            class={FIELD}
          />
        </div>

        <Show when={error()}>
          <div
            role="alert"
            class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
          >
            {error()}
          </div>
        </Show>

        <div class="flex gap-2">
          <button
            type="submit"
            disabled={busy() || !!amountError()}
            class="flex-1 py-2.5 rounded-lg bg-[#15966A] text-white text-sm font-bold hover:bg-[#0f7a55] disabled:opacity-50 transition-colors"
          >
            {busy() ? "Verifying…" : "Verify and credit"}
          </button>
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy()}
            class="px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </Shell>
  );
}

// ════════ REJECT ════════
export function RejectTransferModal(props) {
  const row = () => props.row ?? {};
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [touched, setTouched] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [fieldErrors, setFieldErrors] = createSignal({});

  createEffect(() => {
    if (!props.open) return;
    setReason("");
    setTouched(false);
    setError(null);
    setFieldErrors({});
    setBusy(false);
  });

  const localError = () => rejectReasonError(reason());
  const shownError = () =>
    fieldErrors().reason ?? (touched() ? localError() : null);

  const submit = async (e) => {
    e?.preventDefault?.();
    setTouched(true);
    if (busy() || localError()) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await rejectBankTransfer(row().id, reason());
      props.onDone?.(res);
    } catch (err) {
      const messages = collectFieldMessages(err);
      const flat = {};
      for (const [k, msgs] of Object.entries(messages))
        flat[k.split(".").pop()] = msgs.join(" ");
      setFieldErrors(flat);
      setError(errorMessage(err, "Could not reject this transfer."));
      setBusy(false);
    }
  };

  return (
    <Shell
      open={props.open}
      busy={busy()}
      onClose={props.onClose}
      title="Reject bank transfer"
    >
      <Reported row={row()} />

      <form onSubmit={submit} class="space-y-4">
        <div>
          <label class={LABEL} for="rt-reason">
            Reason <span class="text-[#AC2334]">*</span>
          </label>
          <textarea
            id="rt-reason"
            data-autofocus
            rows="3"
            placeholder="e.g. No credit found against this UTR on the bank statement."
            value={reason()}
            disabled={busy()}
            onInput={(e) => setReason(e.currentTarget.value)}
            class={FIELD + (shownError() ? " border-[#AC2334]" : "")}
          />
          {/* Said plainly, because it changes how the reason gets written. */}
          <p
            class={
              "mt-1.5 text-xs " +
              (shownError()
                ? "font-medium text-[#AC2334] dark:text-red-400"
                : "text-[#8593A8] dark:text-gray-500")
            }
            role={shownError() ? "alert" : undefined}
          >
            {shownError() ??
              `The client reads this on their billing page. At least ${REJECT_REASON_MIN} characters.`}
          </p>
        </div>

        <Show when={error()}>
          <div
            role="alert"
            class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
          >
            {error()}
          </div>
        </Show>

        <div class="flex gap-2">
          <button
            type="submit"
            disabled={busy()}
            class="flex-1 py-2.5 rounded-lg bg-[#AC2334] text-white text-sm font-bold hover:bg-[#93192a] disabled:opacity-50 transition-colors"
          >
            {busy() ? "Rejecting…" : "Reject transfer"}
          </button>
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy()}
            class="px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </Shell>
  );
}
