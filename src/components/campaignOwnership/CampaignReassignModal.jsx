import {
  createSignal,
  createMemo,
  createEffect,
  createResource,
  For,
  Show,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  reassignCampaign,
  fetchReassignTargets,
  today,
  isFutureDate,
} from "../../services/campaignReassign";
import { errorMessage } from "../../utils/apiErrors";
import {
  FIELD,
  FIELD_BAD,
  LABEL,
  HINT,
  BODY,
  fmtDate,
  daysInclusive,
  plural,
  splitFirstSegment,
} from "./ownershipFormat";

// ─── Move a campaign to another client ────────────────────────────────────────
// This is not a re-label. It moves the campaign's LEADS AND SPEND between two
// clients' ledgers for the whole period from the effective date onward — the
// same weight of change as client_type or onboarded_by, so it takes the same
// route those do in EditClientDrawer: reveal what the change costs, then a typed
// confirmation, before anything is sent.
//
// What the impact panel has to say, and why each part is there:
//
//   • WHO GAINS AND WHO LOSES, by name. "53 → 61" tells the operator nothing
//     about whose ledger just changed.
//   • WHAT THE EFFECTIVE DATE COVERS, in days. A back-dated move rewrites
//     delivery that has already been reported on, and "from 1 Aug" hides that
//     far better than "41 days of already-recorded delivery" does.
//   • THAT A DAY CANNOT BE SPLIT. Meta serves one row per campaign per day, so
//     a handover part-way through a day gives that whole day to the new owner.
//     A day boundary is the only exact option and it is worth saying out loud,
//     because the alternative is discovering it in a reconciliation.
//   • WHICH CHARACTERS OF THE NAME MOVE. The Meta rename rewrites the first pipe
//     segment only; a name with no pipe is left alone. Both are shown from the
//     actual name rather than asserted.
//
// The typed confirmation is the TARGET client's name — the gaining side is the
// decision being made here, and typing it forces it to be read. (EditClientDrawer
// types the record being changed; a campaign name is a long, pipe-laden string
// nobody can retype, and it is not the part that has to be right.)
//
// Props: campaign ({ id, name, clientNomenId, clientNomenName } | null),
//        onReassigned({ clientNomenId, clientNomenName, newName }), onClose()

