// ─── The field model behind the Edit Client form ──────────────────────────────
// Turns whatever the API said about a client into a list of inputs to render.
// Two sources, in order of authority:
//
//   1. OPTIONS metadata (`actions.PUT`) — DRF's own description of what the
//      serializer accepts: name, type, label, help text, required, choices.
//      This is the truth and is used verbatim when present.
//   2. The GET record — used ONLY when the backend published no metadata. Types
//      are inferred from the values themselves.
//
// What is never done is inventing a field. The onboarding wizard's client block
// (nomen / client_type / service_charge / onboarded_by_id / campaign_manager_ids
// / data_visible_from) belongs to a DIFFERENT endpoint's serializer, and the
// admin client LIST rows are a trimmed projection carrying none of them — so
// this file supplies wording and ordering for names it recognises, and nothing
// at all for names it does not. A field reaches the form only because a payload
// named it.

// Keys that are structurally not editable, whatever the source says. `id` is the
// PK the PATCH is addressed to; the timestamps are server-owned.
const NEVER_EDITABLE = new Set([
  "id",
  "pk",
  "created_at",
  "updated_at",
  "modified_at",
  "date_joined",
  "last_login",
  // `reason` is on the write schema (R2) but it is not a property of the client
  // — it is an annotation on THIS edit, written to ClientCommercialHistory and
  // never read back on the record. Rendering it in the field list would put a
  // permanently-blank box among the client's actual values and count it in
  // "3 fields changed". The drawer owns it explicitly instead.
  "reason",
]);

// The fields whose movement makes `reason` mandatory (R8 82bae0c, R1 52576ab).
// The server is the authority — it 400s with a PER-FIELD message under
// error.fields.reason — and this list only decides when the drawer asks for one
// up front instead of letting the operator discover it through a rejection.
//
// The three that write a ClientCommercialHistory row are exactly the three that
// need one. NOT is_active (no row, no reason) and NOT data_visible_from, which
// only delays a retainer's own view of its data and bills nothing.
const REASON_REQUIRED_BY = ["client_type", "service_charge"];

export const isReasonField = (name) =>
  REASON_REQUIRED_BY.includes(name) || isSalesField(name);

export const needsReasonFor = (names) => names.some(isReasonField);

// Display order for the names we recognise. Anything unrecognised follows, in
// the order the API listed it.
const FIELD_ORDER = [
  "email",
  "first_name",
  "last_name",
  "client_nomen",
  "nomen_id",
  "organization",
  "organization_id",
  "client_type",
  "service_charge",
  "data_visible_from",
  "onboarded_by",
  "onboarded_by_id",
  "campaign_managers",
  "campaign_manager_ids",
  "is_active",
];

// Wording for recognised names. Three separate jobs, deliberately:
//
//   label  used only when the serializer supplied none.
//   hint   a FALLBACK, shown when the serializer says nothing about the field.
//   note   ALWAYS shown, alongside any help_text — and therefore reserved
//          STRICTLY for what a serializer structurally cannot know, which is
//          only ever "this belongs on a different screen".
//
// That last rule was written and then immediately broken: notes went onto
// client_type, data_visible_from and onboarded_by describing what those fields
// DO, which is exactly what help_text describes. Once R2 published the help_text
// the drawer rendered both, one under the other, and it read as a bug because it
// was one. A note that restates the serializer is not additive, it is a
// duplicate waiting for the serializer to catch up. If the backend can say it,
// it is a hint at most.
//
// The hint/help_text precedence went back and forth once and it is worth saying
// why it landed here. `service_charge` carried a help_text describing a one-time
// setup fee for what is a monthly percentage on marked-up spend, so we made our
// own wording win. The backend then fixed it at source (f7f0773) — their text is
// now better than ours was, and it will be the text R2 publishes. So the
// serializer is the authority again, and our text is what fills the silence
// until R2 lands. What stays unconditional is only the cross-screen pointers: no
// help_text will ever mention the Client Status screen.
const FIELD_META = {
  // No notes on these three. What they do is the serializer's to say, and it
  // says it well since f7f0773; the consequences of CHANGING them are said in
  // the confirmation panel, where they are actually relevant, and the clearing
  // rules are said next to the disabled input at the moment they apply.
  client_type: {
    label: "Client type",
    hint: "Decides which billing branch computes this client's invoices — for every month, not just future ones.",
  },
  service_charge: {
    label: "Service charge (%)",
    hint: "A monthly percentage applied to marked-up spend. Hybrid and retainer only — a CPL client carries no rate.",
  },
  data_visible_from: {
    label: "Data visible from",
    hint: "Retainer clients only: the date this client's reporting starts. It only delays the client's own view and bills nothing, which is why it needs no reason.",
  },
  is_active: {
    label: "Login active",
    // No hint: "the account's live/disabled flag" is the label said twice. The
    // note below is the only thing here a reader does not already know.
    note: "Not the engagement status (active / hold / completed) — that lives on the Client Status screen.",
  },
  engagement_status: {
    note: "Changing this here skips the mandatory reason the Client Status screen records. Prefer that screen.",
  },
  value_tier: {
    note: "Internal commercial classification — set it on the Value Tier screen, which records the history.",
  },
  onboarded_by: {
    label: "Sales person",
    hint: "The sales person this client is attributed to. Admins appear alongside sales users because some of them own client accounts.",
  },
};
FIELD_META.onboarded_by_id = FIELD_META.onboarded_by;

