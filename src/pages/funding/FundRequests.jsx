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
} from "../../services/fundRequests";
import { scopeKey } from "../../stores/cmScope";
import { refreshFundRequestsBadge } from "../../stores/fundRequestsBadge";
import { showNotice } from "../../components/common/NoticeToast";
import { errorMessage, loadErrorMessage } from "../../utils/apiErrors";

// ─────────────────────────────────────────────────────────────────────────────
// Fund Requests — one page for the top-up queue that used to live in WhatsApp.
//
//   1. Summary strip   (meta of the queue call)
//   2. Queue           (data.open — the BACKEND's pay-first order, never
//                       re-sorted here) + "Closed today"
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
  const [busy, setBusy] = createSignal(false);
  const valid = () => isNum(amount()) && Number(amount()) > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid() || busy()) return;
    setBusy(true);
    try {
      await markFundRequestPaid(props.row.id, {
        amount: Number(amount()),
        reference: reference().trim(),
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

// Register row keys aren't pinned in the ticket beyond column names, so each
// cell reads the obvious spellings.
const pick = (o, ...keys) => {
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k];
  return null;
};
const regAccount = (r) => {
  const a = r.ad_account;
  if (a && typeof a === "object") return a;
  return { name: pick(r, "ad_account_name", "account_name", "name"), id: pick(r, "ad_account_id", "ad_account", "account_id") };
};

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
    // Newest date first.
    return [...list].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  };
  const totals = () => res()?.data?.totals || null;

  const TH = "px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 bg-[#F6F9FC] dark:bg-gray-800";
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
        <select
          class={`${INPUT} !w-auto max-w-[260px]`}
          value={adAccount()}
          onChange={(e) => setAdAccount(e.currentTarget.value)}
        >
          <option value="">All ad accounts</option>
          <For each={props.accounts() || []}>
            {(a) => <option value={a.id}>{`${a.name || a.id} · ${a.id}`}</option>}
          </For>
        </select>
        <Show when={props.cms().length}>
          <select class={`${INPUT} !w-auto`} value={cmId()} onChange={(e) => setCmId(e.currentTarget.value)}>
            <option value="">All campaign managers</option>
            <For each={props.cms()}>{(m) => <option value={m.id}>{m.label}</option>}</For>
          </select>
        </Show>
      </div>

      <Show when={rangeError()}>
        <p class="text-sm text-[#AC2334] mb-2">{rangeError()}</p>
      </Show>
      <Show when={error()}>
        <div class="rounded-xl bg-[#FBEEF0] border border-[#AC2334]/25 p-3 mb-3 text-sm text-[#AC2334]">{error()}</div>
      </Show>

      <div class={`overflow-x-auto rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 transition-opacity ${loading() ? "opacity-60" : ""}`}>
        <table class="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th class={`${TH} text-left`}>Date</th>
              <th class={`${TH} text-left`}>Ad account</th>
              <th class={`${TH} text-left`}>Clients</th>
              <th class={`${TH} text-left`}>CMs</th>
              <th class={`${TH} text-right`}>Daily budget</th>
              <th class={`${TH} text-right`}>Top-ups</th>
              <th class={`${TH} text-right`}>Funds added</th>
              <th class={`${TH} text-right`}>Spend</th>
              <th class={`${TH} text-right`}>Spend incl GST</th>
              <th class={`${TH} text-right`}>Wallet at day end</th>
              <th class={`${TH} text-right`}>Requests</th>
            </tr>
          </thead>
          <tbody>
            <Show
              when={rows().length}
              fallback={
                <tr>
                  <td colspan="11" class="px-4 py-8 text-center text-sm text-gray-400">
                    {loading() && !res() ? "Loading…" : "Nothing in this range."}
                  </td>
                </tr>
              }
            >
              <For each={rows()}>
                {(r) => (
                  <tr class="hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40">
                    <td class={`${TD} whitespace-nowrap`}>{prettyYMD(r.date)}</td>
                    <td class={TD}><AccountCell account={regAccount(r)} /></td>
                    <td class={`${TD} text-xs text-gray-600 dark:text-gray-300 max-w-[220px]`}>{clientNames(r.clients) || "—"}</td>
                    <td class={`${TD} text-xs text-gray-600 dark:text-gray-300`}>{joinList(r.campaign_managers ?? r.cms) || "—"}</td>
                    <td class={TDN}>{money(r.daily_budget)}</td>
                    <td class={TDN}>{num(pick(r, "topups", "top_ups", "topup_count", "top_up_count", "topups_count"))}</td>
                    <td class={`${TDN} font-semibold text-[#15966A] dark:text-green-400`}>{money(pick(r, "funds_added", "added"))}</td>
                    <td class={TDN}>{money(r.spend)}</td>
                    <td class={TDN}>{money(pick(r, "spend_inc_gst", "spend_incl_gst"))}</td>
                    <td class={TDN}>{money(pick(r, "wallet_end", "wallet_at_day_end", "wallet_day_end", "wallet"))}</td>
                    <td class={TDN}>{num(pick(r, "requests", "request_count", "requests_count"))}</td>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
          <Show when={totals() && rows().length}>
            <tfoot>
              <tr class="bg-[#F6F9FC] dark:bg-gray-800 font-bold">
                <td class={`${TD} text-[11px] uppercase tracking-wider text-[#8593A8]`} colspan="4">Total</td>
                <td class={TDN}>{money(totals().daily_budget)}</td>
                <td class={TDN}>{num(pick(totals(), "topups", "top_ups", "topup_count", "top_up_count", "topups_count"))}</td>
                <td class={`${TDN} text-[#15966A] dark:text-green-400`}>{money(pick(totals(), "funds_added", "added"))}</td>
                <td class={TDN}>{money(totals().spend)}</td>
                <td class={TDN}>{money(pick(totals(), "spend_inc_gst", "spend_incl_gst"))}</td>
                <td class={TDN}>{money(pick(totals(), "wallet_end", "wallet_at_day_end", "wallet_day_end", "wallet"))}</td>
                <td class={TDN}>{num(pick(totals(), "requests", "request_count", "requests_count"))}</td>
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

// ── page ─────────────────────────────────────────────────────────────────────

export default function FundRequests() {
  const [queue, setQueue] = createSignal(null); // full response
  const [loadError, setLoadError] = createSignal(null);
  const [cmId, setCmId] = createSignal("");
  const [cms, setCms] = createSignal([]);
  const [showClosed, setShowClosed] = createSignal(false);

  const [accounts, setAccounts] = createSignal([]);
  const [accountsLoading, setAccountsLoading] = createSignal(false);

  // { kind: "pay"|"edit"|"cancel"|"raise", row? }
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
      // meta.cms feeds the CM dropdown when the backend sends it.
      const list = res?.meta?.cms;
      if (Array.isArray(list) && list.length) {
        setCms(
          list
            .map((m) => ({ id: m.id ?? m.user_id, label: m.name || m.email || `#${m.id ?? m.user_id}` }))
            .filter((m) => m.id != null),
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
  const open = () => (Array.isArray(queue()?.data?.open) ? queue().data.open : []);
  const closedToday = () => (Array.isArray(queue()?.data?.closed_today) ? queue().data.closed_today : []);

  const openRaise = () => {
    setModal({ kind: "raise" });
    if (!accounts().length) loadAccounts();
  };

  const TH = "px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 bg-[#F6F9FC] dark:bg-gray-800 text-left";
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
            <select
              class={`${INPUT} !w-auto`}
              value={cmId()}
              onChange={(e) => setCmId(e.currentTarget.value)}
            >
              <option value="">All campaign managers</option>
              <For each={cms()}>{(m) => <option value={m.id}>{m.label}</option>}</For>
            </select>
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
      <div class="overflow-x-auto rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-[0_1px_2px_rgba(16,29,49,.05)]">
        <table class="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th class={TH}>Priority</th>
              <th class={TH}>Ad account</th>
              <th class={TH}>Clients</th>
              <th class={TH}>CMs</th>
              <th class={`${TH} !text-right`}>Wallet</th>
              <th class={`${TH} !text-right`}>Daily budget</th>
              <th class={`${TH} !text-right`}>Spent today</th>
              <th class={`${TH} !text-right`}>Hours left</th>
              <th class={`${TH} !text-right`}>Ask</th>
              <th class={TH}>Raised</th>
              <th class={TH}>Note</th>
              <th class={`${TH} sticky right-0 z-[1] shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]`}>Actions</th>
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
                        <AccountCell account={r.ad_account} />
                      </td>
                      <td class={`${TD} text-xs text-gray-700 dark:text-gray-300 max-w-[220px]`}>
                        <span class="inline-flex items-start gap-1">
                          <span>{clientNames(r.clients) || "—"}</span>
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
                      <td class={`${TD} text-xs text-gray-700 dark:text-gray-300`}>
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
                          <Show when={r.can_pay && r.ad_account?.pay_url}>
                            <a
                              href={r.ad_account.pay_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              class={`${BTN_ROW} bg-[#14233A] text-white border-[#14233A] hover:bg-[#1F3352]`}
                            >
                              Pay in Ads Manager ↗
                            </a>
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
          <div class="mt-2 overflow-x-auto rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900">
            <table class="min-w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th class={TH}>Ad account</th>
                  <th class={`${TH} !text-right`}>Ask</th>
                  <th class={TH}>Status</th>
                  <th class={`${TH} !text-right`}>Paid</th>
                  <th class={TH}>Paid via</th>
                  <th class={`${TH} !text-right`}>Time to pay</th>
                  <th class={TH}>Reason</th>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={closedToday().length}
                  fallback={
                    <tr>
                      <td colspan="7" class="px-4 py-6 text-center text-sm text-gray-400">Nothing closed yet today.</td>
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
                              ? `Marked by ${r.paid_by || "—"}`
                              : "—"}
                        </td>
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

      {/* 4. Funds register */}
      <Register accounts={accounts} cms={cms} />

      {/* Modals + drawer */}
      <Show when={modal()?.kind === "pay" && modal()}>
        {(m) => <MarkPaidModal row={m().row} onClose={() => setModal(null)} onDone={afterWrite} reload={loadQueue} />}
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
