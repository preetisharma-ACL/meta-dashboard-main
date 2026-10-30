import { createSignal, createMemo, createEffect, on, onMount, onCleanup, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { RefreshCw, Maximize2, X, Download, ExternalLink } from "lucide-solid";
import { fetchProposalPreview } from "../../services/proposals";
import { errorMessage } from "../../utils/apiErrors";
import { useDialog } from "../../utils/useDialog";
import { CARD, Spinner, InlineError } from "./ProposalUI";

// ─── Builder: live preview (right panel + full screen) ────────────────────────
// GET preview → {html} in an <iframe srcdoc>. The page is laid out 794 px wide
// (A4) × 5 pages, so the frame is rendered at that size and scaled with a CSS
// transform. Refetched (debounced) whenever `tick` moves — the builder bumps
// it after every save / confirm / chat / undo / restore. A 400 means there are
// no numbers yet: its message is shown instead.
//
// PAGE_GAP is added just before </head> so the five .page sheets show apart on
// a grey desk instead of as one long strip. Preview only; the PDF is rendered
// server-side from its own HTML.
//
// Full screen reuses the same HTML (no new request), above the sidebar and
// header: Fit width / 100% / 125%, Download (the builder's handler and state),
// Open in new tab (a Blob URL; fonts and logo come from the public
// /api/proposals/assets/ URLs, so they load there too). Esc closes.
//
// sandbox="allow-same-origin" without allow-scripts: the page can't run code,
// but its height can still be read once it has laid out.
//
// Props: id, tick, title, canDownload, dlBusy, dlTitle, dlError, onDownload(),
//        onDismissDlError()

const PAGE_W = 794;
const A4_H = 1123;
const DEBOUNCE = 600;
const FIT_MAX = 1000;
const MOBILE = 640;

const PAGE_GAP =
  "<style>html,body{background:#d9dde3!important}.page{margin:0 auto 18px;box-shadow:0 2px 14px rgba(0,0,0,.18)}</style>";

const withPageGap = (h) => {
  if (!h) return "";
  const i = h.search(/<\/head>/i);
  return i >= 0 ? h.slice(0, i) + PAGE_GAP + h.slice(i) : PAGE_GAP + h;
};

// Height of a laid-out srcdoc frame, or null when it can't be read.
const frameHeight = (frame) => {
  try {
    const doc = frame?.contentDocument;
    const h = Math.max(doc?.documentElement?.scrollHeight ?? 0, doc?.body?.scrollHeight ?? 0);
    return h > 0 ? h : null;
  } catch {
    return null;
  }
};

export default function BuilderPreview(props) {
  const [html, setHtml] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [width, setWidth] = createSignal(PAGE_W);
  const [docH, setDocH] = createSignal(A4_H * 5);
  const [full, setFull] = createSignal(false);
  let box;
  let frame;
  let timer;
  let seq = 0;

  const shown = createMemo(() => withPageGap(html()));

  const load = async () => {
    const mine = ++seq;
    setLoading(true);
    try {
      const h = await fetchProposalPreview(props.id);
      if (mine !== seq) return;
      setHtml(h);
      setError("");
    } catch (err) {
      if (mine !== seq) return;
      setError(err?.status === 400 ? err.message || "No numbers yet." : errorMessage(err, "Could not load the preview."));
    } finally {
      if (mine === seq) setLoading(false);
    }
  };

  createEffect(
    on(
      () => props.tick,
      () => {
        clearTimeout(timer);
        timer = setTimeout(load, DEBOUNCE);
      },
    ),
  );
  onCleanup(() => clearTimeout(timer));

  onMount(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(box);
    onCleanup(() => ro.disconnect());
  });

  const scale = () => Math.min(1, width() / PAGE_W);
  const measure = () => {
    const h = frameHeight(frame);
    if (h) setDocH(h);
  };

  const canFull = () => !error() && !!html();

  return (
    <div class={CARD + " flex flex-col min-h-[420px] xl:h-[calc(100vh-9.5rem)] xl:sticky xl:top-3"}>
      <div class="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F1] dark:border-gray-700">
        <h2 class="text-xs font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-300">Preview</h2>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-xs font-semibold text-[#54657E] hover:text-[#AC2334] disabled:opacity-40"
            disabled={loading()}
            onClick={load}
            aria-label="Refresh preview"
          >
            <Show when={loading()} fallback={<RefreshCw size={13} />}>
              <Spinner class="w-3.5 h-3.5" />
            </Show>
            Refresh
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-xs font-semibold text-[#54657E] hover:text-[#AC2334] disabled:opacity-40"
            disabled={!canFull()}
            onClick={() => setFull(true)}
            aria-label="Full screen preview"
          >
            <Maximize2 size={13} /> Full screen
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto bg-[#d9dde3] dark:bg-gray-900 p-3">
        <div ref={box} class="w-full">
          <Show when={error()}>
            <div class="rounded-lg border border-[#D89A2B]/40 bg-[#FDF6E9] dark:bg-yellow-900/20 px-4 py-3 text-sm text-[#7A5410] dark:text-yellow-200">
              {error()}
            </div>
          </Show>
          <Show when={!error() && html()}>
            <div class="relative overflow-hidden" style={{ width: `${PAGE_W * scale()}px`, height: `${docH() * scale()}px` }}>
              <iframe
                ref={frame}
                title="Proposal preview"
                sandbox="allow-same-origin"
                srcdoc={shown()}
                onLoad={measure}
                class="absolute top-0 left-0 border-0"
                style={{
                  width: `${PAGE_W}px`,
                  height: `${docH()}px`,
                  transform: `scale(${scale()})`,
                  "transform-origin": "0 0",
                }}
              />
            </div>
          </Show>
          <Show when={!error() && !html() && loading()}>
            <div class="py-16 grid place-items-center text-sm text-[#54657E]">
              <span class="inline-flex items-center gap-2">
                <Spinner /> Loading preview…
              </span>
            </div>
          </Show>
        </div>
      </div>

      <Show when={full() && canFull()}>
        <FullScreen
          html={shown()}
          initialH={docH()}
          title={props.title}
          canDownload={props.canDownload}
          dlBusy={props.dlBusy}
          dlTitle={props.dlTitle}
          dlError={props.dlError}
          onDownload={props.onDownload}
          onDismissDlError={props.onDismissDlError}
          onClose={() => setFull(false)}
        />
      </Show>
    </div>
  );
}

const ZOOMS = [
  { key: "fit", label: "Fit width" },
  { key: "100", label: "100%" },
  { key: "125", label: "125%" },
];

function FullScreen(props) {
  const [zoom, setZoom] = createSignal("fit");
  const [vw, setVw] = createSignal(window.innerWidth);
  const [docH, setDocH] = createSignal(props.initialH);
  let el;
  let frame;

  const onResize = () => setVw(window.innerWidth);
  window.addEventListener("resize", onResize);
  // The app behind doesn't scroll while the overlay is up.
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  onCleanup(() => {
    window.removeEventListener("resize", onResize);
    document.body.style.overflow = prevOverflow;
  });

  useDialog(() => true, () => props.onClose(), () => el);

  const mobile = () => vw() < MOBILE;
  const pageW = () => {
    if (mobile() || zoom() === "fit") return Math.min(vw() - 48, FIT_MAX);
    return zoom() === "125" ? 993 : PAGE_W;
  };
  const scale = () => pageW() / PAGE_W;

  const openInTab = () => {
    const url = URL.createObjectURL(new Blob([props.html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    // The new tab has read it by then; free the memory.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const BAR_BTN =
    "inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white/90 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";

  return (
    <Portal>
      <div ref={el} role="dialog" aria-modal="true" aria-label="Full screen preview" class="fixed inset-0 z-[100] flex flex-col bg-[#0B1220]/90 backdrop-blur-sm">
        {/* ══ Top bar ══ */}
        <div class="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-[#0F1B2D] border-b border-white/10 shadow-lg">
          <p class="flex-1 min-w-0 truncate text-sm font-semibold text-white" title={props.title}>
            {props.title || "Preview"}
          </p>
          <Show when={!mobile()}>
            <div class="flex items-center rounded-lg bg-white/5 p-0.5" role="group" aria-label="Zoom">
              <For each={ZOOMS}>
                {(z) => (
                  <button
                    type="button"
                    aria-pressed={zoom() === z.key}
                    onClick={() => setZoom(z.key)}
                    class={
                      "px-3 py-1.5 rounded-md text-xs font-semibold transition-colors " +
                      (zoom() === z.key ? "bg-white text-[#0F1B2D]" : "text-white/80 hover:bg-white/10")
                    }
                  >
                    {z.label}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <span title={props.dlTitle}>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#AC2334] text-white text-sm font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              disabled={!props.canDownload || props.dlBusy}
              onClick={() => props.onDownload()}
            >
              <Show when={props.dlBusy} fallback={<Download size={15} />}>
                <Spinner class="w-4 h-4" />
              </Show>
              <span class="hidden sm:inline">Download PDF</span>
            </button>
          </span>
          <button type="button" class={BAR_BTN} onClick={openInTab} title="Open in new tab">
            <ExternalLink size={15} /> <span class="hidden sm:inline">Open in new tab</span>
          </button>
          <button type="button" class={BAR_BTN} onClick={() => props.onClose()} aria-label="Close full screen">
            <X size={18} />
          </button>
        </div>

        <Show when={props.dlError}>
          <div class="px-4 pt-3 flex items-start gap-3 max-w-3xl w-full mx-auto">
            <div class="flex-1">
              <InlineError message={props.dlError.message} lines={props.dlError.lines} />
            </div>
            <button type="button" class="mt-2 text-xs font-semibold text-white/70 hover:text-white" onClick={() => props.onDismissDlError()}>
              Dismiss
            </button>
          </div>
        </Show>

        {/* ══ Pages ══ */}
        <div class="flex-1 overflow-auto py-6">
          <div class="relative mx-auto" style={{ width: `${pageW()}px`, height: `${docH() * scale()}px` }}>
            <iframe
              ref={frame}
              title="Proposal preview, full screen"
              sandbox="allow-same-origin"
              srcdoc={props.html}
              onLoad={() => {
                const h = frameHeight(frame);
                if (h) setDocH(h);
              }}
              class="absolute top-0 left-0 border-0"
              style={{
                width: `${PAGE_W}px`,
                height: `${docH()}px`,
                transform: `scale(${scale()})`,
                "transform-origin": "0 0",
              }}
            />
          </div>
        </div>
      </div>
    </Portal>
  );
}
