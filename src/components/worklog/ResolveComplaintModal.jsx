import { createSignal, Show } from "solid-js";
import Swal from "sweetalert2";
import Modal, { Field, fieldClass } from "./Modal";
import { resolveComplaint } from "../../services/worklog";

// ─── Resolve complaint modal ──────────────────────────────────────────────────
// POST /worklog/complaints/{id}/resolve/ with { resolution }.
// Props: complaint, onClose, onResolved(complaint).
export default function ResolveComplaintModal(props) {
  const [resolution, setResolution] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!resolution().trim()) {
      setError("Describe how this was resolved.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await resolveComplaint(props.complaint.id, resolution().trim());
      Swal.fire({
        icon: "success",
        title: "Complaint resolved",
        toast: true,
        position: "top-end",
        timer: 2500,
        showConfirmButton: false,
      });
      props.onResolved?.(updated);
      props.onClose?.();
    } catch (err) {
      setError(err?.message || "Couldn't resolve the complaint. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Resolve complaint"
      subtitle={props.complaint?.title}
      onClose={props.onClose}
    >
      <form onSubmit={submit}>
        <Show when={props.complaint?.openTaskCount > 0}>
          <div class="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/15 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {props.complaint.openTaskCount} linked task
            {props.complaint.openTaskCount !== 1 ? "s are" : " is"} still open.
            Resolving here won't close them.
          </div>
        </Show>

        <Field label="Resolution" required>
          <textarea
            rows={4}
            class={fieldClass}
            placeholder="What was done to resolve this complaint?"
            value={resolution()}
            onInput={(e) => setResolution(e.target.value)}
            autofocus
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
            class="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving() ? "Resolving…" : "Mark resolved"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
