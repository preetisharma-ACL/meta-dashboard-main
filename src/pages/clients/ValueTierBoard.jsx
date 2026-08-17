import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import {
  fetchValueTierBoard,
  VALUE_TIER_FILTERS,
  VALUE_TIER_DOT,
  VALUE_TIER_UNSET,
  normaliseValueTier,
  valueTierLabel,
  isValueTierMismatch,
  suggestionCaption,
  fmtFunds,
} from "../../services/valueTier";
import ValueTierControl from "../../components/clientValueTier/ValueTierControl";
import ValueTierHistoryDrawer from "../../components/clientValueTier/ValueTierHistoryDrawer";
import Avatar from "../../components/common/Avatar";

// ─── Value Tier board ─────────────────────────────────────────────────────────
// GET /clients/value-tier-board/ — every client, bucketed by the manual value
// tier, each row carrying the tier the month's funding SUGGESTS and the funds
// behind it. Built for the quarterly review pass: sort the mismatches to the top
// and work down the list.
//
// ⚠ INTERNAL CLASSIFICATION. Admin + coordination only, route-gated, and every
// control on the page is gated again inside ValueTierControl. This page must
// never be linked from a client-facing surface.
//
// The tabs filter CLIENT-SIDE from the single fetched list: one round-trip gives
// us the whole board plus the counts that label the tabs, so re-fetching per tab
// would re-request data we already hold and would make the counts and the list
// momentarily disagree. Same reasoning as the engagement status board.
//
// Scope is the backend's, as always — nothing here filters by role.

