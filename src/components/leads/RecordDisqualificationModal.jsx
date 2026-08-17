import {
  createSignal,
  createMemo,
  createResource,
  createEffect,
  For,
  Show,
} from "solid-js";
import {
  createDisqualificationBatch,
  fetchDisqualifiableClients,
} from "../../services/leadDisqualification";
import { fetchProjectsByClient } from "../../pages/admin/services/fetchProjectsByClient";

// ─── Record Disqualification ──────────────────────────────────────────────────
// Slide-over form that records a lead-disqualification batch. Mirrors
// RecordReplacementModal exactly, minus the cost field: a disqualification is
// COUNT ONLY (the leads stop being billable; there is no rupee credit), so
// there is deliberately no money input anywhere on this form.
//
// Rendered ONLY behind canRecordReplacement() (admin + tier-1 CM — the same
// permission gates both lead actions) — every caller gates before mounting
// this, and the backend 403s anyone else regardless.
//
// The three documented backend rejections are surfaced verbatim (the message
// carries the detail — e.g. the max allowed count — and we must not paraphrase
// it away):
//   400 non-CPL client → banner pinned to the client field
//   400 replaced + disqualified > generated → pinned NEXT TO the count field,
//        because that is the field the operator has to fix
//   403 client outside a tier-1 CM's book → pinned to the client field
//
// Props: open, onClose(), onRecorded({count, clientName, projectName, batch})?,
//        clientId? (Client PK to pre-select when it's in the picker's roster)

const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 " +
  "bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-100 " +
  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none " +
  "disabled:opacity-50 transition";

const LABEL =
  "block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5";

// VERIFIED against the live API: this endpoint reports its validation failures
// as a FIELD MAP, not a top-level detail. The over-count guardrail arrives at
//     error.fields.non_field_errors[0]
//     "Replaced + disqualified cannot exceed generated. This project has N
//      generated lead(s); X replaced and Y disqualified already recorded. You
//      can disqualify at most Z more."
// and `message` is only the generic wrapper. Reading message alone would throw
// away the max-allowed count, which is the entire value of that error — so the
// field map is read first and pinned verbatim.
//
// api() surfaces that map two ways depending on the transport: err.fields for a
// 200-envelope failure ({ success:false, error:{ fields } }), and the whole
// parsed body on err.data for an HTTP 4xx. Both are read here.
const fieldErrors = (err) =>
  err?.fields ?? err?.data?.error?.fields ?? err?.data?.fields ?? null;

// DRF gives a list per key; take the first non-empty entry, but tolerate a bare
// string so a shape change degrades to "shown verbatim" rather than "[object]".
const fieldMessage = (fields, key) => {
  const v = fields?.[key];
  if (!v) return null;
  if (Array.isArray(v)) return v.find((s) => typeof s === "string" && s) || null;
  return typeof v === "string" ? v : null;
};

const emptyForm = () => ({
  target_client_id: "",
  project_id: "",
  disqualified_count: "",
  received_date: "",
  notes: "",
});

