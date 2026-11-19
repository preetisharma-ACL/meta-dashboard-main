import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useDialog } from "../../utils/useDialog";

// ─── The UPI QR, with click to enlarge ────────────────────────────────────────
// One component for both places the QR appears: the client's bank transfer tab
// and the staff Bank details preview. They had the same thumbnail markup twice
// and would have grown two different lightboxes.
//
// WHY ENLARGING MATTERS HERE: the uploaded image is a PORTRAIT STANDEE, not a
// bare square code. At thumbnail size the actual QR is a small fraction of the
// picture, which is not reliably scannable from a phone held up to a monitor.
// So the thumbnail is a target, not the thing itself, and it says so.
//
// Both sizes use object-contain. Forcing the standee square crops the UPI id
// printed under the code, which is the fallback for anyone whose camera will
// not read the QR.
//
// The popup renders through a Portal, so it is never clipped by an ancestor's
// overflow. It sits at z-[70], above the Pay modal (z-50) it can be opened
// from and above the review dialogs (z-[60]).
//
// Props: src, alt?, thumbClass?

export default function QrViewer(props) {
  const [open, setOpen] = createSignal(false);
  const alt = () => props.alt ?? "UPI QR code";

  let box;
  // Esc closes it, Tab stays inside, and focus returns to the thumbnail on
  // close. The same stack the other dialogs use, so an Esc with the Pay modal
  // underneath closes only the TOP one.
  useDialog(
    () => open(),
    () => setOpen(false),
    () => box,
  );

  return (
    <Show when={props.src}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${alt()}. Click to enlarge`}
        class="group block w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 rounded-lg"
      >
        <img
          src={props.src}
          alt={alt()}
          loading="lazy"
          class={
            props.thumbClass ??
            "mx-auto max-h-72 w-auto object-contain rounded-lg border border-gray-100 dark:border-gray-700 bg-white transition-transform group-hover:scale-[1.02]"
          }
        />
        <span class="mt-2 block text-center text-[11px] font-semibold text-gray-500 dark:text-gray-400">
          Tap to enlarge
        </span>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            class="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8"
            style={{
              background: "rgba(0,0,0,0.8)",
              "backdrop-filter": "blur(4px)",
            }}
            // Clicking the backdrop closes it. The test is on the target being
            // the backdrop ITSELF, so a click that lands on the image inside
            // does not close the thing the person is trying to look at.
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div
              ref={box}
              role="dialog"
              aria-modal="true"
              aria-label={alt()}
              class="relative max-h-full max-w-full flex flex-col items-center gap-3"
            >
              <button
                type="button"
                data-autofocus
                onClick={() => setOpen(false)}
                aria-label="Close"
                class="absolute -top-2 -right-2 sm:-top-3 sm:-right-3 z-10 w-9 h-9 rounded-full bg-white text-gray-700 shadow-lg flex items-center justify-center hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white transition-colors"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>

              {/* Fit to screen, aspect ratio kept. max-h/max-w on the image
                  itself (rather than a fixed size) is what makes a tall
                  standee fill the height and a wide one fill the width,
                  without either being stretched. */}
              <img
                src={props.src}
                alt={alt()}
                class="max-h-[85vh] max-w-full w-auto h-auto object-contain rounded-xl bg-white shadow-2xl"
              />
            </div>
          </div>
        </Portal>
      </Show>
    </Show>
  );
}
