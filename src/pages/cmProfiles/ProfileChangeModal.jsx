import { createSignal, createEffect, createMemo, For, Show } from "solid-js";
import {
  FIELD,
  TierPowers,
  TIER_1_POWERS,
  cmLabel,
  clientLabel,
} from "./cmProfilesFormat";

// ─── Confirming a profile change ──────────────────────────────────────────────
// One modal for all three writes, because all three are the same kind of event:
// a change to what a manager may do, or to whose dashboard their clients appear
// on, with a reason recorded against it.
//
// What this step exists for is the CONSEQUENCE SENTENCE. None of these fields is
// a label:
//   tier      promoting grants five separate powers in one PATCH, so the modal
//             lists them rather than saying "elevated permissions"
//   lead      moving a tier-2 manager between leads moves every client they hold
//             out of one dashboard and into another — at once and for all
//             history — so the modal NAMES THOSE CLIENTS. "16 clients" asks the
//             operator to take the number on trust; sixteen names can be read.
//   is_active a deactivated manager keeps their clients, which is exactly the
//             state the roster flags, so the modal says so before it happens.
//
// reason is required by the server on all three, and the button stays disabled
// without one — but the server's 422 is still routed to the field, because it is
// the authority on what counts as a reason.
//
// Props: pending ({ mode:"tier"|"lead"|"active", profile, leadCandidates }|null),
//        busy, error, reasonError, onConfirm(patch), onClose()

const OTHER_TIER = { tier_1: "tier_2", tier_2: "tier_1" };

