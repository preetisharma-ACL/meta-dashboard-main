import { createSignal, onCleanup, For, Show } from "solid-js";
import {
  VALUE_TIERS,
  VALUE_TIER_BADGE,
  VALUE_TIER_DIAMOND,
  VALUE_TIER_UNSET,
  normaliseValueTier,
  valueTierLabel,
  updateClientValueTier,
  latestTierChangeCaption,
  suggestionCaption,
  isValueTierMismatch,
} from "../../services/valueTier";
import { canSeeValueTier } from "../../stores/currentUser";

// ─── Client value tier: badge + inline setter ─────────────────────────────────
// The badge IS the control, same as the engagement one: click it and classify the
// client where you're reading the row.
//
// ⚠ INTERNAL LABEL. This component RENDERS NOTHING for any role outside
// canSeeValueTier() (admin + coordination) — the guard lives here, not only at
// the call sites, so dropping this onto a client-facing screen by accident still
// shows a client nothing. Never relax that into "hide the button but keep the
// badge": the badge is the part a client must not see.
//
// Distinct from BOTH of its neighbours on a client row, by shape and by mark:
//   Engagement  full pill · light tinted fill · coloured round dot
//   Activity    rounded rectangle · monochrome outline · ●/○
//   Value tier  sharp corners · SOLID fill · ◆ diamond          ← this
//
// THE REASON IS OPTIONAL. The engagement endpoint refuses a change without one;
// this endpoint doesn't, so the submit button is live from the moment a tier is
// picked. Don't add a required-reason gate here to "match" the other control —
// they are different promises.
//
// THE SUGGESTION IS NEVER AUTO-APPLIED. It's derived from funds received this
// month and shown as evidence ("Suggested: Premium (₹12,40,000 received this
// month)"), with a one-click Apply. A human decides.
//
// Props:
//   clientId       Client PK (NOT the nomen id) — required to submit
//   tier           current value_tier (null → unset)
//   suggested      suggested_value_tier from the board / a previous PATCH
//   monthFunds     month_funds_inc_gst — the evidence behind the suggestion
//   mismatch       the board's own boolean; falls back to tier ≠ suggested
//   latestChange   { from_tier, to_tier, reason, changed_by_email, changed_at }
//   showCaption    render the "Premium · 'Q3 review' · Who · 7 Aug" line
//   showSuggestion render the suggestion hint under the badge
//   compact        smaller badge, for dense lists
//   onChanged({ tier, change, suggested, monthFunds })  after a successful PATCH

