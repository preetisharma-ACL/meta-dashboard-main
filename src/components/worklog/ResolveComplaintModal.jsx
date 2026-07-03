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
        <div class="form">
          <Show when={props.complaint?.openTaskCount > 0}>
            <div class="note-box">
              {props.complaint.openTaskCount} linked task
              {props.complaint.openTaskCount !== 1 ? "s are" : " is"} still open.
              Resolving here won't close them.
            </div>
          </Show>

          <Field label="Resolution" required>
            <textarea
              rows={4}
              placeholder="What was done to resolve this complaint?"
              value={resolution()}
              onInput={(e) => setResolution(e.target.value)}
              autofocus
            />
          </Field>

          <Show when={error()}>
            <p class="form-error">{error()}</p>
          </Show>
        </div>

        <div class="modal-foot">
          <button type="button" class="btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn-primary" disabled={saving()}>
            {saving() ? "Resolving…" : "Mark resolved"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
