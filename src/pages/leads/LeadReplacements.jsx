import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import {
  fetchReplacementBatches,
  revokeReplacementBatch,
  fetchReplacementAuditLog,
} from "../../services/leadReplacement";
import {
  canRecordReplacement,
  canRevokeReplacement,
} from "../../stores/currentUser";
import RecordReplacementModal from "../../components/leads/RecordReplacementModal";
import RowsPerPageSelect from "../../components/common/RowsPerPageSelect";
import SuccessToast, { showToast } from "../../components/common/SuccessToast";

// ─── Lead Replacements ────────────────────────────────────────────────────────
// The record + audit surface for lead-replacement batches.
//   • Record  — admin and TIER-1 CMs (canRecordReplacement)
//   • List    — whatever the server scopes to the caller (admin: all;
//               CM: own + team). We never filter rows by role on the frontend.
//   • Revoke + audit log — admin only (canRevokeReplacement); the endpoints
//               403 anyone else, so the controls simply aren't rendered.
//
// FIELD-NAME DISCIPLINE: every read goes through first(), so a renamed/absent
// key renders "—" rather than a confident 0 or a blank money column.

const first = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(String(v).includes("T") ? v : `${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const fmtMoney = (v) =>
  v == null || v === ""
    ? "—"
    : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const normalise = (r = {}) => ({
  id: first(r, ["id", "batch_id"]),
  clientName: first(r, [
    "target_client_nomen",
    "target_client_nomen_name",
    "client_nomen_name",
    "client_name",
  ]),
  clientEmail: first(r, ["target_client_email", "client_email", "email"]),
  projectName: first(r, ["project_name", "project"]),
  replacedCount: first(r, ["replaced_count", "replaced_leads", "count"]),
  replacedCost: first(r, ["replaced_cost", "total_cost", "cost"]),
  receivedDate: first(r, ["received_date", "date"]),
  reason: first(r, ["reason", "notes", "note"]),
  // A user id would print as a bare integer in a person column, so the *_name /
  // *_email keys are the only ones read here.
  recordedBy: first(r, [
    "created_by_name",
    "created_by_email",
    "recorded_by_name",
    "recorded_by_email",
    "uploaded_by_email",
  ]),
  createdAt: first(r, ["created_at", "uploaded_at"]),
  isRevoked: r.is_revoked === true,
  revokeReason: first(r, ["revoke_reason", "revoked_reason"]),
  raw: r,
});

export default function LeadReplacements() {
  const [rows, setRows] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [search, setSearch] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all"); // all | active | revoked

  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(
    Number(localStorage.getItem("leadReplacementsRowsPerPage")) || 20,
  );
  const [totalPages, setTotalPages] = createSignal(1);
  const [total, setTotal] = createSignal(0);
  const [hasNext, setHasNext] = createSignal(false);
  const [hasPrev, setHasPrev] = createSignal(false);

  const [showForm, setShowForm] = createSignal(false);

  // Revoke + audit-log state (admin only).
  const [revokeTarget, setRevokeTarget] = createSignal(null);
  const [revokeReason, setRevokeReason] = createSignal("");
  const [revoking, setRevoking] = createSignal(false);
  const [revokeError, setRevokeError] = createSignal(null);

  const [auditFor, setAuditFor] = createSignal(null);
  const [auditRows, setAuditRows] = createSignal([]);
  const [auditLoading, setAuditLoading] = createSignal(false);
  const [auditError, setAuditError] = createSignal(null);

  const load = async (pageNum = page(), size = pageSize()) => {
    try {
      setLoading(true);
      setError(null);
      const { rows: raw, pagination } = await fetchReplacementBatches({
        page: pageNum,
        pageSize: size,
      });
      setRows(raw.map(normalise));
      setPage(pageNum);
      setTotalPages(pagination?.total_pages ?? 1);
      setTotal(pagination?.total ?? raw.length);
      setHasNext(pagination?.has_next ?? false);
      setHasPrev(pagination?.has_prev ?? false);
    } catch (err) {
      console.error("LeadReplacements: load failed", err);
      setError(err?.message || "Could not load replacement batches.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => load(1));

  const changeRowsPerPage = (size) => {
    if (size === pageSize()) return;
    setPageSize(size);
    localStorage.setItem("leadReplacementsRowsPerPage", String(size));
    load(1, size);
  };

  const filtered = createMemo(() => {
    let data = rows();
    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter((r) =>
        [r.clientName, r.clientEmail, r.projectName, r.reason, r.recordedBy]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (statusFilter() === "active") data = data.filter((r) => !r.isRevoked);
    if (statusFilter() === "revoked") data = data.filter((r) => r.isRevoked);
    return data;
  });

  // Roll-up across the rows currently in view.
  const totals = createMemo(() => {
    const live = filtered().filter((r) => !r.isRevoked);
    return {
      batches: live.length,
      leads: live.reduce((s, r) => s + (Number(r.replacedCount) || 0), 0),
      credited: live.reduce((s, r) => s + (Number(r.replacedCost) || 0), 0),
    };
  });

  const doRevoke = async () => {
    const target = revokeTarget();
    if (!target) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeReplacementBatch(target.id, revokeReason());
      setRevokeTarget(null);
      setRevokeReason("");
      await load(page());
      showToast(
        `Batch #${target.id} revoked — the credit has been reversed.`,
        "Replacement revoked",
      );
    } catch (err) {
      setRevokeError(err?.message || "Could not revoke this batch.");
    } finally {
      setRevoking(false);
    }
  };

  const openAudit = async (row) => {
    setAuditFor(row);
    setAuditRows([]);
    setAuditError(null);
    setAuditLoading(true);
    try {
      setAuditRows(await fetchReplacementAuditLog(row.id));
    } catch (err) {
      setAuditError(err?.message || "Could not load the audit log.");
    } finally {
      setAuditLoading(false);
    }
  };

  const TH = "p-3 text-left text-xs font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-400";

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 lg:p-8">
      {/* Header */}
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-[#14233A] dark:text-white">
            Lead Replacements
          </h1>
          <p class="text-sm text-[#54657E] dark:text-gray-400 mt-0.5">
            Leads credited back to CPL and hybrid clients. Billable leads =
            generated − replaced.
          </p>
        </div>
        <Show when={canRecordReplacement()}>
          <button
            onClick={() => setShowForm(true)}
            class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white text-sm font-semibold hover:bg-[#93192a] transition shadow-sm"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Record Replacement
          </button>
        </Show>
      </div>

      {/* Roll-up */}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <For
          each={[
            { label: "Active batches", value: totals().batches.toLocaleString("en-IN") },
            { label: "Leads replaced", value: totals().leads.toLocaleString("en-IN") },
            { label: "Amount credited", value: fmtMoney(totals().credited) },
          ]}
        >
          {(card) => (
            <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                {card.label}
              </p>
              <p class="mt-1.5 text-2xl font-bold tabular-nums text-[#14233A] dark:text-white">
                {card.value}
              </p>
            </div>
          )}
        </For>
      </div>

      {/* Filters */}
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          placeholder="Search client, project, reason…"
          class="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-sm outline-none focus:ring-2 focus:ring-[#AC2334]/30"
        />
        <div class="flex gap-1.5">
          <For
            each={[
              { id: "all", label: "All" },
              { id: "active", label: "Active" },
              { id: "revoked", label: "Revoked" },
            ]}
          >
            {(f) => (
              <button
                onClick={() => setStatusFilter(f.id)}
                class={`px-3.5 py-2 rounded-full text-sm font-medium border transition ${
                  statusFilter() === f.id
                    ? "bg-[#AC2334] text-white border-[#AC2334]"
                    : "bg-white dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-600 hover:border-[#AC2334]/40"
                }`}
              >
                {f.label}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Table */}
      <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-[#F8FAFC] dark:bg-gray-900/60 border-b border-[#E2E8F1] dark:border-gray-700">
              <tr>
                <th class={TH}>#</th>
                <th class={TH}>Client</th>
                <th class={TH}>Project</th>
                <th class={`${TH} text-right`}>Replaced</th>
                <th class={`${TH} text-right`}>Cost credited</th>
                <th class={TH}>Date</th>
                <th class={TH}>Recorded by</th>
                <th class={TH}>Notes</th>
                <th class={TH}>Status</th>
                <Show when={canRevokeReplacement()}>
                  <th class={`${TH} text-right`}>Actions</th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <Show
                when={!loading()}
                fallback={
                  <tr>
                    <td colspan="10" class="p-8 text-center text-[#54657E] dark:text-gray-400">
                      Loading replacement batches…
                    </td>
                  </tr>
                }
              >
                <Show when={!error()} fallback={
                  <tr>
                    <td colspan="10" class="p-8 text-center">
                      <p class="text-[#AC2334] dark:text-red-400 font-medium">{error()}</p>
                      <button onClick={() => load(1)} class="mt-2 text-sm underline text-[#54657E]">
                        Retry
                      </button>
                    </td>
                  </tr>
                }>
                  <Show
                    when={filtered().length}
                    fallback={
                      <tr>
                        <td colspan="10" class="p-8 text-center text-[#54657E] dark:text-gray-400">
                          No replacement batches recorded yet.
                        </td>
                      </tr>
                    }
                  >
                    <For each={filtered()}>
                      {(r, i) => (
                        <tr
                          class={`border-b border-[#E2E8F1] dark:border-gray-700 last:border-0 ${
                            i() % 2 ? "bg-[#FAFBFD] dark:bg-gray-900/30" : ""
                          } ${r.isRevoked ? "opacity-60" : ""}`}
                        >
                          <td class="p-3 tabular-nums text-[#8593A8]">{r.id ?? "—"}</td>
                          <td class="p-3">
                            <div class="font-medium text-[#14233A] dark:text-gray-100">
                              {r.clientName ?? "—"}
                            </div>
                            <Show when={r.clientEmail}>
                              <div class="text-xs text-[#8593A8]">{r.clientEmail}</div>
                            </Show>
                          </td>
                          <td class="p-3 text-[#54657E] dark:text-gray-300">
                            {r.projectName ?? "—"}
                          </td>
                          <td class="p-3 text-right tabular-nums font-bold text-[#AC2334] dark:text-red-400">
                            {r.replacedCount == null
                              ? "—"
                              : `−${Number(r.replacedCount).toLocaleString("en-IN")}`}
                          </td>
                          <td class="p-3 text-right tabular-nums text-[#14233A] dark:text-gray-100">
                            {fmtMoney(r.replacedCost)}
                          </td>
                          <td class="p-3 text-[#54657E] dark:text-gray-300 whitespace-nowrap">
                            {fmtDate(r.receivedDate ?? r.createdAt)}
                          </td>
                          <td class="p-3 text-[#54657E] dark:text-gray-300">
                            {r.recordedBy ?? "—"}
                          </td>
                          <td class="p-3 text-[#54657E] dark:text-gray-300 max-w-[240px]">
                            <span class="line-clamp-2">{r.reason ?? "—"}</span>
                          </td>
                          <td class="p-3">
                            <Show
                              when={r.isRevoked}
                              fallback={
                                <span class="inline-flex rounded-full bg-[#E9F7F1] dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-bold text-[#15966A] dark:text-green-400">
                                  Active
                                </span>
                              }
                            >
                              <span
                                class="inline-flex rounded-full bg-[#E2E8F1] dark:bg-gray-700 px-2.5 py-0.5 text-xs font-bold text-[#54657E] dark:text-gray-300"
                                title={r.revokeReason || undefined}
                              >
                                Revoked
                              </span>
                            </Show>
                          </td>
                          <Show when={canRevokeReplacement()}>
                            <td class="p-3 text-right whitespace-nowrap">
                              <button
                                onClick={() => openAudit(r)}
                                class="text-xs font-semibold text-[#3E6FB0] hover:underline"
                              >
                                Audit log
                              </button>
                              <Show when={!r.isRevoked}>
                                <button
                                  onClick={() => {
                                    setRevokeTarget(r);
                                    setRevokeReason("");
                                    setRevokeError(null);
                                  }}
                                  class="ml-3 text-xs font-semibold text-[#AC2334] hover:underline"
                                >
                                  Revoke
                                </button>
                              </Show>
                            </td>
                          </Show>
                        </tr>
                      )}
                    </For>
                  </Show>
                </Show>
              </Show>
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-900/40">
          <div class="flex items-center gap-3 text-sm text-[#54657E] dark:text-gray-400">
            <RowsPerPageSelect value={pageSize()} onChange={changeRowsPerPage} />
            <span>
              {total().toLocaleString("en-IN")} batch
              {total() === 1 ? "" : "es"}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              disabled={!hasPrev() || loading()}
              onClick={() => load(page() - 1)}
              class="px-3 py-1.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-sm font-medium disabled:opacity-40"
            >
              Previous
            </button>
            <span class="text-sm text-[#54657E] dark:text-gray-400">
              Page {page()} of {totalPages()}
            </span>
            <button
              disabled={!hasNext() || loading()}
              onClick={() => load(page() + 1)}
              class="px-3 py-1.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-sm font-medium disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Revoke confirmation (admin) ── */}
      <Show when={revokeTarget()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            class="fixed inset-0 bg-black/35 backdrop-blur-sm"
            onClick={() => setRevokeTarget(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            class="relative w-full max-w-md rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-2xl"
          >
            <h3 class="text-lg font-bold text-[#14233A] dark:text-white">
              Revoke batch #{revokeTarget().id}?
            </h3>
            <p class="mt-1 text-sm text-[#54657E] dark:text-gray-400">
              The {Number(revokeTarget().replacedCount || 0).toLocaleString("en-IN")}{" "}
              replaced lead{Number(revokeTarget().replacedCount) === 1 ? "" : "s"} for{" "}
              <b class="text-[#14233A] dark:text-gray-100">
                {revokeTarget().clientName ?? "this client"}
              </b>{" "}
              will go back to being billable.
            </p>
            <label class="block text-sm font-semibold text-[#14233A] dark:text-gray-200 mt-4 mb-1.5">
              Reason
            </label>
            <textarea
              rows="3"
              value={revokeReason()}
              onInput={(e) => setRevokeReason(e.currentTarget.value)}
              placeholder="Why is this replacement being reversed?"
              class="w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-[#AC2334]/30 resize-none"
            />
            <Show when={revokeError()}>
              <p role="alert" class="mt-2 text-sm font-medium text-[#AC2334] dark:text-red-400">
                {revokeError()}
              </p>
            </Show>
            <div class="mt-5 flex gap-3">
              <button
                onClick={() => setRevokeTarget(null)}
                class="flex-1 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 font-semibold text-[#54657E] dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={doRevoke}
                disabled={revoking() || !revokeReason().trim()}
                class="flex-1 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white font-semibold hover:bg-[#93192a] disabled:opacity-40 transition"
              >
                {revoking() ? "Revoking…" : "Revoke"}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* ── Audit log (admin) ── */}
      <Show when={auditFor()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            class="fixed inset-0 bg-black/35 backdrop-blur-sm"
            onClick={() => setAuditFor(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            class="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-2xl"
          >
            <div class="flex items-start justify-between gap-3">
              <h3 class="text-lg font-bold text-[#14233A] dark:text-white">
                Audit log · batch #{auditFor().id}
              </h3>
              <button
                onClick={() => setAuditFor(null)}
                aria-label="Close"
                class="w-8 h-8 rounded-full flex items-center justify-center text-[#54657E] hover:bg-[#E2E8F1] dark:hover:bg-gray-700"
              >
                ✕
              </button>
            </div>
            <Show
              when={!auditLoading()}
              fallback={
                <p class="mt-4 text-sm text-[#54657E] dark:text-gray-400">Loading…</p>
              }
            >
              <Show
                when={!auditError()}
                fallback={
                  <p role="alert" class="mt-4 text-sm font-medium text-[#AC2334]">
                    {auditError()}
                  </p>
                }
              >
                <Show
                  when={auditRows().length}
                  fallback={
                    <p class="mt-4 text-sm text-[#54657E] dark:text-gray-400">
                      No audit entries for this batch.
                    </p>
                  }
                >
                  <ol class="mt-4 space-y-3">
                    <For each={auditRows()}>
                      {(entry) => (
                        <li class="rounded-lg border border-[#E2E8F1] dark:border-gray-700 p-3">
                          <div class="flex flex-wrap items-baseline justify-between gap-2">
                            <span class="text-sm font-semibold text-[#14233A] dark:text-gray-100">
                              {first(entry, ["action", "event", "change", "type"]) ??
                                "Change"}
                            </span>
                            <span class="text-xs text-[#8593A8]">
                              {fmtDate(
                                first(entry, ["timestamp", "created_at", "at", "date"]),
                              )}
                            </span>
                          </div>
                          <p class="mt-1 text-sm text-[#54657E] dark:text-gray-400">
                            {first(entry, [
                              "detail",
                              "details",
                              "message",
                              "description",
                              "notes",
                            ]) ?? "—"}
                          </p>
                          <Show
                            when={first(entry, [
                              "actor_name",
                              "actor_email",
                              "user_name",
                              "user_email",
                              "performed_by_name",
                              "performed_by_email",
                            ])}
                          >
                            {(who) => (
                              <p class="mt-1 text-xs text-[#8593A8]">by {who()}</p>
                            )}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </Show>

      <RecordReplacementModal
        open={showForm()}
        onClose={() => setShowForm(false)}
        onRecorded={(r) => {
          load(1);
          showToast(
            `${r.count} lead${r.count === 1 ? "" : "s"} credited back on "${r.projectName}".`,
            "Replacement recorded",
          );
        }}
      />
      <SuccessToast />
    </div>
  );
}
