import { Show, onMount, onCleanup } from "solid-js";

// ─── Worklog modal shell ──────────────────────────────────────────────────────
// Matches the AllowedBudget modal look. Closes on backdrop click + Escape.
// Props: title, subtitle?, onClose, maxWidth? ("max-w-md" default), children.
export default function Modal(props) {
  onMount(() => {
    const onKey = (e) => {
      if (e.key === "Escape") props.onClose?.();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="fixed inset-0 bg-[#101D31]/40 backdrop-blur-sm"
        onClick={props.onClose}
      />
      <div
        class={`relative z-10 w-full ${props.maxWidth ?? "max-w-md"} max-h-[90vh] overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-2xl`}
      >
        <div class="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F1] dark:border-gray-800 sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
          <div>
            <h2 class="text-base font-bold text-[#14233A] dark:text-white">
              {props.title}
            </h2>
            <Show when={props.subtitle}>
              <p class="text-xs text-[#54657E] dark:text-gray-400">
                {props.subtitle}
              </p>
            </Show>
          </div>
          <button
            onClick={props.onClose}
            class="w-8 h-8 rounded-full flex items-center justify-center text-[#8593A8] hover:bg-[#F1F4F9] dark:hover:bg-gray-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div class="px-5 py-5">{props.children}</div>
      </div>
    </div>
  );
}

// Shared field primitives so every modal's inputs look identical.
export const fieldClass =
  "w-full px-3 py-2 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-[#1A2B45] dark:text-gray-100 placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]";

export function Field(props) {
  return (
    <label class="block mb-4">
      <span class="block text-xs font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-400 mb-1.5">
        {props.label}
        <Show when={props.required}>
          <span class="text-[#AC2334]"> *</span>
        </Show>
      </span>
      {props.children}
    </label>
  );
}
