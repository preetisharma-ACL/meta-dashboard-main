import {
  createSignal,
  createResource,
  createMemo,
  createEffect,
  For,
  Show,
} from "solid-js";
import {
  fetchServiceClientRoster,
  fetchAdditionalServices,
  serviceLabel,
  fmtChargeDate,
  isRevoked,
  asNum,
} from "../../services/additionalServices";
import AdditionalServiceModal from "../../components/billing/AdditionalServiceModal";
import RevokeServiceModal from "../../components/billing/RevokeServiceModal";
import { showToast } from "../../components/common/SuccessToast";
import { canWriteAdditionalServices } from "../../stores/currentUser";
import { errorMessage } from "../../utils/apiErrors";

// ─── Additional services — the staff screen ───────────────────────────────────
// Record, edit and revoke the non-ad charges (website development, SEO, social
// media, content) that come off a client's MAIN balance.
//
// NOT a service charge. "Service charge" is the 13%/15% on Meta ad spend and
// nothing else; no label on this screen uses the phrase.
//
// Route-gated to admin / accounts / coordination / campaign managers. The WRITE
// controls are gated again inside, on canWriteAdditionalServices() — a tier-2
// CM gets the read-only list so they can answer "why did this balance drop"
// without being able to change it. A CLIENT never reaches this screen at all,
// and never sees the notes or who recorded a service.
//
// One client at a time, because that is the shape of the API: the list endpoint
// requires client_id and there is no all-clients roll-up to read.
//
// The roster comes from fetchServiceClientRoster() — /payments/clients/ first
// (accounts, admin, tier-1 CMs), then the client directory (coordination). That
// helper is also where the CLIENT PK is resolved, which is the part worth being
// careful about: the nomen id is a different number for all but one client, and
// sending it as client_id would charge somebody else.
//
// There is no DELETE anywhere on this screen. Revoke is the only removal path
// the API offers; a hard delete exists in Django admin and is not ours to
// offer.

