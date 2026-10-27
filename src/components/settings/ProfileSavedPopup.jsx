import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import { Check, ArrowRight, X } from "lucide-solid";

// ─── Profile saved — celebration popup ────────────────────────────────────────
// Shown by Settings after PATCH /auth/me/ succeeds. Lists exactly what changed
// (old → new) so the user can see the save landed, with party bubbles rising
// through the card and a confetti burst from the check badge. Brand colours
// throughout (crimson #AC2334 → gold #D89A2B).
//
// Props: data — null (closed) or { changes: [{ label, from, to }], emailChanged }
//        onClose — called on Done, ×, backdrop click, Esc, or the auto-close.

const AUTO_CLOSE_MS = 8000;

const BUBBLE_TINTS = [
  "172, 35, 52", // crimson
  "216, 154, 43", // gold
  "196, 85, 47", // ember
  "199, 158, 238", // lavender (the page wash)
  "233, 174, 92", // marigold
];
const CONFETTI_COLORS = ["#AC2334", "#D89A2B", "#C4552F", "#E9AE5C", "#7E1522", "#C79EEE"];

const makeBubbles = () =>
  Array.from({ length: 16 }, (_, i) => ({
    left: 4 + Math.random() * 92,
    size: 10 + Math.random() * 26,
    // Negative delays: most bubbles are already mid-rise when the card opens.
    delay: -3 + Math.random() * 3.5,
    duration: 3.2 + Math.random() * 2.6,
    sway: `${-18 + Math.random() * 36}px`,
    tint: BUBBLE_TINTS[i % BUBBLE_TINTS.length],
  }));

const makeConfetti = () =>
  Array.from({ length: 26 }, (_, i) => {
    const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.3;
    const dist = 70 + Math.random() * 70;
    return {
      x: `${Math.cos(angle) * dist}px`,
      y: `${Math.sin(angle) * dist}px`,
      size: 5 + Math.random() * 5,
      delay: Math.random() * 0.15,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      round: i % 3 === 0,
    };
  });

