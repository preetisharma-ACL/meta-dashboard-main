import { createResource, createSignal, For, Show } from "solid-js";
import {
  fetchBudgetGuardQueue,
  budgetChangeSentence,
  thresholdSentence,
  approveSentence,
  guardActions,
  guardIsPartial,
  hasMetaError,
  stateLabel,
  STATE_PILL,
  STATE_PENDING,
  STATE_APPROVED,
  fmtPerDay,
  fmtDateTime,
} from "../../services/budgetGuard";
import { setBudgetGuardPendingCount } from "../../stores/budgetGuardPending";
import BudgetGuardDecisionModal from "../../components/budgetGuard/BudgetGuardDecisionModal";
import SuccessToast, { showToast } from "../../components/common/SuccessToast";
import { errorMessage } from "../../utils/apiErrors";

// ─── Budget Guard ─────────────────────────────────────────────────────────────
// Where a campaign the guard paused AND capped gets released — or doesn't.
//
// The reader of this screen has to be able to answer, without asking anybody:
// what was paused, what the budget was, what it is now, and what happens if they
// approve. So the budget change is one sentence, not two cells to compare, and
// the approve button says what it will restore.
//
// ADMIN ONLY (route-gated; the endpoints 403 everyone else).
//
// EVERY FIGURE IS THE SERVER'S. Nothing on this page is recomputed — not the
// restored budget, not the threshold, not the count. See services/budgetGuard.

const CARD =
  "rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 " +
  "shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]";

const META_LABEL =
  "text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400";

// One identity line: ad account, Meta campaign id, ad set id. All three come off
// the SAME row — this is the screen someone takes to Ads Manager when Meta
// refused the guard, and an id borrowed from a neighbouring payload would send
// them to the wrong campaign.
function IdentityLine(props) {
  const bits = () =>
    [
      props.row.ad_account ? `Ad account ${props.row.ad_account}` : null,
      props.row.meta_campaign_id ? `Campaign ${props.row.meta_campaign_id}` : null,
      props.row.adset_id ? `Ad set ${props.row.adset_id}` : null,
    ].filter(Boolean);

  return (
    <Show when={bits().length}>
      <p class="mt-1 text-xs text-[#54657E] dark:text-gray-400 break-words">
        <For each={bits()}>
          {(bit, i) => (
            <>
              <Show when={i() > 0}>
                <span class="mx-1.5 text-[#C3CBD8] dark:text-gray-600">·</span>
              </Show>
              <span class="tabular-nums">{bit}</span>
            </>
          )}
        </For>
      </p>
    </Show>
  );
}

