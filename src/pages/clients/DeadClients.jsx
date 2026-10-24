import {
  createResource,
  createSignal,
  createMemo,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  fetchDeadClients,
  istDate,
  istDateTime,
} from "../../services/deadClients";
import {
  statusLabel,
  normaliseStatus,
  STATUS_BADGE,
  STATUS_DOT,
} from "../../services/clientStatus";
import { inr, count, humanise, DASH } from "../../services/commandRules";
import Avatar from "../../components/common/Avatar";
import { loadErrorMessage } from "../../utils/apiErrors";
import { openClientPage } from "../../utils/openClientPage";
import { scopeKey } from "../../stores/cmScope";

// ─── Dead clients ─────────────────────────────────────────────────────────────
// GET /clients/dead/ — clients the hourly job has marked dead: CM status hold or
// completed, zero spend and zero leads for 10 days, no active campaign. They
// drop off every other list by default; this is where they live, with who
// handled them and why they stopped.
//
// Scope is the server's: admin, coordination and Tier 1 see all dead clients,
// Tier 2/3 only their own. Search is a server param (?q= matches nomen, email,
// CM and sales person). Every timestamp arrives UTC and is shown in IST.
//
// A client revives itself within the hour once its status changes or a
// campaign spends / gets a lead — the Client Status page is where a CM does it.

