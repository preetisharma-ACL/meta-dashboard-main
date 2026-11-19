import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { errorMessage, collectFieldMessages } from "../../utils/apiErrors";
import { createPayQuote, QuoteRows, TdsPicker } from "./payQuote";
import {
  bankQrSrc,
  submitBankTransfer,
  tdsChoices,
  wholeRupees,
  normaliseUtr,
  utrError,
  proofError,
  transferDateError,
  transferDateBounds,
  localDateKey,
  copyToClipboard,
  TRANSFER_MODES,
  PROOF_ACCEPT,
  BANK_MIN_EX_GST,
} from "../../services/hdfcPay";

// ─── Pay by bank transfer / UPI (client) ──────────────────────────────────────
// The offline half of the Pay modal. The client moves the money themselves and
// then REPORTS it with its UTR, so nothing here takes a payment and nothing is
// credited by submitting this form.
//
// THE COPY MATTERS MORE THAN USUAL. Every word on the success path says the
// amount is added ONCE VERIFIED. A client who reads "paid" and then sees no
// change in their balance for a day raises a ticket that accounts have to
// answer, so the screen never claims more than has happened.
//
// Props: open (the modal is on screen and this tab is selected), details (the
//        pay/bank-details/ payload), summary (pay/summary/, for tds_options),
//        onSubmitted()

const FIELD =
  "w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 " +
  "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-blue-900/30 dark:focus:ring-blue-400/30 " +
  "placeholder-gray-300 dark:placeholder-gray-600 disabled:opacity-50 transition";

const LABEL =
  "block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5";

const ERR_FIELD = "border-red-400 focus:ring-red-400/30";