// What the guard actually managed to apply. Rendered only when something is
// MISSING: a full green checklist on every card would train the eye to skip the
// one card where it matters. A partially applied guard is not a guard.
function PartialGuardNotice(props) {
  const missing = () => guardActions(props.row).filter((a) => !a.done);

  return (
    <Show when={missing().length}>
      <div class="mt-3 rounded-xl border border-[#F5D9A9] bg-[#FEF8EC] dark:border-[#5B4520] dark:bg-[#3A2C12]/50 px-4 py-3">
        <p class="text-[11px] font-bold uppercase tracking-wider text-[#8A5B12] dark:text-[#E9AE5C]">
          The guard only partly applied
        </p>
        <ul class="mt-1.5 space-y-1">
          <For each={missing()}>
            {(action) => (
              <li class="text-sm text-[#7A4F10] dark:text-[#F0C98A] flex items-start gap-2">
                <span aria-hidden="true" class="mt-[2px] font-bold">
                  ✕
                </span>
                <span>
                  {action.label} — <span class="font-semibold">did not apply</span>
                  {action.critical ? "" : " (the ad set stayed live on Meta's side)"}
                </span>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}

// Meta refused part of the pause or the cap. This is the ONE case where somebody
// has to go and look in Ads Manager — the campaign may not actually be stopped,
// and nothing on this screen can tell them whether it is.
function MetaErrorNotice(props) {
  return (
    <Show when={hasMetaError(props.row)}>
      <div class="mt-3 rounded-xl border border-[#F0C2C9] bg-[#FDF2F4] dark:border-red-900/50 dark:bg-red-950/25 px-4 py-3">
        <p class="text-[11px] font-bold uppercase tracking-wider text-[#AC2334] dark:text-red-300">
          Meta refused part of this
        </p>
        <p class="mt-1.5 text-sm text-[#8C1F2C] dark:text-red-200 leading-relaxed break-words">
          {props.row.meta_error}
        </p>
        <p class="mt-2 text-xs font-semibold text-[#8C1F2C] dark:text-red-300">
          Open this campaign in Ads Manager and confirm its real state before
          deciding.
        </p>
      </div>
    </Show>
  );
}

export default function BudgetGuard() {
  const [queue, { refetch }] = createResource(async () => {
    const data = await fetchBudgetGuardQueue();
    // Keep the sidebar/bell badge in step with what this page is showing, from
    // the same response — never a second count from a second source.
    setBudgetGuardPendingCount(data.pendingCount);
    return data;
  });

  const [decision, setDecision] = createSignal(null); // { row, mode }

  const pending = () => queue()?.pending ?? [];
  const recent = () => queue()?.recent ?? [];
  const pendingCount = () => queue()?.pendingCount ?? 0;

  const openDecision = (row, mode) => setDecision({ row, mode });

  const onDecided = (row, mode) => {
    setDecision(null);
    showToast(
      mode === "approve"
        ? `${row.campaign_name || "The campaign"} is back on at ${
            fmtPerDay(row.original_daily_budget) ?? "its original budget"
          }.`
        : `${row.campaign_name || "The campaign"} stays capped at ${
            fmtPerDay(row.capped_daily_budget) ?? "the guard budget"
          }.`,
      mode === "approve" ? "Approved" : "Rejected",
    );
    refetch();
  };

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 lg:p-8">
      <SuccessToast />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 class="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 3l7 4v5c0 4.418-2.985 8.167-7 9-4.015-.833-7-4.582-7-9V7l7-4z"
                />
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 15h.01" />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Budget Guard
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-[#54657E] dark:text-gray-400 mt-0.5 max-w-2xl">
            A campaign whose ad-set daily budget crosses the cap is paused and its
            budget dropped to ₹100/day automatically. It stays that way until an
            admin approves it here, with a reason. The budget cap is the half that
            holds — a pause can be undone by an automated rule, a cap cannot.
          </p>
        </div>

        <button
          onClick={() => refetch()}
          disabled={queue.loading}
          class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition disabled:opacity-50"
        >
          <svg
            class={`w-4 h-4 ${queue.loading ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* Fetch failure — never silently rendered as an empty queue, because an
          empty queue here means "nothing is paused" and that is the one thing a
          failed request must not be allowed to say. */}
      <Show when={queue.error}>
        <div
          role="alert"
          class="mb-6 rounded-2xl border border-[#F0C2C9] bg-[#FDF2F4] dark:border-red-900/50 dark:bg-red-950/25 px-5 py-4"
        >
          <p class="text-sm font-semibold text-[#8C1F2C] dark:text-red-200">
            The approval queue could not be loaded, so this page cannot say
            whether anything is waiting.
          </p>
          <p class="mt-1 text-sm text-[#8C1F2C]/85 dark:text-red-300/85">
            {errorMessage(queue.error, "Request failed.")}
          </p>
        </div>
      </Show>

      {/* ── Pending ────────────────────────────────────────────────────────── */}
      <div class="flex items-center gap-3 mb-3">
        <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
          Waiting for approval
        </h2>
        <Show when={!queue.loading && !queue.error}>
          <span
            class={`inline-flex items-center justify-center min-w-[24px] px-2 py-0.5 rounded-full text-xs font-bold ${
              pendingCount() > 0
                ? "bg-[#AC2334] text-white"
                : "bg-[#F1F4F8] text-[#54657E] dark:bg-gray-700 dark:text-gray-300"
            }`}
          >
            {pendingCount()}
          </span>
        </Show>
      </div>

      <Show
        when={!queue.loading}
        fallback={
          <div class={`${CARD} px-5 py-10 text-center`}>
            <p class="text-sm text-[#54657E] dark:text-gray-400">
              Loading the approval queue…
            </p>
          </div>
        }
      >
        <Show
          when={pending().length > 0}
          fallback={
            <Show when={!queue.error}>
              <div class={`${CARD} px-5 py-10 text-center`}>
                <p class="text-base font-semibold text-[#14233A] dark:text-white">
                  No campaigns are waiting for approval.
                </p>
                {/* Deliberately NOT "all clear": the guard can also fail to read
                    an ad account, and when it does, nothing appears here. That
                    failure surfaces as an alert, not as an empty queue. */}
                <p class="mt-2 text-sm text-[#54657E] dark:text-gray-400 max-w-xl mx-auto">
                  This lists only campaigns the guard has already acted on. If the
                  guard could not read an ad account at all, that surfaces as an
                  alert elsewhere — not here.
                </p>
              </div>
            </Show>
          }
        >
          <div class="space-y-4">
            <For each={pending()}>
              {(row) => (
                <div class={`${CARD} px-5 py-5`}>
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <h3 class="text-base font-bold text-[#14233A] dark:text-white break-words">
                        {row.campaign_name || "Unnamed campaign"}
                      </h3>
                      <IdentityLine row={row} />
                    </div>
                    <span
                      class={`inline-flex flex-shrink-0 items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                        STATE_PILL[row.state] ?? STATE_PILL[STATE_PENDING]
                      }`}
                    >
                      {stateLabel(row.state)}
                    </span>
                  </div>

                  {/* The budget change, as ONE sentence. Both figures come off
                      this row and neither is recomputed. */}
                  <p class="mt-4 text-[15px] font-semibold text-[#14233A] dark:text-gray-100 leading-relaxed">
                    {budgetChangeSentence(row)}
                  </p>

                  <p class="mt-1.5 text-xs text-[#54657E] dark:text-gray-400">
                    <Show when={thresholdSentence(row)}>
                      <span>{thresholdSentence(row)}</span>
                      <span class="mx-1.5 text-[#C3CBD8] dark:text-gray-600">·</span>
                    </Show>
                    <span>Guarded {fmtDateTime(row.created_at)}</span>
                  </p>

                  <MetaErrorNotice row={row} />
                  <PartialGuardNotice row={row} />

                  {/* What approve does, stated before the button is anywhere
                      near the cursor — in this row's own original_daily_budget. */}
                  <p class="mt-4 text-sm text-[#54657E] dark:text-gray-300">
                    {approveSentence(row)}
                  </p>

                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => openDecision(row, "approve")}
                      class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white text-sm font-semibold hover:bg-[#93192a] transition shadow-sm"
                    >
                      Approve and restore
                    </button>
                    <button
                      onClick={() => openDecision(row, "reject")}
                      class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-sm font-semibold text-[#14233A] dark:text-gray-200 hover:bg-[#F1F4F8] dark:hover:bg-gray-700 transition"
                    >
                      Reject
                    </button>
                    <span class="text-xs text-[#8593A8] dark:text-gray-400">
                      Both need a written reason.
                    </span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* ── Recent decisions (read-only) ───────────────────────────────────── */}
      <Show when={recent().length > 0}>
        <h2 class="text-lg font-bold text-[#14233A] dark:text-white mt-10 mb-3">
          Recent decisions
        </h2>

        <div class="space-y-3">
          <For each={recent()}>
            {(row) => (
              <div class={`${CARD} px-5 py-4`}>
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h3 class="text-sm font-bold text-[#14233A] dark:text-white break-words">
                      {row.campaign_name || "Unnamed campaign"}
                    </h3>
                    <IdentityLine row={row} />
                  </div>
                  <span
                    class={`inline-flex flex-shrink-0 items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                      STATE_PILL[row.state] ?? STATE_PILL[STATE_PENDING]
                    }`}
                  >
                    {stateLabel(row.state)}
                  </span>
                </div>

                <div class="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p class={META_LABEL}>Decided by</p>
                    <p class="mt-1 text-sm text-[#14233A] dark:text-gray-100 break-words">
                      {row.decided_by || "—"}
                    </p>
                  </div>
                  <div>
                    <p class={META_LABEL}>When</p>
                    <p class="mt-1 text-sm text-[#14233A] dark:text-gray-100">
                      {fmtDateTime(row.decided_at)}
                    </p>
                  </div>
                  <div>
                    {/* restored_budget is what the SERVER says it put back —
                        printed as returned, never inferred from the approval. */}
                    <p class={META_LABEL}>Budget restored</p>
                    <p class="mt-1 text-sm font-semibold text-[#14233A] dark:text-gray-100 tabular-nums">
                      {fmtPerDay(row.restored_budget) ??
                        (row.state === STATE_APPROVED ? "not recorded" : "—")}
                    </p>
                  </div>
                </div>

                <Show when={row.reason}>
                  <p class="mt-3 text-sm text-[#54657E] dark:text-gray-300 leading-relaxed">
                    <span class={META_LABEL}>Reason</span>{" "}
                    <span class="break-words">“{row.reason}”</span>
                  </p>
                </Show>

                {/* Still worth showing after the fact: a decision taken on a
                    campaign Meta never actually stopped is the one worth
                    re-reading later. */}
                <Show when={hasMetaError(row) || guardIsPartial(row)}>
                  <p class="mt-2 text-xs font-semibold text-[#8A5B12] dark:text-[#E9AE5C]">
                    The guard only partly applied to this campaign when it
                    tripped.
                  </p>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <BudgetGuardDecisionModal
        open={!!decision()}
        mode={decision()?.mode}
        row={decision()?.row}
        onClose={() => setDecision(null)}
        onDecided={onDecided}
      />
    </div>
  );
}
