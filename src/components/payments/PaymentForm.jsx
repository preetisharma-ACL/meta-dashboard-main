import { createSignal, createMemo, For, Show, batch } from "solid-js";
import PaymentClientPicker from "./PaymentClientPicker";
import { computeGstPreview, GST_OPTIONS } from "./gst";
import {
  fieldClass,
  labelClass,
  fmtMoney,
  METHOD_SUGGESTIONS,
  methodLabel,
  toDateInput,
} from "./paymentsFormat";

// ─── Shared record / edit payment form ────────────────────────────────────────
// One component behind four surfaces (accounts Record, accounts Edit, tier-1 CM
// Record, and the Needs-Docs completion) so the GST preview and the validation
// rules can't drift between them. What differs is passed in, not forked:
//
//   mode        "create" | "edit"
//   canFillDocs true for accounts/admin → reveals reference_id / invoice_url /
//               paid_at. A tier-1 CM never sees these; accounts fills them, and
//               the API 403s a CM PATCH regardless.
//   payment     the existing normalized row (edit only) — prefills the inputs.
//   onSubmit    (values) => Promise. The PARENT owns the API call so this
//               component stays presentational.
//
// The preview panel is explicitly labelled as a preview: the server recomputes
// on save and the caller re-renders the returned row.

export default function PaymentForm(props) {
  const isEdit = () => props.mode === "edit";
  const existing = () => props.payment ?? null;

  // ── Field state (prefilled from the row in edit mode) ──────────────────────
  const [clientNomen, setClientNomen] = createSignal(
    existing()?.clientNomen ?? null,
  );
  const [baseAmount, setBaseAmount] = createSignal(
    existing()?.baseAmount != null ? String(existing().baseAmount) : "",
  );
  const [tdsApplied, setTdsApplied] = createSignal(!!existing()?.tdsApplied);
  const [tdsAmount, setTdsAmount] = createSignal(
    existing()?.tdsAmount != null ? String(existing().tdsAmount) : "",
  );
  const [gstPct, setGstPct] = createSignal(
    existing()?.gstPct != null ? String(existing().gstPct) : String(GST_OPTIONS[1]),
  );
  const [method, setMethod] = createSignal(existing()?.method ?? "");
  // "Other…" escape hatch — the backend's method vocabulary isn't published, so
  // an operator can always type the exact value the server expects.
  const [customMethod, setCustomMethod] = createSignal(false);
  const [project, setProject] = createSignal(existing()?.project ?? "");
  const [notes, setNotes] = createSignal(existing()?.notes ?? "");
  const [referenceId, setReferenceId] = createSignal(
    existing()?.referenceId ?? "",
  );
  const [invoiceUrl, setInvoiceUrl] = createSignal(existing()?.invoiceUrl ?? "");
  const [paidAt, setPaidAt] = createSignal(toDateInput(existing()?.paidAt));

  const [touched, setTouched] = createSignal(false);

  // Union of the suggested vocabulary and whatever methods already exist in the
  // ledger, so the picker offers real values even if our guesses are wrong.
  const methodOptions = createMemo(() => {
    const seen = new Set(
      (props.methodOptions ?? [])
        .filter(Boolean)
        .map((m) => String(m).toLowerCase()),
    );
    METHOD_SUGGESTIONS.forEach((m) => seen.add(m));
    if (method()) seen.add(String(method()).toLowerCase());
    return [...seen].sort();
  });

  // ── Live preview — mirrors Payment.save(), never transmitted ───────────────
  const preview = createMemo(() =>
    computeGstPreview({
      baseAmount: baseAmount(),
      tdsApplied: tdsApplied(),
      tdsAmount: tdsAmount(),
      gstPct: gstPct(),
    }),
  );

  // ── Validation ────────────────────────────────────────────────────────────
  const baseNum = () => {
    const n = Number(baseAmount());
    return baseAmount() !== "" && Number.isFinite(n) ? n : null;
  };
  const tdsNum = () => {
    const n = Number(tdsAmount());
    return tdsAmount() !== "" && Number.isFinite(n) ? n : null;
  };

  const errors = createMemo(() => {
    const e = {};
    if (!isEdit() && (clientNomen() === null || clientNomen() === ""))
      e.client = "Pick the client this payment is for.";
    if (baseNum() === null) e.base = "Enter the base amount.";
    else if (baseNum() <= 0) e.base = "Base amount must be greater than zero.";
    if (tdsApplied() && tdsNum() === null)
      e.tds = "Enter the TDS amount, or switch TDS off.";
    else if (tdsApplied() && tdsNum() < 0)
      e.tds = "TDS amount can't be negative.";
    if (!method()) e.method = "Select how the payment was made.";
    return e;
  });

  const isValid = () => Object.keys(errors()).length === 0;
  const show = (key) => (touched() ? errors()[key] : undefined);

  // Filling a reference on a pending payment flips docs_status server-side —
  // surface that BEFORE the operator saves, not as a surprise afterwards.
  const willCompleteDocs = () =>
    isEdit() &&
    String(existing()?.docsStatus ?? "").toLowerCase() === "pending" &&
    referenceId().trim() !== "";

  // In edit mode only send what actually changed — a true partial PATCH keeps
  // an untouched amount from triggering a needless server-side GST recompute.
  const changedEditValues = () => {
    const before = existing() ?? {};
    const out = {};
    const put = (key, next, prev) => {
      const a = next === "" ? null : next;
      const b = prev === undefined || prev === "" ? null : prev;
      if (String(a ?? "") !== String(b ?? "")) out[key] = next;
    };
    put("referenceId", referenceId().trim(), before.referenceId);
    put("invoiceUrl", invoiceUrl().trim(), before.invoiceUrl);
    put("notes", notes(), before.notes);
    put("method", method(), before.method);
    put("paidAt", paidAt(), toDateInput(before.paidAt));
    put("baseAmount", baseNum(), before.baseAmount);
    put("gstPct", Number(gstPct()), before.gstPct);
    if (tdsApplied() !== !!before.tdsApplied) out.tdsApplied = tdsApplied();
    const nextTds = tdsApplied() ? (tdsNum() ?? 0) : 0;
    if (String(nextTds) !== String(before.tdsAmount ?? 0))
      out.tdsAmount = nextTds;
    return out;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!isValid() || props.submitting) return;

    if (isEdit()) {
      props.onSubmit?.(changedEditValues());
    } else {
      props.onSubmit?.({
        clientNomen: clientNomen(),
        baseAmount: baseNum(),
        tdsApplied: tdsApplied(),
        tdsAmount: tdsApplied() ? (tdsNum() ?? 0) : 0,
        gstPct: Number(gstPct()),
        method: method(),
        project: project().trim(),
        notes: notes().trim(),
      });
    }
  };

  const resetForm = () => {
    batch(() => {
      setClientNomen(null);
      setBaseAmount("");
      setTdsApplied(false);
      setTdsAmount("");
      setGstPct(String(GST_OPTIONS[1]));
      setMethod("");
      setCustomMethod(false);
      setProject("");
      setNotes("");
      setTouched(false);
    });
  };
  // Hand the parent a handle so it can clear the form after a successful
  // create. A plain callback rather than `ref` — this isn't a DOM node, and
  // `ref` on a component carries compiler semantics we don't want here.
  props.onReady?.({ reset: resetForm });

  const previewRow = (label, value, opts = {}) => (
    <div class="flex items-baseline justify-between gap-4 py-1.5">
      <span
        class={`text-sm ${opts.strong ? "font-bold text-[#14233A] dark:text-white" : "text-[#54657E] dark:text-gray-400"}`}
      >
        {label}
      </span>
      <span
        class={`tabular-nums ${
          opts.strong
            ? "text-xl font-extrabold text-[#15966A] dark:text-green-300"
            : "text-sm font-semibold text-[#14233A] dark:text-gray-200"
        }`}
      >
        {value}
      </span>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* ════════ INPUTS ════════ */}
      <div class="lg:col-span-2 space-y-5">
        {/* Client — locked in edit mode: PATCH cannot re-book a payment
            against a different nomen. */}
        <Show
          when={!isEdit()}
          fallback={
            <div>
              <label class={labelClass}>Client</label>
              <div class="px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F6F9FC] dark:bg-gray-800 text-sm font-semibold text-[#14233A] dark:text-gray-200">
                {existing()?.clientName ??
                  (existing()?.clientNomen != null
                    ? `Client #${existing().clientNomen}`
                    : "—")}
              </div>
              <p class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-500">
                The client can't be changed on an existing payment.
              </p>
            </div>
          }
        >
          <PaymentClientPicker
            value={clientNomen()}
            onChange={setClientNomen}
            disabled={props.submitting}
            error={show("client")}
          />
        </Show>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Base amount */}
          <div>
            <label class={labelClass}>
              Base amount (₹) <span class="text-[#AC2334]">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              inputmode="decimal"
              value={baseAmount()}
              disabled={props.submitting}
              onInput={(e) => setBaseAmount(e.currentTarget.value)}
              placeholder="0.00"
              class={
                fieldClass +
                (show("base") ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
              }
            />
            <Show when={show("base")}>
              <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
                {show("base")}
              </p>
            </Show>
          </div>

          {/* GST slab */}
          <div>
            <label class={labelClass}>
              GST % <span class="text-[#AC2334]">*</span>
            </label>
            <select
              value={gstPct()}
              disabled={props.submitting}
              onChange={(e) => setGstPct(e.currentTarget.value)}
              class={fieldClass}
            >
              <For each={GST_OPTIONS}>
                {(g) => <option value={String(g)}>{g}%</option>}
              </For>
            </select>
          </div>
        </div>

        {/* TDS toggle + amount */}
        <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-[#F6F9FC] dark:bg-gray-800/60 p-4">
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={tdsApplied()}
              disabled={props.submitting}
              onChange={(e) => setTdsApplied(e.currentTarget.checked)}
              class="mt-0.5 w-4 h-4 rounded border-[#E2E8F1] text-[#14233A] focus:ring-[#14233A]/30"
            />
            <span>
              <span class="block text-sm font-bold text-[#14233A] dark:text-gray-100">
                TDS deducted by the client
              </span>
              <span class="block text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                Adds the TDS back before GST — the client's invoice value is the
                base plus the tax they withheld.
              </span>
            </span>
          </label>

          <Show when={tdsApplied()}>
            <div class="mt-4 sm:max-w-xs">
              <label class={labelClass}>
                TDS amount (₹) <span class="text-[#AC2334]">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                inputmode="decimal"
                value={tdsAmount()}
                disabled={props.submitting}
                onInput={(e) => setTdsAmount(e.currentTarget.value)}
                placeholder="0.00"
                class={
                  fieldClass +
                  (show("tds") ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
                }
              />
              <Show when={show("tds")}>
                <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
                  {show("tds")}
                </p>
              </Show>
            </div>
          </Show>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Method */}
          <div>
            <label class={labelClass}>
              Method <span class="text-[#AC2334]">*</span>
            </label>
            <Show
              when={!customMethod()}
              fallback={
                <div class="flex gap-2">
                  <input
                    type="text"
                    value={method()}
                    disabled={props.submitting}
                    onInput={(e) => setMethod(e.currentTarget.value)}
                    placeholder="Enter method…"
                    class={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomMethod(false);
                      setMethod("");
                    }}
                    class="px-3 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-xs font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-800"
                  >
                    List
                  </button>
                </div>
              }
            >
              <select
                value={method()}
                disabled={props.submitting}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v === "__other__") {
                    setCustomMethod(true);
                    setMethod("");
                  } else setMethod(v);
                }}
                class={
                  fieldClass +
                  (show("method")
                    ? " border-[#AC2334] focus:ring-[#AC2334]/25"
                    : "")
                }
              >
                <option value="">Select method…</option>
                <For each={methodOptions()}>
                  {(m) => <option value={m}>{methodLabel(m)}</option>}
                </For>
                <option value="__other__">Other…</option>
              </select>
            </Show>
            <Show when={show("method")}>
              <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
                {show("method")}
              </p>
            </Show>
          </div>

          {/* Project (optional) */}
          <div>
            <label class={labelClass}>Project (optional)</label>
            <input
              type="text"
              value={project()}
              disabled={props.submitting}
              onInput={(e) => setProject(e.currentTarget.value)}
              placeholder="Leave blank if not project-specific"
              class={fieldClass}
            />
          </div>
        </div>

        {/* ── Accounts-only paperwork block ──────────────────────────────────
            A tier-1 CM never sees these fields: accounts owns the reference and
            the invoice. The API 403s a CM PATCH anyway — this is the UX half of
            the same rule. */}
        <Show when={props.canFillDocs}>
          <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 p-4 space-y-5">
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              Paperwork
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label class={labelClass}>Reference ID</label>
                <input
                  type="text"
                  value={referenceId()}
                  disabled={props.submitting}
                  onInput={(e) => setReferenceId(e.currentTarget.value)}
                  placeholder="UTR / transaction reference"
                  class={fieldClass}
                />
              </div>
              <div>
                <label class={labelClass}>Payment date</label>
                <input
                  type="date"
                  value={paidAt()}
                  disabled={props.submitting}
                  onInput={(e) => setPaidAt(e.currentTarget.value)}
                  class={fieldClass}
                />
              </div>
            </div>

            <div>
              <label class={labelClass}>Invoice URL</label>
              <input
                type="url"
                value={invoiceUrl()}
                disabled={props.submitting}
                onInput={(e) => setInvoiceUrl(e.currentTarget.value)}
                placeholder="https://…"
                class={fieldClass}
              />
            </div>

            <Show when={willCompleteDocs()}>
              <div class="flex items-start gap-2.5 rounded-lg bg-[#E9F7F1] dark:bg-green-900/20 border border-[#15966A]/25 px-3.5 py-2.5">
                <svg
                  class="w-4 h-4 mt-0.5 flex-none text-[#15966A]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <p class="text-xs font-semibold text-[#15966A] dark:text-green-300">
                  Saving with a reference marks this payment{" "}
                  <b>complete</b> — it will leave the Needs-Docs queue.
                </p>
              </div>
            </Show>
          </div>
        </Show>

        {/* Notes */}
        <div>
          <label class={labelClass}>Notes</label>
          <textarea
            rows="3"
            value={notes()}
            disabled={props.submitting}
            onInput={(e) => setNotes(e.currentTarget.value)}
            placeholder="Anything accounts should know about this payment…"
            class={fieldClass + " resize-y"}
          />
        </div>

        {/* Server-side failure (403, validation, network). Rendered verbatim —
            the API's message is more specific than anything we'd invent. */}
        <Show when={props.error}>
          <div class="rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3">
            <p class="text-sm font-semibold text-[#AC2334] dark:text-red-300">
              {props.error}
            </p>
          </div>
        </Show>

        <div class="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={props.submitting}
            class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#14233A] text-white text-sm font-bold hover:bg-[#1d3252] disabled:opacity-60 disabled:cursor-default transition-colors"
          >
            <Show when={props.submitting}>
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </Show>
            {props.submitting
              ? "Saving…"
              : isEdit()
                ? "Save changes"
                : (props.submitLabel ?? "Record payment")}
          </button>
          <Show when={props.onCancel}>
            <button
              type="button"
              onClick={() => props.onCancel?.()}
              disabled={props.submitting}
              class="px-5 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-800 disabled:opacity-60 transition-colors"
            >
              Cancel
            </button>
          </Show>
        </div>
      </div>

      {/* ════════ LIVE PREVIEW ════════ */}
      <aside class="lg:col-span-1">
        <div class="lg:sticky lg:top-6 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5">
          <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Preview
          </p>

          <div class="mt-3 divide-y divide-[#E2E8F1] dark:divide-gray-700">
            {previewRow("Base amount", fmtMoney(baseNum(), 2))}
            <Show when={tdsApplied()}>
              {previewRow("TDS added back", fmtMoney(tdsNum() ?? 0, 2))}
            </Show>
            {previewRow("Excluding GST", fmtMoney(preview().excludingGst, 2))}
            {previewRow(`GST @ ${gstPct()}%`, fmtMoney(preview().gstAmount, 2))}
            {previewRow("Including GST", fmtMoney(preview().includingGst, 2))}
            {previewRow("Final amount", fmtMoney(preview().finalAmount, 0), {
              strong: true,
            })}
          </div>

          <p class="mt-4 pt-3 border-t border-[#E2E8F1] dark:border-gray-700 text-xs leading-relaxed text-[#54657E] dark:text-gray-400">
            Indicative only. The server recomputes GST on save and the saved row
            is what counts — this panel just mirrors the formula while you type.
          </p>
        </div>
      </aside>
    </form>
  );
}
