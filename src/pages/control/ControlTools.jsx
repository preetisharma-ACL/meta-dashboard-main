import { createSignal, createEffect, createMemo, For, Show } from "solid-js";
import {
  resetUserPassword,
  previewRecomputeOpenings,
  applyRecomputeOpenings,
  parseControlError,
} from "../../services/control";
import { ReasonDialog, showValue, BTN, BTN_PRIMARY, INPUT } from "./ControlUI";

// ─── Record-page tools (Data Console) ─────────────────────────────────────────
// Reset password  → accounts.user record page
// Recompute openings → clients.client record page

function Modal(props) {
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
          class="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl"
        >
          <div class="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{props.title}</h2>
            <Show when={props.subtitle}>
              <p class="text-xs text-gray-500">{props.subtitle}</p>
            </Show>
          </div>
          <div class="px-6 py-5">{props.children}</div>
        </div>
      </div>
    </Show>
  );
}

const LABEL = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

// ── Reset password ──
// POST /control/users/{id}/password/ {password1, password2, reason}. Django's
// password rules come back as 400 field errors on password1 / password2.
export function ResetPasswordDialog(props) {
  const [p1, setP1] = createSignal("");
  const [p2, setP2] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [errs, setErrs] = createSignal({});
  const [banner, setBanner] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  createEffect(() => {
    if (props.open) {
      setP1(""); setP2(""); setReason(""); setErrs({}); setBanner("");
    }
  });
  const ready = () => p1() && p2() && reason().trim() && !busy();
  const submit = async () => {
    if (p1() !== p2()) {
      setErrs({ password2: "The two passwords don't match." });
      return;
    }
    setBusy(true);
    setErrs({});
    setBanner("");
    try {
      await resetUserPassword(props.userId, p1(), p2(), reason().trim());
      props.onDone?.();
    } catch (err) {
      const e = parseControlError(err, "Couldn't reset the password.");
      setErrs(e.fields);
      const other = Object.entries(e.fields).filter(([k]) => k !== "password1" && k !== "password2");
      setBanner([e.message, ...other.map(([, v]) => v)].filter(Boolean).join(" "));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={props.open} title="Reset password" subtitle={props.label}>
      <Show when={banner()}>
        <p class="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {banner()}
        </p>
      </Show>
      <div class="space-y-3">
        <div>
          <label class={LABEL} for="pw1">New password</label>
          <input id="pw1" type="password" autocomplete="new-password" value={p1()} onInput={(e) => setP1(e.target.value)} class={INPUT} />
          <Show when={errs().password1}><p class="mt-1 text-xs text-red-600">{errs().password1}</p></Show>
        </div>
        <div>
          <label class={LABEL} for="pw2">Confirm password</label>
          <input id="pw2" type="password" autocomplete="new-password" value={p2()} onInput={(e) => setP2(e.target.value)} class={INPUT} />
          <Show when={errs().password2}><p class="mt-1 text-xs text-red-600">{errs().password2}</p></Show>
        </div>
        <div>
          <label class={LABEL} for="pw-reason">Reason <span class="text-red-500">*</span></label>
          <textarea id="pw-reason" rows="2" value={reason()} onInput={(e) => setReason(e.target.value)} class={INPUT} placeholder="Saved in the audit log" />
        </div>
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class={BTN} onClick={props.onClose} disabled={busy()}>Cancel</button>
        <button type="button" class={BTN_PRIMARY} onClick={submit} disabled={!ready()}>
          {busy() ? "Resetting…" : "Reset password"}
        </button>
      </div>
    </Modal>
  );
}

// ── Recompute openings ──
// GET …/recompute-openings/?from=YYYY-MM previews (nothing written); POST
// {from, reason} applies. The result rows are rendered column-for-column as
// the server sends them (each month's old and new opening); an empty list
// means nothing would change. Locked openings are never changed server-side.
const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const cellText = (v) =>
  typeof v === "number" || (typeof v === "string" && v !== "" && Number.isFinite(Number(v)) && /\./.test(v))
    ? Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : showValue(v);

function ResultTable(props) {
  const cols = createMemo(() => {
    const seen = [];
    for (const r of props.rows) for (const k of Object.keys(r ?? {})) if (!seen.includes(k)) seen.push(k);
    return seen;
  });
  return (
    <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase tracking-wider text-gray-500 text-left">
            <For each={cols()}>{(c) => <th class="p-2.5 whitespace-nowrap">{c.replace(/_/g, " ")}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(r) => (
              <tr class="border-t border-gray-100 dark:border-gray-800">
                <For each={cols()}>{(c) => <td class="p-2.5 tabular-nums whitespace-nowrap">{cellText(r?.[c])}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

export function RecomputeOpeningsDialog(props) {
  const [from, setFrom] = createSignal(lastMonth());
  const [rows, setRows] = createSignal(null); // null = not previewed
  const [previewedFrom, setPreviewedFrom] = createSignal(null);
  const [applied, setApplied] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [applyError, setApplyError] = createSignal("");
  createEffect(() => {
    if (props.open) {
      setFrom(lastMonth()); setRows(null); setPreviewedFrom(null); setApplied(false); setError("");
    }
  });
  const rowsOf = (res) => (Array.isArray(res) ? res : (res?.result ?? []));

  const preview = async () => {
    setLoading(true);
    setError("");
    setApplied(false);
    try {
      const res = await previewRecomputeOpenings(props.clientId, from());
      setRows(rowsOf(res));
      setPreviewedFrom(from());
    } catch (err) {
      setRows(null);
      setError(parseControlError(err, "Couldn't preview.").message);
    } finally {
      setLoading(false);
    }
  };
  const apply = async (reason) => {
    setBusy(true);
    setApplyError("");
    try {
      const res = await applyRecomputeOpenings(props.clientId, previewedFrom(), reason);
      setRows(rowsOf(res));
      setApplied(res?.applied !== false);
      setConfirming(false);
    } catch (err) {
      setApplyError(parseControlError(err, "Couldn't apply.").message);
    } finally {
      setBusy(false);
    }
  };
  // Apply only what was previewed: changing the month after a preview means
  // the table on screen no longer describes what would be written.
  const stale = () => previewedFrom() !== from();

  return (
    <>
      <Modal open={props.open} title="Recompute openings" subtitle={props.label}>
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class={LABEL} for="rc-from">From month</label>
            <input id="rc-from" type="month" value={from()} onInput={(e) => setFrom(e.target.value)} class={INPUT} />
          </div>
          <button type="button" class={BTN} onClick={preview} disabled={!from() || loading()}>
            {loading() ? "Previewing…" : "Preview"}
          </button>
        </div>
        <p class="mt-2 text-xs text-gray-500">
          Preview writes nothing. Locked openings are never changed.
        </p>
        <Show when={error()}>
          <p class="mt-3 text-sm text-red-600 dark:text-red-400">{error()}</p>
        </Show>
        <Show when={rows()}>
          <div class="mt-4">
            <Show when={applied()}>
              <p class="mb-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
                Applied from {previewedFrom()}.
              </p>
            </Show>
            <Show
              when={rows().length}
              fallback={<p class="text-sm text-gray-600 dark:text-gray-300">Nothing would change from {previewedFrom()}.</p>}
            >
              <ResultTable rows={rows()} />
            </Show>
          </div>
        </Show>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class={BTN} onClick={props.onClose}>
            {applied() ? "Close" : "Cancel"}
          </button>
          <Show when={!applied()}>
            <button
              type="button"
              class={BTN_PRIMARY}
              disabled={!rows()?.length || stale()}
              title={stale() ? "Preview the selected month first" : undefined}
              onClick={() => { setApplyError(""); setConfirming(true); }}
            >
              Apply
            </button>
          </Show>
        </div>
      </Modal>
      <ReasonDialog
        open={confirming()}
        title={`Recompute openings from ${previewedFrom()}?`}
        confirmLabel="Apply"
        busy={busy()}
        error={applyError()}
        onCancel={() => setConfirming(false)}
        onConfirm={apply}
      >
        Rewrites {rows()?.length ?? 0} month{rows()?.length === 1 ? "" : "s"} of openings for {props.label}, as previewed.
      </ReasonDialog>
    </>
  );
}
