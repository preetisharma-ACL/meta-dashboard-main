import { createSignal, createResource, createEffect, Show } from "solid-js";
import { A } from "@solidjs/router";
import { showToast } from "../../components/common/SuccessToast";
import QrViewer from "../../components/billing/QrViewer";
import { errorMessage, collectFieldMessages } from "../../utils/apiErrors";
import {
  fetchBankDetails,
  saveBankDetails,
  bankQrSrc,
  qrError,
  QR_ACCEPT,
} from "../../services/hdfcPay";

// ─── Bank details (accounts + admin) ──────────────────────────────────────────
// What a client sees on the "Bank transfer / UPI" tab of their Pay modal: where
// to send the money, and the UPI QR to scan.
//
// THIS IS PUBLISHED TO CLIENTS. A typo in the account number or IFSC sends real
// money somewhere it cannot be recovered from, which is why the form says so
// above the fields and shows a preview of exactly what will be displayed.
//
// Saving is multipart (POST pay/bank-details/) because of the QR upload.
// `remove_qr` is sent ONLY when the box is ticked: an always-present
// destructive flag is the kind of thing that becomes harmful after a backend
// refactor nobody re-reads this form for.

const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 " +
  "bg-white dark:bg-gray-900 text-sm text-[#14233A] dark:text-gray-100 " +
  "placeholder:text-[#8593A8] dark:placeholder:text-gray-500 " +
  "focus:outline-none focus:ring-2 focus:ring-[#14233A]/20 disabled:opacity-60 transition";

const LABEL =
  "block text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5";

const FIELDS = [
  { key: "account_name", label: "Account name", placeholder: "AAJNEETI CONNECT LTD" },
  { key: "bank_name", label: "Bank", placeholder: "RBL Bank" },
  { key: "account_number", label: "Account number", mono: true },
  { key: "ifsc", label: "IFSC", mono: true, upper: true },
  { key: "branch", label: "Branch" },
  { key: "upi_id", label: "UPI ID", mono: true },
];

