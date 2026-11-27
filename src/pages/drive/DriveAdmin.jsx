import { createResource, createSignal, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  fetchDriveLogs,
  fetchDriveMissing,
  actionLabel,
} from "../../services/drive";
import { istDateTime } from "../../services/deadClients";
import { loadErrorMessage } from "../../utils/apiErrors";
import { openClientPage } from "../../utils/openClientPage";

// ─── Google Drive (admin + coordination) ──────────────────────────────────────
// Two tables:
//   • Clients without a Drive folder   GET /clients/drive/missing/
//   • Drive create log                 GET /clients/drive/logs/?limit=100[&nomen_id=]
// Both endpoints are admin + coordination only; the route gate only decides
// whether the screen is offered.
//
// Row keys, confirmed on prod (rows are `data` of { success, message, data }):
//   missing → nomen_id, client_nomen, status, message, refreshed_at
//   logs    → nomen_name, user_email, action, state, status_code, message,
//             result_url, created_at, finished_at
// The log row carries no nomen id, so its client is plain text, not a link.

const TH =
  "p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap";
const TD = "p-3 align-top";

const STATE_PILL = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-800",
  failed: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/20 dark:text-red-300 dark:ring-red-800",
  pending: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800",
};
const STATUS_PILL = {
  missing: STATE_PILL.pending,
  conflict: STATE_PILL.failed,
  error: STATE_PILL.failed,
};
const NEUTRAL_PILL =
  "bg-gray-50 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700";

function Pill(props) {
  return (
    <span
      class={`inline-flex px-2 py-[2px] rounded-full text-[11px] font-semibold ring-1 whitespace-nowrap ${props.class}`}
    >
      {props.children}
    </span>
  );
}

function Missing() {
  return <span class="text-[12px] italic text-gray-300 dark:text-gray-500">—</span>;
}

