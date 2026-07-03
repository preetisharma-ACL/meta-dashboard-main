import { Show, onMount, onCleanup, createSignal } from "solid-js";

// ─── Worklog detail drawer ────────────────────────────────────────────────────
// Right-side slide-in panel for DETAIL/read views (forest/gold/clay prototype).
// Self-contained in its own `.wl` scope. Slides in on mount and animates out on
// close (X / overlay / Escape) before unmounting.
// Props:
//   title           — drawer heading
//   headExtra?      — JSX rendered under the title (e.g. status/severity pills)
//   footer?(close)  — render fn for the pinned footer; receives the animated close
//   onClose         — called after the slide-out finishes
//   children        — scrollable body
export default function Drawer(props) {
  const [shown, setShown] = createSignal(false);
  let closeBtn;
  let closing = false;

  const requestClose = () => {
    if (closing) return;
    closing = true;
    setShown(false);
    setTimeout(() => props.onClose?.(), 240); // match the CSS transition
  };

  onMount(() => {
    // Next frame → toggle .show so the panel transitions in from the right.
    requestAnimationFrame(() => setShown(true));
    setTimeout(() => closeBtn?.focus(), 60);
    const onKey = (e) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="wl">
      <div class="overlay" onClick={requestClose} />
      <aside
        class={`drawer ${shown() ? "show" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div class="dr-head">
          <div class="row1">
            <h3 style="flex:1">{props.title}</h3>
            <button class="xbtn" ref={closeBtn} onClick={requestClose} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <Show when={props.headExtra}>
            <div class="head-pills">{props.headExtra}</div>
          </Show>
        </div>

        <div class="dr-body">{props.children}</div>

        <Show when={props.footer}>
          <div class="dr-foot">{props.footer(requestClose)}</div>
        </Show>
      </aside>
    </div>
  );
}