// ── The sales owner ──────────────────────────────────────────────────────────
// `onboarded_by` NEVER arrives with choices, and this is not a gap anyone should
// try to close. DRF's SimpleMetadata.get_field_info explicitly excludes
// RelatedField and ManyRelatedField from choices enumeration whatever the
// queryset size — its own guard against walking a big table — and
// `onboarded_by` is a PrimaryKeyRelatedField. Emitting them would take a custom
// metadata class altering EVERY OPTIONS response on the API. Confirmed by the
// backend team; do not go looking.
//
// So the roster supplied here is not a fallback for this field, it is the only
// source there will ever be: /auth/onboarding/options/ (`sales_users`), the SAME
// list the onboarding wizard offers when the client is first created, which is
// what makes "who owns this client" answerable identically on both screens. The
// server bounds what it will ACCEPT to active sales and admin users (f74a8ad,
// 14 of them), so the picker and the serializer agree on the set.
//
// The published-wins rule below still stands for any OTHER field that arrives
// with choices — a plain ChoiceField like `client_type` does publish them, and
// there the serializer's set is the authority. And a roster is never used to
// CONJURE a field: if no name below appears in the discovered form, the client
// serializer does not accept a sales owner and the drawer says so rather than
// showing a control whose every save 400s.
const SALES_FIELD_NAMES = [
  "onboarded_by",
  "onboarded_by_id",
  "sales_user",
  "sales_user_id",
  "sales_manager",
  "sales_manager_id",
  "sales_person",
];

export const isSalesField = (name) => SALES_FIELD_NAMES.includes(name);

// The sales roster as DRF-shaped choices. Sales users first, then the admins who
// own client accounts — same grouping rationale as the wizard, so the two
// screens list the same people in the same order.
export const salesChoices = (salesUsers) => {
  const list = Array.isArray(salesUsers) ? salesUsers : [];
  const rank = (u) => (u.role === "sales" ? 0 : u.role === "admin" ? 1 : 2);
  return [...list]
    .sort((a, b) => rank(a) - rank(b) || String(a.email).localeCompare(String(b.email)))
    .map((u) => ({
      value: u.id,
      display_name:
        u.role && u.role !== "sales" ? `${u.email} (${u.role})` : u.email,
    }));
};

// Prettify a snake_case key when nothing better exists.
const humanise = (name) =>
  name
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

