import { createSignal, For, Show } from "solid-js";
import { useDialog } from "../../utils/useDialog";
import { FIELD, LABEL, GHOST_BTN, PRIMARY_BTN } from "../creatives/CreativeUI";

// ─── Shared pieces for the Proposals screens ──────────────────────────────────
// Same palette as the other staff screens (crimson #AC2334, navy #14233A,
// slate #54657E / #8593A8, hairline #E2E8F1). Field/button classes come from
// CreativeUI so the forms read the same as everywhere else.

export { FIELD, LABEL, GHOST_BTN, PRIMARY_BTN };

export const DANGER_BTN =
  "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white text-sm font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap";

export const SMALL_BTN =
  "inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-semibold text-[#14233A] dark:text-gray-200 hover:bg-[#F8FAFC] dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap";

export const CARD =
  "bg-white dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700";

export function ConfirmedBadge(props) {
  return (
    <span
      class={
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide rounded-full whitespace-nowrap " +
        (props.confirmed
          ? "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300"
          : "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300")
      }
    >
      <span class={"w-1.5 h-1.5 rounded-full " + (props.confirmed ? "bg-[#15966A]" : "bg-[#B07A14]")} />
      {props.confirmed ? "Confirmed" : "Needs confirm"}
    </span>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────
// props: open, title, onClose, busy (blocks closing), width ("max-w-lg"), children
export function Modal(props) {
  let el;
  useDialog(
    () => props.open,
    () => !props.busy && props.onClose(),
    () => el,
  );
  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto"
        onMouseDown={(e) => e.target === e.currentTarget && !props.busy && props.onClose()}
      >
        <div
          ref={el}
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
          class={`w-full ${props.width ?? "max-w-md"} rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-[#E2E8F1] dark:border-gray-700`}
        >
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700">
            <h2 class="text-lg font-bold text-[#14233A] dark:text-white">{props.title}</h2>
            <button
              type="button"
              aria-label="Close"
              class="text-2xl leading-none text-[#8593A8] hover:text-[#AC2334] disabled:opacity-40"
              onClick={() => props.onClose()}
              disabled={props.busy}
            >
              ×
            </button>
          </div>
          <div class="px-6 py-5">{props.children}</div>
        </div>
      </div>
    </Show>
  );
}

export function InlineError(props) {
  return (
    <Show when={props.message || props.lines?.length}>
      <div role="alert" class="rounded-lg border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 px-3 py-2 text-sm font-medium text-[#AC2334] dark:text-red-300">
        <Show when={props.message}>
          <p>{props.message}</p>
        </Show>
        <Show when={props.lines?.length}>
          <ul class="mt-1 list-disc pl-5 space-y-0.5 font-normal">
            <For each={props.lines}>{(l) => <li>{l}</li>}</For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}

// ── "Remove …?" ───────────────────────────────────────────────────────────────
// props: open, title, message, confirmLabel, onConfirm() → Promise, onClose()
export function ConfirmDialog(props) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      await props.onConfirm();
      props.onClose();
    } catch (err) {
      setError(err?.status === 403 ? "You don't have permission to do this." : err?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={props.open} title={props.title} busy={busy()} onClose={() => { setError(""); props.onClose(); }}>
      <div class="space-y-4">
        <p class="text-sm text-[#54657E] dark:text-gray-300">{props.message}</p>
        <InlineError message={error()} />
        <div class="flex justify-end gap-2">
          <button type="button" class={GHOST_BTN} onClick={() => props.onClose()} disabled={busy()}>
            Cancel
          </button>
          <button type="button" class={DANGER_BTN} onClick={run} disabled={busy()} data-autofocus>
            {busy() ? "Working…" : props.confirmLabel ?? "Remove"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Tag list ──────────────────────────────────────────────────────────────────
// Enter or comma adds; × removes; Backspace on an empty box drops the last.
// props: value (string[]), onChange(next), placeholder, limit (chars per tag)
export function TagInput(props) {
  const [draft, setDraft] = createSignal("");
  const tags = () => (Array.isArray(props.value) ? props.value : []);
  const add = () => {
    const t = draft().trim();
    if (!t) return;
    props.onChange([...tags(), t]);
    setDraft("");
  };
  return (
    <div class="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 focus-within:ring-2 focus-within:ring-[#AC2334]/40 focus-within:border-[#AC2334]">
      <For each={tags()}>
        {(t, i) => {
          const over = () => props.limit && String(t).length > props.limit;
          return (
            <span
              class={
                "inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-semibold " +
                (over()
                  ? "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300"
                  : "bg-[#F1F4F9] text-[#14233A] dark:bg-gray-700 dark:text-gray-100")
              }
              title={over() ? `Longer than ${props.limit} characters` : undefined}
            >
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                class="w-4 h-4 grid place-items-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                onClick={() => props.onChange(tags().filter((_, j) => j !== i()))}
              >
                ×
              </button>
            </span>
          );
        }}
      </For>
      <input
        class="flex-1 min-w-[8rem] bg-transparent text-sm text-[#14233A] dark:text-gray-100 outline-none py-1"
        placeholder={props.placeholder ?? "Type and press Enter"}
        value={draft()}
        onInput={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft() && tags().length) {
            props.onChange(tags().slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

// "42 / 60", red past the limit. Nothing when there is no limit.
export function CharCount(props) {
  const n = () => String(props.value ?? "").length;
  return (
    <Show when={props.limit}>
      <span
        class={
          "text-[11px] tabular-nums font-semibold " +
          (n() > props.limit ? "text-[#AC2334] dark:text-red-300" : "text-[#8593A8] dark:text-gray-400")
        }
      >
        {n()} / {props.limit}
      </span>
    </Show>
  );
}

// Section header inside a card.
export function PanelTitle(props) {
  return (
    <div class="flex items-center justify-between gap-2 mb-3">
      <h3 class="text-xs font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-300">{props.children}</h3>
      <Show when={props.right}>{props.right}</Show>
    </div>
  );
}

export function Spinner(props) {
  return (
    <svg class={`${props.class ?? "w-4 h-4"} animate-spin`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
