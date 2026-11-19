import { createSignal, createMemo, onCleanup, onMount, Show } from "solid-js";
import { A, useSearchParams, useNavigate } from "@solidjs/router";
import { isAuthenticated } from "../../utils/auth";
import { errorMessage } from "../../utils/apiErrors";
import {
  fetchResultOrder,
  isAwaitingBank,
  orderStatusLabel,
  fmtRs,
  fmtPayDateTime,
  payNum,
  POLL_INTERVAL_MS,
  POLL_WINDOW_MS,
} from "../../services/hdfcPay";
import { OrderStatusBadge } from "../../components/billing/payStatus";

// ─── /payment-result ──────────────────────────────────────────────────────────
// Where the HDFC gateway returns the browser. A PUBLIC route, mounted outside
// ProtectedRoute and outside Layout, because the person reading it may never
// have had a login: a payment link sent over WhatsApp comes back here with its
// token in `t` and no session at all.
//
// Query: order_id, status, and optionally t (the payment-link token).
//   t present → GET pay/links/<t>/orders/<order_id>/   (public, no auth header)
//   t absent  → GET pay/orders/<order_id>/             (needs a login)
//
// The gateway's own `status` param is a HINT and nothing is decided by it. The
// order read from the API is the authority: a browser can be sent back here
// with any query string, and a receipt that said "paid" because the URL did
// would be a forgery anyone could write. It is used for one thing only, the
// line shown while the first read is still in flight.
//
// WHILE created / pending → poll every 5 s for up to 2 minutes, then stop and
// leave the "you can close this page" message standing. The webhook credits the
// account whether or not this tab is open, so the poll is a courtesy and never
// the mechanism.

const POLL_LIMIT = Math.ceil(POLL_WINDOW_MS / POLL_INTERVAL_MS);

