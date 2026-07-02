import { createSignal, For, Show } from "solid-js";
import Swal from "sweetalert2";
import Modal, { Field, fieldClass } from "./Modal";
import { createComplaint } from "../../services/worklog";
import { CATEGORY_OPTIONS, SEVERITY_OPTIONS } from "./worklogTokens";

// ─── Log complaint modal ──────────────────────────────────────────────────────
// The mock's "Log complaint" flow. raised_by is stamped server-side.
// Props: clientNomen, clientName?, onClose, onCreated(complaint).
export default function LogComplaintModal(props) {
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [category, setCategory] = createSignal("lead_quality");
  const [severity, setSeverity] = createSignal("medium");
  const [project, setProject] = createSignal("");
  const [slaDue, setSlaDue] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!title().trim()) {
      setError("A title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createComplaint({
        clientNomen: props.clientNomen,
        title: title().trim(),
        description: description().trim() || undefined,
        category: category(),
        severity: severity(),
        project: project().trim() ? project().trim() : undefined,
        slaDue: slaDue() || undefined,
      });
      Swal.fire({
        icon: "success",
        title: "Complaint logged",
        toast: true,
        position: "top-end",
        timer: 2500,
        showConfirmButton: false,
      });
      props.onCreated?.(created);
      props.onClose?.();
    } catch (err) {
      setError(err?.message || "Couldn't log the complaint. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Log complaint"
      subtitle={props.clientName ? `For ${props.clientName}` : undefined}
      onClose={props.onClose}
    >
      <form onSubmit={submit}>
        <Field label="Title" required>
          <input
            type="text"
            class={fieldClass}
            placeholder="Short summary of the issue"
            value={title()}
            onInput={(e) => setTitle(e.target.value)}
            autofocus
          />
        </Field>

        <Field label="Description">
          <textarea
            rows={3}
            class={fieldClass}
            placeholder="What happened, and what does the client expect?"
            value={description()}
            onInput={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div class="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select
              class={fieldClass}
              value={category()}
              onChange={(e) => setCategory(e.target.value)}
            >
              <For each={CATEGORY_OPTIONS}>
                {(o) => <option value={o.value}>{o.label}</option>}
              </For>
            </select>
          </Field>
          <Field label="Severity">
            <select
              class={fieldClass}
              value={severity()}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <For each={SEVERITY_OPTIONS}>
                {(o) => <option value={o.value}>{o.label}</option>}
              </For>
            </select>
          </Field>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <Field label="Project (optional)">
            <input
              type="text"
              class={fieldClass}
              placeholder="Project id"
              value={project()}
              onInput={(e) => setProject(e.target.value)}
            />
          </Field>
          <Field label="SLA due (optional)">
            <input
              type="date"
              class={fieldClass}
              value={slaDue()}
              onInput={(e) => setSlaDue(e.target.value)}
            />
          </Field>
        </div>

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
            {saving() ? "Logging…" : "Log complaint"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
