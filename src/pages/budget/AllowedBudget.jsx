import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import Swal from "sweetalert2";
import {
  fetchAllowedBudgetClients,
  setAllowedBudget,
  requestBudgetIncrease,
  reviewBudgetRequest,
  fetchBudgetRequests,
} from "../../services/allowedBudget";
import { asTeamMemberId } from "../../stores/cmScope";
import { isAdmin } from "../../stores/currentUser";
import Avatar from "../../components/common/Avatar";

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN REFRESH — v4 system. Every signal, createResource (with its object
// scope guard), memo, modal, the review() Swal flow, role gates and all three
// tabs are UNCHANGED. New code is DISPLAY-ONLY: meter helpers, a per-client
// ceiling-status derivation, and summary counts that read from clients() — no
// new fetches, no writes, no behaviour change. No represented data is dropped:
// allowed/used/headroom (daily + monthly), type chip, pending-request badge,
// "no ceiling set", and the full audit table all remain.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Formatters / null discipline (UNCHANGED) ─────────────────────────────────
const money2 = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
// Whole-rupee for compact captions ("₹1,000 left").
const moneyWhole = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};
const fmtDate = (iso) =>
  !iso ? "—" : new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const TYPE_CHIP = {
  hybrid: "bg-[#ECF2FA] text-[#3E6FB0] dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-[#E9F7F1] text-[#15966A] dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-[#FBF3E2] text-[#B07A14] dark:bg-gray-800 dark:text-gray-300",
};
const TYPE_LABELS = { cpl: "CPL", hybrid: "Hybrid", retainer: "Retainer" };
const TYPE_ORDER = ["cpl", "hybrid", "retainer"];
const STATUS_CHIP = {
  pending: "bg-[#FBF3E2] text-[#B07A14] dark:bg-amber-900/30 dark:text-amber-300",
  approved: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300",
};

// Headroom tone (UNCHANGED logic; tokens swapped to v4 palette).
const headroomTone = (headroom, ceiling) => {
  if (headroom == null) return "text-[#8593A8] dark:text-gray-500";
  const h = parseFloat(headroom);
  const c = parseFloat(ceiling);
  if (!isFinite(h)) return "text-[#8593A8] dark:text-gray-500";
  if (h <= 0) return "text-[#AC2334] dark:text-red-400";
  if (isFinite(c) && c > 0 && h / c < 0.1) return "text-[#B07A14] dark:text-amber-400";
  return "text-[#15966A] dark:text-green-400";
};

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: "top-end", timer: 3500, showConfirmButton: false });

// ════════════════════════════════════════════════════════════════════════════
// DISPLAY-ONLY HELPERS for the new visual layer (no logic / no fetch / no write)
// ════════════════════════════════════════════════════════════════════════════

// Per-leg (daily or monthly) utilisation for the meter. Returns null when the
// ceiling isn't set so the caller renders the "uncapped" state, never a 0% bar.
const legPct = (allowed, used) => {
  if (allowed == null) return null;
  const a = parseFloat(allowed);
  const u = parseFloat(used);
  if (!isFinite(a) || a <= 0 || !isFinite(u)) return null;
  return (u / a) * 100;
};
const legColor = (pct) =>
  pct == null ? "#C4CDDA" : pct > 100 ? "#AC2334" : pct >= 90 ? "#B07A14" : "#15966A";
const legToneClass = (pct) =>
  pct == null ? "text-[#3E6FB0]" : pct > 100 ? "text-[#AC2334]" : pct >= 90 ? "text-[#B07A14]" : "text-[#15966A]";

