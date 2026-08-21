import {
  createSignal,
  createResource,
  createMemo,
  createEffect,
  on,
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
// ONE FIELD, not two. The control itself is the search box: the same input that
// shows the current selection is the one you type into, and the list underneath
// filters as you type. It used to be a button that opened a panel containing a
// separate "Search…" input, which read as two search fields for one value.
// Typing in the field opens the list; committing a pick puts the name back in
// the field.
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
//   hint         helper text under the control (string or JSX)
//   forbiddenMsg / errorMsg  copy for a 403 vs a generic load failure
//
//   filter       optional (option) => boolean, narrowing the list BEFORE the
//                search query. The payment form uses it to show only the
//                selected organization's clients. It is a VIEW, not a
//                restriction — the caller is expected to offer a way back to the
//                full list, because a hard narrowing would strand the handful of
//                clients whose org link is missing.
//   emptyFilteredMsg  copy for "the filter matched nothing", as distinct from
//                "this role has nothing to pick from at all".
//   onOptions    called with the loaded options once they arrive. The form needs
//                the client list to decide whether an org has one client or
//                several, and this hands it over rather than making the caller
//                fetch the same endpoint a second time.
//   focusToken   changing this to a new value opens the list and focuses the
//                input. Used to hand the operator straight to the client picker
//                when an org turns out to have several.
export default function EntityPicker(props) {
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  // Keyboard cursor into filtered(). -1 = nothing highlighted, so a blind Enter
  // never commits a client the operator hasn't actually looked at.
  const [active, setActive] = createSignal(-1);
  // `control` is the input row (field + clear/chevron buttons) — deliberately
  // NOT the outer wrapper, which also holds the label and the hint/error text.
  // Testing containment against the wrapper made a click on the "CLIENT" label
  // count as a click inside the combobox, so the list stayed open; clicking a
  // few pixels higher (outside the wrapper) closed it.
  let control;
  let inputEl;
  let listEl;

  const [items] = createResource(() => props.fetcher());

  const options = () => items() ?? [];

  // Hand the loaded list to the caller once. The form counts an organization's
  // clients from it; without this it would have to re-fetch the same endpoint.
  createEffect(() => {
    const loaded = items();
    if (loaded) props.onOptions?.(loaded);
  });

  // Open and focus on demand — the form does this when an organization has more
  // than one client, so the operator lands in the list instead of being left to
  // notice that the field is now narrowed. defer:true so mounting doesn't open
  // every picker on the page.
  createEffect(
    on(
      () => props.focusToken,
      () => {
        if (props.disabled || items.loading || items.error) return;
        setOpen(true);
        setActive(-1);
        inputEl?.focus();
      },
      { defer: true },
    ),
  );

  const selected = createMemo(
    () =>
      options().find((o) => String(o.id) === String(props.value ?? "")) ?? null,
  );

  // The caller's narrowing, applied before the typed query. Kept separate from
  // filtered() so the empty-state copy can tell "this org has no clients" apart
  // from "your search matched nothing".
  const visible = createMemo(() => {
    const f = props.filter;
    return typeof f === "function" ? options().filter(f) : options();
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return visible();
    return visible().filter((o) => o.name.toLowerCase().includes(q));
  });

  onMount(() => {
    const onDocClick = (e) => {
      if (!open()) return;
      // The list is a sibling of the control, so both have to be checked;
      // anything else — label, hint, the rest of the form — is "outside".
      const inside =
        control?.contains(e.target) || listEl?.contains(e.target);
      if (!inside) close();
    };
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  // Keep the highlighted row on screen when it moves by keyboard.
  createEffect(() => {
    const i = active();
    if (!open() || i < 0 || !listEl) return;
    listEl
      .querySelector(`[data-idx="${i}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(-1);
  };

  const openList = () => {
    if (props.disabled || items.loading || items.error) return;
    setOpen(true);
    setActive(-1);
  };

  // onChange receives the WHOLE option as a second argument, not just the id.
  // The client option carries organization_id, and the record form needs it to
  // pre-select the org — re-finding the row by id in the caller would mean
  // duplicating this component's fetch. Callers that only want the id ignore
  // the second arg. Clearing passes (null, null).
  const choose = (id, option = null) => {
    props.onChange?.(id, option);
    close();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open()) return openList();
      const list = filtered();
      if (list.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = active() < 0 ? (step > 0 ? 0 : list.length - 1) : active() + step;
      setActive((next + list.length) % list.length);
      return;
    }
    if (e.key === "Enter") {
      // Only swallow Enter when it actually commits a highlighted row —
      // otherwise it stays a normal form submit.
      const opt = open() ? filtered()[active()] : null;
      if (opt) {
        e.preventDefault();
        choose(opt.id, opt);
      }
      return;
    }
    if (e.key === "Escape") {
      if (open()) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
      return;
    }
    if (e.key === "Tab") close();
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

  const hasSelection = () =>
    props.value !== null && props.value !== undefined && props.value !== "";

  // A selected id that isn't in the fetched list still has to render as
  // something. Showing the bare id beats showing the placeholder, which would
  // read as "nothing selected" and invite an accidental overwrite.
  const selectionLabel = () => {
    if (selected()) return selected().name;
    if (hasSelection()) return `#${props.value}`;
    return "";
  };

  // Closed → the field IS the selection. Open → the field is the search box,
  // and the selection moves to the placeholder so it isn't lost from sight.
  const inputValue = () => (open() ? query() : selectionLabel());

  const inputPlaceholder = () => {
    if (items.loading) return "Loading…";
    if (loadError()) return "Unavailable";
    if (open() && hasSelection())
      return `Search… (current: ${selectionLabel()})`;
    if (open()) return "Type to search…";
    return props.placeholder ?? "Select…";
  };

  return (
    <div class="relative">
      <Show when={props.label}>
        <label class={labelClass}>
          {props.label}
          <Show when={props.required}>
            {" "}
            <span class="text-[#AC2334]">*</span>
          </Show>
        </label>
      </Show>

      <div ref={control} class="relative">
        <input
          ref={inputEl}
          type="text"
          role="combobox"
          autocomplete="off"
          aria-expanded={open()}
          aria-autocomplete="list"
          disabled={props.disabled || items.loading || !!items.error}
          value={inputValue()}
          placeholder={inputPlaceholder()}
          onFocus={openList}
          onClick={openList}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          class={
            fieldClass +
            " pr-16 " +
            (props.error ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
          }
        />

        <div class="absolute inset-y-0 right-2 flex items-center gap-1">
          {/* Clearing an optional field shouldn't mean hunting for a row in a
              700-item list. */}
          <Show when={props.allowClear && hasSelection() && !props.disabled}>
            <button
              type="button"
              onClick={() => choose(null)}
              title={props.clearLabel ?? "Clear"}
              aria-label={props.clearLabel ?? "Clear"}
              class="p-1 rounded text-[#8593A8] hover:text-[#14233A] dark:hover:text-gray-200 hover:bg-[#F6F9FC] dark:hover:bg-gray-800 transition-colors"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </Show>
          <button
            type="button"
            tabIndex={-1}
            disabled={props.disabled || items.loading || !!items.error}
            onClick={() => {
              if (open()) close();
              else {
                openList();
                inputEl?.focus();
              }
            }}
            aria-label={open() ? "Close list" : "Open list"}
            class="p-1 text-[#8593A8] disabled:opacity-50"
          >
            <svg
              class={`w-4 h-4 transition-transform ${open() ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      <Show when={open()}>
        <div
          ref={listEl}
          role="listbox"
          class="absolute z-40 mt-1 w-full max-h-72 overflow-y-auto py-1 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl"
        >
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
            {(o, i) => (
              <button
                type="button"
                data-idx={i()}
                role="option"
                aria-selected={String(o.id) === String(props.value ?? "")}
                onClick={() => choose(o.id, o)}
                onMouseEnter={() => setActive(i())}
                class={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  active() === i() ? "bg-[#F6F9FC] dark:bg-gray-800" : ""
                } ${
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
                : visible().length === 0
                  ? (props.emptyFilteredMsg ?? "Nothing matches the current filter.")
                  : "No match for that search."}
            </p>
          </Show>
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
