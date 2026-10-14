import { createEffect, onCleanup } from "solid-js";

// ── Dialog keyboard behaviour ──
// One stack for every open dialog on the page: Esc closes only the TOP one
// (a reason dialog over a tool dialog closes alone), Tab is kept inside it,
// and focus moves into it on open and back to whatever opened it on close.
const dialogStack = [];
const FOCUSABLE =
  'textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
if (typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => {
    const top = dialogStack[dialogStack.length - 1];
    if (!top) return;
    if (e.key === "Escape") {
      e.preventDefault();
      top.close?.();
    } else if (e.key === "Tab") {
      const el = top.el();
      const items = el ? [...el.querySelectorAll(FOCUSABLE)] : [];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}
// useDialog(() => open, () => close(), () => element) inside a component.
export function useDialog(open, close, el) {
  createEffect(() => {
    if (!open()) return;
    const entry = { close, el };
    const opener = document.activeElement;
    dialogStack.push(entry);
    queueMicrotask(() => {
      const target = el()?.querySelector("[data-autofocus]") ?? el()?.querySelector(FOCUSABLE);
      target?.focus();
    });
    onCleanup(() => {
      const i = dialogStack.indexOf(entry);
      if (i >= 0) dialogStack.splice(i, 1);
      if (opener && document.contains(opener)) opener.focus?.();
    });
  });
}