// ── Widget choice ────────────────────────────────────────────────────────────
// DRF's `type` strings, plus the two shapes it cannot express on its own: a
// related field arrives as type "field" WITH choices, and a many-related one
// looks identical — the current value being an array is the only thing that
// separates "pick one" from "pick several".
const widgetFor = (info, currentValue) => {
  const choices = Array.isArray(info.choices) ? info.choices : null;
  if (choices && choices.length) {
    return Array.isArray(currentValue) ? "multiselect" : "select";
  }
  switch (info.type) {
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "integer":
    case "decimal":
    case "float":
      return "number";
    case "email":
      return "email";
    case "nested object":
    case "list":
      // No sane generic editor, and guessing one would send malformed JSON.
      return "unsupported";
    default:
      return Array.isArray(currentValue) ? "unsupported" : "text";
  }
};

// A field descriptor the form renders directly.
//
// `extra` is the side-supplied choice list for this name (today: the sales
// roster). It only ever fills a gap — a field the backend published choices for
// keeps them, because those are that serializer's actual accepted set.
const describe = (name, info, currentValue, discovered, extra) => {
  const known = FIELD_META[name] || {};
  const published =
    Array.isArray(info.choices) && info.choices.length ? info.choices : null;
  const supplied =
    !published && Array.isArray(extra) && extra.length ? extra : null;
  const choices = published || supplied;

  // With no choices this would fall through to a plain text box — a raw foreign
  // key typed by hand, for the field that moves a whole book of business between
  // two people. Since the schema NEVER carries choices for this field (see
  // above), the only thing standing between the operator and that box is the
  // roster call, so this is reachable whenever `/auth/onboarding/options/`
  // fails — not the doubly-unlikely case it first looked like. It renders
  // read-only instead, and the picker returns with the roster.
  const relationWithoutOptions = isSalesField(name) && !choices;

  return {
    name,
    label: info.label || known.label || humanise(name),
    hint: known.hint || null,
    note: known.note || null,
    help: typeof info.help_text === "string" ? info.help_text : null,
    required: !!info.required,
    maxLength: Number.isFinite(info.max_length) ? info.max_length : null,
    choices,
    // The form flags a supplied list, because "these are the valid values" is
    // then a second endpoint's answer rather than this one's.
    suppliedChoices: !!supplied,
    type: info.type || "string",
    widget: relationWithoutOptions
      ? "unsupported"
      : widgetFor({ ...info, choices }, currentValue),
    // True when the descriptor came from the record rather than from a write
    // schema — the form says so, because "the API accepts this" is then our
    // assumption rather than something the backend stated.
    discovered,
  };
};

const sortFields = (fields) => {
  const rank = (f) => {
    const i = FIELD_ORDER.indexOf(f.name);
    return i === -1 ? FIELD_ORDER.length : i;
  };
  return [...fields].sort((a, b) => rank(a) - rank(b));
};

// Side-supplied choices for a field name. `extras` is keyed by the same names
// the API uses, so a caller adds a roster by name and nothing else changes.
const extraFor = (extras, name) => (extras ? extras[name] : null);

// ── From OPTIONS metadata (the authoritative path) ───────────────────────────
export const fieldsFromSchema = (schema, record, extras) => {
  const out = [];
  for (const [name, info] of Object.entries(schema || {})) {
    if (!info || typeof info !== "object") continue;
    if (info.read_only) continue;
    if (NEVER_EDITABLE.has(name)) continue;
    out.push(
      describe(
        name,
        info,
        record ? record[name] : undefined,
        false,
        extraFor(extras, name),
      ),
    );
  }
  return sortFields(out);
};

// ── From the record (fallback only) ──────────────────────────────────────────
// CONFIRMED by the backend team on 8 Sep 2026: ClientUpdateSerializer
// (selected at views.py:145) accepts exactly three fields —
//
//     client_type, service_charge, is_active
//
// — and nothing else. `nomen`, `onboarded_by`, `data_visible_from` and
// `campaign_manager_ids` are NOT on it; making them writable is real backend
// work, tracked as R1 in CLIENT_EDIT_API_REQUIREMENTS.md.
//
// That is why the fallback is an allowlist rather than "every key the record
// returned". A serializer silently DROPS a field it doesn't accept: an operator
// who edited `email` here would get a success toast, a closed drawer, and no
// change — a lie the screen told them. Rendering only what we know is accepted
// makes the fallback narrow and honest instead of broad and wrong.
//
// The OPTIONS path (fieldsFromSchema) still overrides this entirely. When R2
// lands, the serializer describes itself and this list stops being consulted —
// which is also what keeps it from going stale as R1 adds fields.
const KNOWN_WRITABLE = {
  client_type: { type: "choice", required: true, choices: [
    { value: "cpl", display_name: "CPL" },
    { value: "hybrid", display_name: "Hybrid" },
    { value: "retainer", display_name: "Retainer" },
  ] },
  service_charge: { type: "decimal", required: false },
  is_active: { type: "boolean", required: false },
};