export default function ValueTierControl(props) {
  const [open, setOpen] = createSignal(false);
  const [picked, setPicked] = createSignal(null);
  const [reason, setReason] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal(null);

  // Optimistic local state: a parent that re-fetches overwrites this via props,
  // but the row updates the instant the PATCH succeeds either way.
  const [localTier, setLocalTier] = createSignal(null);
  const [localChange, setLocalChange] = createSignal(null);
  const [localSuggested, setLocalSuggested] = createSignal(null);
  const [localFunds, setLocalFunds] = createSignal(null);

  let rootEl;
  let btnEl;
  let panelEl;

  // ── Popover placement ──────────────────────────────────────────────────────
  // Same reasoning as ClientStatusControl: the Clients table scrolls
  // (overflow-x-auto clips the y axis too) and card hosts are overflow-hidden, so
  // an absolutely positioned panel would be cut off. Fixed, anchored to the
  // trigger's viewport rect, right-aligned, flipping above when there's no room
  // below, and closing on scroll rather than drifting away from its badge.
  const PANEL_W = 300;
  const PANEL_H = 268;
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

  const current = () => normaliseValueTier(localTier() ?? props.tier ?? null);
  const change = () => localChange() ?? props.latestChange ?? null;
  const suggested = () =>
    normaliseValueTier(localSuggested() ?? props.suggested ?? null);
  const funds = () => localFunds() ?? props.monthFunds ?? null;
  const hint = () => suggestionCaption(suggested(), funds());
  // The board computes this server-side; trust it when given, else derive.
  const mismatched = () =>
    props.mismatch ?? isValueTierMismatch(current(), suggested());
  const suggestionIsNew = () =>
    suggested() !== VALUE_TIER_UNSET && suggested() !== current();

  const canSubmit = () => !saving() && !!picked() && !!props.clientId;

  const close = () => {
    setOpen(false);
    setPicked(null);
    setReason("");
    setError(null);
  };

  const toggle = () => {
    if (open()) return close();
    place();
    setOpen(true);
  };

  const onDocDown = (e) => {
    if (!open()) return;
    if (rootEl?.contains(e.target)) return;
    if (panelEl?.contains(e.target)) return;
    close();
  };
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

  const submit = async (tierOverride) => {
    const next = tierOverride ?? picked();
    if (!next || saving() || !props.clientId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await updateClientValueTier(props.clientId, {
        valueTier: next,
        reason: reason(),
      });
      const data = res?.data ?? {};
      // "unset" is what we SEND to clear; what comes back is a null tier.
      const applied = next === VALUE_TIER_UNSET ? null : next;
      const serverChange =
        data.latest_change ??
        (data.to_tier ? data : null) ?? {
          from_tier: current() === VALUE_TIER_UNSET ? null : current(),
          to_tier: applied,
          reason: reason().trim() || null,
          changed_by_email: null,
          changed_at: new Date().toISOString(),
        };
      // Every write re-serves the suggestion, so refresh the hint from it.
      const nextSuggested = data.suggested_value_tier ?? suggested();
      const nextFunds = data.month_funds_inc_gst ?? funds();
      setLocalTier(data.value_tier ?? applied);
      setLocalChange(serverChange);
      setLocalSuggested(nextSuggested);
      setLocalFunds(nextFunds);
      close();
      props.onChanged?.({
        tier: data.value_tier ?? applied,
        change: serverChange,
        suggested: nextSuggested,
        monthFunds: nextFunds,
      });
    } catch (err) {
      // 403 for a role that may not classify, 400 for a rejected payload — the
      // server's wording is more specific than anything we'd write here.
      setError(err?.message || "Could not update the value tier.");
    } finally {
      setSaving(false);
    }
  };

  const badgeClass = () =>
    `inline-flex items-center gap-1 rounded-[4px] font-bold uppercase tracking-[0.06em] whitespace-nowrap ${
      props.compact ? "px-1.5 py-[2px] text-[9.5px]" : "px-2 py-[3px] text-[10px]"
    } ${VALUE_TIER_BADGE[current()]}`;

  return (
    // Hard gate: not admin, not coordination → nothing renders, ever.
    <Show when={canSeeValueTier()}>
      <div class="relative inline-block text-left" ref={rootEl}>
        <Show
          when={current() !== VALUE_TIER_UNSET}
          fallback={
            // Unset is NOT dressed as a badge. The engagement control already
            // owns a dashed "Not set" pill, and a second faint pill beside it
            // would read as one more status. A quiet "+ Tier" affordance is
            // unmistakably an action instead.
            <button
              type="button"
              ref={btnEl}
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              aria-haspopup="dialog"
              aria-expanded={open()}
              title="Set the internal value tier"
              class={`inline-flex items-center gap-1 rounded-[4px] border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 font-semibold hover:border-[#14233A]/50 hover:text-[#14233A] dark:hover:text-gray-300 transition ${
                props.compact
                  ? "px-1.5 py-[2px] text-[9.5px]"
                  : "px-2 py-[3px] text-[10px]"
              }`}
            >
              <span aria-hidden="true">◇</span> Tier
            </button>
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
            title={
              latestTierChangeCaption(change()) ||
              `Value tier: ${valueTierLabel(current())}`
            }
            class={`${badgeClass()} cursor-pointer transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#AC2334] focus-visible:outline-offset-2`}
          >
            <span class={VALUE_TIER_DIAMOND[current()]} aria-hidden="true">
              ◆
            </span>
            {valueTierLabel(current())}
          </button>
        </Show>

        {/* Mismatch flag — the set tier disagrees with this month's funding. */}
        <Show when={mismatched()}>
          <span
            class="ml-1 inline-flex align-middle text-[#B07A14] dark:text-amber-400"
            title={`Tier is ${valueTierLabel(current())}, but this month's funding suggests ${valueTierLabel(suggested())}`}
            aria-label="Tier disagrees with this month's funding"
            role="img"
          >
            <svg
              class={props.compact ? "w-3 h-3" : "w-3.5 h-3.5"}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          </span>
        </Show>

        {/* Latest change caption */}
        <Show when={props.showCaption && change()}>
          <p
            class="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400 max-w-[260px] truncate"
            title={latestTierChangeCaption(change())}
          >
            {latestTierChangeCaption(change())}
          </p>
        </Show>

        {/* Suggestion hint — evidence, not an instruction. */}
        <Show when={props.showSuggestion && hint()}>
          <p
            class={`mt-0.5 text-[11px] leading-snug max-w-[260px] truncate ${
              mismatched()
                ? "text-[#B07A14] dark:text-amber-400 font-medium"
                : "text-gray-400 dark:text-gray-500"
            }`}
            title={hint()}
          >
            {hint()}
          </p>
        </Show>

        <Show when={open()}>
          <div
            role="dialog"
            aria-label="Set value tier"
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
            <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
              Value tier
            </p>
            <p class="text-[11px] text-gray-400 dark:text-gray-500 mb-2.5">
              Internal only — never shown to the client.
            </p>

            <div class="flex flex-wrap gap-1.5">
              <For each={VALUE_TIERS}>
                {(t) => {
                  const on = () => picked() === t.key;
                  const isCurrent = () => current() === t.key;
                  return (
                    <button
                      type="button"
                      onClick={() => setPicked(t.key)}
                      aria-pressed={on()}
                      class={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-xs font-semibold border transition-colors ${
                        on()
                          ? "bg-[#14233A] text-white border-[#14233A]"
                          : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                      }`}
                    >
                      <span
                        class={on() ? "text-[#E9AE5C]" : VALUE_TIER_DIAMOND[t.key]}
                        aria-hidden="true"
                      >
                        ◆
                      </span>
                      {t.label}
                      <Show when={isCurrent()}>
                        <span class="text-[9px] opacity-60 uppercase">now</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>

            {/* The suggestion, with a one-click Apply. Never applied for you. */}
            <Show when={hint()}>
              <div class="mt-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2.5 py-2">
                <p class="text-[11px] leading-snug text-gray-600 dark:text-gray-300">
                  {hint()}
                </p>
                <Show when={suggestionIsNew()}>
                  <button
                    type="button"
                    onClick={() => setPicked(suggested())}
                    class="mt-1 text-[11px] font-bold text-[#3E6FB0] hover:underline"
                  >
                    Use this suggestion
                  </button>
                </Show>
              </div>
            </Show>

            {/* Reason is OPTIONAL on this endpoint — say so, so nobody hunts for
                a validation error that will never come. */}
            <label class="block text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mt-3 mb-1">
              Reason{" "}
              <span class="font-medium normal-case tracking-normal text-gray-400">
                (optional)
              </span>
            </label>
            <input
              type="text"
              value={reason()}
              onInput={(e) => setReason(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  close();
                }
              }}
              placeholder="Why this tier?"
              class="w-full px-2.5 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
            />

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
                onClick={() => submit()}
                disabled={!canSubmit()}
                class="flex-1 px-3 py-1.5 rounded-lg bg-[#14233A] text-white text-xs font-semibold hover:bg-[#1D3251] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {saving() ? "Saving…" : "Save"}
              </button>
            </div>

            {/* Clearing sends the literal "unset" the endpoint documents. */}
            <Show when={current() !== VALUE_TIER_UNSET}>
              <button
                type="button"
                onClick={() => submit(VALUE_TIER_UNSET)}
                disabled={saving() || !props.clientId}
                class="mt-2 w-full text-[11px] font-semibold text-gray-400 hover:text-[#AC2334] disabled:opacity-40 transition"
              >
                Clear the tier
              </button>
            </Show>

            <Show when={!props.clientId}>
              <p class="mt-2 text-[11px] text-[#B07A14] dark:text-amber-400">
                This client's account id isn't available on this list, so the tier
                can't be set from here.
              </p>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
