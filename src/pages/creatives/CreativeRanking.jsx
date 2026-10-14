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
import { loadErrorMessage } from "../../utils/apiErrors";
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
  STICKY_TH,
  STICKY_TD,
  createTableSort,
  sortRows,
} from "../../components/creatives/CreativeUI";

// ─── Creative Ranking (/creatives/ranking) ────────────────────────────────────
// Library creatives ranked over a date range, joined to Meta ad insights by the
// code at the start of the ad name. Creatives under min_leads (5) are listed
// separately rather than ranked — a 1-lead creative at ₹40 CPL is noise, not a
// winner. Unknown codes are codes found in ad names that the library has never
// issued, usually a typo by whoever named the ad.

// Rank and Code stay pinned while the table scrolls sideways. Rank has a FIXED
// width so Code can sit at a matching offset (w-20 ↔ left-20); without Rank
// (the not-enough-data table) Code pins at left-0.
const RANK_W = "w-20 min-w-[5rem] max-w-[5rem]";
const RANK_TH = `${STICKY_TH} ${RANK_W}`;
const RANK_TD = `${STICKY_TD} ${RANK_W}`;
const CODE_AFTER_RANK_TH = STICKY_TH.replace("left-0", "left-20");
const CODE_AFTER_RANK_TD = STICKY_TD.replace("left-0", "left-20");

// Rank is not sortable: it is the API's rank (leads, then CPL) and is shown
// unchanged whatever the sort, so "#3" still means third by leads.
const COLS = [
  { label: "Rank", sticky: true, stickyClass: RANK_TH },
  { label: "Code", key: "code", sticky: true, stickyClass: CODE_AFTER_RANK_TH },
  { label: "Title", key: "title" },
  { label: "Type", key: "kind" },
  { label: "Client (made for)", key: "client_nomen" },
  { label: "Project", key: "project" },
  { label: "Leads", key: "leads", align: "right" },
  { label: "Spend", key: "spend", align: "right" },
  { label: "CPL", key: "cpl", align: "right" },
  { label: "Ads", key: "ads", align: "right" },
  { label: "Clients running", key: "clients", align: "right" },
];
const UNRANKED_COLS = [
  { ...COLS[1], stickyClass: undefined },
  ...COLS.slice(2),
];

// Type sorts by the label on screen, not the raw enum.
const SORT_GET = { kind: (r) => kindLabel(r.kind) };

// Default = Leads high → low, today's order: the API sends rows by leads then
// CPL, and the sort is stable, so equal-lead rows keep that CPL tiebreak.
// A new text column opens A→Z, a new number column high→low; re-clicking flips.
const TEXT_KEYS = new Set(["code", "title", "kind", "client_nomen", "project"]);
const leadsFirst = () => {
  const [sort, , setSort] = createTableSort();
  setSort({ key: "leads", dir: "desc" });
  const onSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: TEXT_KEYS.has(key) ? "asc" : "desc" },
    );
  return [sort, onSort];
};

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
  const [data, { refetch }] = createResource(params, async (p) => {
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

  // One sort per table, held HERE rather than in the tables: the lower tables
  // unmount while a new range loads, and the choice must survive that — it is
  // kept across date-range and filter changes.
  const [rankedSort, onRankedSort] = leadsFirst();
  const [unrankedSort, onUnrankedSort] = leadsFirst();
  const [unknownSort, onUnknownSort] = leadsFirst();
  const ranked = () => sortRows(d()?.ranked ?? [], rankedSort(), SORT_GET);
  const unranked = () => sortRows(d()?.not_enough_data ?? [], unrankedSort(), SORT_GET);

  // Long names truncate, full name on hover — keeps sideways scrolling down.
  const Clip = (props) => (
    <td class="max-w-[12rem]">
      <span class="block truncate" title={props.text ?? ""}>
        {props.text ?? "—"}
      </span>
    </td>
  );

  const Row = (props) => {
    const r = props.r;
    return (
      <tr class={ROW + " group cursor-pointer"} onClick={() => r.id && navigate(`/creatives/${r.id}`)}>
        <Show when={props.ranked}>
          <td class={`${RANK_TD} font-bold text-[#AC2334] dark:text-red-300 tabular-nums`}>#{r.rank}</td>
        </Show>
        <td class={props.ranked ? CODE_AFTER_RANK_TD : STICKY_TD}>
          <CodeCell code={r.code} />
        </td>
        <td class="font-medium max-w-[16rem]">{r.title || "—"}</td>
        <td class="whitespace-nowrap">{kindLabel(r.kind)}</td>
        <Clip text={r.client_nomen} />
        <Clip text={r.project} />
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

      <ErrorBox
        message={data.error ? `Could not load the ranking. ${loadErrorMessage(data.error)}` : ""}
        onRetry={refetch}
      />

      <Show when={d()}>
        <p class="mb-3 text-sm text-[#54657E] dark:text-gray-400">
          {d().start} to {d().end}
        </p>
      </Show>

      <DataTable
        cols={COLS}
        loading={data.loading}
        empty={!data.error && !ranked().length}
        emptyText={`No creative has ${minLeads()}+ leads in this range.`}
        sort={rankedSort()}
        onSort={onRankedSort}
      >
        <For each={ranked()}>{(r) => <Row r={r} ranked />}</For>
      </DataTable>

      <Show when={!data.loading && d()}>
        <SectionTitle note="Ranked once they reach the minimum.">
          Not enough data yet (under {minLeads()} leads)
        </SectionTitle>
        <DataTable
          cols={UNRANKED_COLS}
          empty={!unranked().length}
          emptyText="None."
          sort={unrankedSort()}
          onSort={onUnrankedSort}
        >
          <For each={unranked()}>{(r) => <Row r={r} />}</For>
        </DataTable>

        <Show when={Number(d().no_activity_count) > 0}>
          <p class="mt-4 text-sm font-semibold text-[#54657E] dark:text-gray-300">
            {fmtInt(d().no_activity_count)} active creative
            {Number(d().no_activity_count) === 1 ? "" : "s"} with no activity
          </p>
        </Show>

        <UnknownCodesPanel
          codes={d().unknown_codes ?? []}
          sort={unknownSort()}
          onSort={onUnknownSort}
        />
      </Show>
    </PageShell>
  );
}

// unknown_codes rows here are per-code aggregates:
// {code, leads, spend, cpl, ads, clients, campaigns}.
// Sort state comes from the caller (it must outlive this panel, which unmounts
// while a new range loads); unsorted when none is passed.
export function UnknownCodesPanel(props) {
  const rows = () => sortRows(props.codes, props.sort);
  return (
    <div class="mt-8 rounded-xl border border-[#D89A2B]/40 bg-[#FDF6E9] dark:bg-yellow-900/10 dark:border-yellow-800 p-5">
      <h2 class="text-base font-bold text-[#7A5410] dark:text-yellow-200">Unknown codes</h2>
      <p class="mb-3 text-sm text-[#7A5410]/80 dark:text-yellow-200/80">
        Codes used in Meta ad names but not in the library, usually a typo.
      </p>
      <DataTable
        cols={[
          { label: "Code", key: "code" },
          { label: "Leads", key: "leads", align: "right" },
          { label: "Spend", key: "spend", align: "right" },
          { label: "CPL", key: "cpl", align: "right" },
          { label: "Ads", key: "ads", align: "right" },
          { label: "Clients", key: "clients", align: "right" },
          { label: "Campaigns", key: "campaigns", align: "right" },
        ]}
        empty={!props.codes.length}
        emptyText="None in this range."
        sort={props.sort}
        onSort={props.onSort}
      >
        <For each={rows()}>
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