export default function BankDetailsSettings() {
  const [saved, { refetch }] = createResource(fetchBankDetails);

  const [form, setForm] = createSignal({});
  const [qrFile, setQrFile] = createSignal(null);
  const [removeQr, setRemoveQr] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [fieldErrors, setFieldErrors] = createSignal({});

  let fileInput;

  const current = () => (saved.error ? null : saved()) ?? null;

  // Fill the form from the server once it lands, and again after every save, so
  // what is on screen is always what is stored rather than what was typed.
  createEffect(() => {
    const d = current();
    if (!d) return;
    setForm({
      account_name: d.account_name ?? "",
      bank_name: d.bank_name ?? "",
      account_number: d.account_number ?? "",
      ifsc: d.ifsc ?? "",
      branch: d.branch ?? "",
      upi_id: d.upi_id ?? "",
      note: d.note ?? "",
    });
    setQrFile(null);
    setRemoveQr(false);
    if (fileInput) fileInput.value = "";
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const err = (key) => fieldErrors()[key] ?? null;

  const localQrError = () => qrError(qrFile());

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy() || localQrError()) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await saveBankDetails(form(), {
        qrFile: qrFile(),
        // Only when the box is ticked AND no replacement was chosen. Uploading
        // a new QR and ticking remove in the same save is a contradiction; the
        // upload is treated as the intent, because that is the one with a file
        // attached to it.
        removeQr: removeQr() && !qrFile(),
      });
      showToast(
        "Clients now see these details on their billing page.",
        "Bank details saved",
      );
      refetch();
    } catch (error_) {
      const messages = collectFieldMessages(error_);
      const flat = {};
      for (const [k, msgs] of Object.entries(messages))
        flat[k.split(".").pop()] = msgs.join(" ");
      setFieldErrors(flat);
      setError(errorMessage(error_, "Could not save the bank details."));
    } finally {
      setBusy(false);
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
            Bank details
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            Where clients send money when they pay by bank transfer or UPI.
            These details and the QR appear on every client's billing page.
          </p>
        </div>

        <A
          href="/billing/bank-transfers"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5m0 0l7 7m-7-7l7-7" />
          </svg>
          Transfers to verify
        </A>
      </div>

      <Show when={saved.error}>
        <div
          role="alert"
          class="mb-4 rounded-xl border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
        >
          {errorMessage(saved.error, "The saved details could not be loaded.")}
        </div>
      </Show>

      <Show
        when={!saved.loading}
        fallback={
          <p class="text-sm text-[#54657E] dark:text-gray-400">
            Loading the saved details…
          </p>
        }
      >
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ════════ FORM ════════ */}
          <form
            onSubmit={submit}
            class="lg:col-span-2 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-5 sm:p-6 space-y-4"
          >
            <div class="rounded-lg border border-[#B07A14]/30 bg-[#FBF3E2] dark:bg-yellow-900/20 dark:border-yellow-800 px-3.5 py-3 text-xs font-semibold text-[#B07A14] dark:text-yellow-300">
              Clients send real money to whatever is saved here. Check the
              account number and IFSC against a statement before you save.
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {FIELDS.map((f) => (
                <div class={f.key === "account_name" ? "sm:col-span-2" : ""}>
                  <label class={LABEL} for={`bd-${f.key}`}>
                    {f.label}
                  </label>
                  <input
                    id={`bd-${f.key}`}
                    type="text"
                    autocomplete="off"
                    spellcheck={false}
                    placeholder={f.placeholder ?? ""}
                    value={form()[f.key] ?? ""}
                    disabled={busy()}
                    onInput={(e) => {
                      const v = f.upper
                        ? e.currentTarget.value.toUpperCase()
                        : e.currentTarget.value;
                      if (f.upper) e.currentTarget.value = v;
                      set(f.key, v);
                    }}
                    class={
                      FIELD +
                      (f.mono ? " font-mono" : "") +
                      (err(f.key) ? " border-[#AC2334]" : "")
                    }
                  />
                  <Show when={err(f.key)}>
                    <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
                      {err(f.key)}
                    </p>
                  </Show>
                </div>
              ))}
            </div>

            <div>
              <label class={LABEL} for="bd-note">
                Note to clients
              </label>
              <textarea
                id="bd-note"
                rows="2"
                placeholder="e.g. Please mention your company name in the transfer remarks."
                value={form().note ?? ""}
                disabled={busy()}
                onInput={(e) => set("note", e.currentTarget.value)}
                class={FIELD + (err("note") ? " border-[#AC2334]" : "")}
              />
              <Show when={err("note")}>
                <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
                  {err("note")}
                </p>
              </Show>
            </div>

            {/* ── QR ── */}
            <div class="rounded-lg border border-[#E2E8F1] dark:border-gray-700 p-4 space-y-3">
              <label class={LABEL} for="bd-qr">
                UPI QR image
              </label>
              <input
                id="bd-qr"
                ref={fileInput}
                type="file"
                accept={QR_ACCEPT}
                disabled={busy()}
                onChange={(e) => {
                  setQrFile(e.currentTarget.files?.[0] ?? null);
                  // Choosing a replacement cancels a pending removal, so the
                  // two controls cannot contradict each other.
                  if (e.currentTarget.files?.[0]) setRemoveQr(false);
                }}
                class={
                  FIELD +
                  " file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#F1F4F9] dark:file:bg-gray-700 file:text-[#14233A] dark:file:text-gray-200" +
                  (localQrError() || err("qr") ? " border-[#AC2334]" : "")
                }
              />
              <p
                class={
                  "text-xs " +
                  (localQrError() || err("qr")
                    ? "font-medium text-[#AC2334] dark:text-red-400"
                    : "text-[#8593A8] dark:text-gray-500")
                }
              >
                {localQrError() ??
                  err("qr") ??
                  "JPG, PNG or WEBP, up to 2 MB. Leave it empty to keep the current image."}
              </p>

              <Show when={current()?.has_qr === true}>
                <label class="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={removeQr()}
                    disabled={busy() || !!qrFile()}
                    onChange={(e) => setRemoveQr(e.currentTarget.checked)}
                    class="w-4 h-4 rounded border-[#E2E8F1] text-[#AC2334] focus:ring-[#AC2334]/30"
                  />
                  <span class="text-sm font-semibold text-[#54657E] dark:text-gray-300">
                    Remove the QR
                  </span>
                </label>
                <Show when={removeQr() && !qrFile()}>
                  <p class="text-xs font-semibold text-[#AC2334] dark:text-red-400">
                    Saving will remove the QR from every client's billing page.
                  </p>
                </Show>
              </Show>
            </div>

            <Show when={error()}>
              <div
                role="alert"
                class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
              >
                {error()}
              </div>
            </Show>

            <button
              type="submit"
              disabled={busy() || !!localQrError()}
              class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#AC2334] text-white text-sm font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy() ? "Saving…" : "Save bank details"}
            </button>
          </form>

          {/* ════════ WHAT THE CLIENT SEES ════════
              The saved state, not the half-typed form: this is the check that
              what is live is correct, so it reads from the server's payload. */}
          <aside class="rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-5 h-fit">
            <h2 class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-3">
              Live on client billing
            </h2>

            <Show
              when={current()?.enabled === true}
              fallback={
                <p class="mb-3 rounded-lg bg-[#F1F4F9] dark:bg-gray-700 px-3 py-2 text-xs font-semibold text-[#54657E] dark:text-gray-300">
                  Bank transfer is switched off, so clients do not see this tab
                  yet. The switch is a backend setting.
                </p>
              }
            >
              <p class="mb-3 rounded-lg bg-[#E9F7F1] dark:bg-green-900/30 px-3 py-2 text-xs font-semibold text-[#15966A] dark:text-green-300">
                Visible to clients now.
              </p>
            </Show>

            <dl class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 divide-y divide-[#E2E8F1] dark:divide-gray-700 text-sm">
              {FIELDS.map((f) => (
                <div class="flex items-baseline justify-between gap-3 px-3.5 py-2">
                  <dt class="text-[#54657E] dark:text-gray-400 shrink-0">
                    {f.label}
                  </dt>
                  <dd
                    class={
                      "text-right truncate font-semibold text-[#14233A] dark:text-gray-100 " +
                      (f.mono ? "font-mono text-xs" : "")
                    }
                  >
                    {current()?.[f.key] || "—"}
                  </dd>
                </div>
              ))}
            </dl>

            <Show
              when={bankQrSrc(current())}
              fallback={
                <p class="mt-4 text-xs text-[#8593A8] dark:text-gray-500">
                  No QR is saved, so clients see the account details only.
                </p>
              }
            >
              <div class="mt-4">
                <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-2">
                  Saved QR
                </p>
                {/* Same click-to-enlarge the client gets, so whoever uploads
                    the QR can check at full size that it is the right one and
                    actually scannable before clients see it. */}
                <QrViewer
                  src={bankQrSrc(current())}
                  alt="The UPI QR clients see"
                  thumbClass="w-full max-h-72 object-contain rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white"
                />
              </div>
            </Show>
          </aside>
        </div>
      </Show>
    </section>
  );
}
