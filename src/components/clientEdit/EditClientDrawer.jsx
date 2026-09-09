import { createResource, createSignal, createMemo, createEffect, For, Show } from "solid-js";
import {
  fetchClientDetail,
  fetchClientWriteSchema,
  fetchCommercialHistory,
  updateClient,
  collectFieldErrors,
  errorBanner,
} from "../../services/clientEdit";
import { fetchOnboardingOptions } from "../../services/onboarding";
import {
  fieldsFromSchema,
  fieldsFromRecord,
  toFormValue,
  toWireValue,
  sameValue,
  choiceLabel,
  isSalesField,
  salesChoices,
  needsReasonFor,
  isReasonField,
} from "./clientFieldModel";

// ─── Edit client drawer ───────────────────────────────────────────────────────
// The counterpart to the onboarding wizard: that screen creates a client, this
// one changes it afterwards. It writes PATCH /clients/admin/clients/{id}/ and
// sends ONLY the fields the operator actually touched — a full PUT would blank
// every field this form doesn't render, and it deliberately doesn't render all
// of them (see clientFieldModel.js for how the field list is discovered).
//
// Props: open, clientId (Client PK), clientLabel, onSaved(record), onClose()

const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 " +
  "bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-100 " +
  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none " +
  "disabled:opacity-50 transition";

const FIELD_BAD =
  "border-[#AC2334] focus:border-[#AC2334] ring-1 ring-[#AC2334]/30";

const LABEL =
  "block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5";

const HINT = "text-xs text-[#8593A8] mt-1";

const ERR_TEXT = "mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400";