const money = (v) => {
  const n = asNum(v);
  return n == null
    ? "—"
    : `₹${n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
};

const pctLabel = (v) => {
  const n = asNum(v);
  return n == null ? "—" : `${n}%`;
};

export default function AdditionalServices() {
  const canWrite = canWriteAdditionalServices;

  const [clientId, setClientId] = createSignal("");
  const [clientQuery, setClientQuery] = createSignal("");
  const [clientOpen, setClientOpen] = createSignal(false);
  const [includeRevoked, setIncludeRevoked] = createSignal(false);

  const [addOpen, setAddOpen] = createSignal(false);
  const [editRow, setEditRow] = createSignal(null);
  const [revokeRow, setRevokeRow] = createSignal(null);

  // Two sources in order: the payments-desk picker (accounts, admin, tier-1
  // CMs) then the client directory (coordination). Unfiltered by client type —
  // a retainer client buys a website the same as anyone else.
  //
  // A SHORT LIST IS OFTEN CORRECT: a tier-1 CM is scoped to their own book and
  // their team's, so 27 clients where admin sees every one is the backend doing
  // its job, not a truncated roster. The hint under the picker says which
  // source answered so nobody chases a missing client that was never theirs.
  const [roster] = createResource(fetchServiceClientRoster);
  const clientList = () => roster()?.rows ?? [];

  const selectedClient = createMemo(() =>
    clientList().find((c) => String(c.id) === String(clientId())),
  );

  const filteredClients = createMemo(() => {
    const q = clientQuery().trim().toLowerCase();
    const list = clientList();
    if (!q) return list;
    return list.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q),
    );
  });

  // Keyed on [clientId, includeRevoked] → picking a client or flipping the
  // toggle refetches; no client selected means no request at all.
  const [listRes, { refetch }] = createResource(
    () => (clientId() ? { id: clientId(), revoked: includeRevoked() } : null),
    async (key) =>
      await fetchAdditionalServices({
        clientId: key.id,
        includeRevoked: key.revoked,
      }),
  );

  const rows = () => listRes()?.rows ?? [];
  const loading = () => listRes.loading;

  // Live rows only, for the strip. A revoked entry is no longer charged, so
  // folding it into the total would state money the client does not owe.
  const liveRows = createMemo(() => rows().filter((r) => !isRevoked(r)));

  // The screen's own arithmetic, and the only place on this feature that sums
  // rows: there is no server total on the staff list (the per-month totals live
  // on the billing overview, and this list spans every month). A row whose
  // total is missing contributes nothing rather than poisoning the sum.
  const liveTotal = createMemo(() =>
    liveRows().reduce((s, r) => s + (asNum(r.total_inc_gst) ?? 0), 0),
  );

  const onSaved = () => {
    showToast(
      "The client's balance is updated for the month of the charge date.",
      "Additional service saved",
    );
    refetch();
  };

  const onRevoked = () => {
    showToast(
      "The charge no longer applies and the balance is restored.",
      "Additional service revoked",
    );
    refetch();
  };

  // A client the picker offers but the caller cannot manage answers 403 on the
  // LIST too, so the message is the server's rather than an empty table.
  const listError = () =>
    listRes.error
      ? errorMessage(listRes.error, "Could not load additional services.")
      : null;

  // The roster came back empty. The causes read very differently: this caller
  // genuinely holds no clients, both sources refused them (an access problem,
  // not an empty book), or the payments picker answered without a Client PK —
  // the one case where the data is there and unusable, which needs naming or
  // it gets "fixed" by sending the nomen id and charging the wrong client.
  const rosterEmpty = () => !roster.loading && clientList().length === 0;
  const rosterFailed = () => roster()?.failed === true;
  const rosterPkMissing = () => roster()?.pkMissing === true;

  // How many clients the picker holds, and — when the payments roster answered
  // — how many of its nomens had no client record to bill. Both numbers exist
  // to stop a correct list reading as a broken one: a tier-1 CM's 27 where
  // admin sees ~190 is the backend scoping them, and a name on the payments
  // desk's 277-nomen picker that is missing here is a nomen with no client,
  // not a lost client.
  const rosterNote = () => {
    if (roster.loading || rosterEmpty()) return null;
    const n = clientList().length;
    const skipped = roster()?.skippedNomens ?? 0;
    const base = `${n} ${n === 1 ? "client" : "clients"} you can bill`;
    return skipped > 0
      ? `${base} · ${skipped} payment names have no client record and cannot be charged`
      : base;
  };

  // Reset the dropdown's text to the picked client whenever the selection
  // changes from elsewhere (a cleared field, say), so the box never shows a
  // half-typed search next to a loaded list.
  createEffect(() => {
    const c = selectedClient();
    if (c && !clientOpen()) setClientQuery(c.name);
  });

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Client Billing
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Additional services
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            Website development, SEO and other non-ad work, charged to a
            client's main balance in the month of the charge date. GST applies;
            no service charge is added, and Replaced Credit Notes never pay for
            these.
          </p>
        </div>

        <Show when={canWrite()}>
          <button
            onClick={() => setAddOpen(true)}
            disabled={!clientId()}
            class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#AC2334] text-white text-sm font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add service
          </button>
        </Show>
      </div>

      {/* Tier-2 CMs and anyone else without the write gate get the list and no
          controls — said out loud, because a screen with no buttons otherwise
          reads as broken. */}
      <Show when={!canWrite()}>
        <p class="mb-5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#ECF2FA] dark:bg-blue-900/30 text-[12px] font-semibold text-[#3E6FB0] dark:text-blue-300">
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          Read-only — adding, editing and revoking is for admin, accounts,
          coordination and team leads.
        </p>
      </Show>

      {/* ════════ CLIENT PICKER ════════ */}
      <div class="mb-5 flex flex-col sm:flex-row sm:items-end gap-3">
        <div class="w-full sm:max-w-sm">
          <label class="block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5">
            Client
          </label>
          <div class="relative">
            <input
              type="text"
              value={clientQuery()}
              placeholder={
                roster.loading ? "Loading clients…" : "Search a client…"
              }
              onFocus={() => setClientOpen(true)}
              onInput={(e) => {
                setClientQuery(e.currentTarget.value);
                setClientOpen(true);
              }}
              onBlur={() => setTimeout(() => setClientOpen(false), 150)}
              class="w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-100 focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none transition"
            />
            <Show when={clientOpen()}>
              <div class="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                <Show
                  when={filteredClients().length}
                  fallback={
                    <p class="px-3 py-3 text-sm text-[#8593A8]">
                      {rosterPkMissing()
                        ? "The client list loaded but carries no client id this screen can bill against. Tell an admin — do not work around it; the other id on that payload belongs to a different client."
                        : rosterFailed()
                          ? "The client list could not be loaded for your account. Ask an admin to check your access — this is not a client with nothing recorded."
                          : rosterEmpty()
                            ? "No clients available to you."
                            : "No clients match."}
                    </p>
                  }
                >
                  <For each={filteredClients()}>
                    {(c) => (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setClientId(String(c.id));
                          setClientQuery(c.name);
                          setClientOpen(false);
                        }}
                        class="w-full text-left px-3 py-2 hover:bg-[#FBEEF0] dark:hover:bg-gray-800 transition-colors"
                      >
                        <div class="font-medium text-[#14233A] dark:text-gray-100">
                          {c.name}
                        </div>
                        <div class="text-xs text-[#8593A8]">
                          {c.clientType ? c.clientType.toUpperCase() : "—"}
                          {c.email ? ` · ${c.email}` : ""}
                        </div>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
          {/* A short roster is usually the backend working, not a truncated
              list — a tier-1 CM is scoped to their own book and their team's,
              and the payments roster carries nomens that no client sits behind.
              Stating both counts is cheaper than the support ping. */}
          <Show when={rosterNote()}>
            <p class="mt-1 text-xs text-[#8593A8] dark:text-gray-400">
              {rosterNote()}
            </p>
          </Show>
        </div>

        {/* Revoked entries are off by default — they are not charged, so they
            are history rather than the working list. */}
        <label class="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-[#54657E] dark:text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeRevoked()}
            onChange={(e) => setIncludeRevoked(e.currentTarget.checked)}
            class="w-4 h-4 accent-[#AC2334] cursor-pointer"
          />
          Show revoked
        </label>
      </div>

      <Show when={listError()}>
        <div
          role="alert"
          class="mb-6 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
        >
          {listError()}
        </div>
      </Show>

      {/* ════════ SUMMARY STRIP ════════
          Live entries only. A revoked row is no longer charged and must not be
          counted — these numbers span every month, so they are a running
          total of what this client has been charged for non-ad work, not a
          month's bill. The monthly figure is the one on their billing page. */}
      <Show when={clientId() && !loading() && liveRows().length > 0}>
        <div class="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-5">
            <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              Charged · all months · inc GST
            </p>
            <p class="text-2xl font-bold mt-1.5 tracking-tight text-[#14233A] dark:text-white tabular-nums">
              {money(liveTotal())}
            </p>
          </div>
          <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-5">
            <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              Live entries
            </p>
            <p class="text-2xl font-bold mt-1.5 tracking-tight text-[#14233A] dark:text-white tabular-nums">
              {liveRows().length}
            </p>
          </div>
        </div>
      </Show>

      {/* ════════ LIST ════════ */}
      <Show
        when={clientId()}
        fallback={
          <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 p-10 text-center">
            <p class="text-sm font-semibold text-[#14233A] dark:text-gray-200">
              Pick a client
            </p>
            <p class="mt-1 text-sm text-[#8593A8] dark:text-gray-400">
              Additional services are recorded per client, one entry per charge.
            </p>
          </div>
        }
      >
        <div class="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700">
          <table class="w-full text-sm table-auto">
            <thead class="bg-[#F8FAFC] dark:bg-gray-800">
              <tr class="[&_th]:whitespace-nowrap [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:px-4 [&_th]:py-3.5 text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700">
                <th class="text-left">Service</th>
                <th class="text-left">Description</th>
                <th class="text-left">Date</th>
                <th class="text-right">Amount (ex GST)</th>
                <th class="text-right">GST</th>
                <th class="text-right">Total (inc GST)</th>
                <th class="text-left">Recorded by</th>
                <Show when={canWrite()}>
                  <th class="text-right">Actions</th>
                </Show>
              </tr>
            </thead>

            <Show
              when={!loading()}
              fallback={
                <tbody>
                  <For each={Array(5).fill(0)}>
                    {() => (
                      <tr class="border-t border-[#E2E8F1] dark:border-gray-700 animate-pulse">
                        <For each={Array(canWrite() ? 8 : 7).fill(0)}>
                          {() => (
                            <td class="p-3">
                              <div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              }
            >
              <tbody>
                <For each={rows()}>
                  {(r) => (
                    <tr
                      class={
                        "border-t border-[#E2E8F1] dark:border-gray-700 align-top " +
                        (isRevoked(r) ? "bg-[#FAFBFD] dark:bg-gray-800/60" : "")
                      }
                    >
                      <td class="px-4 py-3">
                        <div
                          class={
                            "font-semibold text-[#14233A] dark:text-gray-100 " +
                            (isRevoked(r) ? "line-through opacity-60" : "")
                          }
                        >
                          {serviceLabel(r)}
                        </div>
                        <div class="text-xs text-[#8593A8] dark:text-gray-400">
                          {r.service_type_label || r.service_type || "—"}
                        </div>
                        {/* Revoked rows carry the reason. It only arrives with
                            include_revoked=1, and it is the whole point of
                            keeping the row instead of deleting it. */}
                        <Show when={isRevoked(r)}>
                          <div class="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[11px] font-bold uppercase tracking-wide text-[#AC2334] dark:text-red-300">
                            Revoked
                          </div>
                          <Show when={r.revoke_reason}>
                            <div class="mt-1 text-xs text-[#54657E] dark:text-gray-400 max-w-[22rem]">
                              {r.revoke_reason}
                            </div>
                          </Show>
                        </Show>
                      </td>
                      <td class="px-4 py-3 text-[#54657E] dark:text-gray-300 max-w-[18rem]">
                        <Show
                          when={r.description}
                          fallback={<span class="text-[#8593A8]">—</span>}
                        >
                          {r.description}
                        </Show>
                        {/* Internal note — staff only. The client never sees
                            this, which is why it sits on this screen and not
                            on the billing overview. */}
                        <Show when={r.notes}>
                          <div class="mt-1.5 text-xs text-[#8593A8] dark:text-gray-400 italic">
                            Note: {r.notes}
                          </div>
                        </Show>
                      </td>
                      <td class="px-4 py-3 whitespace-nowrap text-[#14233A] dark:text-gray-300">
                        {fmtChargeDate(r.charge_date)}
                      </td>
                      <td class="px-4 py-3 text-right tabular-nums text-[#14233A] dark:text-gray-300">
                        {money(r.amount_ex_gst)}
                      </td>
                      <td class="px-4 py-3 text-right tabular-nums text-[#54657E] dark:text-gray-400">
                        {money(r.gst_amount)}
                        <div class="text-[11px] text-[#8593A8]">
                          {pctLabel(r.gst_pct)}
                        </div>
                      </td>
                      <td class="px-4 py-3 text-right tabular-nums font-semibold text-[#14233A] dark:text-gray-100">
                        {money(r.total_inc_gst)}
                      </td>
                      <td class="px-4 py-3 text-[#54657E] dark:text-gray-400 whitespace-nowrap">
                        {r.recorded_by || "—"}
                      </td>
                      <Show when={canWrite()}>
                        <td class="px-4 py-3 text-right whitespace-nowrap">
                          {/* A revoked entry is history: nothing to edit and
                              nothing left to revoke. */}
                          <Show
                            when={!isRevoked(r)}
                            fallback={<span class="text-[#8593A8]">—</span>}
                          >
                            <div class="inline-flex items-center gap-2">
                              <button
                                onClick={() => setEditRow(r)}
                                class="px-3 py-1.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 text-xs font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setRevokeRow(r)}
                                class="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#AC2334] dark:text-red-300 bg-[#FBEEF0] dark:bg-red-900/30 hover:bg-[#F7DDE1] dark:hover:bg-red-900/50 transition"
                              >
                                Revoke
                              </button>
                            </div>
                          </Show>
                        </td>
                      </Show>
                    </tr>
                  )}
                </For>
              </tbody>
            </Show>
          </table>

          <Show when={!loading() && rows().length === 0 && !listError()}>
            <div class="p-10 text-center">
              <p class="text-sm font-semibold text-[#14233A] dark:text-gray-200">
                No additional services
              </p>
              <p class="mt-1 text-sm text-[#8593A8] dark:text-gray-400">
                {selectedClient()?.name
                  ? `${selectedClient().name} has no non-ad charges recorded${includeRevoked() ? "" : " — revoked entries are hidden"}.`
                  : "Nothing recorded for this client."}
              </p>
            </div>
          </Show>
        </div>
      </Show>

      {/* ── Add ── */}
      <AdditionalServiceModal
        open={addOpen()}
        clientId={clientId()}
        clientName={selectedClient()?.name}
        onClose={() => setAddOpen(false)}
        onSaved={onSaved}
      />

      {/* ── Edit — keyed on the row so the form reloads per entry ── */}
      <AdditionalServiceModal
        open={editRow() != null}
        row={editRow()}
        clientId={clientId()}
        clientName={selectedClient()?.name}
        onClose={() => setEditRow(null)}
        onSaved={onSaved}
      />

      {/* ── Revoke ── */}
      <RevokeServiceModal
        open={revokeRow() != null}
        row={revokeRow()}
        onClose={() => setRevokeRow(null)}
        onRevoked={onRevoked}
      />
    </section>
  );
}
