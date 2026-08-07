import { createSignal, onCleanup, For, Show } from "solid-js";
import {
  CLIENT_STATUSES,
  STATUS_BADGE,
  STATUS_DOT,
  STATUS_UNSET,
  normaliseStatus,
  statusLabel,
  updateClientStatus,
  latestChangeCaption,
} from "../../services/clientStatus";

// ─── Client engagement status: badge + inline change ──────────────────────────
// The badge IS the control — click it and pick a new status right where you're
// reading it, instead of navigating to an edit screen. Every change is audited,
// so the REASON IS MANDATORY: the submit stays disabled and a hint appears if
// the field is empty. That is the whole value of this feature — a status with no
// "why" is just a colour.
//
// Scope is the backend's call. A CM patching a client outside their book gets a
// 403 and we print the server's message verbatim; we do not pre-guess who may
// change what, because the frontend's idea of a CM's book can go stale.
//
// Props:
//   clientId      Client PK (NOT the nomen id) — required to submit
//   status        current engagement_status (null → unset)
//   latestChange  { from_status, to_status, reason, changed_by_email, changed_at }
//   onChanged({ status, change })  fired after a successful PATCH
//   showCaption   render the "Hold · 'reason' · Who · 7 Aug" line under the badge
//   readOnly      render the badge only (no popover)
//   compact       smaller badge, for dense card lists

