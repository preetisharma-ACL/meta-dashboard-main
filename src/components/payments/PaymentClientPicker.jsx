import {
  createSignal,
  createResource,
  createMemo,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";
import { fetchPaymentClients } from "../../services/payments";
import { fieldClass, labelClass } from "./paymentsFormat";

// ─── Client picker for the payment forms ──────────────────────────────────────
// Options come from GET /payments/clients/, which the backend ALREADY narrows
// to the caller's payable set — accounts see every nomen, a tier-1 CM sees only
// theirs. That is the whole reason this picker doesn't take a role prop: there
// is no frontend filtering to do, and a CM simply cannot see a client outside
// their set because the server never sends it.
//
// A searchable combobox rather than a bare <select>: accounts pick from the
// full nomen roster, which is far too long to scroll.
//
// props: value (id | null), onChange(id | null), disabled?, error?
export default function PaymentClientPicker(props) {
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  let wrapper;

  const [clients] = createResource(fetchPaymentClients);

  const options = () => clients() ?? [];

  const selected = createMemo(() =>
    options().find((c) => String(c.id) === String(props.value ?? "")) ?? null,
  );

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return options();
    return options().filter((c) => c.name.toLowerCase().includes(q));
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

  const choose = (c) => {
    props.onChange?.(c.id);
    setOpen(false);
    setQuery("");
  };

  // A 403 here is meaningful, not incidental: it means this role may not record
  // payments at all. Say so rather than showing an empty dropdown.
  const loadError = () => {
    const e = clients.error;
    if (!e) return null;
    if (e.status === 403)
      return "You don't have access to the client list for payments.";
    return "Could not load the client list. Please retry.";
  };

  return (
    <div ref={wrapper} class="relative">
      <label class={labelClass}>
        Client <span class="text-[#AC2334]">*</span>
      </label>

      <button
        type="button"
        disabled={props.disabled || clients.loading || !!clients.error}
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
            selected()
              ? "truncate"
              : "truncate text-[#8593A8] dark:text-gray-500"
          }
        >
          {clients.loading
            ? "Loading clients…"
            : (selected()?.name ?? "Select a client…")}
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
              placeholder="Search clients…"
              class="w-full px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-[#14233A] dark:text-gray-100 placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#14233A]/20"
            />
          </div>
          <div class="max-h-64 overflow-y-auto py-1">
            <For each={filtered()}>
              {(c) => (
                <button
                  type="button"
                  onClick={() => choose(c)}
                  class={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[#F6F9FC] dark:hover:bg-gray-800 ${
                    String(c.id) === String(props.value ?? "")
                      ? "text-[#AC2334] dark:text-red-300 font-semibold"
                      : "text-[#14233A] dark:text-gray-100"
                  }`}
                >
                  {c.name}
                </button>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <p class="px-3 py-3 text-sm text-[#8593A8] dark:text-gray-500">
                {options().length === 0
                  ? "No clients available to you."
                  : "No client matches that search."}
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
    </div>
  );
}
