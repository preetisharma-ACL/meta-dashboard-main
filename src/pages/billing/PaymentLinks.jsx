import {
  createSignal,
  createResource,
  createMemo,
  createEffect,
  For,
  Show,
} from "solid-js";
import { A } from "@solidjs/router";
import EntityPicker from "../../components/payments/EntityPicker";
import { fieldClass, labelClass } from "../../components/payments/paymentsFormat";
import { showToast } from "../../components/common/SuccessToast";
import { errorMessage, collectFieldMessages } from "../../utils/apiErrors";
import {
  LinkStatusBadge,
  OrderStatusBadge,
} from "../../components/billing/payStatus";
import { createPayQuote } from "../../components/billing/payQuote";
import {
  fetchPayLinkClients,
  createPaymentLink,
  fetchPaymentLinks,
  cancelPaymentLink,
  fetchPayOrders,
  linkUrl,
  whatsappShareUrl,
  copyToClipboard,
  linkCreatedBy,
  wholeRupees,
  payNum,
  fmtRs,
  fmtPayDate,
  fmtPayDateTime,
  isLinkOpen,
  linkQuoteSentence,
  STAFF_TDS_OPTIONS,
  ORDER_STATUS_FILTERS,
  VALID_DAYS_DEFAULT,
  VALID_DAYS_MAX,
} from "../../services/hdfcPay";

// ─── Payment links — the staff screen ─────────────────────────────────────────
// Issue a credit card payment link for one client, hand it over on WhatsApp, and
// watch what comes back. Route-gated to admin / accounts / coordination /
// campaign_manager; the BACKEND restricts a CM to their own clients and 403s
// anything else, and that 403's own sentence is what this screen shows. There is
// no frontend scoping here and there must not be.
//
// ONE CLIENT AT A TIME, because that is the shape of the API: both lists take
// client_nomen and there is no all-clients roll-up to read.
//
// THE ID. POST pay/links/ takes `client_nomen`, the NOMEN id — NOT the Client PK
// that /billing/additional-services/ takes. See fetchPayLinkClients() in
// services/hdfcPay.js for where that id comes from and why no field is ever
// substituted for it: the wrong one would issue a payable link against another
// client's account with a plausible name printed on it.
//
// The amount here is ANY amount (the spec is explicit), unlike the client's own
// Pay now modal which is floored at min_ex_gst. A staff member settling a part
// payment is a normal thing to do.

const SECTION =
  "rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm";

const TH =
  "px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider " +
  "text-[#8593A8] dark:text-gray-400 whitespace-nowrap";

const TD = "px-4 py-3 text-sm text-[#14233A] dark:text-gray-100 align-top";

