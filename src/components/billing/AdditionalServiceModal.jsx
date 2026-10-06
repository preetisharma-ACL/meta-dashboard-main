import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import {
  SERVICE_TYPES,
  GST_PCT_OPTIONS,
  DEFAULT_GST_PCT,
  needsServiceName,
  gstPreview,
  createAdditionalService,
  updateAdditionalService,
} from "../../services/additionalServices";
import { collectFieldErrors, errorBanner } from "../../utils/apiErrors";

// ─── Add / edit an additional service ─────────────────────────────────────────
// Slide-over that records a NON-AD charge (website development, SEO, …) against
// a client's main balance. Rendered only behind canWriteAdditionalServices();
// the backend 403s anyone else regardless.
//
// The entry is one-time by design. A monthly service is a new entry each month,
// which the footnote says out loud — otherwise someone records SEO once and
// expects it to recur.
//
// Backend contract this form has to honour:
//   • notes is COMPULSORY (422 validation_error, fields.notes)
//   • amount must be > 0
//   • gst_pct is one of 0 / 5 / 12 / 18 / 28, defaulting to 18
//   • service_name is required when service_type is "other"
//   • 409 needs_confirmation when charge_date lands in a CLOSED month →
//     fields.warnings shown in a confirm dialog, then the SAME body resent with
//     confirm: true
//   • 403 → this user cannot manage this client
//
// There is no service charge on an additional service and Replaced Credit Notes
// never pay for one. Both are stated on the form, because the operator filling
// it in is the person who would otherwise assume ad-spend rules apply.
//
// Props: open, onClose(), onSaved(savedRow)?, clientId (Client PK),
//        clientName?, row? (an existing entry → edit mode)

const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 " +
  "bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-100 " +
  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none " +
  "disabled:opacity-50 transition";

const LABEL =
  "block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5";

const ERR_FIELD =
  "border-[#AC2334] focus:border-[#AC2334] ring-1 ring-[#AC2334]/30";

