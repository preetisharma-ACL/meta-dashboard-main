import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import {
  fetchControlHealth,
  fetchControlModels,
  runControlAction,
  testCredential,
  parseControlError,
} from "../../services/control";
import { PageHead, Banner, ReasonDialog, showValue, BTN, CARD } from "./ControlUI";

// ─── System Health (/control/health) — Control Centre landing page ────────────
// GET /control/health/. "Last data" ages are measured against the server's
// `now`, not this browser's clock: amber past 6 h, red past 24 h — red means a
// sync is stuck and the developer needs calling.

const HOUR = 3600 * 1000;
const LAST_DATA_LABELS = {
  campaign_insights_updated: "Campaign insights",
  ad_insights_updated: "Ad insights",
  campaigns_updated: "Campaigns",
  latest_payment_recorded: "Latest payment recorded",
};

const ago = (ms) => {
  if (ms < 0) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
};
const fmtWhen = (t) =>
  t ? new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

// The Celery beat model the task actions run against.
const BEAT = { app: "django_celery_beat", model: "periodictask" };
const TASK_ACTIONS = {
  enable_tasks: "Enable",
  disable_tasks: "Disable",
  run_tasks: "Run now",
};

export default function ControlHealth() {
  const [health, { refetch }] = createResource(fetchControlHealth);
  const h = () => (health.error ? null : health());
  const now = () => (h()?.now ? new Date(h().now).getTime() : Date.now());

  // Where a credential is edited: the Data Console's Meta credentials model,
  // found by name so a renamed model still resolves.
  const [models] = createResource(fetchControlModels);

  const credModel = createMemo(() =>
    (models.error ? [] : (models() ?? [])).find((m) => m.app === "campaigns" && /credential/i.test(`${m.model} ${m.name}`)),
  );
  const credHref = (id) =>
    credModel() ? `/control/data/${credModel().app}/${credModel().model}/${encodeURIComponent(id)}/change` : null;

  // ── Scheduled task actions ──
  const [pending, setPending] = createSignal(null); // { action, task }
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal("");
  const [msg, setMsg] = createSignal(null);
  const runAction = async (reason) => {
    const { action, task } = pending();
    setBusy(true);
    setActionError("");
    try {
      const res = await runControlAction(BEAT.app, BEAT.model, action, [task.id], reason);
      const msgs = (res?.messages ?? []).map((m) => (typeof m === "string" ? m : (m.message ?? showValue(m))));
      setMsg(msgs.join(" ") || `${TASK_ACTIONS[action]}: ${task.name}.`);
      setPending(null);
      refetch();
    } catch (err) {
      setActionError(parseControlError(err, "The action failed.").message);
    } finally {
      setBusy(false);
    }
  };

  // ── Credential tests: { [id]: { loading } | result } ──
  const [tests, setTests] = createSignal({});
  const runTest = async (id) => {
    setTests((t) => ({ ...t, [id]: { loading: true } }));
    const r = await testCredential(id);
    setTests((t) => ({ ...t, [id]: r }));
  };

  const ageTone = (ms) =>
    ms == null
      ? "text-gray-400"
      : ms > 24 * HOUR
        ? "text-red-600 dark:text-red-400"
        : ms > 6 * HOUR
          ? "text-amber-600 dark:text-amber-400"
          : "text-green-700 dark:text-green-400";
  const lastData = () =>
    Object.entries(h()?.last_data ?? {}).map(([k, t]) => {
      const ms = t ? now() - new Date(t).getTime() : null;
      return { key: k, label: LAST_DATA_LABELS[k] ?? k.replace(/_/g, " "), t, ms };
    });
  const stuck = () => lastData().some((x) => x.ms != null && x.ms > 24 * HOUR);

  return (
    <div class="min-h-screen min-w-0 overflow-x-clip p-3 lg:p-8">
      <PageHead
        title="System Health"
        subtitle={h()?.now ? `As of ${fmtWhen(h().now)}` : "Syncs, scheduled tasks, ad accounts and Meta tokens."}
        actions={
          <button type="button" class={BTN} onClick={refetch} disabled={health.loading}>
            {health.loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <Banner>{health.error ? parseControlError(health.error, "Couldn't load system health.").message : ""}</Banner>
      <Banner tone="success">{msg()}</Banner>
      <Show when={stuck()}>
        <Banner>A data sync hasn't run for over 24 hours — it is likely stuck. Call the developer.</Banner>
      </Show>

      <Show when={h()} fallback={<Show when={health.loading}><p class="text-sm text-gray-500 dark:text-gray-400">Loading…</p></Show>}>
        {/* ── Top row: last data, ad accounts, failures ── */}
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section class={`${CARD} p-5 lg:col-span-2`}>
            <h2 class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Last data</h2>
            <ul class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <For each={lastData()}>
                {(x) => (
                  <li class="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                    <p class="text-xs text-gray-500 dark:text-gray-400">{x.label}</p>
                    <p class={`mt-0.5 text-lg font-semibold ${ageTone(x.ms)}`}>{x.ms == null ? "Never" : ago(x.ms)}</p>
                    <p class="text-xs text-gray-400">{fmtWhen(x.t)}</p>
                  </li>
                )}
              </For>
            </ul>
            <p class="mt-3 text-xs text-gray-400">Amber: over 6 hours old. Red: over 24 hours — a sync is stuck.</p>
          </section>

          <div class="space-y-4">
            <section class={`${CARD} p-5`}>
              <h2 class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Ad accounts</h2>
              <p class="mt-2 text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                {h().ad_accounts?.active ?? "—"}
                <span class="text-sm font-medium text-gray-500 dark:text-gray-400"> active of {h().ad_accounts?.total ?? "—"}</span>
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <For each={Object.entries(h().ad_accounts?.by_status ?? {})}>
                  {([s, n]) => (
                    <span class="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300">
                      {s}: {n}
                    </span>
                  )}
                </For>
              </div>
            </section>
            <A
              href="/control/audit?result=failure"
              class={`${CARD} block p-5 hover:border-red-300 dark:hover:border-red-800`}
            >
              <h2 class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Failures · last 24 h</h2>
              <p class={`mt-2 text-2xl font-bold tabular-nums ${Number(h().failures_24h) > 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                {h().failures_24h ?? 0}
              </p>
              <p class="text-xs text-purple-700 dark:text-purple-300">View in Audit Log →</p>
            </A>
          </div>
        </div>

        {/* ── Scheduled tasks ── */}
        <section class={`${CARD} mt-4 overflow-x-auto`}>
          <h2 class="px-5 pt-4 pb-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Scheduled tasks</h2>
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-y border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider text-left">
                <th class="p-3">Name</th>
                <th class="p-3">Task</th>
                <th class="p-3">Schedule</th>
                <th class="p-3">Last run</th>
                <th class="p-3 text-right">Runs</th>
                <th class="p-3">Status</th>
                <th class="p-3" />
              </tr>
            </thead>
            <tbody>
              <For each={h().scheduled_tasks ?? []} fallback={<tr><td colspan="7" class="p-6 text-center text-gray-400">No scheduled tasks.</td></tr>}>
                {(t) => (
                  <tr class="border-b border-gray-100 dark:border-gray-800">
                    <td class="p-3 font-medium text-gray-800 dark:text-gray-200">{t.name}</td>
                    <td class="p-3 font-mono text-xs text-gray-500 dark:text-gray-400">{t.task}</td>
                    <td class="p-3 text-gray-600 dark:text-gray-400">{showValue(t.schedule)}</td>
                    <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {t.last_run_at ? ago(now() - new Date(t.last_run_at).getTime()) : "Never"}
                    </td>
                    <td class="p-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{t.total_run_count ?? 0}</td>
                    <td class="p-3">
                      <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${t.enabled ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
                        {t.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td class="p-3 whitespace-nowrap text-right">
                      <button
                        type="button"
                        class="px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                        onClick={() => { setActionError(""); setPending({ action: t.enabled ? "disable_tasks" : "enable_tasks", task: t }); }}
                      >
                        {t.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        class="ml-2 px-2.5 py-1 text-xs rounded-md border border-blue-200 text-blue-800 dark:border-blue-800 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        onClick={() => { setActionError(""); setPending({ action: "run_tasks", task: t }); }}
                      >
                        Run now
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>

        {/* ── Meta credentials ── */}
        <section class={`${CARD} mt-4 overflow-x-auto`}>
          <h2 class="px-5 pt-4 pb-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Meta credentials</h2>
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-y border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider text-left">
                <th class="p-3">Label</th>
                <th class="p-3">Kind</th>
                <th class="p-3">Token</th>
                <th class="p-3 text-right">Ad accounts</th>
                <th class="p-3">Test</th>
                <th class="p-3" />
              </tr>
            </thead>
            <tbody>
              <For each={h().credentials ?? []} fallback={<tr><td colspan="6" class="p-6 text-center text-gray-400">No credentials.</td></tr>}>
                {(c) => {
                  const r = () => tests()[c.id];
                  return (
                    <tr class="border-b border-gray-100 dark:border-gray-800 align-top">
                      <td class="p-3">
                        <span class="font-medium text-gray-800 dark:text-gray-200">{c.label ?? c.name ?? `#${c.id}`}</span>
                        <Show when={c.label && c.name}>
                          <span class="block text-xs text-gray-400">{c.name}</span>
                        </Show>
                      </td>
                      <td class="p-3 text-gray-600 dark:text-gray-400">{c.kind ?? "—"}</td>
                      <td class="p-3 font-mono text-xs text-gray-500 dark:text-gray-400">{c.access_token ?? "—"}</td>
                      <td class="p-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{showValue(c.ad_accounts)}</td>
                      <td class="p-3 max-w-[22rem]">
                        <button
                          type="button"
                          class="px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                          disabled={r()?.loading}
                          onClick={() => runTest(c.id)}
                        >
                          {r()?.loading ? "Testing…" : "Test token"}
                        </button>
                        <Show when={r() && !r().loading}>
                          <p class={`mt-1 text-xs break-words ${r().ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            {r().ok ? `OK${r().meta_user_name ? ` · ${r().meta_user_name}` : ""}` : (r().error || "Failed.")}
                          </p>
                        </Show>
                      </td>
                      <td class="p-3 text-right">
                        <Show when={credHref(c.id)}>
                          <A href={credHref(c.id)} class="text-xs text-purple-700 dark:text-purple-300 hover:underline">
                            Edit token
                          </A>
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
          <p class="px-5 py-3 text-xs text-gray-400">
            To replace a token, open it in the Data Console and type the new token into the masked field.
          </p>
        </section>
      </Show>

      <ReasonDialog
        open={!!pending()}
        title={`${TASK_ACTIONS[pending()?.action] ?? ""} "${pending()?.task?.name ?? ""}"?`}
        confirmLabel={TASK_ACTIONS[pending()?.action]}
        busy={busy()}
        error={actionError()}
        onCancel={() => setPending(null)}
        onConfirm={runAction}
      >
        <Show when={pending()?.action === "run_tasks"} fallback={<>Scheduled task <span class="font-mono">{pending()?.task?.task}</span>.</>}>
          Queues <span class="font-mono">{pending()?.task?.task}</span> to run now, outside its schedule.
        </Show>
      </ReasonDialog>
    </div>
  );
}