// "cpl" → "CPL", "hybrid" → "Hybrid". The acronym stays an acronym.
const fmtType = (t) => {
  const s = String(t ?? "");
  if (!s) return "—";
  return s === "cpl" ? "CPL" : s.charAt(0).toUpperCase() + s.slice(1);
};

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export default function EditClientDrawer(props) {
  // Keyed on the client so re-opening for a different one refetches, and closing
  // releases the request rather than holding a stale record.
  const key = () =>
    props.open && props.clientId != null ? String(props.clientId) : null;

  // One resource for both calls: the form needs the record AND the write schema
  // together, and rendering half of it would flash a field list that then
  // changes shape underneath the operator.
  const [loaded] = createResource(key, async (id) => {
    const [record, schema] = await Promise.all([
      fetchClientDetail(id),
      fetchClientWriteSchema(id),
    ]);
    return { record, schema };
  });

  const record = () => loaded()?.record ?? null;
  const schema = () => loaded()?.schema ?? null;

  // ── The sales roster ──────────────────────────────────────────────────────
  // Loaded once per drawer mount, not per client — it is the same list for
  // every row, and re-fetching it on each open would cost a round trip for a
  // list that hasn't changed. Failure is not fatal: without it the sales field
  // simply falls back to whatever the write schema published.
  const [sales] = createResource(async () => {
    try {
      return salesChoices((await fetchOnboardingOptions())?.salesUsers);
    } catch (err) {
      console.warn("[EditClientDrawer] sales roster unavailable:", err?.message);
      return [];
    }
  });

  // Side-supplied choices, keyed by field name. Built off the names the payload
  // actually used, so the roster attaches to `onboarded_by`, `onboarded_by_id`
  // or whatever else the serializer called it — without asserting that any of
  // them exists.
  const extras = createMemo(() => {
    const roster = sales();
    if (!roster?.length) return null;
    const names = new Set([
      ...Object.keys(schema() || {}),
      ...Object.keys(record() || {}),
    ]);
    const out = {};
    for (const n of names) if (isSalesField(n)) out[n] = roster;
    return Object.keys(out).length ? out : null;
  });

  const fields = createMemo(() => {
    const r = record();
    if (!r) return [];
    const s = schema();
    return s
      ? fieldsFromSchema(s, r, extras())
      : fieldsFromRecord(r, extras());
  });

  // Whether this client's record exposes a sales owner at all. When it doesn't,
  // the drawer says so — the alternative is an operator hunting for a field that
  // the serializer never offered, on a screen that otherwise looks complete.
  const hasSalesField = createMemo(() => fields().some((f) => isSalesField(f.name)));

  // ── Commercial history ────────────────────────────────────────────────────
  // Shown where the edit is made, not on a separate screen: the question "has
  // anyone moved this rate before, and why" is one you have while looking at the
  // rate. Loaded on demand — most opens of this drawer are not audits, and the
  // table is empty for every client until someone makes the first real edit.
  const [historyOpen, setHistoryOpen] = createSignal(false);

  const [history] = createResource(
    () => (historyOpen() && props.clientId != null ? String(props.clientId) : null),
    async (id) => {
      try {
        return await fetchCommercialHistory(id);
      } catch (err) {
        console.warn("[EditClientDrawer] commercial history failed:", err?.message);
        return null; // distinct from [] — "could not read" is not "never changed"
      }
    },
  );

  // from_value / to_value arrive as stored values, and null is meaningful: it is
  // how a service charge cleared by a switch to CPL is recorded.
  const histValue = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

  // `onboarded_by` rows store the EMAIL rather than the FK, so a row reads
  // "priya@… → rahul@…" instead of "12 → 31" — the same argument that put names
  // in the confirmation panel, applied on the audit surface.
  const histField = (name) =>
    ({
      client_type: "Client type",
      service_charge: "Service charge",
      onboarded_by: "Sales person",
      onboarded_by_id: "Sales person",
      data_visible_from: "Data visible from",
    })[name] ?? String(name ?? "").replace(/_/g, " ");

  const histWho = (row) => row?.changed_by || row?.changed_by_email || "—";

  const histWhen = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ── Identity ──────────────────────────────────────────────────────────────
  // Read-only context: which client this is, and why the fields here are fixed.
  //
  // The nomen belongs in this block rather than in the form. It is not on the
  // serializer AND A3 settled that it is never reassignable — campaigns,
  // CampaignNomenHistory, payments, configs and the per-day ownership filter all
  // key on it — so an editable box for it was offering an edit that saves
  // nothing. It shows the NAME; the id is a fallback for a payload that carries
  // no name, not the default.
  const identity = createMemo(() => {
    const r = record();
    if (!r) return [];

    const nomen =
      r.client_nomen_name ||
      props.clientLabel ||
      (r.client_nomen != null ? `#${r.client_nomen}` : null);

    // The sales owner used to sit here, as a read-only row explaining why it
    // couldn't be changed. R1 (52576ab) made it writable, so it moved into the
    // form — a value shown twice, once as fixed and once as a dropdown, is worse
    // than either alone. What is left here is only what genuinely has no input.
    return [
      {
        label: "Client nomen",
        value: nomen,
        note: "Fixed. Reassigning it would orphan campaigns, payments and configs, so the API refuses it.",
      },
      {
        label: "Email",
        value: r.email,
        note: "The login identity. Not editable here — it needs a user route that doesn't exist yet.",
      },
      { label: "Organisation", value: r.organization_name, note: null },
      { label: "Onboarded", value: fmtDate(r.created_at), note: null },
    ].filter((row) => row.value != null && row.value !== "");
  });

  // True when no write schema came back, so the field list is our reading of the
  // record rather than the backend's statement of what it accepts. The form says
  // so out loud — an operator should know when a field being here is an
  // assumption.
  const inferred = () => !!record() && !schema();

  const editable = createMemo(() =>
    fields().filter((f) => f.widget !== "unsupported"),
  );
  const unsupported = createMemo(() =>
    fields().filter((f) => f.widget === "unsupported"),
  );

  const [values, setValues] = createSignal({});
  const [errors, setErrors] = createSignal({});
  const [banner, setBanner] = createSignal(null);
  const [saving, setSaving] = createSignal(false);

  // ── Seeding ───────────────────────────────────────────────────────────────
  // The field list can change AFTER the operator has started typing: the sales
  // roster arrives on its own request, and a field it lands on turns from a text
  // box into a select. Re-seeding wholesale on every change would throw away
  // edits made in that window, so only a NEW client seeds everything — a later
  // reshape re-seeds just the fields that actually changed shape.
  //
  // Plain locals, not signals: they are written only from inside this effect and
  // nothing renders off them, so making them reactive would only risk a loop.
  let seededFor = null;
  let seededWidgets = {};

  createEffect(() => {
    const r = record();
    const fs = fields();

    // Closed, or between clients — forget the seed so reopening the SAME client
    // starts from the server's values rather than from an abandoned edit.
    if (!r) {
      seededFor = null;
      seededWidgets = {};
      return;
    }

    const id = key();
    const fresh = seededFor !== id;

    setValues((prev) => {
      const next = {};
      for (const f of fs) {
        const keep =
          !fresh && f.name in prev && seededWidgets[f.name] === f.widget;
        next[f.name] = keep ? prev[f.name] : toFormValue(f, r[f.name]);
      }
      return next;
    });

    seededWidgets = Object.fromEntries(fs.map((f) => [f.name, f.widget]));
    if (fresh) {
      setErrors({});
      setBanner(null);
      // A reason belongs to one edit of one client. Carrying it to the next
      // would file the wrong sentence against the wrong change.
      setReason("");
      setHistoryOpen(false);
    }
    seededFor = id;
  });

  const setValue = (name, v) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    resetConfirm();
  };

  // The current value of a select when no option carries it — see the synthetic
  // <option> below. Null means "nothing to reconcile".
  //
  // The label prefers whatever the record itself said: an expanded relation
  // carries the email/name, and showing that beats showing a bare PK the
  // operator has no way to resolve.
  const orphan = (f) => {
    const v = values()[f.name];
    if (v === "" || v == null) return null;
    if ((f.choices || []).some((c) => String(c.value) === String(v))) return null;

    const raw = record()?.[f.name];
    const named =
      raw && typeof raw === "object"
        ? raw.email || raw.name || raw.display_name || null
        : null;
    return { value: String(v), label: named || `#${v}` };
  };

  const toggleMulti = (name, id) => {
    const keyStr = String(id);
    setValue(
      name,
      (values()[name] || []).includes(keyStr)
        ? (values()[name] || []).filter((x) => x !== keyStr)
        : [...(values()[name] || []), keyStr],
    );
  };

  // Only what changed. An untouched field is never in the payload, which is what
  // makes a partially-discovered form safe to submit at all.
  //
  // The original is compared through the SAME normalisation as the edited value
  // rather than against the raw record, because the two are not always the same
  // shape: `onboarded_by` can be read back as an expanded object and written as
  // a PK, and a decimal can arrive as "10.00" and leave as 10. Comparing raw
  // against normalised would mark those permanently "changed" and put an
  // untouched field into every PATCH.
  const originalWire = (f) => toWireValue(f, toFormValue(f, record()?.[f.name]));

  const changed = createMemo(() => {
    if (!record()) return [];
    return editable().filter(
      (f) => !sameValue(toWireValue(f, values()[f.name]), originalWire(f)),
    );
  });

  // Switching to CPL clears the rate SERVER-SIDE (f7f0773) — but an explicitly
  // sent rate is still rejected. So on a switch to CPL the field is dropped from
  // the payload entirely rather than sent as null: letting the server do the
  // clearing is the documented path, and sending anything at all here is the one
  // way to turn a valid switch into a 400.
  const clearsRateServerSide = () =>
    String(values().client_type ?? "").toLowerCase() === "cpl";

  // `data_visible_from` follows the same shape (R1, 52576ab): retainer-only, and
  // cleared server-side the moment the type stops being retainer. So it is
  // dropped from the payload and disabled for any non-retainer type — one PATCH
  // does the whole switch, and we never send a value the serializer would have
  // to reject or overwrite.
  const clearsVisibilityServerSide = () =>
    String(values().client_type ?? "").toLowerCase() !== "retainer";

  const serverClears = (f) =>
    (f.name === "service_charge" && clearsRateServerSide()) ||
    (f.name === "data_visible_from" && clearsVisibilityServerSide());

  const rateDisabled = (f) => serverClears(f);

  // ── Reason ────────────────────────────────────────────────────────────────
  // Mandatory whenever client_type or service_charge moves (R8). The write
  // schema publishes `reason` as required=false because the requirement is
  // CONDITIONAL — it is enforced at validate time, not by the field — so the
  // form must not take that at face value. Treating it as optional would let
  // every rate change go out and come back a 400 with the reason pinned, which
  // is a rejection where a required field would have done.
  //
  // This is the one place the serializer is deliberately not the last word, and
  // it errs the safe way: asking for a reason that turned out not to be needed
  // costs a sentence, not a failed save.
  const [reason, setReason] = createSignal("");

  const reasonRequired = createMemo(() =>
    needsReasonFor(changed().map((f) => f.name)),
  );

  const buildPatch = () => {
    const out = {};
    for (const f of changed()) {
      if (serverClears(f)) continue;
      out[f.name] = toWireValue(f, values()[f.name]);
    }
    // Only when something actually requires it. A reason attached to an
    // is_active toggle would be written nowhere and read by nobody.
    if (reasonRequired()) out.reason = reason().trim();
    return out;
  };

  // ── Guarded fields ────────────────────────────────────────────────────────
  // Two fields on this form are not attributes. They are switches, and both take
  // effect for ALL HISTORY the moment they are saved:
  //
  //   client_type   decides which branch computes this client's billing. Every
  //                 figure is computed on read, never stored (f7f0773) — so a
  //                 switch lands the next time anyone opens the page, the client
  //                 included. There is no job to wait for and no window to
  //                 revert in. The endpoint refuses it outright for a client with
  //                 payment history (422 client_type_locked, 169 of 181 clients).
  //
  //   onboarded_by  is a live scoping filter, not a label:
  //                 Client.objects.filter(onboarded_by=user) runs in nine places
  //                 — insights, ledger, leads, replacements, disqualifications,
  //                 campaigns, billing — none of them date-scoped. Changing it
  //                 moves the client between two people's dashboards completely
  //                 and immediately.
  //
  // Both therefore take the same route: reveal what the change costs, then a
  // typed confirmation, before anything is sent. `onboarded_by` is not on the
  // serializer yet (R1) — the guard is here so that when it lands it arrives
  // already guarded, rather than as a plain dropdown that quietly reassigns a
  // book of business.
  const guarded = createMemo(() =>
    changed().filter((f) => f.name === "client_type" || isSalesField(f.name)),
  );

  const typeChange = createMemo(() => {
    const f = changed().find((x) => x.name === "client_type");
    if (!f) return null;
    return {
      from: String(record()?.client_type ?? "").toLowerCase(),
      to: String(values().client_type ?? "").toLowerCase(),
    };
  });

  // Who gains and who loses the client. Names, not ids — "12 → 31" tells the
  // operator nothing about whose dashboard just changed.
  const ownerChange = createMemo(() => {
    const f = changed().find((x) => isSalesField(x.name));
    if (!f) return null;
    const nameFor = (v) => {
      if (v === "" || v == null) return "nobody";
      const hit = (f.choices || []).find((c) => String(c.value) === String(v));
      return hit ? choiceLabel(hit) : `#${v}`;
    };
    return {
      from: nameFor(toFormValue(f, record()?.[f.name])),
      to: nameFor(values()[f.name]),
    };
  });

  // How each type computes a bill, in the backend's own terms.
  const BILLING_BRANCH = {
    cpl: "qualified leads × fixed CPL",
    hybrid: "markup + service charge + GST",
    retainer: "markup + service charge + GST",
  };

  const [confirming, setConfirming] = createSignal(false);
  const [confirmText, setConfirmText] = createSignal("");
  // Set when the endpoint refused with client_type_locked, so the refusal can be
  // shown as the specific, months-naming thing it is rather than as one more
  // pinned validation message.
  const [lockedMessage, setLockedMessage] = createSignal(null);

  const confirmTarget = () => String(props.clientLabel ?? "").trim();

  const confirmMatches = () =>
    confirmText().trim() !== "" && confirmText().trim() === confirmTarget();

  // Any further edit invalidates a confirmation: it was given for one specific
  // change, and silently carrying it over to a different one is how a guard
  // becomes decoration.
  const resetConfirm = () => {
    if (lockedMessage()) setLockedMessage(null);
    if (confirming() || confirmText()) {
      setConfirming(false);
      setConfirmText("");
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving() || !changed().length) return;

    // A guarded field takes two deliberate actions: reveal what the change
    // costs, then type the client's name. Everything else saves on the click.
    if (guarded().length) {
      if (!confirming()) {
        setConfirming(true);
        return;
      }
      if (!confirmMatches()) return;
    }

    // The reason is checked AFTER the impact panel, deliberately. Asking someone
    // to justify a change before telling them what it costs gets you a reason
    // written about the wrong thing — and on a guarded field the first click is
    // "show me what this does", not "save".
    //
    // Checked here at all rather than left to the server because a 400 is a poor
    // way to learn about a required field, and the server does reject it.
    if (reasonRequired() && !reason().trim()) {
      setErrors((prev) => ({
        ...prev,
        reason: "A reason is required — it goes into this client's audit trail.",
      }));
      return;
    }

    setSaving(true);
    setErrors({});
    setBanner(null);
    try {
      const saved = await updateClient(props.clientId, buildPatch());
      // The PATCH response is the updated row; fall back to a local merge if the
      // endpoint answers with no body rather than showing stale values.
      const next = saved || { ...record(), ...buildPatch() };
      props.onSaved?.(next, changed().map((f) => f.label));
      props.onClose?.();
    } catch (err) {
      const pinned = collectFieldErrors(err);

      // The 422 the endpoint raises when a type switch would rewrite billed
      // months. Its message names those months, so it is lifted out of the
      // field map and shown whole — as a refusal with a reason, not as a red
      // line under a dropdown. The confirmation stays open behind it so the
      // operator can see exactly which change was turned down.
      if (err?.code === "client_type_locked") {
        setLockedMessage(
          pinned.client_type ||
            err?.data?.error?.detail ||
            err?.message ||
            "This client's type is locked by its billing history.",
        );
        setErrors({});
        setBanner(null);
        return;
      }

      setErrors(pinned);
      setBanner(errorBanner(err, pinned, "Could not save this client."));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (saving()) return;
    props.onClose?.();
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex">
        <div
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          onClick={close}
          aria-hidden="true"
        />
        <form
          onSubmit={submit}
          role="dialog"
          aria-modal="true"
          aria-label="Edit client"
          class="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div class="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div class="min-w-0">
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white truncate">
                Edit client
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 truncate">
                {props.clientLabel || "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              class="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Show when={loaded.loading}>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Loading this client's record…
              </p>
            </Show>

            <Show when={loaded.error}>
              <div
                role="alert"
                class="rounded-lg border border-[#AC2334]/40 bg-[#AC2334]/5 px-4 py-3 text-sm text-[#AC2334] dark:text-red-300"
              >
                {loaded.error?.message || "Could not load this client."}
              </div>
            </Show>

            <Show when={banner()}>
              <div
                role="alert"
                class="rounded-lg border border-[#AC2334]/40 bg-[#AC2334]/5 px-4 py-3 text-sm text-[#AC2334] dark:text-red-300"
              >
                {banner()}
              </div>
            </Show>

            <Show when={inferred() && editable().length}>
              <div class="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
                The API published no write schema for this endpoint, so these
                fields are taken from this client's own record. A field the
                serializer doesn't accept will be rejected on save with the
                backend's own message.
              </div>
            </Show>

            <Show when={!loaded.loading && !loaded.error && !editable().length}>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                This client's record exposes no editable fields.
              </p>
            </Show>

            {/* Identity — read-only, and first, because the useful question on
                opening this drawer is "is this the right client". Each row that
                a person might expect to edit carries the reason it is fixed, so
                the absence of an input is answered rather than just noticed. */}
            <Show when={identity().length}>
              <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2.5">
                  This client
                </p>
                <dl class="space-y-2.5">
                  <For each={identity()}>
                    {(row) => (
                      <div class="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-0.5 items-baseline">
                        <dt class="text-xs text-gray-500 dark:text-gray-400">
                          {row.label}
                        </dt>
                        <dd class="m-0 text-sm font-medium text-[#14233A] dark:text-gray-100 break-words">
                          {row.value}
                        </dd>
                        <Show when={row.note}>
                          <dd class="col-start-2 m-0 text-xs text-[#8593A8] leading-snug">
                            {row.note}
                          </dd>
                        </Show>
                      </div>
                    )}
                  </For>
                </dl>
                {/* Only reachable if the serializer stops publishing the sales
                    owner. It did until R1; keeping the branch means a field
                    disappearing from the schema reads as a stated absence rather
                    than as a control that quietly vanished. */}
                <Show when={!hasSalesField()}>
                  <p class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                    This client's record exposes no sales-person field, so the
                    owner can't be reassigned here.
                  </p>
                </Show>
              </div>
            </Show>

            <For each={editable()}>
              {(f) => (
                <div>
                  <label class={LABEL} for={`ec-${f.name}`}>
                    {f.label}
                    <Show when={f.required}>
                      <span class="text-[#AC2334]"> *</span>
                    </Show>
                  </label>

                  <Show when={f.widget === "boolean"}>
                    <label class="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        id={`ec-${f.name}`}
                        type="checkbox"
                        checked={!!values()[f.name]}
                        onChange={(e) => setValue(f.name, e.currentTarget.checked)}
                        disabled={saving()}
                        class="h-4 w-4 rounded border-gray-300 text-[#AC2334] focus:ring-[#AC2334]"
                      />
                      <span class="text-sm text-[#14233A] dark:text-gray-200">
                        {values()[f.name] ? "Yes" : "No"}
                      </span>
                    </label>
                  </Show>

                  <Show when={f.widget === "select"}>
                    <select
                      id={`ec-${f.name}`}
                      value={values()[f.name] ?? ""}
                      onChange={(e) => setValue(f.name, e.currentTarget.value)}
                      disabled={saving()}
                      class={`${FIELD} ${errors()[f.name] ? FIELD_BAD : ""}`}
                    >
                      {/* Present for every non-required field so an optional
                          relation can actually be cleared. */}
                      <option value="">
                        {f.required ? "Select…" : "— none —"}
                      </option>
                      {/* A value the roster doesn't list still has to show. The
                          sales list comes from the onboarding options endpoint,
                          which offers who may be PICKED — a client owned by
                          someone since deactivated would otherwise render as an
                          empty box that reads as "nobody". */}
                      <Show when={orphan(f)}>
                        {(o) => (
                          <option value={o().value}>
                            {o().label} (not in the current list)
                          </option>
                        )}
                      </Show>
                      <For each={f.choices}>
                        {(c) => (
                          <option value={String(c.value)}>
                            {choiceLabel(c)}
                          </option>
                        )}
                      </For>
                    </select>
                  </Show>

                  <Show when={f.widget === "multiselect"}>
                    <div
                      id={`ec-${f.name}`}
                      class={`max-h-52 overflow-y-auto rounded-lg border p-2 space-y-1 ${
                        errors()[f.name]
                          ? "border-[#AC2334]"
                          : "border-[#E2E8F1] dark:border-gray-600"
                      }`}
                    >
                      <For
                        each={f.choices}
                        fallback={
                          <p class="text-xs text-gray-400 px-1 py-2">
                            Nothing to pick from.
                          </p>
                        }
                      >
                        {(c) => (
                          <label class="flex items-center gap-2.5 px-1 py-1 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                            <input
                              type="checkbox"
                              checked={(values()[f.name] || []).includes(
                                String(c.value),
                              )}
                              onChange={() => toggleMulti(f.name, c.value)}
                              disabled={saving()}
                              class="h-4 w-4 rounded border-gray-300 text-[#AC2334] focus:ring-[#AC2334]"
                            />
                            <span class="text-sm text-[#14233A] dark:text-gray-200 truncate">
                              {choiceLabel(c)}
                            </span>
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show
                    when={
                      f.widget === "text" ||
                      f.widget === "email" ||
                      f.widget === "number" ||
                      f.widget === "date" ||
                      f.widget === "datetime"
                    }
                  >
                    <input
                      id={`ec-${f.name}`}
                      type={
                        f.widget === "number"
                          ? "number"
                          : f.widget === "datetime"
                            ? "datetime-local"
                            : f.widget === "date"
                              ? "date"
                              : f.widget === "email"
                                ? "email"
                                : "text"
                      }
                      // A decimal field rejects integer-only stepping; the
                      // backend is still the authority on precision.
                      step={f.type === "integer" ? "1" : "any"}
                      maxLength={f.maxLength ?? undefined}
                      value={values()[f.name] ?? ""}
                      onInput={(e) => setValue(f.name, e.currentTarget.value)}
                      // A CPL client carries no rate, and the server clears it
                      // as part of the switch. Disabling the box says that
                      // before the save rather than after — and it is also what
                      // stops an explicitly-sent rate, which is still a 400.
                      disabled={saving() || rateDisabled(f)}
                      class={`${FIELD} ${errors()[f.name] ? FIELD_BAD : ""}`}
                    />
                  </Show>

                  {/* Both fields belong to a type this client no longer is, and
                      the server clears each of them as part of the switch. The
                      wording splits on whether there is actually a value to
                      lose — "cleared automatically" over an empty box would only
                      raise a question about a change that isn't happening. */}
                  <Show when={serverClears(f)}>
                    <p class={HINT}>
                      {String(record()?.[f.name] ?? "") !== ""
                        ? f.name === "service_charge"
                          ? "CPL clients carry no rate — this one is cleared automatically when the switch saves."
                          : "Only retainers have a reporting start date — this one is cleared automatically when the switch saves."
                        : f.name === "service_charge"
                          ? "CPL clients carry no rate."
                          : "Retainer clients only."}
                    </p>
                  </Show>

                  {/* The serializer's own help_text where it has one, ours
                      where it doesn't — see FIELD_META for why it settled that
                      way round. `note` is separate and unconditional: it carries
                      the cross-screen context no help_text can. */}
                  <Show when={f.help || f.hint}>
                    <p class={HINT}>{f.help || f.hint}</p>
                  </Show>

                  <Show when={f.note}>
                    <p class={HINT}>{f.note}</p>
                  </Show>

                  {/* Where the options came from, when it wasn't this endpoint.
                      The backend still validates the id, so a name this list
                      offers but the client serializer rejects comes back as its
                      own error rather than as a silent no-op. */}
                  <Show when={f.suppliedChoices}>
                    <p class={HINT}>
                      Listed from the onboarding options endpoint — the same
                      people offered when a client is first created.
                    </p>
                  </Show>

                  <Show when={isSalesField(f.name) && sales.loading}>
                    <p class={HINT}>Loading the sales roster…</p>
                  </Show>

                  <Show when={errors()[f.name]}>
                    <p role="alert" class={ERR_TEXT}>
                      {errors()[f.name]}
                    </p>
                  </Show>
                </div>
              )}
            </For>

            {/* ── Reason ────────────────────────────────────────────────────
                Appears the moment a reason-requiring field moves, above the
                confirmation rather than inside it — a rate change needs one
                without ever reaching a typed confirmation. */}
            <Show when={reasonRequired()}>
              <div>
                <label class={LABEL} for="ec-reason">
                  Reason<span class="text-[#AC2334]"> *</span>
                </label>
                <textarea
                  id="ec-reason"
                  rows="2"
                  value={reason()}
                  onInput={(e) => {
                    setReason(e.currentTarget.value);
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.reason;
                      return next;
                    });
                  }}
                  disabled={saving()}
                  placeholder="What changed and why — e.g. “Rate renegotiated to 11% from October, per contract addendum.”"
                  class={`${FIELD} resize-y ${errors().reason ? FIELD_BAD : ""}`}
                />
                <p class={HINT}>
                  Written to this client's commercial history against{" "}
                  {changed()
                    .filter((f) => isReasonField(f.name))
                    .map((f) => f.label)
                    .join(" and ")}
                  . Months later this sentence is the only thing explaining the
                  change — the figures alone won't.
                </p>
                <Show when={errors().reason}>
                  <p role="alert" class={ERR_TEXT}>
                    {errors().reason}
                  </p>
                </Show>
              </div>
            </Show>

            {/* ── The confirmation ──────────────────────────────────────────
                Deliberately not a modal on top of a modal: the operator needs
                the controls still visible so "change it back" is as easy as
                going through with it. */}
            <Show when={confirming() && guarded().length}>
              <div
                role="alert"
                class="rounded-lg border-2 border-[#AC2334] bg-[#AC2334]/[.04] dark:bg-[#AC2334]/10 p-4 space-y-4"
              >
                <p class="text-sm font-bold text-[#AC2334] dark:text-red-300">
                  This takes effect immediately, for all history
                </p>

                {/* ── The type switch ── */}
                <Show when={typeChange()}>
                  {(tc) => (
                    <div class="space-y-2">
                      <p class="text-sm text-[#14233A] dark:text-gray-200">
                        Switching{" "}
                        <strong>
                          {fmtType(tc().from)} → {fmtType(tc().to)}
                        </strong>{" "}
                        changes which branch computes this client's billing, for
                        every month — not just future ones.
                      </p>

                      <div class="text-sm text-[#14233A] dark:text-gray-200 space-y-1">
                        <p>
                          Billed now as{" "}
                          <span class="font-semibold">
                            {BILLING_BRANCH[tc().from] ?? "its current branch"}
                          </span>
                        </p>
                        <p>
                          Would become{" "}
                          <span class="font-semibold">
                            {BILLING_BRANCH[tc().to] ?? "the new branch"}
                          </span>
                        </p>
                      </div>

                      {/* Nothing is stored — every figure computes on read — so
                          this is the part people get wrong: there is no job to
                          wait for and no window in which to change your mind. */}
                      <p class="text-sm text-[#14233A] dark:text-gray-200">
                        Billing figures are <strong>computed on read, not
                        stored</strong>. The new numbers appear the next time
                        anyone opens the page — <strong>the client
                        included</strong>. Nothing to wait for, nothing to undo.
                      </p>

                      <Show when={tc().to === "cpl"}>
                        <p class="text-sm text-[#14233A] dark:text-gray-200">
                          The service charge is cleared automatically as part of
                          the switch.
                        </p>
                      </Show>

                      <p class="text-sm text-[#14233A] dark:text-gray-200">
                        If this client has been billed for any month the save is{" "}
                        <strong>refused</strong> and nothing changes — most
                        clients are in that state.
                      </p>
                    </div>
                  )}
                </Show>

                {/* ── The owner reassignment ── */}
                <Show when={ownerChange()}>
                  {(oc) => (
                    <div class="space-y-2">
                      <p class="text-sm text-[#14233A] dark:text-gray-200">
                        <strong>{oc().from}</strong> loses this client and{" "}
                        <strong>{oc().to}</strong> gains it.
                      </p>
                      <p class="text-sm text-[#14233A] dark:text-gray-200">
                        The sales owner is a live filter, not a label — it scopes
                        insights, the ledger, leads, replacements,
                        disqualifications, campaigns and billing, none of which
                        are date-scoped. The client moves between the two
                        dashboards <strong>completely and for all history</strong>,
                        not from today onward.
                      </p>
                    </div>
                  )}
                </Show>

                {/* The refusal, when it comes. Shown here rather than as a
                    field error because its message names the billed months —
                    the one piece of information this screen cannot work out on
                    its own. */}
                <Show when={lockedMessage()}>
                  <div class="rounded-md border border-[#AC2334] bg-white dark:bg-gray-900 px-3 py-2.5">
                    <p class="text-[11px] font-semibold uppercase tracking-wide text-[#AC2334] mb-1">
                      Refused by the server
                    </p>
                    <p class="text-sm text-[#14233A] dark:text-gray-200">
                      {lockedMessage()}
                    </p>
                    <p class={HINT}>
                      Change the type back, or leave it — a switch on a billed
                      client is a backend operation, not a form edit.
                    </p>
                  </div>
                </Show>

                <div>
                  <label
                    class="block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5"
                    for="ec-confirm"
                  >
                    Type{" "}
                    <span class="font-mono text-[#AC2334]">
                      {confirmTarget()}
                    </span>{" "}
                    to confirm
                  </label>
                  <input
                    id="ec-confirm"
                    type="text"
                    autocomplete="off"
                    value={confirmText()}
                    onInput={(e) => setConfirmText(e.currentTarget.value)}
                    disabled={saving()}
                    class={`${FIELD} ${
                      confirmText() && !confirmMatches() ? FIELD_BAD : ""
                    }`}
                  />
                  <p class={HINT}>The client's name, exactly as shown.</p>
                </div>
              </div>
            </Show>

            {/* ── Commercial history ────────────────────────────────────── */}
            <Show when={!loaded.loading && !loaded.error && editable().length}>
              <div class="rounded-lg border border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setHistoryOpen(!historyOpen())}
                  aria-expanded={historyOpen()}
                  class="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Rate &amp; type history
                  </span>
                  <span class="text-xs text-gray-400">
                    {historyOpen() ? "Hide" : "Show"}
                  </span>
                </button>

                <Show when={historyOpen()}>
                  <div class="px-4 pb-4 border-t border-gray-200 dark:border-gray-700 pt-3">
                    <Show when={history.loading}>
                      <p class="text-sm text-gray-500 dark:text-gray-400">
                        Loading…
                      </p>
                    </Show>

                    {/* null means the read failed; [] means it genuinely never
                        changed. Collapsing the two would report "no changes" for
                        a request that never landed. */}
                    <Show when={!history.loading && history() === null}>
                      <p class="text-sm text-[#AC2334] dark:text-red-300">
                        Couldn't load the history — so this shows nothing, not
                        that nothing happened.
                      </p>
                    </Show>

                    <Show when={history()?.length === 0}>
                      <p class="text-sm text-gray-500 dark:text-gray-400">
                        No changes recorded. The client type and service charge
                        are as they were at onboarding.
                      </p>
                    </Show>

                    <Show when={history()?.length}>
                      <ol class="space-y-3">
                        <For each={history()}>
                          {(row) => (
                            <li class="text-sm border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                              <p class="text-[#14233A] dark:text-gray-100">
                                <span class="font-semibold">
                                  {histField(row.field)}
                                </span>{" "}
                                <span class="text-gray-500 dark:text-gray-400">
                                  {histValue(row.from_value)} →
                                </span>{" "}
                                <span class="font-semibold">
                                  {histValue(row.to_value)}
                                </span>
                              </p>
                              <Show when={row.reason}>
                                <p class="text-[#14233A] dark:text-gray-200 mt-0.5">
                                  {row.reason}
                                </p>
                              </Show>
                              <p class="text-xs text-[#8593A8] mt-0.5">
                                {histWho(row)} · {histWhen(row.changed_at)}
                              </p>
                            </li>
                          )}
                        </For>
                      </ol>
                    </Show>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Fields the record carries that no generic input can edit safely
                (nested objects, lists of objects). Shown rather than hidden, so
                the operator can see they exist and aren't being silently
                dropped from the save. */}
            <Show when={unsupported().length}>
              <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Not editable here
                </p>
                <dl class="space-y-1.5">
                  <For each={unsupported()}>
                    {(f) => (
                      <div class="flex gap-3 text-sm">
                        <dt class="w-40 flex-shrink-0 text-gray-500 dark:text-gray-400 truncate">
                          {f.label}
                        </dt>
                        <dd class="min-w-0 flex-1 text-[#14233A] dark:text-gray-200 break-words">
                          {JSON.stringify(record()?.[f.name]) ?? "—"}
                        </dd>
                      </div>
                    )}
                  </For>
                </dl>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {changed().length
                ? `${changed().length} field${changed().length === 1 ? "" : "s"} changed`
                : "No changes yet"}
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={close}
                disabled={saving()}
                class="px-4 h-9 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition disabled:opacity-50"
              >
                Cancel
              </button>
              {/* The label states what the click does. On a type change the
                  first press only opens the confirmation, so calling it "Save"
                  there would be a lie about a destructive action. */}
              <button
                type="submit"
                disabled={
                  saving() ||
                  !changed().length ||
                  (confirming() && !confirmMatches())
                }
                class="px-4 h-9 text-sm font-medium rounded-lg bg-red-800 border border-red-800 text-white hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving()
                  ? "Saving…"
                  : confirming()
                    ? "I understand — save"
                    : guarded().length
                      ? "Review impact"
                      : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Show>
  );
}
