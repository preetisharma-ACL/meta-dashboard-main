import { Show } from "solid-js";
import { Info } from "lucide-solid";

// Totals tile shared by Campaign Analysis and CPL Rules.
// Icon chip + accent per tile. Purely visual — the tone never encodes state.
const TILE_TONES = {
  navy: {
    chip: "bg-[#EEF2F7] text-[#14233A] ring-[#D4DDE9] dark:bg-[#1A2B45] dark:text-[#A9C1E0] dark:ring-[#2A3E5C]",
    accent: "#3E6FB0",
  },
  emerald: {
    chip: "bg-[#E9F7F1] text-[#15966A] ring-[#C6EBDB] dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800/50",
    accent: "#15966A",
  },
  slate: {
    chip: "bg-[#F1F4F9] text-[#3E6FB0] ring-[#D4DDE9] dark:bg-slate-800 dark:text-[#7FA1CD] dark:ring-slate-700",
    accent: "#3E6FB0",
  },
  crimson: {
    chip: "bg-[#FBEEF0] text-[#AC2334] ring-[#F3CBD1] dark:bg-red-900/30 dark:text-[#E4566A] dark:ring-red-800/50",
    accent: "#AC2334",
  },
  gold: {
    chip: "bg-[#FBF3E2] text-[#B07A14] ring-[#F0DDB3] dark:bg-amber-900/30 dark:text-[#E9AE5C] dark:ring-amber-800/50",
    accent: "#C4802B",
  },
};

export default function StatTile(props) {
  const tone = () => TILE_TONES[props.tone] ?? TILE_TONES.navy;
  const Icon = props.icon;
  return (
    <div class="group relative font-sans bg-white dark:bg-gray-900 rounded-xl border border-[#E2E8F1] dark:border-gray-700 px-4 py-4 shadow-[0_1px_2px_rgba(20,35,58,0.04)] hover:shadow-[0_6px_18px_rgba(20,35,58,0.08)] transition-shadow duration-200"
      style={{ "--tile-accent": tone().accent }}
    >
      <span class="tile-trace" aria-hidden="true" />
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p
            class="flex items-center gap-1 text-[13px] font-medium text-gray-600 dark:text-gray-300 truncate"
            title={props.note}
          >
            {props.label}
            <Show when={props.note}>
              <Info
                size={12}
                class="flex-none text-[#B6C2D3] dark:text-gray-500 cursor-help"
                aria-hidden="true"
              />
            </Show>
          </p>
          <p class={`mt-1.5 text-xl font-semibold tabular-nums ${props.valueClass || "text-gray-800 dark:text-gray-50"}`}>
            {props.value}
          </p>
          <Show when={props.sub}>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate">{props.sub}</p>
          </Show>
        </div>
        <Show when={Icon}>
          <span
            class={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ring-1 ring-inset ${tone().chip}`}
          >
            <Icon size={19} stroke-width={2} />
          </span>
        </Show>
      </div>
    </div>
  );
}

