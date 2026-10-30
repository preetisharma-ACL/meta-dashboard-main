import { createSignal, createResource, createMemo, onCleanup, Show } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { useParams, useNavigate, A } from "@solidjs/router";
import { Download, Copy, Trash2, ArrowLeft } from "lucide-solid";
import {
  fetchProposal,
  fetchProposalMeta,
  patchProposal,
  confirmProposal,
  chatProposal,
  undoProposal,
  restoreProposal,
  duplicateProposal,
  deleteProposal,
  downloadProposalPdf,
} from "../../services/proposals";
import { loadErrorMessage, errorMessage } from "../../utils/apiErrors";
import { ErrorBox } from "../../components/creatives/CreativeUI";
import {
  ConfirmedBadge,
  ConfirmDialog,
  InlineError,
  GHOST_BTN,
  PRIMARY_BTN,
  Spinner,
} from "../../components/proposals/ProposalUI";
import BuilderChat from "../../components/proposals/BuilderChat";
import BuilderForm from "../../components/proposals/BuilderForm";
import BuilderPreview from "../../components/proposals/BuilderPreview";

// ─── Proposal builder (/proposals/:id) ────────────────────────────────────────
// Three panels: chat with the AI (left), the inputs + checks + copy (middle)
// and the live A4 preview (right).
//
// State. `detail` is the server's DETAIL object, replaced whole by every write.
// The form (`form` = inputs, `copy` = content) is kept locally so a PATCH
// answering mid-typing never overwrites what is being typed: after an autosave
// only `detail` is replaced (numbers, checks, can_download, …); the form is
// re-read from the server only after the AI or a restore changed it (confirm,
// chat, undo, version restore). Pending edits are flushed before any of those.
//
// Autosave. Edits mark their TOP-LEVEL input group dirty (client, project,
// lines, …) and 800 ms after the last keystroke the whole group is PATCHed.
// Whole groups rather than single leaves so the request means the same thing
// whether the server merges nested objects or replaces them; lists replace
// whole anyway. Saves are serialised: one PATCH in flight at a time, edits made
// meanwhile go in the next one.

const SAVE_DELAY = 800;

// Fields typed as text (so "1." mid-typing isn't eaten) but sent as numbers.
const NUMERIC = {
  lines: ["leads", "cpl", "qualified_pct"],
  timeline: ["target_days"],
  retainership: ["monthly_fee", "notice_days", "ad_budget_min", "ad_budget_max", "duration_months", "revision_rounds"],
  pass_through: ["markup_pct", "min_budget", "monthly_fee", "leads_per_day", "notice_days"],
};

// Retainership extras on the way out: services rows get a numeric fee and no
// blank deliverable lines, an untouched blank row is dropped, and
// replace_invalid is always a real true/false (default on).
const fixRetainership = (r) => {
  if (!r || typeof r !== "object") return r;
  if (Array.isArray(r.services)) {
    r.services = r.services
      .map((s) => ({
        ...s,
        fee: toNum(s?.fee),
        deliverables: (Array.isArray(s?.deliverables) ? s.deliverables : []).map((x) => String(x).trim()).filter(Boolean),
      }))
      .filter((s) => String(s.name ?? "").trim() || s.fee != null || s.deliverables.length || String(s.objective ?? "").trim());
  }
  r.replace_invalid = r.replace_invalid !== false;
  return r;
};

const toNum = (v) => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  // Not a number: send it as typed and let the server's checks say so.
  return Number.isFinite(n) ? n : v;
};

// Empty strings become null (= "use the default") in objects; lists keep their
// rows as they are.
const blankToNull = (v) => {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? blankToNull(x) : x));
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, x === "" ? null : x && typeof x === "object" ? blankToNull(x) : x]),
    );
  }
  return v === "" ? null : v;
};

const groupForSend = (key, raw) => {
  const val = JSON.parse(JSON.stringify(raw ?? null));
  const nums = NUMERIC[key];
  if (nums && val) {
    const fix = (o) => {
      if (!o || typeof o !== "object") return o;
      for (const k of nums) if (k in o) o[k] = toNum(o[k]);
      return o;
    };
    if (Array.isArray(val)) val.forEach(fix);
    else fix(val);
  }
  if (key === "retainership") fixRetainership(val);
  return blankToNull(val);
};

