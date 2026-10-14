import { createResource, createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { A, useParams, useNavigate } from "@solidjs/router";
import {
  fetchControlMeta,
  fetchControlRecord,
  createControlRecord,
  updateControlRecord,
  fetchDeletePreview,
  deleteControlRecord,
  parseControlError,
} from "../../services/control";
import { FieldInput, toFormValue, toApiValue } from "./ControlFields";
import {
  PageHead,
  Banner,
  ReasonDialog,
  DeletePreview,
  pushFlash,
  showValue,
  BTN,
  BTN_PRIMARY,
  BTN_DANGER,
  CARD,
} from "./ControlUI";

// ─── Data Console: add / change form ──────────────────────────────────────────
// /control/data/:app/:model/add        → meta: add_fields, add_fieldsets
// /control/data/:app/:model/:pk/change → record: fields, fieldsets, values,
//                                        readonly, perms
// An edit PATCHes ONLY the changed fields; every write carries a reason.

// Fields arrive as a list of {name, …} or a {name: {…}} map.
const normFields = (fields) =>
  Array.isArray(fields)
    ? fields
    : Object.entries(fields ?? {}).map(([name, f]) => ({ name, ...f }));

// Fieldsets arrive Django-style [[title, {fields}]] or as [{title, fields}];
// a fieldset row may itself be a tuple of fields shown side by side.
const fieldNamesOf = (list) =>
  (list ?? []).flatMap((f) => (Array.isArray(f) ? f : [f])).map((f) => (typeof f === "string" ? f : f?.name));
const normFieldsets = (fs) =>
  (Array.isArray(fs) ? fs : []).map((x) =>
    Array.isArray(x)
      ? { title: x[0], description: x[1]?.description, fields: fieldNamesOf(x[1]?.fields) }
      : { title: x?.title ?? x?.name ?? null, description: x?.description, fields: fieldNamesOf(x?.fields) },
  );

export default function ControlRecord(props) {
  const params = useParams();
  const navigate = useNavigate();
  const isAdd = () => props.mode === "add";
  const base = () => `/control/data/${encodeURIComponent(params.app)}/${encodeURIComponent(params.model)}`;

  const [src] = createResource(
    () => ({ app: params.app, model: params.model, pk: params.pk, add: isAdd() }),
    ({ app, model, pk, add }) => (add ? fetchControlMeta(app, model) : fetchControlRecord(app, model, pk)),
  );
  const d = () => (src.error ? null : src());

  const fields = createMemo(() => normFields(isAdd() ? d()?.add_fields : d()?.fields));
  const byName = createMemo(() => new Map(fields().map((f) => [f.name, f])));
  const readonly = createMemo(() => (isAdd() ? [] : (d()?.readonly ?? [])));
  const roByName = createMemo(() => new Map(readonly().map((r) => [r.name, r])));
  const values = () => (isAdd() ? {} : (d()?.values ?? {}));
  const perms = () => d()?.perms ?? {};
  const canSave = () => (isAdd() ? perms().add !== false : perms().change !== false);

  // Sections to render: the fieldsets, then anything they left out.
  const sections = createMemo(() => {
    const fs = normFieldsets(isAdd() ? d()?.add_fieldsets : d()?.fieldsets);
    const placed = new Set(fs.flatMap((s) => s.fields));
    const out = fs.length ? fs : [{ title: null, fields: fields().map((f) => f.name) }];
    if (fs.length) {
      const left = fields().filter((f) => !placed.has(f.name)).map((f) => f.name);
      if (left.length) out.push({ title: "Other", fields: left });
    }
    const allPlaced = new Set(out.flatMap((s) => s.fields));
    const ro = readonly().filter((r) => !allPlaced.has(r.name)).map((r) => r.name);
    if (ro.length) out.push({ title: "Read-only", fields: ro });
    return out;
  });

  // ── Form state ──
  const [fieldErrors, setFieldErrors] = createSignal({});
  const [form, setForm] = createSignal({});
  const [initial, setInitial] = createSignal({});
  createEffect(() => {
    if (!d()) return;
    const v = values();
    const next = {};
    for (const f of fields()) {
      const raw = isAdd() ? (f.initial ?? f.default ?? null) : v[f.name];
      next[f.name] = toFormValue(f, raw);
    }
    setForm(next);
    setInitial(next);
    setFieldErrors({});
  });
  const setField = (name, v) => {
    setForm((s) => ({ ...s, [name]: v }));
    if (fieldErrors()[name]) setFieldErrors((e) => ({ ...e, [name]: undefined }));
  };

  const [banner, setBanner] = createSignal(null);

  // Edit: only fields whose form value moved; a sensitive field only when a
  // new value was typed. Add: every field the form holds.
  const buildData = () => {
    const out = {};
    const errs = {};
    for (const f of fields()) {
      if (f.readonly) continue;
      const fv = form()[f.name];
      if (f.sensitive) {
        if (fv) out[f.name] = fv;
        continue;
      }
      if (!isAdd() && JSON.stringify(fv) === JSON.stringify(initial()[f.name])) continue;
      try {
        out[f.name] = toApiValue(f, fv);
      } catch (e) {
        errs[f.name] = e.message;
      }
    }
    return { out, errs };
  };

  const [confirming, setConfirming] = createSignal(false);
  const [pending, setPending] = createSignal(null);
  const [busy, setBusy] = createSignal(false);

  const startSave = () => {
    setBanner(null);
    const { out, errs } = buildData();
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setBanner({ tone: "error", text: "Fix the highlighted fields." });
      return;
    }
    if (!isAdd() && Object.keys(out).length === 0) {
      setBanner({ tone: "warn", text: "No changes to save." });
      return;
    }
    setPending(out);
    setConfirming(true);
  };

  const save = async (reason) => {
    setBusy(true);
    try {
      const res = isAdd()
        ? await createControlRecord(params.app, params.model, pending(), reason)
        : await updControl(reason);
      setConfirming(false);
      pushFlash(
        isAdd()
          ? `Added "${res?.str ?? res?.pk ?? "record"}".`
          : `Saved "${d()?.str ?? params.pk}" (${Object.keys(pending()).join(", ")}).`,
      );
      navigate(base());
    } catch (err) {
      const e = parseControlError(err, "Couldn't save.");
      setConfirming(false);
      setFieldErrors(e.fields);
      const unplaced = Object.entries(e.fields).filter(([k]) => !byName().has(k));
      setBanner({
        tone: "error",
        text:
          [e.message, ...unplaced.map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(" ") ||
          "Fix the highlighted fields.",
      });
    } finally {
      setBusy(false);
    }
  };
  const updControl = (reason) => updateControlRecord(params.app, params.model, params.pk, pending(), reason);

  // ── Delete ──
  const [delPreview, setDelPreview] = createSignal(null);
  const [delOpen, setDelOpen] = createSignal(false);
  const [delError, setDelError] = createSignal("");
  const [delLoading, setDelLoading] = createSignal(false);
  const blocked = () =>
    (delPreview()?.protected ?? []).length > 0 || delPreview()?.can_delete === false;
  const openDelete = async () => {
    setDelError("");
    setDelLoading(true);
    try {
      setDelPreview(await fetchDeletePreview(params.app, params.model, params.pk));
      setDelOpen(true);
    } catch (err) {
      setBanner({ tone: "error", text: parseControlError(err, "Couldn't check what this delete affects.").message });
    } finally {
      setDelLoading(false);
    }
  };
  const doDelete = async (reason) => {
    setBusy(true);
    setDelError("");
    try {
      await deleteControlRecord(params.app, params.model, params.pk, reason);
      setDelOpen(false);
      pushFlash(`Deleted "${d()?.str ?? params.pk}".`);
      navigate(base());
    } catch (err) {
      const e = parseControlError(err, "Couldn't delete.");
      setDelError(err?.status === 409 ? `Protected by related records. ${e.message}` : e.message);
    } finally {
      setBusy(false);
    }
  };

  const renderName = (name) => {
    const f = byName().get(name);
    if (f) {
      const ro = f.readonly || !canSave();
      return (
        <FieldInput
          field={f}
          value={form()[name]}
          masked={f.sensitive ? values()[name] : undefined}
          disabled={ro}
          error={fieldErrors()[name]}
          onChange={(v) => setField(name, v)}
        />
      );
    }
    const r = roByName().get(name);
    if (r) {
      return (
        <div>
          <p class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{r.label ?? r.name}</p>
          <p class="text-sm text-gray-800 dark:text-gray-200 break-words whitespace-pre-wrap">{showValue(r.value)}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div class="min-h-screen p-3 lg:p-8">
      <PageHead
        crumbs={
          <>
            <A href="/control/data" class="hover:underline">Data Console</A> ›{" "}
            <A href={base()} class="hover:underline">{params.app}.{params.model}</A>
          </>
        }
        title={isAdd() ? `Add ${d()?.verbose_name ?? params.model}` : (d()?.str ?? `#${params.pk}`)}
        subtitle={isAdd() ? undefined : `${params.app}.${params.model} · pk ${params.pk}`}
        actions={
          <Show when={!isAdd() && perms().delete}>
            <button type="button" class={BTN_DANGER} onClick={openDelete} disabled={delLoading()}>
              {delLoading() ? "Checking…" : "Delete"}
            </button>
          </Show>
        }
      />

      <Banner tone={banner()?.tone}>{banner()?.text}</Banner>
      <Banner>{src.error ? parseControlError(src.error, "Couldn't load the record.").message : ""}</Banner>
      <Show when={d() && !canSave()}>
        <Banner tone="warn">View only — you don't have permission to change this record.</Banner>
      </Show>

      <Show when={!src.loading} fallback={<p class="text-sm text-gray-500">Loading…</p>}>
        <Show when={d()}>
          <div class="space-y-4">
            <For each={sections()}>
              {(s) => (
                <section class={`${CARD} p-5`}>
                  <Show when={s.title}>
                    <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{s.title}</h2>
                  </Show>
                  <Show when={s.description}>
                    <p class="mt-0.5 text-xs text-gray-500">{s.description}</p>
                  </Show>
                  <div class={`grid grid-cols-1 md:grid-cols-2 gap-4 ${s.title ? "mt-3" : ""}`}>
                    <For each={s.fields}>{(name) => renderName(name)}</For>
                  </div>
                </section>
              )}
            </For>
          </div>

          <Show when={canSave()}>
            <div class="mt-5 flex justify-end gap-2">
              <A href={base()} class={BTN}>
                Cancel
              </A>
              <button type="button" class={BTN_PRIMARY} onClick={startSave} disabled={busy()}>
                {isAdd() ? "Save" : "Save changes"}
              </button>
            </div>
          </Show>
        </Show>
      </Show>

      <ReasonDialog
        open={confirming()}
        title={isAdd() ? "Create this record?" : "Save these changes?"}
        confirmLabel={isAdd() ? "Create" : "Save"}
        busy={busy()}
        onCancel={() => setConfirming(false)}
        onConfirm={save}
      >
        <Show when={!isAdd()} fallback={<>A new {params.app}.{params.model} record.</>}>
          Changing: {Object.keys(pending() ?? {}).map((k) => byName().get(k)?.label ?? k).join(", ")}
        </Show>
      </ReasonDialog>

      <ReasonDialog
        open={delOpen()}
        title="Delete record?"
        confirmLabel="Delete"
        danger
        blocked={blocked()}
        busy={busy()}
        error={delError()}
        onCancel={() => setDelOpen(false)}
        onConfirm={doDelete}
      >
        <DeletePreview preview={delPreview()} label={d()?.str ?? `#${params.pk}`} />
      </ReasonDialog>
    </div>
  );
}
