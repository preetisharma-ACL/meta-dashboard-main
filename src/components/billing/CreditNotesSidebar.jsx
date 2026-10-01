import { For, Show } from "solid-js";
import { cnNum, cnMonthLabel, hasKey } from "../../services/creditNotes";

// ─── Credit Notes sidebar ─────────────────────────────────────────────────────
// Slide-over for GET /billing/credit-notes/. The caller owns the fetch and only
// mounts this when `applies` is true — a client with no pool sees no entry
// point at all.
//
// Sections: Available now · By project · By month · History.
//
// History rows carry four admin/CM-only keys (recorded_by, recorded_at, notes,
// revoke_reason). For a client they are ABSENT, not false, so each renders on
// the key's presence. Clients never receive revoked batches; an admin sees
// them struck through.
//
// Props: open, onClose(), data (the response's `data`), loading, error

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (v) => {
  const n = cnNum(v);
  return n == null ? "—" : inr.format(n);
};
const count = (v) => {
  const n = cnNum(v);
  return n == null ? "—" : n.toLocaleString("en-IN");
};
const day = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

function Section(props) {
  return (
    <section class="px-6 py-5 border-t border-gray-100 dark:border-gray-800">
      <p class="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {props.title}
      </p>
      {props.children}
    </section>
  );
}

function Empty(props) {
  return (
    <p class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-4 py-5 text-center text-sm text-gray-500 dark:text-gray-400">
      {props.children}
    </p>
  );
}

