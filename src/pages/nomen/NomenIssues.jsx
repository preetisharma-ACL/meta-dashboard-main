import { createSignal, createEffect, on, onCleanup, For, Show } from "solid-js";
import {
  fetchNomenIssues,
  runNomenCheck,
  runErrorMessage,
} from "../../services/nomenIssues";
import { setNomenIssuesOpen } from "../../stores/nomenIssuesCount";
import { scopeKey } from "../../stores/cmScope";
import { istDate } from "../../services/deadClients";
import { timeAgo } from "../../services/drive";
import { count, DASH } from "../../services/commandRules";
import { loadErrorMessage } from "../../utils/apiErrors";
import { showNotice } from "../../components/common/NoticeToast";

// ─── Wrong campaign names (/nomen-issues) ─────────────────────────────────────
// Admin, coordination and every CM tier. The backend scopes the rows (Tier 2/3
// see only their own clients / ad accounts); the route only decides whether the
// page is offered. Read-only apart from "Run check now". See
// services/nomenIssues.js for the payload.

const TH =
  "p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap bg-gray-50 dark:bg-gray-800 sticky top-0 z-10";
const THR = TH.replace("text-left", "text-right");
const TD = "p-3 align-top";

const STATUS_CHIP = {
  Active: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-800",
  Paused: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800",
  Completed: "bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700",
};

// Days a name has been wrong. 0 = found today; 3+ is overdue and goes red.
const STALE_DAYS = 3;

function CampaignName(props) {
  return (
    <div class="max-w-[360px]">
      <div class="font-medium text-[#14233A] dark:text-gray-100 break-words">{props.r.campaign_name || DASH}</div>
      <Show when={props.r.campaign_id}>
        <div class="text-[11px] text-gray-400 tabular-nums">{props.r.campaign_id}</div>
      </Show>
    </div>
  );
}

