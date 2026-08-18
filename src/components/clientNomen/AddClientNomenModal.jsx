import { createSignal, createMemo, Show } from "solid-js";
import { createClientNomen } from "../../pages/admin/services/clientNomen";
import { collectFieldErrors, errorBanner } from "../../utils/apiErrors";

// ─── Add Client Nomenclature ──────────────────────────────────────────────────
// One field, one POST. Creates a nomenclature with NO login attached — the
// client user is bound to it later in the onboarding wizard, which is why this
// form asks for nothing but the name.
//
// The backend stays the authority on every rule (uniqueness, the "|" ban, who
// may write at all); its wording is surfaced verbatim rather than paraphrased.
// The two checks done here first are only the ones we can answer without a
// round trip: an empty name, and a name already in the loaded list.
//
// Props: open, onClose(), onCreated(nomen)?, existing (array of {id,name})

const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 " +
  "bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-100 " +
  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none " +
  "disabled:opacity-50 transition";

const FIELD_BAD = "border-[#AC2334] ring-2 ring-[#AC2334]/30";

const LABEL =
  "block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5";

export default function AddClientNomenModal(props) {
  const [name, setName] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [nameError, setNameError] = createSignal(null);
  const [formError, setFormError] = createSignal(null);

  const trimmed = () => name().trim();

  // Case-insensitive hit in the already-loaded list. The list is fetched whole
  // by useClientNomen(), so this is a complete check — not a sample.
  const duplicate = createMemo(() => {
    const q = trimmed().toLowerCase();
    if (!q) return null;
    return (props.existing ?? []).find(
      (n) => String(n.name ?? "").trim().toLowerCase() === q,
    );
  });

  const reset = () => {
    setName("");
    setNameError(null);
    setFormError(null);
  };

  const close = () => {
    if (submitting()) return;
    reset();
    props.onClose?.();
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setNameError(null);
    setFormError(null);

    const value = trimmed();
    if (!value) {
      setNameError("Enter a nomenclature name.");
      return;
    }
    // Mirrors the onboarding wizard: "|" is the nomenclature separator, so a
    // name containing it is rejected by the backend anyway.
    if (value.includes("|")) {
      setNameError("A nomenclature name can't contain “|”.");
      return;
    }
    if (duplicate()) {
      setNameError(
        `“${duplicate().name}” already exists (#${duplicate().id}).`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const created = await createClientNomen(value);
      reset();
      props.onClose?.();
      props.onCreated?.(created ?? { name: value });
    } catch (err) {
      const pinned = collectFieldErrors(err);
      const detail = errorBanner(
        err,
        pinned,
        "Could not create the nomenclature.",
      );

      if (pinned.name) {
        setNameError(pinned.name);
      } else if (err?.status === 403) {
        setFormError(
          detail ||
            "You don't have permission to create client nomenclatures.",
        );
      } else {
        setFormError(detail);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          onClick={close}
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          aria-hidden="true"
        />

        <form
          role="dialog"
          aria-modal="true"
          aria-label="Add client nomenclature"
          onSubmit={handleSubmit}
          class="relative z-10 w-full max-w-md rounded-2xl bg-white dark:bg-gray-900
                 border border-[#E2E8F1] dark:border-gray-700 shadow-2xl"
        >
          {/* Header */}
          <div class="flex items-start justify-between px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 rounded-t-2xl">
            <div>
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
                Add Client Nomenclature
              </h2>
              <p class="text-sm text-[#54657E] dark:text-gray-400">
                Creates the name only — a login is attached later in onboarding
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              class="w-8 h-8 rounded-full flex items-center justify-center text-[#54657E] hover:bg-[#E2E8F1] dark:hover:bg-gray-700 transition"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div class="px-6 py-5 space-y-4">
            <Show when={formError()}>
              <div
                role="alert"
                class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
              >
                {formError()}
              </div>
            </Show>

            <div>
              <label class={LABEL} for="nomen-name">
                Nomenclature name
              </label>
              <input
                id="nomen-name"
                type="text"
                autocomplete="off"
                value={name()}
                disabled={submitting()}
                placeholder="e.g. Sunrise Realty"
                onInput={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                class={`${FIELD} ${nameError() ? FIELD_BAD : ""}`}
              />
              <Show
                when={nameError()}
                fallback={
                  <p class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-500">
                    Must be unique. It shows up as an unassigned nomen in the
                    onboarding wizard until a client login is created for it.
                  </p>
                }
              >
                <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-300">
                  {nameError()}
                </p>
              </Show>
            </div>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700">
            <button
              type="button"
              onClick={close}
              disabled={submitting()}
              class="px-4 h-9 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                     bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200
                     hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting() || !trimmed()}
              class="px-4 h-9 text-sm font-medium rounded-lg bg-red-800 border border-red-800 text-white
                     hover:bg-red-700 disabled:opacity-40 disabled:cursor-default transition-colors"
            >
              {submitting() ? "Creating…" : "Create Nomenclature"}
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
}