export default function PaymentLinks() {
  // ── Selected client ──
  const [clientNomen, setClientNomen] = createSignal(null);
  const [clientName, setClientName] = createSignal(null);

  // ── Create form ──
  const [amount, setAmount] = createSignal("");
  const [tdsPct, setTdsPct] = createSignal(0);
  const [note, setNote] = createSignal("");
  const [validDays, setValidDays] = createSignal(String(VALID_DAYS_DEFAULT));
  const [saving, setSaving] = createSignal(false);
  const [formError, setFormError] = createSignal(null);
  const [fieldErrors, setFieldErrors] = createSignal({});
  // The link just created, kept on screen with its Copy / WhatsApp controls
  // until the operator issues another or changes client. This is the moment the
  // whole screen exists for, so it does not disappear into the list below.
  const [created, setCreated] = createSignal(null);

  // ── Lists ──
  const [orderStatus, setOrderStatus] = createSignal("");
  const [copied, setCopied] = createSignal(null); // token or "new"
  const [confirmCancel, setConfirmCancel] = createSignal(null); // token
  const [cancelling, setCancelling] = createSignal(null); // token
  const [listError, setListError] = createSignal(null);

  const [links, { refetch: refetchLinks }] = createResource(
    () => clientNomen() ?? null,
    (nomen) => fetchPaymentLinks(nomen),
  );

  const [orders, { refetch: refetchOrders }] = createResource(
    () => (clientNomen() ? { nomen: clientNomen(), status: orderStatus() } : null),
    ({ nomen, status }) => fetchPayOrders({ clientNomen: nomen, status }),
  );

  // Reading an errored resource throws; every read below goes through these.
  const linkRows = () => (links.error ? [] : links()) ?? [];
  const orderRows = () => (orders.error ? [] : orders()) ?? [];

  // Clear the one-off panel whenever the client changes, so a link for client A
  // is never left sitting above client B's list.
  createEffect(() => {
    clientNomen();
    setCreated(null);
    setFormError(null);
    setFieldErrors({});
    setConfirmCancel(null);
    setListError(null);
  });

  const amountValue = () => wholeRupees(amount());
  const daysValue = () => {
    const n = wholeRupees(validDays());
    return n !== null && n <= VALID_DAYS_MAX ? n : null;
  };

  // ── Live breakdown ────────────────────────────────────────────────────────
  // The SAME GET pay/quote/ the client's own Pay modal uses, debounced 300 ms
  // through the shared hook, so the figure an operator quotes down the phone
  // and the figure the client is asked for cannot drift apart.
  const quote = createPayQuote({
    amount: amountValue,
    tds: tdsPct,
    active: () => amountValue() !== null,
  });

  // Gated on amountValue() as well as on the quote, NOT on the quote alone.
  // Solid keeps a parked resource's previous value, so clearing the amount box
  // would otherwise leave the last good breakdown sitting under an empty field,
  // describing a number nobody can see. Same trap as the report screen's stale
  // range.
  const showQuote = () => amountValue() !== null && !!quote.shown();

  // The sentence itself lives in the service (linkQuoteSentence) so it can be
  // asserted: money formatting plus a sometimes-present clause is the shape
  // that reads fine and is wrong.
  const quoteLine = () => linkQuoteSentence(quote.shown());

  const canCreate = () =>
    !saving() &&
    clientNomen() != null &&
    amountValue() !== null &&
    daysValue() !== null;

  const err = (key) => fieldErrors()[key] ?? null;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canCreate()) return;
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const row = await createPaymentLink({
        clientNomen: clientNomen(),
        amountExGst: amountValue(),
        tdsPct: tdsPct(),
        note: note().trim(),
        validDays: daysValue(),
      });
      setCreated(row);
      setAmount("");
      setNote("");
      setTdsPct(0);
      setValidDays(String(VALID_DAYS_DEFAULT));
      showToast("The payment link is ready to share.", "Payment link created");
      refetchLinks();
    } catch (error) {
      // The backend's own words, field by field where it gave them. A CM
      // reaching outside their own clients lands here with the API's 403
      // sentence, which is more use than anything this screen could invent.
      const messages = collectFieldMessages(error);
      const flat = {};
      for (const [key, msgs] of Object.entries(messages))
        flat[key.split(".").pop()] = msgs.join(" ");
      setFieldErrors(flat);
      setFormError(errorMessage(error, "Could not create the payment link."));
    } finally {
      setSaving(false);
    }
  };

  const copy = async (url, key) => {
    const ok = await copyToClipboard(url);
    if (!ok) {
      setListError("The link could not be copied. Please select it and copy it manually.");
      return;
    }
    setListError(null);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };

  const doCancel = async (row) => {
    const tokenValue = row?.token;
    if (!tokenValue) return;
    setCancelling(tokenValue);
    setListError(null);
    try {
      await cancelPaymentLink(tokenValue);
      setConfirmCancel(null);
      // A cancelled link that is still on screen as open is the kind of stale
      // row somebody shares by mistake, so the list is re-read rather than
      // patched locally.
      refetchLinks();
      // The one-off panel points at the same link when it was the one cancelled.
      if (created()?.token === tokenValue) setCreated(null);
      showToast("The link can no longer be paid.", "Payment link cancelled");
    } catch (error) {
      setListError(errorMessage(error, "Could not cancel this link."));
    } finally {
      setCancelling(null);
    }
  };

  const createdUrl = createMemo(() => linkUrl(created()));

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Client Billing
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Payment links
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            Issue a credit card payment link for one client, share it on WhatsApp, and
            follow what the bank sends back. Campaign managers can issue links
            only for their own clients.
          </p>
        </div>

        <A
          href="/client-payments"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
        >
          <svg
            class="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M19 12H5m0 0l7 7m-7-7l7-7" />
          </svg>
          Client Payments
        </A>
      </div>

      {/* ════════ CREATE ════════ */}
      <form onSubmit={submit} class={`${SECTION} p-5 sm:p-6 mb-6`}>
        <h2 class="text-base font-bold text-[#14233A] dark:text-white mb-4">
          Create payment link
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <EntityPicker
              label="Client"
              required
              value={clientNomen()}
              onChange={(id, option) => {
                setClientNomen(id);
                setClientName(option?.name ?? null);
              }}
              fetcher={fetchPayLinkClients}
              placeholder="Search a client…"
              error={err("client_nomen")}
              forbiddenMsg="You don't have access to the client list. Ask an admin to check your access."
              errorMsg="The client list could not be loaded. Please retry."
              emptyMsg="No clients available to you."
              hint="Links are issued against the client's payment name, which is the same name the payments desk records against."
            />
          </div>

          <div>
            <label class={labelClass} for="pl-amount">
              Amount ex GST <span class="text-[#AC2334]">*</span>
            </label>
            <input
              id="pl-amount"
              type="text"
              inputMode="numeric"
              autocomplete="off"
              placeholder="0"
              value={amount()}
              disabled={saving()}
              onInput={(e) => {
                const cleaned = e.currentTarget.value.replace(/[^\d]/g, "");
                e.currentTarget.value = cleaned;
                setAmount(cleaned);
              }}
              class={
                fieldClass +
                (err("amount_ex_gst") ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
              }
            />
            <p class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-500">
              {err("amount_ex_gst") ? (
                <span class="font-medium text-[#AC2334] dark:text-red-400">
                  {err("amount_ex_gst")}
                </span>
              ) : (
                "Whole rupees. GST is added by the server."
              )}
            </p>

            {/* The live breakdown, straight off GET pay/quote/. Dimmed rather
                than blanked while a newer one is in flight, so a typing
                operator never watches the figure disappear and come back. */}
            <Show when={showQuote()}>
              <p
                class={
                  "mt-2 rounded-lg bg-[#F8FAFC] dark:bg-gray-900/40 px-3 py-2 " +
                  "text-xs font-semibold leading-relaxed text-[#14233A] dark:text-gray-200 " +
                  "tabular-nums transition-opacity " +
                  (quote.stale() ? "opacity-50" : "opacity-100")
                }
                aria-live="polite"
              >
                {quoteLine()}
              </p>
            </Show>

            {/* A quote that failed is INFORMATION, not a blocker: the link
                endpoint takes any amount, so the Create button is deliberately
                not gated on this. The server's own sentence is shown so an
                operator can see why the preview is missing rather than
                wondering whether the form is broken. */}
            <Show when={amountValue() !== null && quote.error()}>
              <p class="mt-2 text-xs font-medium text-[#B07A14] dark:text-yellow-300">
                The preview is unavailable: {quote.error()} The link can still
                be created.
              </p>
            </Show>
          </div>

          <div>
            <label class={labelClass} for="pl-tds">
              TDS
            </label>
            <select
              id="pl-tds"
              value={String(tdsPct())}
              disabled={saving()}
              onChange={(e) => setTdsPct(Number(e.currentTarget.value))}
              class={
                fieldClass +
                (err("tds_pct") ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
              }
            >
              <For each={STAFF_TDS_OPTIONS}>
                {(pct) => (
                  <option value={String(pct)}>
                    {pct === 0 ? "No TDS" : `${pct}%`}
                  </option>
                )}
              </For>
            </select>
            <Show when={err("tds_pct")}>
              <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
                {err("tds_pct")}
              </p>
            </Show>
          </div>

          <div>
            <label class={labelClass} for="pl-days">
              Valid for (days)
            </label>
            <input
              id="pl-days"
              type="number"
              min="1"
              max={VALID_DAYS_MAX}
              value={validDays()}
              disabled={saving()}
              onInput={(e) => setValidDays(e.currentTarget.value)}
              class={
                fieldClass +
                (err("valid_days") ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
              }
            />
            {/* The local range check is said out loud rather than left to show
                as a disabled button with no reason next to it. */}
            <p class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-500">
              {err("valid_days") ? (
                <span class="font-medium text-[#AC2334] dark:text-red-400">
                  {err("valid_days")}
                </span>
              ) : validDays() !== "" && daysValue() === null ? (
                <span class="font-medium text-[#AC2334] dark:text-red-400">
                  Enter a whole number of days between 1 and {VALID_DAYS_MAX}.
                </span>
              ) : (
                `Default ${VALID_DAYS_DEFAULT}, maximum ${VALID_DAYS_MAX}.`
              )}
            </p>
          </div>

          <div>
            <label class={labelClass} for="pl-note">
              Note
            </label>
            <input
              id="pl-note"
              type="text"
              placeholder="What this payment is for"
              value={note()}
              disabled={saving()}
              onInput={(e) => setNote(e.currentTarget.value)}
              class={
                fieldClass +
                (err("note") ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
              }
            />
            <p class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-500">
              {err("note") ? (
                <span class="font-medium text-[#AC2334] dark:text-red-400">
                  {err("note")}
                </span>
              ) : (
                "The client sees this on the payment page."
              )}
            </p>
          </div>
        </div>

        <Show when={formError()}>
          <div
            role="alert"
            class="mt-4 rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
          >
            {formError()}
          </div>
        </Show>

        <div class="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canCreate()}
            class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white text-sm font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving() ? "Creating…" : "Create payment link"}
          </button>
          <Show when={clientNomen() == null}>
            <p class="text-xs text-[#8593A8] dark:text-gray-500">
              Pick a client to begin.
            </p>
          </Show>
        </div>
      </form>

      {/* ════════ THE LINK JUST CREATED ════════ */}
      <Show when={created()}>
        <div class="mb-6 rounded-2xl border border-[#15966A]/30 dark:border-green-900 bg-[#E9F7F1] dark:bg-green-950/30 p-5 sm:p-6">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 class="text-base font-bold text-[#0F6B4B] dark:text-green-200">
              Link ready to share
            </h2>
            <div class="flex items-center gap-2">
              <LinkStatusBadge status={created().status} />
              <Show when={payNum(created().amount_payable) !== null}>
                <span class="text-sm font-bold tabular-nums text-[#0F6B4B] dark:text-green-200">
                  {fmtRs(created().amount_payable, 2)} payable
                </span>
              </Show>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              readOnly
              value={createdUrl() ?? ""}
              onClick={(e) => e.currentTarget.select()}
              aria-label="Payment link address"
              class="flex-1 px-3 py-2.5 rounded-lg border border-[#15966A]/30 dark:border-green-900 bg-white dark:bg-gray-900 font-mono text-xs text-[#14233A] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#15966A]/30"
            />
            <div class="flex gap-2">
              <button
                type="button"
                onClick={() => copy(createdUrl(), "new")}
                disabled={!createdUrl()}
                class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {copied() === "new" ? "Copied" : "Copy"}
              </button>
              <a
                href={whatsappShareUrl({
                  url: createdUrl(),
                  clientName: created().client ?? clientName(),
                  amountPayable: created().amount_payable,
                  note: created().note,
                })}
                target="_blank"
                rel="noreferrer"
                class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1FA855] text-white text-sm font-semibold hover:bg-[#188441] transition-colors whitespace-nowrap"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.9-4.44 9.9-9.9S17.5 2 12.04 2zm0 18.03c-1.5 0-2.97-.4-4.25-1.16l-.3-.18-3.14.82.84-3.06-.2-.32a8.13 8.13 0 01-1.24-4.33c0-4.48 3.65-8.13 8.13-8.13s8.13 3.65 8.13 8.13-3.65 8.13-8.13 8.13zm4.47-6.09c-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.25-.63.79-.77.95-.14.16-.28.18-.52.06-.24-.12-1.03-.38-1.96-1.21-.72-.65-1.21-1.45-1.35-1.69-.14-.25-.02-.38.1-.5.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.81-.2-.47-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.25-.84.82-.84 2 0 1.19.86 2.33.98 2.49.12.16 1.69 2.58 4.1 3.62.57.25 1.02.39 1.37.5.58.18 1.1.16 1.52.1.46-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28z" />
                </svg>
                Share on WhatsApp
              </a>
            </div>
          </div>
          <p class="mt-3 text-xs text-[#0F6B4B]/80 dark:text-green-300/80">
            WhatsApp opens with the message ready; choose who it goes to there.
          </p>
        </div>
      </Show>

      {/* ════════ NOTHING PICKED YET ════════ */}
      <Show when={clientNomen() == null}>
        <div class={`${SECTION} px-6 py-10 text-center`}>
          <p class="text-sm font-semibold text-[#54657E] dark:text-gray-300">
            Pick a client above to see their payment links and online payments.
          </p>
        </div>
      </Show>

      <Show when={clientNomen() != null}>
        <Show when={listError()}>
          <div
            role="alert"
            class="mb-4 rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
          >
            {listError()}
          </div>
        </Show>

        {/* ════════ LINKS LIST ════════ */}
        <div class={`${SECTION} mb-6 overflow-hidden`}>
          <div class="px-5 py-4 border-b border-[#E2E8F1] dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-base font-bold text-[#14233A] dark:text-white">
              Links for {clientName() || `client #${clientNomen()}`}
            </h2>
            <button
              type="button"
              onClick={() => refetchLinks()}
              disabled={links.loading}
              class="text-xs font-bold uppercase tracking-wide text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-gray-200 disabled:opacity-50 transition-colors"
            >
              {links.loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <Show
            when={!links.loading}
            fallback={
              <p class="px-5 py-6 text-sm text-[#54657E] dark:text-gray-400">
                Loading links…
              </p>
            }
          >
            <Show when={links.error}>
              <p class="px-5 py-6 text-sm font-medium text-[#AC2334] dark:text-red-300">
                {errorMessage(links.error, "The links could not be loaded.")}
              </p>
            </Show>

            <Show when={!links.error}>
              <Show
                when={linkRows().length > 0}
                fallback={
                  <p class="px-5 py-6 text-sm text-[#54657E] dark:text-gray-400">
                    No payment link has been issued for this client yet.
                  </p>
                }
              >
                <div class="overflow-auto max-h-[calc(100vh-16rem)]">
                  <table class="w-full">
                    <thead class="sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-900">
                      <tr>
                        <th class={TH}>Created</th>
                        <th class={`${TH} text-right`}>Amount payable</th>
                        <th class={TH}>Note</th>
                        <th class={`${TH} text-center`}>Status</th>
                        <th class={TH}>Expires</th>
                        <th class={TH}>Created by</th>
                        <th class={`${TH} text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-[#E2E8F1] dark:divide-gray-700">
                      <For each={linkRows()}>
                        {(row) => {
                          const url = linkUrl(row);
                          return (
                            <tr class="hover:bg-[#F8FAFC] dark:hover:bg-gray-700/40 transition-colors">
                              <td class={`${TD} whitespace-nowrap`}>
                                {fmtPayDateTime(row.created_at)}
                              </td>
                              <td class={`${TD} text-right tabular-nums font-semibold`}>
                                {fmtRs(row.amount_payable, 2)}
                              </td>
                              <td class={`${TD} max-w-xs`}>
                                <span class="block truncate" title={row.note || ""}>
                                  {String(row.note ?? "").trim() || "—"}
                                </span>
                              </td>
                              <td class={`${TD} text-center`}>
                                <LinkStatusBadge status={row.status} />
                              </td>
                              <td class={`${TD} whitespace-nowrap`}>
                                {fmtPayDate(row.expires_at)}
                              </td>
                              <td class={`${TD} whitespace-nowrap`}>
                                {linkCreatedBy(row)}
                              </td>
                              <td class={`${TD} text-right whitespace-nowrap`}>
                                <div class="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => copy(url, row.token)}
                                    disabled={!url}
                                    class="px-2.5 py-1.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-xs font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                                  >
                                    {copied() === row.token ? "Copied" : "Copy link"}
                                  </button>

                                  {/* Cancel, two-step. An open link is live
                                      money; a stray click should not retire it.

                                      isLinkOpen, NOT isLinkPayable: these list
                                      rows carry no `enabled` field (that is the
                                      gateway switch and it rides on the PUBLIC
                                      link payload), so asking for it here would
                                      read a missing flag as false and hide
                                      Cancel from every open link on the screen.
                                      Caught by the headless run, which faked
                                      the list exactly as the spec describes
                                      it. */}
                                  <Show when={isLinkOpen(row)}>
                                    <Show
                                      when={confirmCancel() === row.token}
                                      fallback={
                                        <button
                                          type="button"
                                          onClick={() => setConfirmCancel(row.token)}
                                          class="px-2.5 py-1.5 rounded-lg border border-[#AC2334]/30 text-xs font-semibold text-[#AC2334] dark:text-red-300 hover:bg-[#FBEEF0] dark:hover:bg-red-900/30 transition-colors"
                                        >
                                          Cancel
                                        </button>
                                      }
                                    >
                                      <span class="inline-flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => doCancel(row)}
                                          disabled={cancelling() === row.token}
                                          class="px-2.5 py-1.5 rounded-lg bg-[#AC2334] text-white text-xs font-bold hover:bg-[#93192a] disabled:opacity-50 transition-colors"
                                        >
                                          {cancelling() === row.token
                                            ? "Cancelling…"
                                            : "Confirm"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmCancel(null)}
                                          disabled={cancelling() === row.token}
                                          class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#54657E] dark:text-gray-400 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition-colors"
                                        >
                                          Keep
                                        </button>
                                      </span>
                                    </Show>
                                  </Show>
                                </div>
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </Show>
          </Show>
        </div>

        {/* ════════ ONLINE ORDERS (read only) ════════ */}
        <div class={`${SECTION} overflow-hidden`}>
          <div class="px-5 py-4 border-b border-[#E2E8F1] dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-base font-bold text-[#14233A] dark:text-white">
                Online payments
              </h2>
              <p class="text-xs text-[#8593A8] dark:text-gray-400">
                Read only. Every online credit card payment this client has started,
                whether from a link or from their own billing page.
              </p>
            </div>
            <div class="flex items-center gap-2">
              <select
                value={orderStatus()}
                onChange={(e) => setOrderStatus(e.currentTarget.value)}
                aria-label="Filter online payments by status"
                class="px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-[#14233A] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#14233A]/20 cursor-pointer transition"
              >
                <For each={ORDER_STATUS_FILTERS}>
                  {(s) => <option value={s.value}>{s.label}</option>}
                </For>
              </select>
              <button
                type="button"
                onClick={() => refetchOrders()}
                disabled={orders.loading}
                class="text-xs font-bold uppercase tracking-wide text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-gray-200 disabled:opacity-50 transition-colors"
              >
                {orders.loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <Show
            when={!orders.loading}
            fallback={
              <p class="px-5 py-6 text-sm text-[#54657E] dark:text-gray-400">
                Loading online payments…
              </p>
            }
          >
            <Show when={orders.error}>
              <p class="px-5 py-6 text-sm font-medium text-[#AC2334] dark:text-red-300">
                {errorMessage(
                  orders.error,
                  "The online payments could not be loaded.",
                )}
              </p>
            </Show>

            <Show when={!orders.error}>
              <Show
                when={orderRows().length > 0}
                fallback={
                  <p class="px-5 py-6 text-sm text-[#54657E] dark:text-gray-400">
                    {orderStatus()
                      ? "No online payment for this client has that status."
                      : "This client has not made an online payment yet."}
                  </p>
                }
              >
                <div class="overflow-auto max-h-[calc(100vh-16rem)]">
                  <table class="w-full">
                    <thead class="sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-900">
                      <tr>
                        <th class={TH}>Created</th>
                        <th class={TH}>Order ID</th>
                        <th class={TH}>Method</th>
                        <th class={TH}>Bank reference</th>
                        <th class={`${TH} text-right`}>Paid</th>
                        <th class={`${TH} text-right`}>Credited</th>
                        <th class={`${TH} text-center`}>Status</th>
                        <th class={TH}>Paid on</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-[#E2E8F1] dark:divide-gray-700">
                      <For each={orderRows()}>
                        {(o) => (
                          <tr class="hover:bg-[#F8FAFC] dark:hover:bg-gray-700/40 transition-colors">
                            <td class={`${TD} whitespace-nowrap`}>
                              {fmtPayDateTime(o.created_at)}
                            </td>
                            <td class={`${TD} font-mono text-xs break-all`}>
                              {o.order_id || "—"}
                            </td>
                            <td class={`${TD} whitespace-nowrap`}>
                              {o.method || "—"}
                            </td>
                            <td class={`${TD} font-mono text-xs break-all`}>
                              {o.bank_ref || "—"}
                            </td>
                            <td class={`${TD} text-right tabular-nums font-semibold`}>
                              {fmtRs(o.amount_paid, 2)}
                            </td>
                            <td class={`${TD} text-right tabular-nums`}>
                              {fmtRs(o.credited, 2)}
                            </td>
                            <td class={`${TD} text-center`}>
                              <OrderStatusBadge order={o} />
                            </td>
                            <td class={`${TD} whitespace-nowrap`}>
                              {fmtPayDateTime(o.paid_on)}
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
      </Show>
    </section>
  );
}