export default function RecordDisqualificationModal(props) {
  const [form, setForm] = createSignal(emptyForm());
  const [submitting, setSubmitting] = createSignal(false);

  // Errors are split by where they belong on the form, so the operator is
  // pointed at the field to fix rather than a generic banner.
  const [formError, setFormError] = createSignal(null); // unknown failure
  const [clientError, setClientError] = createSignal(null); // non-CPL / out of book
  const [countError, setCountError] = createSignal(null); // exceeds generated

  const [clientQuery, setClientQuery] = createSignal("");
  const [projectQuery, setProjectQuery] = createSignal("");
  const [clientOpen, setClientOpen] = createSignal(false);
  const [projectOpen, setProjectOpen] = createSignal(false);

  const [clients] = createResource(
    () => (props.open ? "load" : null),
    fetchDisqualifiableClients,
  );

  const set = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const reset = () => {
    setForm(emptyForm());
    setClientQuery("");
    setProjectQuery("");
    setClientOpen(false);
    setProjectOpen(false);
    setFormError(null);
    setClientError(null);
    setCountError(null);
    setProjects([]);
  };

  const close = () => {
    reset();
    props.onClose?.();
  };

  // ── Projects for the picked client ────────────────────────────────────────
  const [projects, setProjects] = createSignal([]);
  const [projectsLoading, setProjectsLoading] = createSignal(false);

  const loadProjects = async (clientId) => {
    setProjects([]);
    setProjectQuery("");
    set("project_id", "");
    if (!clientId) return;
    setProjectsLoading(true);
    try {
      setProjects(await fetchProjectsByClient(clientId));
    } catch (err) {
      console.error("RecordDisqualification: failed to load projects", err);
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  // Opening the form from a client's dashboard pre-selects that client, so the
  // common path is two fields instead of four. Only pre-selects once the roster
  // has loaded AND the client is actually in it — a non-CPL client (or one
  // outside the caller's book) isn't offered here, and pre-filling it would
  // hand the operator a form that can only 400.
  createEffect(() => {
    if (!props.open) return;
    const list = clients();
    if (!list || form().target_client_id) return;
    const preset = props.clientId;
    if (preset == null || preset === "") return;
    const match = list.find((c) => String(c.id) === String(preset));
    if (!match) return;
    set("target_client_id", String(match.id));
    setClientQuery(match.name);
    loadProjects(match.id);
  });

  const selectedClient = createMemo(() =>
    (clients() ?? []).find(
      (c) => String(c.id) === String(form().target_client_id),
    ),
  );

  const filteredClients = createMemo(() => {
    const q = clientQuery().trim().toLowerCase();
    const list = clients() ?? [];
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q),
    );
  });

  const filteredProjects = createMemo(() => {
    const q = projectQuery().trim().toLowerCase();
    const list = projects();
    if (!q) return list;
    return list.filter((p) => (p.name || "").toLowerCase().includes(q));
  });

  // ── Local validation (the backend stays the authority) ────────────────────
  const countValue = () => Number(form().disqualified_count);
  const countIsValid = () =>
    Number.isInteger(countValue()) && countValue() >= 1;

  const canSubmit = () =>
    !submitting() &&
    !!form().target_client_id &&
    !!form().project_id &&
    countIsValid();

  const handleSubmit = async () => {
    setFormError(null);
    setClientError(null);
    setCountError(null);

    if (!countIsValid()) {
      setCountError("Disqualified count must be a whole number of 1 or more.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        target_client_id: Number(form().target_client_id),
        project_id: Number(form().project_id),
        disqualified_count: Number(form().disqualified_count),
        notes: form().notes,
      };
      // received_date is optional; the backend defaults to today when omitted.
      // Never send an empty string.
      const day = form().received_date?.trim();
      if (day) payload.received_date = day;

      const res = await createDisqualificationBatch(payload);

      const recorded = {
        count: Number(form().disqualified_count),
        clientName: selectedClient()?.name || clientQuery(),
        projectName:
          projects().find((p) => String(p.id) === String(form().project_id))
            ?.name || projectQuery(),
        batch: res?.data ?? null,
      };
      reset();
      props.onClose?.();
      props.onRecorded?.(recorded);
    } catch (err) {
      // api() lifts `message` off the envelope and attaches the HTTP status.
      // Show the BACKEND's wording — it names the client type and the max
      // allowed count, which is the whole value of these messages.
      const status = err?.status;
      const fields = fieldErrors(err);
      const nonField = fieldMessage(fields, "non_field_errors");
      const countField =
        fieldMessage(fields, "disqualified_count") ??
        fieldMessage(fields, "project_id");
      const clientField = fieldMessage(fields, "target_client_id");
      // The most specific text the server gave us. A field message always beats
      // the generic `message`, and it is never paraphrased on its way to the UI.
      const detail =
        nonField ?? countField ?? clientField ?? err?.message ??
        "Could not record the disqualification.";

      if (clientField) {
        setClientError(clientField);
      } else if (status === 403) {
        // A tier-1 CM picking a client outside their book.
        setClientError(detail);
      } else if (/cpl|client type|retainer|hybrid/i.test(detail)) {
        // The non-CPL rejection is about the CLIENT, so it belongs on that
        // field — checked before the count guard, whose pattern would
        // otherwise swallow a message mentioning both.
        setClientError(detail);
      } else if (countField) {
        setCountError(countField);
      } else if (/disqualif|replac|generated|max|exceed/i.test(detail)) {
        // The over-count guardrail: non_field_errors[0], pinned next to the
        // count because that is the field the operator has to fix.
        setCountError(detail);
      } else {
        setFormError(detail);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex">
        <div
          onClick={close}
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label="Record lead disqualification"
          class="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-gray-900
                 border-l border-[#E2E8F1] dark:border-gray-700 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div class="flex items-start justify-between px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
            <div>
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
                Record Disqualification
              </h2>
              <p class="text-sm text-[#54657E] dark:text-gray-400">
                Mark leads unbillable for a CPL client
              </p>
            </div>
            <button
              onClick={close}
              aria-label="Close"
              class="w-8 h-8 rounded-full flex items-center justify-center text-[#54657E] hover:bg-[#E2E8F1] dark:hover:bg-gray-700 transition"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Show when={formError()}>
              <div
                role="alert"
                class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
              >
                {formError()}
              </div>
            </Show>

            {/* Client */}
            <div>
              <label class={LABEL}>Client</label>
              <div class="relative">
                <input
                  type="text"
                  value={clientQuery()}
                  placeholder={
                    clients.loading
                      ? "Loading clients…"
                      : "Search a CPL client…"
                  }
                  onFocus={() => setClientOpen(true)}
                  onInput={(e) => {
                    setClientQuery(e.target.value);
                    setClientOpen(true);
                  }}
                  onBlur={() => setTimeout(() => setClientOpen(false), 150)}
                  class={FIELD}
                />
                <Show when={clientOpen()}>
                  <div class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                    <Show
                      when={filteredClients().length}
                      fallback={
                        <p class="px-3 py-3 text-sm text-[#8593A8]">
                          No CPL clients match.
                        </p>
                      }
                    >
                      <For each={filteredClients()}>
                        {(c) => (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              set("target_client_id", String(c.id));
                              setClientQuery(c.name);
                              setClientOpen(false);
                              setClientError(null);
                              loadProjects(c.id);
                            }}
                            class="w-full text-left px-3 py-2 hover:bg-[#FBEEF0] dark:hover:bg-gray-800 transition-colors"
                          >
                            <div class="font-medium text-[#14233A] dark:text-gray-100">
                              {c.name}
                            </div>
                            <div class="text-xs text-[#8593A8]">
                              {c.clientType ? c.clientType.toUpperCase() : "—"}
                              {c.email ? ` · ${c.email}` : ""}
                            </div>
                          </button>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              </div>
              <p class="text-xs text-[#8593A8] mt-1">
                Disqualifications apply only to CPL clients.
              </p>
              <Show when={clientError()}>
                <p
                  role="alert"
                  class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                >
                  {clientError()}
                </p>
              </Show>
            </div>

            {/* Project */}
            <div>
              <label class={LABEL}>Project</label>
              <div class="relative">
                <input
                  type="text"
                  disabled={!form().target_client_id || projectsLoading()}
                  value={projectQuery()}
                  placeholder={
                    !form().target_client_id
                      ? "Select a client first…"
                      : projectsLoading()
                        ? "Loading projects…"
                        : "Search a project…"
                  }
                  onFocus={() => setProjectOpen(true)}
                  onInput={(e) => {
                    setProjectQuery(e.target.value);
                    setProjectOpen(true);
                  }}
                  onBlur={() => setTimeout(() => setProjectOpen(false), 150)}
                  class={FIELD}
                />
                <Show when={projectOpen() && form().target_client_id}>
                  <div class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                    <Show
                      when={filteredProjects().length}
                      fallback={
                        <p class="px-3 py-3 text-sm text-[#8593A8]">
                          No projects for this client.
                        </p>
                      }
                    >
                      <For each={filteredProjects()}>
                        {(p) => (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              set("project_id", String(p.id));
                              setProjectQuery(p.name);
                              setProjectOpen(false);
                            }}
                            class="w-full text-left px-3 py-2 text-[#14233A] dark:text-gray-100 hover:bg-[#FBEEF0] dark:hover:bg-gray-800 transition-colors"
                          >
                            {p.name}
                          </button>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>

            {/* Disqualified count — no cost field follows it: a
                disqualification is count-only. */}
            <div>
              <label class={LABEL}>Disqualified leads</label>
              <input
                type="number"
                min="1"
                step="1"
                value={form().disqualified_count}
                onInput={(e) => {
                  set("disqualified_count", e.target.value);
                  setCountError(null);
                }}
                class={`${FIELD} ${
                  countError()
                    ? "border-[#AC2334] focus:border-[#AC2334] ring-1 ring-[#AC2334]/30"
                    : ""
                }`}
                aria-invalid={!!countError()}
              />
              <Show
                when={countError()}
                fallback={
                  <p class="text-xs text-[#8593A8] mt-1">
                    Replaced + disqualified cannot exceed the leads generated
                    for this project.
                  </p>
                }
              >
                <p
                  role="alert"
                  class="mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400"
                >
                  {countError()}
                </p>
              </Show>
            </div>

            {/* Received date */}
            <div>
              <label class={LABEL}>
                Date{" "}
                <span class="font-normal text-[#8593A8]">(optional)</span>
              </label>
              <input
                type="date"
                value={form().received_date}
                onInput={(e) => set("received_date", e.target.value)}
                class={FIELD}
              />
              <p class="text-xs text-[#8593A8] mt-1">
                Leave blank to use today's date.
              </p>
            </div>

            {/* Notes */}
            <div>
              <label class={LABEL}>Notes</label>
              <textarea
                rows="4"
                value={form().notes}
                onInput={(e) => set("notes", e.target.value)}
                placeholder="Why were these leads disqualified?"
                class={`${FIELD} resize-none`}
              />
            </div>
          </div>

          {/* Footer */}
          <div class="px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 flex gap-3">
            <button
              onClick={close}
              class="flex-1 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1]/60 dark:hover:bg-gray-700 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit()}
              class="flex-1 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {submitting() ? "Recording…" : "Record Disqualification"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