export default function CampaignReassignModal(props) {
  const [targetId, setTargetId] = createSignal("");
  const [effectiveFrom, setEffectiveFrom] = createSignal(today());
  const [reason, setReason] = createSignal("");
  const [reasonTouched, setReasonTouched] = createSignal(false);

  const [confirming, setConfirming] = createSignal(false);
  const [confirmText, setConfirmText] = createSignal("");

  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [result, setResult] = createSignal(null);

  const [targets] = createResource(
    () => (props.campaign ? props.campaign.id : null),
    async () => {
      try {
        return await fetchReassignTargets();
      } catch {
        return [];
      }
    },
  );

  // A fresh campaign means a fresh form. A reason or a confirmation typed for
  // one campaign must never be filed against a different one.
  createEffect(() => {
    props.campaign;
    setTargetId("");
    setEffectiveFrom(today());
    setReason("");
    setReasonTouched(false);
    setConfirming(false);
    setConfirmText("");
    setError(null);
    setResult(null);
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const currentId = () => props.campaign?.clientNomenId ?? null;
  const currentName = () => props.campaign?.clientNomenName || "—";

  // Clients this campaign can actually go to. Its CURRENT owner is dropped from
  // the list: "move it to where it already is" is not an available action, and
  // offering it produces a no-op the operator has to reason about.
  const options = createMemo(() =>
    (targets() ?? []).filter(
      (c) => String(c.nomenId) !== String(currentId() ?? ""),
    ),
  );

  const target = createMemo(() => {
    const v = String(targetId() || "");
    if (!v) return null;
    return options().find((c) => String(c.nomenId) === v) ?? null;
  });

  const dateBad = createMemo(() => {
    const v = effectiveFrom();
    if (!v) return "An effective date is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Use a real calendar date.";
    if (isFutureDate(v)) return "The effective date cannot be in the future.";
    return null;
  });

  const reasonBad = createMemo(() => !reason().trim());

  const daysCovered = createMemo(() =>
    dateBad() ? null : daysInclusive(effectiveFrom(), today()),
  );

  const backdated = createMemo(() => !dateBad() && effectiveFrom() < today());

  const nameParts = createMemo(() => splitFirstSegment(props.campaign?.name));

  const canReview = createMemo(
    () => !!target() && !dateBad() && !reasonBad() && !busy(),
  );

  const confirmTarget = () => String(target()?.name ?? "").trim();
  const confirmMatches = () =>
    confirmText().trim() !== "" && confirmText().trim() === confirmTarget();

  // Any further edit invalidates a confirmation: it was given for one specific
  // move, and silently carrying it over to a different one is how a guard
  // becomes decoration.
  const resetConfirm = () => {
    if (error()) setError(null);
    if (confirming() || confirmText()) {
      setConfirming(false);
      setConfirmText("");
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (busy()) return;

    // First click reveals what the move costs; it never writes.
    if (!confirming()) {
      if (!canReview()) {
        setReasonTouched(true);
        return;
      }
      setConfirming(true);
      return;
    }
    if (!confirmMatches() || !canReview()) return;

    setBusy(true);
    setError(null);
    try {
      const res = await reassignCampaign({
        campaignId: props.campaign.id,
        clientNomenId: target().nomenId,
        effectiveFrom: effectiveFrom(),
        reason: reason(),
      });

      // The response names both sides itself (plain name strings). The labels
      // this screen already had stay as the fallback anyway — a move that
      // worked must never report "moved to —".
      setResult({
        ...res,
        fromName: res.from?.name || currentName(),
        toName: res.to?.name || target().name,
      });

      props.onReassigned?.({
        clientNomenId: target().nomenId,
        clientNomenName: target().name,
        // Only adopt a new name when the rename actually landed. On a refused
        // rename the campaign still carries its OLD name on Meta and in the next
        // sync, so writing the intended name onto the row would show a label
        // that exists nowhere else.
        newName: res.renameError ? null : res.newName,
      });
    } catch (err) {
      if (err?.status === 403) {
        setError(
          errorMessage(
            err,
            "You can only move a campaign between two clients that are both in your team.",
          ),
        );
      } else if (err?.message === "Failed to fetch") {
        setError("Couldn't reach the server — the campaign was not moved.");
      } else {
        setError(errorMessage(err, "The campaign was not moved."));
      }
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy()) return;
    props.onClose?.();
  };

  // Escape closes — but the listener only exists WHILE the dialog is open. This
  // control is rendered once per campaign row, so a listener registered at setup
  // would leave one per row on the document for a table that never opens a
  // single dialog.
  createEffect(() => {
    if (!props.campaign) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  return (
    // Portalled to the body, like the payments modal. The row control that opens
    // this sits in a `position: sticky` table cell with a z-index, which is a
    // STACKING CONTEXT — a fixed overlay rendered inside it is trapped behind
    // the rest of the page however high its own z-index goes.
    <Show when={props.campaign}>
      <Portal>
        <div class="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div
            onClick={close}
            class="fixed inset-0 bg-[#14233A]/50 backdrop-blur-[2px]"
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Move campaign to another client"
            class="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-white dark:bg-gray-900
                 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-2xl overflow-hidden"
          >
            {/* ── Header ── */}
            <div class="px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
              <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
                {result()
                  ? "Campaign moved"
                  : "Move campaign to another client"}
              </h2>
              <p
                class="text-sm text-[#54657E] dark:text-gray-400 mt-0.5 break-all line-clamp-2"
                title={props.campaign?.name}
              >
                {props.campaign?.name}
              </p>
            </div>

            <div class="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* ── Done ────────────────────────────────────────────────────── */}
              <Show when={result()} keyed>
                {(r) => (
                  <>
                    <div class="rounded-xl border border-[#15966A]/30 bg-[#EEF7F3] dark:bg-green-900/20 dark:border-green-800 px-4 py-3">
                      <p class={BODY}>
                        <strong>{r.toName}</strong> now owns this campaign.{" "}
                        <strong>{r.fromName}</strong> keeps everything before{" "}
                        <strong>{fmtDate(r.effectiveFrom)}</strong>.
                      </p>
                    </div>

                    {/* The rename is a SEPARATE outcome from the move. Reporting
                      them as one thing is how a stale Ads Manager label goes
                      unnoticed — the move succeeded either way. */}
                    <Show
                      when={r.renameError}
                      fallback={
                        <Show
                          when={r.newName && r.newName !== r.oldName}
                          fallback={
                            <p class={HINT}>
                              The name on Meta was left as it is — there is no
                              client segment in it to rewrite.
                            </p>
                          }
                        >
                          <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 px-4 py-3 space-y-1">
                            <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8]">
                              Renamed on Meta
                            </p>
                            <p class="text-sm text-[#54657E] dark:text-gray-400 break-all line-through">
                              {r.oldName}
                            </p>
                            <p class="text-sm font-semibold text-[#14233A] dark:text-gray-100 break-all">
                              {r.newName}
                            </p>
                          </div>
                        </Show>
                      }
                    >
                      <div
                        role="alert"
                        class="rounded-xl border border-[#B07A14]/40 bg-[#FDF6E7] dark:bg-amber-900/20 dark:border-amber-800 px-4 py-3 space-y-1.5"
                      >
                        <p class="text-xs font-bold uppercase tracking-wider text-[#B07A14]">
                          Moved, but not renamed
                        </p>
                        <p class={BODY}>
                          Meta refused the rename, so the campaign still reads{" "}
                          <span class="font-semibold break-all">
                            {r.oldName}
                          </span>{" "}
                          in Ads Manager.{" "}
                          <strong>The move itself stands</strong> — the label is
                          what is stale, and it stays stale until someone fixes
                          it there.
                        </p>
                        <p class="text-sm font-medium text-[#B07A14] break-words">
                          {r.renameError}
                        </p>
                      </div>
                    </Show>
                  </>
                )}
              </Show>

              {/* ── Form ────────────────────────────────────────────────────── */}
              <Show when={!result()}>
                {/* Where it lives today. The operator may have arrived from a
                  filtered table, so the current owner is never assumed. */}
                <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60 px-4 py-3 flex items-baseline justify-between gap-3">
                  <span class="text-xs font-bold uppercase tracking-wider text-[#8593A8]">
                    Owned by
                  </span>
                  <span class="text-sm font-semibold text-[#14233A] dark:text-gray-100 text-right break-all">
                    {currentName()}
                  </span>
                </div>

                <div>
                  <label class={LABEL} for="cr-target">
                    Move to
                  </label>
                  <select
                    id="cr-target"
                    value={targetId()}
                    disabled={busy() || targets.loading}
                    onChange={(e) => {
                      setTargetId(e.currentTarget.value);
                      resetConfirm();
                    }}
                    class={FIELD}
                  >
                    <option value="">
                      {targets.loading
                        ? "Loading clients…"
                        : "Select the client that gains it…"}
                    </option>
                    <For each={options()}>
                      {(c) => (
                        <option value={String(c.nomenId)}>{c.name}</option>
                      )}
                    </For>
                  </select>
                  <Show
                    when={!targets.loading && options().length === 0}
                    fallback={
                      <p class={HINT}>
                        The clients you can move this campaign to.
                      </p>
                    }
                  >
                    <p class="text-xs text-[#AC2334] dark:text-red-400 mt-1.5">
                      No other client is available to move this campaign to.
                    </p>
                  </Show>
                </div>

                <div>
                  <label class={LABEL} for="cr-date">
                    Effective from
                  </label>
                  <input
                    id="cr-date"
                    type="date"
                    value={effectiveFrom()}
                    max={today()}
                    disabled={busy()}
                    onInput={(e) => {
                      setEffectiveFrom(e.currentTarget.value);
                      resetConfirm();
                    }}
                    class={`${FIELD} ${dateBad() ? FIELD_BAD : ""}`}
                  />
                  <Show
                    when={dateBad()}
                    fallback={
                      <p class={HINT}>
                        Ownership is tracked by whole days, so this date is the
                        first full day the new owner is credited for. Today is
                        the latest date allowed.
                      </p>
                    }
                  >
                    <p class="text-xs text-[#AC2334] dark:text-red-400 mt-1.5">
                      {dateBad()}
                    </p>
                  </Show>
                </div>

                <div>
                  <label class={LABEL} for="cr-reason">
                    Reason
                  </label>
                  <textarea
                    id="cr-reason"
                    rows="3"
                    value={reason()}
                    disabled={busy()}
                    placeholder="Why is this campaign changing hands?"
                    onInput={(e) => {
                      setReason(e.currentTarget.value);
                      resetConfirm();
                    }}
                    onBlur={() => setReasonTouched(true)}
                    class={`${FIELD} resize-none ${
                      reasonTouched() && reasonBad() ? FIELD_BAD : ""
                    }`}
                  />
                  <Show
                    when={reasonTouched() && reasonBad()}
                    fallback={
                      <p class={HINT}>
                        Required. It is kept on the ownership record with your
                        name and the time, and it is the only explanation anyone
                        reading this later will have.
                      </p>
                    }
                  >
                    <p class="text-xs text-[#AC2334] dark:text-red-400 mt-1.5">
                      A reason is required — the move is refused without one.
                    </p>
                  </Show>
                </div>

                {/* ── The impact panel ─────────────────────────────────────── */}
                <Show when={confirming()}>
                  <div class="rounded-xl border border-[#AC2334]/40 bg-[#FBEEF0] dark:bg-red-900/10 dark:border-red-800/60 px-4 py-4 space-y-3">
                    <p class="text-[11px] font-semibold uppercase tracking-wide text-[#AC2334]">
                      What this changes
                    </p>

                    <p class={BODY}>
                      <strong>{target()?.name}</strong> gains this campaign's
                      leads and spend from{" "}
                      <strong>{fmtDate(effectiveFrom())}</strong> onward, and{" "}
                      <strong>{currentName()}</strong> loses them for the same
                      period. Both ledgers change.
                    </p>

                    <Show
                      when={backdated()}
                      fallback={
                        <p class={BODY}>
                          This starts today. Today's leads and spend go to{" "}
                          <strong>{target()?.name}</strong> in full — a day
                          cannot be split.
                        </p>
                      }
                    >
                      <p class={BODY}>
                        This is <strong>back-dated</strong>. It covers{" "}
                        <strong>
                          {daysCovered() == null
                            ? "the whole period"
                            : plural(daysCovered(), "day", "days")}
                        </strong>{" "}
                        of delivery that has already been recorded and reported
                        on — {fmtDate(effectiveFrom())} up to and including
                        today.
                      </p>
                    </Show>

                    <p class={BODY}>
                      Meta gives us one row per campaign per day, so ownership
                      moves in <strong>whole days</strong>. Handing over on a
                      day boundary is the only way to make the split exact.
                    </p>

                    {/* Shown from the actual name, so it never claims a rename
                      that isn't going to happen. */}
                    <Show
                      when={nameParts().hasPipe}
                      fallback={
                        <p class={BODY}>
                          The name on Meta is <strong>left alone</strong> — it
                          has no client segment to rewrite.
                        </p>
                      }
                    >
                      <p class={BODY}>
                        On Meta, only the part before the first "|" is rewritten
                        —{" "}
                        <span class="font-semibold break-all">
                          {nameParts().head}
                        </span>{" "}
                        becomes{" "}
                        <span class="font-semibold break-all">
                          {target()?.name}
                        </span>
                        . Everything after it is untouched. If Meta refuses, the
                        move still stands and the old label stays until someone
                        fixes it in Ads Manager.
                      </p>
                    </Show>

                    <div>
                      <label class={LABEL} for="cr-confirm">
                        Type{" "}
                        <span class="font-mono text-[#AC2334] break-all">
                          {confirmTarget()}
                        </span>{" "}
                        to confirm
                      </label>
                      <input
                        id="cr-confirm"
                        type="text"
                        autocomplete="off"
                        value={confirmText()}
                        disabled={busy()}
                        onInput={(e) => setConfirmText(e.currentTarget.value)}
                        class={`${FIELD} ${
                          confirmText() && !confirmMatches() ? FIELD_BAD : ""
                        }`}
                      />
                      <p class={HINT}>
                        The gaining client's name, exactly as shown.
                      </p>
                    </div>
                  </div>
                </Show>

                {/* Rejections land here rather than throwing the operator back to
                  the table — the form is still on screen, so the message is
                  actionable where it is read. Shown verbatim. */}
                <Show when={error()}>
                  <p
                    role="alert"
                    class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
                  >
                    {error()}
                  </p>
                </Show>
              </Show>
            </div>

            {/* ── Footer ── */}
            <div class="px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 flex gap-3">
              <Show
                when={!result()}
                fallback={
                  <button
                    type="button"
                    onClick={close}
                    class="flex-1 px-4 py-2.5 rounded-lg bg-[#14233A] hover:bg-[#0d1728] text-white font-semibold transition"
                  >
                    Done
                  </button>
                }
              >
                <button
                  type="button"
                  onClick={close}
                  disabled={busy()}
                  class="flex-1 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1]/60 dark:hover:bg-gray-700 disabled:opacity-40 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={
                    busy() ||
                    !canReview() ||
                    (confirming() && !confirmMatches())
                  }
                  class="flex-1 px-4 py-2.5 rounded-lg bg-[#AC2334] hover:bg-[#93192a] text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {busy()
                    ? "Moving…"
                    : confirming()
                      ? "Move campaign"
                      : "Review this move"}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
