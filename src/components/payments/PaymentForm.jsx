import { createSignal, createMemo, For, Show, batch } from "solid-js";
import EntityPicker from "./EntityPicker";
import {
  fetchPaymentClients,
  fetchPaymentOrganizations,
} from "../../services/payments";
import { computeGstPreview, GST_OPTIONS } from "./gst";
import { resolveOrgSelection, clientsForOrg } from "./orgClientRule";
import {
  fieldClass,
  labelClass,
  fmtMoney,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  methodLabel,
  toDateTimeInput,
  fromDateTimeInput,
} from "./paymentsFormat";

// ─── Shared record / edit payment form ────────────────────────────────────────
// One component behind four surfaces (accounts Record, accounts Edit, tier-1 CM
// Record, and the Needs-Docs completion) so the GST preview and the validation
// rules can't drift between them. What differs is passed in, not forked:
//
//   mode         "create" | "edit"
//   canFillDocs  true for accounts/admin → reveals reference_id / invoice_url /
//                paid_at. A tier-1 CM never sees these; accounts fills them, and
//                the API 403s a CM PATCH regardless.
//   canSetStatus true for accounts/admin → reveals the SETTLEMENT status
//                dropdown. Deliberately a separate flag from canFillDocs even
//                though both are currently "is accounts": they gate different
//                fields for different reasons, and collapsing them would make
//                the next role change ambiguous.
//   payment      the existing normalized row (edit only) — prefills the inputs.
//   onSubmit     (values) => Promise. The PARENT owns the API call so this
//                component stays presentational.
//
// The ORGANIZATION picker is shown to every role that can reach this form
// (accounts and tier-1 CM alike). Left empty, the backend derives the org from
// the client's campaigns — so blank is safe, just less deliberate.
//
// CLIENT AND ORGANIZATION STEER EACH OTHER, and neither ever locks the other:
//   • pick a CLIENT first → the org is seeded from that client's own
//     organization_id, unless the operator has already picked an org deliberately
//     (a client pick must not quietly rewrite a considered choice)
//   • pick an ORGANIZATION first → exactly one client under it is PRE-FILLED and
//     announced by name; several are narrowed-to and the list is opened for the
//     operator to choose; none leaves the client untouched and says so
//
// Every one of those is a starting point. The client field is never disabled and
// never restricted — the narrowing is a view with a "Show all clients" way back,
// because a hard filter would strand the clients whose org link is missing.
//
// The preview panel is explicitly labelled as a preview: the server recomputes
// on save and the caller re-renders the returned row.

