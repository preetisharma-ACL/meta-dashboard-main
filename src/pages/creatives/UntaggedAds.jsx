import { createSignal, createResource, For, Show } from "solid-js";
import {
  fetchUntagged,
  isCMRole,
  fmtMoney,
  fmtInt,
} from "../../services/creatives";
import { errorMessage } from "../../utils/apiErrors";
import {
  PageShell,
  ErrorBox,
  LABEL,
  NomenPicker,
  DatePresets,
  defaultRange,
  DataTable,
  SectionTitle,
  ROW,
  NUM,
} from "../../components/creatives/CreativeUI";

// ─── Untagged Ads (/creatives/untagged) ───────────────────────────────────────
// The audit side of the library: ads whose name carries no creative code, and
// ads whose code the library never issued. Both are spend the ranking can't see.
// Tag coverage = spend on coded ads / all ad spend over the range.
//
// Admin, CM and coordination only. "Only my clients" (mine=1) is offered to CMs.

const COLS = [
  { label: "Ad name" },
  { label: "Client" },
  { label: "Campaign" },
  { label: "Ad account" },
  { label: "Spend", align: "right" },
  { label: "Leads", align: "right" },
];

export default function UntaggedAds() {
  const [range, setRange] = createSignal(defaultRange());
  const [nomen, setNomen] = createSignal(null);
  const [mine, setMine] = createSignal(isCMRole());

  const params = () => ({
    start: range().start,
    end: range().end,
    nomen_id: nomen()?.id,
    mine: isCMRole() && mine() ? 1 : "",
  });

  const [data] = createResource(params, (p) => fetchUntagged(p));
  const d = () => (data.error ? null : data());

  const coverage = () => {
    const v = d()?.tag_coverage_pct;
    if (v == null || v === "") return "—";
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
  };

  const AdRow = (props) => {
    const r = props.r;
    return (
      <tr class={ROW}>
        <td class="font-medium max-w-[24rem] break-words">{r.ad_name ?? "—"}</td>
        <td class="whitespace-nowrap">{r.client_nomen ?? "—"}</td>
        <td class="max-w-[18rem]">{r.campaign ?? "—"}</td>
        <td class="whitespace-nowrap">{r.ad_account ?? "—"}</td>
        <td class={NUM}>{fmtMoney(r.spend)}</td>
        <td class={NUM}>{fmtInt(r.leads)}</td>
      </tr>
    );
  };

  return (
    <PageShell
      title="Untagged Ads"
      subtitle="Ads with no creative code, or a code the library doesn't know. Their results can't be credited to a creative."
    >
      <div class="mb-5 flex flex-col lg:flex-row lg:items-end gap-3">
        <DatePresets value={range()} onChange={setRange} />
        <div class="w-full lg:max-w-xs">
          <label class={LABEL}>Client</label>
          <NomenPicker clearable placeholder="All clients" value={nomen()} onChange={setNomen} />
        </div>
        <Show when={isCMRole()}>
          <label class="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-[#54657E] dark:text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              class="w-4 h-4 accent-[#AC2334] cursor-pointer"
              checked={mine()}
              onChange={(e) => setMine(e.target.checked)}
            />
            Only my clients
          </label>
        </Show>
      </div>

      <ErrorBox message={data.error ? errorMessage(data.error, "Could not load untagged ads.") : ""} />

      <div class="mb-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-5">
          <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Tag coverage
          </p>
          <p class="text-4xl font-bold mt-1.5 tracking-tight text-[#AC2334] tabular-nums">
            {data.loading ? "…" : coverage()}
          </p>
          <p class="mt-1 text-xs text-[#8593A8]">Spend on coded ads / all ad spend</p>
        </div>
        <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-5">
          <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Ads with no code
          </p>
          <p class="text-2xl font-bold mt-1.5 tabular-nums text-[#14233A] dark:text-white">
            {data.loading ? "…" : fmtInt(d()?.untagged_count)}
          </p>
        </div>
        <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-5">
          <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Ads with an unknown code
          </p>
          <p class="text-2xl font-bold mt-1.5 tabular-nums text-[#14233A] dark:text-white">
            {data.loading ? "…" : fmtInt(d()?.unknown_code_count)}
          </p>
        </div>
      </div>

      <SectionTitle>Ads with no code</SectionTitle>
      <DataTable
        cols={COLS}
        loading={data.loading}
        empty={!(d()?.untagged ?? []).length}
        emptyText="Every ad in this range carries a code."
      >
        <For each={d()?.untagged ?? []}>{(r) => <AdRow r={r} />}</For>
      </DataTable>

      <SectionTitle note="Codes used in Meta ad names but not in the library, usually a typo.">
        Ads with an unknown code
      </SectionTitle>
      <DataTable
        cols={[{ label: "Code" }, ...COLS]}
        loading={data.loading}
        empty={!(d()?.unknown_codes ?? []).length}
        emptyText="No unknown codes in this range."
      >
        <For each={(d()?.unknown_codes ?? [])}>
          {(r) => (
            <tr class={ROW}>
              <td class="font-mono font-semibold whitespace-nowrap text-[#7A5410] dark:text-yellow-200">
                {r.code ?? "—"}
              </td>
              <td class="font-medium max-w-[24rem] break-words">{r.ad_name ?? "—"}</td>
              <td class="whitespace-nowrap">{r.client_nomen ?? "—"}</td>
              <td class="max-w-[18rem]">{r.campaign ?? "—"}</td>
              <td class="whitespace-nowrap">{r.ad_account ?? "—"}</td>
              <td class={NUM}>{fmtMoney(r.spend)}</td>
              <td class={NUM}>{fmtInt(r.leads)}</td>
            </tr>
          )}
        </For>
      </DataTable>
    </PageShell>
  );
}