export default function ClientStatusControl(props) {
  const [open, setOpen] = createSignal(false);
  const [picked, setPicked] = createSignal(null);
  const [reason, setReason] = createSignal("");
  const [touched, setTouched] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal(null);

  // Optimistic local status: a parent that re-fetches will overwrite this via
  // props, but the row updates the instant the PATCH succeeds either way.
  const [localStatus, setLocalStatus] = createSignal(null);
  const [localChange, setLocalChange] = createSignal(null);

  let rootEl;
  let btnEl;

  // ── Popover placement ──────────────────────────────────────────────────────
  // Both hosts clip: the Clients table scrolls (overflow-x-auto, which makes the
  // y axis clip too) and the manager cards are overflow-hidden. An absolutely
  // positioned panel is cut off in either. So the panel is FIXED and anchored to
  // the trigger's viewport rect, right-aligned, flipping above when there isn't
  // room below. It closes on scroll/resize rather than drifting away from the
  // badge it belongs to.
  const PANEL_W = 288; // w-72
  const PANEL_H = 260; // approximate; only used to decide flip-up
  const [pos, setPos] = createSignal({ top: 0, left: 0 });

  const place = () => {
    const r = btnEl?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(
      8,
      Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8),
    );
    const below = r.bottom + 6;
    const flip = below + PANEL_H > window.innerHeight && r.top > PANEL_H;
    setPos({ top: flip ? Math.max(8, r.top - PANEL_H - 6) : below, left });
  };

  const current = () =>
    normaliseStatus(localStatus() ?? props.status ?? null);
  const change = () => localChange() ?? props.latestChange ?? null;

  const canSubmit = () =>
    !saving() && !!picked() && reason().trim().length > 0 && !!props.clientId;

  const close = () => {
    setOpen(false);
    setPicked(null);
    setReason("");
    setTouched(false);
    setError(null);
  };

  const toggle = () => {
    if (open()) return close();
    place();
    setOpen(true);
  };

  // Click anywhere outside closes the popover, matching the other pickers here.
  // panelEl is checked too: the panel is a fixed-position sibling in the DOM
  // flow, so a click inside it is NOT inside rootEl.
  let panelEl;
  const onDocDown = (e) => {
    if (!open()) return;
    if (rootEl?.contains(e.target)) return;
    if (panelEl?.contains(e.target)) return;
    close();
  };
  // A fixed panel doesn't move with a scrolling ancestor, so close instead of
  // letting it hover over unrelated rows. Capture phase catches scrolls on the
  // table container, not just the window.
  const onViewportChange = () => {
    if (open()) close();
  };
  document.addEventListener("mousedown", onDocDown);
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
  onCleanup(() => {
    document.removeEventListener("mousedown", onDocDown);
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
  });

  const submit = async () => {
    setTouched(true);
    if (!reason().trim()) return;
    if (!canSubmit()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await updateClientStatus(props.clientId, {
        status: picked(),
        reason: reason().trim(),
      });
      const next = picked();
      // Prefer the server's echo of the change; fall back to what we sent so
      // the caption is populated either way.
      const serverChange =
        res?.data?.latest_change ??
        (res?.data?.to_status ? res.data : null) ?? {
          from_status: current(),
          to_status: next,
          reason: reason().trim(),
          changed_by_email: null,
          changed_at: new Date().toISOString(),
        };
      setLocalStatus(next);
      setLocalChange(serverChange);
      close();
      props.onChanged?.({ status: next, change: serverChange });
    } catch (err) {
      // 403 for an out-of-scope client, 400 for a rejected payload — the
      // server's wording names the client and the rule, so print it as-is.
      setError(err?.message || "Could not update the status.");
    } finally {
      setSaving(false);
    }
  };

  const badgeClass = () =>
    `inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${
      props.compact ? "px-2 py-[2px] text-[10px]" : "px-2.5 py-0.5 text-xs"
    } ${STATUS_BADGE[current()]}`;

  return (
    <div class="relative inline-block text-left" ref={rootEl}>
      <Show
        when={!props.readOnly}
        fallback={
          <span class={badgeClass()}>
            <span class={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[current()]}`} />
            {statusLabel(current())}
          </span>
        }
      >
        <button
          type="button"
          ref={btnEl}
          onClick={(e) => {
            // These badges sit inside clickable table rows.
            e.stopPropagation();
            toggle();
          }}
          aria-haspopup="dialog"
          aria-expanded={open()}
          title={latestChangeCaption(change()) || "Set engagement status"}
          class={`${badgeClass()} cursor-pointer transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#AC2334] focus-visible:outline-offset-2`}
        >
          <span class={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[current()]}`} />
          {statusLabel(current())}
          <svg
            class="w-3 h-3 opacity-60"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </Show>

      {/* Latest change caption — "Hold · “budget review” · Shresth · 7 Aug" */}
      <Show when={props.showCaption && change()}>
        <p
          class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400 max-w-[260px] truncate"
          title={latestChangeCaption(change())}
        >
          {latestChangeCaption(change())}
        </p>
      </Show>

      <Show when={open()}>
        <div
          role="dialog"
          aria-label="Change engagement status"
          ref={panelEl}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: `${pos().top}px`,
            left: `${pos().left}px`,
            width: `${PANEL_W}px`,
          }}
          class="z-[60] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3.5 text-left"
        >
          <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
            Change status
          </p>

          <div class="flex flex-wrap gap-1.5">
            <For each={CLIENT_STATUSES}>
              {(s) => {
                const on = () => picked() === s.key;
                const isCurrent = () => current() === s.key;
                return (
                  <button
                    type="button"
                    onClick={() => setPicked(s.key)}
                    aria-pressed={on()}
                    class={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      on()
                        ? "bg-[#14233A] text-white border-[#14233A]"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                    }`}
                  >
                    <span class={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.key]}`} />
                    {s.label}
                    <Show when={isCurrent()}>
                      <span class="text-[9px] opacity-60 uppercase">now</span>
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>

          <label class="block text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mt-3 mb-1">
            Reason <span class="text-[#AC2334]">*</span>
          </label>
          <input
            type="text"
            value={reason()}
            onInput={(e) => setReason(e.currentTarget.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            placeholder="Why is this changing?"
            aria-invalid={touched() && !reason().trim()}
            class={`w-full px-2.5 py-2 text-sm rounded-lg border bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:ring-1 ${
              touched() && !reason().trim()
                ? "border-[#AC2334] focus:ring-[#AC2334]/40"
                : "border-gray-200 dark:border-gray-700 focus:ring-purple-400 dark:focus:ring-gray-600"
            }`}
          />
          <Show when={touched() && !reason().trim()}>
            <p role="alert" class="mt-1 text-[11px] font-medium text-[#AC2334]">
              Reason required
            </p>
          </Show>

          <Show when={error()}>
            <p
              role="alert"
              class="mt-2 text-[11px] font-medium text-[#AC2334] dark:text-red-400"
            >
              {error()}
            </p>
          </Show>

          <div class="flex gap-2 mt-3">
            <button
              type="button"
              onClick={close}
              class="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit()}
              class="flex-1 px-3 py-1.5 rounded-lg bg-[#AC2334] text-white text-xs font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {saving() ? "Saving…" : "Save"}
            </button>
          </div>

          <Show when={!props.clientId}>
            <p class="mt-2 text-[11px] text-[#B07A14] dark:text-amber-400">
              This client's account id isn't available on this list, so the
              status can't be changed from here.
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export { STATUS_UNSET };