export default function PaymentForm(props) {
  const isEdit = () => props.mode === "edit";
  const existing = () => props.payment ?? null;

  // ── Field state (prefilled from the row in edit mode) ──────────────────────
  const [clientNomen, setClientNomen] = createSignal(
    existing()?.clientNomen ?? null,
  );
  const [baseAmount, setBaseAmount] = createSignal(
    existing()?.baseAmount != null ? String(existing().baseAmount) : "",
  );
  const [tdsApplied, setTdsApplied] = createSignal(!!existing()?.tdsApplied);
  const [tdsAmount, setTdsAmount] = createSignal(
    existing()?.tdsAmount != null ? String(existing().tdsAmount) : "",
  );
  const [gstPct, setGstPct] = createSignal(
    existing()?.gstPct != null ? String(existing().gstPct) : String(GST_OPTIONS[1]),
  );
  const [method, setMethod] = createSignal(existing()?.method ?? "");
  const [organization, setOrganization] = createSignal(
    existing()?.organization ?? null,
  );
  const [status, setStatus] = createSignal(existing()?.status ?? "");
  const [project, setProject] = createSignal(existing()?.project ?? "");
  const [notes, setNotes] = createSignal(existing()?.notes ?? "");
  const [referenceId, setReferenceId] = createSignal(
    existing()?.referenceId ?? "",
  );
  const [invoiceUrl, setInvoiceUrl] = createSignal(existing()?.invoiceUrl ?? "");
  const [paidAt, setPaidAt] = createSignal(toDateTimeInput(existing()?.paidAt));

  const [touched, setTouched] = createSignal(false);
  // Tracks whether the org currently in the box came from the client rather
  // than from the operator. Drives the hint, and decides whether a later client
  // pick may overwrite it — an operator's deliberate org must survive one.
  const [orgFromClient, setOrgFromClient] = createSignal(false);

  // ── Organization → client steering ────────────────────────────────────────
  // The loaded option lists, handed over by the pickers as they resolve. The
  // form needs the client list to know whether an organization has one client or
  // several; taking it from the picker avoids fetching the same endpoint twice.
  const [clientOptions, setClientOptions] = createSignal([]);
  const [orgOptions, setOrgOptions] = createSignal([]);

  // Which organization the CLIENT list is currently narrowed to, or null for the
  // full list. Deliberately separate from organization(): "Show all clients"
  // drops the narrowing without disturbing the org the operator picked.
  const [clientOrgFilter, setClientOrgFilter] = createSignal(null);

  // Bumped to hand the operator into the client list when an org has several.
  const [clientFocusToken, setClientFocusToken] = createSignal(0);

  // What the last organization pick did to the client field, in words.
  // { tone: "info" | "warn", text }. Never null-and-silent: an auto-fill the
  // operator didn't see is how money gets booked against the wrong client.
  const [orgNotice, setOrgNotice] = createSignal(null);

  const sameId = (a, b) =>
    a !== null && a !== undefined && String(a) === String(b);

  // Counted by the rule module, so the "showing N of…" hint and the rule can
  // never disagree about how many clients an organization has.
  const clientsInOrg = (orgId) => clientsForOrg(clientOptions(), orgId);

  const clientName = (id) =>
    clientOptions().find((c) => sameId(c.id, id))?.name ?? null;

  const orgName = (id) =>
    orgOptions().find((o) => sameId(o.id, id))?.name ?? "this organization";

  // ── Client → organization pre-select (RECORD ONLY) ────────────────────────
  // /payments/clients/ now carries each client's real organization_id, so
  // picking a client seeds the org dropdown. It stays fully editable — this is
  // a starting point, not a lock.
  //
  // Record only, never Edit: an existing row already has an organization, and
  // re-seeding it from the client would quietly rewrite a value accounts may
  // have deliberately corrected.
  //
  // A null organization_id (the ~14 clients whose user has no org) clears the
  // field instead of leaving the previous client's org sitting there — a stale
  // org is worse than a blank one, because blank makes the backend derive it.
  //
  // It seeds ONLY into an org the operator hasn't chosen for themselves. Once
  // they pick an org — and especially once that pick has narrowed this very
  // list — a client selection rewriting it would undo the choice that produced
  // the list they just picked from. Worse, a client with a null organization_id
  // would blank it entirely. The existing rule for edit mode ("don't rewrite a
  // value accounts may have deliberately corrected") is the same argument; this
  // extends it to a deliberate pick on the record form.
  const handleClientChange = (id, option) => {
    batch(() => {
      setClientNomen(id);
      // The operator has now spoken about the client, so whatever the last
      // organization pick did to this field is history.
      setOrgNotice(null);
      if (isEdit()) return;
      const deliberateOrg = organization() != null && !orgFromClient();
      if (deliberateOrg) return;
      const orgId = option?.organizationId ?? null;
      setOrganization(orgId);
      setOrgFromClient(orgId !== null);
    });
  };

  // ── Organization → client ─────────────────────────────────────────────────
  // One rule, re-run on EVERY organization pick — including one made after a
  // client is already chosen, so a client from a different org can never just
  // sit there unremarked.
  //
  // What it never does: clear a client. Clearing the organization leaves the
  // client alone (an operator who blanks an optional field has not asked to lose
  // a required one), and neither does the "no clients here" case. The only write
  // into the client field is the single-match pre-fill, which announces itself.
  const handleOrgChange = (id) => {
    batch(() => {
      setOrganization(id);
      setOrgFromClient(false); // an explicit pick is no longer the client's

      // Edit mode has no client picker to steer — the client is fixed on an
      // existing payment — so the rule doesn't apply.
      if (isEdit()) return;

      // The decision lives in orgClientRule.js; this only applies it. `pick`
      // null always means "leave the client alone" — the rule has no outcome
      // that clears it.
      const outcome = resolveOrgSelection({
        orgId: id,
        clients: clientOptions(),
        currentClientId: clientNomen(),
        currentClientName: clientName(clientNomen()),
        orgLabel: orgName(id),
      });

      if (outcome.pick) setClientNomen(outcome.pick.id);
      setClientOrgFilter(outcome.filterOrgId);
      setOrgNotice(outcome.notice);
      if (outcome.focusClient) setClientFocusToken((n) => n + 1);
    });
  };

  // A historical row may carry a method from before the enum was enforced.
  // Surfacing it as a disabled option keeps the select from silently showing
  // blank (which would look like "no method" and re-save as a change) while
  // still making the six valid choices the only selectable ones.
  const legacyMethod = createMemo(() => {
    const m = existing()?.method;
    if (!m) return null;
    return PAYMENT_METHODS.some((o) => o.value === String(m).toLowerCase())
      ? null
      : m;
  });

  // ── Live preview — mirrors Payment.save(), never transmitted ───────────────
  const preview = createMemo(() =>
    computeGstPreview({
      baseAmount: baseAmount(),
      tdsApplied: tdsApplied(),
      tdsAmount: tdsAmount(),
      gstPct: gstPct(),
    }),
  );

  // ── Validation ────────────────────────────────────────────────────────────
  const baseNum = () => {
    const n = Number(baseAmount());
    return baseAmount() !== "" && Number.isFinite(n) ? n : null;
  };
  const tdsNum = () => {
    const n = Number(tdsAmount());
    return tdsAmount() !== "" && Number.isFinite(n) ? n : null;
  };

  const errors = createMemo(() => {
    const e = {};
    if (!isEdit() && (clientNomen() === null || clientNomen() === ""))
      e.client = "Pick the client this payment is for.";
    if (baseNum() === null) e.base = "Enter the base amount.";
    else if (baseNum() <= 0) e.base = "Base amount must be greater than zero.";
    if (tdsApplied() && tdsNum() === null)
      e.tds = "Enter the TDS amount, or switch TDS off.";
    else if (tdsApplied() && tdsNum() < 0)
      e.tds = "TDS amount can't be negative.";
    if (!method()) e.method = "Select how the payment was made.";
    return e;
  });

  const isValid = () => Object.keys(errors()).length === 0;
  const show = (key) => (touched() ? errors()[key] : undefined);

  // Filling a reference on a pending payment flips docs_status server-side —
  // surface that BEFORE the operator saves, not as a surprise afterwards.
  const willCompleteDocs = () =>
    isEdit() &&
    String(existing()?.docsStatus ?? "").toLowerCase() === "pending" &&
    referenceId().trim() !== "";

  // In edit mode only send what actually changed — a true partial PATCH keeps
  // an untouched amount from triggering a needless server-side GST recompute.
  const changedEditValues = () => {
    const before = existing() ?? {};
    const out = {};
    const put = (key, next, prev) => {
      const a = next === "" ? null : next;
      const b = prev === undefined || prev === "" ? null : prev;
      if (String(a ?? "") !== String(b ?? "")) out[key] = next;
    };
    put("referenceId", referenceId().trim(), before.referenceId);
    put("invoiceUrl", invoiceUrl().trim(), before.invoiceUrl);
    put("notes", notes(), before.notes);
    put("method", method(), before.method);
    // Compare in the input's local format, but SEND an absolute instant.
    if (paidAt() !== toDateTimeInput(before.paidAt))
      out.paidAt = fromDateTimeInput(paidAt());
    put("baseAmount", baseNum(), before.baseAmount);
    put("gstPct", Number(gstPct()), before.gstPct);
    if (String(organization() ?? "") !== String(before.organization ?? ""))
      out.organization = organization();
    if (props.canSetStatus) put("status", status(), before.status);
    if (tdsApplied() !== !!before.tdsApplied) out.tdsApplied = tdsApplied();
    const nextTds = tdsApplied() ? (tdsNum() ?? 0) : 0;
    if (String(nextTds) !== String(before.tdsAmount ?? 0))
      out.tdsAmount = nextTds;
    return out;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!isValid() || props.submitting) return;

    if (isEdit()) {
      props.onSubmit?.(changedEditValues());
    } else {
      props.onSubmit?.({
        clientNomen: clientNomen(),
        baseAmount: baseNum(),
        tdsApplied: tdsApplied(),
        tdsAmount: tdsApplied() ? (tdsNum() ?? 0) : 0,
        gstPct: Number(gstPct()),
        method: method(),
        project: project().trim(),
        notes: notes().trim(),
        // Optional paperwork — add-funds now accepts these, so accounts can
        // file the reference at record-time instead of recording and then
        // re-opening the row in Edit. Blank stays blank; the service drops
        // empty values rather than posting "".
        referenceId: referenceId().trim(),
        invoiceUrl: invoiceUrl().trim(),
        paidAt: fromDateTimeInput(paidAt()),
        // Optional; the backend derives the org when this is null.
        organization: organization(),
        // Accounts only. Omitted for a CM, so the server applies "pending".
        status: props.canSetStatus ? status() : "",
      });
    }
  };

  const resetForm = () => {
    batch(() => {
      setClientNomen(null);
      setBaseAmount("");
      setTdsApplied(false);
      setTdsAmount("");
      setGstPct(String(GST_OPTIONS[1]));
      setMethod("");
      setOrganization(null);
      setOrgFromClient(false);
      setStatus("");
      setProject("");
      setNotes("");
      setReferenceId("");
      setInvoiceUrl("");
      setPaidAt("");
      setTouched(false);
    });
  };
  // Hand the parent a handle so it can clear the form after a successful
  // create. A plain callback rather than `ref` — this isn't a DOM node, and
  // `ref` on a component carries compiler semantics we don't want here.
  props.onReady?.({ reset: resetForm });

  const previewRow = (label, value, opts = {}) => (
    <div class="flex items-baseline justify-between gap-4 py-1.5">
      <span
        class={`text-sm ${opts.strong ? "font-bold text-[#14233A] dark:text-white" : "text-[#54657E] dark:text-gray-400"}`}
      >
        {label}
      </span>
      <span
        class={`tabular-nums ${
          opts.strong
            ? "text-xl font-extrabold text-[#15966A] dark:text-green-300"
            : "text-sm font-semibold text-[#14233A] dark:text-gray-200"
        }`}
      >
        {value}
      </span>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* ════════ INPUTS ════════ */}
      <div class="lg:col-span-2 space-y-5">
        {/* Client — locked in edit mode: PATCH cannot re-book a payment
            against a different nomen. */}
        <Show
          when={!isEdit()}
          fallback={
            <div>
              <label class={labelClass}>Client</label>
              <div class="px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F6F9FC] dark:bg-gray-800 text-sm font-semibold text-[#14233A] dark:text-gray-200">
                {existing()?.clientName ??
                  (existing()?.clientNomen != null
                    ? `Client #${existing().clientNomen}`
                    : "—")}
              </div>
              <p class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-500">
                The client can't be changed on an existing payment.
              </p>
            </div>
          }
        >
          <EntityPicker
            fetcher={fetchPaymentClients}
            label="Client"
            required
            placeholder="Select a client…"
            value={clientNomen()}
            onChange={handleClientChange}
            onOptions={setClientOptions}
            focusToken={clientFocusToken()}
            filter={
              clientOrgFilter() == null
                ? undefined
                : (o) => sameId(o.organizationId, clientOrgFilter())
            }
            disabled={props.submitting}
            error={show("client")}
            forbiddenMsg="You don't have access to the client list for payments."
            errorMsg="Could not load the client list. Please retry."
            emptyMsg="No clients available to you."
            emptyFilteredMsg="No clients under the selected organization."
            hint={
              clientOrgFilter() == null ? undefined : (
                <>
                  Showing the {clientsInOrg(clientOrgFilter()).length} clients
                  under {orgName(clientOrgFilter())}.{" "}
                  <button
                    type="button"
                    onClick={() => setClientOrgFilter(null)}
                    class="underline underline-offset-2 font-medium text-[#14233A] dark:text-gray-300 hover:text-[#AC2334] dark:hover:text-red-300"
                  >
                    Show all clients
                  </button>
                </>
              )
            }
          />
        </Show>

        {/* Organization — both roles. Seeded from the selected client, or picked
            first to steer the client field (see handleOrgChange). Always
            editable either way. "NA" is a real org in this list, not a
            placeholder. */}
        <EntityPicker
          fetcher={fetchPaymentOrganizations}
          label="Organization"
          placeholder="Select an organization…"
          allowClear
          clearLabel="Let the system decide"
          value={organization()}
          onChange={handleOrgChange}
          onOptions={setOrgOptions}
          disabled={props.submitting}
          hint={
            orgFromClient()
              ? "Pre-filled from the selected client — change it if that's wrong."
              : "Optional — if you leave this unset, the org is derived from the client's campaigns."
          }
          forbiddenMsg="You don't have access to the organization list."
          errorMsg="Could not load organizations. You can still save without one."
        />

        {/* What the last organization pick did to the client field. Amber when
            it needs a decision (nothing to pre-fill, or a client that no longer
            belongs), muted when it is just reporting a pre-fill. Nothing here is
            an error — the form is still perfectly saveable in every one of these
            states — so none of it uses the error red. */}
        <Show when={orgNotice()}>
          <p
            class={
              "-mt-2 text-xs " +
              (orgNotice().tone === "warn"
                ? "text-[#B07A14] dark:text-yellow-300"
                : "text-[#8593A8] dark:text-gray-500")
            }
          >
            {orgNotice().text}
          </p>
        </Show>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Base amount */}
          <div>
            <label class={labelClass}>
              Base amount (₹) <span class="text-[#AC2334]">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              inputmode="decimal"
              value={baseAmount()}
              disabled={props.submitting}
              onInput={(e) => setBaseAmount(e.currentTarget.value)}
              placeholder="0.00"
              class={
                fieldClass +
                (show("base") ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
              }
            />
            <Show when={show("base")}>
              <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
                {show("base")}
              </p>
            </Show>
          </div>

          {/* GST slab */}
          <div>
            <label class={labelClass}>
              GST % <span class="text-[#AC2334]">*</span>
            </label>
            <select
              value={gstPct()}
              disabled={props.submitting}
              onChange={(e) => setGstPct(e.currentTarget.value)}
              class={fieldClass}
            >
              <For each={GST_OPTIONS}>
                {(g) => <option value={String(g)}>{g}%</option>}
              </For>
            </select>
          </div>
        </div>

        {/* TDS toggle + amount */}
        <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-[#F6F9FC] dark:bg-gray-800/60 p-4">
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={tdsApplied()}
              disabled={props.submitting}
              onChange={(e) => setTdsApplied(e.currentTarget.checked)}
              class="mt-0.5 w-4 h-4 rounded border-[#E2E8F1] text-[#14233A] focus:ring-[#14233A]/30"
            />
            <span>
              <span class="block text-sm font-bold text-[#14233A] dark:text-gray-100">
                TDS deducted by the client
              </span>
              <span class="block text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                Adds the TDS back before GST — the client's invoice value is the
                base plus the tax they withheld.
              </span>
            </span>
          </label>

          <Show when={tdsApplied()}>
            <div class="mt-4 sm:max-w-xs">
              <label class={labelClass}>
                TDS amount (₹) <span class="text-[#AC2334]">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                inputmode="decimal"
                value={tdsAmount()}
                disabled={props.submitting}
                onInput={(e) => setTdsAmount(e.currentTarget.value)}
                placeholder="0.00"
                class={
                  fieldClass +
                  (show("tds") ? " border-[#AC2334] focus:ring-[#AC2334]/25" : "")
                }
              />
              <Show when={show("tds")}>
                <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
                  {show("tds")}
                </p>
              </Show>
            </div>
          </Show>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Method */}
          <div>
            <label class={labelClass}>
              Method <span class="text-[#AC2334]">*</span>
            </label>
            {/* Exactly the six PaymentMethod enum values — no free-text escape.
                The API rejects anything else, so offering more would only
                manufacture 400s. */}
            <select
              value={method()}
              disabled={props.submitting}
              onChange={(e) => setMethod(e.currentTarget.value)}
              class={
                fieldClass +
                (show("method")
                  ? " border-[#AC2334] focus:ring-[#AC2334]/25"
                  : "")
              }
            >
              <option value="">Select method…</option>
              <For each={PAYMENT_METHODS}>
                {(m) => <option value={m.value}>{m.label}</option>}
              </For>
              <Show when={legacyMethod()}>
                <option value={legacyMethod()} disabled>
                  {methodLabel(legacyMethod())} (no longer available)
                </option>
              </Show>
            </select>
            <Show when={show("method")}>
              <p class="mt-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
                {show("method")}
              </p>
            </Show>
          </div>

          {/* Settlement status — ACCOUNTS ONLY. This is the "has the money
              landed" axis, not the paperwork one; a CM never sets it and the
              server defaults their entries to pending. */}
          <Show when={props.canSetStatus}>
            <div>
              <label class={labelClass}>Payment status</label>
              <select
                value={status()}
                disabled={props.submitting}
                onChange={(e) => setStatus(e.currentTarget.value)}
                class={fieldClass}
              >
                <option value="">Pending (default)</option>
                <For each={PAYMENT_STATUSES}>
                  {(s) => <option value={s.value}>{s.label}</option>}
                </For>
              </select>
              <p class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-500">
                Whether the money has settled — separate from the paperwork
                state below.
              </p>
            </div>
          </Show>

          {/* Project (optional) */}
          <div>
            <label class={labelClass}>Project (optional)</label>
            <input
              type="text"
              value={project()}
              disabled={props.submitting}
              onInput={(e) => setProject(e.currentTarget.value)}
              placeholder="Leave blank if not project-specific"
              class={fieldClass}
            />
          </div>
        </div>

        {/* ── Accounts-only paperwork block ──────────────────────────────────
            A tier-1 CM never sees these fields: accounts owns the reference and
            the invoice. The API 403s a CM PATCH anyway — this is the UX half of
            the same rule. */}
        <Show when={props.canFillDocs}>
          <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 p-4 space-y-5">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Paperwork
              </p>
              <p class="mt-1 text-xs text-[#54657E] dark:text-gray-400">
                <Show
                  when={isEdit()}
                  fallback="All optional — fill what you have now, or add it later from the ledger. Leaving the date blank records the payment as of now."
                >
                  Editable at any time; an amount change is recomputed by the
                  server.
                </Show>
              </p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label class={labelClass}>Reference ID</label>
                <input
                  type="text"
                  value={referenceId()}
                  disabled={props.submitting}
                  onInput={(e) => setReferenceId(e.currentTarget.value)}
                  placeholder="UTR / transaction reference"
                  class={fieldClass}
                />
              </div>
              <div>
                <label class={labelClass}>Payment date &amp; time</label>
                <input
                  type="datetime-local"
                  value={paidAt()}
                  disabled={props.submitting}
                  onInput={(e) => setPaidAt(e.currentTarget.value)}
                  class={fieldClass}
                />
              </div>
            </div>

            <div>
              <label class={labelClass}>Invoice URL</label>
              <input
                type="url"
                value={invoiceUrl()}
                disabled={props.submitting}
                onInput={(e) => setInvoiceUrl(e.currentTarget.value)}
                placeholder="https://…"
                class={fieldClass}
              />
            </div>

            <Show when={willCompleteDocs()}>
              <div class="flex items-start gap-2.5 rounded-lg bg-[#E9F7F1] dark:bg-green-900/20 border border-[#15966A]/25 px-3.5 py-2.5">
                <svg
                  class="w-4 h-4 mt-0.5 flex-none text-[#15966A]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <p class="text-xs font-semibold text-[#15966A] dark:text-green-300">
                  Saving with a reference marks this payment{" "}
                  <b>complete</b> — it will leave the Needs-Docs queue.
                </p>
              </div>
            </Show>
          </div>
        </Show>

        {/* Notes */}
        <div>
          <label class={labelClass}>Notes</label>
          <textarea
            rows="3"
            value={notes()}
            disabled={props.submitting}
            onInput={(e) => setNotes(e.currentTarget.value)}
            placeholder="Anything accounts should know about this payment…"
            class={fieldClass + " resize-y"}
          />
        </div>

        {/* Server-side failure (403, validation, network). Rendered verbatim —
            the API's message is more specific than anything we'd invent. */}
        <Show when={props.error}>
          <div class="rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3">
            <p class="text-sm font-semibold text-[#AC2334] dark:text-red-300">
              {props.error}
            </p>
          </div>
        </Show>

        <div class="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={props.submitting}
            class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#14233A] text-white text-sm font-bold hover:bg-[#1d3252] disabled:opacity-60 disabled:cursor-default transition-colors"
          >
            <Show when={props.submitting}>
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </Show>
            {props.submitting
              ? "Saving…"
              : isEdit()
                ? "Save changes"
                : (props.submitLabel ?? "Record payment")}
          </button>
          <Show when={props.onCancel}>
            <button
              type="button"
              onClick={() => props.onCancel?.()}
              disabled={props.submitting}
              class="px-5 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-800 disabled:opacity-60 transition-colors"
            >
              Cancel
            </button>
          </Show>
        </div>
      </div>

      {/* ════════ LIVE PREVIEW ════════ */}
      <aside class="lg:col-span-1">
        <div class="lg:sticky lg:top-6 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5">
          <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Preview
          </p>

          <div class="mt-3 divide-y divide-[#E2E8F1] dark:divide-gray-700">
            {previewRow("Base amount", fmtMoney(baseNum(), 2))}
            <Show when={tdsApplied()}>
              {previewRow("TDS added back", fmtMoney(tdsNum() ?? 0, 2))}
            </Show>
            {previewRow("Excluding GST", fmtMoney(preview().excludingGst, 2))}
            {previewRow(`GST @ ${gstPct()}%`, fmtMoney(preview().gstAmount, 2))}
            {previewRow("Including GST", fmtMoney(preview().includingGst, 2))}
            {previewRow("Final amount", fmtMoney(preview().finalAmount, 0), {
              strong: true,
            })}
          </div>

          <p class="mt-4 pt-3 border-t border-[#E2E8F1] dark:border-gray-700 text-xs leading-relaxed text-[#54657E] dark:text-gray-400">
            Indicative only. The server recomputes GST on save and the saved row
            is what counts — this panel just mirrors the formula while you type.
          </p>
        </div>
      </aside>
    </form>
  );
}
