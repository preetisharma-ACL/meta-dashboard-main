import { createSignal, For, Show } from "solid-js";
import Swal from "sweetalert2";
import Modal, { Field, fieldClass } from "./Modal";
import { createComplaint } from "../../services/worklog";
import { CATEGORY_OPTIONS, SEVERITY_OPTIONS } from "./worklogTokens";
import ClientPicker from "./ClientPicker";

// ─── Log complaint modal ──────────────────────────────────────────────────────
// The mock's "Log complaint" flow. raised_by is stamped server-side. When opened
// outside a client workspace (no clientNomen prop — e.g. from My Work), a client
// picker is shown.
// Props: clientNomen?, clientName?, onClose, onCreated(complaint).
export default function LogComplaintModal(props) {
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [category, setCategory] = createSignal("lead_quality");
  const [severity, setSeverity] = createSignal("medium");
  const [project, setProject] = createSignal("");
  const [slaDue, setSlaDue] = createSignal("");
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

  const submit = async (e) => {
    e.preventDefault();
    if (!title().trim()) {
      setError("A title is required.");
      return;
    }
    if (needsClientPicker() && !effectiveClientNomen()) {
      setError("Choose a client for this complaint.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createComplaint({
        clientNomen: effectiveClientNomen(),
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
      brand={props.brand}
      title="Log complaint"
      subtitle={
        props.clientName
          ? `For ${props.clientName}`
          : "Record an issue the client raised. It joins the work queue and the client's Activity history."
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

          <Field label="Subject" required>
            <input
              type="text"
              placeholder="e.g. Lead quality below target this week"
              value={title()}
              onInput={(e) => setTitle(e.target.value)}
              autofocus
            />
          </Field>

          <div class="grid2">
            <Field label="Category">
              <select
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
                value={severity()}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <For each={SEVERITY_OPTIONS}>
                  {(o) => <option value={o.value}>{o.label}</option>}
                </For>
              </select>
            </Field>
          </div>

          <Field label="Details">
            <textarea
              rows={3}
              placeholder="What the client reported"
              value={description()}
              onInput={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div class="grid2">
            <Field label="Project (optional)">
              <input
                type="text"
                placeholder="Project id"
                value={project()}
                onInput={(e) => setProject(e.target.value)}
              />
            </Field>
            <Field label="SLA due (optional)">
              <input
                type="date"
                value={slaDue()}
                onInput={(e) => setSlaDue(e.target.value)}
              />
            </Field>
          </div>

          <Show when={error()}>
            <p class="form-error">{error()}</p>
          </Show>
        </div>

        <div class="modal-foot">
          <button type="button" class="btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn-primary" disabled={saving()}>
            {saving() ? "Logging…" : "Log complaint"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