// An old retainer proposal has retainership.monthly_fee and no services: show
// it as one "Lead generation" row with that fee. Nothing is sent until the
// retainership block is edited; then services are written and the old single
// fee is cleared (null), so the services list is the only fee left.
const upgradeLegacyRetainer = (inputs) => {
  const r = inputs?.retainership;
  if (!r || r.monthly_fee == null || (Array.isArray(r.services) && r.services.length)) return inputs;
  r.services = [{ name: "Lead generation", fee: r.monthly_fee, deliverables: [], objective: "" }];
  r.monthly_fee = null;
  return inputs;
};

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));

export default function ProposalBuilder() {
  const params = useParams();
  // Keyed on the id: "Use as new" lands on a new id and gets a fresh builder.
  return (
    <Show when={params.id} keyed>
      {(id) => <Builder id={id} />}
    </Show>
  );
}

function Builder(props) {
  const navigate = useNavigate();
  const [meta] = createResource(fetchProposalMeta);
  const metaVal = () => (meta.error ? null : meta());

  const [detail, setDetail] = createSignal(null);
  const [loadError, setLoadError] = createSignal(null);
  const [form, setForm] = createStore({});
  const [copy, setCopy] = createStore({});
  const [theme, setTheme] = createSignal("");
  const [validity, setValidity] = createSignal("");

  // Bumped on every adopted DETAIL; the preview debounces on it.
  const [previewTick, setPreviewTick] = createSignal(0);
  const bumpPreview = () => setPreviewTick((n) => n + 1);

  // Replace server state. resync = also re-read the form and copy.
  const adopt = (d, resync) => {
    if (!d) return;
    setDetail(d);
    if (resync) {
      const inputs = upgradeLegacyRetainer(clone(d.inputs));
      // model may sit top-level only; keep it in the form either way.
      if (inputs.model == null && d.model != null) inputs.model = d.model;
      setForm(reconcile(inputs));
      setCopy(reconcile(clone(d.content)));
      setTheme(d.theme ?? "");
      setValidity(d.validity_days == null ? "" : String(d.validity_days));
    }
    bumpPreview();
  };

  const load = async () => {
    setLoadError(null);
    try {
      adopt(await fetchProposal(props.id), true);
    } catch (err) {
      setLoadError(err);
    }
  };
  load();

  // ── Autosave queue ────────────────────────────────────────────────────────
  let dirtyFields = new Set();
  let dirtyCopy = new Set();
  let dirtyExtra = {}; // theme / validity_days
  let timer;
  let inFlight = null;
  const [saveState, setSaveState] = createSignal("idle"); // idle | pending | saving | saved | error
  const [saveError, setSaveError] = createSignal("");

  const hasDirty = () => dirtyFields.size || dirtyCopy.size || Object.keys(dirtyExtra).length;

  const buildPatch = () => {
    const patch = {};
    if (dirtyFields.size) {
      patch.fields = {};
      for (const k of dirtyFields) patch.fields[k] = groupForSend(k, unwrap(form)[k]);
    }
    if (dirtyCopy.size) {
      patch.content = {};
      for (const k of dirtyCopy) patch.content[k] = JSON.parse(JSON.stringify(unwrap(copy)[k] ?? null));
    }
    Object.assign(patch, dirtyExtra);
    dirtyFields = new Set();
    dirtyCopy = new Set();
    dirtyExtra = {};
    return patch;
  };

  // Send everything dirty; resolves once nothing is left to send.
  const flush = async () => {
    clearTimeout(timer);
    // A loop, not an if: two callers waiting on the same save must not both
    // go on as if it were theirs.
    while (inFlight) await inFlight.catch(() => {});
    if (!hasDirty()) return;
    const patch = buildPatch();
    setSaveState("saving");
    setSaveError("");
    inFlight = (async () => {
      try {
        const d = await patchProposal(props.id, patch);
        adopt(d, false);
        if ("theme" in patch && d) setTheme(d.theme ?? patch.theme);
        setSaveState(hasDirty() ? "pending" : "saved");
      } catch (err) {
        // Put the failed groups back so the next edit (or Retry) resends them.
        for (const k of Object.keys(patch.fields ?? {})) dirtyFields.add(k);
        for (const k of Object.keys(patch.content ?? {})) dirtyCopy.add(k);
        if ("theme" in patch && !("theme" in dirtyExtra)) dirtyExtra.theme = patch.theme;
        if ("validity_days" in patch && !("validity_days" in dirtyExtra)) dirtyExtra.validity_days = patch.validity_days;
        setSaveState("error");
        setSaveError(errorMessage(err, "Could not save."));
        throw err;
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
    if (hasDirty() && saveState() !== "error") await flush();
  };

  const schedule = (delay = SAVE_DELAY) => {
    setSaveState("pending");
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(() => {}), delay);
  };

  // path: ["client", "name"] or ["lines"] (whole list)
  const setField = (path, value) => {
    // The store setter can't write through a missing parent (a brief with no
    // project yet has no inputs.project), so create the parents first.
    for (let i = 1; i < path.length; i++) {
      let cur = form;
      for (const k of path.slice(0, i)) cur = cur?.[k];
      if (cur == null || typeof cur !== "object") setForm(...path.slice(0, i), {});
    }
    setForm(...path, value);
    dirtyFields.add(path[0]);
    schedule();
  };
  const setCopyKey = (key, value) => {
    setCopy(key, value);
    dirtyCopy.add(key);
    schedule();
  };
  const pickTheme = (t) => {
    setTheme(t);
    dirtyExtra.theme = t;
    schedule(0);
  };
  const changeValidity = (v) => {
    setValidity(v);
    dirtyExtra.validity_days = toNum(v);
    schedule();
  };

  onCleanup(() => {
    clearTimeout(timer);
    if (hasDirty()) patchProposal(props.id, buildPatch()).catch(() => {});
  });
  const onUnload = (e) => {
    if (hasDirty() || inFlight) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", onUnload);
  onCleanup(() => window.removeEventListener("beforeunload", onUnload));

  // ── AI + version actions ──────────────────────────────────────────────────
  const [aiBusy, setAiBusy] = createSignal(false);
  const [aiError, setAiError] = createSignal("");

  const runAi = async (fn) => {
    if (aiBusy()) return false;
    setAiBusy(true);
    setAiError("");
    try {
      await flush();
      adopt(await fn(), true);
      return true;
    } catch (err) {
      setAiError(err?.status === 403 ? "You don't have permission to do this." : errorMessage(err, "Something went wrong."));
      return false;
    } finally {
      setAiBusy(false);
    }
  };

  const doConfirm = () => runAi(() => confirmProposal(props.id));
  const doChat = (text) => runAi(() => chatProposal(props.id, text));
  const doUndo = () => runAi(() => undoProposal(props.id));
  const doRestore = (version) => runAi(() => restoreProposal(props.id, version));

  // ── Top bar actions ───────────────────────────────────────────────────────
  const [dlBusy, setDlBusy] = createSignal(false);
  const [dlError, setDlError] = createSignal(null); // { message, lines }
  const [dupBusy, setDupBusy] = createSignal(false);
  const [removeOpen, setRemoveOpen] = createSignal(false);

  const redChecks = createMemo(() => (detail()?.checks ?? []).filter((c) => c.level === "error"));

  // Shared by the top bar and the full-screen preview's Download button.
  const dlTitle = () =>
    detail()?.can_download
      ? "Download the PDF"
      : redChecks().length
        ? "Fix first:\n" + redChecks().map((c) => `• ${c.message}`).join("\n")
        : "Not ready to download yet";

  const download = async () => {
    setDlBusy(true);
    setDlError(null);
    try {
      await flush();
      await downloadProposalPdf(props.id, detail()?.number || `proposal-${props.id}`);
      // last_pdf_at moves; re-read quietly so the header stays honest.
      fetchProposal(props.id).then((d) => d && setDetail(d)).catch(() => {});
    } catch (err) {
      setDlError({ message: err?.message || "Download failed.", lines: err?.lines ?? [] });
    } finally {
      setDlBusy(false);
    }
  };

  const useAsNew = async () => {
    setDupBusy(true);
    setAiError("");
    try {
      await flush();
      const fresh = await duplicateProposal(props.id);
      if (fresh?.id) navigate(`/proposals/${fresh.id}`);
    } catch (err) {
      setAiError(errorMessage(err, "Could not copy the proposal."));
    } finally {
      setDupBusy(false);
    }
  };

  const d = () => detail();
  const title = () => [d()?.client_name, d()?.project_name].filter(Boolean).join(" / ") || "Untitled proposal";

  return (
    <section class="w-full px-3 sm:px-5 py-4 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <Show
        when={d()}
        fallback={
          <Show
            when={loadError()}
            fallback={
              <div class="min-h-[60vh] grid place-items-center text-sm font-semibold text-[#54657E] dark:text-gray-400">
                <span class="inline-flex items-center gap-3">
                  <Spinner class="w-5 h-5" /> Loading proposal…
                </span>
              </div>
            }
          >
            <A href="/proposals" class="inline-flex items-center gap-1.5 text-sm font-semibold text-[#54657E] hover:text-[#AC2334] mb-4">
              <ArrowLeft size={16} /> Proposals
            </A>
            <ErrorBox
              message={
                loadError()?.status === 404
                  ? "This proposal does not exist or was removed."
                  : `Could not load the proposal. ${loadErrorMessage(loadError())}`
              }
              onRetry={loadError()?.status === 404 ? undefined : load}
            />
          </Show>
        }
      >
        {/* ══ Top bar ══ */}
        <div class="mb-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div class="min-w-0">
            <A href="/proposals" class="inline-flex items-center gap-1 text-xs font-semibold text-[#54657E] hover:text-[#AC2334] dark:text-gray-400">
              <ArrowLeft size={14} /> Proposals
            </A>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="font-mono text-sm font-bold text-[#AC2334] dark:text-red-300">{d().number}</span>
              <h1 class="text-xl font-bold text-[#14233A] dark:text-white truncate max-w-full" title={title()}>
                {title()}
              </h1>
              <ConfirmedBadge confirmed={!!d().confirmed} />
              <SaveStatus state={saveState()} error={saveError()} onRetry={() => flush().catch(() => {})} />
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span title={dlTitle()}>
              <button type="button" class={PRIMARY_BTN} disabled={!d().can_download || dlBusy()} onClick={download}>
                <Show when={dlBusy()} fallback={<Download size={16} />}>
                  <Spinner />
                </Show>
                Download PDF
              </button>
            </span>
            <button type="button" class={GHOST_BTN} disabled={dupBusy()} onClick={useAsNew}>
              <Copy size={16} /> {dupBusy() ? "Copying…" : "Use as new"}
            </button>
            <button
              type="button"
              class={GHOST_BTN + " !text-[#AC2334] dark:!text-red-300"}
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 size={16} /> Remove
            </button>
          </div>
        </div>

        <Show when={dlError()}>
          <div class="mb-3 flex items-start gap-3">
            <div class="flex-1">
              <InlineError message={dlError().message} lines={dlError().lines} />
            </div>
            <button type="button" class="text-xs font-semibold text-[#54657E] hover:text-[#AC2334] mt-2" onClick={() => setDlError(null)}>
              Dismiss
            </button>
          </div>
        </Show>

        {/* ══ Three panels ══ */}
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.25fr)_minmax(340px,1.15fr)] gap-3">
          <BuilderChat
            detail={d()}
            meta={metaVal()}
            busy={aiBusy()}
            error={aiError()}
            onDismissError={() => setAiError("")}
            onConfirm={doConfirm}
            onChat={doChat}
            onUndo={doUndo}
            onEditInForm={() => {
              const el = document.querySelector('[data-field="client.name"]');
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
              el?.focus({ preventScroll: true });
            }}
          />
          <BuilderForm
            detail={d()}
            meta={metaVal()}
            form={form}
            copy={copy}
            theme={theme()}
            validity={validity()}
            aiBusy={aiBusy()}
            setField={setField}
            setCopyKey={setCopyKey}
            onTheme={pickTheme}
            onValidity={changeValidity}
            onConfirm={doConfirm}
            onRestore={doRestore}
          />
          <BuilderPreview
            id={props.id}
            tick={previewTick()}
            title={[d().number, d().client_name].filter(Boolean).join(" · ")}
            canDownload={!!d().can_download}
            dlBusy={dlBusy()}
            dlTitle={dlTitle()}
            dlError={dlError()}
            onDownload={download}
            onDismissDlError={() => setDlError(null)}
          />
        </div>
      </Show>

      <ConfirmDialog
        open={removeOpen()}
        title="Remove proposal"
        message={`Remove ${d()?.number ?? "this proposal"} from the list?`}
        confirmLabel="Remove"
        onConfirm={async () => {
          clearTimeout(timer);
          dirtyFields = new Set();
          dirtyCopy = new Set();
          dirtyExtra = {};
          await deleteProposal(props.id);
          navigate("/proposals");
        }}
        onClose={() => setRemoveOpen(false)}
      />
    </section>
  );
}

function SaveStatus(props) {
  return (
    <span class="text-xs font-semibold">
      <Show when={props.state === "pending" || props.state === "saving"}>
        <span class="inline-flex items-center gap-1.5 text-[#8593A8] dark:text-gray-400">
          <Spinner class="w-3 h-3" /> Saving…
        </span>
      </Show>
      <Show when={props.state === "saved"}>
        <span class="text-[#15966A] dark:text-green-300">Saved</span>
      </Show>
      <Show when={props.state === "error"}>
        <span class="text-[#AC2334] dark:text-red-300">
          Not saved: {props.error}{" "}
          <button type="button" class="underline" onClick={() => props.onRetry()}>
            Retry
          </button>
        </span>
      </Show>
    </span>
  );
}
