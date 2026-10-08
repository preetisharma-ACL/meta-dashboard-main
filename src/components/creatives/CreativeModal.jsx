import { createSignal, createResource, createEffect, For, Show } from "solid-js";
import {
  createCreative,
  updateCreative,
  fetchCodePreview,
  kindLabel,
  canWriteCreatives,
  campaignStyleName,
  createProject,
} from "../../services/creatives";
import { errorBanner } from "../../utils/apiErrors";
import {
  FIELD,
  LABEL,
  PRIMARY_BTN,
  GHOST_BTN,
  KindSelect,
  NomenPicker,
  ProjectSelect,
  CopyButton,
} from "./CreativeUI";

// ─── Add / edit a creative ────────────────────────────────────────────────────
// ADD: type, client nomen, project, title, OneDrive link, notes. Once client +
// project + type are picked, /code-preview/ shows the code the next save would
// get — NOT reserved, so it is labelled as a preview. On success the real code
// is shown big with a Copy button, because the next thing the person does is
// paste it into a Meta ad name.
//
// 409 needs_confirmation = this OneDrive link is already in the library
// (existing_code names it). Confirm, then resend the SAME body with confirm:true.
//
// EDIT: only title / link / notes / active. Code, type, client and project are
// fixed once created (the backend 400s if they are sent) and are shown read
// only with the note telling people what to do instead.
//
// Props: open, creative? (edit mode), onClose(), onSaved(row)