const fmtPreview = (v) =>
  v == null
    ? "—"
    : `₹${Number(v).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

const emptyForm = () => ({
  service_type: "website_development",
  service_name: "",
  description: "",
  amount: "",
  gst_pct: String(DEFAULT_GST_PCT),
  charge_date: "",
  notes: "",
});

// An existing row → the form's fields. Read from the row's OWN values, with
// gst_pct kept as the string the <select> compares against. A null gst_pct on a
// stored row falls back to the backend's default rather than to an empty select,
// which would post nothing and silently re-default server-side.
const formFromRow = (row) => ({
  service_type: row?.service_type ?? "website_development",
  service_name: row?.service_name ?? "",
  description: row?.description ?? "",
  amount: row?.amount_ex_gst == null ? "" : String(row.amount_ex_gst),
  gst_pct:
    row?.gst_pct == null
      ? String(DEFAULT_GST_PCT)
      : String(Number(row.gst_pct)),
  charge_date: row?.charge_date ?? "",
  notes: row?.notes ?? "",
});

export default function AdditionalServiceModal(props) {
  const isEdit = () => props.row != null;

  const [form, setForm] = createSignal(emptyForm());
  const [submitting, setSubmitting] = createSignal(false);
  const [banner, setBanner] = createSignal(null);
  // Field messages keyed by the dotted path apiErrors.js produces, so the
  // server's own wording lands next to the input it is about.
  const [fieldErrors, setFieldErrors] = createSignal({});
  // 409 needs_confirmation: the sentences to confirm plus the body that drew
  // them, so the confirm resends exactly that and nothing re-read from the form.
  const [pending, setPending] = createSignal(null); // { warnings, payload }

  const set = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear only the message for the field being edited — the others still
    // apply until the next round-trip.
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const reset = () => {
    setForm(emptyForm());
    setBanner(null);
    setFieldErrors({});
    setPending(null);
  };

  const close = () => {
    reset();
    props.onClose?.();
  };

  // Load the row being edited (or a clean form for an add) every time the panel
  // opens, so a cancelled edit never leaks into the next one.
  createEffect(() => {
    if (!props.open) return;
    setForm(isEdit() ? formFromRow(props.row) : emptyForm());
    setBanner(null);
    setFieldErrors({});
    setPending(null);
  });

  // ── Live preview — GST = amount × gst_pct / 100, total = amount + GST ─────
  const preview = createMemo(() =>
    gstPreview({ amount: form().amount, gstPct: form().gst_pct }),
  );

  // ── Local validation (the backend stays the authority) ───────────────────
  const amountValue = () => Number(form().amount);
  const amountIsValid = () =>
    form().amount !== "" &&
    Number.isFinite(amountValue()) &&
    amountValue() > 0;
  const nameIsValid = () =>
    !needsServiceName(form().service_type) || form().service_name.trim() !== "";
  const notesAreValid = () => form().notes.trim() !== "";
  const dateIsValid = () => form().charge_date.trim() !== "";

  // A create needs a client. The id arrives from a picker as a STRING, so ""
  // has to fail this as surely as null does — Number("") is 0, which would
  // post a client_id of 0.
  const hasClient = () => props.clientId != null && props.clientId !== "";

  const canSubmit = () =>
    !submitting() &&
    (isEdit() || hasClient()) &&
    amountIsValid() &&
    nameIsValid() &&
    notesAreValid() &&
    dateIsValid();

  // The 409's sentences: fields.warnings is the list; detail carries the same
  // sentences joined, for an envelope that only has that.
  const warningsOf = (err) => {
    const w = err?.fields?.warnings ?? err?.data?.error?.fields?.warnings;
    if (Array.isArray(w) && w.length) return w.map(String);
    const detail = err?.data?.error?.detail ?? err?.data?.detail ?? err?.message;
    return detail ? [String(detail)] : [];
  };

  const buildPayload = () => {
    const f = form();
    const payload = {
      service_type: f.service_type,
      description: f.description.trim(),
      // Decimal — send the string the operator typed so nothing is rounded on
      // the way out; the backend parses it.
      amount: String(f.amount).trim(),
      gst_pct: Number(f.gst_pct),
      charge_date: f.charge_date.trim(),
      notes: f.notes.trim(),
    };
    // service_name is required only for "other"; for every other type an empty
    // box means "the type label names it", so send the key only when filled.
    const name = f.service_name.trim();
    if (name || needsServiceName(f.service_type)) payload.service_name = name;
    // client_id identifies the client on a create. A PATCH addresses the entry
    // by id and must not try to move it to another client.
    if (!isEdit()) payload.client_id = Number(props.clientId);
    return payload;
  };

  const submit = async (confirmedPayload) => {
    setBanner(null);
    setFieldErrors({});

    if (!amountIsValid()) {
      setFieldErrors({ amount: "Enter an amount greater than zero." });
      return;
    }
    if (!nameIsValid()) {
      setFieldErrors({ service_name: "A name is required for “Other”." });
      return;
    }
    if (!dateIsValid()) {
      setFieldErrors({ charge_date: "Pick the date this is charged on." });
      return;
    }
    if (!notesAreValid()) {
      setFieldErrors({ notes: "A note is required." });
      return;
    }

    const payload = confirmedPayload
      ? { ...confirmedPayload, confirm: true }
      : buildPayload();
    setPending(null);

    setSubmitting(true);
    try {
      const res = isEdit()
        ? await updateAdditionalService(props.row.id, payload)
        : await createAdditionalService(payload);
      const saved = res?.data ?? null;
      reset();
      props.onClose?.();
      props.onSaved?.(saved);
    } catch (err) {
      if (err?.code === "needs_confirmation" && !confirmedPayload) {
        setPending({ warnings: warningsOf(err), payload });
        return;
      }
      // Show the BACKEND's wording. collectFieldErrors reads the field map off
      // either transport (200-envelope failure or HTTP 4xx); the banner takes
      // whatever is left that isn't pinned to an input.
      const pinned = collectFieldErrors(err);
      setFieldErrors(pinned);
      if (err?.status === 403) {
        setBanner(
          err?.message ||
            "You cannot manage additional services for this client.",
        );
      } else if (Object.keys(pinned).length === 0) {
        setBanner(errorBanner(err, pinned, "Could not save this service."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const err = (key) => fieldErrors()[key] ?? null;

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex">
        <div
          onClick={close}
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            isEdit() ? "Edit additional service" : "Add additional service"
          }
          class="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-gray-900
                 border-l border-[#E2E8F1] dark:border-gray-700 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div class="flex items-start justify-between px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
            <div>
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
                {isEdit() ? "Edit additional service" : "Add additional service"}
              </h2>
              <p class="text-sm text-[#54657E] dark:text-gray-400">
                {props.clientName
                  ? `Charged to ${props.clientName}'s main balance`
                  : "Charged to the client's main balance"}
              </p>
            </div>
            <button
              onClick={close}
              aria-label="Close"
              class="w-8 h-8 rounded-full flex items-center justify-center text-[#54657E] hover:bg-[#E2E8F1] dark:hover:bg-gray-700 transition"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Show when={banner()}>
              <div
                role="alert"
                class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
              >
                {banner()}
              </div>
            </Show>

            {/* The two ad-spend rules that do NOT apply here. The operator
                filling this in is exactly the person who would assume they do. */}
            <div class="rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60 px-3.5 py-3 text-xs text-[#54657E] dark:text-gray-400">
              No service charge is added on an additional service, and Replaced
              Credit Notes never pay for one — they cover ads only. The amount
              plus GST comes off the client's main balance in the month of the
              charge date.
            </div>

            {/* Service type */}
            <div>
              <label class={LABEL}>Service</label>
              <select
                value={form().service_type}
                onChange={(e) => set("service_type", e.currentTarget.value)}
                class={`${FIELD} ${err("service_type") ? ERR_FIELD : ""}`}
              >
                <For each={SERVICE_TYPES}>
                  {(t) => <option value={t.value}>{t.label}</option>}
                </For>
              </select>
              <Show when={err("service_type")}>
                <p
                  role="alert"
                  class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                >
                  {err("service_type")}
                </p>
              </Show>
            </div>

            {/* Service name — compulsory for "Other", optional otherwise */}
            <div>
              <label class={LABEL}>
                Service name{" "}
                <Show
                  when={needsServiceName(form().service_type)}
                  fallback={
                    <span class="font-normal text-[#8593A8]">(optional)</span>
                  }
                >
                  <span class="text-[#AC2334]">*</span>
                </Show>
              </label>
              <input
                type="text"
                value={form().service_name}
                onInput={(e) => set("service_name", e.currentTarget.value)}
                placeholder={
                  needsServiceName(form().service_type)
                    ? "What is this service called?"
                    : "Leave blank to use the service name above"
                }
                aria-invalid={!!err("service_name")}
                class={`${FIELD} ${err("service_name") ? ERR_FIELD : ""}`}
              />
              <Show
                when={err("service_name")}
                fallback={
                  <Show when={needsServiceName(form().service_type)}>
                    <p class="text-xs text-[#8593A8] mt-1">
                      Required for “Other” — it is what the client will see on
                      their bill.
                    </p>
                  </Show>
                }
              >
                <p
                  role="alert"
                  class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                >
                  {err("service_name")}
                </p>
              </Show>
            </div>

            {/* Description — the client sees this */}
            <div>
              <label class={LABEL}>
                Description{" "}
                <span class="font-normal text-[#8593A8]">(optional)</span>
              </label>
              <textarea
                rows="2"
                value={form().description}
                onInput={(e) => set("description", e.currentTarget.value)}
                placeholder="What the client is paying for"
                class={`${FIELD} resize-none ${err("description") ? ERR_FIELD : ""}`}
              />
              <Show
                when={err("description")}
                fallback={
                  <p class="text-xs text-[#8593A8] mt-1">
                    Shown to the client on their billing page.
                  </p>
                }
              >
                <p
                  role="alert"
                  class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                >
                  {err("description")}
                </p>
              </Show>
            </div>

            {/* Amount + GST */}
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class={LABEL}>
                  Amount (ex GST) <span class="text-[#AC2334]">*</span>
                </label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[#8593A8] font-bold select-none">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form().amount}
                    onInput={(e) => set("amount", e.currentTarget.value)}
                    aria-invalid={!!err("amount")}
                    class={`${FIELD} pl-7 ${err("amount") ? ERR_FIELD : ""}`}
                  />
                </div>
                <Show when={err("amount")}>
                  <p
                    role="alert"
                    class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                  >
                    {err("amount")}
                  </p>
                </Show>
              </div>
              <div>
                <label class={LABEL}>GST</label>
                <select
                  value={form().gst_pct}
                  onChange={(e) => set("gst_pct", e.currentTarget.value)}
                  class={`${FIELD} ${err("gst_pct") ? ERR_FIELD : ""}`}
                >
                  <For each={GST_PCT_OPTIONS}>
                    {(p) => <option value={String(p)}>{p}%</option>}
                  </For>
                </select>
                <Show when={err("gst_pct")}>
                  <p
                    role="alert"
                    class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                  >
                    {err("gst_pct")}
                  </p>
                </Show>
              </div>
            </div>

            {/* Live preview — a DISPLAY MIRROR of the server's own sum. The
                saved row is re-read after the write, so a formula change
                upstream shows up there rather than being trusted from here. */}
            <div class="rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60 px-3.5 py-3">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Preview
              </p>
              <dl class="mt-2 space-y-1.5 text-sm">
                <div class="flex items-baseline justify-between gap-4">
                  <dt class="text-[#54657E] dark:text-gray-400">
                    Amount (ex GST)
                  </dt>
                  <dd class="tabular-nums font-medium text-[#14233A] dark:text-gray-100">
                    {fmtPreview(preview().amountExGst)}
                  </dd>
                </div>
                <div class="flex items-baseline justify-between gap-4">
                  <dt class="text-[#54657E] dark:text-gray-400">
                    GST · {Number(form().gst_pct) || 0}%
                  </dt>
                  <dd class="tabular-nums font-medium text-[#14233A] dark:text-gray-100">
                    {fmtPreview(preview().gstAmount)}
                  </dd>
                </div>
                <div class="flex items-baseline justify-between gap-4 pt-1.5 border-t border-[#E2E8F1] dark:border-gray-700">
                  <dt class="font-semibold text-[#14233A] dark:text-gray-100">
                    Total (inc GST)
                  </dt>
                  <dd class="tabular-nums font-bold text-[#14233A] dark:text-white">
                    {fmtPreview(preview().totalIncGst)}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Charge date — decides the month the balance is hit in */}
            <div>
              <label class={LABEL}>
                Charge date <span class="text-[#AC2334]">*</span>
              </label>
              <input
                type="date"
                value={form().charge_date}
                onInput={(e) => set("charge_date", e.currentTarget.value)}
                aria-invalid={!!err("charge_date")}
                class={`${FIELD} ${err("charge_date") ? ERR_FIELD : ""}`}
              />
              <Show
                when={err("charge_date")}
                fallback={
                  <p class="text-xs text-[#8593A8] mt-1">
                    The balance is deducted in this date's month. A date in a
                    closed month asks for confirmation first.
                  </p>
                }
              >
                <p
                  role="alert"
                  class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                >
                  {err("charge_date")}
                </p>
              </Show>
            </div>

            {/* Notes — compulsory, internal */}
            <div>
              <label class={LABEL}>
                Notes <span class="text-[#AC2334]">*</span>
              </label>
              <textarea
                rows="3"
                value={form().notes}
                onInput={(e) => set("notes", e.currentTarget.value)}
                placeholder="Why is this being charged? Who approved it?"
                aria-invalid={!!err("notes")}
                class={`${FIELD} resize-none ${err("notes") ? ERR_FIELD : ""}`}
              />
              <Show
                when={err("notes")}
                fallback={
                  <p class="text-xs text-[#8593A8] mt-1">
                    Required. Internal — the client never sees the note.
                  </p>
                }
              >
                <p
                  role="alert"
                  class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                >
                  {err("notes")}
                </p>
              </Show>
            </div>

            <Show when={!isEdit()}>
              <p class="text-xs text-[#8593A8]">
                One-time entry. A monthly service (SEO, for example) is added
                again each month.
              </p>
            </Show>
          </div>

          {/* Footer */}
          <div class="px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 flex gap-3">
            <button
              onClick={close}
              class="flex-1 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1]/60 dark:hover:bg-gray-700 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => submit()}
              disabled={!canSubmit()}
              class="flex-1 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {submitting()
                ? "Saving…"
                : isEdit()
                  ? "Save changes"
                  : "Add service"}
            </button>
          </div>
        </div>

        {/* 409 needs_confirmation — the backend's own sentences, verbatim. */}
        <Show when={pending()}>
          <div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div
              class="fixed inset-0 bg-black/45"
              aria-hidden="true"
              onClick={() => setPending(null)}
            />
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirm additional service"
              class="relative w-full max-w-md rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl"
            >
              <div class="px-6 pt-5">
                <h3 class="text-lg font-bold text-[#14233A] dark:text-white">
                  Confirm this charge
                </h3>
                <p class="mt-1 text-sm text-[#54657E] dark:text-gray-400">
                  Please check before saving:
                </p>
                <ul class="mt-3 space-y-2">
                  <For each={pending().warnings}>
                    {(w) => (
                      <li class="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300">
                        {w}
                      </li>
                    )}
                  </For>
                </ul>
              </div>
              <div class="mt-5 px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 flex gap-3">
                <button
                  onClick={() => setPending(null)}
                  class="flex-1 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1]/60 dark:hover:bg-gray-700 transition"
                >
                  Go back
                </button>
                <button
                  onClick={() => submit(pending().payload)}
                  disabled={submitting()}
                  class="flex-1 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white font-semibold hover:bg-[#93192a] disabled:opacity-40 transition"
                >
                  Confirm & save
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
