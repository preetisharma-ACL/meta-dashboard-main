import { Show, onMount, onCleanup } from "solid-js";

// ─── Worklog modal shell ──────────────────────────────────────────────────────
// Forest/gold/clay design system (client-workspace prototype). Self-contained in
// its own `.wl` scope so it renders the approved paper theme wherever it's used.
// Closes on backdrop click + Escape.
// Props: title, subtitle?, onClose, children.
export default function Modal(props) {
  onMount(() => {
    const onKey = (e) => {
      if (e.key === "Escape") props.onClose?.();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="wl">
      <div class="overlay" onClick={props.onClose} />
      <div class="modal" role="dialog" aria-modal="true">
        <button class="xbtn" onClick={props.onClose} aria-label="Close" style="position:absolute;top:16px;right:16px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <h3>{props.title}</h3>
        <Show when={props.subtitle}>
          <p class="sub">{props.subtitle}</p>
        </Show>
        {props.children}
      </div>
    </div>
  );
}

// Fields are styled by the scoped `.wl .field` rules; inputs get `.wl input/select`
// styling automatically, so no per-input class is needed.
export const fieldClass = "";

export function Field(props) {
  return (
    <div class="field">
      <label>
        {props.label}
        <Show when={props.required}>
          <span style="color:var(--clay)"> *</span>
        </Show>
      </label>
      {props.children}
    </div>
  );
}
