import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { fetchHierarchyClients } from "../../services/cm";
import { fieldClass } from "./Modal";

// ─── Client picker for worklog create modals ──────────────────────────────────
// Used when a Log-complaint / Assign-task modal is opened OUTSIDE a client
// workspace (e.g. from My Work), so no client is in scope yet. Options come from
// the CM hierarchy (scoped to the user's visibility). The value is the INTEGER
// client_nomen_id — the same id the worklog endpoints expect (a name 404s/500s).
//
// Props: value (string id | ""), onChange(idString), onClientPicked?({id,name}).
export default function ClientPicker(props) {
  const [q, setQ] = createSignal("");

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

  const filtered = createMemo(() => {
    const term = q().trim().toLowerCase();
    const list = clients() ?? [];
    return term ? list.filter((c) => c.name.toLowerCase().includes(term)) : list;
  });

  const onSelect = (idStr) => {
    props.onChange?.(idStr);
    const hit = (clients() ?? []).find((c) => String(c.id) === idStr);
    props.onClientPicked?.(hit ? { id: hit.id, name: hit.name } : null);
  };

  return (
    <div>
      {/* Search only appears once the list is long enough to warrant it. */}
      <Show when={(clients() ?? []).length > 8}>
        <input
          type="text"
          class={`${fieldClass} mb-2`}
          placeholder="Search clients…"
          value={q()}
          onInput={(e) => setQ(e.target.value)}
        />
      </Show>
      <select
        class={fieldClass}
        value={props.value ?? ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="">
          {clients.loading ? "Loading clients…" : "Select a client…"}
        </option>
        <For each={filtered()}>
          {(c) => <option value={String(c.id)}>{c.name}</option>}
        </For>
      </select>
      <Show when={!clients.loading && (clients() ?? []).length === 0}>
        <p class="mt-1.5 text-xs text-[#AC2334] dark:text-red-400">
          No clients available to pick from.
        </p>
      </Show>
    </div>
  );
}