export default function ProfileChangeModal(props) {
  const [reason, setReason] = createSignal("");
  const [leadId, setLeadId] = createSignal("");

  const p = () => props.pending?.profile ?? null;
  const mode = () => props.pending?.mode ?? null;

  // The tier this change lands on. Always the opposite of the current one —
  // there are only two, so a picker would be a dropdown with one live option.
  const nextTier = () => OTHER_TIER[String(p()?.tier)] ?? "tier_1";
  const promoting = () => mode() === "tier" && nextTier() === "tier_1";
  const demoting = () => mode() === "tier" && nextTier() === "tier_2";
  const deactivating = () => mode() === "active" && p()?.isActive !== false;

  // A lead is picked when moving a tier-2 manager, and when DEMOTING — a tier-2
  // manager always needs an active tier-1 lead, so a demotion that doesn't name
  // one is a 422 the operator can only find out about by trying.
  const needsLead = () => mode() === "lead" || demoting();

  const candidates = createMemo(() => props.pending?.leadCandidates ?? []);
  const chosenLead = createMemo(() =>
    candidates().find((c) => String(c.sendId) === String(leadId())),
  );

  // Reset whenever a NEW change is put up, so a reason typed for one can never
  // be filed against another. Tracks the pending OBJECT, which the caller
  // replaces per confirmation — a rejected attempt leaves it untouched, so a
  // retry keeps what the operator typed.
  createEffect(() => {
    props.pending;
    setReason("");
    setLeadId("");
  });

  const clients = () => p()?.clients ?? [];
  const clientCount = () => p()?.clientCount ?? clients().length;

  // Active reports only — both server guards that involve a team test for
  // ACTIVE members, and a deactivated report must not raise a warning about a
  // change the server will happily accept.
  const activeTeam = () => p()?.activeTeamCount ?? 0;

  const ready = () => {
    if (!reason().trim()) return false;
    if (needsLead() && !leadId()) return false;
    return true;
  };

  const confirm = () => {
    if (!ready()) return;
    const patch = { reason: reason() };

    if (mode() === "tier") {
      patch.tier = nextTier();
      // The two fields move together on a tier change, because the server's
      // rules bind them: a tier-2 manager always has an active tier-1 lead, and
      // a tier-1 manager never has one. Sending the tier alone would leave the
      // profile in a state the model forbids.
      patch.teamLeadId = promoting() ? null : Number(leadId());
    } else if (mode() === "lead") {
      patch.teamLeadId = Number(leadId());
    } else if (mode() === "active") {
      patch.isActive = p()?.isActive === false;
    }

    props.onConfirm?.(patch);
  };

  const title = () => {
    if (mode() === "tier") return promoting() ? "Promote to Tier 1" : "Demote to Tier 2";
    if (mode() === "lead") return "Move to another team lead";
    return deactivating() ? "Deactivate this manager" : "Reactivate this manager";
  };

  const subtitle = () => {
    if (mode() === "tier")
      return promoting()
        ? "Grants five campaign and payment permissions at once."
        : "Removes every campaign and payment permission at once.";
    if (mode() === "lead")
      return "Moves this manager's clients between two leads' dashboards.";
    return deactivating()
      ? "Switches the manager off. Their clients stay assigned to them."
      : "Switches the manager back on.";
  };

  const cta = () => {
    if (props.busy) return "Saving…";
    if (mode() === "tier") return promoting() ? "Promote to Tier 1" : "Demote to Tier 2";
    if (mode() === "lead") return "Move to this lead";
    return deactivating() ? "Deactivate" : "Reactivate";
  };

  const destructive = () => demoting() || deactivating();

  return (
    <Show when={props.pending}>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          onClick={() => !props.busy && props.onClose?.()}
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={title()}
          class="relative z-50 w-full max-w-lg max-h-[90vh] flex flex-col bg-white dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-2xl overflow-hidden"
        >
          <div class="px-6 py-4 border-b border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800">
            <h2 class="text-lg font-bold text-[#14233A] dark:text-white">
              {title()}
            </h2>
            <p class="text-sm text-[#54657E] dark:text-gray-400 mt-0.5">
              {subtitle()}
            </p>
          </div>

          <div class="px-6 py-5 space-y-4 overflow-y-auto">
            {/* Who this is about. The operator may have been reading a client
                list when they clicked, so the manager is named again here. */}
            <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60 px-4 py-3">
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-xs font-bold uppercase tracking-wider text-[#8593A8]">
                  Campaign manager
                </span>
                <span class="text-sm font-semibold text-[#14233A] dark:text-gray-100 text-right break-all">
                  {cmLabel(p())}
                </span>
              </div>
              <div class="flex items-baseline justify-between gap-3 mt-1.5">
                <span class="text-xs font-bold uppercase tracking-wider text-[#8593A8]">
                  Holds
                </span>
                <span class="text-sm font-semibold text-[#14233A] dark:text-gray-100">
                  {clientCount()} client{clientCount() === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* ── TIER: the permissions that move ── */}
            <Show when={mode() === "tier"}>
              <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 px-4 py-3.5">
                <p class="text-sm font-bold text-[#14233A] dark:text-gray-100 mb-2.5">
                  {promoting()
                    ? "This grants all of the following:"
                    : "This removes all of the following:"}
                </p>
                {/* Rendered at the tier being GRANTED when promoting (ticks) and
                    the tier being LANDED ON when demoting (struck through), so
                    the list always shows the state after the change. */}
                <TierPowers tier={promoting() ? "tier_1" : "tier_2"} />
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-3">
                  {promoting()
                    ? `${TIER_1_POWERS.length} permissions, granted in one change.`
                    : "Tier 2 may do none of these."}
                </p>
              </div>

              <Show when={promoting()}>
                <p class="text-sm text-[#54657E] dark:text-gray-300">
                  A Tier 1 manager has no team lead, so this also clears theirs
                  {p()?.teamLeadEmail ? ` (${p().teamLeadEmail})` : ""}. Their{" "}
                  {clientCount()} client{clientCount() === 1 ? "" : "s"} leave
                  that lead's dashboard and sit under this manager instead.
                </p>
              </Show>

              {/* The guard tests ACTIVE members specifically, so the warning
                  counts those — telling an operator a demotion will be refused
                  because of a deactivated report would be a false stop. */}
              <Show when={demoting() && activeTeam() > 0}>
                <p class="rounded-lg border border-[#E4B94A]/50 bg-[#FDF6E7] dark:bg-yellow-900/20 dark:border-yellow-700/50 px-3.5 py-2.5 text-xs text-[#8A6410] dark:text-yellow-200">
                  This manager currently leads {activeTeam()} active team member
                  {activeTeam() === 1 ? "" : "s"}. The server refuses a demotion
                  while any of them are active — move them to another lead first.
                </p>
              </Show>
            </Show>

            {/* ── ACTIVE ── */}
            <Show when={mode() === "active"}>
              <Show when={deactivating()}>
                <p class="text-sm text-[#54657E] dark:text-gray-300">
                  Deactivating does not hand over the{" "}
                  <span class="font-bold text-[#14233A] dark:text-gray-100">
                    {clientCount()} client{clientCount() === 1 ? "" : "s"}
                  </span>{" "}
                  assigned to this manager. They stay assigned to a profile that
                  is switched off until somebody reassigns them on Client
                  Assignments.
                </p>
                <Show when={activeTeam() > 0}>
                  <p class="rounded-lg border border-[#E4B94A]/50 bg-[#FDF6E7] dark:bg-yellow-900/20 dark:border-yellow-700/50 px-3.5 py-2.5 text-xs text-[#8A6410] dark:text-yellow-200">
                    {activeTeam()} active tier-2 manager
                    {activeTeam() === 1 ? "" : "s"} report to this lead, and a
                    tier-2 manager needs an ACTIVE lead — the server may refuse
                    this until they are moved.
                  </p>
                </Show>
              </Show>
              <Show when={!deactivating()}>
                <p class="text-sm text-[#54657E] dark:text-gray-300">
                  The manager can sign in again and their{" "}
                  {clientCount()} client{clientCount() === 1 ? "" : "s"} come
                  back into view for them and their lead.
                </p>
              </Show>
            </Show>

            {/* ── LEAD PICKER (a move, or the lead a demotion lands under) ── */}
            <Show when={needsLead()}>
              <div>
                <label class="block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5">
                  {demoting() ? "Report to" : "New team lead"}
                </label>
                <select
                  value={leadId()}
                  onInput={(e) => setLeadId(e.currentTarget.value)}
                  disabled={props.busy}
                  class={FIELD}
                >
                  <option value="">Choose an active Tier 1 lead…</option>
                  <For each={candidates()}>
                    {(c) => <option value={c.sendId}>{cmLabel(c)}</option>}
                  </For>
                </select>
                <p class="text-xs text-[#8593A8] mt-1">
                  {demoting()
                    ? "A Tier 2 manager always reports to an active Tier 1 lead."
                    : `Currently ${p()?.teamLeadEmail ?? "no lead"}.`}
                </p>
                <Show when={!candidates().length}>
                  <p class="text-xs text-[#AC2334] mt-1">
                    There is no other active Tier 1 manager to report to.
                  </p>
                </Show>
              </div>
            </Show>

            {/* ── THE CLIENTS THAT MOVE, BY NAME ──
                A lead change is a change to WHOSE DASHBOARD these clients are
                on. The count is the headline, the names are the review — and
                they are the reason the detail route is fetched before the modal
                opens. */}
            <Show when={needsLead() && clients().length}>
              <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 overflow-hidden">
                {/* A MOVE and a DEMOTION are different events for these
                    clients. A tier-2 manager's clients leave one lead's
                    dashboard for another's; a demoted tier-1's clients were only
                    ever theirs, and the change is that a lead can now see them.
                    Wording them the same way would misdescribe one of the two. */}
                <div class="px-4 py-2.5 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#E2E8F1] dark:border-gray-700">
                  <p class="text-sm font-bold text-[#14233A] dark:text-gray-100">
                    {clients().length} client
                    {clients().length === 1 ? "" : "s"}{" "}
                    {demoting() ? "become visible to" : "move to"}{" "}
                    {chosenLead() ? cmLabel(chosenLead()) : "the new lead"}
                  </p>
                  <p class="text-[11px] text-[#54657E] dark:text-gray-400 mt-0.5">
                    {demoting()
                      ? "That lead's dashboard gains this manager's whole book"
                      : `Out of ${p()?.teamLeadEmail ?? "the current lead"}'s dashboard`}
                    , at once and for all history — not from today forward.
                  </p>
                </div>
                <ul class="max-h-44 overflow-y-auto divide-y divide-[#EDF1F7] dark:divide-gray-700">
                  <For each={clients()}>
                    {(c) => (
                      <li class="px-4 py-2 text-sm text-[#14233A] dark:text-gray-200 break-all">
                        {clientLabel(c)}
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            <Show when={needsLead() && !clients().length}>
              <p class="text-sm text-[#8593A8]">
                This manager holds no clients, so no client data changes hands.
              </p>
            </Show>

            {/* ── REASON ── */}
            <div>
              <label class="block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5">
                Reason <span class="font-normal text-[#AC2334]">(required)</span>
              </label>
              <textarea
                rows="3"
                value={reason()}
                onInput={(e) => setReason(e.target.value)}
                disabled={props.busy}
                placeholder={
                  mode() === "tier"
                    ? promoting()
                      ? "Why does this manager need Tier 1 permissions?"
                      : "Why are these permissions being removed?"
                    : mode() === "lead"
                      ? "Why are these clients moving to another lead?"
                      : deactivating()
                        ? "Why is this manager being switched off?"
                        : "Why is this manager coming back?"
                }
                class={`${FIELD} resize-none ${
                  props.reasonError ? "border-[#AC2334] ring-2 ring-[#AC2334]/25" : ""
                }`}
              />
              {/* The server's wording for a bad reason wins over ours — it is
                  worded per field and names what it wanted. */}
              <Show
                when={props.reasonError}
                fallback={
                  <p class="text-xs text-[#8593A8] mt-1">
                    Recorded on this profile's history, next to what changed and
                    how many clients it moved.
                  </p>
                }
              >
                <p class="text-xs font-medium text-[#AC2334] mt-1">
                  {props.reasonError}
                </p>
              </Show>
            </div>

            {/* Rejections land here rather than throwing the operator back to
                the roster — the change is still on screen, so the message is
                actionable where it is read. Shown verbatim: the guard responses
                name the team members or the rule that stopped it, and
                paraphrasing that away is what makes an error unactionable. */}
            <Show when={props.error}>
              <p
                role="alert"
                class="rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300 whitespace-pre-wrap"
              >
                {props.error}
              </p>
            </Show>
          </div>

          <div class="px-6 py-4 border-t border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 flex gap-3">
            <button
              type="button"
              onClick={() => props.onClose?.()}
              disabled={props.busy}
              class="flex-1 px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1]/60 dark:hover:bg-gray-700 disabled:opacity-40 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={props.busy || !ready()}
              title={
                !reason().trim()
                  ? "A reason is required."
                  : needsLead() && !leadId()
                    ? "Choose a team lead."
                    : undefined
              }
              class={`flex-1 px-4 py-2.5 rounded-lg text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition ${
                destructive()
                  ? "bg-[#AC2334] hover:bg-[#93192a]"
                  : "bg-[#15966A] hover:bg-[#0F7A55]"
              }`}
            >
              {cta()}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