// Overall ceiling status for a client, taken from the worst of its two legs.
// "uncapped" only when BOTH ceilings are unset (matches the existing
// "No ceiling set" condition exactly).
const clientStatus = (c) => {
  const dp = legPct(c.allowed_daily_budget, c.daily_allocated);
  const mp = legPct(c.allowed_monthly_budget, c.monthly_spent);
  if (dp == null && mp == null) return "uncapped";
  const worst = Math.max(dp ?? -1, mp ?? -1);
  if (worst > 100) return "over";
  if (worst >= 90) return "near";
  return "healthy";
};
const STATUS_META = {
  over: { label: "Over cap", color: "#AC2334", chip: "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300" },
  near: { label: "Near cap", color: "#B07A14", chip: "bg-[#FBF3E2] text-[#B07A14] dark:bg-amber-900/30 dark:text-amber-300" },
  healthy: { label: "Healthy", color: "#15966A", chip: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300" },
  uncapped: { label: "Uncapped", color: "#C4CDDA", chip: "bg-[#F1F4F9] text-[#54657E] dark:bg-gray-800 dark:text-gray-400" },
};
const STATUS_ORDER = ["over", "near", "healthy", "uncapped"];

// Client avatars use the shared <Avatar> from ClientDashboard (same as funding).

// ─── A grouped daily/monthly meter cell (Allowed | Used | Headroom) ───────────
// Keeps ALL three figures from the original BudgetGroup; adds the utilisation
// meter on top of them. Nothing is removed.
function BudgetMeter(props) {
  const allowed = () => props.allowed;
  const used = () => props.used;
  const headroom = () => props.headroom;
  const ceilingSet = () => allowed() != null;
  const pct = () => legPct(allowed(), used());

  return (
    <div class="min-w-[210px]">
      <p class="text-[10px] font-bold uppercase tracking-wide text-[#8593A8] dark:text-gray-500 mb-1.5">
        {props.label} · {props.usedLabel} vs ceiling
      </p>

      <Show
        when={ceilingSet()}
        fallback={
          <>
            <div class="flex items-baseline justify-between gap-2 mb-1.5">
              <span class="text-[13px] italic font-semibold text-[#8593A8] dark:text-gray-500">Not set</span>
              <span class="text-[11.5px] font-semibold text-[#8593A8] dark:text-gray-400 tabular-nums">
                {money2(used()) ?? "—"} {props.usedLabel.toLowerCase()}
              </span>
            </div>
            <div class="h-[7px] rounded-full" style="background:repeating-linear-gradient(90deg,#E3EAF3,#E3EAF3 6px,#EFF3F8 6px,#EFF3F8 12px)" />
            <p class="text-[10.5px] font-bold text-[#3E6FB0] mt-1">No {props.label.toLowerCase()} ceiling</p>
          </>
        }
      >
        {/* Three explicit figures: Allowed · Allocated/Spent · Headroom */}
        <div class="grid grid-cols-3 gap-2 mb-1.5">
          <div>
            <p class="text-[9px] font-bold uppercase tracking-wide text-[#8593A8] dark:text-gray-500">Allowed</p>
            <p class="text-[12.5px] font-bold text-[#14233A] dark:text-gray-100 tabular-nums truncate" title={money2(allowed()) ?? undefined}>{moneyWhole(allowed()) ?? "—"}</p>
          </div>
          <div>
            <p class="text-[9px] font-bold uppercase tracking-wide text-[#8593A8] dark:text-gray-500">{props.usedLabel}</p>
            <p class="text-[12.5px] font-bold text-[#14233A] dark:text-gray-100 tabular-nums truncate" title={money2(used()) ?? undefined}>{moneyWhole(used()) ?? "—"}</p>
          </div>
          <div>
            <p class="text-[9px] font-bold uppercase tracking-wide text-[#8593A8] dark:text-gray-500">Headroom</p>
            <p class={`text-[12.5px] font-bold tabular-nums truncate ${headroomTone(headroom(), allowed())}`} title={money2(headroom()) ?? undefined}>{moneyWhole(headroom()) ?? "—"}</p>
          </div>
        </div>
        <div class="h-[7px] rounded-full bg-[#EAEFF6] dark:bg-gray-700 overflow-hidden relative">
          <div class="absolute left-0 inset-y-0 rounded-full" style={`width:${Math.min(pct() ?? 0, 100)}%;background:${legColor(pct())}`} />
        </div>
        <p class={`text-[10.5px] font-bold mt-1 ${legToneClass(pct())}`}>
          <Show when={(pct() ?? 0) > 100} fallback={<>{Math.round(pct() ?? 0)}% used</>}>
            Over cap · {Math.round(pct())}%
          </Show>
        </p>
      </Show>
    </div>
  );
}

// ─── Edit-ceiling modal (admin) — UNCHANGED logic, v4 styling ─────────────────
function EditCeilingModal(props) {
  const c = () => props.client;
  const [daily, setDaily] = createSignal(c()?.allowed_daily_budget ?? "");
  const [monthly, setMonthly] = createSignal(c()?.allowed_monthly_budget ?? "");
  const [saving, setSaving] = createSignal(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        allowed_daily_budget: daily() === "" ? null : String(daily()),
        allowed_monthly_budget: monthly() === "" ? null : String(monthly()),
      };
      await setAllowedBudget(c().client_id, body);
      toast("success", "Ceiling updated");
      props.onSaved();
      props.onClose();
    } catch (err) {
      toast("error", err?.message || "Failed to update ceiling");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Edit ceiling" subtitle={c()?.name} onClose={props.onClose}>
      <form onSubmit={submit} class="space-y-4">
        <div>
          <label class="block text-sm font-semibold text-[#1A2B45] dark:text-gray-300 mb-1">Daily ceiling (₹)</label>
          <input type="number" min="0" step="0.01" value={daily()} onInput={(e) => setDaily(e.target.value)} placeholder="Leave blank to unset"
            class="w-full px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-gray-50 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] outline-none" />
        </div>
        <div>
          <label class="block text-sm font-semibold text-[#1A2B45] dark:text-gray-300 mb-1">Monthly ceiling (₹)</label>
          <input type="number" min="0" step="0.01" value={monthly()} onInput={(e) => setMonthly(e.target.value)} placeholder="Leave blank to unset"
            class="w-full px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-gray-50 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] outline-none" />
        </div>
        <p class="text-xs text-[#8593A8] dark:text-gray-500">A blank field leaves that ceiling unset (no limit).</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} class="px-4 py-2 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-[#54657E] dark:text-gray-300 hover:bg-[#F8FAFC] dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving()} class="px-4 py-2 text-sm rounded-lg bg-[#AC2334] text-white font-bold hover:bg-[#8E1C2B] disabled:opacity-60">
            {saving() ? "Saving…" : "Save ceiling"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Request-increase modal (CM + admin) — UNCHANGED logic, v4 styling ────────
function RequestModal(props) {
  const c = () => props.client;
  const [kind, setKind] = createSignal("daily");
  const [value, setValue] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  const currentCeiling = () => (kind() === "daily" ? c()?.allowed_daily_budget : c()?.allowed_monthly_budget);

  const submit = async (e) => {
    e.preventDefault();
    if (value() === "") return;
    setSaving(true);
    try {
      await requestBudgetIncrease(c().client_id, {
        budget_kind: kind(),
        requested_value: String(value()),
        reason: reason(),
      });
      toast("success", "Request submitted for approval");
      props.onSaved();
      props.onClose();
    } catch (err) {
      toast("error", err?.message || "Failed to submit request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Request increase" subtitle={c()?.name} onClose={props.onClose}>
      <form onSubmit={submit} class="space-y-4">
        <div>
          <label class="block text-sm font-semibold text-[#1A2B45] dark:text-gray-300 mb-1.5">Ceiling type</label>
          <div class="flex gap-2">
            <For each={[{ k: "daily", l: "Daily" }, { k: "monthly", l: "Monthly" }]}>
              {(o) => (
                <button type="button" onClick={() => setKind(o.k)}
                  class={`flex-1 px-3 py-2 text-sm rounded-lg border font-bold ${kind() === o.k ? "border-[#AC2334] bg-[#FBEEF0] dark:bg-red-900/20 text-[#AC2334] dark:text-red-300" : "border-[#E2E8F1] dark:border-gray-600 text-[#54657E] dark:text-gray-300"}`}>
                  {o.l}
                </button>
              )}
            </For>
          </div>
          <p class="text-xs text-[#8593A8] dark:text-gray-500 mt-1">
            Current {kind()} ceiling: {currentCeiling() == null ? "Not set" : money2(currentCeiling())}
          </p>
        </div>
        <div>
          <label class="block text-sm font-semibold text-[#1A2B45] dark:text-gray-300 mb-1">Requested value (₹)</label>
          <input type="number" min="0" step="0.01" required value={value()} onInput={(e) => setValue(e.target.value)}
            class="w-full px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-gray-50 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] outline-none" />
        </div>
        <div>
          <label class="block text-sm font-semibold text-[#1A2B45] dark:text-gray-300 mb-1">Reason</label>
          <textarea rows="3" value={reason()} onInput={(e) => setReason(e.target.value)} placeholder="Why is this increase needed?"
            class="w-full px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-gray-50 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] outline-none resize-none" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} class="px-4 py-2 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-[#54657E] dark:text-gray-300 hover:bg-[#F8FAFC] dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving() || value() === ""} class="px-4 py-2 text-sm rounded-lg bg-[#AC2334] text-white font-bold hover:bg-[#8E1C2B] disabled:opacity-60">
            {saving() ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Generic modal shell (UNCHANGED logic, v4 styling) ────────────────────────
function ModalShell(props) {
  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="fixed inset-0 bg-[#101D31]/40 backdrop-blur-sm" onClick={props.onClose} />
      <div class="relative z-10 w-full max-w-md bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-2xl">
        <div class="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F1] dark:border-gray-800">
          <div>
            <h2 class="text-base font-bold text-[#14233A] dark:text-white">{props.title}</h2>
            <Show when={props.subtitle}><p class="text-xs text-[#54657E] dark:text-gray-400">{props.subtitle}</p></Show>
          </div>
          <button onClick={props.onClose} class="w-8 h-8 rounded-full flex items-center justify-center text-[#8593A8] hover:bg-[#F1F4F9] dark:hover:bg-gray-800">✕</button>
        </div>
        <div class="px-5 py-5">{props.children}</div>
      </div>
    </div>
  );
}

export default function AllowedBudget() {
  const admin = () => isAdmin();
  const [tab, setTab] = createSignal("clients"); // clients | queue | audit
  const [editClient, setEditClient] = createSignal(null);
  const [requestClient, setRequestClient] = createSignal(null);
  const [auditStatus, setAuditStatus] = createSignal("all");

  // ── New display-only UI state (filters the clients list, same pattern as the
  // existing audit status filter — no fetch). ──
  const [search, setSearch] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all"); // all | over | near | capped | uncapped
  const [typeFilter, setTypeFilter] = createSignal("all"); // all | cpl | hybrid | retainer | …

  // Source returns an object (always truthy) — UNCHANGED.
  const [clients, { refetch: refetchClients }] = createResource(
    () => ({ scope: asTeamMemberId() }),
    async () => {
      const res = await fetchAllowedBudgetClients();
      return Array.isArray(res?.data) ? res.data : [];
    },
  );

  // Pending queue + audit resources — UNCHANGED.
  const queueSource = createMemo(() => ({ scope: asTeamMemberId(), status: "pending", tab: tab() }));
  const [pending, { refetch: refetchPending }] = createResource(
    () => (tab() === "queue" ? queueSource() : null),
    async () => {
      const res = await fetchBudgetRequests("pending");
      return Array.isArray(res?.data) ? res.data : [];
    },
  );

  const auditSource = createMemo(() => ({ scope: asTeamMemberId(), status: auditStatus(), tab: tab() }));
  const [audit, { refetch: refetchAudit }] = createResource(
    () => (tab() === "audit" ? auditSource() : null),
    async (s) => {
      const res = await fetchBudgetRequests(s.status);
      return Array.isArray(res?.data) ? res.data : [];
    },
  );

  const refreshAll = () => {
    refetchClients();
    if (tab() === "queue") refetchPending();
    if (tab() === "audit") refetchAudit();
  };

  // Pending-request count badge per client (UNCHANGED).
  const pendingCount = (c) => (Array.isArray(c.pending_requests) ? c.pending_requests.length : 0);

  // ── Display-only summary derivations (read clients(), no fetch/write) ──
  const allClients = () => clients() ?? [];

  const statusCounts = createMemo(() => {
    const c = { all: 0, over: 0, near: 0, healthy: 0, uncapped: 0, capped: 0 };
    for (const cl of allClients()) {
      c.all++;
      const s = clientStatus(cl);
      c[s]++;
      if (s !== "uncapped") c.capped++;
    }
    return c;
  });
  const attentionCount = createMemo(() => statusCounts().over + statusCounts().near);
  const pct = (n) => {
    const t = statusCounts().all || 1;
    return Math.round((n / t) * 100);
  };
  const totalPendingRequests = createMemo(() =>
    allClients().reduce((s, c) => s + pendingCount(c), 0),
  );

  const distSegments = createMemo(() => {
    const c = statusCounts();
    return STATUS_ORDER.map((k) => ({ key: k, count: c[k], color: STATUS_META[k].color, label: STATUS_META[k].label }));
  });

  // Filtered client list (display only; preserves API order).
  // Client types actually present in the data (so e.g. Retainer only appears as
  // an option when retainer clients are in scope on this page).
  const presentTypes = createMemo(() => {
    const set = new Set();
    for (const c of allClients()) if (c.client_type) set.add(c.client_type);
    return [...set]
      .sort((a, b) => ((TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99)))
      .map((k) => ({ key: k, label: TYPE_LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1) }));
  });

  const visibleClients = createMemo(() => {
    const q = search().trim().toLowerCase();
    const sf = statusFilter();
    const tf = typeFilter();
    return allClients().filter((c) => {
      if (q && !c.name?.toLowerCase().includes(q)) return false;
      if (tf !== "all" && c.client_type !== tf) return false;
      if (sf === "all") return true;
      if (sf === "capped") return clientStatus(c) !== "uncapped";
      return clientStatus(c) === sf;
    });
  });
  const anyFilter = () => search().trim() || statusFilter() !== "all" || typeFilter() !== "all";

  const review = async (req, decision) => {
    const { value: note, isConfirmed } = await Swal.fire({
      title: `${decision === "approve" ? "Approve" : "Reject"} request`,
      html: `<div style="text-align:left;font-size:13px;line-height:1.6">
        <b>${req.name}</b> · ${req.budget_kind} ceiling<br/>
        ${money2(req.current_value) ?? "Not set"} → <b>${money2(req.requested_value)}</b>
        ${req.reason ? `<br/><span style="color:#888">Reason: ${req.reason}</span>` : ""}
      </div>`,
      input: "textarea",
      inputPlaceholder: "Review note (optional)",
      showCancelButton: true,
      confirmButtonText: decision === "approve" ? "Approve" : "Reject",
      confirmButtonColor: decision === "approve" ? "#15966A" : "#AC2334",
    });
    if (!isConfirmed) return;
    try {
      await reviewBudgetRequest(req.id, { decision, review_note: note || "" });
      toast("success", decision === "approve" ? "Approved — ceiling updated" : "Request rejected");
      refreshAll();
    } catch (err) {
      toast(err?.status === 409 ? "info" : "error", err?.message || "Could not review request");
      refreshAll();
    }
  };

  const tabs = createMemo(() =>
    admin()
      ? [{ k: "clients", l: "Clients" }, { k: "queue", l: "Approval Queue" }, { k: "audit", l: "Requests" }]
      : [{ k: "clients", l: "My Clients" }, { k: "audit", l: "My Requests" }],
  );

  return (
    <div class="font-sans min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      <div class="mb-5">
        <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">Coordination · Controls</p>
        <h1 class="text-2xl font-bold text-[#14233A] dark:text-white tracking-tight">Allowed Budget</h1>
        <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">
          Per-client spending ceilings.{" "}
          {admin() ? "Set ceilings directly and review increase requests." : "Request an increase when you need more delivery."}
        </p>
      </div>

      {/* Tabs */}
      <div class="inline-flex gap-1 p-1 bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] mb-5">
        <For each={tabs()}>
          {(t) => (
            <button onClick={() => setTab(t.k)}
              class={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${tab() === t.k ? "bg-[#14233A] text-white" : "text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-gray-300"}`}>
              {t.l}
              <Show when={t.k === "queue" && totalPendingRequests() > 0}>
                <span class={`text-[11px] font-extrabold px-1.5 py-px rounded-full ${tab() === t.k ? "bg-white/20 text-white" : "bg-[#FBEEF0] text-[#AC2334]"}`}>{totalPendingRequests()}</span>
              </Show>
            </button>
          )}
        </For>
      </div>

      {/* ── CLIENTS TAB ── */}
      <Show when={tab() === "clients"}>
        <Show when={clients.error}>
          <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">Failed to load clients. Please try again.</div>
        </Show>

        {/* ════ SUMMARY PANEL (focal + distribution bar + pending pill) ════ */}
        <Show when={!clients.loading && allClients().length > 0}>
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 sm:px-7 py-5 mb-4">
            <div class="flex flex-wrap items-center gap-x-6 gap-y-4">
              {/* focal */}
              <div class="flex items-center gap-4 sm:pr-6 sm:border-r border-[#E2E8F1] dark:border-gray-700">
                <div class="relative w-14 h-14 grid place-items-center flex-none">
                  <svg viewBox="0 0 56 56" class="absolute inset-0 -rotate-90">
                    <circle cx="28" cy="28" r="25" fill="none" stroke="#F4D7DC" stroke-width="5" />
                    <circle cx="28" cy="28" r="25" fill="none" stroke="#AC2334" stroke-width="5" stroke-linecap="round"
                      stroke-dasharray={2 * Math.PI * 25}
                      stroke-dashoffset={2 * Math.PI * 25 * (1 - Math.min(attentionCount() / (statusCounts().all || 1), 1))} />
                  </svg>
                  <span class="text-xl font-extrabold text-[#AC2334] tabular-nums">{attentionCount()}</span>
                </div>
                <div>
                  <p class="text-[15px] font-extrabold text-[#14233A] dark:text-white">Need attention</p>
                  <p class="text-xs text-[#54657E] dark:text-gray-400 max-w-[180px]">clients over or within 10% of their ceiling</p>
                </div>
              </div>

              {/* minis */}
              <div class="flex gap-7">
                <div>
                  <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Ceilings set</p>
                  <p class="text-2xl font-extrabold text-[#14233A] dark:text-white mt-1 tabular-nums">{statusCounts().capped}</p>
                  <p class="text-xs text-[#54657E] dark:text-gray-400">{pct(statusCounts().capped)}% of {statusCounts().all} clients</p>
                </div>
                <div>
                  <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Uncapped</p>
                  <p class="text-2xl font-extrabold text-[#14233A] dark:text-white mt-1 tabular-nums">{statusCounts().uncapped}</p>
                  <p class="text-xs text-[#54657E] dark:text-gray-400">{pct(statusCounts().uncapped)}% spending open</p>
                </div>
              </div>

              {/* pending requests pill → Approval Queue (admin) */}
              <Show when={admin() && totalPendingRequests() > 0}>
                <button
                  onClick={() => setTab("queue")}
                  class="ml-auto inline-flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#F8FAFC] dark:bg-gray-900 border border-[#E2E8F1] dark:border-gray-700 hover:border-[#AC2334] hover:bg-[#FBEEF0] transition-colors"
                >
                  <span class="w-8 h-8 rounded-lg bg-[#AC2334] text-white grid place-items-center font-extrabold text-sm">{totalPendingRequests()}</span>
                  <span class="text-left">
                    <span class="block text-[13px] font-bold text-[#14233A] dark:text-white">Pending requests</span>
                    <span class="block text-[11.5px] text-[#54657E] dark:text-gray-400">awaiting your approval</span>
                  </span>
                  <span class="text-[#8593A8]">→</span>
                </button>
              </Show>
            </div>

            {/* distribution bar */}
            <div class="mt-5 pt-4 border-t border-[#E2E8F1] dark:border-gray-700">
              <div class="flex items-center justify-between mb-2.5">
                <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                  All {statusCounts().all} clients by ceiling status
                </span>
                <span class="text-xs font-semibold text-[#54657E] dark:text-gray-400">tap a segment to filter</span>
              </div>
              <div class="flex h-1.5 rounded-full overflow-hidden bg-[#E2E8F1] dark:bg-gray-700 gap-0.5">
                <For each={distSegments()}>
                  {(seg) => (
                    <Show when={seg.count > 0}>
                      <button
                        onClick={() => setStatusFilter(statusFilter() === seg.key ? "all" : seg.key)}
                        style={`flex:${seg.count};background:${seg.color}`}
                        title={`${seg.label}: ${seg.count}`}
                        class="h-full first:rounded-l-full last:rounded-r-full"
                      />
                    </Show>
                  )}
                </For>
              </div>
              <div class="flex flex-wrap gap-2 mt-3">
                <For each={distSegments()}>
                  {(seg) => (
                    <button
                      onClick={() => setStatusFilter(statusFilter() === seg.key ? "all" : seg.key)}
                      class={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors ${statusFilter() === seg.key ? "border-[#14233A] bg-[#F8FAFC] dark:bg-gray-900" : "border-[#E2E8F1] dark:border-gray-700 hover:border-[#D4DDE9]"}`}
                    >
                      <span class="w-2.5 h-2.5 rounded" style={`background:${seg.color}`} />
                      <span class="text-[#54657E] dark:text-gray-300 font-semibold">{seg.label}</span>
                      <b class="text-[#14233A] dark:text-white font-extrabold tabular-nums">{seg.count}</b>
                      <span class="text-[#8593A8] font-medium">{pct(seg.count)}%</span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>

        {/* Toolbar: search + status chips */}
        <Show when={!clients.loading && allClients().length > 0}>
          <div class="bg-gray-50 dark:bg-gray-900 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-3.5 mb-4 flex flex-wrap items-center gap-3">
            <div class="relative flex-1 min-w-[220px]">
              <svg class="w-4 h-4 text-[#8593A8] absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input type="text" placeholder="Search by client name…" value={search()} onInput={(e) => setSearch(e.target.value)}
                class="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-white placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] focus:bg-gray-50" />
            </div>
            <div class="flex flex-wrap items-center gap-2">
              {/* Cap-status dropdown */}
              <div class="relative">
                <select value={statusFilter()} onChange={(e) => setStatusFilter(e.target.value)}
                  class="appearance-none pl-3 pr-9 py-2.5 text-[13px] font-semibold rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer">
                  <option value="all">All statuses ({statusCounts().all})</option>
                  <option value="over">Over cap ({statusCounts().over})</option>
                  <option value="near">Near cap ({statusCounts().near})</option>
                  <option value="capped">Capped ({statusCounts().capped})</option>
                  <option value="uncapped">Uncapped ({statusCounts().uncapped})</option>
                </select>
                <svg class="w-4 h-4 text-[#8593A8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </div>

              {/* Client-type dropdown — options limited to types present in scope */}
              <Show when={presentTypes().length > 0}>
                <div class="relative">
                  <select value={typeFilter()} onChange={(e) => setTypeFilter(e.target.value)}
                    class="appearance-none pl-3 pr-9 py-2.5 text-[13px] font-semibold rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer">
                    <option value="all">All client types</option>
                    <For each={presentTypes()}>{(t) => <option value={t.key}>{t.label}</option>}</For>
                  </select>
                  <svg class="w-4 h-4 text-[#8593A8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </Show>
            </div>
            <div class="flex items-center gap-3 ml-auto">
              <Show when={anyFilter()}>
                <button onClick={() => { setSearch(""); setStatusFilter("all"); setTypeFilter("all"); }} class="text-[13px] font-semibold text-[#AC2334] hover:underline">Clear</button>
              </Show>
              <span class="text-sm font-bold text-[#8593A8] dark:text-gray-500 whitespace-nowrap"><b class="text-[#14233A] dark:text-white">{visibleClients().length}</b> shown</span>
            </div>
          </div>
        </Show>

        {/* Client list */}
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] divide-y divide-[#E2E8F1] dark:divide-gray-800 overflow-hidden">
          <Show when={clients.loading}>
            <For each={Array(5).fill(0)}>{() => <div class="h-24 animate-pulse bg-[#FAFBFD] dark:bg-gray-800/40" />}</For>
          </Show>

          <Show when={!clients.loading && allClients().length === 0}>
            <div class="py-16 text-center">
              <p class="text-sm text-[#54657E] dark:text-gray-400">No clients to show.</p>
              <Show when={admin()}><p class="text-xs text-[#8593A8] dark:text-gray-500 mt-1">Set a ceiling on a client to start governing spend.</p></Show>
            </div>
          </Show>

          <Show when={!clients.loading && allClients().length > 0 && visibleClients().length === 0}>
            <div class="py-16 text-center text-sm text-[#8593A8] dark:text-gray-500">No clients match the current filters.</div>
          </Show>

          <For each={visibleClients()}>
            {(c) => {
              const st = clientStatus(c);
              return (
                <div class={`flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40 ${st === "over" ? "bg-[#FEF5F7] dark:bg-red-900/10" : ""}`}>
                  {/* identity */}
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-4">
                      <Avatar name={c.name} />
                      <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-blue-900 dark:text-gray-100 font-semibold truncate" title={c.name}>{c.name}</span>
                          <Show when={c.client_type}>
                            <span class={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${TYPE_CHIP[c.client_type] ?? TYPE_CHIP.retainer}`}>{c.client_type}</span>
                          </Show>
                          {/* ceiling status pill (replaces / includes the old "No ceiling set") */}
                          <span class={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${STATUS_META[st].chip}`}>
                            <span class="w-1.5 h-1.5 rounded-full" style={`background:${STATUS_META[st].color}`} />
                            {st === "uncapped" ? "No ceiling set" : STATUS_META[st].label}
                          </span>
                          <Show when={pendingCount(c) > 0}>
                            <span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FBF3E2] text-[#B07A14] dark:bg-amber-900/30 dark:text-amber-300">
                              <span class="w-1.5 h-1.5 rounded-full bg-[#B07A14]" /> {pendingCount(c)} request{pendingCount(c) !== 1 ? "s" : ""} pending
                            </span>
                          </Show>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* daily + monthly meters (Allowed | Used | Headroom preserved) */}
                  <div class="flex flex-wrap gap-5 xl:gap-7">
                    <BudgetMeter label="Daily" usedLabel="Allocated" allowed={c.allowed_daily_budget} used={c.daily_allocated} headroom={c.daily_headroom} />
                    <BudgetMeter label="Monthly" usedLabel="Spent" allowed={c.allowed_monthly_budget} used={c.monthly_spent} headroom={c.monthly_headroom} />
                  </div>

                  {/* actions */}
                  <div class="flex-shrink-0 flex gap-2">
                    <Show when={admin()}>
                      <button onClick={() => setEditClient(c)} title="Edit ceiling"
                        class="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[#D4DDE9] dark:border-gray-600 text-[#14233A] dark:text-gray-300 hover:bg-[#F8FAFC] dark:hover:bg-gray-800 hover:border-[#14233A] whitespace-nowrap font-semibold">
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        Edit ceiling
                      </button>
                    </Show>
                    <button onClick={() => setRequestClient(c)}
                      class="px-3 py-2 text-sm rounded-lg bg-[#AC2334] text-white font-bold hover:bg-[#8E1C2B] whitespace-nowrap">
                      {st === "uncapped" && admin() ? "Set ceiling" : "Request increase"}
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      {/* ── APPROVAL QUEUE TAB (admin) ── */}
      <Show when={tab() === "queue" && admin()}>
        <Show when={pending.error}><div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">Failed to load pending requests.</div></Show>
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] divide-y divide-[#E2E8F1] dark:divide-gray-800 overflow-hidden">
          <Show when={pending.loading}><For each={Array(4).fill(0)}>{() => <div class="h-20 animate-pulse bg-[#FAFBFD] dark:bg-gray-800/40" />}</For></Show>
          <Show when={!pending.loading && (pending()?.length ?? 0) === 0}>
            <div class="py-16 text-center text-sm text-[#8593A8] dark:text-gray-500">No pending requests. 🎉</div>
          </Show>
          <For each={pending() ?? []}>
            {(req) => (
              <div class="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <Avatar name={req.name} size="w-9 h-9" />
                    <span class="font-bold text-[#14233A] dark:text-gray-100">{req.name}</span>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F1F4F9] text-[#54657E] dark:bg-gray-800 dark:text-gray-300 uppercase">{req.budget_kind}</span>
                  </div>
                  <p class="text-sm text-[#54657E] dark:text-gray-300 mt-1.5 ml-11">
                    {money2(req.current_value) ?? "Not set"} <span class="text-[#8593A8]">→</span> <span class="font-bold text-[#14233A] dark:text-white tabular-nums">{money2(req.requested_value)}</span>
                  </p>
                  <p class="text-xs text-[#8593A8] dark:text-gray-500 mt-0.5 ml-11">
                    by {req.requested_by} · {fmtDate(req.created_at)}{req.reason ? ` · “${req.reason}”` : ""}
                  </p>
                </div>
                <div class="flex gap-2 flex-shrink-0">
                  <button onClick={() => review(req, "approve")} class="px-3 py-2 text-sm rounded-lg bg-[#15966A] text-white font-bold hover:bg-[#0F7A55]">Approve</button>
                  <button onClick={() => review(req, "reject")} class="px-3 py-2 text-sm rounded-lg border border-[#AC2334]/30 dark:border-red-700 text-[#AC2334] dark:text-red-400 font-bold hover:bg-[#FBEEF0] dark:hover:bg-red-900/20">Reject</button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* ── AUDIT / HISTORY TAB ── */}
      <Show when={tab() === "audit"}>
        <div class="flex items-center gap-3 mb-4">
          <select value={auditStatus()} onChange={(e) => setAuditStatus(e.target.value)}
            class="px-3 py-2 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer font-semibold">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <span class="text-sm font-semibold text-[#8593A8] dark:text-gray-500">{audit()?.length ?? 0} request{(audit()?.length ?? 0) !== 1 ? "s" : ""}</span>
        </div>

        <Show when={audit.error}><div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">Failed to load requests.</div></Show>

        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b border-[#D4DDE9] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60 text-[#54657E] dark:text-gray-400 uppercase text-xs font-bold tracking-wider">
                <th class="p-3.5 text-left whitespace-nowrap">Client</th>
                <th class="p-3.5 text-left whitespace-nowrap">Kind</th>
                <th class="p-3.5 text-right whitespace-nowrap">Current → Requested</th>
                <th class="p-3.5 text-center whitespace-nowrap">Status</th>
                <th class="p-3.5 text-left whitespace-nowrap">Requested by</th>
                <th class="p-3.5 text-left whitespace-nowrap">Reviewed by</th>
                <th class="p-3.5 text-left whitespace-nowrap">When</th>
              </tr>
            </thead>
            <Show when={audit.loading} fallback={
              <tbody>
                <For each={audit() ?? []}>
                  {(r, i) => (
                    <tr class={`border-b border-[#E2E8F1] dark:border-gray-800 ${i() % 2 === 0 ? "bg-gray-50 dark:bg-gray-900" : "bg-[#FAFBFD] dark:bg-gray-800/30"}`}>
                      <td class="p-3.5 font-bold text-[#14233A] dark:text-gray-100">{r.name}</td>
                      <td class="p-3.5 capitalize text-[#54657E] dark:text-gray-400">{r.budget_kind}</td>
                      <td class="p-3.5 text-right whitespace-nowrap text-[#54657E] dark:text-gray-300 tabular-nums">{money2(r.current_value) ?? "Not set"} → <span class="font-bold text-[#14233A] dark:text-white">{money2(r.requested_value)}</span></td>
                      <td class="p-3.5 text-center"><span class={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${STATUS_CHIP[r.status] ?? "bg-[#F1F4F9] text-[#54657E]"}`}>{r.status}</span></td>
                      <td class="p-3.5 text-[#54657E] dark:text-gray-400">{r.requested_by}<Show when={r.reason}><span class="block text-[11px] text-[#8593A8] truncate max-w-[200px]" title={r.reason}>“{r.reason}”</span></Show></td>
                      <td class="p-3.5 text-[#54657E] dark:text-gray-400">{r.reviewed_by ?? "—"}<Show when={r.review_note}><span class="block text-[11px] text-[#8593A8] truncate max-w-[200px]" title={r.review_note}>“{r.review_note}”</span></Show></td>
                      <td class="p-3.5 text-[#8593A8] dark:text-gray-400 whitespace-nowrap text-xs">{fmtDate(r.reviewed_at ?? r.created_at)}</td>
                    </tr>
                  )}
                </For>
                <Show when={(audit()?.length ?? 0) === 0}>
                  <tr><td colspan="7" class="py-16 text-center text-[#8593A8] dark:text-gray-500">No requests found.</td></tr>
                </Show>
              </tbody>
            }>
              <tbody><tr><td colspan="7" class="py-16 text-center text-[#8593A8] dark:text-gray-500">Loading…</td></tr></tbody>
            </Show>
          </table>
        </div>
      </Show>

      {/* Modals */}
      <Show when={editClient()}>
        <EditCeilingModal client={editClient()} onClose={() => setEditClient(null)} onSaved={refreshAll} />
      </Show>
      <Show when={requestClient()}>
        <RequestModal client={requestClient()} onClose={() => setRequestClient(null)} onSaved={refreshAll} />
      </Show>
    </div>
  );
}