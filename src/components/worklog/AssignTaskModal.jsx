import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import Swal from "sweetalert2";
import Modal, { Field, fieldClass } from "./Modal";
import { createTask, fetchAssignableUsers } from "../../services/worklog";
import { currentUser } from "../../stores/currentUser";
import { PRIORITY_OPTIONS } from "./worklogTokens";
import ClientPicker from "./ClientPicker";

// ─── Assign task modal ────────────────────────────────────────────────────────
// The mock's "assign task" flow. assigned_by is stamped server-side. When
// sourceComplaint is set the task links back to the complaint it resolves
// ("resolving a complaint is a task"). When opened outside a client workspace
// (no clientNomen prop — e.g. from My Work), a client picker is shown.
// Props: clientNomen?, clientName?, sourceComplaint?, defaultTitle?, onClose,
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

  // Client picker — only when the modal isn't already scoped to a client.
  const needsClientPicker = () => props.clientNomen == null;
  const [pickedClient, setPickedClient] = createSignal("");
  const effectiveClientNomen = () =>
    props.clientNomen != null
      ? props.clientNomen
      : pickedClient()
        ? Number(pickedClient())
        : null;

  // Assignable users — every active CM plus the requesting user (is_self). Value
  // is user_id (Task.assigned_to). Non-blocking: a failed/empty fetch still lets
  // the user assign to themselves.
  const [users] = createResource(async () => {
    try {
      return await fetchAssignableUsers();
    } catch {
      return [];
    }
  });

  // { id: "<user_id>", label }. Self pinned to the top and rendered "Me · email";
  // current user is always present even if the endpoint omitted them.
  const assignees = createMemo(() => {
    const seen = new Set();
    const out = [];
    const add = (id, label, isSelf) => {
      if (id == null) return;
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: key, label: label || `User #${key}`, isSelf: !!isSelf });
    };
    for (const u of users() ?? []) {
      add(
        u.userId,
        u.isSelf ? `Me · ${u.email || u.name}` : u.name || u.email,
        u.isSelf,
      );
    }
    if (currentUser.id != null) {
      add(
        currentUser.id,
        currentUser.email ? `Me · ${currentUser.email}` : "Me",
        true,
      );
    }
    out.sort((a, b) => (a.isSelf === b.isSelf ? 0 : a.isSelf ? -1 : 1));
    return out;
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!title().trim()) {
      setError("A title is required.");
      return;
    }
    if (needsClientPicker() && !effectiveClientNomen()) {
      setError("Choose a client for this task.");
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
        clientNomen: effectiveClientNomen(),
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
        <div class="form">
          <Show when={needsClientPicker()}>
            <Field label="Client" required>
              <ClientPicker value={pickedClient()} onChange={setPickedClient} />
            </Field>
          </Show>

          <Field label="Task title" required>
            <input
              type="text"
              placeholder="e.g. Refresh the audience on the lead campaign"
              value={title()}
              onInput={(e) => setTitle(e.target.value)}
              autofocus
            />
          </Field>

          <Field label="Details">
            <textarea
              rows={3}
              placeholder="What needs to be done, and any context"
              value={description()}
              onInput={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div class="grid2">
            <Field label="Assign to" required>
              <select
                value={assignedTo()}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                <Show when={assignees().length === 0}>
                  <option value="">{users.loading ? "Loading…" : "No one to assign"}</option>
                </Show>
                <For each={assignees()}>
                  {(a) => <option value={a.id}>{a.label}</option>}
                </For>
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={priority()}
                onChange={(e) => setPriority(e.target.value)}
              >
                <For each={PRIORITY_OPTIONS}>
                  {(o) => <option value={o.value}>{o.label}</option>}
                </For>
              </select>
            </Field>
          </div>

          <div class="grid2">
            <Field label="Due date">
              <input
                type="date"
                value={dueDate()}
                onInput={(e) => setDueDate(e.target.value)}
              />
            </Field>
            <Field label="Project (optional)">
              <input
                type="text"
                placeholder="Project id"
                value={project()}
                onInput={(e) => setProject(e.target.value)}
              />
            </Field>
          </div>

          <Show when={currentUser.id != null}>
            <button
              type="button"
              onClick={() => setAssignedTo(String(currentUser.id))}
              style="background:none;border:none;padding:0;color:var(--blue);font-size:12px;font-weight:600"
            >
              Assign to me
            </button>
          </Show>

          <Show when={error()}>
            <p class="form-error">{error()}</p>
          </Show>
        </div>

        <div class="modal-foot">
          <button type="button" class="btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn-primary" disabled={saving()}>
            {saving() ? "Assigning…" : "Assign task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
