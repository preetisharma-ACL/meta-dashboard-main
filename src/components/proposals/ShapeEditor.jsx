import { For, Index, Show, Switch, Match } from "solid-js";
import { Plus, X, ArrowUp, ArrowDown } from "lucide-solid";
import { FIELD, SMALL_BTN, TagInput } from "./ProposalUI";
import { humanize } from "../../services/proposals";

// ─── Library editor: a form drawn from the value's own shape ──────────────────
// Library values are nested JSON (T&C sections with clauses, per-category
// guides, contacts…). Rather than one hand-built form per key, the editor walks
// the value: strings → input / textarea, string lists → rows (or tags for the
// developer list), object lists → cards with add / remove / reorder, objects →
// labelled groups. TEMPLATES fill in the keys the spec promises for a shape
// (a section with no bullets yet still shows a Bullets list) and give "Add" a
// complete blank; keys only shown from a template are written only once typed
// into, so an untouched entry saves back unchanged.
//
// Props: value, onChange(next), template, readOnly, onFocusText({el, set}),
//        tagRoot (render a root string list as tags)

const CLAUSE = { num: "", title: "", text: "", bullets: [], highlight: "" };
const SECTION = { num: "", title: "", intro: "", text: "", bullets: [], highlight: "", clauses: [] };
const TNC = { title: "", intro: "", note: "", sections: [] };
const GUIDE = { audiences: [], creative: "", lead_questions: [], product_word: "" };
const CATEGORIES = ["plots", "apartments", "floors", "villas", "farmhouse", "commercial", "event"];

// Root template per library key; list-item templates by the list's key.
export const ROOT_TEMPLATES = {
  tnc_cpl: { ...TNC, note_gst_inclusive: "" },
  tnc_retainership: TNC,
  tnc_pass_through: TNC,
  category_guides: Object.fromEntries(CATEGORIES.map((c) => [c, GUIDE])),
  contacts: {
    business_head: { name: "", role: "", phone: "", email: "" },
    company: { name: "", helpline: "", web: "" },
  },
};
const ITEM_TEMPLATES = { sections: SECTION, clauses: CLAUSE, stats: { value: "", label: "" } };

const LONG_KEYS = new Set(["text", "intro", "note", "note_gst_inclusive", "paragraph", "body", "creative", "description", "about", "highlight", "summary"]);

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const blankLike = (v) => {
  if (Array.isArray(v)) return [];
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankLike(x)]));
  if (typeof v === "number") return null;
  if (typeof v === "boolean") return false;
  return "";
};
const kind = (v, t) => {
  const x = v ?? t;
  if (Array.isArray(x)) return "array";
  if (isObj(x)) return "object";
  if (typeof x === "boolean") return "bool";
  if (typeof x === "number") return "number";
  return "string";
};

export default function ShapeEditor(props) {
  return <Node value={props.value} template={props.template} name="" depth={0} ctx={props} onChange={props.onChange} root />;
}

function Node(props) {
  return (
    <Switch>
      <Match when={kind(props.value, props.template) === "object"}>
        <ObjectNode {...props} />
      </Match>
      <Match when={kind(props.value, props.template) === "array"}>
        <ArrayNode {...props} />
      </Match>
      <Match when={kind(props.value, props.template) === "bool"}>
        <input
          type="checkbox"
          class="accent-[#AC2334] w-4 h-4"
          checked={!!props.value}
          disabled={props.ctx.readOnly}
          onChange={(e) => props.onChange(e.target.checked)}
        />
      </Match>
      <Match when={true}>
        <TextNode {...props} />
      </Match>
    </Switch>
  );
}

function TextNode(props) {
  const long = () => LONG_KEYS.has(props.name) || String(props.value ?? "").length > 70 || String(props.value ?? "").includes("\n");
  const numeric = () => typeof props.value === "number";
  const set = (raw) => {
    if (numeric()) {
      const n = Number(raw);
      props.onChange(raw === "" ? null : Number.isFinite(n) ? n : raw);
    } else props.onChange(raw);
  };
  const focus = (e) => props.ctx.onFocusText?.({ el: e.currentTarget, set: (v) => props.onChange(v) });
  return (
    <Show
      when={long()}
      fallback={
        <input
          class={FIELD + " !py-2"}
          aria-label={humanize(props.name) || "Value"}
          inputmode={numeric() ? "decimal" : undefined}
          value={props.value ?? ""}
          readOnly={props.ctx.readOnly}
          onFocus={focus}
          onInput={(e) => set(e.target.value)}
        />
      }
    >
      <textarea
        class={FIELD + " !py-2 min-h-[4.5rem] leading-relaxed"}
        aria-label={humanize(props.name) || "Value"}
        value={props.value ?? ""}
        readOnly={props.ctx.readOnly}
        onFocus={focus}
        onInput={(e) => set(e.target.value)}
      />
    </Show>
  );
}

