import {
  createSignal,
  createEffect,
  createMemo,
  on,
  onCleanup,
  For,
  Show,
  Switch,
  Match,
} from "solid-js";
import Swal from "sweetalert2";
import {
  fetchDriveCard,
  refreshDrive,
  createDriveFolder,
  createDriveSheet,
  driveErrorMessage,
  workingLabel,
  timeAgo,
  POLL_MS,
} from "../../services/drive";
import { istDateTime } from "../../services/deadClients";
import DriveKindIcon from "./DriveKindIcon";

// ─── Google Drive card (client page) ──────────────────────────────────────────
// One client's Drive folder: open it, see its files, refresh the listing, and
// (with can_create) make the folder or a new sheet. Every button answers 202
// with the same card JSON; while job.running is true the card re-GETs every
// 3s and the buttons stay disabled. Creating can take up to a minute.
//
// A 404 is the backend saying "not your client" (CMs): the card hides itself.

// "unknown" means the server hasn't looked yet. Re-check it a bounded number of
// times so a card that never resolves doesn't poll forever.
const UNKNOWN_POLLS = 40;

const BTN =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_GHOST = `${BTN} ring-1 ring-gray-300 dark:ring-gray-600 text-[#14233A] dark:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700`;
const BTN_SOLID = `${BTN} bg-[#14233A] text-white hover:bg-[#1d3255]`;