export default function PaymentResult() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const orderId = () => params.order_id ?? "";
  const token = () => params.t ?? "";
  const loggedIn = isAuthenticated();

  const [order, setOrder] = createSignal(null);
  const [error, setError] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  // Polls spent, so the window closes after two minutes rather than running for
  // as long as the tab stays open.
  const [polls, setPolls] = createSignal(0);
  const [gaveUp, setGaveUp] = createSignal(false);

  // No login and no token: there is nothing this page can read. Send them to
  // log in and bring them back to THIS url, query string included.
  onMount(() => {
    if (!token() && !loggedIn) {
      const here = `${window.location.pathname}${window.location.search}`;
      navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
    }
  });

  const canRead = () => !!orderId() && (!!token() || loggedIn);

  const load = async () => {
    try {
      const res = await fetchResultOrder({
        orderId: orderId(),
        token: token() || null,
      });
      setOrder(res);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "This payment could not be found."));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    if (!canRead()) {
      setLoading(false);
      return;
    }
    load();
  });

  // ── Poll ──
  // ONE interval for the life of the page, started on mount and stopped the
  // moment the status goes terminal or the two-minute window runs out. It is
  // deliberately not driven off order() changing: an effect keyed on the order
  // would tear down and rebuild its own timer on every successful poll, which
  // is a 5 s window that silently resets itself and a counter that is easy to
  // get wrong. Here the tick count IS the window.
  //
  // A failed read does not stop the poll: one 502 is not an answer about a
  // payment. Reading polls()/order() inside the callback is untracked, which is
  // what we want — this effect must run exactly once.
  onMount(() => {
    if (!canRead()) return;

    const timer = setInterval(() => {
      // Nothing read yet, or the bank has answered: stop.
      const o = order();
      if (o && !isAwaitingBank(o.status)) {
        clearInterval(timer);
        return;
      }
      const spent = polls() + 1;
      setPolls(spent);
      if (spent >= POLL_LIMIT) {
        setGaveUp(true);
        clearInterval(timer);
      }
      load();
    }, POLL_INTERVAL_MS);

    onCleanup(() => clearInterval(timer));
  });

  const status = () => String(order()?.status ?? "").toLowerCase();
  const waiting = () => isAwaitingBank(status());

  // Where "Try again" goes. A link holder has no billing page to return to, so
  // they go back to the link itself, which issues a fresh order.
  const retryHref = () => (token() ? `/pay/${token()}` : "/billing");

  const clientName = () => order()?.client ?? null;

  const hint = createMemo(() => String(params.status ?? "").toLowerCase());

  return (
    <main class="min-h-screen bg-[#F6F9FC] dark:bg-gray-900 px-4 py-10 sm:py-14 print:bg-white print:py-0">
      <div class="mx-auto w-full max-w-xl">
        {/* ── Brand line. Hidden in print: the receipt below carries its own. ── */}
        <div class="mb-6 text-center print:hidden">
          <p class="text-xs font-bold uppercase tracking-[0.18em] text-[#AC2334]">
            AAJneeti
          </p>
          <h1 class="mt-1 text-xl font-bold text-[#14233A] dark:text-white">
            Payment result
          </h1>
        </div>

        {/* ── Nothing to read ── */}
        <Show when={!orderId()}>
          <Card>
            <p class="text-sm font-medium text-[#54657E] dark:text-gray-300">
              This address is missing its order reference, so there is no payment
              to show. Please open the link from your receipt or your billing
              page again.
            </p>
          </Card>
        </Show>

        <Show when={orderId()}>
          {/* ── Loading ── */}
          <Show when={loading()}>
            <Card>
              <div class="flex items-center gap-3">
                <Spinner />
                <p class="text-sm font-semibold text-[#54657E] dark:text-gray-300">
                  {hint() === "failed"
                    ? "Checking what happened to your payment…"
                    : "Checking your payment…"}
                </p>
              </div>
            </Card>
          </Show>

          {/* ── Read failed ── */}
          <Show when={!loading() && error() && !order()}>
            <Card>
              <Heading tone="gray">We could not find this payment</Heading>
              <p class="mt-2 text-sm text-[#54657E] dark:text-gray-300">
                {error()}
              </p>
              <Actions>
                <Show when={loggedIn}>
                  <PrimaryLink href="/billing">Go to billing</PrimaryLink>
                </Show>
                <Show when={token()}>
                  <PrimaryLink href={`/pay/${token()}`}>
                    Back to the payment link
                  </PrimaryLink>
                </Show>
              </Actions>
            </Card>
          </Show>

          {/* ── Waiting for the bank ── */}
          <Show when={!loading() && order() && waiting()}>
            <Card>
              <div class="flex items-start gap-3">
                <Show when={!gaveUp()} fallback={<ClockIcon />}>
                  <Spinner />
                </Show>
                <div>
                  <Heading tone="amber">Waiting for the bank to confirm</Heading>
                  <p class="mt-2 text-sm text-[#54657E] dark:text-gray-300">
                    You can close this page; your account updates automatically.
                  </p>
                  <Show when={gaveUp()}>
                    <p class="mt-2 text-sm text-[#54657E] dark:text-gray-300">
                      The bank is still confirming. Nothing is lost: the payment
                      will appear in your billing once it clears.
                    </p>
                  </Show>
                </div>
              </div>
              <Receipt order={order()} compact />
            </Card>
          </Show>

          {/* ── Paid ── */}
          <Show when={!loading() && status() === "charged"}>
            <div class="rounded-2xl border border-green-200 dark:border-green-900 bg-white dark:bg-gray-800 shadow-sm overflow-hidden print:border-gray-300 print:shadow-none">
              <div class="bg-green-50 dark:bg-green-950/40 px-6 py-5 border-b border-green-200 dark:border-green-900 print:bg-white">
                <div class="flex items-center gap-3">
                  <span class="w-10 h-10 shrink-0 rounded-full bg-green-600 text-white grid place-items-center">
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="3"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </span>
                  <div>
                    <h2 class="text-lg font-bold text-green-900 dark:text-green-200">
                      Payment received
                    </h2>
                    <p class="text-sm font-medium text-green-800/80 dark:text-green-300/80">
                      Thank you
                      {clientName() ? `, ${clientName()}` : ""}. Your account has
                      been credited.
                    </p>
                  </div>
                </div>
              </div>

              <div class="px-6 py-5">
                <Receipt order={order()} />
              </div>

              <div class="px-6 pb-6 flex flex-wrap gap-3 print:hidden">
                <button
                  type="button"
                  onClick={() => window.print()}
                  class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] transition-colors"
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
                    <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-12 0v4h12v-4m-12 0h12" />
                  </svg>
                  Print
                </button>
                <Show when={loggedIn}>
                  <A
                    href="/billing"
                    class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition-colors"
                  >
                    Go to billing
                  </A>
                </Show>
              </div>
            </div>
          </Show>

          {/* ── Failed ── */}
          <Show when={!loading() && status() === "failed"}>
            <Card>
              <Heading tone="red">Your payment did not go through</Heading>
              <p class="mt-2 text-sm text-[#54657E] dark:text-gray-300">
                {order()?.error ||
                  "The bank did not complete this payment. No amount has been credited."}
              </p>
              <Receipt order={order()} compact />
              <Actions>
                <PrimaryLink href={retryHref()}>Try again</PrimaryLink>
              </Actions>
            </Card>
          </Show>

          {/* ── Mismatch ──
              Deliberately NOT worded as a failure. The money may well have left
              the client's account; what has not matched is our record of it, and
              telling them it failed would be both wrong and alarming. */}
          <Show when={!loading() && status() === "mismatch"}>
            <Card>
              <Heading tone="amber">We need to verify this payment</Heading>
              <p class="mt-2 text-sm text-[#54657E] dark:text-gray-300">
                Our accounts team will contact you.
              </p>
              <Receipt order={order()} compact />
              <Actions>
                <Show when={loggedIn}>
                  <PrimaryLink href="/billing">Go to billing</PrimaryLink>
                </Show>
              </Actions>
            </Card>
          </Show>

          {/* ── Expired ── */}
          <Show when={!loading() && status() === "expired"}>
            <Card>
              <Heading tone="gray">This payment was not completed.</Heading>
              <Receipt order={order()} compact />
              <Actions>
                <PrimaryLink href={retryHref()}>Try again</PrimaryLink>
              </Actions>
            </Card>
          </Show>

          {/* ── A status outside the six ──
              Shown rather than swallowed: the server's own label is more use to
              both the client and the accounts desk than a blank page would be. */}
          <Show
            when={
              !loading() &&
              order() &&
              !waiting() &&
              !["charged", "failed", "mismatch", "expired"].includes(status())
            }
          >
            <Card>
              <Heading tone="gray">{orderStatusLabel(order())}</Heading>
              <p class="mt-2 text-sm text-[#54657E] dark:text-gray-300">
                Please contact AAJneeti accounts quoting order{" "}
                {order()?.order_id} so we can confirm this for you.
              </p>
              <Receipt order={order()} compact />
            </Card>
          </Show>
        </Show>

        <p class="mt-6 text-center text-xs text-[#8593A8] dark:text-gray-500 print:hidden">
          Questions about this payment? Please contact AAJneeti accounts.
        </p>
      </div>
    </main>
  );
}

