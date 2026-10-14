import { createSignal, onCleanup, For, Show, Switch, Match } from "solid-js";
import { lookupControl } from "../../services/control";
import { INPUT } from "./ControlUI";

// ─── Field kinds → inputs, and form value ⇄ API value ─────────────────────────
// Kinds: string, text, email, url, integer, number, date, time, datetime,
// boolean, choice, relation, multi_relation, json. Unknown kinds fall back to a
// text input rather than disappearing.
//
// The FORM value of each kind is what its input holds (strings, mostly); the
// API value is built from it only on save, and only for fields that changed —
// comparing form values, not API values, means a datetime round-tripped through
// the local clock never reads as "changed".

const pad = (n) => String(n).padStart(2, "0");
// ISO → the local "YYYY-MM-DDTHH:mm:ss" a datetime-local input shows.
const isoToLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// Choices arrive as [[value, label]] or [{value, label}].
export const normChoices = (choices) =>
  (Array.isArray(choices) ? choices : []).map((c) =>
    Array.isArray(c)
      ? { value: c[0], label: String(c[1] ?? c[0]) }
      : typeof c === "object" && c
        ? { value: c.value ?? c.id, label: String(c.label ?? c.display ?? c.value) }
        : { value: c, label: String(c) },
  );

const asRef = (v) =>
  v == null || v === ""
    ? null
    : typeof v === "object"
      ? { id: v.id ?? v.pk ?? v.value, label: v.label ?? v.str ?? String(v.id ?? v.pk) }
      : { id: v, label: String(v) };

export const toFormValue = (field, v) => {
  if (field.sensitive) return ""; // masked; empty = keep
  switch (field.kind) {
    case "boolean":
      if (field.nullable) return v == null ? "" : v ? "true" : "false";
      return v === true;
    case "relation":
      return asRef(v);
    case "multi_relation":
      return (Array.isArray(v) ? v : []).map(asRef).filter(Boolean);
    case "datetime":
      return isoToLocal(v);
    case "json":
      return v == null ? "" : JSON.stringify(v, null, 2);
    case "choice":
      return v == null ? "" : String(v);
    default:
      return v == null ? "" : String(v);
  }
};

// Throws Error(message) for input that can't be sent (bad JSON / number).
export const toApiValue = (field, fv) => {
  const empty = fv === "" || fv == null;
  switch (field.kind) {
    case "boolean":
      if (field.nullable) return fv === "" ? null : fv === "true";
      return fv === true;
    case "relation":
      return fv?.id ?? null;
    case "multi_relation":
      return (fv ?? []).map((r) => r.id);
    case "integer": {
      if (empty) return null;
      const n = Number(fv);
      if (!Number.isInteger(n)) throw new Error("Enter a whole number.");
      return n;
    }
    case "number":
      if (empty) return null;
      if (!Number.isFinite(Number(fv))) throw new Error("Enter a number.");
      return String(fv); // decimals travel as strings — no float rounding
    case "datetime":
      return empty ? null : new Date(fv).toISOString();
    case "date":
    case "time":
      return empty ? null : fv;
    case "choice": {
      if (empty && !normChoices(field.choices).some((c) => c.value === "")) return null;
      const hit = normChoices(field.choices).find((c) => String(c.value) === fv);
      return hit ? hit.value : fv;
    }
    case "json":
      if (empty) return null;
      try {
        return JSON.parse(fv);
      } catch {
        throw new Error("Not valid JSON.");
      }
    default:
      // string / text / email / url: Django stores blank text as "", not null.
      return empty && field.nullable && !field.blank ? null : (fv ?? "");
  }
};

