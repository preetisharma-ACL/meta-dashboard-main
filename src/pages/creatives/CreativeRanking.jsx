import { createSignal, createResource, createEffect, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  fetchRanking,
  distinctProjects,
  kindLabel,
  fmtMoney,
  fmtCpl,
  fmtInt,
} from "../../services/creatives";
import { errorMessage } from "../../utils/apiErrors";
import {
  PageShell,
  ErrorBox,
  LABEL,
  KindSelect,
  NomenPicker,
  ProjectFilter,
  DatePresets,
  defaultRange,
  DataTable,
  CodeCell,
  SectionTitle,
  ROW,
  NUM,
} from "../../components/creatives/CreativeUI";

// ─── Creative Ranking (/creatives/ranking) ────────────────────────────────────
// Library creatives ranked over a date range, joined to Meta ad insights by the
// code at the start of the ad name. Creatives under min_leads (5) are listed
// separately rather than ranked — a 1-lead creative at ₹40 CPL is noise, not a
// winner. Unknown codes are codes found in ad names that the library has never
// issued, usually a typo by whoever named the ad.

const COLS = [
  { label: "Rank" },
  { label: "Code" },
  { label: "Title" },
  { label: "Type" },
  { label: "Client (made for)" },
  { label: "Project" },
  { label: "Leads", align: "right" },
  { label: "Spend", align: "right" },
  { label: "CPL", align: "right" },
  { label: "Ads", align: "right" },
  { label: "Clients running", align: "right" },
];

export default function CreativeRanking() {
  const navigate = useNavigate();
  const [range, setRange] = createSignal(defaultRange());
  const [kind, setKind] = createSignal("");
  const [nomen, setNomen] = createSignal(null);
  const [projectId, setProjectId] = createSignal("");

  const params = () => ({
    start: range().start,
    end: range().end,
    kind: kind(),
    nomen_id: nomen()?.id,
    project_id: projectId(),
  });

  // Tag each response with the project filter it was fetched under, so the
  // dropdown below knows whether it is looking at a full or a narrowed list.
  const [data] = createResource(params, async (p) => {
    const res = await fetchRanking(p);
    return res ? { ...res, _forProject: p.project_id || "" } : res;
  });
  const d = () => (data.error ? null : data());

  // Project dropdown = distinct project_id / project of the ranked and
  // not-enough-data rows. Never /options/projects/?all=1 (every project in the
  // system). Taken only from a response fetched WITHOUT a project filter:
  // a filtered response holds just the picked project, and rebuilding from it
  // would shrink the dropdown to that one option. While a project is picked the
  // options stay as last seen; changing the client clears the pick anyway.
  const [projects, setProjects] = createSignal([]);
  createEffect(() => {
    const x = d();
    if (!x || x._forProject) return;
    setProjects(distinctProjects([...(x.ranked ?? []), ...(x.not_enough_data ?? [])]));
  });
  const minLeads = () => d()?.min_leads ?? 5;

  const Row = (props) => {
    const r = props.r;
    return (
      <tr class={ROW + " cursor-pointer"} onClick={() => r.id && navigate(`/creatives/${r.id}`)}>
        <Show when={props.ranked}>
          <td class="font-bold text-[#AC2334] tabular-nums">#{r.rank}</td>
        </Show>
        <td>
          <CodeCell code={r.code} />
        </td>
        <td class="font-medium max-w-[16rem]">{r.title || "—"}</td>
        <td class="whitespace-nowrap">{kindLabel(r.kind)}</td>
        <td class="whitespace-nowrap">{r.client_nomen ?? "—"}</td>
        <td class="whitespace-nowrap">{r.project ?? "—"}</td>
        <td class={NUM + " font-semibold"}>{fmtInt(r.leads)}</td>
        <td class={NUM}>{fmtMoney(r.spend)}</td>
        <td class={NUM}>{fmtCpl(r.cpl)}</td>
        <td class={NUM}>{fmtInt(r.ads)}</td>
        <td class={NUM}>{fmtInt(r.clients)}</td>
      </tr>
    );
  };

  return (
    <PageShell
      title="Creative Ranking"
      subtitle="Which creatives bring leads, and at what cost. Raw Meta spend."
    >
      <div class="mb-5 flex flex-col xl:flex-row xl:items-end gap-3">
        <DatePresets value={range()} onChange={setRange} />
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
          <div>
            <label class={LABEL}>Type</label>
            <KindSelect allowAll value={kind()} onChange={setKind} />
          </div>
          <div>
            <label class={LABEL}>Client</label>
            <NomenPicker
              clearable
              placeholder="All clients"
              value={nomen()}
              onChange={(v) => {
                setNomen(v);
                setProjectId("");
              }}
            />
          </div>
          <div>
            <label class={LABEL}>Project</label>
            <ProjectFilter
              options={projects()}
              loading={data.loading}
              value={projectId()}
              onChange={setProjectId}
            />
          </div>
        </div>
      </div>

      <ErrorBox message={data.error ? errorMessage(data.error, "Could not load the ranking.") : ""} />

      <Show when={d()}>
        <p class="mb-3 text-sm text-[#54657E] dark:text-gray-400">
          {d().start} to {d().end}
        </p>
      </Show>

      <DataTable
        cols={COLS}
        loading={data.loading}
        empty={!(d()?.ranked ?? []).length}
        emptyText={`No creative has ${minLeads()}+ leads in this range.`}
      >
        <For each={d()?.ranked ?? []}>{(r) => <Row r={r} ranked />}</For>
      </DataTable>

      <Show when={!data.loading && d()}>
        <SectionTitle note="Ranked once they reach the minimum.">
          Not enough data yet (under {minLeads()} leads)
        </SectionTitle>
        <DataTable
          cols={COLS.slice(1)}
          empty={!(d().not_enough_data ?? []).length}
          emptyText="None."
        >
          <For each={d().not_enough_data ?? []}>{(r) => <Row r={r} />}</For>
        </DataTable>

        <Show when={Number(d().no_activity_count) > 0}>
          <p class="mt-4 text-sm font-semibold text-[#54657E] dark:text-gray-300">
            {fmtInt(d().no_activity_count)} active creative
            {Number(d().no_activity_count) === 1 ? "" : "s"} with no activity
          </p>
        </Show>

        <UnknownCodesPanel codes={d().unknown_codes ?? []} />
      </Show>
    </PageShell>
  );
}