// ── Receipt body ──
// Every field the endpoint returns. `compact` drops the heading and the money
// emphasis, for the states where the figures are context rather than the point.
function Receipt(props) {
  const o = () => props.order ?? {};
  const has = (v) => v !== null && v !== undefined && v !== "";
  const tdsPct = () => payNum(o().tds_pct);

  return (
    <div class={props.compact ? "mt-5" : ""}>
      <Show when={!props.compact}>
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Receipt
          </h3>
          <OrderStatusBadge order={o()} />
        </div>
      </Show>

      <dl class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 divide-y divide-[#E2E8F1] dark:divide-gray-700 overflow-hidden">
        <Field label="Order ID" value={o().order_id} mono />
        <Show when={props.compact}>
          <Field label="Status" node={<OrderStatusBadge order={o()} />} />
        </Show>
        <Show when={has(o().client)}>
          <Field label="Client" value={o().client} />
        </Show>
        <Show when={has(o().paid_on)}>
          <Field label="Paid on" value={fmtPayDateTime(o().paid_on)} />
        </Show>
        <Show when={has(o().method)}>
          <Field label="Method" value={o().method} />
        </Show>
        <Show when={has(o().bank_ref)}>
          <Field label="Bank reference" value={o().bank_ref} mono />
        </Show>
        <Field label="Amount (ex GST)" value={fmtRs(o().amount_ex_gst, 2)} />
        <Field
          label={payNum(o().gst_pct) === null ? "GST" : `GST ${payNum(o().gst_pct)}%`}
          value={fmtRs(o().gst_amount, 2)}
        />
        <Field label="Total incl. GST" value={fmtRs(o().including_gst, 2)} />
        <Show when={payNum(o().tds_amount) !== null && payNum(o().tds_amount) > 0}>
          <Field
            label={`TDS deducted${tdsPct() ? ` (${tdsPct()}%)` : ""}`}
            value={`- ${fmtRs(o().tds_amount, 2)}`}
          />
        </Show>
        <Field label="Amount paid" value={fmtRs(o().amount_paid, 2)} strong />
        <Field label="Credited to the account" value={fmtRs(o().credited, 2)} />
      </dl>
    </div>
  );
}

function Field(props) {
  return (
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 bg-white dark:bg-gray-800/40">
      <dt class="text-sm text-[#54657E] dark:text-gray-400">{props.label}</dt>
      <dd
        class={
          "text-sm text-right " +
          (props.mono ? "font-mono text-xs break-all " : "") +
          (props.strong
            ? "font-bold text-base text-[#14233A] dark:text-white tabular-nums"
            : "font-semibold text-[#14233A] dark:text-gray-100 tabular-nums")
        }
      >
        {props.node ?? (props.value === "" || props.value == null ? "—" : props.value)}
      </dd>
    </div>
  );
}

function Card(props) {
  return (
    <div class="rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm px-6 py-6">
      {props.children}
    </div>
  );
}

const HEADING_TONE = {
  green: "text-green-800 dark:text-green-300",
  amber: "text-amber-800 dark:text-amber-300",
  red: "text-[#AC2334] dark:text-red-300",
  gray: "text-[#14233A] dark:text-white",
};

function Heading(props) {
  return (
    <h2 class={`text-lg font-bold ${HEADING_TONE[props.tone] ?? HEADING_TONE.gray}`}>
      {props.children}
    </h2>
  );
}

function Actions(props) {
  return (
    <div class="mt-5 flex flex-wrap gap-3 print:hidden">{props.children}</div>
  );
}

function PrimaryLink(props) {
  return (
    <A
      href={props.href}
      class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] transition-colors"
    >
      {props.children}
    </A>
  );
}

function Spinner() {
  return (
    <svg
      class="w-5 h-5 shrink-0 animate-spin text-[#14233A] dark:text-gray-300"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="4"
      />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      class="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