function Spinner(props) {
  return (
    <svg
      class={`animate-spin ${props.class ?? "w-4 h-4"}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
    </svg>
  );
}

export default function DriveCard(props) {
  const [card, setCard] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal(null);
  const [hidden, setHidden] = createSignal(false);
  const [actionError, setActionError] = createSignal(null);
  const [posting, setPosting] = createSignal(false);
  // last_result is shown only for a job this card watched run — not whatever
  // finished days ago.
  const [result, setResult] = createSignal(null);
  const [now, setNow] = createSignal(Date.now());

  let watching = false;
  let timer = null;
  let unknownPolls = 0;
  let gen = 0; // bumps on client change, so a late answer for the old client is dropped

  const stopPoll = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const running = () => !!card()?.job?.running;
  const busy = () => posting() || running();

  const apply = (c) => {
    setCard(c);
    setNow(Date.now());
    if (c?.job?.running) {
      watching = true;
    } else if (watching) {
      watching = false;
      setResult(c?.last_result ?? null);
    }
    schedule(c);
  };

  const schedule = (c) => {
    stopPoll();
    let again = false;
    if (c?.job?.running) again = true;
    else if (c?.status === "unknown" && unknownPolls < UNKNOWN_POLLS) {
      unknownPolls += 1;
      again = true;
    }
    if (again) {
      const g = gen;
      timer = setTimeout(() => poll(g), POLL_MS);
    }
  };

  const poll = async (g) => {
    try {
      const c = await fetchDriveCard(nomenId());
      if (g !== gen) return;
      apply(c);
    } catch (err) {
      if (g !== gen) return;
      // A blip mid-job: keep polling rather than strand disabled buttons.
      if (running()) timer = setTimeout(() => poll(g), POLL_MS);
      else setLoadError(driveErrorMessage(err));
    }
  };

  const load = async (nomenId) => {
    gen += 1;
    const g = gen;
    stopPoll();
    watching = false;
    unknownPolls = 0;
    setCard(null);
    setResult(null);
    setActionError(null);
    setLoadError(null);
    setHidden(false);
    if (!nomenId) return;
    setLoading(true);
    try {
      const c = await fetchDriveCard(nomenId);
      if (g !== gen) return;
      apply(c);
    } catch (err) {
      if (g !== gen) return;
      if (err?.status === 404 || err?.status === 403) setHidden(true);
      else setLoadError(driveErrorMessage(err));
    } finally {
      if (g === gen) setLoading(false);
    }
  };

  // Memo, so a parent re-evaluating to the SAME id doesn't reload the card.
  const nomenId = createMemo(() => (props.nomenId ? String(props.nomenId) : null));
  createEffect(on(nomenId, (id) => load(id)));

  // Keeps "Last refreshed … ago" honest while the page sits open.
  const tick = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => {
    gen += 1;
    stopPoll();
    clearInterval(tick);
  });

  const run = async (fn) => {
    if (busy()) return;
    const g = gen;
    setActionError(null);
    setResult(null);
    setPosting(true);
    watching = true;
    try {
      const c = await fn(nomenId());
      if (g !== gen) return;
      apply(c);
    } catch (err) {
      if (g !== gen) return;
      watching = false;
      setActionError(driveErrorMessage(err));
    } finally {
      if (g === gen) setPosting(false);
    }
  };

  const onRefresh = () => run(refreshDrive);
  const onCreateFolder = () => run(createDriveFolder);
  const onCreateSheet = async () => {
    if (busy()) return;
    const name = props.clientName || "this client";
    const { isConfirmed } = await Swal.fire({
      title: "Create a new sheet?",
      text: `Create a new Google Sheet for ${name}?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Create sheet",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#14233A",
      reverseButtons: true,
      focusCancel: true,
    });
    if (!isConfirmed) return;
    run(createDriveSheet);
  };

  const status = () => card()?.status;
  const files = () => (Array.isArray(card()?.files) ? card().files : []);
  const fileCount = () => card()?.file_count ?? files().length;
  const refreshedAgo = () => timeAgo(card()?.refreshed_at, now());

  return (
    <Show when={!hidden() && nomenId()}>
      <div class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        {/* Header */}
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#E8F0FE] text-[#1A73E8] dark:bg-blue-900/30 dark:text-blue-300">
              <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-[#14233A] dark:text-white">
                Google Drive
              </h3>
              <p class="text-xs text-[#54657E] dark:text-gray-400">
                <Show when={status() === "found"} fallback={<span>&nbsp;</span>}>
                  {fileCount()} file{fileCount() === 1 ? "" : "s"}
                  <Show when={refreshedAgo()}>
                    {" · "}
                    <span title={istDateTime(card()?.refreshed_at) ?? ""}>
                      Last refreshed {refreshedAgo()}
                    </span>
                  </Show>
                </Show>
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Show when={card()?.folder_url}>
              <a
                href={card().folder_url}
                target="_blank"
                rel="noopener noreferrer"
                class={BTN_GHOST}
              >
                Open folder
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                </svg>
              </a>
            </Show>
            <Show when={status() === "found" && card()?.can_create}>
              <button type="button" class={BTN_GHOST} disabled={busy()} onClick={onCreateSheet}>
                Create new sheet
              </button>
            </Show>
            <Show when={status() === "missing" && card()?.can_create}>
              <button type="button" class={BTN_SOLID} disabled={busy()} onClick={onCreateFolder}>
                Create folder
              </button>
            </Show>
            <Show when={card()}>
              <button type="button" class={BTN_GHOST} disabled={busy()} onClick={onRefresh}>
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </Show>
          </div>
        </div>

        <div class="px-4 py-3 space-y-3">
          {/* Job in progress */}
          <Show when={running()}>
            <div class="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs font-medium text-blue-800 dark:text-blue-200">
              <Spinner class="w-3.5 h-3.5" />
              Working... ({workingLabel(card()?.job?.action)})
              <span class="text-blue-600/70 dark:text-blue-300/70 font-normal">
                This can take up to a minute.
              </span>
            </div>
          </Show>

          {/* Button error (403 / 409 / 503 …) */}
          <Show when={actionError()}>
            <div class="rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-800">
              {actionError()}
            </div>
          </Show>

          {/* Result of the job this card watched */}
          <Show when={result()}>
            {(r) => (
              <div
                class={`rounded-lg px-3 py-2 text-xs ring-1 ${
                  r().ok
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-800"
                    : "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/20 dark:text-red-300 dark:ring-red-800"
                }`}
              >
                <Show when={r().message}>
                  <div>{r().message}</div>
                </Show>
                <Show when={r().new_sheet}>
                  <div class="mt-1 font-semibold">
                    New sheet created:{" "}
                    <a
                      href={r().new_sheet.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="underline hover:no-underline"
                    >
                      {r().new_sheet.name}
                    </a>
                  </div>
                </Show>
              </div>
            )}
          </Show>

          <Switch>
            <Match when={loading() && !card()}>
              <div class="flex items-center gap-2 text-xs text-[#54657E] dark:text-gray-400 py-2">
                <Spinner class="w-3.5 h-3.5" /> Loading Google Drive...
              </div>
            </Match>
            <Match when={loadError() && !card()}>
              <div class="rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {loadError()}{" "}
                <button
                  type="button"
                  class="underline font-semibold"
                  onClick={() => load(nomenId())}
                >
                  Try again
                </button>
              </div>
            </Match>
            <Match when={status() === "unknown"}>
              <div class="flex items-center gap-2 text-xs text-[#54657E] dark:text-gray-400 py-2">
                <Spinner class="w-3.5 h-3.5" /> Checking Google Drive...
              </div>
            </Match>
            <Match when={status() === "missing" || status() === "conflict" || status() === "error"}>
              <div class="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-800">
                {card()?.status_text || "Google Drive folder not available."}
              </div>
            </Match>
            <Match when={status() === "found"}>
              <Show
                when={files().length}
                fallback={
                  <p class="text-xs italic text-gray-400 dark:text-gray-500 py-1">
                    The folder is empty.
                  </p>
                }
              >
                <ul class="divide-y divide-gray-100 dark:divide-gray-700 max-h-80 overflow-auto -mx-1">
                  <For each={files()}>
                    {(f) => (
                      <li>
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="flex items-center gap-2.5 px-1 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm"
                          title={f.path ? `${f.path}/${f.name}` : f.name}
                        >
                          <DriveKindIcon kind={f.kind} />
                          <span class="truncate text-[#14233A] dark:text-gray-100 hover:underline">
                            {f.name}
                          </span>
                          <Show when={f.path}>
                            <span class="ml-auto pl-2 flex-shrink-0 text-xs text-gray-400 dark:text-gray-500 truncate max-w-[40%]">
                              {f.path}
                            </span>
                          </Show>
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Match>
            <Match when={card()}>
              {/* A status this card doesn't know: say what the server said. */}
              <div class="rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2 text-xs text-[#54657E] dark:text-gray-300">
                {card()?.status_text || `Google Drive status: ${status() ?? "unavailable"}`}
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </Show>
  );
}
