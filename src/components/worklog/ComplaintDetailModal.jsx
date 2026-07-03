import { createSignal, createResource, For, Show } from "solid-js";
import Swal from "sweetalert2";
import Drawer from "./Drawer";
import { updateComplaint } from "../../services/worklog";
import { fetchTeamMembers } from "../../services/cm";
import { currentUser } from "../../stores/currentUser";
import {
  SEVERITY_OPTIONS,
  CATEGORY_LABEL,
  humanize,
  fmtDate,
  fmtDateTime,
  statusClassOf,
  levelClassOf,
  avatarColor,
  initialsOf,
} from "./worklogTokens";

// ─── Complaint detail drawer ──────────────────────────────────────────────────
// Right-side slide-in detail view (prototype). Inline status / severity / owner
// edits PATCH straight through; resolving and "resolve as a task" bubble up to the
// parent so only one overlay is ever open.
// Props: complaint, clientName?, onClose, onChanged(updated),
//        onRequestResolve(complaint), onRequestTask(complaint).

// The inline status picker (open → In progress → Resolved → Closed). "Resolved"
// routes to the resolve flow (it needs a resolution note); the rest patch inline.
const STATUS_PICK = [
  { value: "open", label: "Open", cls: "open" },
  { value: "in_progress", label: "In progress", cls: "progress" },
  { value: "awaiting", label: "Awaiting client", cls: "awaiting" },
  { value: "resolved", label: "Resolved", cls: "resolved" },
  { value: "closed", label: "Closed", cls: "closed" },
];

export default function ComplaintDetailModal(props) {
  const [c, setC] = createSignal(props.complaint);
  // owner is a user FK — we submit the integer user_id (email is label only).
  const [owner, setOwner] = createSignal(
    props.complaint?.owner != null ? String(props.complaint.owner) : "",
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(null);

  const [members] = createResource(async () => {
    try {
      const res = await fetchTeamMembers();
      return Array.isArray(res?.data) ? res.data : [];
    } catch {
      return [];
    }
  });

  const ownerOptions = () => {
    const seen = new Set();
    const out = [{ id: "", label: "Unassigned" }];
    const add = (id, label) => {
      if (id == null) return;
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: key, label: label || `User #${key}` });
    };
    add(currentUser.id, currentUser.email ? `Me · ${currentUser.email}` : "Me");
    for (const m of members() ?? []) add(m.user_id, m.email);
    if (c().owner != null) add(c().owner, `User #${c().owner}`);
    return out;
  };

  const patch = async (changes) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateComplaint(c().id, changes);
      if (updated) {
        setC(updated);
        setOwner(updated.owner ?? "");
        props.onChanged?.(updated);
      }
    } catch (err) {
      setError(err?.message || "Update failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const resolved = () => c().status === "resolved" || c().status === "closed";

  const pickStatus = (value) => {
    if (busy() || value === c().status) return;
    if (value === "resolved") {
      props.onRequestResolve?.(c()); // needs a resolution note
      return;
    }
    patch({ status: value });
  };

  const saveOwner = async () => {
    const next = owner() ? Number(owner()) : null;
    const current = c().owner != null ? Number(c().owner) : null;
    if (next === current) return;
    await patch({ owner: next });
    if (!error())
      Swal.fire({
        icon: "success",
        title: "Owner updated",
        toast: true,
        position: "top-end",
        timer: 2000,
        showConfirmButton: false,
      });
  };

  const headPills = (
    <>
      <span class={`pill ${statusClassOf(c().status)}`}>{humanize(c().status)}</span>
      <Show when={c().severity}>
        <span class={`pill sev ${levelClassOf(c().severity)}`}>{humanize(c().severity)}</span>
      </Show>
      <Show when={c().category}>
        <span class="pill cat">{CATEGORY_LABEL[c().category] ?? humanize(c().category)}</span>
      </Show>
      <Show when={c().openTaskCount > 0}>
        <span class="pill camp">
          {c().openTaskCount} open task{c().openTaskCount !== 1 ? "s" : ""}
        </span>
      </Show>
    </>
  );

  const footer = (close) => (
    <>
      <button type="button" class="btn-ghost" onClick={close}>
        Close
      </button>
      <button type="button" class="btn-soft" onClick={() => props.onRequestTask?.(c())}>
        Resolve as task
      </button>
      <Show when={!resolved()}>
        <button type="button" class="btn-primary" onClick={() => props.onRequestResolve?.(c())}>
          Mark resolved
        </button>
      </Show>
    </>
  );

  return (
    <Drawer
      title={c().title}
      headExtra={headPills}
      footer={footer}
      onClose={props.onClose}
    >
      {/* Facts */}
      <div class="kv">
        <span class="k">Client</span>
        <span class="v">{props.clientName ?? c().clientNomenName ?? "—"}</span>
        <span class="k">Raised by</span>
        <span class="v">
          <Show when={c().raisedBy} fallback="—">
            <span class="av" style={`background:${avatarColor(c().raisedBy)}`}>
              {initialsOf(c().raisedBy)}
            </span>
            {c().raisedBy}
          </Show>
        </span>
        <span class="k">Raised on</span>
        <span class="v mono">{fmtDateTime(c().createdAt)}</span>
        <span class="k">SLA due</span>
        <span class="v mono">{fmtDate(c().slaDue)}</span>
        <Show when={resolved()}>
          <span class="k">Resolved</span>
          <span class="v mono">{fmtDateTime(c().resolvedAt)}</span>
        </Show>
      </div>

      {/* Status (inline) */}
      <div class="sec-label">Status</div>
      <div class="status-pick">
        <For each={STATUS_PICK}>
          {(s) => (
            <button
              disabled={busy()}
              class={c().status === s.value ? `on ${s.cls}` : ""}
              onClick={() => pickStatus(s.value)}
            >
              {s.label}
            </button>
          )}
        </For>
      </div>

      {/* Severity + Owner */}
      <div class="sec-label">Severity</div>
      <select
        value={c().severity ?? ""}
        disabled={busy()}
        onChange={(e) => patch({ severity: e.target.value })}
      >
        <For each={SEVERITY_OPTIONS}>
          {(o) => <option value={o.value}>{o.label}</option>}
        </For>
      </select>

      <div class="sec-label">Owner</div>
      <div class="inline-save">
        <select value={owner()} disabled={busy()} onChange={(e) => setOwner(e.target.value)}>
          <For each={ownerOptions()}>
            {(o) => <option value={o.id}>{o.label}</option>}
          </For>
        </select>
        <button type="button" class="btn-ghost" onClick={saveOwner} disabled={busy()}>
          Save
        </button>
      </div>

      {/* Description */}
      <Show when={c().description}>
        <div class="sec-label">What the client reported</div>
        <div class="detail-box">{c().description}</div>
      </Show>

      {/* Resolution */}
      <Show when={c().resolution}>
        <div class="sec-label">Resolution</div>
        <div class="detail-box ok">{c().resolution}</div>
      </Show>

      <Show when={error()}>
        <p class="form-error" style="margin-top:14px">{error()}</p>
      </Show>
    </Drawer>
  );
}