function Section(props) {
  return (
    <div class="mb-8">
      <div class="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h2 class="text-base font-bold text-[#14233A] dark:text-white">{props.title}</h2>
          <p class="text-xs text-[#54657E] dark:text-gray-400">{props.sub}</p>
        </div>
        {props.actions}
      </div>
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-auto max-h-[60vh]">
        {props.children}
      </div>
    </div>
  );
}

export default function DriveAdmin() {
  const navigate = useNavigate();
  const [logFor, setLogFor] = createSignal(null); // { nomenId, name } | null

  const [missing, { refetch: refetchMissing }] = createResource(fetchDriveMissing);
  const [logs, { refetch: refetchLogs }] = createResource(
    () => ({ nomenId: logFor()?.nomenId ?? null }),
    ({ nomenId }) => fetchDriveLogs({ limit: 100, nomenId }),
  );

  const openClient = (r) =>
    openClientPage(navigate, { nomen: r.client_nomen, nomenId: r.nomen_id });

  const reloadBtn = (fn) => (
    <button
      type="button"
      onClick={fn}
      class="px-3 py-1.5 rounded-lg text-xs font-semibold ring-1 ring-gray-300 dark:ring-gray-600 text-[#14233A] dark:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
    >
      Reload
    </button>
  );

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">Google Drive</h1>
      <p class="text-sm text-[#54657E] dark:text-gray-400 mb-6">
        Client folders that need attention, and every create action taken from the dashboard.
      </p>

      {/* ── Clients without a Drive folder ── */}
      <Section
        title="Clients without a Drive folder"
        sub={
          missing.state === "ready"
            ? `${missing().length} client${missing().length === 1 ? "" : "s"}`
            : " "
        }
        actions={reloadBtn(refetchMissing)}
      >
        <table class="min-w-full text-sm">
          <thead class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800">
            <tr>
              <th class={TH}>Client</th>
              <th class={TH}>Status</th>
              <th class={TH}>Message</th>
              <th class={TH}>Last checked</th>
              <th class={TH}></th>
            </tr>
          </thead>
          <tbody>
            <Show when={missing.state !== "pending" && missing.state !== "refreshing"} fallback={
              <tr><td colSpan={5} class="p-6 text-center text-xs text-gray-400">Loading...</td></tr>
            }>
              <Show when={!missing.error} fallback={
                <tr><td colSpan={5} class="p-6 text-center text-xs text-red-600 dark:text-red-300">
                  {loadErrorMessage(missing.error)}
                </td></tr>
              }>
                <Show when={missing()?.length} fallback={
                  <tr><td colSpan={5} class="p-6 text-center text-xs text-gray-400">
                    Every client has a Drive folder.
                  </td></tr>
                }>
                  <For each={missing()}>
                    {(r) => {
                      return (
                        <tr class="border-t border-gray-100 dark:border-gray-800">
                          <td class={TD}>
                            <button
                              type="button"
                              class="text-left font-medium text-[#AC2334] dark:text-red-300 hover:underline"
                              onClick={() => openClient(r)}
                            >
                              {r.client_nomen}
                            </button>
                          </td>
                          <td class={TD}>
                            <Show when={r.status} fallback={<Missing />}>
                              <Pill class={STATUS_PILL[r.status] ?? NEUTRAL_PILL}>{r.status}</Pill>
                            </Show>
                          </td>
                          <td class={`${TD} text-gray-700 dark:text-gray-300 max-w-[420px]`}>
                            {r.message}
                          </td>
                          <td class={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
                            {istDateTime(r.refreshed_at) ?? <Missing />}
                          </td>
                          <td class={`${TD} text-right`}>
                            <button
                              type="button"
                              class="text-xs text-[#3E6FB0] hover:underline whitespace-nowrap"
                              onClick={() => setLogFor({ nomenId: r.nomen_id, name: r.client_nomen })}
                            >
                              View log
                            </button>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </Show>
              </Show>
            </Show>
          </tbody>
        </table>
      </Section>

      {/* ── Drive create log ── */}
      <Section
        title="Drive create log"
        sub={logFor() ? `Latest 100 for ${logFor().name}` : "Latest 100 actions"}
        actions={
          <div class="flex items-center gap-2">
            <Show when={logFor()}>
              <button
                type="button"
                onClick={() => setLogFor(null)}
                class="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#AC2334] bg-[#FBEEF0] hover:bg-[#AC2334] hover:text-white"
              >
                Show all clients
              </button>
            </Show>
            {reloadBtn(refetchLogs)}
          </div>
        }
      >
        <table class="min-w-full text-sm">
          <thead class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800">
            <tr>
              <th class={TH}>Time</th>
              <th class={TH}>User</th>
              <th class={TH}>Client</th>
              <th class={TH}>Action</th>
              <th class={TH}>State</th>
              <th class={TH}>Message</th>
              <th class={TH}>Link</th>
            </tr>
          </thead>
          <tbody>
            <Show when={logs.state !== "pending" && logs.state !== "refreshing"} fallback={
              <tr><td colSpan={7} class="p-6 text-center text-xs text-gray-400">Loading...</td></tr>
            }>
              <Show when={!logs.error} fallback={
                <tr><td colSpan={7} class="p-6 text-center text-xs text-red-600 dark:text-red-300">
                  {loadErrorMessage(logs.error)}
                </td></tr>
              }>
                <Show when={logs()?.length} fallback={
                  <tr><td colSpan={7} class="p-6 text-center text-xs text-gray-400">No folders or sheets created from the dashboard yet.</td></tr>
                }>
                  <For each={logs()}>
                    {(r) => (
                      <tr class="border-t border-gray-100 dark:border-gray-800">
                        <td class={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
                          {istDateTime(r.created_at) ?? <Missing />}
                        </td>
                        <td class={`${TD} text-gray-700 dark:text-gray-300`}>
                          {r.user_email || <Missing />}
                        </td>
                        <td class={`${TD} font-medium text-gray-700 dark:text-gray-300`}>{r.nomen_name || <Missing />}</td>
                        <td class={`${TD} whitespace-nowrap text-gray-700 dark:text-gray-300`}>
                          {r.action ? actionLabel(r.action) : <Missing />}
                        </td>
                        <td class={TD}>
                          <Show when={r.state} fallback={<Missing />}>
                            <Pill class={STATE_PILL[r.state] ?? NEUTRAL_PILL}>{r.state}</Pill>
                          </Show>
                        </td>
                        <td class={`${TD} text-gray-700 dark:text-gray-300 max-w-[420px]`}>
                          {r.message}
                        </td>
                        <td class={TD}>
                          <Show when={r.result_url} fallback={<Missing />}>
                            <a
                              href={r.result_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="text-[#3E6FB0] hover:underline whitespace-nowrap"
                            >
                              Open
                            </a>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </Show>
              </Show>
            </Show>
          </tbody>
        </table>
      </Section>
    </section>
  );
}
