import { createSignal, createEffect, on, onMount, onCleanup, Show } from "solid-js";
import { RefreshCw } from "lucide-solid";
import { fetchProposalPreview } from "../../services/proposals";
import { errorMessage } from "../../utils/apiErrors";
import { CARD, Spinner } from "./ProposalUI";

// ─── Builder: live preview (right panel) ──────────────────────────────────────
// GET preview → {html} in an <iframe srcdoc>. The page is laid out 794 px wide
// (A4) × 5 pages, so the frame is rendered at that size and scaled down to the
// panel with a CSS transform. Refetched (debounced) whenever `tick` moves —
// the builder bumps it after every save / confirm / chat / undo / restore.
// A 400 means there are no numbers yet: its message is shown instead.
//
// sandbox="allow-same-origin" without allow-scripts: the page can't run code,
// but its height can still be read once it has laid out.
//
// Props: id, tick

const PAGE_W = 794;
const A4_H = 1123;
const DEBOUNCE = 600;

export default function BuilderPreview(props) {
  const [html, setHtml] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [width, setWidth] = createSignal(PAGE_W);
  const [docH, setDocH] = createSignal(A4_H * 5);
  let box;
  let frame;
  let timer;
  let seq = 0;

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
    try {
      const doc = frame?.contentDocument;
      const h = Math.max(doc?.documentElement?.scrollHeight ?? 0, doc?.body?.scrollHeight ?? 0);
      if (h > 0) setDocH(h);
    } catch {
      /* cross-origin: keep the 5-page default */
    }
  };

  return (
    <div class={CARD + " flex flex-col min-h-[420px] xl:h-[calc(100vh-9.5rem)] xl:sticky xl:top-3"}>
      <div class="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F1] dark:border-gray-700">
        <h2 class="text-xs font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-300">Preview</h2>
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
      </div>
      <div class="flex-1 overflow-y-auto bg-[#EEF1F5] dark:bg-gray-900 p-3">
        <div ref={box} class="w-full">
          <Show when={error()}>
            <div class="rounded-lg border border-[#D89A2B]/40 bg-[#FDF6E9] dark:bg-yellow-900/20 px-4 py-3 text-sm text-[#7A5410] dark:text-yellow-200">
              {error()}
            </div>
          </Show>
          <Show when={!error() && html()}>
            <div
              class="relative overflow-hidden shadow-[0_2px_10px_rgba(20,35,58,0.12)] bg-white"
              style={{ width: `${PAGE_W * scale()}px`, height: `${docH() * scale()}px` }}
            >
              <iframe
                ref={frame}
                title="Proposal preview"
                sandbox="allow-same-origin"
                srcdoc={html()}
                onLoad={measure}
                class="absolute top-0 left-0 border-0 bg-white"
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
    </div>
  );
}
