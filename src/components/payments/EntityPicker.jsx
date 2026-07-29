import {
  createSignal,
  createResource,
  createMemo,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";
import { fieldClass, labelClass } from "./paymentsFormat";

// ─── Searchable {id, name} picker ─────────────────────────────────────────────
// One combobox serving both payment-form lookups: the CLIENT picker and the
// ORGANIZATION picker. Both are "pick one of a long flat list of {id, name}",
// both are scoped server-side, and both are far too long to scroll — so this is
// generic rather than two near-identical files.
//
// SCOPING IS THE SERVER'S JOB. That's why there's no role prop: /payments/
// clients/ already narrows to the caller's payable set (a CM literally cannot
// see a client outside theirs), and /payments/organizations/ 403s roles that
// may not record payments at all. There is no frontend filtering to do.
//
// props:
//   fetcher()    () => Promise<[{id, name}]>
//   value        id | null          onChange(id | null)
//   label, placeholder, required, disabled, error
//   allowClear   show a "none" option (optional fields)
//   hint         helper text under the control
//   forbiddenMsg / errorMsg  copy for a 403 vs a generic load failure
export default function EntityPicker(props) {
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  let wrapper;

  const [items] = createResource(() => props.fetcher());

  const options = () => items() ?? [];

  const selected = createMemo(
    () =>
      options().find((o) => String(o.id) === String(props.value ?? "")) ?? null,
  );

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return options();
    return options().filter((o) => o.name.toLowerCase().includes(q));
  });

  onMount(() => {
    const onDocClick = (e) => {
      if (wrapper && !wrapper.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  // onChange receives the WHOLE option as a second argument, not just the id.
  // The client option carries organization_id, and the record form needs it to
  // pre-select the org — re-finding the row by id in the caller would mean
  // duplicating this component's fetch. Callers that only want the id ignore
  // the second arg. Clearing passes (null, null).
  const choose = (id, option = null) => {
    props.onChange?.(id, option);
    setOpen(false);
    setQuery("");
  };

  // A 403 is meaningful, not incidental: it means this role may not use this
  // lookup at all. Say so rather than showing an empty dropdown.
  const loadError = () => {
    const e = items.error;
    if (!e) return null;
    if (e.status === 403)
      return props.forbiddenMsg ?? "You don't have access to this list.";
    return props.errorMsg ?? "Could not load the list. Please retry.";
  };

  // A selected id that isn't in the fetched list still has to render as
  // something. Showing the bare id beats showing the placeholder, which would
  // read as "nothing selected" and invite an accidental overwrite.
  const displayLabel = () => {
    if (items.loading) return "Loading…";
    if (selected()) return selected().name;
    if (props.value !== null && props.value !== undefined && props.value !== "")
      return `#${props.value}`;
    return props.placeholder ?? "Select…";
  };

  const hasSelection = () =>
    props.value !== null && props.value !== undefined && props.value !== "";

  return (
    <div ref={wrapper} class="relative">
      <Show when={props.label}>
        <label class={labelClass}>
          {props.label}
          <Show when={props.required}>
            {" "}
            <span class="text-[#AC2334]">*</span>
          </Show>
        </label>
      </Show>

      <button
        type="button"
        disabled={props.disabled || items.loading || !!items.error}
        onClick={() => setOpen(!open())}
        aria-haspopup="listbox"
        aria-expanded={open()}
        class={
          fieldClass +
          " flex items-center justify-between text-left " +
          (props.error ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
        }
      >
        <span
          class={
            hasSelection() && !items.loading
              ? "truncate"
              : "truncate text-[#8593A8] dark:text-gray-500"
          }
        >
          {displayLabel()}
        </span>
        <svg
          class={`w-4 h-4 flex-none ml-2 text-[#8593A8] transition-transform ${open() ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="absolute z-40 mt-1 w-full rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
          <div class="p-2 border-b border-[#E2E8F1] dark:border-gray-700">
            <input
              type="text"
              autofocus
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search…"
              class="w-full px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-[#14233A] dark:text-gray-100 placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#14233A]/20"
            />
          </div>
          <div class="max-h-64 overflow-y-auto py-1">
            <Show when={props.allowClear}>
              <button
                type="button"
                onClick={() => choose(null)}
                class="w-full text-left px-3 py-2 text-sm italic text-[#8593A8] dark:text-gray-500 hover:bg-[#F6F9FC] dark:hover:bg-gray-800 transition-colors"
              >
                {props.clearLabel ?? "None"}
              </button>
            </Show>
            <For each={filtered()}>
              {(o) => (
                <button
                  type="button"
                  onClick={() => choose(o.id, o)}
                  class={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[#F6F9FC] dark:hover:bg-gray-800 ${
                    String(o.id) === String(props.value ?? "")
                      ? "text-[#AC2334] dark:text-red-300 font-semibold"
                      : "text-[#14233A] dark:text-gray-100"
                  }`}
                >
                  {o.name}
                </button>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <p class="px-3 py-3 text-sm text-[#8593A8] dark:text-gray-500">
                {options().length === 0
                  ? (props.emptyMsg ?? "Nothing available to pick from.")
                  : "No match for that search."}
              </p>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={loadError()}>
        <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
          {loadError()}
        </p>
      </Show>
      <Show when={props.error && !loadError()}>
        <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
          {props.error}
        </p>
      </Show>
      <Show when={props.hint && !loadError() && !props.error}>
        <p class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-500">
          {props.hint}
        </p>
      </Show>
    </div>
  );
}