export default function CreditNotesSidebar(props) {
  const d = () => props.data || {};
  const months = () => (Array.isArray(d().months) ? d().months : []);
  const projects = () => (Array.isArray(d().projects) ? d().projects : []);
  const credits = () => (Array.isArray(d().credits) ? d().credits : []);

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex">
        <div
          onClick={props.onClose}
          class="fixed inset-0 bg-black/35 backdrop-blur-sm"
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Replaced Credit Notes"
          class="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col"
        >
          <div class="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
                Replaced Credit Notes
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Replaced leads become credits that pay your charges before your
                main balance.
              </p>
            </div>
            <button
              onClick={props.onClose}
              aria-label="Close"
              class="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              ✕
            </button>
          </div>

          <div class="flex-1 overflow-y-auto">
            <Show when={props.error}>
              <div class="mx-6 mt-5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300">
                Couldn't load Replaced Credit Notes.
              </div>
            </Show>

            <Show
              when={!props.loading}
              fallback={
                <p class="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                  Loading Replaced Credit Notes…
                </p>
              }
            >
              {/* ── Available now ── */}
              <div class="px-6 py-6 bg-gradient-to-b from-blue-50/80 to-white dark:from-blue-950/30 dark:to-gray-900">
                <p class="text-sm text-gray-600 dark:text-gray-300">
                  Available now
                </p>
                <p class="mt-2 text-3xl font-bold tracking-tight tabular-nums text-blue-900 dark:text-blue-300">
                  {money(d().available_inc_gst)}
                </p>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  inc GST
                </p>
              </div>

              {/* ── By project ── */}
              <Section title="By project">
                <Show
                  when={projects().length > 0}
                  fallback={<Empty>No replacement credits yet.</Empty>}
                >
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <th class="py-2 text-left font-medium">Project</th>
                        <th class="py-2 text-right font-medium">Leads</th>
                        <th class="py-2 text-right font-medium">Credit · inc GST</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={projects()}>
                        {(p) => (
                          <tr class="border-t border-gray-100 dark:border-gray-800">
                            <td class="py-2.5 pr-3 font-medium text-gray-900 dark:text-gray-100 break-words">
                              {p.project_name ?? "—"}
                            </td>
                            <td class="py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">
                              {count(p.replaced_leads)}
                            </td>
                            <td class="py-2.5 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                              {money(p.credit_inc_gst)}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </Section>

              {/* ── By month (newest first, as served) ── */}
              <Section title="By month">
                <Show
                  when={months().length > 0}
                  fallback={<Empty>No months yet.</Empty>}
                >
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead>
                        <tr class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          <th class="py-2 text-left font-medium">Month</th>
                          <th class="py-2 px-2 text-right font-medium">Opening</th>
                          <th class="py-2 px-2 text-right font-medium">Added</th>
                          <th class="py-2 px-2 text-right font-medium">Used</th>
                          <th class="py-2 pl-2 text-right font-medium">Closing</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={months()}>
                          {(m) => (
                            <tr class="border-t border-gray-100 dark:border-gray-800 tabular-nums">
                              <td class="py-2.5 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                                {cnMonthLabel(m.month)}
                              </td>
                              <td class="py-2.5 px-2 text-right text-gray-600 dark:text-gray-300">
                                {money(m.opening_inc)}
                              </td>
                              <td class="py-2.5 px-2 text-right text-green-700 dark:text-green-400">
                                {money(m.added_inc)}
                              </td>
                              <td class="py-2.5 px-2 text-right text-red-600 dark:text-red-400">
                                {money(m.used_inc)}
                              </td>
                              <td class="py-2.5 pl-2 text-right font-semibold text-gray-900 dark:text-gray-100">
                                {money(m.closing_inc)}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                  <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">
                    All amounts inc GST.
                  </p>
                </Show>
              </Section>

              {/* ── History: every batch, newest first ── */}
              <Section title="History">
                <Show
                  when={credits().length > 0}
                  fallback={<Empty>No credits recorded yet.</Empty>}
                >
                  <div class="space-y-3">
                    <For each={credits()}>
                      {(c) => {
                        const revoked = c.is_revoked === true;
                        return (
                          <div
                            class={`rounded-xl border p-4 ${
                              revoked
                                ? "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40"
                                : "border-gray-200 dark:border-gray-700"
                            }`}
                          >
                            <div class="flex items-start justify-between gap-3">
                              <div class={`min-w-0 ${revoked ? "line-through opacity-60" : ""}`}>
                                <p class="font-semibold text-gray-900 dark:text-gray-100 break-words">
                                  {c.project_name ?? "—"}
                                </p>
                                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                  {day(c.received_date)} · {count(c.replaced_leads)}{" "}
                                  lead{cnNum(c.replaced_leads) === 1 ? "" : "s"} ×{" "}
                                  {money(c.lead_value_ex_gst)} ex GST
                                  <Show when={cnNum(c.service_charge_pct) != null}>
                                    {" "}· S.C {cnNum(c.service_charge_pct)}%
                                  </Show>
                                </p>
                              </div>
                              <div class={`text-right shrink-0 ${revoked ? "line-through opacity-60" : ""}`}>
                                <p class="font-bold tabular-nums text-gray-900 dark:text-gray-100">
                                  {money(c.credit_inc_gst)}
                                </p>
                                <p class="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                                  {money(c.credit_ex_gst)} ex GST
                                </p>
                              </div>
                            </div>

                            <Show when={revoked}>
                              <p class="mt-2 inline-flex rounded-full bg-red-100 dark:bg-red-950 px-2 py-0.5 text-xs font-bold text-red-700 dark:text-red-400">
                                Revoked
                              </p>
                            </Show>

                            {/* Admin / CM only — keys are absent for a client. */}
                            <Show
                              when={
                                hasKey(c, "recorded_by") ||
                                hasKey(c, "recorded_at") ||
                                hasKey(c, "notes") ||
                                (revoked && hasKey(c, "revoke_reason"))
                              }
                            >
                              <div class="mt-3 space-y-1 border-t border-dashed border-gray-200 dark:border-gray-700 pt-2 text-xs text-gray-500 dark:text-gray-400">
                                <Show when={hasKey(c, "recorded_by") || hasKey(c, "recorded_at")}>
                                  <p>
                                    Recorded{" "}
                                    <Show when={hasKey(c, "recorded_by")}>
                                      by {c.recorded_by ?? "—"}{" "}
                                    </Show>
                                    <Show when={hasKey(c, "recorded_at")}>
                                      on {day(c.recorded_at)}
                                    </Show>
                                  </p>
                                </Show>
                                <Show when={hasKey(c, "notes")}>
                                  <p class="whitespace-pre-line text-gray-600 dark:text-gray-300">
                                    {c.notes || "—"}
                                  </p>
                                </Show>
                                <Show when={revoked && hasKey(c, "revoke_reason")}>
                                  <p class="text-red-600 dark:text-red-400">
                                    Revoke reason: {c.revoke_reason || "—"}
                                  </p>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </Section>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
