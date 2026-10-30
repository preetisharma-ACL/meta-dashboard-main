import { createSignal, createMemo, For, Index, Show, Switch, Match } from "solid-js";
import { Plus, X, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-solid";
import { CARD, PanelTitle, FIELD, LABEL, SMALL_BTN, TagInput } from "./ProposalUI";
import BuilderCopy from "./BuilderCopy";
import { optionsOf, getPath, fmtWhen, nameOf, humanize } from "../../services/proposals";

// ─── Builder: form + checks (middle panel) ────────────────────────────────────
// Every input shows the value the PDF would print when left empty
// (inputs_with_defaults) as its grey placeholder. Inputs carry data-field=
// "<dotted path>" so a check or "Edit in form" can jump to them.
//
// Props: detail, meta, form, copy, theme, validity, aiBusy, setField(path, v),
// setCopyKey(key, v), onTheme(t), onValidity(v), onConfirm(), onRestore(version)

// meta.themes is only {key, label}; the swatch colours (page background +
// accent) are fixed here, matching the PDF themes.
const THEME_SWATCH = {
  navy: { bg: "#0F1B2D", accent: "#AC2334" },
  wine: { bg: "#3A0D19", accent: "#D9B57A" },
  pink: { bg: "#FFE2EB", accent: "#C2185B" },
};

const LEVEL = {
  error: {
    icon: XCircle,
    box: "border-[#AC2334]/25 bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/20 dark:border-red-800 dark:text-red-300",
  },
  warning: {
    icon: AlertTriangle,
    box: "border-[#D89A2B]/40 bg-[#FDF6E9] text-[#7A5410] dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200",
  },
  fixed: {
    icon: CheckCircle2,
    box: "border-[#E2E8F1] bg-[#F8FAFC] text-[#8593A8] dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400",
  },
};
const LEVEL_ORDER = { error: 0, warning: 1, fixed: 2 };

const focusField = (field) => {
  if (!field) return;
  const el = document.querySelector(`[data-field="${CSS.escape(field)}"]`) ?? document.querySelector(`[data-field^="${CSS.escape(field)}."]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.focus({ preventScroll: true });
};

export default function BuilderForm(props) {
  const defaults = () => props.detail?.inputs_with_defaults ?? {};
  const ph = (path) => {
    const v = getPath(defaults(), path);
    return v == null || typeof v === "object" ? "" : String(v);
  };
  const val = (path) => {
    const v = getPath(props.form, path);
    return v == null ? "" : String(v);
  };

  // A text input bound to a dotted path.
  const Text = (p) => (
    <div class={p.class}>
      <label class={LABEL} for={`pf-${p.path}`}>
        {p.label}
        <Show when={p.required}>
          <span class="text-[#AC2334]"> *</span>
        </Show>
      </label>
      <Show
        when={p.multiline}
        fallback={
          <input
            id={`pf-${p.path}`}
            data-field={p.path}
            class={FIELD}
            inputmode={p.numeric ? "decimal" : undefined}
            type={p.type ?? "text"}
            value={val(p.path)}
            placeholder={ph(p.path)}
            onInput={(e) => props.setField(p.path.split("."), e.target.value)}
          />
        }
      >
        <textarea
          id={`pf-${p.path}`}
          data-field={p.path}
          class={FIELD + " min-h-[5.5rem] leading-relaxed"}
          value={val(p.path)}
          placeholder={ph(p.path)}
          onInput={(e) => props.setField(p.path.split("."), e.target.value)}
        />
      </Show>
      <Show when={p.help}>
        <p class="mt-1 text-xs text-[#8593A8] dark:text-gray-400">{p.help}</p>
      </Show>
    </div>
  );

  const Select = (p) => (
    <div class={p.class}>
      <label class={LABEL} for={`pf-${p.path}`}>{p.label}</label>
      <select
        id={`pf-${p.path}`}
        data-field={p.path}
        class={FIELD}
        value={val(p.path)}
        onChange={(e) => props.setField(p.path.split("."), e.target.value || null)}
      >
        <option value="">{ph(p.path) ? `Default (${labelFor(p.options, ph(p.path))})` : "Choose…"}</option>
        <For each={p.options}>{(o) => <option value={o.value}>{o.label}</option>}</For>
        {/* A value the list doesn't know still shows, rather than silently blanking. */}
        <Show when={val(p.path) && !p.options.some((o) => o.value === val(p.path))}>
          <option value={val(p.path)}>{val(p.path)}</option>
        </Show>
      </select>
    </div>
  );

  const models = createMemo(() => optionsOf(props.meta?.models));
  const categories = createMemo(() => optionsOf(props.meta?.categories));
  const themes = createMemo(() => optionsOf(props.meta?.themes));

  // Which deal blocks apply. Unknown / empty model → show all three. The
  // Hybrid model's key is "pass_through" (label "Hybrid" from meta.models).
  const model = () => String(getPath(props.form, "model") ?? props.detail?.model ?? "").toLowerCase();
  const knownModel = () => /cpl|retain|pass/.test(model());
  const showCpl = () => !knownModel() || model().includes("cpl");
  const showRet = () => !knownModel() || model().includes("retain");
  const showPass = () => !knownModel() || model().includes("pass");
  const modelKind = () => (!knownModel() ? null : model().includes("pass") ? "hybrid" : model().includes("retain") ? "retainer" : "cpl");
  const hybridLabel = () => models().find((o) => o.value === "pass_through")?.label ?? "Hybrid";

  // ── Retainership services ──
  // meta.retainer_services: standard deliverables + objective per service
  // name, as a {name: {deliverables, objective}} map or a [{name, …}] list.
  const serviceDefaults = createMemo(() => {
    const raw = props.meta?.retainer_services;
    const out = {};
    if (Array.isArray(raw)) {
      for (const s of raw) {
        if (typeof s === "string") out[s] = { deliverables: [], objective: "" };
        else if (s?.name) out[s.name] = { deliverables: s.deliverables ?? [], objective: s.objective ?? "" };
      }
    } else if (raw && typeof raw === "object") {
      for (const [name, s] of Object.entries(raw)) out[name] = { deliverables: s?.deliverables ?? [], objective: s?.objective ?? "" };
    }
    return out;
  });
  const blankService = () => ({ name: "", fee: "", deliverables: [], objective: "" });
  // At least one row is always shown; an untouched blank row isn't saved.
  const services = () => {
    const v = getPath(props.form, "retainership.services");
    return Array.isArray(v) && v.length ? v : [blankService()];
  };
  const setServices = (next) => props.setField(["retainership", "services"], next);
  const sameLines = (a, b) => JSON.stringify((a ?? []).filter((x) => String(x).trim())) === JSON.stringify((b ?? []).filter((x) => String(x).trim()));
  const setServiceName = (i, name) => {
    const rows = services().map((r) => ({ ...r }));
    const row = rows[i];
    const prev = serviceDefaults()[row.name];
    const next = serviceDefaults()[name];
    row.name = name;
    // Picking a suggestion prefills its deliverables / objective — unless the
    // salesperson already wrote their own (anything other than the previous
    // suggestion's text).
    if (next) {
      const untouchedD = !(row.deliverables ?? []).some((x) => String(x).trim()) || (prev && sameLines(row.deliverables, prev.deliverables));
      const untouchedO = !String(row.objective ?? "").trim() || (prev && row.objective === prev.objective);
      if (untouchedD) row.deliverables = [...next.deliverables];
      if (untouchedO) row.objective = next.objective;
    }
    setServices(rows);
  };
  const setService = (i, field, value) => setServices(services().map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  // ── List helpers (lines, facts) — the whole list is sent on every change ──
  const list = (key) => {
    const v = getPath(props.form, key);
    return Array.isArray(v) ? v : [];
  };
  const listPath = (key) => key.split(".");
  const setRow = (key, i, field, v) => {
    const next = list(key).map((r, j) => (j === i ? { ...r, [field]: v } : r));
    props.setField(listPath(key), next);
  };
  const addRow = (key, blank) => props.setField(listPath(key), [...list(key), blank]);
  const dropRow = (key, i) => props.setField(listPath(key), list(key).filter((_, j) => j !== i));
  const rowPh = (key, i, field) => {
    const v = getPath(defaults(), `${key}.${i}.${field}`);
    return v == null || typeof v === "object" ? "" : String(v);
  };

  const checks = createMemo(() =>
    [...(props.detail?.checks ?? [])].sort((a, b) => (LEVEL_ORDER[a.level] ?? 3) - (LEVEL_ORDER[b.level] ?? 3)),
  );
  const assumptions = () => props.detail?.assumptions ?? [];
  const versions = () => props.detail?.versions ?? [];
  const display = () => props.detail?.display ?? {};
  const displayLines = () => (Array.isArray(display().lines) ? display().lines : []);
  const displayScalars = () =>
    Object.entries(display()).filter(([, v]) => (typeof v === "string" && v !== "") || typeof v === "number");
  const termsMode = () =>
    getPath(props.form, "terms.mode") ?? getPath(defaults(), "terms.mode") ?? "standard";

  const [pickVersion, setPickVersion] = createSignal("");

  return (
    <div class="space-y-3 min-w-0">
      {/* ══ Checks ══ */}
      <div class={CARD + " p-4"}>
        <PanelTitle>Checks</PanelTitle>
        <Show when={checks().length} fallback={<p class="text-sm text-[#15966A] dark:text-green-300">All clear.</p>}>
          <ul class="space-y-1.5">
            <For each={checks()}>
              {(c) => {
                const lv = LEVEL[c.level] ?? LEVEL.fixed;
                const Icon = lv.icon;
                return (
                  <li class={"flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " + lv.box}>
                    <Icon size={16} class="flex-none mt-0.5" />
                    <div class="flex-1 min-w-0">
                      <Show when={c.field} fallback={<span>{c.message}</span>}>
                        <button type="button" class="text-left hover:underline" onClick={() => focusField(c.field)}>
                          {c.message}
                        </button>
                      </Show>
                      <Show when={c.code === "details_confirm" && !props.detail?.confirmed}>
                        <div class="mt-1.5">
                          <button
                            type="button"
                            class={SMALL_BTN + " !bg-[#AC2334] !text-white !border-[#AC2334] hover:!bg-[#93192a]"}
                            disabled={props.aiBusy}
                            onClick={() => props.onConfirm()}
                          >
                            <CheckCircle2 size={14} /> Confirm details
                          </button>
                        </div>
                      </Show>
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>

      {/* ══ Numbers ══ */}
      <div class={CARD + " p-4"}>
        <PanelTitle>Numbers</PanelTitle>
        {/* Every figure is the server's (display); nothing is computed here. */}
        <Switch
          fallback={
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Num label="Sub-total" value={display().subtotal} />
              <Num label="GST" value={display().gst} />
              <Num label="Total" value={display().total} strong />
              <Num label="Cost per qualified lead" value={display().cost_per_qualified} />
              <Show when={display().monthly_fee != null}>
                <Num label="Monthly fee" value={display().monthly_fee} />
              </Show>
              <Show when={display().total_monthly != null}>
                <Num label="Total monthly" value={display().total_monthly} />
              </Show>
            </dl>
          }
        >
          <Match when={modelKind() === "retainer"}>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <For each={Array.isArray(display().services) ? display().services : []}>
                {(s, i) => <Num label={s?.name || services()[i()]?.name || `Service ${i() + 1}`} value={s?.fee_f} />}
              </For>
              <Num label="Monthly fee" value={display().monthly_fee} />
              <Num label="GST" value={display().gst} />
              <Num label="Total monthly" value={display().total_monthly} strong />
              <Show when={display().contract_value != null && display().contract_value !== ""}>
                <Num label="Contract value" value={display().contract_value} strong />
              </Show>
            </dl>
          </Match>
          {/* Hybrid: whatever scalar figures display carries, in its order. */}
          <Match when={modelKind() === "hybrid"}>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <For each={displayScalars()} fallback={<p class="col-span-2 text-[#8593A8]">No figures yet.</p>}>
                {([k, v]) => <Num label={humanize(k.replace(/_f$/, ""))} value={v} strong={/^total/.test(k)} />}
              </For>
            </dl>
          </Match>
        </Switch>
        {/* Per-project breakdown, only when there is more than one project.
            The _f values arrive formatted ("1,100"). */}
        <Show when={displayLines().length > 1}>
          <div class="mt-3 overflow-x-auto rounded-lg border border-[#E2E8F1] dark:border-gray-700">
            <table class="w-full text-xs">
              <thead class="bg-[#F8FAFC] dark:bg-gray-800 text-[#54657E] dark:text-gray-400">
                <tr class="[&_th]:px-2.5 [&_th]:py-2 [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:whitespace-nowrap">
                  <th class="text-left">Project</th>
                  <th class="text-right">Leads</th>
                  <th class="text-right">CPL (₹)</th>
                  <th class="text-right">Qualified min</th>
                  <th class="text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody class="[&_td]:px-2.5 [&_td]:py-1.5 text-[#14233A] dark:text-gray-200">
                <For each={displayLines()}>
                  {(l) => (
                    <tr class="border-t border-[#E2E8F1] dark:border-gray-700">
                      <td class="max-w-[10rem] truncate" title={l.project ?? ""}>{l.project || "—"}</td>
                      <td class="text-right tabular-nums">{l.leads ?? "—"}</td>
                      <td class="text-right tabular-nums" title={l.cpl_with_gst_f ? `₹${l.cpl_with_gst_f} with GST` : undefined}>
                        {l.cpl_f ?? "—"}
                      </td>
                      <td class="text-right tabular-nums">{l.min_qualified ?? "—"}</td>
                      <td class="text-right tabular-nums font-semibold">{l.subtotal_f ?? "—"}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>

      {/* ══ Assumptions ══ */}
      <Show when={assumptions().length}>
        <div class={CARD + " p-4"}>
          <PanelTitle>Filled in because the brief did not say</PanelTitle>
          <ul class="space-y-1.5 text-sm">
            <For each={assumptions()}>
              {(a) => (
                <li class="flex items-start gap-2">
                  <Info size={15} class="flex-none mt-0.5 text-[#3E6FB0]" />
                  <span class="text-[#14233A] dark:text-gray-200">
                    <button type="button" class="font-semibold hover:underline" onClick={() => focusField(a.field)}>
                      {String(a.value_used ?? "—")}
                    </button>
                    <Show when={a.reason}>
                      <span class="text-[#54657E] dark:text-gray-400"> ({a.reason})</span>
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      {/* ══ Inputs ══ */}
      <div class={CARD + " p-4 space-y-5"}>
        <section>
          <PanelTitle>Client</PanelTitle>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Text label="Name" path="client.name" />
            <Text label="Company" path="client.company" />
          </div>
        </section>

        <section>
          <PanelTitle>Project</PanelTitle>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Text label="Name" path="project.name" />
            <Text label="Location" path="project.location" />
            <Select label="Category" path="project.category" options={categories()} class="sm:col-span-2" />
            <Text label="Description" path="project.description" multiline class="sm:col-span-2" />
          </div>
          <div class="mt-3">
            <p class={LABEL}>Facts</p>
            <div class="space-y-2">
              <Index each={list("project.facts")}>
                {(f, i) => (
                  <div class="flex items-center gap-2">
                    <input
                      class={FIELD + " !w-2/5"}
                      aria-label={`Fact ${i + 1} label`}
                      data-field={`project.facts.${i}.label`}
                      placeholder={rowPh("project.facts", i, "label") || "Label"}
                      value={f()?.label ?? ""}
                      onInput={(e) => setRow("project.facts", i, "label", e.target.value)}
                    />
                    <input
                      class={FIELD}
                      aria-label={`Fact ${i + 1} value`}
                      placeholder={rowPh("project.facts", i, "value") || "Value"}
                      value={f()?.value ?? ""}
                      onInput={(e) => setRow("project.facts", i, "value", e.target.value)}
                    />
                    <RemoveBtn label={`Remove fact ${i + 1}`} onClick={() => dropRow("project.facts", i)} />
                  </div>
                )}
              </Index>
            </div>
            <button type="button" class={SMALL_BTN + " mt-2"} onClick={() => addRow("project.facts", { label: "", value: "" })}>
              <Plus size={14} /> Add fact
            </button>
          </div>
        </section>

        <section>
          <PanelTitle>Deal</PanelTitle>
          <Select label="Model" path="model" options={models()} />

          <Show when={showCpl()}>
            <div class="mt-4 rounded-lg border border-[#E2E8F1] dark:border-gray-700 p-3">
              <p class="text-sm font-bold text-[#14233A] dark:text-white mb-2">CPL</p>
              <div class="space-y-2">
                <Index each={list("lines")}>
                  {(ln, i) => (
                    <div class="grid grid-cols-2 sm:grid-cols-[1.6fr_1fr_1fr_1fr_auto] gap-2 items-end">
                      <LineInput label="Project" path={`lines.${i}.project`} value={ln()?.project} ph={rowPh("lines", i, "project")} onInput={(v) => setRow("lines", i, "project", v)} class="col-span-2 sm:col-span-1" />
                      <LineInput label="Leads" numeric path={`lines.${i}.leads`} value={ln()?.leads} ph={rowPh("lines", i, "leads")} onInput={(v) => setRow("lines", i, "leads", v)} />
                      <LineInput label="CPL" numeric path={`lines.${i}.cpl`} value={ln()?.cpl} ph={rowPh("lines", i, "cpl")} onInput={(v) => setRow("lines", i, "cpl", v)} />
                      <LineInput label="Qualified %" numeric path={`lines.${i}.qualified_pct`} value={ln()?.qualified_pct} ph={rowPh("lines", i, "qualified_pct")} onInput={(v) => setRow("lines", i, "qualified_pct", v)} />
                      <RemoveBtn label={`Remove line ${i + 1}`} onClick={() => dropRow("lines", i)} />
                    </div>
                  )}
                </Index>
              </div>
              <button
                type="button"
                class={SMALL_BTN + " mt-2"}
                onClick={() => addRow("lines", { project: "", leads: "", cpl: "", qualified_pct: "" })}
              >
                <Plus size={14} /> Add line
              </button>
              <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <label class="inline-flex items-center gap-2 text-sm text-[#14233A] dark:text-gray-200 cursor-pointer pb-2.5">
                  <input
                    type="checkbox"
                    data-field="gst.inclusive"
                    class="accent-[#AC2334] w-4 h-4"
                    checked={!!(getPath(props.form, "gst.inclusive") ?? getPath(defaults(), "gst.inclusive"))}
                    onChange={(e) => props.setField(["gst"], { ...(getPath(props.form, "gst") ?? {}), inclusive: e.target.checked })}
                  />
                  Price includes GST
                </label>
                <Text label="Target days" path="timeline.target_days" numeric />
              </div>
            </div>
          </Show>

          {/* ── Retainership: services list + terms. The services list is
              sent whole on every change; money is shown from display only. */}
          <Show when={showRet()}>
            <div class="mt-4 rounded-lg border border-[#E2E8F1] dark:border-gray-700 p-3">
              <p class="text-sm font-bold text-[#14233A] dark:text-white mb-2">Retainership</p>

              <p class={LABEL}>
                Services<span class="text-[#AC2334]"> *</span>
              </p>
              <datalist id="pf-retainer-services">
                <For each={Object.keys(serviceDefaults())}>{(n) => <option value={n} />}</For>
              </datalist>
              <div class="space-y-2.5">
                <Index each={services()}>
                  {(s, i) => (
                    <div class="rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#FBFCFE] dark:bg-gray-800/60 p-2.5 space-y-2">
                      <div class="grid grid-cols-[1fr_9rem_auto] gap-2 items-end">
                        <LineInput
                          label="Service"
                          path={`retainership.services.${i}.name`}
                          list="pf-retainer-services"
                          value={s()?.name}
                          ph="e.g. Lead generation"
                          onInput={(v) => setServiceName(i, v)}
                        />
                        <LineInput
                          label="Fee / month (₹) *"
                          numeric
                          path={`retainership.services.${i}.fee`}
                          value={s()?.fee}
                          onInput={(v) => setService(i, "fee", v)}
                        />
                        <RemoveBtn
                          label={`Remove service ${i + 1}`}
                          disabled={services().length <= 1}
                          onClick={() => setServices(services().filter((_, j) => j !== i))}
                        />
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1">
                          Deliverables (one per line)
                        </label>
                        <textarea
                          class={FIELD + " !px-2.5 !py-2 min-h-[4.5rem] leading-relaxed"}
                          aria-label={`Service ${i + 1} deliverables`}
                          value={(s()?.deliverables ?? []).join("\n")}
                          placeholder={
                            (serviceDefaults()[s()?.name]?.deliverables ?? []).join("\n") ||
                            "Leave empty to print the standard list for this service."
                          }
                          onInput={(e) => setService(i, "deliverables", e.target.value.split("\n"))}
                        />
                      </div>
                      <LineInput
                        label="Objective"
                        path={`retainership.services.${i}.objective`}
                        value={s()?.objective}
                        ph={serviceDefaults()[s()?.name]?.objective ?? ""}
                        onInput={(v) => setService(i, "objective", v)}
                      />
                    </div>
                  )}
                </Index>
              </div>
              <button type="button" class={SMALL_BTN + " mt-2"} onClick={() => setServices([...services(), blankService()])}>
                <Plus size={14} /> Add service
              </button>

              <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="sm:col-span-2">
                  <p class={LABEL}>Recommended monthly ad budget, paid by client: from / to</p>
                  <div class="grid grid-cols-2 gap-2">
                    <Text label="From (₹)" path="retainership.ad_budget_min" numeric />
                    <Text label="To (₹)" path="retainership.ad_budget_max" numeric />
                  </div>
                </div>
                <Text label="Contract duration (months)" path="retainership.duration_months" numeric />
                <Text label="Notice period (days)" path="retainership.notice_days" numeric />
                <Text
                  label="Creative revision rounds per month"
                  path="retainership.revision_rounds"
                  numeric
                  help="0 removes the revisions clause."
                />
                <label class="inline-flex items-center gap-2 text-sm text-[#14233A] dark:text-gray-200 cursor-pointer self-end pb-2.5">
                  <input
                    type="checkbox"
                    data-field="retainership.replace_invalid"
                    class="accent-[#AC2334] w-4 h-4"
                    checked={(getPath(props.form, "retainership.replace_invalid") ?? getPath(defaults(), "retainership.replace_invalid") ?? true) !== false}
                    onChange={(e) => props.setField(["retainership", "replace_invalid"], e.target.checked)}
                  />
                  Replace invalid leads
                </label>
                <div class="sm:col-span-2">
                  <p class={LABEL}>Target markets</p>
                  <TagInput
                    value={Array.isArray(getPath(props.form, "retainership.target_markets")) ? getPath(props.form, "retainership.target_markets") : []}
                    placeholder="Add a market and press Enter"
                    onChange={(next) => props.setField(["retainership", "target_markets"], next)}
                  />
                </div>
              </div>
            </div>
          </Show>

          {/* ── Hybrid (model key pass_through): every lead billed at actual
              cost + markup_pct. That is the only percentage. */}
          <Show when={showPass()}>
            <div class="mt-4 rounded-lg border border-[#E2E8F1] dark:border-gray-700 p-3">
              <p class="text-sm font-bold text-[#14233A] dark:text-white mb-2">{hybridLabel()}</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Text
                  label="Service charge % on actual lead cost"
                  path="pass_through.markup_pct"
                  numeric
                  required
                  class="sm:col-span-2"
                  help="Every lead is billed at its actual cost + this %. 15 means a ₹100 lead is billed ₹115."
                />
                <Text label="Minimum monthly ad budget (funded by client)" path="pass_through.min_budget" numeric required />
                <Text label="Fixed monthly fee (optional)" path="pass_through.monthly_fee" numeric />
                <Text label="Expected leads per day" path="pass_through.leads_per_day" numeric />
                <Text label="Notice period (days)" path="pass_through.notice_days" numeric />
                <Text label="Commercial note" path="pass_through.terms_text" multiline class="sm:col-span-2" />
              </div>
            </div>
          </Show>
        </section>

        <section>
          <Text label="Payment terms" path="payment_terms" multiline />
        </section>

        {/* ══ T&C ══ inputs.terms {mode: standard|custom, custom_text}. Custom
            text is checked by the server (qualified % vs the deal, the 24-hour
            rule); its findings arrive in Checks like any other. */}
        <section>
          <PanelTitle>Terms &amp; conditions</PanelTitle>
          <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#14233A] dark:text-gray-200" role="radiogroup" aria-label="Terms">
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="pf-terms"
                data-field="terms.mode"
                class="accent-[#AC2334]"
                checked={termsMode() === "standard"}
                onChange={() => props.setField(["terms", "mode"], "standard")}
              />
              Standard T&amp;C (recommended)
            </label>
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="pf-terms"
                class="accent-[#AC2334]"
                checked={termsMode() === "custom"}
                onChange={() => props.setField(["terms", "mode"], "custom")}
              />
              Use my own T&amp;C
            </label>
          </div>
          <Show when={termsMode() === "standard" && String(getPath(props.form, "terms.custom_text") ?? "").trim()}>
            <p class="mt-2 text-xs text-[#54657E] dark:text-gray-400">
              Your brief included T&amp;C. Using standard terms.{" "}
              <button
                type="button"
                class="font-semibold text-[#AC2334] dark:text-red-300 underline"
                onClick={() => props.setField(["terms", "mode"], "custom")}
              >
                Use mine instead
              </button>
            </p>
          </Show>
          <Show when={termsMode() === "custom"}>
            <div class="mt-3">
              <label class={LABEL} for="pf-terms.custom_text">Your T&amp;C</label>
              <textarea
                id="pf-terms.custom_text"
                data-field="terms.custom_text"
                class={FIELD + " min-h-[10rem] leading-relaxed font-[inherit]"}
                value={val("terms.custom_text")}
                placeholder={"One clause per line. A line like \"1. Qualified Leads\" becomes a heading."}
                onInput={(e) => props.setField(["terms", "custom_text"], e.target.value)}
              />
              <p class="mt-1 text-xs text-[#8593A8] dark:text-gray-400">
                One clause per line; numbered lines like "1. Qualified Leads" become headings. They must state the same qualified % as the deal and include the 24-hour rule.
              </p>
            </div>
          </Show>
        </section>

        <section>
          <PanelTitle>Prepared by</PanelTitle>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Text label="Name" path="prepared_by.name" />
            <Text label="Designation" path="prepared_by.designation" />
            <Text label="Phone" path="prepared_by.phone" type="tel" />
            <Text label="Email" path="prepared_by.email" type="email" />
          </div>
        </section>

        <section>
          <PanelTitle>Look</PanelTitle>
          <div class="flex flex-wrap items-end gap-6">
            <div>
              <p class={LABEL}>Theme</p>
              <div class="flex gap-2" role="radiogroup" aria-label="Theme">
                <For each={themes()}>
                  {(t) => {
                    const sw = () => THEME_SWATCH[t.value] ?? { bg: "#54657E", accent: "#8593A8" };
                    const on = () => props.theme === t.value;
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on()}
                        title={t.label}
                        aria-label={t.label}
                        onClick={() => props.onTheme(t.value)}
                        class={
                          "w-9 h-9 rounded-full border-2 transition-transform " +
                          (on() ? "border-[#14233A] dark:border-white scale-110 ring-2 ring-offset-2 ring-[#14233A]/30 dark:ring-offset-gray-800" : "border-[#D4DDE9] dark:border-gray-600 hover:scale-105")
                        }
                        style={{ background: `linear-gradient(135deg, ${sw().bg} 0 58%, ${sw().accent} 58% 100%)` }}
                      />
                    );
                  }}
                </For>
              </div>
            </div>
            <div class="w-40">
              <label class={LABEL} for="pf-validity">Validity days</label>
              <input
                id="pf-validity"
                class={FIELD}
                inputmode="numeric"
                value={props.validity}
                onInput={(e) => props.onValidity(e.target.value)}
              />
            </div>
          </div>
        </section>
      </div>

      {/* ══ Copy ══ */}
      <BuilderCopy detail={props.detail} copy={props.copy} setCopyKey={props.setCopyKey} model={modelKind()} />

      {/* ══ Versions ══ */}
      <Show when={versions().length}>
        <div class={CARD + " p-4"}>
          <PanelTitle>Versions</PanelTitle>
          <div class="flex gap-2">
            <select class={FIELD} aria-label="Version" value={pickVersion()} onChange={(e) => setPickVersion(e.target.value)}>
              <option value="">Choose a version…</option>
              <For each={[...versions()].reverse()}>
                {(v) => (
                  <option value={String(v.version)}>
                    {`v${v.version}${v.version === props.detail?.current_version ? " (current)" : ""} · ${v.note || "—"} · ${nameOf(v.by) || "—"} · ${fmtWhen(v.created_at)}`}
                  </option>
                )}
              </For>
            </select>
            <button
              type="button"
              class={SMALL_BTN + " !px-4"}
              disabled={!pickVersion() || props.aiBusy || Number(pickVersion()) === props.detail?.current_version}
              onClick={async () => {
                if (await props.onRestore(Number(pickVersion()))) setPickVersion("");
              }}
            >
              Restore
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

const labelFor = (options, value) => options.find((o) => o.value === value)?.label ?? value;

function Num(props) {
  return (
    <>
      <dt class="text-[#54657E] dark:text-gray-400">{props.label}</dt>
      <dd class={"text-right tabular-nums " + (props.strong ? "font-bold text-[#14233A] dark:text-white" : "font-semibold text-[#14233A] dark:text-gray-100")}>
        {props.value == null || props.value === "" ? "—" : String(props.value)}
      </dd>
    </>
  );
}

function LineInput(props) {
  return (
    <div class={props.class}>
      <label class="block text-[10px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1">{props.label}</label>
      <input
        class={FIELD + " !px-2.5 !py-2"}
        data-field={props.path}
        inputmode={props.numeric ? "decimal" : undefined}
        list={props.list}
        value={props.value == null ? "" : String(props.value)}
        placeholder={props.ph}
        onInput={(e) => props.onInput(e.target.value)}
      />
    </div>
  );
}

function RemoveBtn(props) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={() => props.onClick()}
      class="flex-none inline-flex items-center justify-center w-9 h-9 rounded-lg text-[#8593A8] hover:text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/20 disabled:opacity-30 disabled:pointer-events-none"
    >
      <X size={16} />
    </button>
  );
}
