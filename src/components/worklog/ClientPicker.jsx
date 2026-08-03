import {
  createSignal,
  createResource,
  createMemo,
  createEffect,
  For,
  Show,
  onCleanup,
} from "solid-js";
import { fetchHierarchyClients } from "../../services/cm";

// ─── Client picker for worklog create modals ──────────────────────────────────
// Used when a Log-complaint / Assign-task modal is opened OUTSIDE a client
// workspace (e.g. from My Work), so no client is in scope yet. Options come from
// the CM hierarchy (scoped to the user's visibility). The value is the INTEGER
// client_nomen_id — the same id the worklog endpoints expect (a name 404s/500s).
//
// Single combobox: type in the box to filter, pick from the list it drops down.
// (It used to be a search input *and* a separate <select>, i.e. two places to
// look for the same client.)
//
// Props: value (string id | ""), onChange(idString), onClientPicked?({id,name}).
export default function ClientPicker(props) {
  const [q, setQ] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let rootEl;
  let inputEl;

  const [clients] = createResource(async () => {
    try {
      const res = await fetchHierarchyClients();
      const list = Array.isArray(res?.data) ? res.data : [];
      return list
        .map((c) => ({
          // /cm/hierarchy/clients/ serves the display name in `client_name`
          // (not client_nomen_name); keep the integer id as the value.
          id: c.client_nomen_id,
          name:
            c.client_name ||
            c.client_nomen_name ||
            `Client #${c.client_nomen_id}`,
        }))
        .filter((c) => c.id != null)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    } catch {
      return [];
    }
  });

  const selected = createMemo(() => {
    const v = props.value == null ? "" : String(props.value);
    if (!v) return null;
    return (clients() ?? []).find((c) => String(c.id) === v) ?? null;
  });

  const filtered = createMemo(() => {
    const term = q().trim().toLowerCase();
    const list = clients() ?? [];
    return term ? list.filter((c) => c.name.toLowerCase().includes(term)) : list;
  });

  // Keep the highlight inside the (re-filtered) list.
  createEffect(() => {
    const n = filtered().length;
    if (active() > n - 1) setActive(n ? n - 1 : 0);
  });

  const close = () => {
    setOpen(false);
    setQ("");
  };

  const pick = (c) => {
    props.onChange?.(String(c.id));
    props.onClientPicked?.({ id: c.id, name: c.name });
    close();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open()) {
        setOpen(true);
        return;
      }
      const n = filtered().length;
      if (!n) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === "Enter") {
      if (!open()) return;
      e.preventDefault();
      const hit = filtered()[active()];
      if (hit) pick(hit);
    } else if (e.key === "Escape") {
      if (!open()) return;
      // Don't let the modal shell swallow this as a "close the modal".
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  // Click anywhere outside the combobox closes the list.
  const onDocDown = (e) => {
    if (open() && rootEl && !rootEl.contains(e.target)) close();
  };
  document.addEventListener("mousedown", onDocDown);
  onCleanup(() => document.removeEventListener("mousedown", onDocDown));

  return (
    <div class="cpick" ref={rootEl}>
      <div class="cpick-box">
        <input
          ref={inputEl}
          type="text"
          role="combobox"
          aria-expanded={open()}
          aria-autocomplete="list"
          autocomplete="off"
          placeholder={
            clients.loading
              ? "Loading clients…"
              : selected()
                ? selected().name
                : "Search or select a client…"
          }
          value={open() ? q() : (selected()?.name ?? "")}
          onFocus={() => {
            setQ("");
            setActive(0);
            setOpen(true);
          }}
          onInput={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <Show when={selected()}>
          <button
            type="button"
            class="cpick-clear"
            aria-label="Clear client"
            onClick={() => {
              props.onChange?.("");
              props.onClientPicked?.(null);
              setQ("");
              inputEl?.focus();
            }}
          >
            ×
          </button>
        </Show>
      </div>

      <Show when={open() && !clients.loading}>
        <ul class="cpick-menu" role="listbox">
          <Show
            when={filtered().length}
            fallback={<li class="cpick-empty">No clients match “{q()}”.</li>}
          >
            <For each={filtered()}>
              {(c, i) => (
                <li
                  role="option"
                  aria-selected={String(c.id) === String(props.value ?? "")}
                  class={`cpick-opt${i() === active() ? " is-active" : ""}${
                    String(c.id) === String(props.value ?? "") ? " is-picked" : ""
                  }`}
                  onMouseEnter={() => setActive(i())}
                  // mousedown, not click: the input blurs before click fires.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                >
                  {c.name}
                </li>
              )}
            </For>
          </Show>
        </ul>
      </Show>

      <Show when={!clients.loading && (clients() ?? []).length === 0}>
        <p class="mt-1.5 text-xs text-[#AC2334] dark:text-red-400">
          No clients available to pick from.
        </p>
      </Show>
    </div>
  );
}