// Type comes from the value where the allowlist doesn't pin it down.
const inferInfo = (value) => {
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: "decimal" };
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return { type: "date" };
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return { type: "datetime" };
  if (value && typeof value === "object" && !Array.isArray(value))
    return { type: "nested object" };
  if (Array.isArray(value)) return { type: "list" };
  return { type: "string" };
};

export const fieldsFromRecord = (record, extras) => {
  const out = [];
  for (const [name, base] of Object.entries(KNOWN_WRITABLE)) {
    // Still gated on the record actually carrying the key: the allowlist says
    // what the serializer accepts, the record says what this client has. A field
    // in one but not the other is a shape change we'd rather not paper over.
    if (!record || !(name in record)) continue;
    const info = { ...inferInfo(record[name]), ...base };
    out.push(describe(name, info, record[name], true, extraFor(extras, name)));
  }
  return sortFields(out);
};

// ── Form values ──────────────────────────────────────────────────────────────
// Everything is held as a string (or an array of strings, or a boolean) while
// editing, so an input's value round-trips unchanged and "untouched" compares
// exactly. Conversion back to the wire type happens once, at submit.
// A relation can arrive as a bare PK or as the expanded object — `onboarded_by`
// is the one that actually does both, depending on whether the read serializer
// nests it. A select is keyed by PK either way, so the id is dug out rather than
// the object being stringified into a value that matches no option.
const relationId = (v) => {
  if (v == null) return "";
  if (typeof v === "object")
    return String(v.id ?? v.user_id ?? v.pk ?? v.value ?? "");
  return String(v);
};

export const toFormValue = (field, raw) => {
  if (field.widget === "boolean") return !!raw;
  if (field.widget === "multiselect")
    return (Array.isArray(raw) ? raw : []).map(relationId);
  if (field.widget === "select") return relationId(raw);
  if (raw == null) return "";
  if (field.widget === "datetime") {
    // <input type="datetime-local"> accepts only YYYY-MM-DDTHH:mm.
    const s = String(raw);
    return s.length >= 16 ? s.slice(0, 16) : s;
  }
  if (field.widget === "date") return String(raw).slice(0, 10);
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
};

// The wire value for a form value. An emptied optional field is sent as null
// rather than "" — an empty string is a value the serializer has to reject,
// while null is how a field is actually cleared.
export const toWireValue = (field, value) => {
  if (field.widget === "boolean") return !!value;
  if (field.widget === "multiselect")
    return (value || []).map((v) => (/^\d+$/.test(v) ? Number(v) : v));
  const s = typeof value === "string" ? value.trim() : value;
  if (s === "" || s == null) return null;
  if (field.widget === "number") return Number(s);
  if (field.choices && field.choices.length) {
    // Choice values keep the type the backend published them with, so a numeric
    // PK goes back as a number rather than as its string form.
    const hit = field.choices.find((c) => String(c.value) === String(s));
    return hit ? hit.value : s;
  }
  return s;
};

// Same-value test deciding what actually goes in the PATCH. Arrays compare as
// sets: reordering the campaign managers is not a change.
export const sameValue = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) {
    const A = (a || []).map(String).sort();
    const B = (b || []).map(String).sort();
    return A.length === B.length && A.every((v, i) => v === B[i]);
  }
  if (a == null && b == null) return true;
  return String(a) === String(b);
};

export const choiceLabel = (choice) => {
  if (!choice) return "";
  return choice.display_name ?? choice.label ?? String(choice.value ?? "");
};
