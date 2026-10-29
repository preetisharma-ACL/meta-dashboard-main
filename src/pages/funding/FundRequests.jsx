import {
  createSignal,
  createMemo,
  createEffect,
  on,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  fetchFundQueue,
  fetchFundRequest,
  fetchFundAccounts,
  raiseFundRequest,
  updateFundRequest,
  markFundRequestPaid,
  cancelFundRequest,
  fetchFundRegister,
  downloadFundRegister,
  fetchFundPayers,
  claimFundRequest,
  fetchFundTopups,
  setTopupPayer,
} from "../../services/fundRequests";
import { scopeKey } from "../../stores/cmScope";
import { refreshFundRequestsBadge } from "../../stores/fundRequestsBadge";
import { showNotice } from "../../components/common/NoticeToast";
import { errorMessage, loadErrorMessage } from "../../utils/apiErrors";

// ─────────────────────────────────────────────────────────────────────────────
// Fund Requests — one page for the top-up queue that used to live in WhatsApp.
//
//   1. Summary strip   (meta of the queue call)
//   2. Queue           (data.open — the BACKEND's pay-first order unless the
//                       user picks a column sort) + "Closed today"
//   3. Raise modal
//   4. Funds register  (bottom)
//
// The backend raises requests on its own under ₹500 and marks them Paid on its
// own once Meta records the top-up, so the queue is re-read every 30s and on
// window focus. Re-reads replace the data in place — the table is never
// swapped for a skeleton, so scroll position survives.
//
// Permission is entirely the backend's: rows carry can_pay / can_edit /
// can_cancel, meta carries can_raise_any, accounts carry can_raise.
// ─────────────────────────────────────────────────────────────────────────────

const QUEUE_POLL_MS = 30_000;
const REGISTER_MAX_DAYS = 92;

// ── formatting ───────────────────────────────────────────────────────────────

const isNum = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const money = (v) =>
  isNum(v)
    ? "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })
    : "—";
const num = (v) => (isNum(v) ? Number(v).toLocaleString("en-IN") : "—");

const fmtWait = (mins) => {
  if (!isNum(mins)) return "";
  const m = Math.max(0, Math.round(Number(mins)));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};

const fmtHours = (h) => {
  if (!isNum(h)) return "-";
  const v = Number(h);
  if (v <= 0) return "0 h";
  return `${Math.round(v * 10) / 10} h`;
};

const ago = (iso) => {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const minsSince = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null;
};

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const pad = (n) => String(n).padStart(2, "0");
const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftYMD = (ymd, days) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return toYMD(new Date(y, m - 1, d + days));
};
const daySpan = (from, to) => {
  const [a, b] = [from, to].map((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86400000) + 1;
};
const prettyYMD = (ymd) => {
  if (!ymd) return "—";
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(ymd);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// clients[] arrives as [{ client, … }]; tolerate bare strings.
const clientNames = (list) =>
  (Array.isArray(list) ? list : [])
    .map((c) => (typeof c === "string" ? c : c?.client ?? c?.name ?? ""))
    .filter(Boolean)
    .join(", ");

const joinList = (v) =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : x?.name ?? x?.email ?? "")).filter(Boolean).join(", ")
    : v || "";

// client_balance_warning: list of lines. Strings are shown verbatim; an object
// is rendered "<client>: ₹<balance>".
const warningLines = (w) => {
  if (!w) return [];
  const list = Array.isArray(w) ? w : [w];
  return list
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        const who = x.client ?? x.name ?? "";
        const bal = x.balance ?? x.amount ?? x.client_balance;
        return who ? `${who}: ${money(bal)}` : "";
      }
      return "";
    })
    .filter(Boolean);
};

// ── sorting ──────────────────────────────────────────────────────────────────
// Client-side column sort, same ⇅ / ↑ ↓ markers as CPL Rules. Clicks cycle
// first dir → other dir → off; off keeps the backend's order (the queue's
// pay-first order, the register's newest-first). Empty values always sort last.

const numOrNull = (v) => (isNum(v) ? Number(v) : null);
const strOrNull = (v) => (v ? String(v).toLowerCase() : null);

const sortBy = (list, sort, cols) => {
  if (!sort || !cols[sort.key]) return list;
  const get = cols[sort.key].get;
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (x === y) return 0;
    if (typeof x === "string") return x.localeCompare(y, undefined, { sensitivity: "base" }) * mul;
    return (x - y) * mul;
  });
};