// ── Relation picker (single + multi) ──
function RelationPicker(props) {
  const [q, setQ] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [opts, setOpts] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  let timer;
  let seq = 0;
  onCleanup(() => clearTimeout(timer));
  const rel = () => props.field.related ?? {};
  const search = (text) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      setLoading(true);
      try {
        const rows = await lookupControl(rel().app, rel().model, text);
        if (mine === seq) setOpts(rows);
      } catch {
        if (mine === seq) setOpts([]);
      } finally {
        if (mine === seq) setLoading(false);
      }
    }, 250);
  };
  const multi = () => props.field.kind === "multi_relation";
  const chosen = () => (multi() ? props.value ?? [] : props.value ? [props.value] : []);
  const pick = (o) => {
    if (multi()) {
      if (!chosen().some((c) => String(c.id) === String(o.id))) props.onChange([...chosen(), o]);
    } else {
      props.onChange(o);
      setOpen(false);
    }
    setQ("");
  };
  const remove = (o) =>
    props.onChange(multi() ? chosen().filter((c) => String(c.id) !== String(o.id)) : null);

  return (
    <div class="relative">
      <Show when={chosen().length}>
        <div class="mb-1.5 flex flex-wrap gap-1.5">
          <For each={chosen()}>
            {(c) => (
              <span class="inline-flex items-center gap-1 rounded-md bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 px-2 py-0.5 text-xs text-purple-800 dark:text-purple-200">
                {c.label}
                <Show when={!props.disabled}>
                  <button type="button" onClick={() => remove(c)} aria-label={`Remove ${c.label}`} class="hover:text-red-600">
                    ×
                  </button>
                </Show>
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={!props.disabled}>
        <input
          type="search"
          value={q()}
          placeholder={multi() ? "Search to add…" : chosen().length ? "Search to change…" : "Search…"}
          onFocus={() => {
            setOpen(true);
            search(q());
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onInput={(e) => {
            setQ(e.target.value);
            setOpen(true);
            search(e.target.value);
          }}
          class={INPUT}
        />
        <Show when={open()}>
          <ul class="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
            <Show when={!loading()} fallback={<li class="px-3 py-2 text-sm text-gray-400">Searching…</li>}>
              <For each={opts()} fallback={<li class="px-3 py-2 text-sm text-gray-400">No matches.</li>}>
                {(o) => (
                  <li>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                      class="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-gray-700"
                    >
                      {o.label}
                    </button>
                  </li>
                )}
              </For>
            </Show>
          </ul>
        </Show>
      </Show>
    </div>
  );
}

// One field: label, input by kind, help text, error.
export function FieldInput(props) {
  const f = () => props.field;
  const set = (v) => props.onChange(v);
  const common = () => ({ id: `f-${f().name}`, disabled: props.disabled, class: INPUT });
  const step = () =>
    f().decimal_places != null ? (f().decimal_places > 0 ? String(10 ** -f().decimal_places) : "1") : "any";

  return (
    <div>
      <label for={`f-${f().name}`} class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {f().label ?? f().name}
        <Show when={f().required}>
          <span class="text-red-500"> *</span>
        </Show>
      </label>
      <Switch
        fallback={
          <input type="text" {...common()} value={props.value ?? ""} maxLength={f().max_length ?? undefined} onInput={(e) => set(e.target.value)} />
        }
      >
        <Match when={f().sensitive}>
          <input
            type="password"
            autocomplete="new-password"
            {...common()}
            value={props.value ?? ""}
            placeholder={props.masked ? `${props.masked} — leave empty to keep` : "Not set"}
            onInput={(e) => set(e.target.value)}
          />
        </Match>
        <Match when={f().kind === "text"}>
          <textarea rows="4" {...common()} value={props.value ?? ""} onInput={(e) => set(e.target.value)} />
        </Match>
        <Match when={f().kind === "json"}>
          <textarea rows="6" {...common()} class={`${INPUT} font-mono text-xs`} value={props.value ?? ""} onInput={(e) => set(e.target.value)} />
        </Match>
        <Match when={f().kind === "email" || f().kind === "url"}>
          <input type={f().kind} {...common()} value={props.value ?? ""} onInput={(e) => set(e.target.value)} />
        </Match>
        <Match when={f().kind === "integer"}>
          <input type="number" step="1" {...common()} value={props.value ?? ""} onInput={(e) => set(e.target.value)} />
        </Match>
        <Match when={f().kind === "number"}>
          <input type="number" step={step()} {...common()} value={props.value ?? ""} onInput={(e) => set(e.target.value)} />
        </Match>
        <Match when={f().kind === "date"}>
          <input type="date" {...common()} value={props.value ?? ""} onInput={(e) => set(e.target.value)} />
        </Match>
        <Match when={f().kind === "time"}>
          <input type="time" step="1" {...common()} value={props.value ?? ""} onInput={(e) => set(e.target.value)} />
        </Match>
        <Match when={f().kind === "datetime"}>
          <input type="datetime-local" step="1" {...common()} value={props.value ?? ""} onInput={(e) => set(e.target.value)} />
        </Match>
        <Match when={f().kind === "boolean" && f().nullable}>
          <select {...common()} value={props.value ?? ""} onChange={(e) => set(e.target.value)}>
            <option value="">Unknown</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </Match>
        <Match when={f().kind === "boolean"}>
          <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              id={`f-${f().name}`}
              disabled={props.disabled}
              checked={props.value === true}
              onChange={(e) => set(e.target.checked)}
            />
            {props.value ? "Yes" : "No"}
          </label>
        </Match>
        <Match when={f().kind === "choice"}>
          <select {...common()} value={props.value ?? ""} onChange={(e) => set(e.target.value)}>
            <Show when={!normChoices(f().choices).some((c) => String(c.value) === "")}>
              <option value="">{f().required ? "Select…" : "—"}</option>
            </Show>
            <For each={normChoices(f().choices)}>{(c) => <option value={String(c.value)}>{c.label}</option>}</For>
          </select>
        </Match>
        <Match when={f().kind === "relation" || f().kind === "multi_relation"}>
          <RelationPicker field={f()} value={props.value} disabled={props.disabled} onChange={set} />
        </Match>
      </Switch>
      <Show when={f().help_text}>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{f().help_text}</p>
      </Show>
      <Show when={props.error}>
        <p class="mt-1 text-xs text-red-600 dark:text-red-400">{props.error}</p>
      </Show>
    </div>
  );
}