// unknown_codes rows here are per-code aggregates:
// {code, leads, spend, cpl, ads, clients, campaigns}.
export function UnknownCodesPanel(props) {
  return (
    <div class="mt-8 rounded-xl border border-[#D89A2B]/40 bg-[#FDF6E9] dark:bg-yellow-900/10 dark:border-yellow-800 p-5">
      <h2 class="text-base font-bold text-[#7A5410] dark:text-yellow-200">Unknown codes</h2>
      <p class="mb-3 text-sm text-[#7A5410]/80 dark:text-yellow-200/80">
        Codes used in Meta ad names but not in the library, usually a typo.
      </p>
      <DataTable
        cols={[
          { label: "Code" },
          { label: "Leads", align: "right" },
          { label: "Spend", align: "right" },
          { label: "CPL", align: "right" },
          { label: "Ads", align: "right" },
          { label: "Clients", align: "right" },
          { label: "Campaigns", align: "right" },
        ]}
        empty={!props.codes.length}
        emptyText="None in this range."
      >
        <For each={props.codes}>
          {(u) => (
            <tr class={ROW}>
              <td class="font-mono font-semibold whitespace-nowrap text-[#7A5410] dark:text-yellow-200">
                {u.code ?? "—"}
              </td>
              <td class={NUM + " font-semibold"}>{fmtInt(u.leads)}</td>
              <td class={NUM}>{fmtMoney(u.spend)}</td>
              <td class={NUM}>{fmtCpl(u.cpl)}</td>
              <td class={NUM}>{fmtInt(u.ads)}</td>
              <td class={NUM}>{fmtInt(u.clients)}</td>
              <td class={NUM}>{fmtInt(u.campaigns)}</td>
            </tr>
          )}
        </For>
      </DataTable>
    </div>
  );
}
