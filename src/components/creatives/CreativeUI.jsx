import {
  createSignal,
  createEffect,
  createResource,
  on,
  onCleanup,
  For,
  Show,
} from "solid-js";
import {
  KINDS,
  fetchNomenOptions,
  fetchProjectOptions,
  presetRange,
} from "../../services/creatives";

// ─── Shared pieces for the Creative Library screens ───────────────────────────
// Same palette as every other staff screen: crimson #AC2334, navy #14233A,
// slate #54657E / #8593A8, hairline #E2E8F1.

export const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 " +
  "bg-white dark:bg-gray-800 text-sm text-[#14233A] dark:text-gray-100 " +
  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none " +
  "disabled:opacity-50 transition";

export const LABEL =
  "block text-xs font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-400 mb-1.5";

export const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white text-sm font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap";

export const GHOST_BTN =
  "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-[#14233A] dark:text-gray-200 hover:bg-[#F8FAFC] dark:hover:bg-gray-700 disabled:opacity-40 transition-colors whitespace-nowrap";

// ── Page shell ────────────────────────────────────────────────────────────────
export function PageShell(props) {
  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            {props.eyebrow ?? "Creatives"}
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            {props.title}
          </h1>
          <Show when={props.subtitle}>
            <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
              {props.subtitle}
            </p>
          </Show>
        </div>
        <Show when={props.actions}>
          <div class="flex flex-wrap gap-2">{props.actions}</div>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

export function ErrorBox(props) {
  return (
    <Show when={props.message}>
      <div class="mb-5 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300">
        {props.message}
      </div>
    </Show>
  );
}

// ── Copy ──────────────────────────────────────────────────────────────────────
const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / non-secure contexts: textarea fallback.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
};