export default function CreativeModal(props) {
  const isEdit = () => !!props.creative;

  const [kind, setKind] = createSignal("video");
  const [nomen, setNomen] = createSignal(null);
  const [projectId, setProjectId] = createSignal("");
  const [showAll, setShowAll] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [active, setActive] = createSignal(true);

  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [dupe, setDupe] = createSignal(null); // existing_code awaiting confirm
  const [savedCode, setSavedCode] = createSignal(null);
  const [extraProjects, setExtraProjects] = createSignal([]); // injected into the dropdown
  const [newOpen, setNewOpen] = createSignal(false);
  const [newProject, setNewProject] = createSignal(null); // made via "+ New project"

  // Reset whenever the modal opens.
  createEffect(() => {
    if (!props.open) return;
    const c = props.creative;
    setKind(c?.kind ?? "video");
    setNomen(null);
    setProjectId("");
    setShowAll(false);
    setTitle(c?.title ?? "");
    setUrl(c?.onedrive_url ?? "");
    setNotes(c?.notes ?? "");
    setActive(c ? c.is_active !== false : true);
    setSaving(false);
    setError("");
    setDupe(null);
    setSavedCode(null);
    setExtraProjects([]);
    setNewOpen(false);
    setNewProject(null);
  });

  const [preview] = createResource(
    () =>
      props.open && !isEdit() && nomen()?.id && projectId() && kind()
        ? { nomen_id: nomen().id, project_id: projectId(), kind: kind() }
        : false,
    (p) => fetchCodePreview(p).catch(() => null),
  );

  const canSubmit = () =>
    !saving() &&
    title().trim() &&
    url().trim() &&
    (isEdit() || (nomen()?.id && projectId()));

  const submit = async (confirm = false) => {
    if (!canSubmit()) return;
    setSaving(true);
    setError("");
    try {
      if (isEdit()) {
        const row = await updateCreative(props.creative.id, {
          title: title().trim(),
          onedrive_url: url().trim(),
          notes: notes(),
          is_active: active(),
        });
        props.onSaved?.(row);
        props.onClose();
        return;
      }
      const body = {
        nomen_id: nomen().id,
        project_id: Number(projectId()) || projectId(),
        kind: kind(),
        title: title().trim(),
        onedrive_url: url().trim(),
        notes: notes(),
      };
      if (confirm) body.confirm = true;
      const row = await createCreative(body);
      setDupe(null);
      setSavedCode(row?.code ?? "");
      props.onSaved?.(row);
    } catch (err) {
      // The flag may sit top-level or inside the error envelope; read both.
      const d = err?.data ?? {};
      const info = d.needs_confirmation ? d : d.error?.needs_confirmation ? d.error : d.data;
      if (err?.status === 409 && info?.needs_confirmation) {
        setDupe(info.existing_code || "an existing creative");
      } else {
        setError(errorBanner(err, {}, "Could not save the creative."));
      }
    } finally {
      setSaving(false);
    }
  };

  const ReadOnly = (p) => (
    <div>
      <span class={LABEL}>{p.label}</span>
      <div class="px-3 py-2.5 rounded-lg bg-[#F1F4F8] dark:bg-gray-700/50 text-sm text-[#14233A] dark:text-gray-200 font-medium">
        {p.value || "—"}
      </div>
    </div>
  );

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto"
        onMouseDown={(e) => e.target === e.currentTarget && !saving() && props.onClose()}
      >
        <div class="w-full max-w-xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-[#E2E8F1] dark:border-gray-700">
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700">
            <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
              {savedCode() != null ? "Creative saved" : isEdit() ? "Edit creative" : "Add creative"}
            </h2>
            <button
              type="button"
              class="text-2xl leading-none text-[#8593A8] hover:text-[#AC2334]"
              onClick={() => props.onClose()}
              disabled={saving()}
            >
              ×
            </button>
          </div>

          {/* ── Success: the code, big ── */}
          <Show when={savedCode() != null}>
            <div class="px-6 py-8 text-center">
              <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#8593A8]">Creative code</p>
              <p class="mt-2 font-mono text-4xl sm:text-5xl font-bold tracking-tight text-[#AC2334] break-all">
                {savedCode() || "—"}
              </p>
              <div class="mt-5">
                <CopyButton text={savedCode()} big />
              </div>
              <p class="mt-6 text-sm text-[#54657E] dark:text-gray-300">
                CMs must start the Meta AD name with this code, e.g.{" "}
                <span class="font-mono font-semibold text-[#14233A] dark:text-white">
                  {savedCode()} | short description
                </span>
              </p>
              <button type="button" class={GHOST_BTN + " mt-6"} onClick={() => props.onClose()}>
                Done
              </button>
            </div>
          </Show>

          {/* ── Form ── */}
          <Show when={savedCode() == null}>
            <form
              class="px-6 py-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit(false);
              }}
            >
              <Show
                when={!isEdit()}
                fallback={
                  <div class="space-y-3">
                    <div class="grid grid-cols-2 gap-3">
                      <ReadOnly label="Code" value={props.creative.code} />
                      <ReadOnly label="Type" value={kindLabel(props.creative.kind)} />
                      <ReadOnly
                        label="Client"
                        value={props.creative.client_nomen}
                      />
                      <ReadOnly
                        label="Project"
                        value={props.creative.project}
                      />
                    </div>
                    <p class="text-xs text-[#8593A8] dark:text-gray-400">
                      Fixed once created. Add a new creative instead.
                    </p>
                  </div>
                }
              >
                <div>
                  <label class={LABEL}>Type</label>
                  <KindSelect value={kind()} onChange={setKind} />
                </div>
                <div>
                  <label class={LABEL}>Client nomen</label>
                  <NomenPicker
                    value={nomen()}
                    onChange={(v) => {
                      setNomen(v);
                      setProjectId("");
                      // A project made or picked for the old client doesn't
                      // belong in the new client's list.
                      setExtraProjects([]);
                      setNewProject(null);
                      setNewOpen(false);
                    }}
                  />
                </div>
                <div>
                  <div class="flex items-center justify-between gap-3 mb-1.5">
                    <label class={LABEL + " !mb-0"}>Project</label>
                    <div class="flex items-center gap-3">
                      <Show when={canWriteCreatives() && nomen()?.id && !newOpen()}>
                        <button
                          type="button"
                          class="text-xs font-bold text-[#AC2334] hover:underline"
                          onClick={() => setNewOpen(true)}
                        >
                          + New project
                        </button>
                      </Show>
                      <label class="inline-flex items-center gap-1.5 text-xs font-semibold text-[#54657E] dark:text-gray-400 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          class="w-3.5 h-3.5 accent-[#AC2334]"
                          checked={showAll()}
                          onChange={(e) => setShowAll(e.target.checked)}
                        />
                        Show all projects
                      </label>
                    </div>
                  </div>
                  <ProjectSelect
                    nomenId={nomen()?.id}
                    showAll={showAll()}
                    extra={extraProjects()}
                    value={projectId()}
                    onChange={setProjectId}
                  />
                  <Show when={newOpen() && nomen()?.id}>
                    <NewProjectPanel
                      nomenId={nomen().id}
                      onClose={() => setNewOpen(false)}
                      onPicked={(p, made) => {
                        setExtraProjects((xs) => [
                          p,
                          ...xs.filter((x) => String(x.id) !== String(p.id)),
                        ]);
                        setProjectId(String(p.id));
                        setNewProject(made ? p : null);
                        setNewOpen(false);
                      }}
                    />
                  </Show>
                  <Show when={newProject() && String(newProject().id) === String(projectId())}>
                    <div class="mt-2 rounded-lg border border-[#3E6FB0]/30 bg-[#ECF2FA] dark:bg-blue-900/20 px-3 py-2.5 text-sm text-[#14233A] dark:text-blue-100">
                      Tell the CM to use exactly{" "}
                      <span class="font-mono font-bold">{newProject().name}</span> as the
                      project in the campaign name, e.g.{" "}
                      <span class="font-mono">
                        ClientName | {newProject().name} | ...
                      </span>{" "}
                      (same capitals), so it links to this project.
                    </div>
                  </Show>
                </div>
                <Show when={nomen()?.id && projectId()}>
                  <div class="rounded-lg border border-dashed border-[#D4DDE9] dark:border-gray-600 px-4 py-3">
                    <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8]">Code preview</p>
                    <p class="font-mono text-lg font-bold text-[#14233A] dark:text-white">
                      {preview.loading ? "…" : preview() || "—"}
                    </p>
                    <p class="text-xs text-[#8593A8]">Final code shown after saving.</p>
                  </div>
                </Show>
              </Show>

              <div>
                <label class={LABEL}>Title</label>
                <input
                  class={FIELD}
                  value={title()}
                  onInput={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Sea-view 3BHK walkthrough"
                />
              </div>
              <div>
                <label class={LABEL}>OneDrive link</label>
                <input
                  class={FIELD}
                  type="url"
                  value={url()}
                  onInput={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div>
                <label class={LABEL}>Notes</label>
                <textarea
                  class={FIELD}
                  rows={3}
                  value={notes()}
                  onInput={(e) => setNotes(e.target.value)}
                />
              </div>
              <Show when={isEdit()}>
                <label class="inline-flex items-center gap-2 text-sm font-semibold text-[#14233A] dark:text-gray-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    class="w-4 h-4 accent-[#AC2334]"
                    checked={active()}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  Active
                </label>
              </Show>

              <Show when={error()}>
                <div class="rounded-lg border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 px-3 py-2 text-sm font-medium text-[#AC2334] dark:text-red-300">
                  {error()}
                </div>
              </Show>

              <Show when={dupe()}>
                <div class="rounded-lg border border-[#D89A2B]/40 bg-[#FDF6E9] dark:bg-yellow-900/20 px-4 py-3 text-sm text-[#7A5410] dark:text-yellow-200">
                  <p class="font-semibold">
                    This OneDrive link is already in the library as{" "}
                    <span class="font-mono">{dupe()}</span>.
                  </p>
                  <p class="mt-0.5">Save it as a separate creative anyway?</p>
                  <div class="mt-3 flex gap-2">
                    <button
                      type="button"
                      class={PRIMARY_BTN}
                      disabled={saving()}
                      onClick={() => submit(true)}
                    >
                      Yes, save anyway
                    </button>
                    <button type="button" class={GHOST_BTN} onClick={() => setDupe(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </Show>

              <Show when={!dupe()}>
                <div class="flex justify-end gap-2 pt-2">
                  <button type="button" class={GHOST_BTN} onClick={() => props.onClose()} disabled={saving()}>
                    Cancel
                  </button>
                  <button type="submit" class={PRIMARY_BTN} disabled={!canSubmit()}>
                    {saving() ? "Saving…" : isEdit() ? "Save changes" : "Save creative"}
                  </button>
                </div>
              </Show>
            </form>
          </Show>
        </div>
      </div>
    </Show>
  );
}

// ── "+ New project" ───────────────────────────────────────────────────────────
// POST /creatives/options/projects/ {name, nomen_id, confirm?}. The backend
// saves the name in campaign style; the "Will be saved as" line previews that
// rule, and the name in the response is what actually gets used.
//   201 created / 200 reused → onPicked(project, true)
//   409 similar names        → offer them (picking one → onPicked(p, false)),
//                              or "Create new anyway" = resend with confirm:true
//   400                      → show detail
// Lives inside the creative <form>: every button is type="button" and Enter in
// the input is caught here, so neither submits the creative.
function NewProjectPanel(props) {
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [similar, setSimilar] = createSignal(null);

  const preview = () => campaignStyleName(name());

  const create = async (confirm = false) => {
    if (!name().trim() || busy()) return;
    setBusy(true);
    setError("");
    try {
      const p = await createProject({
        name: name().trim(),
        nomen_id: props.nomenId,
        confirm,
      });
      if (!p?.id) throw new Error("The project was not returned.");
      props.onPicked(p, true);
    } catch (err) {
      const d = err?.data ?? {};
      const info = d.needs_confirmation ? d : d.error?.needs_confirmation ? d.error : d.data;
      if (err?.status === 409 && info?.needs_confirmation) {
        setSimilar(info.similar ?? []);
      } else {
        setError(errorBanner(err, {}, "Could not create the project."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="mt-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-[#F8FAFC] dark:bg-gray-800/60 p-3 space-y-2">
      <div class="flex gap-2">
        <input
          class={FIELD}
          placeholder="New project name, e.g. noida event"
          value={name()}
          autofocus
          onInput={(e) => {
            setName(e.target.value);
            setSimilar(null);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create(false);
            }
          }}
        />
        <button
          type="button"
          class={PRIMARY_BTN + " !py-2"}
          disabled={!name().trim() || busy()}
          onClick={() => create(false)}
        >
          {busy() ? "…" : "Create"}
        </button>
        <button type="button" class={GHOST_BTN + " !py-2"} onClick={() => props.onClose()}>
          Cancel
        </button>
      </div>
      <Show when={preview()}>
        <p class="text-xs text-[#54657E] dark:text-gray-400">
          Will be saved as:{" "}
          <span class="font-mono font-bold text-[#14233A] dark:text-white">{preview()}</span>
        </p>
      </Show>
      <Show when={error()}>
        <p class="text-sm font-medium text-[#AC2334] dark:text-red-300">{error()}</p>
      </Show>
      <Show when={similar()}>
        <div class="rounded-md border border-[#D89A2B]/40 bg-[#FDF6E9] dark:bg-yellow-900/20 px-3 py-2.5 text-sm text-[#7A5410] dark:text-yellow-200">
          <p class="font-semibold">Similar projects already exist. Use one of these?</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <For each={similar()}>
              {(p) => (
                <button
                  type="button"
                  class="px-2.5 py-1 rounded-md bg-white dark:bg-gray-800 border border-[#D89A2B]/50 font-mono text-sm font-semibold text-[#14233A] dark:text-gray-100 hover:border-[#AC2334] hover:text-[#AC2334]"
                  onClick={() => props.onPicked({ id: p.id, name: p.name }, false)}
                >
                  {p.name}
                </button>
              )}
            </For>
          </div>
          <button
            type="button"
            class={GHOST_BTN + " !py-1.5 mt-3"}
            disabled={busy()}
            onClick={() => create(true)}
          >
            Create new anyway
          </button>
        </div>
      </Show>
    </div>
  );
}
