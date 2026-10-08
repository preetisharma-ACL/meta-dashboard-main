import { createSignal, createResource, createEffect, on, onCleanup, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  fetchCreatives,
  canWriteCreatives,
  kindLabel,
  fmtDate,
} from "../../services/creatives";
import { errorMessage } from "../../utils/apiErrors";
import CreativeModal from "../../components/creatives/CreativeModal";
import {
  PageShell,
  ErrorBox,
  FIELD,
  LABEL,
  PRIMARY_BTN,
  KindSelect,
  NomenPicker,
  ProjectSelect,
  DataTable,
  CodeCell,
  StatusPill,
  OneDriveLink,
  ROW,
} from "../../components/creatives/CreativeUI";

// ─── Creative Library (/creatives) ────────────────────────────────────────────
// Every creative and its code. Filters go to the server (kind, nomen_id,
// project_id, active, q). Row opens the detail page. "Add creative" is admin +
// creative only; everyone else who can reach this screen reads it.

// created_by is an id elsewhere in this API; prefer the name field, then a
// nested object's name, and never print a bare id or "[object Object]".
const personName = (c) =>
  c.created_by_name ??
  (typeof c.created_by === "object" ? c.created_by?.name : null) ??
  (typeof c.created_by === "string" ? c.created_by : null) ??
  "—";

export default function CreativeLibrary() {
  const navigate = useNavigate();
  const [kind, setKind] = createSignal("");
  const [nomen, setNomen] = createSignal(null);
  const [projectId, setProjectId] = createSignal("");
  const [active, setActive] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [q, setQ] = createSignal("");
  const [modalOpen, setModalOpen] = createSignal(false);

  let timer;
  createEffect(
    on(search, (s) => {
      clearTimeout(timer);
      timer = setTimeout(() => setQ(s.trim()), 300);
    }),
  );
  onCleanup(() => clearTimeout(timer));

  const params = () => ({
    kind: kind(),
    nomen_id: nomen()?.id,
    project_id: projectId(),
    active: active(),
    q: q(),
  });

  const [rows, { refetch }] = createResource(params, (p) => fetchCreatives(p));

  const list = () => (rows.error ? [] : rows() ?? []);

  return (
    <PageShell
      title="Creative Library"
      subtitle="Every creative and its code. CMs start the Meta ad name with the code so its results can be tracked."
      actions={
        <Show when={canWriteCreatives()}>
          <button type="button" class={PRIMARY_BTN} onClick={() => setModalOpen(true)}>
            + Add creative
          </button>
        </Show>
      }
    >
      <div class="mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
          <ProjectSelect
            nomenId={nomen()?.id}
            showAll
            allLabel="All projects"
            value={projectId()}
            onChange={setProjectId}
          />
        </div>
        <div>
          <label class={LABEL}>Status</label>
          <select class={FIELD} value={active()} onChange={(e) => setActive(e.target.value)}>
            <option value="">All</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </div>
        <div>
          <label class={LABEL}>Search</label>
          <input
            class={FIELD}
            placeholder="Code, title, client, project"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <ErrorBox message={rows.error ? errorMessage(rows.error, "Could not load creatives.") : ""} />

      <DataTable
        loading={rows.loading && !list().length}
        empty={!list().length}
        emptyText="No creatives match these filters."
        cols={[
          { label: "Code" },
          { label: "Title" },
          { label: "Type" },
          { label: "Client" },
          { label: "Project" },
          { label: "OneDrive" },
          { label: "Status" },
          { label: "Created by" },
          { label: "Created at" },
        ]}
      >
        <For each={list()}>
          {(c) => (
            <tr class={ROW + " cursor-pointer"} onClick={() => navigate(`/creatives/${c.id}`)}>
              <td>
                <CodeCell code={c.code} />
              </td>
              <td class="font-medium max-w-[18rem]">{c.title || "—"}</td>
              <td class="whitespace-nowrap">{kindLabel(c.kind)}</td>
              <td class="whitespace-nowrap">{c.client_nomen ?? c.nomen_name ?? "—"}</td>
              <td class="whitespace-nowrap">{c.project ?? c.project_name ?? "—"}</td>
              <td>
                <OneDriveLink url={c.onedrive_url} />
              </td>
              <td>
                <StatusPill active={c.is_active !== false} />
              </td>
              <td class="whitespace-nowrap text-[#54657E] dark:text-gray-400">
                {personName(c)}
              </td>
              <td class="whitespace-nowrap text-[#54657E] dark:text-gray-400">
                {fmtDate(c.created_at)}
              </td>
            </tr>
          )}
        </For>
      </DataTable>

      <CreativeModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        onSaved={() => refetch()}
      />
    </PageShell>
  );
}