export function CopyButton(props) {
  const [copied, setCopied] = createSignal(false);
  let timer;
  onCleanup(() => clearTimeout(timer));
  const onClick = async (e) => {
    // Rows are clickable (they open the detail page); copying must not navigate.
    e.stopPropagation();
    if (!props.text) return;
    if (await copyText(props.text)) {
      setCopied(true);
      clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy code"
      class={
        props.big
          ? "inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#0d1828] transition-colors"
          : "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#E2E8F1] dark:border-gray-600 text-[11px] font-bold uppercase tracking-wide text-[#54657E] dark:text-gray-300 hover:border-[#AC2334] hover:text-[#AC2334] transition-colors"
      }
    >
      {copied() ? "Copied" : "Copy"}
    </button>
  );
}

// Code chip + copy button, the way a code appears everywhere on these screens.
export function CodeCell(props) {
  return (
    <span class="inline-flex items-center gap-2 whitespace-nowrap">
      <span class="font-mono font-semibold text-[#14233A] dark:text-gray-100">
        {props.code || "—"}
      </span>
      <Show when={props.code}>
        <CopyButton text={props.code} />
      </Show>
    </span>
  );
}

export function StatusPill(props) {
  return (
    <span
      class={
        "inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide " +
        (props.active
          ? "bg-[#E7F5EC] text-[#1E7B45] dark:bg-green-900/30 dark:text-green-300"
          : "bg-[#F1F4F8] text-[#8593A8] dark:bg-gray-700 dark:text-gray-400")
      }
    >
      {props.active ? "Active" : "Inactive"}
    </span>
  );
}

export function OneDriveLink(props) {
  return (
    <Show when={props.url} fallback={<span class="text-[#8593A8]">—</span>}>
      <a
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        class="inline-flex items-center gap-1 text-[#3E6FB0] dark:text-blue-300 font-semibold hover:underline whitespace-nowrap"
      >
        Open
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>
    </Show>
  );
}

// ── Date presets ──────────────────────────────────────────────────────────────
// value: { preset: "7d" | "30d" | "custom", start, end }
export const defaultRange = () => ({ preset: "7d", ...presetRange(7) });

export function DatePresets(props) {
  const btn = (active) =>
    "px-3 py-2 text-sm font-semibold rounded-md transition-colors " +
    (active
      ? "bg-white dark:bg-gray-700 text-[#AC2334] shadow-sm"
      : "text-[#54657E] dark:text-gray-300 hover:text-[#14233A]");
  const v = () => props.value;
  const pick = (preset) => {
    if (preset === "7d") props.onChange({ preset, ...presetRange(7) });
    else if (preset === "30d") props.onChange({ preset, ...presetRange(30) });
    else props.onChange({ ...v(), preset: "custom" });
  };
  return (
    <div class="flex flex-wrap items-end gap-2">
      <div>
        <label class={LABEL}>Date range</label>
        <div class="inline-flex p-1 rounded-lg bg-[#EEF2F7] dark:bg-gray-800">
          <button type="button" class={btn(v().preset === "7d")} onClick={() => pick("7d")}>
            Last 7 days
          </button>
          <button type="button" class={btn(v().preset === "30d")} onClick={() => pick("30d")}>
            Last 30 days
          </button>
          <button type="button" class={btn(v().preset === "custom")} onClick={() => pick("custom")}>
            Custom
          </button>
        </div>
      </div>
      <Show when={v().preset === "custom"}>
        <div>
          <label class={LABEL}>From</label>
          <input
            type="date"
            class={FIELD}
            value={v().start}
            max={v().end}
            onChange={(e) => e.target.value && props.onChange({ ...v(), start: e.target.value })}
          />
        </div>
        <div>
          <label class={LABEL}>To</label>
          <input
            type="date"
            class={FIELD}
            value={v().end}
            min={v().start}
            onChange={(e) => e.target.value && props.onChange({ ...v(), end: e.target.value })}
          />
        </div>
      </Show>
    </div>
  );
}

// ── Kind select ───────────────────────────────────────────────────────────────
export function KindSelect(props) {
  return (
    <select
      class={FIELD}
      value={props.value ?? ""}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    >
      <Show when={props.allowAll}>
        <option value="">All types</option>
      </Show>
      <For each={KINDS}>{(k) => <option value={k.value}>{k.label}</option>}</For>
    </select>
  );
}

// ── Client nomen picker (searchable, server-side) ─────────────────────────────
// value: { id, name } | null.  /options/nomens/?q= does the search.
export function NomenPicker(props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [debounced, setDebounced] = createSignal("");
  let timer;
  let wrap;

  createEffect(
    on(query, (q) => {
      clearTimeout(timer);
      timer = setTimeout(() => setDebounced(q.trim()), 250);
    }),
  );

  const [options] = createResource(
    () => (open() ? { q: debounced() } : false),
    ({ q }) => fetchNomenOptions(q).catch(() => []),
  );

  const onDocClick = (e) => {
    if (wrap && !wrap.contains(e.target)) setOpen(false);
  };
  document.addEventListener("mousedown", onDocClick);
  onCleanup(() => {
    clearTimeout(timer);
    document.removeEventListener("mousedown", onDocClick);
  });

  const choose = (opt) => {
    props.onChange(opt);
    setQuery("");
    setOpen(false);
  };

  return (
    <div class="relative" ref={wrap}>
      <input
        type="text"
        class={FIELD}
        disabled={props.disabled}
        placeholder={props.placeholder ?? "Search client…"}
        value={open() ? query() : props.value?.name ?? ""}
        onFocus={() => setOpen(true)}
        onInput={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      <Show when={props.value && props.clearable && !props.disabled}>
        <button
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-[#8593A8] hover:text-[#AC2334] text-lg leading-none px-1"
          title="Clear"
          onClick={() => choose(null)}
        >
          ×
        </button>
      </Show>
      <Show when={open()}>
        <div class="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
          <Show
            when={!options.loading}
            fallback={<p class="px-3 py-3 text-sm text-[#8593A8]">Loading…</p>}
          >
            <Show
              when={(options() ?? []).length}
              fallback={<p class="px-3 py-3 text-sm text-[#8593A8]">No clients match.</p>}
            >
              <For each={options()}>
                {(opt) => (
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2 text-sm text-[#14233A] dark:text-gray-100 hover:bg-[#FBEEF0] dark:hover:bg-gray-800 transition-colors"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose({ id: opt.id, name: opt.name });
                    }}
                  >
                    {opt.name}
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ── Project select (depends on a nomen) ───────────────────────────────────────
// Default list = projects this nomen runs campaigns for. showAll adds &all=1,
// every project — for a creative made before its campaign exists.
export function ProjectSelect(props) {
  const [projects] = createResource(
    () => (props.nomenId ? { id: props.nomenId, all: !!props.showAll } : false),
    ({ id, all }) => fetchProjectOptions(id, all).catch(() => []),
  );

  // Drop a selection the new list no longer contains (client changed, or the
  // "show all" list was narrowed back).
  createEffect(() => {
    const list = projects();
    if (!list || props.value == null || props.value === "") return;
    if (!list.some((p) => String(p.id) === String(props.value))) props.onChange("");
  });

  const label = (p) => (p.city ? `${p.name} · ${p.city}` : p.name);

  return (
    <select
      class={FIELD}
      disabled={props.disabled || !props.nomenId || projects.loading}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value)}
    >
      <option value="">
        {!props.nomenId
          ? "Pick a client first"
          : projects.loading
            ? "Loading…"
            : props.allLabel ?? "Select project"}
      </option>
      <For each={projects() ?? []}>
        {(p) => (
          <option
            value={String(p.id)}
            selected={String(p.id) === String(props.value ?? "")}
          >
            {label(p)}
            {props.showAll && p.linked === false ? " (no campaigns yet)" : ""}
          </option>
        )}
      </For>
    </select>
  );
}

// ── Project filter (Library / Ranking) ────────────────────────────────────────
// options: [{ id, name }] from distinctProjects() — no API call of its own.
// A selection that drops out of the options (client changed) is cleared.
export function ProjectFilter(props) {
  createEffect(() => {
    const opts = props.options ?? [];
    const v = props.value;
    if (props.loading || v == null || v === "") return;
    if (!opts.some((p) => String(p.id) === String(v))) props.onChange("");
  });
  return (
    <select
      class={FIELD}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value)}
    >
      <option value="">All projects</option>
      <For each={props.options ?? []}>
        {(p) => (
          <option value={String(p.id)} selected={String(p.id) === String(props.value ?? "")}>
            {p.name}
          </option>
        )}
      </For>
    </select>
  );
}

// ── Table shell ───────────────────────────────────────────────────────────────
// cols: [{ label, align?: "right" }]. Children are the <tr>s.
export function DataTable(props) {
  return (
    <div class="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700">
      <table class="w-full text-sm table-auto">
        <thead class="bg-[#F8FAFC] dark:bg-gray-800">
          <tr class="[&_th]:whitespace-nowrap [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:px-4 [&_th]:py-3.5 text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700">
            <For each={props.cols}>
              {(c) => <th class={c.align === "right" ? "text-right" : "text-left"}>{c.label}</th>}
            </For>
          </tr>
        </thead>
        <tbody class="[&_td]:px-4 [&_td]:py-3 text-[#14233A] dark:text-gray-200">
          <Show
            when={!props.loading}
            fallback={
              <For each={[1, 2, 3, 4]}>
                {() => (
                  <tr class="border-t border-[#E2E8F1] dark:border-gray-700 animate-pulse">
                    <For each={props.cols}>
                      {() => (
                        <td>
                          <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            }
          >
            <Show
              when={!props.empty}
              fallback={
                <tr>
                  <td colSpan={props.cols.length} class="!py-10 text-center text-[#8593A8]">
                    {props.emptyText ?? "Nothing to show."}
                  </td>
                </tr>
              }
            >
              {props.children}
            </Show>
          </Show>
        </tbody>
      </table>
    </div>
  );
}

export const ROW =
  "border-t border-[#E2E8F1] dark:border-gray-700 hover:bg-[#FBF7F8] dark:hover:bg-gray-700/40 transition-colors";
export const NUM = "text-right tabular-nums whitespace-nowrap";

export function StatCard(props) {
  return (
    <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-5">
      <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
        {props.label}
      </p>
      <p class="text-2xl font-bold mt-1.5 tracking-tight text-[#14233A] dark:text-white tabular-nums">
        {props.value}
      </p>
    </div>
  );
}

export function SectionTitle(props) {
  return (
    <div class="mt-8 mb-3">
      <h2 class="text-lg font-bold text-[#14233A] dark:text-white">{props.children}</h2>
      <Show when={props.note}>
        <p class="text-sm text-[#54657E] dark:text-gray-400">{props.note}</p>
      </Show>
    </div>
  );
}