export default function ProfileSavedPopup(props) {
  const [visible, setVisible] = createSignal(false);
  const [bubbles, setBubbles] = createSignal([]);
  const [confetti, setConfetti] = createSignal([]);
  let timer;

  const close = () => {
    clearTimeout(timer);
    setVisible(false);
    setTimeout(() => props.onClose?.(), 220);
  };

  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  createEffect(() => {
    if (!props.data) return;
    setBubbles(makeBubbles());
    setConfetti(makeConfetti());
    requestAnimationFrame(() => setVisible(true));
    clearTimeout(timer);
    timer = setTimeout(close, AUTO_CLOSE_MS);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    });
  });

  return (
    <Show when={props.data}>
      <div
        class={`fixed inset-0 z-[120] flex items-center justify-center p-4 transition-opacity duration-200 ${
          visible() ? "opacity-100" : "opacity-0"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-saved-title"
      >
        <div
          class="absolute inset-0 bg-[#14233A]/40 dark:bg-black/60 backdrop-blur-sm"
          onClick={close}
        />

        <div
          class={`relative w-[420px] max-w-full overflow-hidden rounded-3xl border border-white/60 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-[0_24px_70px_-12px_rgba(126,21,34,0.35)] transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            visible() ? "scale-100 translate-y-0" : "scale-90 translate-y-4"
          }`}
        >
          {/* Brand wash behind the top half */}
          <div class="absolute inset-x-0 top-0 h-48 bg-[linear-gradient(110deg,rgba(172,35,52,0.12),rgba(216,154,43,0.16))] dark:bg-[linear-gradient(110deg,rgba(172,35,52,0.25),rgba(216,154,43,0.14))] [mask-image:linear-gradient(to_bottom,black_35%,transparent)]" />
          <div class="psp-rail absolute inset-x-0 top-0 h-[3px]" />

          {/* Party bubbles rising through the card */}
          <div class="pointer-events-none absolute inset-0 overflow-hidden">
            <For each={bubbles()}>
              {(b) => (
                <span
                  class="psp-bubble absolute rounded-full"
                  style={{
                    left: `${b.left}%`,
                    width: `${b.size}px`,
                    height: `${b.size}px`,
                    "--sway": b.sway,
                    "animation-delay": `${b.delay}s`,
                    "animation-duration": `${b.duration}s`,
                    background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95), rgba(${b.tint},0.30) 45%, rgba(${b.tint},0.12) 70%)`,
                    "box-shadow": `inset 0 0 0 1px rgba(${b.tint},0.35)`,
                  }}
                />
              )}
            </For>
          </div>

          <button
            type="button"
            onClick={close}
            aria-label="Close"
            class="absolute right-3 top-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-[#AC2334] hover:bg-white/80 dark:hover:bg-gray-700 transition-colors"
          >
            <X class="w-4 h-4" />
          </button>

          <div class="relative px-6 sm:px-8 pt-9 pb-6 text-center">
            {/* Check badge with pulse rings and a confetti burst */}
            <div class="relative mx-auto w-20 h-20">
              <span class="psp-ring absolute inset-0 rounded-full border-2 border-[#D89A2B]/60" />
              <span
                class="psp-ring absolute inset-0 rounded-full border-2 border-[#AC2334]/40"
                style={{ "animation-delay": "0.5s" }}
              />
              <div class="psp-pop relative w-20 h-20 rounded-full bg-[linear-gradient(135deg,#7E1522,#AC2334_45%,#D89A2B)] shadow-[0_10px_25px_-6px_rgba(172,35,52,0.55)] flex items-center justify-center ring-4 ring-white dark:ring-gray-800">
                <Check class="w-9 h-9 text-white" stroke-width={3} />
              </div>
              <div class="pointer-events-none absolute left-1/2 top-1/2">
                <For each={confetti()}>
                  {(c) => (
                    <span
                      class="psp-confetti absolute"
                      style={{
                        width: `${c.size}px`,
                        height: `${c.size}px`,
                        background: c.color,
                        "border-radius": c.round ? "50%" : "2px",
                        "--x": c.x,
                        "--y": c.y,
                        "animation-delay": `${c.delay}s`,
                      }}
                    />
                  )}
                </For>
              </div>
            </div>

            <h2
              id="profile-saved-title"
              class="mt-5 text-2xl font-bold tracking-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] to-[#C4802B] dark:from-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent"
            >
              Profile updated!
            </h2>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Your changes are saved.
            </p>

            <Show when={props.data?.changes?.length}>
              <ul class="mt-5 space-y-2 text-left">
                <For each={props.data.changes}>
                  {(c) => (
                    <li class="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white/90 dark:bg-gray-900/50 px-4 py-3 backdrop-blur">
                      <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#B57C1A] dark:text-amber-300">
                        {c.label}
                      </p>
                      {/* Old above new, each on its own line, so a long
                          email is never cut off on both sides of the arrow. */}
                      <p
                        class="mt-1 text-xs text-gray-400 line-through [overflow-wrap:anywhere]"
                        title={c.from}
                      >
                        {c.from || "Not set"}
                      </p>
                      <p class="mt-0.5 flex items-start gap-1.5 text-sm font-semibold text-gray-900 dark:text-white min-w-0">
                        <ArrowRight class="w-3.5 h-3.5 mt-[3px] shrink-0 text-[#D89A2B]" />
                        <span class="[overflow-wrap:anywhere]">
                          {c.to || "Removed"}
                        </span>
                      </p>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <Show when={props.data?.emailChanged}>
              <p class="mt-3 rounded-xl bg-[#FBF3E6] dark:bg-amber-900/20 px-4 py-2.5 text-xs font-medium text-[#8A5A10] dark:text-amber-300">
                Use your new email next time you sign in.
              </p>
            </Show>

            <button
              type="button"
              onClick={close}
              class="mt-6 w-full h-11 rounded-xl text-sm font-semibold text-white shadow-sm bg-[linear-gradient(115deg,#AC2334,#C4552F_60%,#D89A2B)] hover:shadow-md hover:brightness-105 transition"
            >
              Done
            </button>
          </div>

          {/* Auto-close countdown */}
          <div class="absolute bottom-0 left-0 h-[3px] w-full bg-gray-100 dark:bg-gray-700">
            <div
              class="psp-timer h-full bg-[linear-gradient(90deg,#AC2334,#D89A2B)]"
              style={{ "animation-duration": `${AUTO_CLOSE_MS}ms` }}
            />
          </div>
        </div>
      </div>

      <style>{`
        .psp-rail {
          background: linear-gradient(90deg, #AC2334, #C4552F, #D89A2B, #C4552F, #AC2334);
          background-size: 200% 100%;
          animation: psp-rail 3s linear infinite;
        }
        @keyframes psp-rail { from { background-position: 200% 0; } to { background-position: 0 0; } }

        .psp-bubble {
          bottom: -40px; opacity: 0;
          animation-name: psp-rise;
          animation-timing-function: ease-in;
          animation-iteration-count: infinite;
        }
        @keyframes psp-rise {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.6); }
          15%  { opacity: 0.9; }
          50%  { transform: translate(var(--sway), -260px) scale(1); }
          85%  { opacity: 0.7; }
          100% { opacity: 0; transform: translate(calc(var(--sway) * -0.5), -540px) scale(1.1); }
        }

        .psp-pop { animation: psp-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        @keyframes psp-pop {
          0%   { transform: scale(0) rotate(-40deg); }
          70%  { transform: scale(1.12) rotate(6deg); }
          100% { transform: scale(1) rotate(0); }
        }

        .psp-ring { animation: psp-ring 1.8s ease-out infinite; }
        @keyframes psp-ring {
          0%   { transform: scale(1); opacity: 0.9; }
          100% { transform: scale(1.7); opacity: 0; }
        }

        .psp-confetti {
          left: 0; top: 0; opacity: 0;
          animation: psp-burst 1.1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes psp-burst {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.4) rotate(0deg); }
          70%  { opacity: 1; }
          100% { opacity: 0; transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y) + 30px)) scale(1) rotate(540deg); }
        }

        .psp-timer { animation-name: psp-shrink; animation-timing-function: linear; animation-fill-mode: forwards; }
        @keyframes psp-shrink { from { width: 100%; } to { width: 0%; } }

        @media (prefers-reduced-motion: reduce) {
          .psp-rail, .psp-bubble, .psp-ring, .psp-confetti, .psp-pop { animation: none; }
          .psp-bubble, .psp-confetti { display: none; }
        }
      `}</style>
    </Show>
  );
}