export default function NomenIssues() {
  const [tab, setTab] = createSignal("open");
  const [open, setOpen] = createSignal(null);
  const [fixed, setFixed] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [running, setRunning] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  let seq = 0;
  const load = async () => {
    const mine = ++seq;
    setLoading(true);
    setError(null);
    try {
      const [o, f] = await Promise.all([fetchNomenIssues("open"), fetchNomenIssues("fixed")]);
      if (mine !== seq) return;
      setOpen(o);
      setFixed(f);
      setNomenIssuesOpen(o.count); // keep the sidebar badge in step
      setNow(Date.now());
    } catch (err) {
      if (mine === seq) setError(err);
    } finally {
      if (mine === seq) setLoading(false);
    }
  };
  // Re-keyed on the CM "Viewing" switch: every CM GET carries it.
  createEffect(on(scopeKey, () => load()));

  const tick = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(tick));

  const run = async () => {
    if (running()) return;
    setRunning(true);
    try {
      const r = await runNomenCheck();
      showNotice(
        `Checked ${count(r.checked ?? 0)} campaigns, ${count(r.incorrect ?? 0)} still wrong, ${count(r.fixed ?? 0)} fixed`,
      );
      await load();
    } catch (err) {
      showNotice(runErrorMessage(err), "warn");
    } finally {
      setRunning(false);
    }
  };

  const lastRunAt = () => open()?.lastRunAt ?? fixed()?.lastRunAt ?? null;
  const rows = () => (tab() === "open" ? open()?.rows : fixed()?.rows) ?? [];

  const TabBtn = (p) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab() === p.k}
      onClick={() => setTab(p.k)}
      class={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
        tab() === p.k
          ? "bg-[#14233A] text-white shadow-sm dark:bg-gray-600"
          : "text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700"
      }`}
    >
      {p.label}{" "}
      <span class="tabular-nums opacity-80">({p.n == null ? "…" : count(p.n)})</span>
    </button>
  );

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* Header */}
      <div class="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div class="max-w-3xl">
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white">Wrong campaign names</h1>
          <p class="mt-1 text-sm text-[#54657E] dark:text-gray-400">
            Campaign names must be clientNomen | projectNomen | ... exactly as in the
            Nomenclature sheet (same capitals, same spaces). Paused and stopped campaigns
            must be fixed too.
          </p>
          <p class="mt-1 text-xs text-gray-400">
            <Show when={lastRunAt()} fallback={<>&nbsp;</>}>
              <span title={lastRunAt()}>Last checked {timeAgo(lastRunAt(), now())}</span>
            </Show>
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running()}
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#14233A] text-white hover:bg-[#1d3255] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <svg class={`w-4 h-4 ${running() ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {running() ? "Checking..." : "Run check now"}
        </button>
      </div>

      {/* Tabs */}
      <div role="tablist" class="inline-flex items-center gap-1 p-1 mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <TabBtn k="open" label="Open" n={open()?.count} />
        <TabBtn k="fixed" label="Fixed in last 30 days" n={fixed()?.count} />
      </div>

      <Show when={error()}>
        <div class="mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-800">
          {loadErrorMessage(error(), "Couldn't load the nomen issues.")}{" "}
          <button type="button" class="underline font-semibold" onClick={load}>Try again</button>
        </div>
      </Show>

      <Show
        when={!loading() || open()}
        fallback={<p class="text-sm text-gray-400">Loading...</p>}
      >
        <Show
          when={rows().length}
          fallback={
            <Show when={!error()}>
              <div class="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-4 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {tab() === "open"
                  ? "All campaign names are correct."
                  : "Nothing was fixed in the last 30 days."}
              </div>
            </Show>
          }
        >
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-auto max-h-[calc(100vh-18rem)]">
            <table class="min-w-full text-sm">
              <Show
                when={tab() === "open"}
                fallback={
                  <>
                    <thead>
                      <tr>
                        <th class={TH}>Campaign name</th>
                        <th class={TH}>Ad account</th>
                        <th class={TH}>Problem</th>
                        <th class={TH}>Found on</th>
                        <th class={TH}>Fixed on</th>
                        <th class={THR}>Days it took</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={rows()}>
                        {(r) => (
                          <tr class="border-t border-gray-100 dark:border-gray-800">
                            <td class={TD}><CampaignName r={r} /></td>
                            <td class={`${TD} text-gray-700 dark:text-gray-300 whitespace-nowrap`}>{r.ad_account || DASH}</td>
                            <td class={`${TD} text-gray-700 dark:text-gray-300 max-w-[320px]`}>{r.problem || DASH}</td>
                            <td class={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>{istDate(r.first_seen) ?? DASH}</td>
                            <td class={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>{istDate(r.resolved_at) ?? DASH}</td>
                            <td class={`${TD} text-right tabular-nums`}>{r.days_incorrect == null ? DASH : count(r.days_incorrect)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </>
                }
              >
                <thead>
                  <tr>
                    <th class={TH}>Campaign name</th>
                    <th class={TH}>Ad account</th>
                    <th class={TH}>Status</th>
                    <th class={TH}>Started on</th>
                    <th class={TH}>Problem</th>
                    <th class={TH}>Closest correct nomen</th>
                    <th class={THR}>Days incorrect</th>
                    <th class={TH}></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={rows()}>
                    {(r) => {
                      const stale = () => Number(r.days_incorrect) >= STALE_DAYS;
                      return (
                        <tr class={`border-t border-gray-100 dark:border-gray-800 ${stale() ? "bg-red-50/40 dark:bg-red-900/10" : ""}`}>
                          <td class={TD}><CampaignName r={r} /></td>
                          <td class={`${TD} text-gray-700 dark:text-gray-300 whitespace-nowrap`}>{r.ad_account || DASH}</td>
                          <td class={TD}>
                            <Show when={r.status} fallback={DASH}>
                              <span class={`inline-flex px-2 py-[2px] rounded-full text-[11px] font-semibold ring-1 ${STATUS_CHIP[r.status] ?? STATUS_CHIP.Completed}`}>
                                {r.status}
                              </span>
                            </Show>
                          </td>
                          <td class={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>{istDate(r.started_on) ?? DASH}</td>
                          <td class={`${TD} text-gray-700 dark:text-gray-300 max-w-[320px]`}>{r.problem || DASH}</td>
                          <td class={`${TD} text-gray-700 dark:text-gray-300 max-w-[280px] break-words`}>{r.hint || "-"}</td>
                          <td class={`${TD} text-right tabular-nums whitespace-nowrap`}>
                            <Show
                              when={Number(r.days_incorrect) !== 0}
                              fallback={
                                <span class="inline-flex px-2 py-[2px] rounded-full text-[11px] font-bold bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/30 dark:text-blue-300">New</span>
                              }
                            >
                              <span class={stale() ? "font-bold text-[#AC2334] dark:text-red-300" : "text-gray-700 dark:text-gray-300"}>
                                {r.days_incorrect == null ? DASH : count(r.days_incorrect)}
                              </span>
                            </Show>
                          </td>
                          <td class={`${TD} text-right`}>
                            <Show when={r.ads_manager_url}>
                              <a
                                href={r.ads_manager_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ring-1 ring-gray-300 dark:ring-gray-600 text-[#14233A] dark:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap"
                              >
                                Open in Ads Manager
                                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                                </svg>
                              </a>
                            </Show>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </Show>
            </table>
          </div>
        </Show>
      </Show>
    </section>
  );
}
