import { createSignal, createResource, For, Show } from "solid-js";
import Swal from "sweetalert2";
import Modal, { Field, fieldClass } from "./Modal";
import { createTask } from "../../services/worklog";
import { fetchTeamMembers } from "../../services/cm";
import { currentUser } from "../../stores/currentUser";
import { PRIORITY_OPTIONS } from "./worklogTokens";

// ─── Assign task modal ────────────────────────────────────────────────────────
// The mock's "assign task" flow. assigned_by is stamped server-side. When
// sourceComplaint is set the task links back to the complaint it resolves
// ("resolving a complaint is a task").
// Props: clientNomen, clientName?, sourceComplaint?, defaultTitle?, onClose,
//        onCreated(task).
export default function AssignTaskModal(props) {
  const [title, setTitle] = createSignal(props.defaultTitle ?? "");
  const [description, setDescription] = createSignal("");
  // assigned_to is a user FK — we submit the integer user_id (email is label only).
  const [assignedTo, setAssignedTo] = createSignal(
    currentUser.id != null ? String(currentUser.id) : "",
  );
  const [priority, setPriority] = createSignal("medium");
  const [dueDate, setDueDate] = createSignal("");
  const [project, setProject] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal(null);

  // Assignee suggestions — team members if this user can list them. Non-blocking;
  // the field is a free-text email so a failed/empty fetch never blocks assigning.
  const [members] = createResource(async () => {
    try {
      const res = await fetchTeamMembers();
      return Array.isArray(res?.data) ? res.data : [];
    } catch {
      return [];
    }
  });

  // Assignable people: { id: "<user_id>", label: "<email>" }. Current user first
  // (so "me" is always available even when team-members can't be listed).
  const assignees = () => {
    const seen = new Set();
    const out = [];
    const add = (id, label) => {
      if (id == null) return;
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: key, label: label || `User #${key}` });
    };
    add(currentUser.id, currentUser.email ? `Me · ${currentUser.email}` : "Me");
    for (const m of members() ?? []) add(m.user_id, m.email);
    return out;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!title().trim()) {
      setError("A title is required.");
      return;
    }
    if (!assignedTo()) {
      setError("Choose who this is assigned to.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createTask({
        clientNomen: props.clientNomen,
        title: title().trim(),
        description: description().trim() || undefined,
        assignedTo: Number(assignedTo()), // user_id (FK), not email
        priority: priority(),
        project: project().trim() ? project().trim() : undefined,
        dueDate: dueDate() || undefined,
        sourceComplaint: props.sourceComplaint ?? undefined,
      });
      Swal.fire({
        icon: "success",
        title: "Task assigned",
        toast: true,
        position: "top-end",
        timer: 2500,
        showConfirmButton: false,
      });
      props.onCreated?.(created);
      props.onClose?.();
    } catch (err) {
      setError(err?.message || "Couldn't assign the task. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={props.sourceComplaint ? "Resolve as task" : "Assign task"}
      subtitle={
        props.sourceComplaint
          ? "This task links back to the complaint it resolves."
          : props.clientName
            ? `For ${props.clientName}`
            : undefined
      }
      onClose={props.onClose}
    >
      <form onSubmit={submit}>
        <Field label="Title" required>
          <input
            type="text"
            class={fieldClass}
            placeholder="What needs doing"
            value={title()}
            onInput={(e) => setTitle(e.target.value)}
            autofocus
          />
        </Field>

        <Field label="Description">
          <textarea
            rows={3}
            class={fieldClass}
            placeholder="Any detail the assignee needs"
            value={description()}
            onInput={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field label="Assign to" required>
          <select
            class={fieldClass}
            value={assignedTo()}
            onChange={(e) => setAssignedTo(e.target.value)}
          >
            <Show when={assignees().length === 0}>
              <option value="">Loading…</option>
            </Show>
            <For each={assignees()}>
              {(a) => <option value={a.id}>{a.label}</option>}
            </For>
          </select>
          <Show when={currentUser.id != null}>
            <button
              type="button"
              onClick={() => setAssignedTo(String(currentUser.id))}
              class="mt-1.5 text-xs font-semibold text-[#3E6FB0] dark:text-blue-300 hover:underline"
            >
              Assign to me
            </button>
          </Show>
        </Field>

        <div class="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <select
              class={fieldClass}
              value={priority()}
              onChange={(e) => setPriority(e.target.value)}
            >
              <For each={PRIORITY_OPTIONS}>
                {(o) => <option value={o.value}>{o.label}</option>}
              </For>
            </select>
          </Field>
          <Field label="Due date (optional)">
            <input
              type="date"
              class={fieldClass}
              value={dueDate()}
              onInput={(e) => setDueDate(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Project (optional)">
          <input
            type="text"
            class={fieldClass}
            placeholder="Project id"
            value={project()}
            onInput={(e) => setProject(e.target.value)}
          />
        </Field>

        <Show when={error()}>
          <p class="text-sm text-[#AC2334] dark:text-red-400 mb-3">{error()}</p>
        </Show>

        <div class="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={props.onClose}
            class="px-4 py-2 text-sm font-semibold rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-[#54657E] dark:text-gray-300 hover:bg-[#F1F4F9] dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving()}
            class="px-4 py-2 text-sm font-bold rounded-lg bg-[#AC2334] text-white hover:bg-[#951d2c] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving() ? "Assigning…" : "Assign task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
