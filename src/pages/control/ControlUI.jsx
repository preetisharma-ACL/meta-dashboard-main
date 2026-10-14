import { createSignal, createEffect, Show, For } from "solid-js";
import { Navigate } from "@solidjs/router";
import { currentUser, isSuperuser } from "../../stores/currentUser";

// ─── Shared bits for the Control Centre screens ───────────────────────────────

export const BTN =
  "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed";
export const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-blue-900 text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed";
export const BTN_DANGER =
  "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed";
export const INPUT =
  "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60 disabled:cursor-not-allowed";
export const CARD =
  "bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700";

// Route guard. Waits for /auth/me rather than bouncing a superuser during the
// moment before it lands; then fails closed.
export function SuperuserRoute(props) {
  return (
    <Show
      when={currentUser.loaded || isSuperuser()}
      fallback={<p class="p-8 text-sm text-gray-500">Loading…</p>}
    >
      <Show when={isSuperuser()} fallback={<Navigate href="/dashboard" />}>
        {props.children}
      </Show>
    </Show>
  );
}

export function PageHead(props) {
  return (
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Show when={props.crumbs}>
          <p class="mb-1 text-xs text-gray-500 dark:text-gray-400">{props.crumbs}</p>
        </Show>
        <h1 class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
          {props.title}
        </h1>
        <Show when={props.subtitle}>
          <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{props.subtitle}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="flex flex-wrap gap-2">{props.actions}</div>
      </Show>
    </div>
  );
}

export function Banner(props) {
  const tone = () =>
    props.tone === "success"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
      : props.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
        : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300";
  return (
    <Show when={props.children}>
      <div class={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${tone()}`}>
        {props.children}
      </div>
    </Show>
  );
}

// A one-shot message carried across a navigation (e.g. "Saved" after a form
// returns to its list), the way Django admin shows its messages.
const [flash, setFlash] = createSignal(null);
export const pushFlash = (text, tone = "success") => setFlash({ text, tone });
export const takeFlash = () => {
  const f = flash();
  setFlash(null);
  return f;
};

// Any cell / readonly value as plain text.
export const showValue = (v) => {
  if (v == null || v === "") return "—";
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (Array.isArray(v)) return v.length ? v.map(showValue).join(", ") : "—";
  if (typeof v === "object") return v.label ?? v.str ?? JSON.stringify(v);
  return String(v);
};

export function Cell(props) {
  return (
    <Show
      when={typeof props.value === "boolean"}
      fallback={<span>{showValue(props.value)}</span>}
    >
      <span
        class={props.value ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}
        title={props.value ? "Yes" : "No"}
      >
        {props.value ? "✓" : "✗"}
      </span>
    </Show>
  );
}

// Confirm dialog that REQUIRES a reason — every edit, delete and action is
// audited with one. `children` carries what is about to happen.
export function ReasonDialog(props) {
  const [reason, setReason] = createSignal("");
  createEffect(() => {
    if (props.open) setReason("");
  });
  const ok = () => reason().trim().length > 0 && !props.busy && !props.blocked;
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={props.title}
          class="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl p-6"
        >
          <h3 class="text-base font-semibold text-gray-900 dark:text-white">{props.title}</h3>
          <div class="mt-2 text-sm text-gray-600 dark:text-gray-300">{props.children}</div>
          <label class="mt-4 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Reason <span class="text-red-500">*</span>
          </label>
          <textarea
            rows="2"
            value={reason()}
            onInput={(e) => setReason(e.target.value)}
            placeholder="Why is this change being made? (saved in the audit log)"
            class={`${INPUT} mt-1`}
          />
          <Show when={props.error}>
            <p class="mt-2 text-sm text-red-600 dark:text-red-400">{props.error}</p>
          </Show>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class={BTN} onClick={props.onCancel} disabled={props.busy}>
              Cancel
            </button>
            <button
              type="button"
              class={props.danger ? BTN_DANGER : BTN_PRIMARY}
              disabled={!ok()}
              onClick={() => props.onConfirm(reason().trim())}
            >
              {props.busy ? "Working…" : (props.confirmLabel ?? "Confirm")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

// Delete flow for one record: preview what goes with it, block on protected,
// then delete with a reason. `preview` is the delete-preview body.
export function DeletePreview(props) {
  const counts = () => Object.entries(props.preview?.counts ?? {});
  const protectedItems = () => props.preview?.protected ?? [];
  return (
    <>
      <p>
        Delete <span class="font-medium">{props.label}</span>? This can't be undone.
      </p>
      <Show when={counts().length}>
        <p class="mt-2 font-medium">This will also delete:</p>
        <ul class="mt-1 list-disc pl-5">
          <For each={counts()}>
            {([m, n]) => (
              <li>
                {n} × {m}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={protectedItems().length}>
        <div class="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-red-700 dark:text-red-300">
          <p class="font-medium">Can't delete — these related records are protected:</p>
          <ul class="mt-1 list-disc pl-5">
            <For each={protectedItems()}>{(p) => <li>{showValue(p)}</li>}</For>
          </ul>
        </div>
      </Show>
    </>
  );
}
