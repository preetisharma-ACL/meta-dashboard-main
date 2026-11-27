import { createSignal, onMount, For, Show } from "solid-js";
import { fetchCoordinationHome } from "../../services/coordinationHome";
import { inr, count, DASH } from "../../services/commandRules";
import { istDate } from "../../services/deadClients";
import { timeAgo } from "../../services/drive";
import { loadErrorMessage } from "../../utils/apiErrors";

// ─── "Spend with no rate config" (admin, on Project Display Config) ───────────
// Rows come from GET /clients/coordination/home/ → data.billing_gaps. That
// endpoint is admin + coordination only, and only admin's payload carries
// billing_gaps (backend 26a3ce0), so the parent renders this for admin alone and
// nobody else ever calls it from here.
//
// Row: { client_id, nomen_id, client_nomen, client_type, project_id,
//        project_name, kind: "no_config"|"not_covered", has_open_config,
//        uncovered_days, uncovered_spend, first_uncovered, last_uncovered }
// Server order is kept (biggest uncovered spend first). Money is a 2-dp string.
//
// The panel never writes. Its row button hands the row to the parent:
//   onAdd(row)  → open the Add Project Config form prefilled
//   onFix(row)  → not_covered with an open config: show that config to fix dates
// The parent calls the function handed to props.registerRefresh after a save,
// which refetches with ?refresh=1 so a fixed row drops off.

const TYPE_CHIP = {
  hybrid: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
const typeLabel = (t) => (t === "cpl" ? "CPL" : t ? `${t[0].toUpperCase()}${t.slice(1)}` : DASH);
const KIND_LABEL = {
  no_config: "No config",
  not_covered: "Config does not cover these days",
};

const TH =
  "p-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap bg-gray-50 dark:bg-gray-800 sticky top-0 z-10";
const THR = TH.replace("text-left", "text-right");
const TD = "p-2.5 align-top";
const NUM = "p-2.5 align-top text-right tabular-nums whitespace-nowrap";

// A row whose config exists but doesn't cover the days is fixed by editing
// that config's dates, not by adding a second one.
export const fixesExisting = (r) => r?.kind === "not_covered" && r?.has_open_config === true;

export default function BillingGapsPanel(props) {
  const [rows, setRows] = createSignal([]);
  const [total, setTotal] = createSignal(null);
  const [generatedAt, setGeneratedAt] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [open, setOpen] = createSignal(false);
  let decided = false; // open/closed is chosen once, from the first answer

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCoordinationHome({ refresh });
      if (!Array.isArray(data.billing_gaps)) {
        throw new Error("This account's payload has no billing gaps.");
      }
      setRows(data.billing_gaps);
      setTotal(data.counts?.billing_gaps ?? data.billing_gaps.length);
      setGeneratedAt(data.generated_at ?? null);
      if (!decided) {
        decided = true;
        setOpen((data.counts?.billing_gaps ?? data.billing_gaps.length) > 0);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  onMount(() => load(false));
  props.registerRefresh?.(() => load(true));

  return (
    <div class="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
      <div class="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open())}
          aria-expanded={open()}
          class="flex items-center gap-2 text-left"
        >
          <svg
            class={`w-4 h-4 text-gray-400 transition-transform ${open() ? "rotate-90" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span class="text-sm font-bold text-[#14233A] dark:text-white">
            Spend with no rate config (last 30 days)
          </span>
          <Show when={total() != null}>
            <span
              class={`px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${
                total() > 0
                  ? "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
              }`}
            >
              {total() > 0 ? count(total()) : "All clear"}
            </span>
          </Show>
        </button>
        <div class="ml-auto flex items-center gap-3">
          <Show when={generatedAt()}>
            <span class="text-xs text-gray-400" title={generatedAt()}>
              Updated {timeAgo(generatedAt())}
            </span>
          </Show>
          <button
            type="button"
            disabled={loading()}
            onClick={() => load(true)}
            class="px-3 py-1.5 rounded-lg text-xs font-semibold ring-1 ring-gray-300 dark:ring-gray-600 text-[#14233A] dark:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
          >
            {loading() ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="mx-4 mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {loadErrorMessage(error(), "Couldn't load spend with no rate config.")}
        </div>
      </Show>

      <Show when={open() && !error()}>
        <Show
          when={rows().length}
          fallback={
            <p class="px-4 pb-4 text-xs text-gray-400">
              {loading() ? "Loading..." : "Every project that spent in the last 30 days has a rate config."}
            </p>
          }
        >
          <div class="border-t border-gray-100 dark:border-gray-800 overflow-auto max-h-[50vh]">
            <table class="min-w-full text-sm">
              <thead>
                <tr>
                  <th class={TH}>Client</th>
                  <th class={TH}>Project</th>
                  <th class={TH}>Type</th>
                  <th class={TH}>Gap</th>
                  <th class={THR}>Uncovered days</th>
                  <th class={THR}>Uncovered spend</th>
                  <th class={TH}>From – to</th>
                  <th class={TH}></th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(r) => (
                    <tr class="border-t border-gray-100 dark:border-gray-800">
                      <td class={`${TD} font-medium text-[#14233A] dark:text-gray-100`}>{r.client_nomen || DASH}</td>
                      <td class={`${TD} text-gray-700 dark:text-gray-300`}>{r.project_name || DASH}</td>
                      <td class={TD}>
                        <Show when={r.client_type} fallback={DASH}>
                          <span class={`inline-flex px-2 py-[2px] rounded-full text-[11px] font-semibold ${TYPE_CHIP[r.client_type] ?? "bg-gray-100 text-gray-600"}`}>
                            {typeLabel(r.client_type)}
                          </span>
                        </Show>
                      </td>
                      <td class={`${TD} text-gray-700 dark:text-gray-300`}>{KIND_LABEL[r.kind] ?? r.kind}</td>
                      <td class={NUM}>{count(r.uncovered_days)}</td>
                      <td class={NUM}>{inr(r.uncovered_spend)}</td>
                      <td class={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
                        {istDate(r.first_uncovered) ?? DASH} – {istDate(r.last_uncovered) ?? DASH}
                      </td>
                      <td class={`${TD} text-right`}>
                        <Show
                          when={fixesExisting(r)}
                          fallback={
                            <button
                              type="button"
                              onClick={() => props.onAdd?.(r)}
                              class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-900 text-white hover:bg-blue-800 whitespace-nowrap"
                            >
                              Add config
                            </button>
                          }
                        >
                          <button
                            type="button"
                            onClick={() => props.onFix?.(r)}
                            title="A config exists for this project but its dates don't cover these days"
                            class="px-2.5 py-1 rounded-lg text-xs font-semibold ring-1 ring-gray-300 dark:ring-gray-600 text-[#14233A] dark:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 whitespace-nowrap"
                          >
                            Fix dates
                          </button>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
    </div>
  );
}