export default function BankTransferPanel(props) {
  const details = () => props.details ?? {};
  const choices = createMemo(() => tdsChoices(props.summary ?? {}));
  const qrSrc = createMemo(() => bankQrSrc(details()));

  // ── Form ──
  const [amount, setAmount] = createSignal(String(BANK_MIN_EX_GST));
  const [deductTds, setDeductTds] = createSignal(false);
  const [tdsPct, setTdsPct] = createSignal(null);
  const [utr, setUtr] = createSignal("");
  const [transferDate, setTransferDate] = createSignal(localDateKey());
  const [mode, setMode] = createSignal("neft");
  const [note, setNote] = createSignal("");
  const [proof, setProof] = createSignal(null);

  const [submitting, setSubmitting] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(false);
  const [formError, setFormError] = createSignal(null);
  const [fieldErrors, setFieldErrors] = createSignal({});
  // Only show per-field complaints once the client has tried to send it, so a
  // form they have barely opened is not already covered in red.
  const [touched, setTouched] = createSignal(false);
  const [copied, setCopied] = createSignal(null);

  let fileInput;

  // Reset whenever the modal opens, so a previous submission's success panel
  // and a previous attempt's errors never greet the next one.
  createEffect(() => {
    if (!props.open) return;
    setAmount(String(BANK_MIN_EX_GST));
    setDeductTds(false);
    setTdsPct(null);
    setUtr("");
    setTransferDate(localDateKey());
    setMode("neft");
    setNote("");
    setProof(null);
    if (fileInput) fileInput.value = "";
    setSubmitting(false);
    setSubmitted(false);
    setFormError(null);
    setFieldErrors({});
    setTouched(false);
  });

  const toggleTds = (on) => {
    setDeductTds(on);
    setTdsPct(on ? (choices()[0] ?? null) : null);
  };
  const effectiveTds = () => (deductTds() ? (tdsPct() ?? 0) : 0);
  const amountValue = () => wholeRupees(amount());

  const quote = createPayQuote({
    amount: amountValue,
    tds: effectiveTds,
    // Parked while the panel is off screen or already submitted: the success
    // panel replaces the form, and quoting for a form nobody is looking at is
    // a request per keystroke for nothing.
    active: () => !!props.open && !submitted(),
  });

  // ── Local validation ──
  // Mirrors the spec so an obviously doomed submit never leaves the browser.
  // The SERVER stays the authority and its wording always wins (see submit()),
  // which is how a duplicate UTR gets explained in the backend's own words.
  const localErrors = createMemo(() => {
    const out = {};
    const amt = amountValue();
    if (amt === null) out.amount_ex_gst = "Enter the amount in whole rupees.";
    else if (amt < BANK_MIN_EX_GST)
      out.amount_ex_gst = `The minimum bank transfer is ₹${BANK_MIN_EX_GST.toLocaleString("en-IN")} excluding GST.`;
    const u = utrError(utr());
    if (u) out.utr = u;
    const d = transferDateError(transferDate());
    if (d) out.transfer_date = d;
    const p = proofError(proof());
    if (p) out.proof = p;
    return out;
  });

  // A field shows the SERVER's complaint if it sent one, otherwise ours, and
  // ours only after a submit attempt.
  const err = (key) =>
    fieldErrors()[key] ?? (touched() ? (localErrors()[key] ?? null) : null);

  const canSubmit = () =>
    !submitting() && Object.keys(localErrors()).length === 0;

  const copy = async (value, key) => {
    if (!(await copyToClipboard(value))) return;
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setTouched(true);
    if (!canSubmit()) return;
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    try {
      await submitBankTransfer({
        amountExGst: amountValue(),
        tdsPct: effectiveTds(),
        utr: utr(),
        transferDate: transferDate(),
        mode: mode(),
        note: note(),
        proof: proof(),
      });
      setSubmitted(true);
      props.onSubmitted?.();
    } catch (error) {
      // Shown EXACTLY as returned. "This UTR has already been submitted" is a
      // sentence the client can act on; anything we paraphrased it into would
      // not be.
      const messages = collectFieldMessages(error);
      const flat = {};
      for (const [key, msgs] of Object.entries(messages))
        flat[key.split(".").pop()] = msgs.join(" ");
      setFieldErrors(flat);
      setFormError(errorMessage(error, "Could not submit these details."));
      setSubmitting(false);
    }
  };

  const bounds = createMemo(() => transferDateBounds());

  return (
    <div class="space-y-5">
      {/* ════════ SUCCESS ════════
          Replaces the form entirely. Leaving the filled-in form underneath a
          success message is how the same transfer gets submitted twice and
          then rejected as a duplicate. */}
      <Show when={submitted()}>
        <div class="rounded-xl border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30 px-4 py-5 text-center">
          <span class="inline-flex w-10 h-10 rounded-full bg-green-600 text-white items-center justify-center mb-3">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <p class="text-sm font-bold text-green-900 dark:text-green-200">
            Submitted. Our accounts team will verify it shortly.
          </p>
          <p class="mt-1 text-sm text-green-800/80 dark:text-green-300/80">
            It will be added to your balance once verified.
          </p>
          <button
            type="button"
            onClick={() => {
              setSubmitted(false);
              setUtr("");
              setProof(null);
              if (fileInput) fileInput.value = "";
              setTouched(false);
            }}
            class="mt-4 text-xs font-bold uppercase tracking-wide text-green-900/70 dark:text-green-300/70 hover:text-green-900 dark:hover:text-green-200 transition-colors"
          >
            Report another transfer
          </button>
        </div>
      </Show>

      <Show when={!submitted()}>
        {/* ════════ WHERE TO SEND IT ════════ */}
        <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div class="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
            <h4 class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Our account details
            </h4>
          </div>

          <dl class="divide-y divide-gray-200 dark:divide-gray-700">
            <Detail label="Account name" value={details().account_name} />
            <Detail label="Bank" value={details().bank_name} />
            <Detail
              label="Account number"
              value={details().account_number}
              mono
              onCopy={() => copy(details().account_number, "acc")}
              copied={copied() === "acc"}
            />
            <Detail
              label="IFSC"
              value={details().ifsc}
              mono
              onCopy={() => copy(details().ifsc, "ifsc")}
              copied={copied() === "ifsc"}
            />
            <Detail label="Branch" value={details().branch} />
            <Detail
              label="UPI ID"
              value={details().upi_id}
              mono
              onCopy={() => copy(details().upi_id, "upi")}
              copied={copied() === "upi"}
            />
          </dl>

          <Show when={String(details().note ?? "").trim()}>
            <p class="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-200 dark:border-gray-700 whitespace-pre-line">
              {details().note}
            </p>
          </Show>
        </div>

        {/* ════════ QR ════════
            The uploaded image is a portrait standee, not a bare square QR, so
            it is sized by HEIGHT with object-contain. Forcing it square would
            crop the UPI id printed under the code.
            No auth header: this path is public (verified on prod), so a plain
            <img> is correct and a blob fetch would be pointless work. */}
        <Show when={qrSrc()}>
          <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
            <h4 class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
              Or scan to pay by UPI
            </h4>
            <img
              src={qrSrc()}
              alt="UPI QR code for AAJneeti Connect Ltd"
              loading="lazy"
              class="mx-auto max-h-72 w-auto object-contain rounded-lg border border-gray-100 dark:border-gray-700 bg-white"
            />
            <a
              href={qrSrc()}
              download="aajneeti-upi-qr"
              target="_blank"
              rel="noreferrer"
              class="mt-3 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
              Download QR
            </a>
          </div>
        </Show>

        {/* ════════ THE FORM ════════ */}
        <form onSubmit={submit} class="space-y-4">
          <div class="rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 px-4 py-3">
            <h4 class="text-sm font-bold text-blue-900 dark:text-blue-200">
              I have paid, submit details
            </h4>
            <p class="mt-0.5 text-xs text-blue-800/80 dark:text-blue-300/80">
              Send the money first, then tell us about it here. Your balance
              updates once accounts have verified it.
            </p>
          </div>

          {/* Amount */}
          <div>
            <label class={LABEL} for="bt-amount">
              Amount (ex GST)
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold select-none">
                ₹
              </span>
              <input
                id="bt-amount"
                type="text"
                inputMode="numeric"
                autocomplete="off"
                value={amount()}
                disabled={submitting()}
                onInput={(e) => {
                  const cleaned = e.currentTarget.value.replace(/[^\d]/g, "");
                  e.currentTarget.value = cleaned;
                  setAmount(cleaned);
                }}
                class={`${FIELD} pl-8 text-lg ${err("amount_ex_gst") ? ERR_FIELD : ""}`}
              />
            </div>
            <FieldNote
              error={err("amount_ex_gst")}
              hint={`Minimum ₹${BANK_MIN_EX_GST.toLocaleString("en-IN")} + GST`}
            />
          </div>

          <TdsPicker
            choices={choices()}
            checked={deductTds()}
            value={tdsPct()}
            disabled={submitting()}
            onToggle={toggleTds}
            onPick={setTdsPct}
          />

          {/* The breakdown. "Amount to transfer" rather than "You pay": the
              client is about to move this themselves, and nothing on this tab
              charges anybody. */}
          <Show when={quote.error()}>
            <div
              role="alert"
              class="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300"
            >
              {quote.error()}
            </div>
          </Show>
          <QuoteRows
            quote={quote}
            payableLabel="Amount to transfer"
            creditedLabel="Credited once verified"
          />

          {/* UTR */}
          <div>
            <label class={LABEL} for="bt-utr">
              UTR / transaction reference
            </label>
            <input
              id="bt-utr"
              type="text"
              autocomplete="off"
              spellcheck={false}
              placeholder="e.g. AXISR52024110712345"
              value={utr()}
              disabled={submitting()}
              // Normalised as it is typed, so what the client sees is exactly
              // what is sent. A trailing space that survived to the server
              // would come back as a validation error about a reference that
              // looks correct on screen.
              onInput={(e) => {
                const v = normaliseUtr(e.currentTarget.value);
                e.currentTarget.value = v;
                setUtr(v);
              }}
              class={`${FIELD} font-mono ${err("utr") ? ERR_FIELD : ""}`}
            />
            <FieldNote
              error={err("utr")}
              hint="10 to 40 letters or digits, from your bank statement."
            />
          </div>

          {/* Date + mode */}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class={LABEL} for="bt-date">
                Transfer date
              </label>
              <input
                id="bt-date"
                type="date"
                value={transferDate()}
                min={bounds().min}
                max={bounds().max}
                disabled={submitting()}
                onInput={(e) => setTransferDate(e.currentTarget.value)}
                class={`${FIELD} ${err("transfer_date") ? ERR_FIELD : ""}`}
              />
              <FieldNote error={err("transfer_date")} />
            </div>

            <div>
              <label class={LABEL} for="bt-mode">
                Paid via
              </label>
              <select
                id="bt-mode"
                value={mode()}
                disabled={submitting()}
                onChange={(e) => setMode(e.currentTarget.value)}
                class={`${FIELD} ${err("mode") ? ERR_FIELD : ""}`}
              >
                <For each={TRANSFER_MODES}>
                  {(m) => <option value={m.value}>{m.label}</option>}
                </For>
              </select>
              <FieldNote error={err("mode")} />
            </div>
          </div>

          {/* Proof */}
          <div>
            <label class={LABEL} for="bt-proof">
              Screenshot or receipt{" "}
              <span class="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              id="bt-proof"
              ref={fileInput}
              type="file"
              accept={PROOF_ACCEPT}
              disabled={submitting()}
              onChange={(e) => setProof(e.currentTarget.files?.[0] ?? null)}
              class={`${FIELD} file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-gray-100 dark:file:bg-gray-700 file:text-gray-700 dark:file:text-gray-200 ${
                err("proof") ? ERR_FIELD : ""
              }`}
            />
            <FieldNote
              error={err("proof")}
              hint="JPG, PNG, WEBP or PDF, up to 3 MB. It helps accounts verify faster."
            />
          </div>

          {/* Note */}
          <div>
            <label class={LABEL} for="bt-note">
              Note <span class="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              id="bt-note"
              type="text"
              placeholder="Anything accounts should know"
              value={note()}
              disabled={submitting()}
              onInput={(e) => setNote(e.currentTarget.value)}
              class={`${FIELD} ${err("note") ? ERR_FIELD : ""}`}
            />
            <FieldNote error={err("note")} />
          </div>

          <Show when={formError()}>
            <div
              role="alert"
              class="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300"
            >
              {formError()}
            </div>
          </Show>

          <button
            type="submit"
            disabled={submitting()}
            class="w-full py-3 rounded-2xl bg-blue-900 dark:bg-blue-700 text-white font-bold text-sm hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting() ? "Submitting…" : "I have paid, submit details"}
          </button>
        </form>
      </Show>
    </div>
  );
}

function Detail(props) {
  const missing = () =>
    props.value === null || props.value === undefined || props.value === "";
  return (
    <div class="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt class="text-sm text-gray-600 dark:text-gray-400 shrink-0">
        {props.label}
      </dt>
      <dd class="flex items-center gap-2 min-w-0">
        <span
          class={`text-sm text-right truncate ${
            props.mono ? "font-mono" : ""
          } font-semibold text-gray-900 dark:text-gray-100`}
        >
          {missing() ? "—" : props.value}
        </span>
        <Show when={props.onCopy && !missing()}>
          <button
            type="button"
            onClick={props.onCopy}
            aria-label={`Copy ${props.label}`}
            class="shrink-0 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {props.copied ? "Copied" : "Copy"}
          </button>
        </Show>
      </dd>
    </div>
  );
}

function FieldNote(props) {
  return (
    <Show
      when={props.error}
      fallback={
        <Show when={props.hint}>
          <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {props.hint}
          </p>
        </Show>
      }
    >
      <p
        role="alert"
        class="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400"
      >
        {props.error}
      </p>
    </Show>
  );
}
