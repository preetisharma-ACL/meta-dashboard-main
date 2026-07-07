import {
  createSignal,
  createMemo,
  createResource,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import Swal from "sweetalert2";
import {
  Pause,
  Play,
  Loader2,
  Check,
  X,
  RotateCcw,
  AlertTriangle,
  Search,
  Clock,
  ArrowRight,
} from "lucide-solid";
import {
  previewBulk,
  executeBulk,
  fetchBulkStatus,
  revertBulk,
  fetchBulkHistory,
  fetchBulkDetail,
  BUDGET_MIN,
  BUDGET_MAX,
} from "../../../services/bulkCampaignOps";
import { fetchAllAdminCampaigns } from "../services/campaigns";
import { canWriteCampaigns } from "../../../stores/currentUser";
import Avatar from "../../../components/common/Avatar";

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN · Bulk Campaign Operations  (route: /bulk-campaign-operations)
// Select N campaigns → bulk pause / resume / set-budget. Because these are REAL
// Meta writes, the UI makes every safety step explicit and in order:
//   select + action → preview (read-only) → confirm-by-typed-count → execute
//   → poll progress → summary; then optionally revert from history (drift-checked).
// Gated to writers (admin + Tier-1 CM) via canWriteCampaigns(); the backend is
// the real authority and re-checks scope on every call.
// ─────────────────────────────────────────────────────────────────────────────

const NAVY = "#14233A";

// ── Formatters ───────────────────────────────────────────────────────────────
const money2 = (v) => {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};
const signedMoney = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
const relTime = (iso) => {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const ACTIONS = [
  { key: "pause", label: "Pause", icon: Pause },
  { key: "resume", label: "Resume", icon: Play },
  { key: "budget", label: "Set budget", icon: null },
];

const STATUS_TONE = {
  active: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
  paused: "bg-[#FBF3E2] text-[#B07A14] dark:bg-amber-900/30 dark:text-amber-300",
};
const statusTone = (s) =>
  STATUS_TONE[String(s).toLowerCase()] ??
  "bg-[#F1F4F9] text-[#8593A8] dark:bg-gray-800 dark:text-gray-400";

const OP_STATUS_TONE = {
  completed: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
  running: "bg-[#EEF2FB] text-[#3E6B8A] dark:bg-blue-900/30 dark:text-blue-300",
  pending: "bg-[#EEF2FB] text-[#3E6B8A] dark:bg-blue-900/30 dark:text-blue-300",
  reverted: "bg-[#F1F0FB] text-[#6C5AB0] dark:bg-indigo-900/30 dark:text-indigo-300",
  failed: "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300",
};
const opStatusTone = (s) =>
  OP_STATUS_TONE[String(s).toLowerCase()] ??
  "bg-[#F1F4F9] text-[#8593A8] dark:bg-gray-800 dark:text-gray-400";

const toast = (icon, title, text) =>
  Swal.fire({
    icon,
    title,
    text,
    toast: true,
    position: "top-end",
    timer: icon === "error" ? 6000 : 3500,
    timerProgressBar: true,
    showConfirmButton: false,
  });

// ─────────────────────────────────────────────────────────────────────────────

export default function BulkCampaignOperations() {
  return (
    <div class="min-h-screen bg-[#F6F7FA] dark:bg-gray-900">
      <div class="max-w-[1480px] mx-auto px-4 md:px-9 pt-6">
        <Masthead />
      </div>
      <div class="max-w-[1480px] mx-auto px-4 md:px-9 pt-6 pb-16">
        <Show
          when={canWriteCampaigns()}
          fallback={
            <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center">
              <div class="w-12 h-12 rounded-full grid place-items-center bg-[#FBEEF0] dark:bg-red-900/20 text-[#AC2334] mx-auto mb-3">
                <AlertTriangle class="w-6 h-6" />
              </div>
              <div class="font-sans font-bold text-lg text-gray-700 dark:text-white">
                Not available for your role
              </div>
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-[440px] mx-auto">
                Bulk campaign operations are limited to admins and Tier-1 campaign
                managers. These actions make real changes on Meta.
              </p>
            </div>
          }
        >
          <Workspace />
        </Show>
      </div>
    </div>
  );
}

// ── Masthead ─────────────────────────────────────────────────────────────────
function Masthead() {
  return (
    <header class="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden px-6 md:px-8 py-6">
      <span class="absolute inset-x-0 top-0 h-1 bg-[#AC2334]" />
      <nav
        class="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase text-gray-400 mb-3"
        aria-label="Breadcrumb"
      >
        <span>Admin</span>
        <span class="text-gray-300 dark:text-gray-600">/</span>
        <span>Campaigns</span>
        <span class="text-gray-300 dark:text-gray-600">/</span>
        <span class="text-[#AC2334]">Bulk Operations</span>
      </nav>
      <div>
        <h1 class="font-sans font-bold text-xl text-gray-700 dark:text-white">
          Bulk Campaign Operations
        </h1>
        <p class="mt-2 text-[13.5px] text-gray-500 dark:text-gray-400 max-w-[620px]">
          Pause, resume or set the daily budget across many campaigns at once.
          Every action is previewed and requires a typed confirmation before it
          writes to Meta — and can be reverted afterwards.
        </p>
      </div>
    </header>
  );
}

// ── Workspace (tabs) ─────────────────────────────────────────────────────────
function Workspace() {
  const [tab, setTab] = createSignal("new"); // "new" | "history"
  // Bumped after a successful execute/revert so the History tab refetches.
  // Starts at 1 (not 0): createResource skips its fetcher on a falsy source, so
  // a 0 nonce would leave History empty on first open.
  const [historyNonce, setHistoryNonce] = createSignal(1);

  return (
    <div>
      <div class="inline-flex bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] p-[3px] gap-0.5 mb-5">
        <TabButton active={tab() === "new"} onClick={() => setTab("new")}>
          New operation
        </TabButton>
        <TabButton active={tab() === "history"} onClick={() => setTab("history")}>
          History
        </TabButton>
      </div>

      <Show when={tab() === "new"}>
        <NewOperation
          onExecuted={() => setHistoryNonce((n) => n + 1)}
        />
      </Show>
      <Show when={tab() === "history"}>
        <HistoryPanel
          nonce={historyNonce()}
          onReverted={() => setHistoryNonce((n) => n + 1)}
        />
      </Show>
    </div>
  );
}

function TabButton(props) {
  return (
    <button
      onClick={props.onClick}
      aria-pressed={props.active}
      class={`px-4 py-1.5 rounded-[7px] text-[13px] font-semibold transition-colors ${
        props.active
          ? "bg-[#14233A] text-white"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
      }`}
    >
      {props.children}
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// NEW OPERATION
// ═════════════════════════════════════════════════════════════════════════════
function NewOperation(props) {
  // ── Campaign source (cached admin sweep; backend scopes for CMs) ──
  const [campaigns] = createResource(async () => {
    try {
      const rows = await fetchAllAdminCampaigns();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  });

  // ── Selection + picker filters ──
  const [selected, setSelected] = createSignal(new Set());
  const [query, setQuery] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all"); // all | active | paused

  // ── Action console state ──
  const [action, setAction] = createSignal("pause");
  const [budget, setBudget] = createSignal("");

  // ── Flow state ──
  const [preview, setPreview] = createSignal(null);
  const [previewing, setPreviewing] = createSignal(false);
  const [confirmText, setConfirmText] = createSignal("");
  const [executing, setExecuting] = createSignal(false);
  const [execStatus, setExecStatus] = createSignal(null); // status-poll payload
  const [execDone, setExecDone] = createSignal(false);

  // A confirmed preview is only valid for the exact inputs it was built from.
  // Any change to the selection / action / budget invalidates it so the user
  // must re-preview (mirrors the backend's count_mismatch guard on the client).
  const resetFlow = () => {
    setPreview(null);
    setConfirmText("");
    setExecStatus(null);
    setExecDone(false);
  };

  // ── Derived picker data ──
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const sf = statusFilter();
    return (campaigns() ?? []).filter((c) => {
      if (sf !== "all" && String(c.status).toLowerCase() !== sf) return false;
      if (!q) return true;
      const hay = `${c.name ?? ""} ${c.client_nomen_name ?? ""} ${
        c.project_name ?? ""
      }`.toLowerCase();
      return hay.includes(q);
    });
  });

  // Render is capped (the admin campaign set can run into the thousands); the
  // list scrolls the first N and the user narrows with search. "Select all"
  // still operates on the FULL filtered set, not just the rendered slice.
  const VISIBLE_CAP = 250;
  const visible = createMemo(() => filtered().slice(0, VISIBLE_CAP));
  const overflow = createMemo(() =>
    Math.max(0, filtered().length - VISIBLE_CAP),
  );

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    resetFlow();
  };

  const allFilteredSelected = createMemo(() => {
    const f = filtered();
    if (f.length === 0) return false;
    const set = selected();
    return f.every((c) => set.has(c.id));
  });

  const toggleAllFiltered = () => {
    const f = filtered();
    setSelected((prev) => {
      const next = new Set(prev);
      const all = f.every((c) => next.has(c.id));
      f.forEach((c) => (all ? next.delete(c.id) : next.add(c.id)));
      return next;
    });
    resetFlow();
  };

  const clearSelection = () => {
    setSelected(new Set());
    resetFlow();
  };

  const chooseAction = (a) => {
    setAction(a);
    resetFlow();
  };

  const onBudgetInput = (v) => {
    setBudget(v);
    resetFlow();
  };

  // ── Validation ──
  const budgetNum = () => parseFloat(budget());
  const budgetValid = () =>
    isFinite(budgetNum()) &&
    budgetNum() >= BUDGET_MIN &&
    budgetNum() <= BUDGET_MAX;
  const canPreview = () =>
    selected().size > 0 &&
    (action() !== "budget" || budgetValid()) &&
    !previewing();

  const willChangeCount = () => preview()?.counts?.will_change ?? 0;
  const confirmMatches = () =>
    willChangeCount() > 0 &&
    confirmText().trim() !== "" &&
    Number(confirmText().trim()) === willChangeCount();

  // Map a failed preview/execute to an honest toast. The 409 count_mismatch on
  // execute is handled at its call site; everything else lands here.
  const handleWriteError = (err, phase) => {
    if (err?.status === 403) {
      toast(
        "error",
        "Not allowed",
        "You don't have permission to run bulk campaign operations.",
      );
      return;
    }
    if (err?.message === "Failed to fetch") {
      toast(
        "error",
        "Couldn't reach the server",
        phase === "execute" ? "No campaigns were changed." : "Please try again.",
      );
      return;
    }
    const detail = err?.data?.detail;
    const metaMsg =
      (detail && typeof detail === "object" ? detail.error : detail) ||
      err?.message;
    toast(
      "error",
      phase === "preview" ? "Couldn't build the preview" : "Bulk operation failed",
      typeof metaMsg === "string" && metaMsg ? metaMsg : "Please try again.",
    );
  };

  // ── Preview ──
  const runPreview = async () => {
    if (!canPreview()) return;
    setPreviewing(true);
    resetFlow();
    try {
      const data = await previewBulk({
        campaignIds: [...selected()],
        action: action(),
        budgetValue: action() === "budget" ? budgetNum() : undefined,
      });
      setPreview(data);
    } catch (err) {
      handleWriteError(err, "preview");
    } finally {
      setPreviewing(false);
    }
  };

  // ── Poll status until terminal ──
  // A resume op can legitimately run for MINUTES (Meta reviews each campaign on
  // reactivation — 7-9 min each on prod). So we poll indefinitely until the
  // status is terminal (never time out), and a transient status-fetch hiccup
  // must NOT look like a failed operation — we tolerate a run of consecutive
  // failures before giving up.
  let pollTimer;
  let pollFails = 0;
  const MAX_POLL_FAILS = 8;
  onCleanup(() => clearTimeout(pollTimer));
  const poll = async (opId) => {
    try {
      const s = await fetchBulkStatus(opId);
      pollFails = 0;
      setExecStatus(s);
      const st = String(s?.status ?? "").toLowerCase();
      if (st === "running" || st === "pending") {
        pollTimer = setTimeout(() => poll(opId), 2500);
      } else {
        setExecDone(true);
        props.onExecuted?.();
      }
    } catch (err) {
      // Transient failure — keep the last known progress on screen and retry.
      // Only surface an error after several consecutive misses so a long resume
      // (or a brief network blip) doesn't read as a false failure.
      pollFails += 1;
      if (pollFails <= MAX_POLL_FAILS) {
        pollTimer = setTimeout(() => poll(opId), 3000);
      } else {
        setExecDone(true);
        toast(
          "error",
          "Lost track of the operation",
          "Couldn't reach the status endpoint — check the History tab for the result.",
        );
      }
    }
  };

  // ── Execute (confirm-count guarded) ──
  const runExecute = async () => {
    if (!confirmMatches() || executing()) return;
    setExecuting(true);
    try {
      const res = await executeBulk({
        campaignIds: [...selected()],
        action: action(),
        budgetValue: action() === "budget" ? budgetNum() : undefined,
        expectedCount: willChangeCount(),
      });
      // Kick off polling. Show an immediate optimistic "running" frame.
      pollFails = 0;
      setExecStatus({
        operation_id: res.operation_id,
        status: res.status || "running",
        progress: { done: 0, total: willChangeCount() },
        summary: null,
      });
      poll(res.operation_id);
    } catch (err) {
      if (err?.status === 409 || err?.code === "count_mismatch") {
        const live = err?.data?.detail?.live_count;
        setPreview(null);
        setConfirmText("");
        toast(
          "warning",
          "The set changed",
          live != null
            ? `${live} campaign(s) would change now — please preview again.`
            : "Please preview again before executing.",
        );
      } else {
        handleWriteError(err, "execute");
      }
    } finally {
      setExecuting(false);
    }
  };

  const startOver = () => {
    clearSelection();
    setBudget("");
    setAction("pause");
    resetFlow();
  };

  const actionVerb = () =>
    action() === "pause"
      ? "Pause"
      : action() === "resume"
        ? "Resume"
        : "Set budget";

  return (
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
      {/* ── Campaign picker ── */}
      <section class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div class="p-4 border-b border-gray-100 dark:border-gray-800">
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="text-[13px] font-semibold text-gray-600 dark:text-gray-200">
              Campaigns
            </div>
            <div class="text-[12px] text-gray-400">
              <b class="text-[#14233A] dark:text-white tabular-nums">
                {selected().size}
              </b>{" "}
              selected
              <Show when={selected().size > 0}>
                {" · "}
                <button
                  class="text-[#AC2334] hover:underline font-medium"
                  onClick={clearSelection}
                >
                  clear
                </button>
              </Show>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <div class="relative flex-1 min-w-[180px]">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="search"
                value={query()}
                onInput={(e) => setQuery(e.target.value)}
                placeholder="Search campaign, client or project…"
                class="w-full h-[35px] rounded-[9px] border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-[33px] pr-3 text-[13px] text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-[#14233A] focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-[#14233A]/10 transition-colors"
              />
            </div>
            <div class="inline-flex bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[9px] p-[3px] gap-0.5">
              <For each={[["all", "All"], ["active", "Active"], ["paused", "Paused"]]}>
                {([key, label]) => (
                  <button
                    onClick={() => setStatusFilter(key)}
                    class={`px-2.5 py-1 rounded-[6px] text-[12px] font-semibold transition-colors ${
                      statusFilter() === key
                        ? "bg-[#14233A] text-white"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>

        {/* Select-all header */}
        <div class="flex items-center gap-3 px-4 py-2 bg-[#14233A]/[0.03] dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <label class="inline-flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allFilteredSelected()}
              onChange={toggleAllFiltered}
              class="w-4 h-4 rounded border-gray-300 text-[#14233A] focus:ring-[#14233A]/30 accent-[#14233A]"
            />
            <span class="text-[11.5px] font-bold tracking-[0.08em] uppercase text-gray-400">
              Select all
            </span>
          </label>
          <span class="ml-auto text-[12px] text-gray-400 tabular-nums">
            {filtered().length} shown
          </span>
        </div>

        {/* List */}
        <div class="max-h-[560px] overflow-y-auto">
          <Show
            when={!campaigns.loading}
            fallback={
              <div class="p-4 space-y-2">
                <For each={Array(8).fill(0)}>
                  {() => (
                    <div class="h-11 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
                  )}
                </For>
              </div>
            }
          >
            <Show
              when={filtered().length > 0}
              fallback={
                <div class="py-16 text-center text-sm text-gray-400">
                  No campaigns match your filters.
                </div>
              }
            >
              <For each={visible()}>
                {(c) => (
                  <PickerRow
                    campaign={c}
                    checked={selected().has(c.id)}
                    onToggle={() => toggle(c.id)}
                  />
                )}
              </For>
              <Show when={overflow() > 0}>
                <div class="px-4 py-3 text-center text-[11.5px] text-gray-400 bg-gray-50/60 dark:bg-gray-800/30">
                  + {overflow()} more — refine your search to narrow. “Select all”
                  still applies to all {filtered().length}.
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </section>

      {/* ── Action console ── */}
      <aside class="lg:sticky lg:top-5 space-y-4">
        <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm p-5">
          <div class="text-[13px] font-semibold text-gray-600 dark:text-gray-200 mb-3">
            Action
          </div>
          {/* Action selector */}
          <div class="grid grid-cols-3 gap-2 mb-4">
            <For each={ACTIONS}>
              {(a) => (
                <button
                  onClick={() => chooseAction(a.key)}
                  aria-pressed={action() === a.key}
                  class={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border text-[12.5px] font-semibold transition-colors ${
                    action() === a.key
                      ? "border-[#14233A] bg-[#14233A] text-white"
                      : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <Show
                    when={a.icon}
                    fallback={<span class="text-[15px] leading-none">₹</span>}
                  >
                    <Dynamic component={a.icon} class="w-4 h-4" />
                  </Show>
                  {a.label}
                </button>
              )}
            </For>
          </div>

          {/* Resume is slow: Meta reviews each campaign on reactivation (minutes
              each). Set expectations up front so a long 0/N progress period
              doesn't read as frozen. Pause/budget are fast — resume only. */}
          <Show when={action() === "resume"}>
            <div class="mb-4 flex gap-2.5 rounded-xl bg-[#FBF3E2] dark:bg-amber-900/20 border border-amber-200/70 dark:border-amber-800/50 px-3.5 py-2.5">
              <Clock class="w-4 h-4 text-[#B07A14] dark:text-amber-300 flex-shrink-0 mt-0.5" />
              <p class="text-[11.5px] leading-relaxed text-[#8a6410] dark:text-amber-200">
                Resuming can take <b>several minutes per campaign</b> — Meta
                reviews each one when it's reactivated. Keep this tab open;
                progress updates as each campaign completes.
              </p>
            </div>
          </Show>

          {/* Budget input */}
          <Show when={action() === "budget"}>
            <div class="mb-4">
              <label class="block text-[12px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                Daily budget for every selected campaign
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[14px]">
                  ₹
                </span>
                <input
                  type="number"
                  min={BUDGET_MIN}
                  max={BUDGET_MAX}
                  value={budget()}
                  onInput={(e) => onBudgetInput(e.target.value)}
                  placeholder="e.g. 500"
                  class={`w-full h-10 rounded-[10px] border bg-white dark:bg-gray-900 pl-7 pr-3 text-[14px] font-semibold text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 transition-colors ${
                    budget() && !budgetValid()
                      ? "border-red-300 focus:border-red-400 focus:ring-red-400/10"
                      : "border-gray-200 dark:border-gray-700 focus:border-[#14233A] focus:ring-[#14233A]/10"
                  }`}
                />
              </div>
              <div
                class={`mt-1 text-[11.5px] ${
                  budget() && !budgetValid()
                    ? "text-[#AC2334]"
                    : "text-gray-400"
                }`}
              >
                Between ₹{BUDGET_MIN} and ₹
                {BUDGET_MAX.toLocaleString("en-IN")} / day. Applies to every
                selected campaign. CBO-off campaigns are skipped (budget lives on
                ad sets).
              </div>
            </div>
          </Show>

          {/* Preview button */}
          <button
            onClick={runPreview}
            disabled={!canPreview()}
            class="w-full h-10 rounded-[10px] font-semibold text-[13.5px] text-white bg-[#14233A] hover:bg-[#1c2f4d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
          >
            <Show when={previewing()} fallback={<>Preview changes</>}>
              <Loader2 class="w-4 h-4 animate-spin" /> Previewing…
            </Show>
          </button>
          <Show when={selected().size === 0}>
            <p class="mt-2 text-[11.5px] text-gray-400 text-center">
              Select at least one campaign to continue.
            </p>
          </Show>
        </div>

        {/* Preview result + confirm + execute */}
        <Show when={preview()}>
          {(pv) => (
            <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
              <div class="px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
                <div class="flex items-center gap-2 text-[13px] font-semibold text-gray-600 dark:text-gray-200 mb-3">
                  Preview
                </div>
                <div class="grid grid-cols-3 gap-2 text-center">
                  <CountTile
                    n={pv().counts?.will_change ?? 0}
                    label="Will change"
                    tone="navy"
                  />
                  <CountTile
                    n={pv().counts?.skipped ?? 0}
                    label="Skipped"
                    tone="muted"
                  />
                  <CountTile
                    n={pv().counts?.total_requested ?? 0}
                    label="Selected"
                    tone="muted"
                  />
                </div>

                {/* Heads-up: a large resume batch will run for a while. */}
                <Show
                  when={
                    action() === "resume" &&
                    (pv().counts?.will_change ?? 0) > 10
                  }
                >
                  <div class="mt-3 flex gap-2 rounded-xl bg-[#FBF3E2] dark:bg-amber-900/20 px-3.5 py-2 text-[11.5px] text-[#8a6410] dark:text-amber-200">
                    <Clock class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>
                      Resuming {pv().counts.will_change} campaigns may take a
                      while — Meta reviews each on activation.
                    </span>
                  </div>
                </Show>

                {/* Budget totals / delta */}
                <Show when={action() === "budget" && pv().totals}>
                  <div class="mt-3 rounded-xl bg-[#14233A]/[0.04] dark:bg-gray-800 px-3.5 py-2.5 flex items-center justify-between">
                    <div class="text-[12px] text-gray-500 dark:text-gray-400">
                      Daily spend
                      <div class="text-[13px] font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
                        {money2(pv().totals.current_daily_total)}{" "}
                        <ArrowRight class="inline w-3 h-3 mx-0.5 -mt-0.5" />{" "}
                        {money2(pv().totals.new_daily_total)}
                      </div>
                    </div>
                    <div
                      class={`text-[15px] font-bold tabular-nums ${
                        parseFloat(pv().totals.delta) > 0
                          ? "text-[#AC2334]"
                          : parseFloat(pv().totals.delta) < 0
                            ? "text-[#15966A]"
                            : "text-gray-400"
                      }`}
                    >
                      {signedMoney(pv().totals.delta)}
                      <span class="text-[10px] font-medium text-gray-400 ml-0.5">
                        /day
                      </span>
                    </div>
                  </div>
                </Show>
              </div>

              {/* Will-change list */}
              <Show when={(pv().will_change ?? []).length > 0}>
                <div class="max-h-[220px] overflow-y-auto px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                  <For each={pv().will_change}>
                    {(w) => (
                      <div class="flex items-center gap-2 px-2 py-1.5 rounded-lg">
                        <Check class="w-3.5 h-3.5 text-[#15966A] flex-shrink-0" />
                        <div class="min-w-0 flex-1">
                          <div class="text-[12.5px] font-medium text-gray-700 dark:text-gray-200 truncate">
                            {w.campaign_name}
                          </div>
                          <Show when={w.ad_account_name}>
                            <div
                              class="text-[10.5px] text-gray-400 truncate"
                              title={w.ad_account_id || ""}
                            >
                              {w.ad_account_name}
                            </div>
                          </Show>
                        </div>
                        <Show
                          when={action() === "budget"}
                          fallback={
                            <span class="text-[11px] text-gray-400 tabular-nums whitespace-nowrap">
                              {cap(w.current_status)} →{" "}
                              <b class="text-gray-600 dark:text-gray-300">
                                {cap(w.target_status)}
                              </b>
                            </span>
                          }
                        >
                          <span class="text-[11px] text-gray-400 tabular-nums whitespace-nowrap">
                            {money2(w.current_budget)} →{" "}
                            <b class="text-gray-600 dark:text-gray-300">
                              {money2(w.target_budget)}
                            </b>
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Skipped list */}
              <Show when={(pv().skipped ?? []).length > 0}>
                <div class="max-h-[160px] overflow-y-auto px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30">
                  <For each={pv().skipped}>
                    {(s) => (
                      <div class="flex items-center gap-2 px-2 py-1.5">
                        <X class="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                        <div class="min-w-0 flex-1">
                          <div class="text-[12px] text-gray-400 truncate">
                            {s.campaign_name}
                          </div>
                          <Show when={s.ad_account_name}>
                            <div
                              class="text-[10px] text-gray-400/80 truncate"
                              title={s.ad_account_id || ""}
                            >
                              {s.ad_account_name}
                            </div>
                          </Show>
                        </div>
                        <span class="text-[10.5px] text-gray-400 italic whitespace-nowrap">
                          {s.reason}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Confirm-count + execute, or progress, or summary */}
              <div class="p-5">
                <Show
                  when={!execStatus()}
                  fallback={
                    <ExecProgress
                      status={execStatus()}
                      done={execDone()}
                      action={action()}
                      onStartOver={startOver}
                    />
                  }
                >
                  <Show
                    when={willChangeCount() > 0}
                    fallback={
                      <div class="text-[12.5px] text-gray-500 dark:text-gray-400 text-center py-1">
                        Nothing to change — every selected campaign was skipped.
                        Adjust your selection and preview again.
                      </div>
                    }
                  >
                    <label class="block text-[12px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                      Type{" "}
                      <b class="text-[#14233A] dark:text-white tabular-nums">
                        {willChangeCount()}
                      </b>{" "}
                      to confirm {actionVerb().toLowerCase()} on Meta
                    </label>
                    <input
                      type="text"
                      inputmode="numeric"
                      value={confirmText()}
                      onInput={(e) => setConfirmText(e.target.value)}
                      placeholder={String(willChangeCount())}
                      class={`w-full h-10 rounded-[10px] border bg-white dark:bg-gray-900 px-3 text-[14px] font-semibold text-gray-800 dark:text-gray-100 tabular-nums focus:outline-none focus:ring-2 transition-colors mb-3 ${
                        confirmText() && !confirmMatches()
                          ? "border-red-300 focus:border-red-400 focus:ring-red-400/10"
                          : "border-gray-200 dark:border-gray-700 focus:border-[#14233A] focus:ring-[#14233A]/10"
                      }`}
                    />
                    <button
                      onClick={runExecute}
                      disabled={!confirmMatches() || executing()}
                      class="w-full h-10 rounded-[10px] font-semibold text-[13.5px] text-white bg-[#AC2334] hover:bg-[#8f1c2b] disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
                    >
                      <Show
                        when={executing()}
                        fallback={<>Execute {actionVerb().toLowerCase()}</>}
                      >
                        <Loader2 class="w-4 h-4 animate-spin" /> Executing…
                      </Show>
                    </button>
                    <p class="mt-2 text-[11px] text-gray-400 text-center">
                      This writes to Meta immediately. You can revert from History.
                    </p>
                  </Show>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </aside>
    </div>
  );
}

// ── Picker row ───────────────────────────────────────────────────────────────
function PickerRow(props) {
  const c = () => props.campaign;
  return (
    <label class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={props.onToggle}
        class="w-4 h-4 rounded border-gray-300 text-[#14233A] focus:ring-[#14233A]/30 accent-[#14233A] flex-shrink-0"
      />
      <div class="min-w-0 flex-1">
        <div class="text-[13.5px] font-semibold text-gray-900 dark:text-gray-100 truncate">
          {c().name}
        </div>
        <div
          class="text-[11.5px] text-gray-400 truncate"
          title={c().ad_account_id || ""}
        >
          {[c().client_nomen_name || c().project_name, c().ad_account_name]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
      </div>
      <span
        class={`inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.05em] px-2 py-[3px] rounded-full whitespace-nowrap ${statusTone(
          c().status,
        )}`}
      >
        {c().status_label ?? cap(c().status)}
      </span>
    </label>
  );
}

// ── Preview count tile ───────────────────────────────────────────────────────
function CountTile(props) {
  return (
    <div
      class={`rounded-xl py-2.5 ${
        props.tone === "navy"
          ? "bg-[#14233A] text-white"
          : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
      }`}
    >
      <div class="text-xl font-bold leading-none tabular-nums">{props.n}</div>
      <div
        class={`mt-1 text-[9.5px] font-semibold tracking-[0.08em] uppercase ${
          props.tone === "navy" ? "text-white/60" : "text-gray-400"
        }`}
      >
        {props.label}
      </div>
    </div>
  );
}

// ── Execution progress + summary ─────────────────────────────────────────────
function ExecProgress(props) {
  const s = () => props.status ?? {};
  const done = () => s().progress?.done ?? 0;
  const total = () => s().progress?.total ?? 0;
  const pct = () => (total() > 0 ? Math.round((done() / total()) * 100) : 0);
  const summary = () => s().summary;
  const isDone = () =>
    props.done && ["completed", "reverted", "failed"].includes(
      String(s().status).toLowerCase(),
    );
  // Resume blocks on Meta's per-campaign ad-review (minutes each), so `done` can
  // sit at 0 for a long time. Detect it to keep the wait reading as "working".
  const isResume = () =>
    props.action === "resume" ||
    String(s().operation_type ?? "").toLowerCase() === "resume";

  return (
    <div>
      <Show
        when={isDone()}
        fallback={
          <>
            <div class="flex items-center gap-2 text-[13px] font-semibold text-gray-700 dark:text-gray-200 mb-2">
              <Loader2 class="w-4 h-4 animate-spin text-[#14233A]" />
              Processing…{" "}
              <span class="font-normal text-gray-500 dark:text-gray-400 tabular-nums">
                {done()} of {total()} done
              </span>
            </div>
            <div class="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              {/* At 0% show a small pulsing sliver so a long wait never looks
                  frozen; once real progress lands, track it exactly. */}
              <div
                class={`h-full bg-[#14233A] transition-all duration-500 ${
                  done() === 0 ? "animate-pulse" : ""
                }`}
                style={{ width: `${done() === 0 ? 8 : pct()}%` }}
              />
            </div>
            <Show
              when={isResume()}
              fallback={
                <div class="mt-1.5 text-[11.5px] text-gray-400">
                  Writing to Meta — keep this tab open.
                </div>
              }
            >
              <div class="mt-2 flex gap-2 text-[11.5px] text-[#8a6410] dark:text-amber-300">
                <Clock class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Meta reviews each campaign on reactivation — several minutes
                  each
                  {done() === 0
                    ? "; the first result may take a few minutes to appear"
                    : ""}
                  . Keep this tab open.
                </span>
              </div>
            </Show>
          </>
        }
      >
        <div class="text-center">
          <div
            class={`w-11 h-11 rounded-full grid place-items-center mx-auto mb-2.5 ${
              String(s().status).toLowerCase() === "failed"
                ? "bg-[#FBEEF0] text-[#AC2334]"
                : "bg-[#E9F7F1] text-[#15966A]"
            }`}
          >
            <Show
              when={String(s().status).toLowerCase() === "failed"}
              fallback={<Check class="w-6 h-6" />}
            >
              <AlertTriangle class="w-6 h-6" />
            </Show>
          </div>
          <div class="font-sans font-bold text-[15px] text-gray-800 dark:text-white">
            {String(s().status).toLowerCase() === "failed"
              ? "Operation failed"
              : "Operation complete"}
          </div>
          <Show when={summary()}>
            <div class="mt-1 text-[12.5px] text-gray-500 dark:text-gray-400">
              <b class="text-[#15966A]">{summary().succeeded ?? 0}</b> succeeded
              <Show when={(summary().failed ?? 0) > 0}>
                {" · "}
                <b class="text-[#AC2334]">{summary().failed}</b> failed
              </Show>
              <Show when={(summary().skipped ?? 0) > 0}>
                {" · "}
                <b class="text-gray-500">{summary().skipped}</b> skipped
              </Show>
            </div>
          </Show>
          <button
            onClick={props.onStartOver}
            class="mt-4 w-full h-9 rounded-[10px] font-semibold text-[13px] text-[#14233A] dark:text-white border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Start a new operation
          </button>
          <p class="mt-2 text-[11px] text-gray-400">
            Revert this from the History tab.
          </p>
        </div>
      </Show>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// HISTORY
// ═════════════════════════════════════════════════════════════════════════════
function HistoryPanel(props) {
  const [ops] = createResource(
    () => props.nonce,
    async () => {
      try {
        const data = await fetchBulkHistory(50);
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
  );

  const [openOp, setOpenOp] = createSignal(null); // operation_id for detail modal

  return (
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse min-w-[720px]">
          <thead>
            <tr>
              <For
                each={[
                  "Operation",
                  "Status",
                  "Result",
                  "By",
                  "When",
                  "",
                ]}
              >
                {(h) => (
                  <th class="text-left text-[10.5px] font-bold tracking-[0.12em] uppercase text-gray-400 px-4 py-3 bg-[#14233A]/[0.03] dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    {h}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <Show
              when={!ops.loading}
              fallback={
                <For each={Array(6).fill(0)}>
                  {() => (
                    <tr>
                      <td colspan="6" class="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                        <div class="h-6 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                      </td>
                    </tr>
                  )}
                </For>
              }
            >
              <Show
                when={(ops() ?? []).length > 0}
                fallback={
                  <tr>
                    <td
                      colspan="6"
                      class="px-4 py-16 text-center text-sm text-gray-400"
                    >
                      No bulk operations yet.
                    </td>
                  </tr>
                }
              >
                <For each={ops()}>
                  {(op) => (
                    <HistoryRow op={op} onOpen={() => setOpenOp(op.operation_id)} />
                  )}
                </For>
              </Show>
            </Show>
          </tbody>
        </table>
      </div>

      <Show when={openOp()}>
        <DetailModal
          operationId={openOp()}
          onClose={() => setOpenOp(null)}
          onReverted={props.onReverted}
        />
      </Show>
    </div>
  );
}

const opTitle = (op) => {
  const t = op.operation_type;
  if (t === "budget")
    return `Set budget${op.budget_value != null ? ` → ${money2(op.budget_value)}` : ""}`;
  return cap(t);
};

function HistoryRow(props) {
  const op = () => props.op;
  const sum = () => op().summary ?? {};
  return (
    <tr
      class="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors cursor-pointer"
      onClick={props.onOpen}
    >
      <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div class="flex items-center gap-2">
          <Show when={op().is_revert}>
            <RotateCcw class="w-3.5 h-3.5 text-[#6C5AB0]" />
          </Show>
          <span class="text-[13px] font-semibold text-gray-800 dark:text-gray-100">
            {opTitle(op())}
          </span>
        </div>
        <Show when={op().is_revert && op().reverts_operation_id}>
          <div class="text-[11px] text-gray-400 mt-0.5">
            ↩ revert of #{op().reverts_operation_id}
          </div>
        </Show>
      </td>
      <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <span
          class={`inline-block text-[10.5px] font-bold uppercase tracking-[0.05em] px-2 py-[3px] rounded-full ${opStatusTone(
            op().status,
          )}`}
        >
          {op().status}
        </span>
      </td>
      <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 text-[12px] text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
        <b class="text-[#15966A]">{sum().succeeded ?? 0}</b> ok
        <Show when={(sum().failed ?? 0) > 0}>
          {" · "}
          <b class="text-[#AC2334]">{sum().failed}</b> fail
        </Show>
        <Show when={(sum().skipped ?? 0) > 0}>
          {" · "}
          {sum().skipped} skip
        </Show>
      </td>
      <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div class="flex items-center gap-2 min-w-0">
          <Avatar name={op().actor_email || "?"} size="w-6 h-6" textSize="text-[10px]" />
          <span class="text-[12px] text-gray-500 dark:text-gray-400 truncate max-w-[160px]">
            {op().actor_email || "—"}
          </span>
        </div>
      </td>
      <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 text-[12px] text-gray-400 whitespace-nowrap">
        <span class="inline-flex items-center gap-1">
          <Clock class="w-3 h-3" />
          {relTime(op().created_at)}
        </span>
      </td>
      <td class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 text-right">
        <ArrowRight class="w-4 h-4 text-gray-300 inline" />
      </td>
    </tr>
  );
}

// ── Detail modal (per-campaign before→after + revert) ────────────────────────
function DetailModal(props) {
  const [detail] = createResource(
    () => props.operationId,
    async (id) => {
      try {
        return await fetchBulkDetail(id);
      } catch (err) {
        return { _error: err?.message || "Failed to load detail" };
      }
    },
  );
  const [reverting, setReverting] = createSignal(false);

  const doRevert = async (force = false) => {
    setReverting(true);
    try {
      const res = await revertBulk(props.operationId, { force });
      const drifted = res?.skipped_drifted ?? 0;
      toast(
        "success",
        "Revert started",
        `Restoring ${res?.reverting ?? 0} campaign(s)${
          drifted ? `, ${drifted} skipped (changed since)` : ""
        }.`,
      );
      // Offer a forced follow-up for the drifted campaigns that were skipped.
      if (drifted > 0 && !force) {
        const { isConfirmed } = await Swal.fire({
          title: "Revert the changed ones too?",
          html: `<div style="text-align:left;font-size:13px;line-height:1.6">
            <b>${drifted}</b> campaign(s) changed since the operation and were
            skipped to avoid clobbering a deliberate later change. Force-revert
            them as well?</div>`,
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Force revert",
          cancelButtonText: "Leave them",
          confirmButtonColor: "#AC2334",
          reverseButtons: true,
          focusCancel: true,
        });
        if (isConfirmed) {
          await revertBulk(props.operationId, { force: true });
          toast("success", "Force revert started", "Restoring the changed ones.");
        }
      }
      props.onReverted?.();
      props.onClose();
    } catch (err) {
      if (err?.status === 409 && err?.code === "all_drifted") {
        const { isConfirmed } = await Swal.fire({
          title: "Everything changed since",
          html: `<div style="text-align:left;font-size:13px;line-height:1.6">
            Every campaign in this operation has changed since it ran, so there is
            nothing safe to revert. Force-revert anyway (restores the pre-op
            values, overwriting the later changes)?</div>`,
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Force revert",
          cancelButtonText: "Cancel",
          confirmButtonColor: "#AC2334",
          reverseButtons: true,
          focusCancel: true,
        });
        if (isConfirmed) {
          try {
            await revertBulk(props.operationId, { force: true });
            toast("success", "Force revert started", "Restoring pre-op values.");
            props.onReverted?.();
            props.onClose();
          } catch (e2) {
            toast("error", "Couldn't revert", e2?.message || "");
          }
        }
      } else if (err?.status === 403) {
        toast("error", "Not allowed", "You can't revert this operation.");
      } else {
        toast("error", "Couldn't revert", err?.message || "Please try again.");
      }
    } finally {
      setReverting(false);
    }
  };

  const askRevert = async () => {
    const d = detail() ?? {};
    const { isConfirmed } = await Swal.fire({
      title: "Revert this operation?",
      html: `<div style="text-align:left;font-size:13px;line-height:1.6">
        Each campaign is restored to its value <b>before</b> ${opTitle(d).toLowerCase()}.
        Campaigns changed since are skipped automatically.</div>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Revert",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#14233A",
      reverseButtons: true,
      focusCancel: true,
    });
    if (isConfirmed) doRevert(false);
  };

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
      onClick={props.onClose}
    >
      <div
        class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-[640px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <Show when={detail() && !detail()._error} fallback={<span class="font-bold text-gray-700 dark:text-white">Operation</span>}>
              <div class="font-sans font-bold text-[15px] text-gray-800 dark:text-white">
                {opTitle(detail())}
              </div>
              <div class="text-[11.5px] text-gray-400 mt-0.5">
                #{detail().operation_id} · {detail().actor_email} ·{" "}
                {relTime(detail().created_at)}
              </div>
            </Show>
          </div>
          <button
            onClick={props.onClose}
            class="w-8 h-8 rounded-lg grid place-items-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="overflow-y-auto flex-1">
          <Show
            when={!detail.loading}
            fallback={
              <div class="p-5 space-y-2">
                <For each={Array(6).fill(0)}>
                  {() => (
                    <div class="h-9 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                  )}
                </For>
              </div>
            }
          >
            <Show
              when={detail() && !detail()._error}
              fallback={
                <div class="p-8 text-center text-sm text-[#AC2334]">
                  {detail()?._error || "Couldn't load this operation."}
                </div>
              }
            >
              <table class="w-full border-collapse">
                <thead>
                  <tr>
                    <For each={["Campaign", "Before", "After", "Result"]}>
                      {(h) => (
                        <th class="text-left text-[10px] font-bold tracking-[0.1em] uppercase text-gray-400 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                          {h}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={detail().items ?? []}>
                    {(it) => <DetailRow item={it} type={detail().operation_type} />}
                  </For>
                </tbody>
              </table>
            </Show>
          </Show>
        </div>

        {/* Footer — revert */}
        <div class="px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
          <div class="text-[11.5px] text-gray-400">
            <Show
              when={detail()?.revertable}
              fallback="This operation can't be reverted."
            >
              Restores every campaign to its pre-operation value (drift-checked).
            </Show>
          </div>
          <Show when={detail()?.revertable}>
            <button
              onClick={askRevert}
              disabled={reverting()}
              class="h-9 px-4 rounded-[10px] font-semibold text-[13px] text-white bg-[#14233A] hover:bg-[#1c2f4d] disabled:opacity-50 transition-colors inline-flex items-center gap-2"
            >
              <Show when={reverting()} fallback={<RotateCcw class="w-4 h-4" />}>
                <Loader2 class="w-4 h-4 animate-spin" />
              </Show>
              Revert
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}

function DetailRow(props) {
  const it = () => props.item;
  const isBudget = () => props.type === "budget";
  const before = () => (isBudget() ? money2(it().before_budget) : cap(it().before_status));
  const after = () => (isBudget() ? money2(it().after_budget) : cap(it().after_status));
  const ok = () => String(it().result ?? "").toLowerCase() === "success";
  return (
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/40">
      <td class="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 max-w-[220px]">
        <div class="text-[12.5px] font-medium text-gray-800 dark:text-gray-100 truncate">
          {it().campaign_name}
        </div>
        <Show when={it().ad_account_name}>
          <div
            class="text-[10.5px] text-gray-400 truncate"
            title={it().ad_account_id || ""}
          >
            {it().ad_account_name}
          </div>
        </Show>
      </td>
      <td class="px-4 py-2.5 text-[12px] text-gray-400 tabular-nums border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">
        {before()}
      </td>
      <td class="px-4 py-2.5 text-[12px] font-semibold text-gray-700 dark:text-gray-200 tabular-nums border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">
        {after()}
      </td>
      <td class="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
        <Show
          when={ok()}
          fallback={
            <span
              class="inline-flex items-center gap-1 text-[11px] font-semibold text-[#AC2334]"
              title={it().error || "Failed"}
            >
              <X class="w-3.5 h-3.5" /> {it().result || "failed"}
            </span>
          }
        >
          <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-[#15966A]">
            <Check class="w-3.5 h-3.5" /> ok
          </span>
        </Show>
      </td>
    </tr>
  );
}