const TYPE_CHIP = {
  hybrid:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
const typeLabel = (t) =>
  t === "cpl" ? "CPL" : t ? `${t[0].toUpperCase()}${t.slice(1)}` : DASH;

const TH =
  "p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap";
const NUM = "p-3 text-right tabular-nums whitespace-nowrap";
const COLS = 9;

// A person field may arrive as an email string or as an object.
const who = (x) =>
  typeof x === "string"
    ? x
    : (x?.name ?? x?.full_name ?? x?.username ?? x?.email ?? "");

function Missing(props) {
  return (
    <span class="text-[12px] italic text-gray-300 dark:text-gray-500">
      {props.children ?? "Not recorded"}
    </span>
  );
}

function StatusPill(props) {
  const k = () => normaliseStatus(props.status);
  return (
    <span
      class={`inline-flex items-center gap-1.5 px-2 py-[2px] rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_BADGE[k()]}`}
    >
      <span class={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[k()]}`} />
      {statusLabel(k())}
    </span>
  );
}

function TypeChip(props) {
  return (
    <span
      class={`inline-block text-[10px] font-bold tracking-[0.08em] uppercase px-2.5 py-[3px] rounded-full ${
        TYPE_CHIP[props.type] ??
        "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
      }`}
    >
      {typeLabel(props.type)}
    </span>
  );
}

export default function DeadClients() {
  const navigate = useNavigate();

  const [query, setQuery] = createSignal(""); // in the box
  const [q, setQ] = createSignal(""); // sent, debounced
  const [selectedId, setSelectedId] = createSignal(null);

  let qTimer;
  const onQueryInput = (v) => {
    setQuery(v);
    clearTimeout(qTimer);
    qTimer = setTimeout(() => setQ(v.trim()), 350);
  };
  onCleanup(() => clearTimeout(qTimer));

  // Object source — a bare "" would read as "don't fetch" to createResource.
  const [list, { refetch }] = createResource(
    () => ({ q: q(), viewing: scopeKey() }), // viewing: re-key on a switch
    ({ q }) => fetchDeadClients({ q }),
  );

  // An errored resource THROWS on read, so guard before touching latest.
  const rows = () => (list.error ? [] : (list.latest ?? []));
  const selected = createMemo(() => {
    const id = selectedId();
    return id == null
      ? null
      : (rows().find((r) => String(r.client_id) === String(id)) ?? null);
  });

  const firstLoad = () => list.loading && rows().length === 0 && !list.error;

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
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 3a7 7 0 00-7 7v3l-1 3h4v3h2v-3h4v3h2v-3h4l-1-3v-3a7 7 0 00-7-7zM9.5 11h.01M14.5 11h.01" />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Dead Clients
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-gray-500 dark:text-gray-400 mt-0.5 max-w-3xl">
            Status on Hold or Completed, no spend and no leads for 10 days, and
            no active campaign. They're hidden from the other client lists, and
            come back on their own within an hour once the status changes or a
            campaign spends or gets a lead.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={list.loading}
          class="px-3.5 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-[#AC2334]/40 disabled:opacity-50 transition"
        >
          {list.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <Show when={list.error}>
        <div
          role="alert"
          class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
        >
          <span>Could not load dead clients. {loadErrorMessage(list.error)}</span>
          <button
            type="button"
            onClick={() => refetch()}
            class="flex-none underline font-semibold"
          >
            Retry
          </button>
        </div>
      </Show>

      {/* ── Search ── */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-full sm:w-[380px]">
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
            placeholder="Client, email, CM or sales person…"
            value={query()}
            onInput={(e) => onQueryInput(e.currentTarget.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#14233A]/30 dark:focus:ring-gray-600"
          />
        </div>
        <span class="ml-auto text-sm text-gray-400 dark:text-gray-400 whitespace-nowrap">
          <Show when={!firstLoad() && !list.error} fallback="—">
            {rows().length} dead client{rows().length === 1 ? "" : "s"}
            {q() ? " matching" : ""}
          </Show>
        </span>
      </div>

      {/* ── Table ── */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <th class={TH}>Client</th>
              <th class={TH}>Type</th>
              <th class={TH}>Status</th>
              <th class={TH}>Dead since</th>
              <th class={TH}>Last delivery</th>
              <th class={`${TH} text-right`}>Lifetime spend</th>
              <th class={`${TH} text-right`}>Lifetime leads</th>
              <th class={TH}>Current CM</th>
              <th class={TH}>Sales person</th>
            </tr>
          </thead>
          <tbody class={list.loading && !firstLoad() ? "opacity-50 transition-opacity" : ""}>
            <Show when={firstLoad()}>
              <For each={Array(6).fill(0)}>
                {() => (
                  <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                    <For each={Array(COLS).fill(0)}>
                      {() => (
                        <td class="p-3">
                          <div class="h-3.5 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </Show>

            <Show when={!firstLoad() && !list.error && rows().length === 0}>
              <tr>
                <td colspan={COLS} class="p-12 text-center text-gray-500 dark:text-gray-400">
                  {q() ? "No dead clients match this search." : "No dead clients right now."}
                </td>
              </tr>
            </Show>

            <Show when={!firstLoad()}>
              <For each={rows()}>
                {(r, i) => (
                  <tr
                    onClick={() => setSelectedId(r.client_id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(r.client_id);
                      }
                    }}
                    class={`border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-purple-50/60 dark:hover:bg-gray-800/40 focus:outline-none focus-visible:bg-purple-50 dark:focus-visible:bg-gray-800 transition-colors ${
                      i() % 2 === 0
                        ? "bg-white dark:bg-gray-900"
                        : "bg-gray-50/60 dark:bg-gray-800/30"
                    }`}
                  >
                    <td class="p-3">
                      <div class="flex items-center gap-2.5 min-w-0">
                        <Avatar name={r.client || r.email} />
                        <div class="min-w-0">
                          <p class="max-w-[200px] truncate font-medium text-gray-800 dark:text-gray-100">
                            {r.client || DASH}
                          </p>
                          <p class="max-w-[200px] truncate text-xs text-gray-500 dark:text-gray-400">
                            {r.email || DASH}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td class="p-3">
                      <TypeChip type={r.client_type} />
                    </td>
                    <td class="p-3">
                      <StatusPill status={r.engagement_status} />
                    </td>
                    <td class="p-3 whitespace-nowrap text-gray-700 dark:text-gray-200">
                      {istDate(r.dead_since) ?? <Missing />}
                    </td>
                    <td class="p-3 whitespace-nowrap text-gray-700 dark:text-gray-200">
                      {istDate(r.last_delivery) ?? <Missing>Never</Missing>}
                    </td>
                    <td class={`${NUM} text-gray-800 dark:text-gray-100`}>
                      {inr(r.lifetime_spend)}
                    </td>
                    <td class={`${NUM} text-gray-800 dark:text-gray-100`}>
                      {count(r.lifetime_leads)}
                    </td>
                    <td class="p-3 max-w-[180px]">
                      <Show
                        when={r.campaign_managers.length > 0}
                        fallback={<Missing>No CM</Missing>}
                      >
                        <p
                          class="truncate text-[13px] text-gray-700 dark:text-gray-200"
                          title={r.campaign_managers.map(who).join(", ")}
                        >
                          {r.campaign_managers.map(who).join(", ")}
                        </p>
                      </Show>
                    </td>
                    <td class="p-3 max-w-[150px] truncate text-gray-700 dark:text-gray-200">
                      {who(r.sales_person) || <Missing>No sales person</Missing>}
                    </td>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>

      <p class="mt-4 text-[12px] text-gray-400 dark:text-gray-400">
        Times are shown in IST. Click a client for who handled it, its status
        changes, and every time it went dead or came back.
      </p>

      <DeadClientPanel
        client={selected()}
        onClose={() => setSelectedId(null)}
        onOpen={(c) =>
          openClientPage(navigate, {
            nomen: c.client,
            nomenId: c.client_nomen_id,
          })
        }
      />
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function Section(props) {
  return (
    <section class="mb-6">
      <h3 class="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">
        {props.title}
      </h3>
      <Show
        when={props.count > 0}
        fallback={
          <p class="text-sm text-gray-400 dark:text-gray-500 italic">
            {props.empty}
          </p>
        }
      >
        <ol class="relative border-l border-gray-200 dark:border-gray-700 ml-1.5">
          {props.children}
        </ol>
      </Show>
    </section>
  );
}

function Fact(props) {
  return (
    <div>
      <dt class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {props.label}
      </dt>
      <dd class="mt-0.5 text-sm text-gray-800 dark:text-gray-100 tabular-nums">
        {props.children}
      </dd>
    </div>
  );
}

// snapshot is free-form; show its plain values and skip anything nested.
const snapshotPairs = (snap) =>
  snap && typeof snap === "object"
    ? Object.entries(snap).filter(
        ([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v),
      )
    : [];

function DeadClientPanel(props) {
  const c = () => props.client;
  return (
    <Show when={c()}>
      <div class="fixed inset-0 z-50 flex">
        <div
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          onClick={() => props.onClose()}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Dead client detail"
          class="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div class="flex items-start justify-between gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div class="min-w-0">
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white truncate">
                {c().client || DASH}
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 truncate">
                {c().email || DASH}
              </p>
              <div class="mt-2 flex items-center gap-2">
                <TypeChip type={c().client_type} />
                <StatusPill status={c().engagement_status} />
              </div>
            </div>
            <button
              onClick={() => props.onClose()}
              aria-label="Close"
              class="flex-none w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            >
              ✕
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-6 py-5">
            <dl class="grid grid-cols-2 gap-x-4 gap-y-3 mb-5">
              <Fact label="Dead since">{istDateTime(c().dead_since) ?? DASH}</Fact>
              <Fact label="Sales person">{who(c().sales_person) || DASH}</Fact>
              <Fact label="First delivery">{istDate(c().first_delivery) ?? DASH}</Fact>
              <Fact label="Last delivery">{istDate(c().last_delivery) ?? "Never"}</Fact>
              <Fact label="Lifetime spend">{inr(c().lifetime_spend)}</Fact>
              <Fact label="Lifetime leads">{count(c().lifetime_leads)}</Fact>
            </dl>

            <Show when={c().client}>
              <button
                type="button"
                onClick={() => props.onOpen(c())}
                class="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] transition-colors"
              >
                Open client page
                <span aria-hidden="true">→</span>
              </button>
            </Show>

            {/* Who handled it, oldest first — reads as a hand-over timeline. */}
            <Section
              title="Campaign managers"
              count={c().assignment_history.length}
              empty="No assignment history recorded."
            >
              <For each={c().assignment_history}>
                {(a) => (
                  <li class="ml-5 pb-5 last:pb-0">
                    <span
                      class={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-gray-900 ${
                        a.active ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"
                      }`}
                    />
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {who(a.campaign_manager) || DASH}
                      </span>
                      <Show when={a.active}>
                        <span class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          Current
                        </span>
                      </Show>
                    </div>
                    <p class="mt-0.5 text-[13px] text-gray-600 dark:text-gray-300 tabular-nums">
                      {istDate(a.assigned_at) ?? "?"} →{" "}
                      {a.ended_at
                        ? istDate(a.ended_at)
                        : a.active
                          ? "now"
                          : "?"}
                    </p>
                    <Show when={who(a.assigned_by)}>
                      <p class="mt-0.5 text-[11px] text-gray-400">
                        Assigned by {who(a.assigned_by)}
                      </p>
                    </Show>
                  </li>
                )}
              </For>
            </Section>

            <Section
              title="Status changes · newest first"
              count={c().status_history.length}
              empty="No status changes recorded."
            >
              <For each={c().status_history}>
                {(h) => (
                  <li class="ml-5 pb-5 last:pb-0">
                    <span class="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-[#AC2334] ring-4 ring-white dark:ring-gray-900" />
                    <div class="flex flex-wrap items-center gap-2">
                      <Show
                        when={h.from}
                        fallback={
                          <span class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                            First set
                          </span>
                        }
                      >
                        <StatusPill status={h.from} />
                        <span class="text-gray-400" aria-hidden="true">→</span>
                      </Show>
                      <StatusPill status={h.to} />
                    </div>
                    <p class="mt-1.5 text-sm text-gray-700 dark:text-gray-200">
                      {h.reason || DASH}
                    </p>
                    <p class="mt-0.5 text-[11px] text-gray-400">
                      {who(h.by) || "Unknown"} · {istDateTime(h.at) ?? DASH}
                    </p>
                  </li>
                )}
              </For>
            </Section>

            <Section
              title="Dead / revived · newest first"
              count={c().dead_history.length}
              empty="No dead or revived events recorded."
            >
              <For each={c().dead_history}>
                {(d) => {
                  const isDead = () => String(d.event).toLowerCase() === "dead";
                  return (
                    <li class="ml-5 pb-5 last:pb-0">
                      <span
                        class={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-gray-900 ${
                          isDead() ? "bg-gray-700 dark:bg-gray-300" : "bg-emerald-500"
                        }`}
                      />
                      <div class="flex flex-wrap items-center gap-2">
                        <span
                          class={`text-[10px] font-bold uppercase tracking-wider px-2 py-[2px] rounded ${
                            isDead()
                              ? "bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900"
                              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          }`}
                        >
                          {isDead() ? "Went dead" : "Revived"}
                        </span>
                        <span class="text-[12px] text-gray-500 dark:text-gray-400 tabular-nums">
                          {istDateTime(d.at) ?? DASH}
                        </span>
                      </div>
                      <p class="mt-1.5 text-sm text-gray-700 dark:text-gray-200">
                        {d.reason || DASH}
                      </p>
                      <Show when={snapshotPairs(d.snapshot).length > 0}>
                        <dl class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                          <For each={snapshotPairs(d.snapshot)}>
                            {([k, v]) => (
                              <div class="flex gap-1">
                                <dt>{humanise(k)}:</dt>
                                <dd class="text-gray-600 dark:text-gray-300 tabular-nums">
                                  {v === null ? DASH : String(v)}
                                </dd>
                              </div>
                            )}
                          </For>
                        </dl>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </Section>
          </div>
        </div>
      </div>
    </Show>
  );
}