const TYPE_CHIP = {
  hybrid: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
const typeLabel = (t) =>
  t === "cpl" ? "CPL" : t ? `${t[0].toUpperCase()}${t.slice(1)}` : "—";

export default function ValueTierBoard() {
  const [tab, setTab] = createSignal("all");
  const [query, setQuery] = createSignal("");
  // ── The two review passes ─────────────────────────────────────────────────
  // They are DIFFERENT WORK and are deliberately never summed into one number,
  // for the same reason Engagement and Activity stay apart:
  //   mismatch      a tier IS set and disagrees with what the funding suggests
  //                 → someone decided, and the money has since moved
  //   unclassified  no tier set, but we have a suggestion to offer
  //                 → nobody has decided yet
  // The two sets are disjoint by construction (a mismatch requires a tier; an
  // unclassified row is the absence of one), so this is one selector, not two
  // independent toggles. "unclassified" is the live work today; "mismatch"
  // becomes the live work once tiers exist.
  const [review, setReview] = createSignal("none"); // none | mismatch | unclassified
  const [historyFor, setHistoryFor] = createSignal(null);

  const [board, { mutate, refetch }] = createResource(fetchValueTierBoard);

  const clients = () => board()?.clients ?? [];

  // The row's own `mismatch` boolean is authoritative (the server computed it
  // against the same funding it used for the suggestion); derive only as a
  // fallback so an absent field doesn't silently read as "all clean".
  const rowMismatch = (c) =>
    c.mismatch ?? isValueTierMismatch(c.value_tier, c.suggested_value_tier);

  // No tier set, but the funding computed one worth offering. NOT a mismatch —
  // nothing has been claimed, so there is nothing to contradict. A client with no
  // suggestion either (no funding data at all) is not actionable from here and is
  // deliberately left out of this count.
  const rowUnclassified = (c) =>
    normaliseValueTier(c.value_tier) === VALUE_TIER_UNSET &&
    normaliseValueTier(c.suggested_value_tier) !== VALUE_TIER_UNSET;

  // Has anybody classified anything yet? Decides which "nothing to review" story
  // is the true one — see the empty state below.
  const anyTierSet = createMemo(() =>
    clients().some((c) => normaliseValueTier(c.value_tier) !== VALUE_TIER_UNSET),
  );

  // Counts come from the server's `counts` block, with a local tally as a
  // fallback — a tab labelled "Premium" with no number is a worse failure than a
  // locally-derived one.
  const counts = createMemo(() => {
    const served = board()?.counts ?? {};
    if (Object.keys(served).length) return served;
    const acc = {
      ultra_premium: 0,
      premium: 0,
      standard: 0,
      [VALUE_TIER_UNSET]: 0,
      total: 0,
    };
    for (const c of clients()) {
      acc[normaliseValueTier(c.value_tier)] += 1;
      acc.total += 1;
    }
    return acc;
  });

  const countFor = (key) =>
    key === "all" ? (counts().total ?? clients().length) : (counts()[key] ?? 0);

  const mismatchCount = createMemo(
    () => clients().filter((c) => rowMismatch(c)).length,
  );
  const unclassifiedCount = createMemo(
    () => clients().filter((c) => rowUnclassified(c)).length,
  );

  // Selecting a review pass moves the tier tab with it, because two of the four
  // combinations are dead by definition and a filter that can only ever return
  // nothing is a worse answer than no filter at all:
  //   mismatch ∩ Unset       impossible — a mismatch needs a tier
  //   unclassified ∩ Premium impossible — unclassified IS the unset bucket
  const pickReview = (mode) => {
    const next = review() === mode ? "none" : mode;
    setReview(next);
    if (next === "mismatch" && tab() === VALUE_TIER_UNSET) setTab("all");
    // Unclassified lives entirely in the Unset bucket, so say so in the tabs
    // rather than leaving "All" highlighted over a narrowed list.
    if (next === "unclassified") setTab(VALUE_TIER_UNSET);
  };

  // The mirror of the above: picking a tab that can't contain the active review
  // pass drops the pass instead of showing an empty table.
  const pickTab = (key) => {
    setTab(key);
    if (review() === "mismatch" && key === VALUE_TIER_UNSET) setReview("none");
    if (
      review() === "unclassified" &&
      key !== VALUE_TIER_UNSET &&
      key !== "all"
    )
      setReview("none");
  };

  const visible = createMemo(() => {
    const t = tab();
    const q = query().trim().toLowerCase();
    const pass = review();
    return clients()
      .filter((c) => t === "all" || normaliseValueTier(c.value_tier) === t)
      .filter((c) =>
        pass === "mismatch"
          ? rowMismatch(c)
          : pass === "unclassified"
            ? rowUnclassified(c)
            : true,
      )
      .filter(
        (c) =>
          !q ||
          String(c.client_nomen ?? "").toLowerCase().includes(q) ||
          String(c.client_email ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // Mismatches first — they're the work. Then by funds received this month,
        // largest first, so the biggest commercial exposure is at the top.
        const am = rowMismatch(a) ? 0 : 1;
        const bm = rowMismatch(b) ? 0 : 1;
        if (am !== bm) return am - bm;
        const af = Number(a.month_funds_inc_gst) || 0;
        const bf = Number(b.month_funds_inc_gst) || 0;
        if (af !== bf) return bf - af;
        return String(a.client_nomen ?? a.client_email ?? "").localeCompare(
          String(b.client_nomen ?? b.client_email ?? ""),
          undefined,
          { sensitivity: "base" },
        );
      });
  });

  // Patch the row in place after a successful change and re-tally, so the tab
  // labels, the mismatch flag and the row agree without another round-trip.
  const applyChange = (clientId, { tier, suggested, monthFunds }) => {
    mutate((prev) => {
      if (!prev) return prev;
      const nextClients = prev.clients.map((c) =>
        String(c.client_id) === String(clientId)
          ? {
              ...c,
              value_tier: tier,
              suggested_value_tier: suggested ?? c.suggested_value_tier,
              month_funds_inc_gst: monthFunds ?? c.month_funds_inc_gst,
              // Recomputed locally: the server's boolean described the tier we
              // just replaced, so keeping it would flag a row we just fixed.
              mismatch: isValueTierMismatch(
                tier,
                suggested ?? c.suggested_value_tier,
              ),
            }
          : c,
      );
      const acc = {
        ultra_premium: 0,
        premium: 0,
        standard: 0,
        [VALUE_TIER_UNSET]: 0,
      };
      for (const c of nextClients) acc[normaliseValueTier(c.value_tier)] += 1;
      return {
        clients: nextClients,
        counts: { ...acc, total: nextClients.length },
      };
    });
  };

  const TH =
    "p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap";

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6 lg:p-8">
      {/* ── Header ── */}
      <div class="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
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
                  d="M12 3l4 5-4 13-4-13 4-5zm-4 5h8"
                />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Value Tier
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            How your team classifies each client commercially. Separate from
            engagement status and from live campaign activity — and{" "}
            <b class="font-semibold text-[#AC2334] dark:text-[#E4566A]">
              internal only
            </b>
            : clients never see this.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={board.loading}
          class="px-3.5 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-[#AC2334]/40 disabled:opacity-50 transition"
        >
          {board.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* ── Tabs ── */}
      <div
        class="flex flex-wrap items-center gap-1.5 mb-4"
        role="tablist"
        aria-label="Filter by value tier"
      >
        <For each={VALUE_TIER_FILTERS}>
          {(f) => {
            const on = () => tab() === f.key;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={on()}
                onClick={() => pickTab(f.key)}
                class={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                  on()
                    ? "bg-[#14233A] text-white border-[#14233A]"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                }`}
              >
                <Show when={f.key !== "all"}>
                  <span
                    class={`h-1.5 w-1.5 rounded-full ${
                      on() ? "bg-white" : VALUE_TIER_DOT[f.key]
                    }`}
                  />
                </Show>
                {f.label}
                <span
                  class={`text-[11px] font-bold tabular-nums ${
                    on() ? "text-white/70" : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  ({countFor(f.key)})
                </span>
              </button>
            );
          }}
        </For>
      </div>

      {/* ── Search + mismatch toggle ── */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-full sm:w-[360px]">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by client name or email…"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        {/* The two review passes, side by side and separately counted. Each
            label names what its number counts, so neither can be read as "all
            the outstanding work". */}
        <button
          type="button"
          onClick={() => pickReview("mismatch")}
          aria-pressed={review() === "mismatch"}
          title="Clients whose set tier disagrees with what this month's funding suggests"
          class={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg border transition-colors ${
            review() === "mismatch"
              ? "bg-[#B07A14] text-white border-[#B07A14]"
              : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#B07A14]/50"
          }`}
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
          Disagrees with funding
          <span
            class={`text-[11px] font-bold tabular-nums ${
              review() === "mismatch" ? "text-white/75" : "text-gray-400"
            }`}
          >
            ({mismatchCount()})
          </span>
        </button>

        <button
          type="button"
          onClick={() => pickReview("unclassified")}
          aria-pressed={review() === "unclassified"}
          title="Clients with no tier set, where this month's funding suggests one"
          class={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg border transition-colors ${
            review() === "unclassified"
              ? "bg-[#14233A] text-white border-[#14233A]"
              : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/50"
          }`}
        >
          <span
            class={
              review() === "unclassified" ? "text-[#E9AE5C]" : "text-gray-400"
            }
            aria-hidden="true"
          >
            ◇
          </span>
          Unclassified
          <span
            class={`text-[11px] font-bold tabular-nums ${
              review() === "unclassified" ? "text-white/75" : "text-gray-400"
            }`}
          >
            ({unclassifiedCount()})
          </span>
        </button>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {visible().length} shown
        </span>
      </div>

      {/* ── Table ── */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <th class={TH}>Client</th>
              <th class={TH}>Type</th>
              <th class={TH}>Value tier</th>
              <th class={TH}>Funds this month</th>
              <th class={TH}>Suggested</th>
              <th class={`${TH} text-right`}>History</th>
            </tr>
          </thead>

          <Show
            when={!board.loading}
            fallback={
              <tbody>
                <For each={Array(6).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <For each={Array(6).fill(0)}>
                        {() => (
                          <td class="p-3">
                            <div class="h-3.5 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <Show
              when={!board.error}
              fallback={
                <tbody>
                  <tr>
                    <td colspan="6" class="p-10 text-center">
                      <p class="text-sm font-medium text-[#AC2334]">
                        {board.error?.message ||
                          "Could not load the value tier board."}
                      </p>
                      <button
                        onClick={() => refetch()}
                        class="mt-2 text-sm underline text-gray-500"
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                </tbody>
              }
            >
              <tbody>
                <For each={visible()}>
                  {(c, i) => (
                    <tr
                      class={`border-b border-gray-100 dark:border-gray-800 hover:bg-purple-50/60 dark:hover:bg-gray-800/40 transition-colors ${
                        i() % 2 === 0
                          ? "bg-white dark:bg-gray-900"
                          : "bg-gray-50/60 dark:bg-gray-800/30"
                      }`}
                    >
                      {/* Client */}
                      <td class="p-3">
                        <div class="flex items-center gap-2.5 min-w-0">
                          <Avatar name={c.client_nomen || c.client_email} />
                          <div class="min-w-0">
                            <p class="font-medium text-gray-800 dark:text-gray-100 truncate">
                              {c.client_nomen || "—"}
                            </p>
                            <p class="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {c.client_email || "—"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Client type — the BILLING basis, a third thing again */}
                      <td class="p-3">
                        <span
                          class={`inline-block text-[10px] font-bold tracking-[0.08em] uppercase px-2.5 py-[3px] rounded-full ${
                            TYPE_CHIP[c.client_type] ??
                            "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {typeLabel(c.client_type)}
                        </span>
                      </td>

                      {/* Value tier — clickable badge + inline setter */}
                      <td class="p-3">
                        <ValueTierControl
                          clientId={c.client_id}
                          tier={c.value_tier}
                          suggested={c.suggested_value_tier}
                          monthFunds={c.month_funds_inc_gst}
                          mismatch={rowMismatch(c)}
                          onChanged={(payload) =>
                            applyChange(c.client_id, payload)
                          }
                        />
                      </td>

                      {/* Funds received this month (inc GST) — the evidence */}
                      <td class="p-3 tabular-nums text-gray-700 dark:text-gray-200 whitespace-nowrap">
                        {fmtFunds(c.month_funds_inc_gst) ?? "—"}
                      </td>

                      {/* What that funding suggests */}
                      <td class="p-3 max-w-[280px]">
                        <Show
                          when={
                            normaliseValueTier(c.suggested_value_tier) !==
                            VALUE_TIER_UNSET
                          }
                          fallback={
                            <span class="text-gray-300 dark:text-gray-600">—</span>
                          }
                        >
                          <p
                            class={
                              rowMismatch(c)
                                ? "font-semibold text-[#B07A14] dark:text-amber-400"
                                : "text-gray-500 dark:text-gray-400"
                            }
                          >
                            {valueTierLabel(c.suggested_value_tier)}
                          </p>
                          <Show when={rowMismatch(c)}>
                            <p
                              class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate"
                              title={suggestionCaption(
                                c.suggested_value_tier,
                                c.month_funds_inc_gst,
                              )}
                            >
                              set as {valueTierLabel(c.value_tier)} — review
                            </p>
                          </Show>
                        </Show>
                      </td>

                      {/* History */}
                      <td class="p-3 text-right whitespace-nowrap">
                        <button
                          onClick={() =>
                            setHistoryFor({
                              id: c.client_id,
                              label: c.client_nomen || c.client_email,
                            })
                          }
                          class="text-xs font-semibold text-[#3E6FB0] hover:underline"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  )}
                </For>

                <Show when={visible().length === 0}>
                  <tr>
                    <td
                      colspan="6"
                      class="p-12 text-center text-gray-500 dark:text-gray-400"
                    >
                      <Show
                        when={tab() !== "all" || query() || review() !== "none"}
                        fallback="No clients to show."
                      >
                        <Show
                          when={review() !== "none"}
                          fallback="No clients in this bucket."
                        >
                          {/* "Every tier agrees" is only true if any tier is
                              actually SET. With none set there is nothing to
                              agree or disagree with, and saying otherwise tells
                              the reader the opposite of the truth in exactly the
                              state this board opens in. */}
                          <Show
                            when={review() !== "mismatch" || anyTierSet()}
                            fallback={
                              <>
                                No tier has been set yet, so there's nothing to
                                contradict.{" "}
                                <button
                                  onClick={() => pickReview("unclassified")}
                                  class="font-semibold text-[#3E6FB0] hover:underline"
                                >
                                  Start with the {unclassifiedCount()}{" "}
                                  unclassified
                                </button>
                                .
                              </>
                            }
                          >
                            <Show
                              when={review() === "mismatch"}
                              fallback="Every client with a suggestion has been classified."
                            >
                              Every tier that's been set agrees with this month's
                              funding — nothing to review.
                            </Show>
                          </Show>
                        </Show>
                      </Show>
                    </td>
                  </tr>
                </Show>
              </tbody>
            </Show>
          </Show>
        </table>
      </div>

      <p class="mt-4 text-[12px] text-gray-400 dark:text-gray-500">
        Suggestions come from funds received this month (inc GST): ₹2,00,000 or
        more suggests Ultra Premium, ₹1,00,000 or more Premium, otherwise
        Standard. They are a prompt, never applied automatically — the
        classification is a person's call.
      </p>
      <p class="mt-1.5 text-[12px] text-gray-400 dark:text-gray-500">
        The two review passes count different things and are never added together:{" "}
        <b class="font-semibold">Unclassified</b> is nobody has decided yet;{" "}
        <b class="font-semibold">Disagrees with funding</b> is somebody decided and
        the money has since moved.
      </p>

      <ValueTierHistoryDrawer
        open={!!historyFor()}
        clientId={historyFor()?.id}
        clientLabel={historyFor()?.label}
        onClose={() => setHistoryFor(null)}
      />
    </div>
  );
}
