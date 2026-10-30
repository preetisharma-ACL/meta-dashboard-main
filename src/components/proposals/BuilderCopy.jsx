import { createSignal, Index, Show } from "solid-js";
import { ChevronDown, AlertTriangle } from "lucide-solid";
import { CARD, FIELD, LABEL, CharCount, TagInput } from "./ProposalUI";
import { humanize } from "../../services/proposals";

// ─── Builder: "Edit text" (the copy slots) ────────────────────────────────────
// Each slot is counted against slot_limits — list items by their shared key
// (prop_title, audience_text, chip, snapshot_value, …), single slots by their
// own key — and turns red past it. over_limit[] (slot keys the server found too
// long) is shown above the fold so it's seen with the panel closed. Lists are
// sent whole. Fixed-size lists show their full count of rows even before the
// AI has written them.
//
// Props: detail, copy, setCopyKey(key, value)

const SINGLE = [
  { key: "headline" },
  { key: "lede", multiline: true },
  { key: "project_line" },
  { key: "project_description", multiline: true },
];
const LISTS = [
  { key: "props", label: "Selling points", count: 3, a: "title", b: "text", limitA: "prop_title", limitB: "prop_text" },
  { key: "snapshot", label: "Snapshot", count: 6, a: "label", b: "value", limitA: "snapshot_label", limitB: "snapshot_value" },
  { key: "audiences", label: "Audiences", count: 4, a: "title", b: "text", limitA: "audience_title", limitB: "audience_text" },
  { key: "approach", label: "Approach", count: 4, a: "title", b: "text", limitA: "approach_title", limitB: "approach_text" },
];
const TAIL = [{ key: "creative_direction", multiline: true }, { key: "acceptance_headline" }];

export default function BuilderCopy(props) {
  const overLimit = () => props.detail?.over_limit ?? [];
  const [open, setOpen] = createSignal(false);
  const limit = (key) => props.detail?.slot_limits?.[key] ?? null;

  const listOf = (spec) => {
    const v = props.copy?.[spec.key];
    const rows = Array.isArray(v) ? v : [];
    if (rows.length >= spec.count) return rows;
    return [...rows, ...Array.from({ length: spec.count - rows.length }, () => ({ [spec.a]: "", [spec.b]: "" }))];
  };
  // The padding rows are display only: trailing rows still entirely blank are
  // dropped before sending, so an empty slot isn't saved as "".
  const setItem = (spec, i, field, value) => {
    const next = listOf(spec).map((r, j) => (j === i ? { ...r, [field]: value } : { ...r }));
    const blank = (r) => !String(r?.[spec.a] ?? "").trim() && !String(r?.[spec.b] ?? "").trim();
    while (next.length && blank(next[next.length - 1])) next.pop();
    props.setCopyKey(spec.key, next);
  };

  const Single = (p) => (
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <label class={LABEL + " !mb-0"} for={`pc-${p.spec.key}`}>{humanize(p.spec.key)}</label>
        <CharCount value={props.copy?.[p.spec.key]} limit={limit(p.spec.key)} />
      </div>
      <Show
        when={p.spec.multiline}
        fallback={
          <input
            id={`pc-${p.spec.key}`}
            data-field={`content.${p.spec.key}`}
            class={FIELD}
            value={props.copy?.[p.spec.key] ?? ""}
            onInput={(e) => props.setCopyKey(p.spec.key, e.target.value)}
          />
        }
      >
        <textarea
          id={`pc-${p.spec.key}`}
          data-field={`content.${p.spec.key}`}
          class={FIELD + " min-h-[5rem] leading-relaxed"}
          value={props.copy?.[p.spec.key] ?? ""}
          onInput={(e) => props.setCopyKey(p.spec.key, e.target.value)}
        />
      </Show>
    </div>
  );

  return (
    <div class={CARD}>
      <button
        type="button"
        class="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span class="text-xs font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-300">Edit text</span>
        <ChevronDown size={16} class={"text-[#54657E] transition-transform " + (open() ? "rotate-180" : "")} />
      </button>

      <Show when={overLimit().length}>
        <div class="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-sm text-[#AC2334] dark:text-red-300">
          <AlertTriangle size={16} class="flex-none mt-0.5" />
          <span>Too long: {overLimit().map(humanize).join(", ")}</span>
        </div>
      </Show>

      <Show when={open()}>
        <div class="px-4 pb-4 space-y-4">
          <p class="text-xs text-[#8593A8] dark:text-gray-400">
            Tip: wrap the project name in asterisks, like <span class="font-mono">*Project Name*</span>, and the PDF prints it in italic colour.
          </p>
          <Index each={SINGLE}>{(s) => <Single spec={s()} />}</Index>

          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class={LABEL + " !mb-0"}>Chips</span>
              <Show when={limit("chip")}>
                <span class="text-[11px] text-[#8593A8] dark:text-gray-400">up to {limit("chip")} characters each</span>
              </Show>
            </div>
            <TagInput
              value={Array.isArray(props.copy?.chips) ? props.copy.chips : []}
              limit={limit("chip")}
              placeholder="Add a tag and press Enter"
              onChange={(next) => props.setCopyKey("chips", next)}
            />
          </div>

          <Index each={LISTS}>
            {(spec) => (
              <div>
                <p class={LABEL}>{spec().label}</p>
                <div class="space-y-2">
                  <Index each={listOf(spec())}>
                    {(row, i) => (
                      <div class="rounded-lg border border-[#E2E8F1] dark:border-gray-700 p-2.5 space-y-2">
                        <div>
                          <div class="flex items-center justify-between mb-1">
                            <span class="text-[10px] font-bold uppercase tracking-wider text-[#8593A8]">
                              {i + 1}. {humanize(spec().a)}
                            </span>
                            <CharCount value={row()?.[spec().a]} limit={limit(spec().limitA)} />
                          </div>
                          <input
                            class={FIELD + " !py-2"}
                            aria-label={`${spec().label} ${i + 1} ${spec().a}`}
                            value={row()?.[spec().a] ?? ""}
                            onInput={(e) => setItem(spec(), i, spec().a, e.target.value)}
                          />
                        </div>
                        <div>
                          <div class="flex items-center justify-between mb-1">
                            <span class="text-[10px] font-bold uppercase tracking-wider text-[#8593A8]">{humanize(spec().b)}</span>
                            <CharCount value={row()?.[spec().b]} limit={limit(spec().limitB)} />
                          </div>
                          <Show
                            when={spec().b === "text"}
                            fallback={
                              <input
                                class={FIELD + " !py-2"}
                                aria-label={`${spec().label} ${i + 1} ${spec().b}`}
                                value={row()?.[spec().b] ?? ""}
                                onInput={(e) => setItem(spec(), i, spec().b, e.target.value)}
                              />
                            }
                          >
                            <textarea
                              class={FIELD + " !py-2 min-h-[4rem] leading-relaxed"}
                              aria-label={`${spec().label} ${i + 1} ${spec().b}`}
                              value={row()?.[spec().b] ?? ""}
                              onInput={(e) => setItem(spec(), i, spec().b, e.target.value)}
                            />
                          </Show>
                        </div>
                      </div>
                    )}
                  </Index>
                </div>
              </div>
            )}
          </Index>

          <Index each={TAIL}>{(s) => <Single spec={s()} />}</Index>
        </div>
      </Show>
    </div>
  );
}