const nextSort = (cur, key, cols) => {
  const first = cols[key].first;
  if (cur?.key !== key) return { key, dir: first };
  if (cur.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
  return null;
};

function SortBtn(props) {
  const active = () => props.sort?.key === props.col;
  return (
    <button
      type="button"
      onClick={() => props.onSort(props.col)}
      class="inline-flex items-center uppercase tracking-wider transition-colors hover:text-purple-600"
    >
      {props.label}
      {active() ? (
        <span class="ml-1 text-purple-600">{props.sort.dir === "asc" ? "↑" : "↓"}</span>
      ) : (
        <span class="text-gray-300 ml-1">⇅</span>
      )}
    </button>
  );
}

const PRIORITY_RANK = { stopped: 4, urgent: 3, high: 2, normal: 1 };

const QUEUE_SORT = {
  priority: { get: (r) => PRIORITY_RANK[r.effective_priority ?? r.priority] ?? null, first: "desc" },
  account: { get: (r) => strOrNull(r.ad_account?.name), first: "asc" },
  clients: { get: (r) => strOrNull(clientNames(r.clients)), first: "asc" },
  cms: { get: (r) => strOrNull(joinList(r.campaign_managers)), first: "asc" },
  wallet: { get: (r) => numOrNull(r.wallet), first: "asc" },
  daily_budget: { get: (r) => numOrNull(r.daily_budget), first: "desc" },
  spent_today: { get: (r) => numOrNull(r.spent_today), first: "desc" },
  hours_left: { get: (r) => numOrNull(r.hours_left), first: "asc" },
  ask: { get: (r) => numOrNull(r.amount_requested), first: "desc" },
  raised: { get: (r) => numOrNull(r.waiting_minutes), first: "desc" },
};

const CLOSED_SORT = {
  account: { get: (r) => strOrNull(r.ad_account?.name), first: "asc" },
  ask: { get: (r) => numOrNull(r.amount_requested), first: "desc" },
  status: { get: (r) => strOrNull(r.status), first: "asc" },
  paid: { get: (r) => numOrNull(r.paid_amount), first: "desc" },
  time_to_pay: { get: (r) => numOrNull(r.minutes_to_pay), first: "asc" },
};

const REGISTER_SORT = {
  date: { get: (r) => (r.date ? String(r.date) : null), first: "desc" },
  account: { get: (r) => strOrNull(r.ad_account), first: "asc" },
  clients: { get: (r) => strOrNull(r.clients), first: "asc" },
  cms: { get: (r) => strOrNull(r.campaign_managers), first: "asc" },
  daily_budget: { get: (r) => numOrNull(r.daily_budget), first: "desc" },
  topups: { get: (r) => numOrNull(r.topups), first: "desc" },
  funds_added: { get: (r) => numOrNull(r.funds_added), first: "desc" },
  spend: { get: (r) => numOrNull(r.spend), first: "desc" },
  spend_inc_gst: { get: (r) => numOrNull(r.spend_inc_gst), first: "desc" },
  wallet_end_of_day: { get: (r) => numOrNull(r.wallet_end_of_day), first: "desc" },
  requests: { get: (r) => numOrNull(r.requests), first: "desc" },
  paid_by: { get: (r) => strOrNull(r.paid_by), first: "asc" },
};

// ── priority ─────────────────────────────────────────────────────────────────

const PRIORITY = {
  stopped: {
    label: "STOPPED",
    chip: "bg-[#AC2334] text-white ring-[#AC2334]",
  },
  urgent: {
    label: "Urgent",
    chip: "bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-900/40 dark:text-orange-200 dark:ring-orange-700",
  },
  high: {
    label: "High",
    chip: "bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700",
  },
  normal: {
    label: "Normal",
    chip: "bg-gray-100 text-gray-700 ring-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600",
  },
};
const EDITABLE_PRIORITIES = ["urgent", "high", "normal"];

function PriorityChip(props) {
  const p = () => PRIORITY[props.value] ?? PRIORITY.normal;
  return (
    <span class="inline-flex items-center gap-1 flex-wrap">
      <span
        class={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset whitespace-nowrap ${p().chip}`}
      >
        {p().label}
      </span>
      <Show when={props.auto}>
        <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#EEF2F7] text-[#3E6FB0] dark:bg-[#1A2B45] dark:text-[#A9C1E0]">
          Auto
        </span>
      </Show>
    </span>
  );
}

// ── errors ───────────────────────────────────────────────────────────────────

// 409 = closed or raced — re-read so the stale row disappears.
const reportError = (err, fallback, reload) => {
  showNotice(errorMessage(err, fallback), "warn");
  if (err?.status === 409) reload?.();
};

// ── shells ───────────────────────────────────────────────────────────────────

const INPUT =
  "w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]";
const LABEL = "block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1";
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#AC2334] hover:bg-[#8F1C2B] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
const BTN_GHOST =
  "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors";
const BTN_ROW =
  "text-center px-2.5 py-1 rounded-md text-xs font-semibold border whitespace-nowrap transition-colors disabled:opacity-50";

function Modal(props) {
  const onKey = (e) => e.key === "Escape" && !props.busy && props.onClose();
  onMount(() => document.addEventListener("keydown", onKey));
  onCleanup(() => document.removeEventListener("keydown", onKey));
  return (
    <Portal>
      <div
        class="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40"
        onClick={(e) => e.target === e.currentTarget && !props.busy && props.onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          class={`w-full ${props.wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 border border-[#E2E8F1] dark:border-gray-700 shadow-2xl`}
        >
          <div class="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F1] dark:border-gray-800">
            <h2 class="text-base font-bold text-[#14233A] dark:text-white">{props.title}</h2>
            <button
              type="button"
              aria-label="Close"
              disabled={props.busy}
              onClick={props.onClose}
              class="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              ✕
            </button>
          </div>
          <div class="px-5 py-4">{props.children}</div>
        </div>
      </div>
    </Portal>
  );
}

function AccountCell(props) {
  return (
    <div class="min-w-0">
      <div class="font-semibold text-[#14233A] dark:text-gray-100 truncate" title={props.account?.name}>
        {props.account?.name || "—"}
      </div>
      <div class="text-[11px] text-gray-400 font-mono truncate">{props.account?.id}</div>
    </div>
  );
}

// Long notes clamp to two lines until clicked.
function NoteCell(props) {
  const [open, setOpen] = createSignal(false);
  const long = () => (props.note || "").length > 70 || (props.note || "").includes("\n");
  return (
    <Show when={props.note} fallback={<span class="text-gray-300">—</span>}>
      <div class="text-xs text-gray-600 dark:text-gray-300 max-w-[220px]">
        <p class={`whitespace-pre-line break-words ${open() ? "" : "line-clamp-2"}`}>{props.note}</p>
        <Show when={long()}>
          <button
            type="button"
            class="text-[11px] font-semibold text-[#3E6FB0] hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            {open() ? "Less" : "More"}
          </button>
        </Show>
      </div>
    </Show>
  );
}

// Filter dropdown with a search box. options: [{ value, label }]; "" is the
// "all" choice, labelled by allLabel. Search matches anywhere in the label, so
// an ad account is findable by name or act_ id.
function SearchSelect(props) {
  const [open, setOpen] = createSignal(false);
  const [q, setQ] = createSignal("");
  const [active, setActive] = createSignal(-1);
  let root;
  let inputEl;
  let listEl;

  const all = () => [{ value: "", label: props.allLabel }, ...(props.options || [])];
  const filtered = () => {
    const s = q().trim().toLowerCase();
    return s ? all().filter((o) => o.label.toLowerCase().includes(s)) : all();
  };
  const current = () =>
    all().find((o) => String(o.value) === String(props.value ?? ""))?.label ?? props.allLabel;

  const close = () => {
    setOpen(false);
    setQ("");
    setActive(-1);
  };
  const toggle = () => {
    if (open()) return close();
    setOpen(true);
    queueMicrotask(() => inputEl?.focus());
  };
  const choose = (v) => {
    props.onChange(v);
    close();
  };

  const onDoc = (e) => open() && !root?.contains(e.target) && close();
  onMount(() => document.addEventListener("pointerdown", onDoc));
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));

  createEffect(() => {
    const i = active();
    if (open() && i >= 0) listEl?.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" });
  });

  const onKeyDown = (e) => {
    const list = filtered();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!list.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = active() < 0 ? (step > 0 ? 0 : list.length - 1) : active() + step;
      setActive((next + list.length) % list.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = list[active()] ?? (list.length === 1 ? list[0] : null);
      if (o) choose(o.value);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  return (
    <div ref={root} class={`relative ${props.class || ""}`}>
      <button
        type="button"
        onClick={toggle}
        class={`${INPUT} flex items-center justify-between gap-2 text-left`}
      >
        <span class="truncate">{current()}</span>
        <svg class={`w-4 h-4 flex-none text-gray-500 transition-transform ${open() ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <Show when={open()}>
        <div class="absolute z-40 mt-1 w-full min-w-[260px] rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
          <div class="p-2 border-b border-[#E2E8F1] dark:border-gray-800">
            <input
              ref={inputEl}
              type="text"
              autocomplete="off"
              class={`${INPUT} !py-1.5`}
              placeholder={props.placeholder || "Search…"}
              value={q()}
              onInput={(e) => {
                setQ(e.currentTarget.value);
                setActive(-1);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div ref={listEl} role="listbox" class="max-h-72 overflow-y-auto py-1">
            <For each={filtered()} fallback={<p class="px-3 py-3 text-sm text-gray-400">No match</p>}>
              {(o, i) => {
                const on = () => String(o.value) === String(props.value ?? "");
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={on()}
                    data-idx={i()}
                    onClick={() => choose(o.value)}
                    onMouseEnter={() => setActive(i())}
                    class={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      active() === i() ? "bg-[#F6F9FC] dark:bg-gray-800" : ""
                    } ${on() ? "text-[#AC2334] dark:text-red-300 font-semibold" : "text-[#14233A] dark:text-gray-100"}`}
                  >
                    {o.label}
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

// ── who paid ─────────────────────────────────────────────────────────────────
// The payer is always ENTERED, never taken from the login: company money is
// handed to different people, and whoever opens the payment page is often not
// the one paying. No default — an unpicked payer blocks the submit.
//
// One picker everywhere. Options: payers.users (sent as paid_by_user_id),
// payers.other_names and free-text "Other…" (both sent as paid_by_name).

const OTHER = "__other";

const createPayerState = () => {
  const [key, setKey] = createSignal("");
  const [other, setOther] = createSignal("");
  const payload = () => {
    const k = key();
    if (k.startsWith("u:")) return { paid_by_user_id: Number(k.slice(2)) };
    if (k.startsWith("n:")) return { paid_by_name: k.slice(2) };
    if (k === OTHER && other().trim()) return { paid_by_name: other().trim() };
    return null;
  };
  return { key, setKey, other, setOther, payload };
};

function PayerPicker(props) {
  const st = props.state;
  const users = () => props.payers?.()?.users || [];
  const names = () => props.payers?.()?.other_names || [];
  let otherEl;
  return (
    <div class="space-y-2">
      <select
        class={INPUT}
        value={st.key()}
        onChange={(e) => {
          st.setKey(e.currentTarget.value);
          if (e.currentTarget.value === OTHER) queueMicrotask(() => otherEl?.focus());
        }}
      >
        <option value="" disabled>
          {props.payers?.() ? "Select who paid…" : "Loading payers…"}
        </option>
        <Show when={users().length}>
          <optgroup label="People">
            <For each={users()}>
              {(u) => <option value={`u:${u.id}`}>{u.role ? `${u.name} (${u.role})` : u.name}</option>}
            </For>
          </optgroup>
        </Show>
        <Show when={names().length}>
          <optgroup label="Other names">
            <For each={names()}>{(n) => <option value={`n:${n}`}>{n}</option>}</For>
          </optgroup>
        </Show>
        <option value={OTHER}>Other…</option>
      </select>
      <Show when={st.key() === OTHER}>
        <input
          ref={otherEl}
          type="text"
          class={INPUT}
          placeholder="Name of the person who paid"
          value={st.other()}
          onInput={(e) => st.setOther(e.currentTarget.value)}
        />
      </Show>
    </div>
  );
}

const SOURCE_LABEL = { claim: "entered at Pay click", manual: "entered by hand" };

// Top-up rows: ad_account may be the name (with ad_account_id) or an object.
const acctOf = (r) =>
  r?.ad_account && typeof r.ad_account === "object"
    ? r.ad_account
    : { name: r?.ad_account, id: r?.ad_account_id };

const topupTime = (t) => t?.time ?? t?.paid_at ?? t?.at ?? t?.created_at ?? null;

const fmtIST = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return String(v);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// paid_by null + tracked → amber "Payer not set"; untracked (before 29 Oct) → "-".
function PaidByText(props) {
  return (
    <Show when={props.topup?.payer_tracked !== false} fallback={<span class="text-gray-400">-</span>}>
      <Show
        when={props.topup?.paid_by}
        fallback={<span class="font-semibold text-[#B07A14]">Payer not set</span>}
      >
        <span class="font-semibold text-[#14233A] dark:text-gray-100">{props.topup.paid_by}</span>
      </Show>
    </Show>
  );
}

// Holding text for the tab opened before the claim answers.
const holdTab = (w, text) => {
  try {
    w.document.title = "Ads Manager";
    w.document.body.innerHTML = `<p style="font:15px system-ui,sans-serif;color:#333;margin:40px">${text}</p>`;
  } catch {}
};

// "Who is paying?" → claim → send the pre-opened tab to Meta's payment page.
function ClaimModal(props) {
  const payer = createPayerState();
  const [busy, setBusy] = createSignal(false);
  const [conflict, setConflict] = createSignal(null);
  let w = null;
  let done = false;

  // Closing the dialog mid-flow must not strand the blank tab.
  onCleanup(() => {
    if (!done && w && !w.closed) w.close();
  });

  const go = (url) => {
    done = true;
    if (!url) {
      w?.close();
      showNotice("No payment link came back for this account.", "warn");
      return;
    }
    if (w && !w.closed) w.location = url;
    else window.open(url, "_blank", "noopener");
  };

  const claim = async (force) => {
    setBusy(true);
    try {
      const res = await claimFundRequest(props.row.id, payer.payload(), force);
      go(res?.data?.pay_url);
      props.onDone();
    } catch (err) {
      if (!force && err?.status === 409 && err?.code === "already_claimed") {
        if (w && !w.closed) holdTab(w, "Someone is already paying this. Answer the question in the dashboard tab.");
        setConflict(errorMessage(err, "Someone is already paying this. Pay anyway?"));
      } else {
        w?.close();
        reportError(err, "Couldn't start the payment.", props.reload);
        props.onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const onContinue = (e) => {
    e.preventDefault();
    if (!payer.payload() || busy()) return;
    // Opened synchronously inside the click, before any await, so the browser
    // doesn't treat it as a popup.
    w = window.open("", "_blank");
    if (w) {
      try {
        w.opener = null;
      } catch {}
      holdTab(w, "Opening Ads Manager…");
    }
    claim(false);
  };

  const declined = () => {
    w?.close();
    done = true;
    props.onClose();
  };

  return (
    <Modal title="Who is paying?" busy={busy()} onClose={conflict() ? declined : props.onClose}>
      <form onSubmit={onContinue} class="space-y-4">
        <AccountCell account={props.row.ad_account} />
        <Show
          when={conflict()}
          fallback={
            <>
              <div>
                <label class={LABEL}>Paid by (required)</label>
                <PayerPicker state={payer} payers={props.payers} />
              </div>
              <div class="flex justify-end gap-2">
                <button type="button" class={BTN_GHOST} disabled={busy()} onClick={props.onClose}>
                  Close
                </button>
                <button type="submit" class={BTN_PRIMARY} disabled={!payer.payload() || busy()}>
                  {busy() ? "Opening…" : "Continue to Ads Manager ↗"}
                </button>
              </div>
            </>
          }
        >
          <div class="rounded-lg border border-[#B07A14]/40 bg-[#FBF3E2] dark:bg-yellow-900/30 px-3 py-2 text-sm text-[#8A6410] dark:text-yellow-100">
            {conflict()}
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class={BTN_GHOST} disabled={busy()} onClick={declined}>
              No
            </button>
            <button type="button" class={BTN_PRIMARY} disabled={busy()} onClick={() => claim(true)}>
              {busy() ? "Opening…" : "Yes, pay anyway"}
            </button>
          </div>
        </Show>
      </form>
    </Modal>
  );
}

// ── summary strip ────────────────────────────────────────────────────────────

function Tile(props) {
  return (
    <div
      class={`rounded-xl border px-4 py-3 bg-white dark:bg-gray-900 ${props.border || "border-[#E2E8F1] dark:border-gray-700"}`}
    >
      <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
        {props.label}
      </p>
      <p class={`mt-1 text-xl font-bold tabular-nums ${props.valueClass || "text-[#14233A] dark:text-white"}`}>
        {props.value}
      </p>
      <Show when={props.sub}>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">{props.sub}</p>
      </Show>
    </div>
  );
}

// ── modals ───────────────────────────────────────────────────────────────────

// Mounted only while a row is picked, so the form is filled from the row at
// creation — never on screen before its values exist.
function MarkPaidModal(props) {
  const [amount, setAmount] = createSignal(
    isNum(props.row.amount_requested) ? String(props.row.amount_requested) : "",
  );
  const [reference, setReference] = createSignal("");
  const payer = createPayerState();
  const [busy, setBusy] = createSignal(false);
  const valid = () => isNum(amount()) && Number(amount()) > 0 && !!payer.payload();

  const submit = async (e) => {
    e.preventDefault();
    if (!valid() || busy()) return;
    setBusy(true);
    try {
      await markFundRequestPaid(props.row.id, {
        amount: Number(amount()),
        reference: reference().trim(),
        payer: payer.payload(),
      });
      showNotice("Marked paid");
      props.onDone();
    } catch (err) {
      reportError(err, "Couldn't mark this paid.", props.reload);
      if (err?.status === 409) props.onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Mark paid" busy={busy()} onClose={props.onClose}>
      <form onSubmit={submit} class="space-y-4">
        <AccountCell account={props.row.ad_account} />
        <div>
          <label class={LABEL}>Amount (₹)</label>
          <input
            type="number"
            min="1"
            step="any"
            class={INPUT}
            value={amount()}
            onInput={(e) => setAmount(e.currentTarget.value)}
            autofocus
          />
        </div>
        <div>
          <label class={LABEL}>Paid by (required)</label>
          <PayerPicker state={payer} payers={props.payers} />
        </div>
        <div>
          <label class={LABEL}>UTR / reference (optional)</label>
          <input
            type="text"
            class={INPUT}
            value={reference()}
            onInput={(e) => setReference(e.currentTarget.value)}
          />
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          After you pay in Ads Manager, the request turns Paid by itself within
          about 10 minutes. Use Mark paid only if it doesn't.
        </p>
        <div class="flex justify-end gap-2">
          <button type="button" class={BTN_GHOST} disabled={busy()} onClick={props.onClose}>
            Close
          </button>
          <button type="submit" class={BTN_PRIMARY} disabled={!valid() || busy()}>
            {busy() ? "Saving…" : "Mark paid"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditModal(props) {
  const orig = {
    amount: isNum(props.row.amount_requested) ? String(Number(props.row.amount_requested)) : "",
    priority: EDITABLE_PRIORITIES.includes(props.row.priority) ? props.row.priority : "normal",
    note: props.row.note ?? "",
  };
  const [amount, setAmount] = createSignal(orig.amount);
  const [priority, setPriority] = createSignal(orig.priority);
  const [note, setNote] = createSignal(orig.note);
  const [busy, setBusy] = createSignal(false);

  const patch = createMemo(() => {
    const p = {};
    if (amount() !== orig.amount && isNum(amount())) p.amount = Number(amount());
    if (priority() !== orig.priority) p.priority = priority();
    if (note() !== orig.note) p.note = note();
    return p;
  });
  const amountBad = () => amount() !== "" && !(isNum(amount()) && Number(amount()) > 0);
  const dirty = () => Object.keys(patch()).length > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!dirty() || amountBad() || busy()) return;
    setBusy(true);
    try {
      await updateFundRequest(props.row.id, patch());
      showNotice("Request updated");
      props.onDone();
    } catch (err) {
      reportError(err, "Couldn't update this request.", props.reload);
      if (err?.status === 409) props.onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit request" busy={busy()} onClose={props.onClose}>
      <form onSubmit={submit} class="space-y-4">
        <AccountCell account={props.row.ad_account} />
        <div>
          <label class={LABEL}>Amount (₹)</label>
          <input
            type="number"
            min="1"
            step="any"
            class={INPUT}
            value={amount()}
            onInput={(e) => setAmount(e.currentTarget.value)}
          />
        </div>
        <div>
          <label class={LABEL}>Priority</label>
          <PrioritySelect value={priority()} onChange={setPriority} />
        </div>
        <div>
          <label class={LABEL}>Note</label>
          <textarea
            rows="3"
            class={INPUT}
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
          />
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class={BTN_GHOST} disabled={busy()} onClick={props.onClose}>
            Close
          </button>
          <button type="submit" class={BTN_PRIMARY} disabled={!dirty() || amountBad() || busy()}>
            {busy() ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CancelModal(props) {
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const valid = () => reason().trim().length > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid() || busy()) return;
    setBusy(true);
    try {
      await cancelFundRequest(props.row.id, reason().trim());
      showNotice("Request cancelled");
      props.onDone();
    } catch (err) {
      reportError(err, "Couldn't cancel this request.", props.reload);
      if (err?.status === 409) props.onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Cancel request" busy={busy()} onClose={props.onClose}>
      <form onSubmit={submit} class="space-y-4">
        <AccountCell account={props.row.ad_account} />
        <div>
          <label class={LABEL}>Reason (required)</label>
          <textarea
            rows="3"
            class={INPUT}
            value={reason()}
            onInput={(e) => setReason(e.currentTarget.value)}
            autofocus
          />
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class={BTN_GHOST} disabled={busy()} onClick={props.onClose}>
            Keep it
          </button>
          <button type="submit" class={BTN_PRIMARY} disabled={!valid() || busy()}>
            {busy() ? "Cancelling…" : "Cancel request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PrioritySelect(props) {
  return (
    <div class="flex gap-2">
      <For each={EDITABLE_PRIORITIES}>
        {(p) => (
          <button
            type="button"
            onClick={() => props.onChange(p)}
            class={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              props.value === p
                ? "bg-[#14233A] text-white border-[#14233A]"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
            }`}
          >
            {PRIORITY[p].label}
          </button>
        )}
      </For>
    </div>
  );
}

function RaiseModal(props) {
  const [search, setSearch] = createSignal("");
  const [picked, setPicked] = createSignal(null);
  const [amount, setAmount] = createSignal("");
  const [priority, setPriority] = createSignal("normal");
  const [note, setNote] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const list = createMemo(() => {
    const q = search().trim().toLowerCase();
    const all = props.accounts() || [];
    if (!q) return all;
    return all.filter(
      (a) =>
        String(a.name || "").toLowerCase().includes(q) ||
        String(a.id || "").toLowerCase().includes(q) ||
        clientNames(a.clients).toLowerCase().includes(q),
    );
  });

  const pick = (a) => {
    if (a.can_raise === false) return;
    setPicked(a);
    setAmount(isNum(a.suggested_amount) ? String(Number(a.suggested_amount)) : "");
  };

  const amountBad = () => amount() !== "" && !(isNum(amount()) && Number(amount()) > 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!picked() || amountBad() || busy()) return;
    setBusy(true);
    const body = { ad_account_id: picked().id, priority: priority() };
    if (amount() !== "") body.amount = Number(amount());
    if (note().trim()) body.note = note().trim();
    try {
      const res = await raiseFundRequest(body);
      showNotice(res?.data?.merged ? "Added to the open request" : "Request raised");
      props.onDone();
    } catch (err) {
      reportError(err, "Couldn't raise this request.", props.reload);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Raise fund request" wide busy={busy()} onClose={props.onClose}>
      <form onSubmit={submit} class="space-y-4">
        <div>
          <label class={LABEL}>Ad account</label>
          <input
            type="text"
            class={INPUT}
            placeholder="Search by account name, id or client…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <div class="mt-2 max-h-64 overflow-y-auto rounded-lg border border-[#E2E8F1] dark:border-gray-700 divide-y divide-[#E2E8F1] dark:divide-gray-800">
            <Show
              when={!props.accountsLoading()}
              fallback={<p class="p-3 text-sm text-gray-400">Loading accounts…</p>}
            >
              <Show
                when={list().length}
                fallback={<p class="p-3 text-sm text-gray-400">No accounts match.</p>}
              >
                <For each={list()}>
                  {(a) => {
                    const disabled = () => a.can_raise === false;
                    const on = () => picked()?.id === a.id;
                    return (
                      <button
                        type="button"
                        disabled={disabled()}
                        onClick={() => pick(a)}
                        class={`w-full text-left px-3 py-2 text-sm flex items-start justify-between gap-3 transition-colors ${
                          on()
                            ? "bg-[#FBEEF0] dark:bg-[#AC2334]/20"
                            : disabled()
                              ? "opacity-45 cursor-not-allowed"
                              : "hover:bg-[#F6F9FC] dark:hover:bg-gray-800/60"
                        }`}
                      >
                        <div class="min-w-0">
                          <div class="font-semibold text-[#14233A] dark:text-gray-100 truncate">
                            {a.name || "—"}
                          </div>
                          <div class="text-[11px] text-gray-400 font-mono">{a.id}</div>
                          <Show when={clientNames(a.clients)}>
                            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {clientNames(a.clients)}
                            </div>
                          </Show>
                        </div>
                        <div class="text-right flex-none text-xs tabular-nums">
                          <div class="font-semibold text-gray-700 dark:text-gray-200">{money(a.wallet)}</div>
                          <div class={Number(a.hours_left) <= 0 && isNum(a.hours_left) ? "text-[#AC2334] font-semibold" : "text-gray-400"}>
                            {fmtHours(a.hours_left)} left
                          </div>
                          <Show when={a.open_request_id}>
                            <div class="text-[10px] font-semibold text-[#B07A14]">Already requested</div>
                          </Show>
                        </div>
                      </button>
                    );
                  }}
                </For>
              </Show>
            </Show>
          </div>
        </div>

        <Show when={picked()?.open_request_id}>
          <div class="rounded-lg border border-[#B07A14]/40 bg-[#FBF3E2] dark:bg-yellow-900/30 px-3 py-2 text-sm text-[#8A6410] dark:text-yellow-100">
            Already requested, your ask will be added to it.
          </div>
        </Show>

        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class={LABEL}>Amount (₹)</label>
            <input
              type="number"
              min="1"
              step="any"
              class={INPUT}
              placeholder="Leave empty to use the suggestion"
              value={amount()}
              onInput={(e) => setAmount(e.currentTarget.value)}
            />
          </div>
          <div>
            <label class={LABEL}>Priority</label>
            <PrioritySelect value={priority()} onChange={setPriority} />
          </div>
        </div>
        <div>
          <label class={LABEL}>Note</label>
          <textarea rows="2" class={INPUT} value={note()} onInput={(e) => setNote(e.currentTarget.value)} />
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class={BTN_GHOST} disabled={busy()} onClick={props.onClose}>
            Close
          </button>
          <button type="submit" class={BTN_PRIMARY} disabled={!picked() || amountBad() || busy()}>
            {busy() ? "Raising…" : "Raise request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── detail drawer ────────────────────────────────────────────────────────────

const EVENT_LABEL = {
  created: "Created",
  merged: "Ask merged in",
  amount_updated: "Amount updated",
  priority_changed: "Priority changed",
  note: "Note",
  paid_detected: "Paid (detected from Meta)",
  marked_paid: "Marked paid",
  cancelled: "Cancelled",
  auto_closed: "Auto-closed",
};

const eventData = (d) => {
  if (d == null || d === "") return [];
  if (typeof d !== "object") return [["", String(d)]];
  return Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== "");
};

function Drawer(props) {
  const [detail, setDetail] = createSignal(null);
  const [error, setError] = createSignal(null);

  createEffect(
    on(
      () => props.id,
      async (id) => {
        setDetail(null);
        setError(null);
        try {
          setDetail(await fetchFundRequest(id));
        } catch (err) {
          setError(loadErrorMessage(err, "Couldn't load this request."));
        }
      },
    ),
  );

  const onKey = (e) => e.key === "Escape" && props.onClose();
  onMount(() => document.addEventListener("keydown", onKey));
  onCleanup(() => document.removeEventListener("keydown", onKey));

  const row = () => detail() || props.row || {};
  const Field = (p) => (
    <div>
      <dt class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">{p.label}</dt>
      <dd class="mt-0.5 text-sm text-[#14233A] dark:text-gray-100 break-words">{p.children}</dd>
    </div>
  );

  return (
    <Portal>
      <div class="fixed inset-0 z-[85] bg-black/30" onClick={props.onClose} />
      <aside class="fixed top-0 right-0 bottom-0 z-[86] w-full sm:w-[460px] bg-white dark:bg-gray-900 border-l border-[#E2E8F1] dark:border-gray-700 shadow-2xl flex flex-col">
        <div class="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E2E8F1] dark:border-gray-800">
          <div class="min-w-0">
            <AccountCell account={row().ad_account} />
            <div class="mt-1.5">
              <PriorityChip value={row().effective_priority ?? row().priority} auto={row().source === "auto"} />
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={props.onClose}
            class="w-7 h-7 flex-none rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>
        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <Show when={error()}>
            <div class="rounded-lg bg-[#FBEEF0] border border-[#AC2334]/25 px-3 py-2 text-sm text-[#AC2334]">{error()}</div>
          </Show>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Status">{row().status || "open"}</Field>
            <Field label="Ask">{money(row().amount_requested)}</Field>
            <Field label="Loaded since request">{money(row().loaded_since_request)}</Field>
            <Field label="Wallet">
              {money(row().wallet)}
              <Show when={row().wallet_stale}>
                <span class="block text-xs text-gray-400">updated {ago(row().wallet_synced_at)}</span>
              </Show>
            </Field>
            <Field label="Daily budget">
              {money(row().daily_budget)}
              <Show when={isNum(row().daily_budget_inc_gst)}>
                <span class="block text-xs text-gray-400">{money(row().daily_budget_inc_gst)} incl. GST</span>
              </Show>
            </Field>
            <Field label="Spent today">{money(row().spent_today)}</Field>
            <Field label="Hours left">{fmtHours(row().hours_left)}</Field>
            <Field label="Raised by">
              {row().requested_by || "—"}
              <Show when={isNum(row().waiting_minutes)}>
                <span class="block text-xs text-gray-400">waiting {fmtWait(row().waiting_minutes)}</span>
              </Show>
            </Field>
            <Field label="Clients">{clientNames(row().clients) || "—"}</Field>
            <Field label="CMs">{joinList(row().campaign_managers) || "—"}</Field>
            <Show when={row().paid_amount != null}>
              <Field label="Paid">{money(row().paid_amount)}</Field>
            </Show>
            <Show when={row().closed_reason}>
              <Field label="Closed reason">{row().closed_reason}</Field>
            </Show>
          </dl>
          <Show when={warningLines(row().client_balance_warning).length}>
            <div class="rounded-lg border border-[#B07A14]/40 bg-[#FBF3E2] dark:bg-yellow-900/30 px-3 py-2 text-xs text-[#8A6410] dark:text-yellow-100">
              <p class="font-semibold mb-1">Client balance warning</p>
              <For each={warningLines(row().client_balance_warning)}>{(l) => <p>{l}</p>}</For>
            </div>
          </Show>
          <Show when={row().note}>
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] mb-1">Note</p>
              <p class="text-sm whitespace-pre-line text-gray-700 dark:text-gray-200">{row().note}</p>
            </div>
          </Show>

          <Show when={detail() && Array.isArray(detail().topups) && detail().topups.length}>
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] mb-2">Top-ups</p>
              <ul class="divide-y divide-[#E2E8F1] dark:divide-gray-800 rounded-lg border border-[#E2E8F1] dark:border-gray-700">
                <For each={detail().topups}>
                  {(t) => (
                    <li class="px-3 py-2 flex items-start justify-between gap-3 text-sm">
                      <div class="min-w-0">
                        <PaidByText topup={t} />
                        <Show when={t.paid_by && SOURCE_LABEL[t.paid_by_source]}>
                          <span class="block text-xs text-gray-400">{SOURCE_LABEL[t.paid_by_source]}</span>
                        </Show>
                      </div>
                      <div class="text-right flex-none tabular-nums">
                        <div class="font-semibold text-[#15966A] dark:text-green-400">{money(t.amount)}</div>
                        <Show when={topupTime(t)}>
                          <div class="text-xs text-gray-400">{fmtIST(topupTime(t))}</div>
                        </Show>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>

          <div>
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] mb-2">Timeline</p>
            <Show
              when={detail()}
              fallback={<Show when={!error()}><p class="text-sm text-gray-400">Loading…</p></Show>}
            >
              <Show
                when={(detail().events || []).length}
                fallback={<p class="text-sm text-gray-400">No events.</p>}
              >
                <ol class="relative border-l border-[#E2E8F1] dark:border-gray-700 ml-1.5 space-y-4">
                  <For each={detail().events}>
                    {(ev) => (
                      <li class="pl-4 relative">
                        <span class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-[#AC2334]" />
                        <p class="text-sm font-semibold text-[#14233A] dark:text-gray-100">
                          {EVENT_LABEL[ev.kind] ?? ev.kind}
                        </p>
                        <p class="text-xs text-gray-500 dark:text-gray-400">
                          {ev.by || "System"} · {fmtWhen(ev.at)}
                        </p>
                        <Show when={eventData(ev.data).length}>
                          <div class="mt-1 text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                            <For each={eventData(ev.data)}>
                              {([k, v]) => (
                                <p class="break-words">
                                  <Show when={k}>
                                    <span class="text-gray-400">{k.replace(/_/g, " ")}: </span>
                                  </Show>
                                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                </p>
                              )}
                            </For>
                          </div>
                        </Show>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            </Show>
          </div>
        </div>
      </aside>
    </Portal>
  );
}

// ── funds register ───────────────────────────────────────────────────────────

// data.rows[]: { date, ad_account (name), ad_account_id, clients (string),
// campaign_managers (string), daily_budget, topups, funds_added, spend,
// spend_inc_gst, wallet_end_of_day, requests }. Money is strings ("1500.00");
// daily_budget and wallet_end_of_day can be null → "-".
// data.totals: { funds_added, topups, spend, spend_inc_gst, requests }.
const regMoney = (v) => (isNum(v) ? money(v) : "-");
const regNum = (v) => (isNum(v) ? num(v) : "-");

const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
];
const rangeFor = (key) => {
  const t = toYMD(new Date());
  if (key === "today") return { from: t, to: t };
  if (key === "yesterday") {
    const y = shiftYMD(t, -1);
    return { from: y, to: y };
  }
  if (key === "month") return { from: `${t.slice(0, 8)}01`, to: t };
  return { from: shiftYMD(t, -6), to: t };
};

function Register(props) {
  const initial = rangeFor("7d");
  const [rangeKey, setRangeKey] = createSignal("7d");
  const [from, setFrom] = createSignal(initial.from);
  const [to, setTo] = createSignal(initial.to);
  const [adAccount, setAdAccount] = createSignal("");
  const [cmId, setCmId] = createSignal("");
  const [res, setRes] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [downloading, setDownloading] = createSignal(false);
  const [sort, setSort] = createSignal(null);
  const onSort = (key) => setSort((cur) => nextSort(cur, key, REGISTER_SORT));

  const span = () => (from() && to() ? daySpan(from(), to()) : 0);
  const rangeError = () => {
    if (!from() || !to()) return "Pick both dates.";
    if (span() < 1) return "Start date is after end date.";
    if (span() > REGISTER_MAX_DAYS) return `Pick ${REGISTER_MAX_DAYS} days or fewer.`;
    return null;
  };

  const setRange = (key) => {
    setRangeKey(key);
    if (key !== "custom") {
      const r = rangeFor(key);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const filters = () => ({ from: from(), to: to(), adAccount: adAccount(), cmId: cmId() });

  let seq = 0;
  const load = async () => {
    if (rangeError()) return;
    const mine = ++seq;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchFundRegister(filters());
      if (mine === seq) setRes(r);
    } catch (err) {
      if (mine === seq) setError(loadErrorMessage(err, "Couldn't load the register."));
    } finally {
      if (mine === seq) setLoading(false);
    }
  };

  createEffect(
    on([from, to, adAccount, cmId, scopeKey], () => load()),
  );

  const download = async () => {
    if (rangeError() || downloading()) return;
    setDownloading(true);
    try {
      await downloadFundRegister(filters());
    } catch (err) {
      showNotice(err?.message || "Download failed.", "warn");
    } finally {
      setDownloading(false);
    }
  };

  const rows = () => {
    const list = res()?.data?.rows;
    if (!Array.isArray(list)) return [];
    // Newest date first unless a column sort is picked.
    const byDate = [...list].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    return sortBy(byDate, sort(), REGISTER_SORT);
  };
  const totals = () => res()?.data?.totals || null;

  const TH = "sticky top-0 z-10 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 bg-[#F6F9FC] dark:bg-gray-800";
  const TD = "px-3 py-2 align-top border-b border-[#E2E8F1] dark:border-gray-800";
  const TDN = `${TD} text-right tabular-nums whitespace-nowrap`;

  return (
    <section class="mt-8">
      <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 class="text-lg font-bold text-[#14233A] dark:text-white">Funds register</h2>
          <p class="text-sm text-[#54657E] dark:text-gray-400">Daily funds, spend and requests per ad account.</p>
        </div>
        <button type="button" class={BTN_GHOST} disabled={!!rangeError() || downloading()} onClick={download}>
          {downloading() ? "Preparing…" : "Download Excel"}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2 mb-3">
        <For each={RANGES}>
          {(r) => (
            <button
              type="button"
              onClick={() => setRange(r.key)}
              class={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                rangeKey() === r.key
                  ? "bg-[#14233A] text-white border-[#14233A]"
                  : "bg-white dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
              }`}
            >
              {r.label}
            </button>
          )}
        </For>
        <Show when={rangeKey() === "custom"}>
          <input
            type="date"
            class={`${INPUT} !w-auto`}
            value={from()}
            max={to() || undefined}
            onChange={(e) => setFrom(e.currentTarget.value)}
          />
          <span class="text-gray-400 text-sm">to</span>
          <input
            type="date"
            class={`${INPUT} !w-auto`}
            value={to()}
            min={from() || undefined}
            max={toYMD(new Date())}
            onChange={(e) => setTo(e.currentTarget.value)}
          />
        </Show>
        <SearchSelect
          class="w-[300px]"
          allLabel="All ad accounts"
          placeholder="Search account name or id…"
          value={adAccount()}
          onChange={setAdAccount}
          options={(props.accounts() || []).map((a) => ({ value: a.id, label: `${a.name || a.id} · ${a.id}` }))}
        />
        <Show when={props.cms().length}>
          <SearchSelect
            class="w-[240px]"
            allLabel="All campaign managers"
            placeholder="Search CM…"
            value={cmId()}
            onChange={setCmId}
            options={props.cms().map((m) => ({ value: m.id, label: m.label }))}
          />
        </Show>
      </div>

      <Show when={rangeError()}>
        <p class="text-sm text-[#AC2334] mb-2">{rangeError()}</p>
      </Show>
      <Show when={error()}>
        <div class="rounded-xl bg-[#FBEEF0] border border-[#AC2334]/25 p-3 mb-3 text-sm text-[#AC2334]">{error()}</div>
      </Show>

      <div class={`overflow-auto max-h-[calc(100vh-10rem)] rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 transition-opacity ${loading() ? "opacity-60" : ""}`}>
        <table class="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th class={`${TH} text-left`}><SortBtn col="date" label="Date" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-left`}><SortBtn col="account" label="Ad account" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-left`}><SortBtn col="clients" label="Clients" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-left`}><SortBtn col="cms" label="CMs" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-right`}><SortBtn col="daily_budget" label="Daily budget" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-right`}><SortBtn col="topups" label="Top-ups" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-right`}><SortBtn col="funds_added" label="Funds added" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-left`}><SortBtn col="paid_by" label="Paid by" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-right`}><SortBtn col="spend" label="Spend" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-right`}><SortBtn col="spend_inc_gst" label="Spend incl GST" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-right`}><SortBtn col="wallet_end_of_day" label="Wallet at day end" sort={sort()} onSort={onSort} /></th>
              <th class={`${TH} text-right`}><SortBtn col="requests" label="Requests" sort={sort()} onSort={onSort} /></th>
            </tr>
          </thead>
          <tbody>
            <Show
              when={rows().length}
              fallback={
                <tr>
                  <td colspan="12" class="px-4 py-8 text-center text-sm text-gray-400">
                    {loading() && !res() ? "Loading…" : "Nothing in this range."}
                  </td>
                </tr>
              }
            >
              <For each={rows()}>
                {(r) => (
                  <tr class="hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40">
                    <td class={`${TD} whitespace-nowrap`}>{prettyYMD(r.date)}</td>
                    <td class={TD}><AccountCell account={{ name: r.ad_account, id: r.ad_account_id }} /></td>
                    <td class={`${TD} text-xs text-gray-600 dark:text-gray-300 min-w-[180px] max-w-[240px] [overflow-wrap:anywhere]`}>{r.clients || "-"}</td>
                    <td class={`${TD} text-xs text-gray-600 dark:text-gray-300 min-w-[120px] max-w-[200px] [overflow-wrap:anywhere]`}>{r.campaign_managers || "-"}</td>
                    <td class={TDN}>{regMoney(r.daily_budget)}</td>
                    <td class={TDN}>{regNum(r.topups)}</td>
                    <td class={`${TDN} font-semibold text-[#15966A] dark:text-green-400`}>{regMoney(r.funds_added)}</td>
                    {/* "accounts, Alok sir" | "not set" | "" before 29 Oct 2026 */}
                    <td class={`${TD} text-xs min-w-[120px] max-w-[200px] [overflow-wrap:anywhere] ${r.paid_by === "not set" ? "font-semibold text-[#B07A14]" : "text-gray-700 dark:text-gray-200"}`}>
                      {r.paid_by || "-"}
                    </td>
                    <td class={TDN}>{regMoney(r.spend)}</td>
                    <td class={TDN}>{regMoney(r.spend_inc_gst)}</td>
                    <td class={TDN}>{regMoney(r.wallet_end_of_day)}</td>
                    <td class={TDN}>{regNum(r.requests)}</td>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
          <Show when={totals() && rows().length}>
            <tfoot>
              <tr class="bg-[#F6F9FC] dark:bg-gray-800 font-bold">
                <td class={`${TD} text-[11px] uppercase tracking-wider text-[#8593A8]`} colspan="4">Total</td>
                {/* No daily-budget or wallet total: neither sums across days. */}
                <td class={TDN} />
                <td class={TDN}>{regNum(totals().topups)}</td>
                <td class={`${TDN} text-[#15966A] dark:text-green-400`}>{regMoney(totals().funds_added)}</td>
                <td class={TD} />
                <td class={TDN}>{regMoney(totals().spend)}</td>
                <td class={TDN}>{regMoney(totals().spend_inc_gst)}</td>
                <td class={TDN} />
                <td class={TDN}>{regNum(totals().requests)}</td>
              </tr>
            </tfoot>
          </Show>
        </table>
      </div>
      <Show when={res()?.meta?.note}>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">{res().meta.note}</p>
      </Show>
    </section>
  );
}

// ── top-ups (who paid) ───────────────────────────────────────────────────────
// GET /topups/ → data: { rows, by_payer:[{paid_by, amount, topups}],
// unset:{topups, amount}, total }. Payer tracking started 29 Oct 2026; older
// rows carry payer_tracked:false and show "-".

// Paid-by cell. can_set → inline picker ("Add payer" when empty, "Change" when
// filled — only accounts/admin get can_set on a filled row). Otherwise text.
function TopupPayerCell(props) {
  const [editing, setEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const payer = createPayerState();
  const t = () => props.topup;

  const save = async () => {
    if (!payer.payload() || busy()) return;
    setBusy(true);
    try {
      await setTopupPayer(t().id, payer.payload());
      showNotice("Payer saved");
      setEditing(false);
      props.onSaved();
    } catch (err) {
      showNotice(errorMessage(err, "Couldn't save the payer."), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={t().can_set} fallback={<PaidByText topup={t()} />}>
      <Show
        when={editing()}
        fallback={
          <div class="flex items-center gap-2 flex-wrap">
            <Show when={t().paid_by}>
              <span class="font-semibold text-[#14233A] dark:text-gray-100">{t().paid_by}</span>
            </Show>
            <button
              type="button"
              class={`${BTN_ROW} ${
                t().paid_by
                  ? "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                  : "border-[#B07A14]/50 text-[#8A6410] bg-[#FBF3E2] hover:bg-[#F6E7C4] dark:bg-yellow-900/30 dark:text-yellow-100"
              }`}
              onClick={() => setEditing(true)}
            >
              {t().paid_by ? "Change" : "Add payer"}
            </button>
          </div>
        }
      >
        <div class="w-[220px] space-y-1.5">
          <PayerPicker state={payer} payers={props.payers} />
          <div class="flex gap-1.5">
            <button
              type="button"
              class={`${BTN_ROW} bg-[#AC2334] text-white border-[#AC2334] hover:bg-[#8F1C2B]`}
              disabled={!payer.payload() || busy()}
              onClick={save}
            >
              {busy() ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              class={`${BTN_ROW} border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300`}
              disabled={busy()}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>
    </Show>
  );
}

function Topups(props) {
  const initial = rangeFor("7d");
  const [rangeKey, setRangeKey] = createSignal("7d");
  const [from, setFrom] = createSignal(initial.from);
  const [to, setTo] = createSignal(initial.to);
  const [adAccount, setAdAccount] = createSignal("");
  const [paidBy, setPaidBy] = createSignal("");
  const [res, setRes] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal(null);

  const rangeError = () => {
    if (!from() || !to()) return "Pick both dates.";
    if (daySpan(from(), to()) < 1) return "Start date is after end date.";
    return null;
  };
  const setRange = (key) => {
    setRangeKey(key);
    if (key !== "custom") {
      const r = rangeFor(key);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  let seq = 0;
  const load = async () => {
    if (rangeError()) return;
    const mine = ++seq;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchFundTopups({ from: from(), to: to(), adAccount: adAccount(), paidBy: paidBy() });
      if (mine === seq) setRes(r);
    } catch (err) {
      if (mine === seq) setError(loadErrorMessage(err, "Couldn't load top-ups."));
    } finally {
      if (mine === seq) setLoading(false);
    }
  };
  createEffect(on([from, to, adAccount, paidBy, scopeKey], () => load()));

  const data = () => res()?.data || {};
  const rows = () => {
    const list = Array.isArray(data().rows) ? data().rows : [];
    // Newest first.
    return [...list].sort((a, b) => String(topupTime(b) ?? "").localeCompare(String(topupTime(a) ?? "")));
  };
  const byPayer = () => (Array.isArray(data().by_payer) ? data().by_payer : []);
  const total = () => {
    const t = data().total;
    if (t && typeof t === "object") return { amount: t.amount, topups: t.topups };
    return { amount: t, topups: null };
  };

  const payerOptions = () => {
    const p = props.payers() || {};
    return [
      ...(p.users || []).map((u) => ({ value: String(u.id), label: u.name })),
      ...(p.other_names || []).map((n) => ({ value: n, label: n })),
      { value: "unset", label: "Not set" },
    ];
  };

  const TH = "sticky top-0 z-10 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 bg-[#F6F9FC] dark:bg-gray-800 text-left";
  const TD = "px-3 py-2 align-top border-b border-[#E2E8F1] dark:border-gray-800";
  const CHIP = "inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-full border text-[13px] tabular-nums";

  return (
    <section class="mt-8">
      <div class="mb-3">
        <h2 class="text-lg font-bold text-[#14233A] dark:text-white">Top-ups (who paid)</h2>
        <p class="text-sm text-[#54657E] dark:text-gray-400">Every top-up Meta recorded, and who paid for it.</p>
      </div>

      <div class="flex flex-wrap items-center gap-2 mb-3">
        <For each={RANGES}>
          {(r) => (
            <button
              type="button"
              onClick={() => setRange(r.key)}
              class={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                rangeKey() === r.key
                  ? "bg-[#14233A] text-white border-[#14233A]"
                  : "bg-white dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
              }`}
            >
              {r.label}
            </button>
          )}
        </For>
        <Show when={rangeKey() === "custom"}>
          <input type="date" class={`${INPUT} !w-auto`} value={from()} max={to() || undefined} onChange={(e) => setFrom(e.currentTarget.value)} />
          <span class="text-gray-400 text-sm">to</span>
          <input type="date" class={`${INPUT} !w-auto`} value={to()} min={from() || undefined} max={toYMD(new Date())} onChange={(e) => setTo(e.currentTarget.value)} />
        </Show>
        <SearchSelect
          class="w-[300px]"
          allLabel="All ad accounts"
          placeholder="Search account name or id…"
          value={adAccount()}
          onChange={setAdAccount}
          options={(props.accounts() || []).map((a) => ({ value: a.id, label: `${a.name || a.id} · ${a.id}` }))}
        />
        <SearchSelect
          class="w-[220px]"
          allLabel="Anyone paid"
          placeholder="Search payer…"
          value={paidBy()}
          onChange={setPaidBy}
          options={payerOptions()}
        />
      </div>

      <Show when={rangeError()}>
        <p class="text-sm text-[#AC2334] mb-2">{rangeError()}</p>
      </Show>
      <Show when={error()}>
        <div class="rounded-xl bg-[#FBEEF0] border border-[#AC2334]/25 p-3 mb-3 text-sm text-[#AC2334]">{error()}</div>
      </Show>

      <Show when={res()}>
        <div class="flex flex-wrap gap-2 mb-3">
          <span class={`${CHIP} border-[#14233A] bg-[#14233A] text-white`}>
            <span class="font-semibold">Total</span>
            <span class="font-bold">{money(total().amount)}</span>
            <Show when={isNum(total().topups)}>
              <span class="text-xs opacity-75">· {num(total().topups)} top-ups</span>
            </Show>
          </span>
          <For each={byPayer()}>
            {(p) => (
              <span class={`${CHIP} border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 text-[#14233A] dark:text-gray-100`}>
                <span class="font-semibold">{p.paid_by || "—"}</span>
                <span class="font-bold">{money(p.amount)}</span>
                <span class="text-xs text-gray-400">· {num(p.topups)}</span>
              </span>
            )}
          </For>
          <Show when={Number(data().unset?.topups) > 0}>
            <span class={`${CHIP} border-[#B07A14]/50 bg-[#FBF3E2] text-[#8A6410] dark:bg-yellow-900/30 dark:text-yellow-100`}>
              <span class="font-semibold">Payer not set (since 29 Oct)</span>
              <span class="font-bold">{money(data().unset.amount)}</span>
              <span class="text-xs opacity-75">· {num(data().unset.topups)}</span>
            </span>
          </Show>
        </div>
      </Show>

      <div class={`overflow-auto max-h-[calc(100vh-10rem)] rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 transition-opacity ${loading() ? "opacity-60" : ""}`}>
        <table class="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th class={TH}>Time (IST)</th>
              <th class={TH}>Ad account</th>
              <th class={`${TH} !text-right`}>Amount</th>
              <th class={TH}>Method</th>
              <th class={TH}>Paid by</th>
              <th class={TH}>Entered via</th>
              <th class={TH}>Entered by</th>
            </tr>
          </thead>
          <tbody>
            <Show
              when={rows().length}
              fallback={
                <tr>
                  <td colspan="7" class="px-4 py-8 text-center text-sm text-gray-400">
                    {loading() && !res() ? "Loading…" : "No top-ups in this range."}
                  </td>
                </tr>
              }
            >
              <For each={rows()}>
                {(t) => (
                  <tr class="hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40">
                    <td class={`${TD} whitespace-nowrap tabular-nums`}>{fmtIST(topupTime(t))}</td>
                    <td class={`${TD} max-w-[240px]`}><AccountCell account={acctOf(t)} /></td>
                    <td class={`${TD} text-right tabular-nums whitespace-nowrap font-semibold text-[#15966A] dark:text-green-400`}>{money(t.amount)}</td>
                    <td class={`${TD} text-xs text-gray-600 dark:text-gray-300`}>{/* Meta sends "0" for some non-UPI payments. */}
                      {String(t.method) === "0" ? "Other" : t.method || "-"}
                    </td>
                    <td class={TD}>
                      <TopupPayerCell topup={t} payers={props.payers} onSaved={load} />
                    </td>
                    <td class={`${TD} text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap`}>
                      {t.paid_by ? SOURCE_LABEL[t.paid_by_source] || t.paid_by_source || "-" : "-"}
                    </td>
                    <td class={`${TD} text-xs text-gray-600 dark:text-gray-300`}>{t.set_by || "-"}</td>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function FundRequests() {
  const [queue, setQueue] = createSignal(null); // full response
  const [loadError, setLoadError] = createSignal(null);
  const [cmId, setCmId] = createSignal("");
  const [cms, setCms] = createSignal([]);
  const [showClosed, setShowClosed] = createSignal(false);

  const [accounts, setAccounts] = createSignal([]);
  const [accountsLoading, setAccountsLoading] = createSignal(false);

  // Payer picker options, shared by every place that records who paid.
  const [payers, setPayers] = createSignal(null);

  // { kind: "claim"|"pay"|"edit"|"cancel"|"raise", row? }
  const [modal, setModal] = createSignal(null);
  const [drawerRow, setDrawerRow] = createSignal(null);

  let seq = 0;
  const loadQueue = async () => {
    const mine = ++seq;
    try {
      const res = await fetchFundQueue({ cmId: cmId() });
      if (mine !== seq) return;
      setQueue(res);
      setLoadError(null);
      // meta.cms = [{ id, name, open }] feeds both CM dropdowns (queue and
      // register) as "name (open)".
      const list = res?.meta?.cms;
      if (Array.isArray(list) && list.length) {
        setCms(
          list
            .filter((m) => m?.id != null)
            .map((m) => ({ id: m.id, label: `${m.name || `#${m.id}`} (${Number(m.open) || 0})` })),
        );
      }
    } catch (err) {
      if (mine === seq) setLoadError(loadErrorMessage(err, "Couldn't load fund requests."));
    }
  };

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      setAccounts(await fetchFundAccounts());
    } catch (err) {
      console.warn("[fundRequests] accounts failed:", err?.message);
    } finally {
      setAccountsLoading(false);
    }
  };

  // Re-key on the Viewing switch and the CM filter.
  createEffect(on([scopeKey, cmId], () => loadQueue()));
  createEffect(on(scopeKey, () => loadAccounts()));
  createEffect(
    on(scopeKey, async () => {
      try {
        setPayers(await fetchFundPayers());
      } catch (err) {
        console.warn("[fundRequests] payers failed:", err?.message);
      }
    }),
  );

  onMount(() => {
    const tick = () => {
      if (!document.hidden) loadQueue();
    };
    const timer = setInterval(tick, QUEUE_POLL_MS);
    const onFocus = () => loadQueue();
    window.addEventListener("focus", onFocus);
    onCleanup(() => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    });
  });

  // After any write: re-read the queue, the badge and (for raise) accounts.
  const afterWrite = () => {
    setModal(null);
    loadQueue();
    refreshFundRequestsBadge();
    loadAccounts();
  };

  const meta = () => queue()?.meta || {};
  const counts = () => meta().counts || {};
  const [queueSort, setQueueSort] = createSignal(null);
  const [closedSort, setClosedSort] = createSignal(null);
  const onQueueSort = (key) => setQueueSort((cur) => nextSort(cur, key, QUEUE_SORT));
  const onClosedSort = (key) => setClosedSort((cur) => nextSort(cur, key, CLOSED_SORT));
  const open = () =>
    sortBy(Array.isArray(queue()?.data?.open) ? queue().data.open : [], queueSort(), QUEUE_SORT);
  const closedToday = () =>
    sortBy(Array.isArray(queue()?.data?.closed_today) ? queue().data.closed_today : [], closedSort(), CLOSED_SORT);

  const openRaise = () => {
    setModal({ kind: "raise" });
    if (!accounts().length) loadAccounts();
  };

  const TH = "sticky top-0 z-10 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 bg-[#F6F9FC] dark:bg-gray-800 text-left";
  const TD = "px-3 py-2.5 align-top border-b border-[#E2E8F1] dark:border-gray-800";

  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div class="font-sans min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 class="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Fund Requests
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-[#54657E] dark:text-gray-400 mt-1">
            Prepaid ad accounts waiting for a top-up, most urgent first.
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <Show when={cms().length}>
            <SearchSelect
              class="w-[240px]"
              allLabel="All campaign managers"
              placeholder="Search CM…"
              value={cmId()}
              onChange={setCmId}
              options={cms().map((m) => ({ value: m.id, label: m.label }))}
            />
          </Show>
          <Show when={meta().can_raise_any}>
            <button type="button" class={BTN_PRIMARY} onClick={openRaise}>
              + Raise request
            </button>
          </Show>
        </div>
      </div>

      <Show when={loadError()}>
        <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
          {loadError()}
        </div>
      </Show>

      {/* 1. Summary strip */}
      <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <Tile
          label="Stopped"
          value={queue() ? num(counts().stopped ?? 0) : "…"}
          valueClass="text-[#AC2334]"
          border="border-[#AC2334]/30"
        />
        <Tile label="Urgent" value={queue() ? num(counts().urgent ?? 0) : "…"} valueClass="text-orange-600 dark:text-orange-300" border="border-orange-300/60 dark:border-orange-800" />
        <Tile label="High" value={queue() ? num(counts().high ?? 0) : "…"} valueClass="text-amber-600 dark:text-amber-300" border="border-amber-300/60 dark:border-amber-800" />
        <Tile label="Normal" value={queue() ? num(counts().normal ?? 0) : "…"} valueClass="text-gray-700 dark:text-gray-200" />
        <Tile
          label="Paid today"
          value={queue() ? num(counts().paid_today ?? 0) : "…"}
          sub={queue() ? money(meta().paid_today_amount) : ""}
          valueClass="text-[#15966A] dark:text-green-400"
        />
        <Tile label="Total asked" value={queue() ? money(meta().asked_open_amount) : "…"} />
      </div>

      {/* 2. Queue */}
      <div class="overflow-auto max-h-[calc(100vh-10rem)] rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-[0_1px_2px_rgba(16,29,49,.05)]">
        <table class="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th class={TH}><SortBtn col="priority" label="Priority" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={TH}><SortBtn col="account" label="Ad account" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={TH}><SortBtn col="clients" label="Clients" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={TH}><SortBtn col="cms" label="CMs" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={`${TH} !text-right`}><SortBtn col="wallet" label="Wallet" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={`${TH} !text-right`}><SortBtn col="daily_budget" label="Daily budget" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={`${TH} !text-right`}><SortBtn col="spent_today" label="Spent today" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={`${TH} !text-right`}><SortBtn col="hours_left" label="Hours left" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={`${TH} !text-right`}><SortBtn col="ask" label="Ask" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={TH}><SortBtn col="raised" label="Raised" sort={queueSort()} onSort={onQueueSort} /></th>
              <th class={TH}>Note</th>
              <th class={`${TH} right-0 !z-20 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            <Show
              when={open().length}
              fallback={
                <tr>
                  <td colspan="12" class="px-4 py-10 text-center text-sm text-gray-400">
                    {queue() ? "No open fund requests." : loadError() ? "—" : "Loading…"}
                  </td>
                </tr>
              }
            >
              <For each={open()}>
                {(r) => {
                  const warns = () => warningLines(r.client_balance_warning);
                  const pr = () => r.effective_priority ?? r.priority;
                  return (
                    <tr
                      onClick={() => setDrawerRow(r)}
                      class={`cursor-pointer transition-colors hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40 ${pr() === "stopped" ? "bg-[#FBEEF0]/50 dark:bg-red-900/10" : ""}`}
                    >
                      <td class={TD}>
                        <PriorityChip value={pr()} auto={r.source === "auto"} />
                      </td>
                      <td class={`${TD} max-w-[220px]`}>
                        <div class="flex items-start gap-1.5">
                          <AccountCell account={r.ad_account} />
                          <Show when={Number(r.unset_payer_topups) > 0}>
                            <span
                              class="flex-none mt-1.5 w-2 h-2 rounded-full bg-[#D89A2B]"
                              title={`${r.unset_payer_topups} top-up${Number(r.unset_payer_topups) === 1 ? "" : "s"} without a payer`}
                            />
                          </Show>
                        </div>
                        <Show when={r.being_paid}>
                          <div class="mt-1.5">
                            <span class="inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-bold bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-200 dark:ring-yellow-700">
                              {r.claim_payer || "Someone"} is paying
                            </span>
                            <span class="block text-[11px] text-gray-400 mt-0.5">
                              opened by {r.claimed_by || "—"}
                              <Show when={minsSince(r.claimed_at) != null}>, {fmtWait(minsSince(r.claimed_at))} ago</Show>
                            </span>
                          </div>
                        </Show>
                      </td>
                      <td class={`${TD} text-xs text-gray-700 dark:text-gray-300 min-w-[180px] max-w-[240px]`}>
                        <span class="flex items-start gap-1">
                          <span class="min-w-0 [overflow-wrap:anywhere]">{clientNames(r.clients) || "—"}</span>
                          <Show when={warns().length}>
                            <span
                              class="flex-none cursor-help text-[#B07A14]"
                              title={warns().join("\n")}
                              aria-label={`Client balance warning: ${warns().join("; ")}`}
                            >
                              ⚠
                            </span>
                          </Show>
                        </span>
                      </td>
                      <td class={`${TD} text-xs text-gray-700 dark:text-gray-300 min-w-[120px] max-w-[200px] [overflow-wrap:anywhere]`}>
                        {joinList(r.campaign_managers) || "—"}
                      </td>
                      <td class={`${TD} text-right tabular-nums whitespace-nowrap`}>
                        {money(r.wallet)}
                        <Show when={r.wallet_stale}>
                          <span class="block text-[11px] text-gray-400">updated {ago(r.wallet_synced_at)}</span>
                        </Show>
                      </td>
                      <td
                        class={`${TD} text-right tabular-nums whitespace-nowrap`}
                        title={isNum(r.daily_budget_inc_gst) ? `${money(r.daily_budget_inc_gst)} incl. GST` : undefined}
                      >
                        {money(r.daily_budget)}
                      </td>
                      <td class={`${TD} text-right tabular-nums whitespace-nowrap`}>{money(r.spent_today)}</td>
                      <td
                        class={`${TD} text-right tabular-nums whitespace-nowrap ${
                          isNum(r.hours_left) && Number(r.hours_left) <= 0 ? "text-[#AC2334] font-bold" : ""
                        }`}
                      >
                        {fmtHours(r.hours_left)}
                      </td>
                      <td class={`${TD} text-right tabular-nums whitespace-nowrap`}>
                        <span class="font-bold text-[#14233A] dark:text-white">{money(r.amount_requested)}</span>
                        <Show when={Number(r.loaded_since_request) > 0}>
                          <span class="block text-[11px] text-[#15966A]">{money(r.loaded_since_request)} loaded</span>
                        </Show>
                      </td>
                      <td class={`${TD} text-xs whitespace-nowrap`}>
                        <span class="font-semibold text-gray-700 dark:text-gray-200">{r.requested_by || "—"}</span>
                        <Show when={isNum(r.waiting_minutes)}>
                          <span class="block text-gray-400">{fmtWait(r.waiting_minutes)}</span>
                        </Show>
                      </td>
                      <td class={TD}>
                        <NoteCell note={r.note} />
                      </td>
                      <td
                        class={`${TD} sticky right-0 bg-white dark:bg-gray-900 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div class="flex flex-col items-stretch gap-1.5 w-[150px]">
                          {/* Asks who is paying first; the claim hands back the URL. */}
                          <Show when={r.can_claim}>
                            <button
                              type="button"
                              class={`${BTN_ROW} bg-[#14233A] text-white border-[#14233A] hover:bg-[#1F3352]`}
                              onClick={stop(() => setModal({ kind: "claim", row: r }))}
                            >
                              Pay in Ads Manager ↗
                            </button>
                          </Show>
                          <Show when={r.can_pay}>
                            <button
                              type="button"
                              class={`${BTN_ROW} border-[#15966A]/40 text-[#15966A] hover:bg-[#E9F7F1] dark:hover:bg-green-900/20`}
                              onClick={stop(() => setModal({ kind: "pay", row: r }))}
                            >
                              Mark paid
                            </button>
                          </Show>
                          <Show when={r.can_edit}>
                            <button
                              type="button"
                              class={`${BTN_ROW} border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800`}
                              onClick={stop(() => setModal({ kind: "edit", row: r }))}
                            >
                              Edit
                            </button>
                          </Show>
                          <Show when={r.can_cancel}>
                            <button
                              type="button"
                              class={`${BTN_ROW} border-[#AC2334]/30 text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/20`}
                              onClick={stop(() => setModal({ kind: "cancel", row: r }))}
                            >
                              Cancel
                            </button>
                          </Show>
                        </div>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </Show>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
        After you pay in Ads Manager, the request turns Paid by itself within
        about 10 minutes. Use Mark paid only if it doesn't.
      </p>

      {/* Closed today */}
      <div class="mt-4">
        <button
          type="button"
          class="inline-flex items-center gap-2 text-sm font-semibold text-[#14233A] dark:text-gray-200"
          onClick={() => setShowClosed((v) => !v)}
        >
          <svg
            class="w-4 h-4 text-[#8593A8] transition-transform"
            style={{ transform: showClosed() ? "rotate(90deg)" : "rotate(0deg)" }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Closed today
          <span class="text-[11px] font-bold px-1.5 py-px rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
            {closedToday().length}
          </span>
        </button>
        <Show when={showClosed()}>
          <div class="mt-2 overflow-auto max-h-[calc(100vh-10rem)] rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900">
            <table class="min-w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th class={TH}><SortBtn col="account" label="Ad account" sort={closedSort()} onSort={onClosedSort} /></th>
                  <th class={`${TH} !text-right`}><SortBtn col="ask" label="Ask" sort={closedSort()} onSort={onClosedSort} /></th>
                  <th class={TH}><SortBtn col="status" label="Status" sort={closedSort()} onSort={onClosedSort} /></th>
                  <th class={`${TH} !text-right`}><SortBtn col="paid" label="Paid" sort={closedSort()} onSort={onClosedSort} /></th>
                  <th class={TH}>Paid via</th>
                  <th class={TH}>Paid by</th>
                  <th class={`${TH} !text-right`}><SortBtn col="time_to_pay" label="Time to pay" sort={closedSort()} onSort={onClosedSort} /></th>
                  <th class={TH}>Reason</th>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={closedToday().length}
                  fallback={
                    <tr>
                      <td colspan="8" class="px-4 py-6 text-center text-sm text-gray-400">Nothing closed yet today.</td>
                    </tr>
                  }
                >
                  <For each={closedToday()}>
                    {(r) => (
                      <tr onClick={() => setDrawerRow(r)} class="cursor-pointer hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40">
                        <td class={`${TD} max-w-[240px]`}><AccountCell account={r.ad_account} /></td>
                        <td class={`${TD} text-right tabular-nums`}>{money(r.amount_requested)}</td>
                        <td class={TD}>
                          <span
                            class={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                              r.status === "paid"
                                ? "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                            }`}
                          >
                            {r.status || "—"}
                          </span>
                        </td>
                        <td class={`${TD} text-right tabular-nums`}>{money(r.paid_amount)}</td>
                        <td class={`${TD} text-xs`}>
                          {r.paid_via === "meta"
                            ? "Detected from Meta"
                            : r.paid_via === "manual"
                              ? "Marked by hand"
                              : "—"}
                        </td>
                        <td class={`${TD} text-xs font-semibold text-[#14233A] dark:text-gray-100`}>{r.paid_by || "—"}</td>
                        <td class={`${TD} text-right tabular-nums whitespace-nowrap`}>
                          {isNum(r.minutes_to_pay) ? fmtWait(r.minutes_to_pay) : "—"}
                        </td>
                        <td class={`${TD} text-xs text-gray-600 dark:text-gray-300`}>{r.closed_reason || "—"}</td>
                      </tr>
                    )}
                  </For>
                </Show>
              </tbody>
            </table>
          </div>
        </Show>
      </div>

      {/* Top-ups (who paid) */}
      <Topups accounts={accounts} payers={payers} />

      {/* 4. Funds register */}
      <Register accounts={accounts} cms={cms} />

      {/* Modals + drawer */}
      <Show when={modal()?.kind === "claim" && modal()}>
        {(m) => <ClaimModal row={m().row} payers={payers} onClose={() => setModal(null)} onDone={afterWrite} reload={loadQueue} />}
      </Show>
      <Show when={modal()?.kind === "pay" && modal()}>
        {(m) => <MarkPaidModal row={m().row} payers={payers} onClose={() => setModal(null)} onDone={afterWrite} reload={loadQueue} />}
      </Show>
      <Show when={modal()?.kind === "edit" && modal()}>
        {(m) => <EditModal row={m().row} onClose={() => setModal(null)} onDone={afterWrite} reload={loadQueue} />}
      </Show>
      <Show when={modal()?.kind === "cancel" && modal()}>
        {(m) => <CancelModal row={m().row} onClose={() => setModal(null)} onDone={afterWrite} reload={loadQueue} />}
      </Show>
      <Show when={modal()?.kind === "raise"}>
        <RaiseModal
          accounts={accounts}
          accountsLoading={accountsLoading}
          onClose={() => setModal(null)}
          onDone={afterWrite}
          reload={loadQueue}
        />
      </Show>
      <Show when={drawerRow()}>
        {(r) => <Drawer id={r().id} row={r()} onClose={() => setDrawerRow(null)} />}
      </Show>
    </div>
  );
}
