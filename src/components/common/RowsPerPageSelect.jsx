// Rows-per-page selector — the small "20 per page ▾" pill that sits next to a
// table's "Showing 1–20 of N results" line.
//
// Same behaviour/markup as the one that shipped inline on ProjectDetails: menu
// opens upward (these tables end at the bottom of the page) and closes on any
// click outside the wrapper. Kept as a shared component so ClientDashboard and
// the Payments & Billing dashboard don't each grow their own copy.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

export const ROWS_PER_PAGE_OPTIONS = [10, 20, 25, 50, 100];

export default function RowsPerPageSelect(props) {
  const [open, setOpen] = createSignal(false);
  let wrapper;

  onMount(() => {
    const handleClickOutside = (e) => {
      if (wrapper && !wrapper.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", handleClickOutside);
    onCleanup(() => document.removeEventListener("click", handleClickOutside));
  });

  const options = () => props.options ?? ROWS_PER_PAGE_OPTIONS;

  const choose = (size) => {
    setOpen(false);
    if (size === props.value) return;
    props.onChange?.(size);
  };

  return (
    <div class="relative" ref={wrapper}>
      <button
        type="button"
        onClick={() => setOpen(!open())}
        class="flex items-center gap-2 px-3 h-9 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 text-[#54657E] dark:text-gray-200 hover:bg-[#F6F9FC] dark:hover:bg-gray-800 transition-colors"
      >
        {props.value} per page
        <svg
          class={`w-3.5 h-3.5 transition-transform ${open() ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 16 16"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="absolute left-0 bottom-full mb-1 z-30 w-40 py-1 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          <For each={options()}>
            {(size) => (
              <button
                type="button"
                onClick={() => choose(size)}
                class={`w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-[#F6F9FC] dark:hover:bg-gray-800 transition-colors ${
                  size === props.value
                    ? "text-[#AC2334] dark:text-red-300 font-medium"
                    : "text-[#54657E] dark:text-gray-200"
                }`}
              >
                {size} per page
                <Show when={size === props.value}>
                  <svg
                    class="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 16 16"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M3 8.5l3.5 3.5L13 5" />
                  </svg>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
