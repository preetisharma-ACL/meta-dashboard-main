import { createSignal, createResource, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { errorMessage } from "../../utils/apiErrors";
import {
  fetchPaymentLink,
  startLinkPayment,
  isLinkPayable,
  linkClosedMessage,
  linkStatusLabel,
  fmtRs,
  fmtPayDate,
  payNum,
} from "../../services/hdfcPay";

// ─── /pay/:token ──────────────────────────────────────────────────────────────
// The page a payment link opens. PUBLIC in the strictest sense: no login, no
// layout, and no Authorization header on either call it makes (see publicGet /
// publicPost in services/hdfcPay.js). Somebody paying from a WhatsApp message
// has no session and must never be sent to a login screen.
//
// GET pay/links/<token>/ → client, note, status, expires_at, enabled, and the
// full breakdown. The amount is FIXED by whoever issued the link, so there is no
// input on this page: it shows what is owed and collects it.
//
// The button appears only when the link is open AND enabled. For anything else
// the copy names the reason, because "nothing happens when I tap pay" is the
// one outcome this page must not produce.

export default function PaymentLinkPay() {
  const params = useParams();
  const token = () => params.token ?? "";

  const [linkRes, { refetch }] = createResource(token, fetchPaymentLink);

  // Reading an errored resource throws; both reads go through these.
  const link = () => (linkRes.error ? null : linkRes()) ?? null;
  const loadError = () =>
    linkRes.error ? errorMessage(linkRes.error, "This payment link could not be opened.") : null;

  const [starting, setStarting] = createSignal(false);
  const [startError, setStartError] = createSignal(null);

  const pay = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await startLinkPayment(token());
      const url = res?.payment_url;
      if (!url) throw new Error("The payment page address was not returned.");
      window.location.href = url;
    } catch (err) {
      setStartError(errorMessage(err, "Could not start the payment."));
      setStarting(false);
    }
  };

  const payable = () => payNum(link()?.amount_payable);
  const tdsPct = () => payNum(link()?.tds_pct);
  const tdsAmount = () => payNum(link()?.tds_amount);

  const rows = () => {
    const l = link();
    if (!l) return [];
    const out = [
      { label: "Amount (ex GST)", value: fmtRs(l.amount_ex_gst, 2) },
      { label: "GST", value: fmtRs(l.gst_amount, 2) },
      { label: "Total incl. GST", value: fmtRs(l.including_gst, 2) },
    ];
    if (tdsAmount() !== null && tdsAmount() > 0)
      out.push({
        label: `TDS deducted${tdsPct() ? ` (${tdsPct()}%)` : ""}`,
        value: `- ${fmtRs(tdsAmount(), 2)}`,
      });
    out.push({ label: "You pay", value: fmtRs(l.amount_payable, 2), strong: true });
    out.push({ label: "Credited to the account", value: fmtRs(l.credited, 2) });
    return out;
  };

  return (
    <main class="min-h-screen bg-[#F6F9FC] dark:bg-gray-900 px-4 py-10 sm:py-14">
      <div class="mx-auto w-full max-w-xl">
        <div class="mb-6 text-center">
          <p class="text-xs font-bold uppercase tracking-[0.18em] text-[#AC2334]">
            AAJneeti
          </p>
          <h1 class="mt-1 text-xl font-bold text-[#14233A] dark:text-white">
            Payment request
          </h1>
        </div>

        {/* ── Loading ── */}
        <Show when={linkRes.loading && !link()}>
          <Card>
            <p class="text-sm font-semibold text-[#54657E] dark:text-gray-300">
              Opening your payment request…
            </p>
          </Card>
        </Show>

        {/* ── The link itself could not be read (wrong, deleted or malformed
             token). The server's own sentence is shown: it already says
             whether the link exists. ── */}
        <Show when={!linkRes.loading && loadError()}>
          <Card>
            <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
              This payment request is not available
            </h2>
            <p class="mt-2 text-sm text-[#54657E] dark:text-gray-300">
              {loadError()}
            </p>
            <p class="mt-2 text-sm text-[#54657E] dark:text-gray-300">
              Please contact AAJneeti accounts for a fresh link.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              class="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition-colors"
            >
              Try again
            </button>
          </Card>
        </Show>

        {/* ── The link ── */}
        <Show when={link()}>
          <div class="rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <div class="px-6 py-5 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Payment for
              </p>
              <h2 class="mt-1 text-lg font-bold text-[#14233A] dark:text-white">
                {link().client || "Your account"}
              </h2>
              <Show when={String(link().note ?? "").trim()}>
                <p class="mt-2 text-sm text-[#54657E] dark:text-gray-300 whitespace-pre-line">
                  {link().note}
                </p>
              </Show>
              <Show when={isLinkPayable(link()) && link().expires_at}>
                <p class="mt-3 text-xs font-semibold text-[#8593A8] dark:text-gray-400">
                  Valid until {fmtPayDate(link().expires_at)}
                </p>
              </Show>
            </div>

            {/* Breakdown */}
            <dl class="divide-y divide-[#E2E8F1] dark:divide-gray-700">
              <For each={rows()}>
                {(r) => (
                  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-3">
                    <dt
                      class={
                        r.strong
                          ? "text-sm font-bold text-[#14233A] dark:text-white"
                          : "text-sm text-[#54657E] dark:text-gray-400"
                      }
                    >
                      {r.label}
                    </dt>
                    <dd
                      class={
                        r.strong
                          ? "text-lg font-bold tabular-nums text-[#14233A] dark:text-white"
                          : "text-sm font-semibold tabular-nums text-[#14233A] dark:text-gray-100"
                      }
                    >
                      {r.value}
                    </dd>
                  </div>
                )}
              </For>
            </dl>

            <div class="px-6 py-5 space-y-3">
              <Show when={startError()}>
                <div
                  role="alert"
                  class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
                >
                  {startError()}
                </div>
              </Show>

              <Show
                when={isLinkPayable(link())}
                fallback={
                  <div class="rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-900/40 px-4 py-4">
                    <p class="text-sm font-bold text-[#14233A] dark:text-white">
                      {linkClosedMessage(link())}
                    </p>
                    <Show when={link().status}>
                      <p class="mt-1 text-xs font-semibold uppercase tracking-wide text-[#8593A8] dark:text-gray-400">
                        Status: {linkStatusLabel(link().status)}
                      </p>
                    </Show>
                  </div>
                }
              >
                <button
                  type="button"
                  onClick={pay}
                  disabled={starting() || payable() === null}
                  class="w-full py-3.5 rounded-xl bg-[#AC2334] text-white font-bold text-sm hover:bg-[#93192a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {starting()
                    ? "Opening the payment page…"
                    : payable() === null
                      ? "Amount unavailable"
                      : `Pay ${fmtRs(payable(), 2)}`}
                </button>
                <p class="text-xs text-[#8593A8] dark:text-gray-400 text-center">
                  Secure payment through HDFC Bank. Card and UPI are both
                  accepted.
                </p>
              </Show>
            </div>
          </div>
        </Show>

        <p class="mt-6 text-center text-xs text-[#8593A8] dark:text-gray-500">
          Questions about this request? Please contact AAJneeti accounts.
        </p>
      </div>
    </main>
  );
}

function Card(props) {
  return (
    <div class="rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm px-6 py-6">
      {props.children}
    </div>
  );
}
