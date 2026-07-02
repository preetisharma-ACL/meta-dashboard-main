import { createSignal, createResource, For, Show } from "solid-js";
import Swal from "sweetalert2";
import Modal, { Field, fieldClass } from "./Modal";
import { updateComplaint } from "../../services/worklog";
import { fetchTeamMembers } from "../../services/cm";
import { currentUser } from "../../stores/currentUser";
import {
  SEVERITY_OPTIONS,
  COMPLAINT_STATUS_OPTIONS,
  CATEGORY_LABEL,
  STATUS_CHIP,
  LEVEL_CHIP,
  humanize,
  fmtDate,
  fmtDateTime,
} from "./worklogTokens";

// ─── Complaint detail modal ───────────────────────────────────────────────────
// Inline status / severity / owner edits PATCH straight through; resolving and
// "resolve as a task" bubble up to the parent so only one overlay is ever open.
// Props: complaint, clientName?, onClose, onChanged(updated),
//        onRequestResolve(complaint), onRequestTask(complaint).
export default function ComplaintDetailModal(props) {
  const [c, setC] = createSignal(props.complaint);
  // owner is a user FK — we submit the integer user_id (email is label only).
  const [owner, setOwner] = createSignal(
    props.complaint?.owner != null ? String(props.complaint.owner) : "",
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(null);

  const [members] = createResource(async () => {
    try {
      const res = await fetchTeamMembers();
      return Array.isArray(res?.data) ? res.data : [];
    } catch {
      return [];
    }
  });

  // Owner options: Unassigned + current user + team members, keyed by user_id.
  // The complaint's existing owner is kept as an option even if not listed, so
  // it stays selected.
  const ownerOptions = () => {
    const seen = new Set();
    const out = [{ id: "", label: "Unassigned" }];
    const add = (id, label) => {
      if (id == null) return;
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: key, label: label || `User #${key}` });
    };
    add(currentUser.id, currentUser.email ? `Me · ${currentUser.email}` : "Me");
    for (const m of members() ?? []) add(m.user_id, m.email);
    if (c().owner != null) add(c().owner, `User #${c().owner}`);
    return out;
  };

  const patch = async (changes) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateComplaint(c().id, changes);
      if (updated) {
        setC(updated);
        setOwner(updated.owner ?? "");
        props.onChanged?.(updated);
      }
    } catch (err) {
      setError(err?.message || "Update failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveOwner = async () => {
    const next = owner() ? Number(owner()) : null;
    const current = c().owner != null ? Number(c().owner) : null;
    if (next === current) return;
    await patch({ owner: next });
    if (!error())
      Swal.fire({
        icon: "success",
        title: "Owner updated",
        toast: true,
        position: "top-end",
        timer: 2000,
        showConfirmButton: false,
      });
  };

  const resolved = () => c().status === "resolved" || c().status === "closed";

  return (
    <Modal
      title={c().title}
      subtitle={props.clientName ? `Complaint · ${props.clientName}` : "Complaint"}
      maxWidth="max-w-lg"
      onClose={props.onClose}
    >
      {/* Status + severity + open tasks */}
      <div class="flex items-center gap-2 flex-wrap mb-4">
        <span
          class={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${STATUS_CHIP[c().status] ?? STATUS_CHIP.open}`}
        >
          {humanize(c().status)}
        </span>
        <Show when={c().severity}>
          <span
            class={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${LEVEL_CHIP[c().severity] ?? LEVEL_CHIP.low}`}
          >
            {c().severity}
          </span>
        </Show>
        <Show when={c().category}>
          <span class="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {CATEGORY_LABEL[c().category] ?? humanize(c().category)}
          </span>
        </Show>
        <Show when={c().openTaskCount > 0}>
          <span class="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {c().openTaskCount} open task{c().openTaskCount !== 1 ? "s" : ""}
          </span>
        </Show>
      </div>

      <Show when={c().description}>
        <p class="text-sm text-[#54657E] dark:text-gray-300 leading-relaxed mb-4 whitespace-pre-wrap">
          {c().description}
        </p>
      </Show>

      {/* Meta grid */}
      <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-5 text-[#54657E] dark:text-gray-400">
        <div>
          <span class="font-bold uppercase tracking-wide text-[#8593A8]">Raised by</span>
          <p class="text-[#14233A] dark:text-gray-200">{c().raisedBy ?? "—"}</p>
        </div>
        <div>
          <span class="font-bold uppercase tracking-wide text-[#8593A8]">SLA due</span>
          <p class="text-[#14233A] dark:text-gray-200">{fmtDate(c().slaDue)}</p>
        </div>
        <div>
          <span class="font-bold uppercase tracking-wide text-[#8593A8]">Raised</span>
          <p class="text-[#14233A] dark:text-gray-200">{fmtDateTime(c().createdAt)}</p>
        </div>
        <Show when={resolved()}>
          <div>
            <span class="font-bold uppercase tracking-wide text-[#8593A8]">Resolved</span>
            <p class="text-[#14233A] dark:text-gray-200">{fmtDateTime(c().resolvedAt)}</p>
          </div>
        </Show>
      </div>

      <Show when={c().resolution}>
        <div class="mb-5 rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/15 px-3 py-2">
          <p class="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 mb-0.5">
            Resolution
          </p>
          <p class="text-sm text-[#14233A] dark:text-gray-200 whitespace-pre-wrap">
            {c().resolution}
          </p>
        </div>
      </Show>

      {/* Editable controls */}
      <div class="grid grid-cols-2 gap-3">
        <Field label="Status">
          <select
            class={fieldClass}
            value={c().status}
            disabled={busy()}
            onChange={(e) => patch({ status: e.target.value })}
          >
            <For each={COMPLAINT_STATUS_OPTIONS}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </select>
        </Field>
        <Field label="Severity">
          <select
            class={fieldClass}
            value={c().severity ?? ""}
            disabled={busy()}
            onChange={(e) => patch({ severity: e.target.value })}
          >
            <For each={SEVERITY_OPTIONS}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </select>
        </Field>
      </div>

      <Field label="Owner">
        <div class="flex gap-2">
          <select
            class={fieldClass}
            value={owner()}
            disabled={busy()}
            onChange={(e) => setOwner(e.target.value)}
          >
            <For each={ownerOptions()}>
              {(o) => <option value={o.id}>{o.label}</option>}
            </For>
          </select>
          <button
            type="button"
            onClick={saveOwner}
            disabled={busy()}
            class="px-3 py-2 text-sm font-semibold rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-[#54657E] dark:text-gray-300 hover:bg-[#F1F4F9] dark:hover:bg-gray-800 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </Field>

      <Show when={error()}>
        <p class="text-sm text-[#AC2334] dark:text-red-400 mb-3">{error()}</p>
      </Show>

      {/* Actions */}
      <div class="flex flex-wrap justify-end gap-2 pt-2 border-t border-[#E2E8F1] dark:border-gray-800 mt-2">
        <button
          type="button"
          onClick={() => props.onRequestTask?.(c())}
          class="px-4 py-2 text-sm font-bold rounded-lg border border-[#3E6FB0]/40 text-[#3E6FB0] dark:text-blue-300 hover:bg-[#ECF2FA] dark:hover:bg-blue-900/20"
        >
          Resolve as task
        </button>
        <Show when={!resolved()}>
          <button
            type="button"
            onClick={() => props.onRequestResolve?.(c())}
            class="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Mark resolved
          </button>
        </Show>
      </div>
    </Modal>
  );
}
