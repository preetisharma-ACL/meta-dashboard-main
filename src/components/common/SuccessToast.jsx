import { createSignal, For, Show, onCleanup } from "solid-js";

// Module-level state → any file can import showToast and fire it.
const [toast, setToast] = createSignal(null); // { title, message }
const [toastVisible, setToastVisible] = createSignal(false);
const [confetti, setConfetti] = createSignal([]);
let toastTimer;

const CONFETTI_COLORS = [
  "#1e3a8a", "#3b82f6", "#60a5fa", "#93c5fd", // blues
  "#f59e0b", "#ec4899", "#10b981", "#a855f7", // party accents
];

export const showToast = (message, title = "Saved successfully") => {
  clearTimeout(toastTimer);
  setConfetti(
    Array.from({ length: 22 }, (_, i) => ({
      left: 10 + Math.random() * 80,
      drift: `${-70 + Math.random() * 140}px`,
      delay: `${Math.random() * 0.25}s`,
      duration: `${1.1 + Math.random() * 0.9}s`,
      size: `${5 + Math.random() * 6}px`,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      round: Math.random() > 0.5,
    })),
  );
  setToast({ message, title });
  requestAnimationFrame(() => setToastVisible(true));
  toastTimer = setTimeout(() => {
    setToastVisible(false);
    setTimeout(() => setToast(null), 300);
  }, 4500);
};

export default function SuccessToast() {

  return (
    <Show when={toast()}>
      <div
        class={`fixed top-6 right-6 z-[100] transition-all duration-300 ease-out ${
          toastVisible()
            ? "opacity-100 translate-y-0 scale-100"
            : "opacity-0 -translate-y-3 scale-95"
        }`}
      >
        {/* Card */}
        <div class="relative overflow-hidden w-[370px] max-w-[calc(100vw-3rem)] rounded-2xl border border-blue-300/60 dark:border-blue-800/70 bg-gradient-to-b from-blue-50/90 to-white dark:from-blue-950/40 dark:to-gray-900 shadow-xl shadow-blue-900/10 dark:shadow-black/40 backdrop-blur-xl">
          <div class="flex items-start gap-3 px-4 py-4">
            <div class="toast-pop w-10 h-10 rounded-xl bg-blue-900 dark:bg-blue-400 flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-900/30">
              <span class="text-lg leading-none">🎉</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-bold text-blue-900 dark:text-blue-300">
                {toast().title}
              </p>
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-0.5 leading-snug">
                {toast().message}
              </p>
            </div>
            <button
              onClick={() => {
                clearTimeout(toastTimer);
                setToastVisible(false);
                setTimeout(() => setToast(null), 300);
              }}
              class="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-blue-900 dark:hover:text-blue-300 hover:bg-blue-100/60 dark:hover:bg-blue-900/30 transition-colors flex-shrink-0"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="absolute bottom-0 left-0 h-1 rounded-r-full bg-gradient-to-r from-blue-900 to-blue-500 dark:from-blue-400 dark:to-blue-300 toast-timer" />
        </div>

        {/* Confetti — after the card + z-20 so it bursts on top */}
        <div class="pointer-events-none absolute -top-2 left-0 right-0 h-0 z-20">
          <For each={confetti()}>
            {(p) => (
              <span
                class="confetti-piece absolute"
                style={{
                  left: `${p.left}%`,
                  width: p.size,
                  height: p.size,
                  background: p.color,
                  "border-radius": p.round ? "50%" : "2px",
                  "--drift": p.drift,
                  "animation-delay": p.delay,
                  "animation-duration": p.duration,
                }}
              />
            )}
          </For>
        </div>
      </div>
      <style>{`
        .toast-timer { animation: toast-shrink 4.5s linear forwards; }
        @keyframes toast-shrink { from { width: 100%; } to { width: 0%; } }
        .toast-pop { animation: toast-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes toast-pop {
          0% { transform: scale(0) rotate(-30deg); }
          70% { transform: scale(1.15) rotate(8deg); }
          100% { transform: scale(1) rotate(0); }
        }
        .confetti-piece {
          top: 0; opacity: 0;
          animation-name: confetti-burst;
          animation-timing-function: ease-out;
          animation-fill-mode: forwards;
        }
        @keyframes confetti-burst {
          0%   { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
          15%  { transform: translate(calc(var(--drift) * 0.4), -28px) rotate(120deg) scale(1.1); }
          100% { opacity: 0; transform: translate(var(--drift), 140px) rotate(720deg) scale(0.6); }
        }
      `}</style>
    </Show>
  );
}