function ObjectNode(props) {
  const obj = () => (isObj(props.value) ? props.value : {});
  const tpl = () => (isObj(props.template) ? props.template : {});
  const keys = () => {
    const ks = Object.keys(obj());
    for (const k of Object.keys(tpl())) if (!ks.includes(k)) ks.push(k);
    return ks;
  };
  const setKey = (k, v) => props.onChange({ ...obj(), [k]: v });
  // Scalars sit in a 2-column grid; lists and groups take the full width.
  const wide = (k) => {
    const kd = kind(obj()[k], tpl()[k]);
    return kd === "array" || kd === "object" || LONG_KEYS.has(k) || String(obj()[k] ?? "").length > 70;
  };
  return (
    <div class={"grid grid-cols-1 sm:grid-cols-2 gap-3 " + (props.root ? "" : "")}>
      <For each={keys()}>
        {(k) => (
          <div class={wide(k) ? "sm:col-span-2" : ""}>
            <Show
              when={kind(obj()[k], tpl()[k]) === "object"}
              fallback={
                <>
                  <p class="block text-[11px] font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-400 mb-1">{humanize(k)}</p>
                  <Node value={obj()[k]} template={tpl()[k]} name={k} depth={props.depth + 1} ctx={props.ctx} onChange={(v) => setKey(k, v)} />
                </>
              }
            >
              <fieldset class="rounded-lg border border-[#E2E8F1] dark:border-gray-700 p-3">
                <legend class="px-1 text-xs font-bold uppercase tracking-wider text-[#14233A] dark:text-gray-200">{humanize(k)}</legend>
                <Node value={obj()[k]} template={tpl()[k]} name={k} depth={props.depth + 1} ctx={props.ctx} onChange={(v) => setKey(k, v)} />
              </fieldset>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

function ArrayNode(props) {
  const arr = () => (Array.isArray(props.value) ? props.value : []);
  const itemTpl = () => ITEM_TEMPLATES[props.name] ?? (arr().length ? blankLike(arr()[0]) : "");
  const strings = () => arr().every((x) => x == null || typeof x !== "object") && !isObj(itemTpl());
  const setAt = (i, v) => props.onChange(arr().map((x, j) => (j === i ? v : x)));
  const drop = (i) => props.onChange(arr().filter((_, j) => j !== i));
  const move = (i, d) => {
    const next = [...arr()];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    props.onChange(next);
  };
  const add = () => props.onChange([...arr(), JSON.parse(JSON.stringify(itemTpl()))]);

  return (
    <Switch>
      {/* The developer list (root) reads best as tags. */}
      <Match when={props.ctx.tagRoot && props.root && strings()}>
        <Show
          when={!props.ctx.readOnly}
          fallback={<p class="text-sm text-[#14233A] dark:text-gray-200">{arr().join(", ") || "—"}</p>}
        >
          <TagInput value={arr()} onChange={props.onChange} placeholder="Add a name and press Enter" />
        </Show>
      </Match>
      <Match when={strings()}>
        <div class="space-y-1.5">
          <Index each={arr()}>
            {(x, i) => (
              <div class="flex items-start gap-1.5">
                <div class="flex-1">
                  <TextNode value={x()} name={props.name} ctx={props.ctx} onChange={(v) => setAt(i, v)} />
                </div>
                <Show when={!props.ctx.readOnly}>
                  <RowTools i={i} n={arr().length} onMove={move} onDrop={drop} />
                </Show>
              </div>
            )}
          </Index>
          <Show when={!props.ctx.readOnly}>
            <button type="button" class={SMALL_BTN} onClick={add}>
              <Plus size={13} /> Add
            </button>
          </Show>
        </div>
      </Match>
      <Match when={true}>
        <div class="space-y-2">
          <Index each={arr()}>
            {(x, i) => (
              <div class="rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#FBFCFE] dark:bg-gray-800/60 p-3">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold text-[#54657E] dark:text-gray-400">
                    {humanize(props.name).replace(/s$/, "")} {i + 1}
                    <Show when={x()?.title}>
                      <span class="font-semibold text-[#14233A] dark:text-gray-200"> · {x().title}</span>
                    </Show>
                  </span>
                  <Show when={!props.ctx.readOnly}>
                    <RowTools i={i} n={arr().length} onMove={move} onDrop={drop} />
                  </Show>
                </div>
                <Node value={x()} template={itemTpl()} name={props.name} depth={props.depth + 1} ctx={props.ctx} onChange={(v) => setAt(i, v)} />
              </div>
            )}
          </Index>
          <Show when={!props.ctx.readOnly}>
            <button type="button" class={SMALL_BTN} onClick={add}>
              <Plus size={13} /> Add {humanize(props.name).replace(/s$/, "").toLowerCase() || "item"}
            </button>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

function RowTools(props) {
  const btn = "inline-flex items-center justify-center w-7 h-7 rounded-md text-[#8593A8] hover:text-[#14233A] hover:bg-[#F1F4F9] dark:hover:bg-gray-700 disabled:opacity-30";
  return (
    <div class="flex items-center gap-0.5 flex-none">
      <button type="button" class={btn} aria-label="Move up" disabled={props.i === 0} onClick={() => props.onMove(props.i, -1)}>
        <ArrowUp size={14} />
      </button>
      <button type="button" class={btn} aria-label="Move down" disabled={props.i === props.n - 1} onClick={() => props.onMove(props.i, 1)}>
        <ArrowDown size={14} />
      </button>
      <button type="button" class={btn + " hover:!text-[#AC2334] hover:!bg-[#FBEEF0]"} aria-label="Remove" onClick={() => props.onDrop(props.i)}>
        <X size={14} />
      </button>
    </div>
  );
}
