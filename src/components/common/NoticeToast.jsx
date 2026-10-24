import { createSignal, Show } from "solid-js";

// ─── Plain notice toast ───────────────────────────────────────────────────────
// For outcomes that aren't a celebration (SuccessToast throws confetti): an
// amber warning or a neutral info line. Module-level, so any file can fire it;
// <NoticeToast /> is mounted once in the app layout.
//   showNotice("Moved to Dead clients")            neutral
//   showNotice("Campaign still live…", "warn")     amber
const [notice, setNotice] = createSignal(null); // { message, tone }
let timer;

export const showNotice = (message, tone = "info") => {
  clearTimeout(timer);
  setNotice({ message, tone });
  timer = setTimeout(() => setNotice(null), tone === "warn" ? 8000 : 4500);
};

const TONE = {
  warn: "border-[#B07A14]/40 bg-[#FBF3E2] text-[#8A6410] dark:bg-yellow-900/40 dark:border-yellow-700 dark:text-yellow-100",
  info: "border-gray-300 bg-white text-gray-800 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100",
};

export default function NoticeToast() {
  return (
    <Show when={notice()}>
      <div
        role={notice().tone === "warn" ? "alert" : "status"}
        class={`fixed top-20 right-4 left-4 sm:left-auto z-[100] sm:max-w-sm flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
          TONE[notice().tone] ?? TONE.info
        }`}
      >
        <span aria-hidden="true">{notice().tone === "warn" ? "⚠" : "✓"}</span>
        <span class="flex-1">{notice().message}</span>
        <button
          type="button"
          onClick={() => setNotice(null)}
          aria-label="Dismiss"
          class="flex-none font-bold opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </Show>
  );
}
