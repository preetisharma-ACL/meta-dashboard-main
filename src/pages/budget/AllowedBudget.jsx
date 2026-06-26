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

// ─── Formatters / null discipline ─────────────────────────────────────────────
// Ceiling fields (allowed_*, *_headroom) can be null → "No ceiling set" / "—",
// NEVER ₹0. allocated/spent are always real numbers.
const money2 = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtDate = (iso) =>
  !iso ? "—" : new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const TYPE_CHIP = {
  hybrid: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};
const STATUS_CHIP = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

// Headroom tone: red ≤ 0, amber if positive but near the ceiling, else green.
const headroomTone = (headroom, ceiling) => {
  if (headroom == null) return "text-gray-400 dark:text-gray-500";
  const h = parseFloat(headroom);
  const c = parseFloat(ceiling);
  if (!isFinite(h)) return "text-gray-400 dark:text-gray-500";
  if (h <= 0) return "text-red-600 dark:text-red-400";
  if (isFinite(c) && c > 0 && h / c < 0.1) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
};

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: "top-end", timer: 3500, showConfirmButton: false });

// ─── A grouped daily/monthly column (Allowed | Used | Headroom) ───────────────
function BudgetGroup(props) {
  const allowed = () => props.allowed;
  const used = () => props.used;
  const headroom = () => props.headroom;
  const ceilingSet = () => allowed() != null;
  return (
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 min-w-[200px]">
      <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">{props.label}</p>
      <div class="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p class="text-gray-400 dark:text-gray-500">Allowed</p>
          <Show when={ceilingSet()} fallback={<p class="text-gray-400 dark:text-gray-500 italic">Not set</p>}>
            <p class="font-semibold text-gray-800 dark:text-gray-100">{money2(allowed())}</p>
          </Show>
        </div>
        <div>
          <p class="text-gray-400 dark:text-gray-500">{props.usedLabel}</p>
          <p class="font-medium text-gray-700 dark:text-gray-300">{money2(used()) ?? "—"}</p>
        </div>
        <div>
          <p class="text-gray-400 dark:text-gray-500">Headroom</p>
          <Show when={ceilingSet()} fallback={<p class="text-gray-400 dark:text-gray-500">—</p>}>
            <p class={`font-semibold ${headroomTone(headroom(), allowed())}`}>{money2(headroom()) ?? "—"}</p>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ─── Edit-ceiling modal (admin) ───────────────────────────────────────────────
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
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Daily ceiling (₹)</label>
          <input type="number" min="0" step="0.01" value={daily()} onInput={(e) => setDaily(e.target.value)} placeholder="Leave blank to unset"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly ceiling (₹)</label>
          <input type="number" min="0" step="0.01" value={monthly()} onInput={(e) => setMonthly(e.target.value)} placeholder="Leave blank to unset"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none" />
        </div>
        <p class="text-xs text-gray-400 dark:text-gray-500">A blank field leaves that ceiling unset (no limit).</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving()} class="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 disabled:opacity-60">
            {saving() ? "Saving…" : "Save ceiling"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Request-increase modal (CM + admin) ──────────────────────────────────────
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
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Ceiling type</label>
          <div class="flex gap-2">
            <For each={[{ k: "daily", l: "Daily" }, { k: "monthly", l: "Monthly" }]}>
              {(o) => (
                <button type="button" onClick={() => setKind(o.k)}
                  class={`flex-1 px-3 py-2 text-sm rounded-lg border font-medium ${kind() === o.k ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300" : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"}`}>
                  {o.l}
                </button>
              )}
            </For>
          </div>
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Current {kind()} ceiling: {currentCeiling() == null ? "Not set" : money2(currentCeiling())}
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Requested value (₹)</label>
          <input type="number" min="0" step="0.01" required value={value()} onInput={(e) => setValue(e.target.value)}
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label>
          <textarea rows="3" value={reason()} onInput={(e) => setReason(e.target.value)} placeholder="Why is this increase needed?"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none resize-none" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving() || value() === ""} class="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 disabled:opacity-60">
            {saving() ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Generic modal shell ──────────────────────────────────────────────────────
function ModalShell(props) {
  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={props.onClose} />
      <div class="relative z-10 w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl">
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 class="text-base font-semibold text-gray-800 dark:text-white">{props.title}</h2>
            <Show when={props.subtitle}><p class="text-xs text-gray-500 dark:text-gray-400">{props.subtitle}</p></Show>
          </div>
          <button onClick={props.onClose} class="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">✕</button>
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

  // Source returns an object (always truthy) so the fetch runs even when no
  // switch-mode scope is active (asTeamMemberId() === null). Passing the raw
  // signal would make createResource skip the fetch and leave the list empty.
  const [clients, { refetch: refetchClients }] = createResource(
    () => ({ scope: asTeamMemberId() }),
    async () => {
      const res = await fetchAllowedBudgetClients();
      return Array.isArray(res?.data) ? res.data : [];
    },
  );

  // Pending queue (admin) + audit list both come from the requests endpoint.
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

  // Pending-request count badge per client (from the clients list).
  const pendingCount = (c) => (Array.isArray(c.pending_requests) ? c.pending_requests.length : 0);

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
      confirmButtonColor: decision === "approve" ? "#16a34a" : "#dc2626",
    });
    if (!isConfirmed) return;
    try {
      await reviewBudgetRequest(req.id, { decision, review_note: note || "" });
      toast("success", decision === "approve" ? "Approved — ceiling updated" : "Request rejected");
      refreshAll();
    } catch (err) {
      // 409 = already reviewed by someone else; refresh so the stale row clears.
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
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      <div class="mb-6">
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">Allowed Budget</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Per-client spending ceilings.{" "}
          {admin() ? "Set ceilings directly and review increase requests." : "Request an increase when you need more delivery."}
        </p>
      </div>

      {/* Tabs */}
      <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit mb-5">
        <For each={tabs()}>
          {(t) => (
            <button onClick={() => setTab(t.k)}
              class={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab() === t.k ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"}`}>
              {t.l}
            </button>
          )}
        </For>
      </div>

      {/* ── CLIENTS TAB ── */}
      <Show when={tab() === "clients"}>
        <Show when={clients.error}>
          <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400">Failed to load clients. Please try again.</div>
        </Show>

        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
          <Show when={clients.loading}>
            <For each={Array(5).fill(0)}>{() => <div class="h-20 animate-pulse bg-gray-50 dark:bg-gray-800/40" />}</For>
          </Show>

          <Show when={!clients.loading && (clients()?.length ?? 0) === 0}>
            <div class="py-16 text-center">
              <p class="text-sm text-gray-500 dark:text-gray-400">No clients to show.</p>
              <Show when={admin()}><p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Set a ceiling on a client to start governing spend.</p></Show>
            </div>
          </Show>

          <For each={clients() ?? []}>
            {(c) => (
              <div class="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold text-gray-800 dark:text-gray-100 truncate">{c.name}</span>
                    <Show when={c.client_type}>
                      <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${TYPE_CHIP[c.client_type] ?? TYPE_CHIP.retainer}`}>{c.client_type}</span>
                    </Show>
                    <Show when={pendingCount(c) > 0}>
                      <span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <span class="w-1.5 h-1.5 rounded-full bg-amber-500" /> {pendingCount(c)} request{pendingCount(c) !== 1 ? "s" : ""} pending
                      </span>
                    </Show>
                    <Show when={c.allowed_daily_budget == null && c.allowed_monthly_budget == null}>
                      <span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">No ceiling set</span>
                    </Show>
                  </div>
                </div>

                <div class="flex flex-wrap gap-2">
                  <BudgetGroup label="Daily" usedLabel="Allocated" allowed={c.allowed_daily_budget} used={c.daily_allocated} headroom={c.daily_headroom} />
                  <BudgetGroup label="Monthly" usedLabel="Spent" allowed={c.allowed_monthly_budget} used={c.monthly_spent} headroom={c.monthly_headroom} />
                </div>

                <div class="flex-shrink-0 flex gap-2">
                  <Show when={admin()}>
                    <button onClick={() => setEditClient(c)} class="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 whitespace-nowrap">
                      Edit ceiling
                    </button>
                  </Show>
                  <button onClick={() => setRequestClient(c)} class="px-3 py-2 text-sm rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 whitespace-nowrap">
                    Request increase
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* ── APPROVAL QUEUE TAB (admin) ── */}
      <Show when={tab() === "queue" && admin()}>
        <Show when={pending.error}><div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400">Failed to load pending requests.</div></Show>
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
          <Show when={pending.loading}><For each={Array(4).fill(0)}>{() => <div class="h-20 animate-pulse bg-gray-50 dark:bg-gray-800/40" />}</For></Show>
          <Show when={!pending.loading && (pending()?.length ?? 0) === 0}>
            <div class="py-16 text-center text-sm text-gray-400 dark:text-gray-500">No pending requests. 🎉</div>
          </Show>
          <For each={pending() ?? []}>
            {(req) => (
              <div class="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold text-gray-800 dark:text-gray-100">{req.name}</span>
                    <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 capitalize">{req.budget_kind}</span>
                  </div>
                  <p class="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    {money2(req.current_value) ?? "Not set"} <span class="text-gray-400">→</span> <span class="font-semibold text-gray-900 dark:text-white">{money2(req.requested_value)}</span>
                  </p>
                  <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    by {req.requested_by} · {fmtDate(req.created_at)}{req.reason ? ` · “${req.reason}”` : ""}
                  </p>
                </div>
                <div class="flex gap-2 flex-shrink-0">
                  <button onClick={() => review(req, "approve")} class="px-3 py-2 text-sm rounded-lg bg-green-600 text-white font-medium hover:bg-green-700">Approve</button>
                  <button onClick={() => review(req, "reject")} class="px-3 py-2 text-sm rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 font-medium hover:bg-red-50 dark:hover:bg-red-900/20">Reject</button>
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
            class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <span class="text-sm text-gray-400 dark:text-gray-500">{audit()?.length ?? 0} request{(audit()?.length ?? 0) !== 1 ? "s" : ""}</span>
        </div>

        <Show when={audit.error}><div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400">Failed to load requests.</div></Show>

        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider">
                <th class="p-3 text-left whitespace-nowrap">Client</th>
                <th class="p-3 text-left whitespace-nowrap">Kind</th>
                <th class="p-3 text-right whitespace-nowrap">Current → Requested</th>
                <th class="p-3 text-center whitespace-nowrap">Status</th>
                <th class="p-3 text-left whitespace-nowrap">Requested by</th>
                <th class="p-3 text-left whitespace-nowrap">Reviewed by</th>
                <th class="p-3 text-left whitespace-nowrap">When</th>
              </tr>
            </thead>
            <Show when={audit.loading} fallback={
              <tbody>
                <For each={audit() ?? []}>
                  {(r, i) => (
                    <tr class={`border-b border-gray-100 dark:border-gray-800 ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/60 dark:bg-gray-800/30"}`}>
                      <td class="p-3 font-medium text-gray-800 dark:text-gray-100">{r.name}</td>
                      <td class="p-3 capitalize text-gray-600 dark:text-gray-400">{r.budget_kind}</td>
                      <td class="p-3 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">{money2(r.current_value) ?? "Not set"} → <span class="font-semibold">{money2(r.requested_value)}</span></td>
                      <td class="p-3 text-center"><span class={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_CHIP[r.status] ?? "bg-gray-100 text-gray-600"}`}>{r.status}</span></td>
                      <td class="p-3 text-gray-600 dark:text-gray-400">{r.requested_by}<Show when={r.reason}><span class="block text-[11px] text-gray-400 truncate max-w-[200px]" title={r.reason}>“{r.reason}”</span></Show></td>
                      <td class="p-3 text-gray-600 dark:text-gray-400">{r.reviewed_by ?? "—"}<Show when={r.review_note}><span class="block text-[11px] text-gray-400 truncate max-w-[200px]" title={r.review_note}>“{r.review_note}”</span></Show></td>
                      <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{fmtDate(r.reviewed_at ?? r.created_at)}</td>
                    </tr>
                  )}
                </For>
                <Show when={(audit()?.length ?? 0) === 0}>
                  <tr><td colspan="7" class="py-16 text-center text-gray-400 dark:text-gray-500">No requests found.</td></tr>
                </Show>
              </tbody>
            }>
              <tbody><tr><td colspan="7" class="py-16 text-center text-gray-400 dark:text-gray-500">Loading…</td></tr></tbody>
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
