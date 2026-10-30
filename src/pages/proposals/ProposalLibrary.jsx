import { createSignal, createResource, createEffect, createMemo, For, Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { BookOpen, History, Eye, RotateCcw } from "lucide-solid";
import {
  fetchLibrary,
  fetchLibraryEntry,
  saveLibraryEntry,
  fetchLibraryRevision,
  restoreLibraryRevision,
  fmtWhen,
  nameOf,
  humanize,
} from "../../services/proposals";
import { loadErrorMessage, errorMessage } from "../../utils/apiErrors";
import { PageShell, ErrorBox } from "../../components/creatives/CreativeUI";
import {
  CARD,
  PanelTitle,
  Modal,
  ConfirmDialog,
  InlineError,
  Spinner,
  FIELD,
  LABEL,
  PRIMARY_BTN,
  GHOST_BTN,
  SMALL_BTN,
} from "../../components/proposals/ProposalUI";
import ShapeEditor, { ROOT_TEMPLATES } from "../../components/proposals/ShapeEditor";

// ─── Proposal library (/proposals/library) — admin only ───────────────────────
// The shared text every proposal PDF draws on: developers, about, contacts,
// per-category guides and the three T&C sets. Pick an entry on the left, edit
// it as a form (an "Advanced JSON" toggle is there for structural changes),
// save with a short note. Every save is a revision; History can view one
// read-only or restore it.
//
// Shapes (confirmed by the backend):
//   list      data[] {key, title, updated_at, updated_by (name), revisions (COUNT)}
//   item      {key, title, value, updated_at, placeholders[],
//              revisions[] {id, note, created_at, by}}   ← here a LIST
//   revision  {id, value, note, created_at, by}
//   restore   POST {revision: <id>}

const rowTitle = (r) => r?.title || humanize(r?.key);
const rowBy = (r) => r?.updated_by ?? "";
const rowAt = (r) => r?.updated_at;
const rowRevs = (r) => r?.revisions;
const revId = (rv) => rv?.id;

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export default function ProposalLibrary() {
  const [search, setSearch] = useSearchParams();
  const [list, { refetch: refetchList }] = createResource(fetchLibrary);
  const rows = () => (list.error ? [] : list() ?? []);
  const selected = () => search.key || "";

  // Land on the first entry when nothing is picked.
  createEffect(() => {
    if (!selected() && rows().length) setSearch({ key: rows()[0].key }, { replace: true });
  });

  return (
    <PageShell
      icon={BookOpen}
      title="Proposal library"
      subtitle="Shared text every proposal draws on. Changes apply to PDFs made after you save."
    >
      <ErrorBox message={list.error ? `Could not load the library. ${loadErrorMessage(list.error)}` : ""} onRetry={refetchList} />
      <div class="grid grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)] gap-4 items-start">
        <nav class={CARD + " p-2 lg:sticky lg:top-3"} aria-label="Library entries">
          <Show
            when={!list.loading || rows().length}
            fallback={
              <div class="p-2 space-y-2">
                <For each={[1, 2, 3, 4, 5]}>{() => <div class="h-12 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />}</For>
              </div>
            }
          >
            <For each={rows()} fallback={<p class="p-3 text-sm text-[#8593A8]">No entries.</p>}>
              {(r) => (
                <button
                  type="button"
                  onClick={() => setSearch({ key: r.key })}
                  aria-current={selected() === r.key ? "page" : undefined}
                  class={
                    "w-full text-left rounded-lg px-3 py-2.5 transition-colors " +
                    (selected() === r.key
                      ? "bg-[#FBEEF0] dark:bg-red-900/20"
                      : "hover:bg-[#F8FAFC] dark:hover:bg-gray-700/50")
                  }
                >
                  <span class={"block text-sm font-semibold " + (selected() === r.key ? "text-[#AC2334] dark:text-red-300" : "text-[#14233A] dark:text-gray-100")}>
                    {rowTitle(r)}
                  </span>
                  <span class="block text-[11px] text-[#8593A8] dark:text-gray-400 mt-0.5">
                    {[rowBy(r), rowAt(r) ? fmtWhen(rowAt(r)) : null].filter(Boolean).join(" · ") || "Not edited yet"}
                    <Show when={rowRevs(r) != null}>
                      {" · "}
                      {rowRevs(r)} revision{Number(rowRevs(r)) === 1 ? "" : "s"}
                    </Show>
                  </span>
                </button>
              )}
            </For>
          </Show>
        </nav>

        <Show when={selected()} keyed>
          {(key) => <EntryEditor entryKey={key} onSaved={refetchList} />}
        </Show>
      </div>
    </PageShell>
  );
}

function EntryEditor(props) {
  const [entry, setEntry] = createSignal(null);
  const [loadError, setLoadError] = createSignal(null);
  const [value, setValue] = createSignal(null);
  const [note, setNote] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [flash, setFlash] = createSignal("");
  const [advanced, setAdvanced] = createSignal(false);
  const [jsonText, setJsonText] = createSignal("");
  const [jsonError, setJsonError] = createSignal("");
  const [viewing, setViewing] = createSignal(null); // { rev, value | null, error }
  const [restoring, setRestoring] = createSignal(null);

  const adopt = (d) => {
    setEntry(d);
    setValue(JSON.parse(JSON.stringify(d?.value ?? null)));
    setAdvanced(false);
    setJsonError("");
  };

  const load = async () => {
    setLoadError(null);
    try {
      adopt(await fetchLibraryEntry(props.entryKey));
    } catch (err) {
      setLoadError(err);
    }
  };
  load();

  const dirty = createMemo(() => entry() && !same(value(), entry().value));

  // Text box last focused, for the placeholder chips.
  let lastText = null;
  const insertToken = (token) => {
    if (!lastText?.el || !document.contains(lastText.el)) return;
    const el = lastText.el;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? s;
    lastText.set(el.value.slice(0, s) + token + el.value.slice(e));
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange?.(s + token.length, s + token.length);
    });
  };
  const placeholders = () =>
    (entry()?.placeholders ?? []).map((p) => {
      const s = typeof p === "string" ? p : p?.key ?? p?.name ?? "";
      return s.startsWith("{") ? s : `{${s}}`;
    });

  const toggleAdvanced = () => {
    if (!advanced()) {
      setJsonText(JSON.stringify(value(), null, 2));
      setJsonError("");
      setAdvanced(true);
      return;
    }
    try {
      setValue(JSON.parse(jsonText()));
      setAdvanced(false);
      setJsonError("");
    } catch (err) {
      setJsonError(`Not valid JSON: ${err.message}`);
    }
  };

  const save = async () => {
    if (!note().trim() || busy()) return;
    let v = value();
    if (advanced()) {
      try {
        v = JSON.parse(jsonText());
      } catch (err) {
        return setJsonError(`Not valid JSON: ${err.message}`);
      }
    }
    setBusy(true);
    setError("");
    try {
      const d = await saveLibraryEntry(props.entryKey, v, note().trim());
      adopt(d?.value !== undefined ? d : await fetchLibraryEntry(props.entryKey));
      setNote("");
      setFlash("Saved.");
      setTimeout(() => setFlash(""), 2500);
      props.onSaved?.();
    } catch (err) {
      setError(err?.status === 403 ? "Only admins can edit the library." : errorMessage(err, "Could not save."));
    } finally {
      setBusy(false);
    }
  };

  const view = async (rv) => {
    setViewing({ rev: rv, value: null, error: "" });
    try {
      const d = await fetchLibraryRevision(props.entryKey, revId(rv));
      setViewing({ rev: rv, value: d?.value !== undefined ? d.value : d, error: "" });
    } catch (err) {
      setViewing({ rev: rv, value: null, error: errorMessage(err, "Could not load this revision.") });
    }
  };

  const revisions = () => entry()?.revisions ?? [];

  return (
    <div class="space-y-4 min-w-0">
      <Show
        when={entry()}
        fallback={
          <Show
            when={loadError()}
            fallback={
              <div class={CARD + " p-10 grid place-items-center text-sm text-[#54657E]"}>
                <span class="inline-flex items-center gap-2">
                  <Spinner /> Loading…
                </span>
              </div>
            }
          >
            <ErrorBox message={`Could not load this entry. ${loadErrorMessage(loadError())}`} onRetry={load} />
          </Show>
        }
      >
        <div class={CARD + " p-5"}>
          <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white">{entry().title || humanize(props.entryKey)}</h2>
              <p class="text-xs text-[#8593A8] dark:text-gray-400 font-mono">{props.entryKey}</p>
            </div>
            <label class="inline-flex items-center gap-2 text-xs font-semibold text-[#54657E] dark:text-gray-300 cursor-pointer">
              <input type="checkbox" class="accent-[#AC2334]" checked={advanced()} onChange={toggleAdvanced} />
              Advanced JSON
            </label>
          </div>

          <Show when={placeholders().length && !advanced()}>
            <div class="mb-4 rounded-lg bg-[#F8FAFC] dark:bg-gray-900/40 border border-[#E2E8F1] dark:border-gray-700 px-3 py-2.5">
              <p class="text-[11px] text-[#54657E] dark:text-gray-400 mb-1.5">Click to insert into the text box you were in:</p>
              <div class="flex flex-wrap gap-1.5">
                <For each={placeholders()}>
                  {(p) => (
                    <button
                      type="button"
                      class="px-2 py-0.5 rounded-full text-xs font-mono font-semibold bg-[#ECF2FA] text-[#3E6FB0] hover:bg-[#3E6FB0] hover:text-white dark:bg-blue-900/30 dark:text-blue-300"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertToken(p)}
                    >
                      {p}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show
            when={!advanced()}
            fallback={
              <div>
                <textarea
                  class={FIELD + " font-mono text-xs min-h-[28rem] leading-relaxed"}
                  aria-label="Value as JSON"
                  spellcheck={false}
                  value={jsonText()}
                  onInput={(e) => setJsonText(e.target.value)}
                />
                <InlineError message={jsonError()} />
              </div>
            }
          >
            <ShapeEditor
              value={value()}
              template={ROOT_TEMPLATES[props.entryKey]}
              tagRoot={props.entryKey === "developers"}
              onChange={setValue}
              onFocusText={(t) => (lastText = t)}
            />
          </Show>
        </div>

        {/* ══ Save bar ══ */}
        <div class={CARD + " p-4 sticky bottom-3 z-10 shadow-[0_4px_18px_rgba(20,35,58,0.10)]"}>
          <form
            class="flex flex-col sm:flex-row sm:items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div class="flex-1">
              <label class={LABEL} for="lib-note">What changed</label>
              <input
                id="lib-note"
                class={FIELD}
                placeholder="Short reason, e.g. updated helpline number"
                value={note()}
                onInput={(e) => setNote(e.target.value)}
              />
            </div>
            <div class="flex gap-2">
              <button type="button" class={GHOST_BTN} disabled={busy() || (!dirty() && !advanced())} onClick={() => adopt(entry())}>
                Discard
              </button>
              <button type="submit" class={PRIMARY_BTN} disabled={busy() || !note().trim() || (!dirty() && !advanced())}>
                {busy() ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
          <div class="mt-2">
            <InlineError message={error()} />
            <Show when={flash()}>
              <p class="text-sm font-semibold text-[#15966A] dark:text-green-300">{flash()}</p>
            </Show>
            <Show when={dirty() && !note().trim()}>
              <p class="text-xs text-[#8593A8] dark:text-gray-400">Add a short note to save.</p>
            </Show>
          </div>
        </div>

        {/* ══ History ══ */}
        <div class={CARD + " p-4"}>
          <PanelTitle>
            <span class="inline-flex items-center gap-1.5">
              <History size={14} /> History
            </span>
          </PanelTitle>
          <Show when={revisions().length} fallback={<p class="text-sm text-[#8593A8]">No revisions yet.</p>}>
            <ul class="divide-y divide-[#E2E8F1] dark:divide-gray-700">
              <For each={revisions()}>
                {(rv) => (
                  <li class="py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div class="min-w-0">
                      <p class="text-sm text-[#14233A] dark:text-gray-100">{rv.note || "—"}</p>
                      <p class="text-[11px] text-[#8593A8] dark:text-gray-400">
                        {[nameOf(rv.by), fmtWhen(rv.created_at)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div class="flex gap-1.5">
                      <button type="button" class={SMALL_BTN} onClick={() => view(rv)}>
                        <Eye size={13} /> View
                      </button>
                      <button type="button" class={SMALL_BTN} onClick={() => setRestoring(rv)}>
                        <RotateCcw size={13} /> Restore
                      </button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>

      <Modal
        open={!!viewing()}
        title={`Revision${viewing()?.rev?.note ? `: ${viewing().rev.note}` : ""}`}
        width="max-w-4xl"
        onClose={() => setViewing(null)}
      >
        <p class="text-xs text-[#8593A8] dark:text-gray-400 mb-3">
          {[nameOf(viewing()?.rev?.by), fmtWhen(viewing()?.rev?.created_at)].filter(Boolean).join(" · ")} · read only
        </p>
        <Show when={viewing()?.error}>
          <InlineError message={viewing().error} />
        </Show>
        <Show
          when={viewing()?.value !== null && viewing()?.value !== undefined}
          fallback={
            <Show when={!viewing()?.error}>
              <div class="py-10 grid place-items-center text-sm text-[#54657E]">
                <Spinner />
              </div>
            </Show>
          }
        >
          <div class="max-h-[65vh] overflow-y-auto pr-1">
            <ShapeEditor
              value={viewing().value}
              template={ROOT_TEMPLATES[props.entryKey]}
              tagRoot={props.entryKey === "developers"}
              readOnly
              onChange={() => {}}
            />
          </div>
        </Show>
      </Modal>

      <ConfirmDialog
        open={!!restoring()}
        title="Restore revision"
        message={`Restore "${restoring()?.note || "this revision"}" as the current text?${dirty() ? " Unsaved edits on this page are lost." : ""}`}
        confirmLabel="Restore"
        onConfirm={async () => {
          const d = await restoreLibraryRevision(props.entryKey, revId(restoring()));
          adopt(d?.value !== undefined ? d : await fetchLibraryEntry(props.entryKey));
          props.onSaved?.();
        }}
        onClose={() => setRestoring(null)}
      />
    </div>
  );
}
