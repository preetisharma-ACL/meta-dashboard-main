import { createSignal, createResource, Show } from "solid-js";
import { canUseAI } from "../stores/currentUser";
import { fetchAIInsight } from "../services/cm";

// Admin + Tier 1 only. Renders an "AI Insight" button on the campaign detail
// view. The call is a live LLM request (2–4s) — we use createResource so the
// page never blocks. `insight` may be null (AI unavailable); that is NOT an
// error — we still show the grounding metrics and a quiet note.
//
// Props: campaignId (required), startDate?, endDate?  (omit dates → 14-day default)
export default function AIInsightButton(props) {
  // request: null = not requested yet. { id, refresh } triggers a fetch.
  const [request, setRequest] = createSignal(null);
  const [forbidden, setForbidden] = createSignal(false);
  let tick = 0;

  const [result] = createResource(request, async (req) => {
    try {
      const res = await fetchAIInsight(props.campaignId, {
        startDate: props.startDate,
        endDate: props.endDate,
        refresh: req.refresh,
      });
      return res?.data ?? null;
    } catch (err) {
      // Tier 2 / client shouldn't reach here (button is gated), but fail quietly.
      if (err?.status === 403) {
        setForbidden(true);
        return null;
      }
      throw err;
    }
  });

  const run = (refresh = false) => setRequest({ id: ++tick, refresh });

  const fmtPct = (v) =>
    v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;
  const fmtCPL = (v) =>
    v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const relTime = (iso) => {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <Show when={canUseAI() && !forbidden()}>
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-purple-200 dark:border-purple-900/50 mb-8 overflow-hidden">
        {/* Header / trigger */}
        <div class="flex items-center justify-between gap-3 p-5 border-b border-gray-100 dark:border-gray-800 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 flex items-center justify-center">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z" />
                <path d="M5 16l.75 2.25L8 19l-2.25.75L5 22l-.75-2.25L2 19l2.25-.75z" />
              </svg>
            </span>
            <div>
              <h2 class="font-semibold text-gray-800 dark:text-white">AI Insight</h2>
              <p class="text-xs text-gray-400 dark:text-gray-500">Smart, grounded campaign analysis</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Show when={request() && result() && !result.loading}>
              <button
                onClick={() => run(true)}
                disabled={result.loading}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                </svg>
                Refresh
              </button>
            </Show>
            <Show when={!request()}>
              <button
                onClick={() => run(false)}
                class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-colors"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z" />
                </svg>
                Generate AI Insight
              </button>
            </Show>
          </div>
        </div>

        {/* Body */}
        <Show when={request()}>
          <div class="p-5">
            {/* Loading */}
            <Show when={result.loading}>
              <div class="flex items-start gap-3">
                <span class="mt-1 w-4 h-4 rounded-full border-2 border-purple-300 border-t-purple-600 animate-spin flex-shrink-0" />
                <div class="flex-1 space-y-2">
                  <div class="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full animate-pulse" />
                  <div class="h-3 bg-gray-100 dark:bg-gray-800 rounded w-5/6 animate-pulse" />
                  <p class="text-xs text-gray-400 dark:text-gray-500 pt-1">
                    Analyzing campaign… this takes a few seconds.
                  </p>
                </div>
              </div>
            </Show>

            {/* Error (not 403) */}
            <Show when={result.error}>
              <div class="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                Couldn't generate an insight right now.
                <button onClick={() => run(false)} class="underline font-medium">Retry</button>
              </div>
            </Show>

            {/* Result */}
            <Show when={!result.loading && !result.error && result()}>
              {(() => {
                const d = result();
                const m = d.metrics ?? {};
                return (
                  <div class="space-y-4">
                    {/* Insight text (or unavailable note) */}
                    <Show
                      when={d.insight}
                      fallback={
                        <div class="px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 text-sm text-gray-500 dark:text-gray-400 italic">
                          AI insight unavailable right now — showing the underlying metrics below.
                        </div>
                      }
                    >
                      <div class="px-4 py-3 rounded-lg bg-purple-50 dark:bg-purple-900/15 border border-purple-100 dark:border-purple-900/40 text-[15px] leading-relaxed text-gray-800 dark:text-gray-100">
                        {d.insight}
                      </div>
                    </Show>

                    {/* Based on: grounding metrics */}
                    <div>
                      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                        Based on
                      </p>
                      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Metric label="CPL" value={fmtCPL(m.cpl)} />
                        <Metric
                          label={`vs ${m.comparison_basis ?? "project"} avg`}
                          value={fmtPct(m.cpl_vs_project_pct)}
                          tone={m.cpl_vs_project_pct == null ? "" : m.cpl_vs_project_pct <= 0 ? "good" : "bad"}
                        />
                        <Metric
                          label="Rank by CPL"
                          value={
                            m.rank_by_cpl != null && m.peer_campaign_count != null
                              ? `#${m.rank_by_cpl} / ${m.peer_campaign_count}`
                              : "—"
                          }
                        />
                        <Metric
                          label="Leads WoW"
                          value={fmtPct(m.leads_wow_pct)}
                          tone={m.leads_wow_pct == null ? "" : m.leads_wow_pct >= 0 ? "good" : "bad"}
                        />
                      </div>
                    </div>

                    {/* cached / generated_at */}
                    <div class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                      <Show when={d.cached} fallback={<span class="inline-flex items-center gap-1 text-green-600 dark:text-green-400">● just generated</span>}>
                        <span class="inline-flex items-center gap-1">● cached</span>
                      </Show>
                      <Show when={d.generated_at}>
                        <span>· {relTime(d.generated_at)}</span>
                      </Show>
                    </div>
                  </div>
                );
              })()}
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function Metric(props) {
  const tone =
    props.tone === "good"
      ? "text-green-600 dark:text-green-400"
      : props.tone === "bad"
        ? "text-red-600 dark:text-red-400"
        : "text-gray-800 dark:text-gray-100";
  return (
    <div class="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
      <p class="text-[11px] text-gray-400 dark:text-gray-500">{props.label}</p>
      <p class={`text-sm font-semibold mt-0.5 ${tone}`}>{props.value}</p>
    </div>
  );
}
