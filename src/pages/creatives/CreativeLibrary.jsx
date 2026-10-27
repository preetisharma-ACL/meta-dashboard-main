import { createSignal, createResource, createEffect, createMemo, on, onCleanup, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  fetchCreatives,
  distinctProjects,
  canWriteCreatives,
  canFixCreatives,
  kindLabel,
  fmtDateTimeIST,
} from "../../services/creatives";
import { loadErrorMessage } from "../../utils/apiErrors";
import CreativeModal from "../../components/creatives/CreativeModal";
import DeleteCreativeDialog from "../../components/creatives/DeleteCreativeDialog";
import {
  PageShell,
  ErrorBox,
  FIELD,
  LABEL,
  PRIMARY_BTN,
  KindSelect,
  NomenPicker,
  ProjectFilter,
  DataTable,
  CodeCell,
  StatusPill,
  OneDriveLink,
  ROW,
  STICKY_TD,
  STICKY_RIGHT_TH,
  STICKY_RIGHT_TD,
} from "../../components/creatives/CreativeUI";
import { Pencil, Trash2 } from "lucide-solid";

// ─── Creative Library (/creatives) ────────────────────────────────────────────
// Every creative and its code. kind, nomen_id, active and q go to the server.
// PROJECT is filtered here, on the loaded rows: its dropdown is built from the
// distinct project_id / project of those same rows (no extra call), and
// filtering server-side would shrink that list to the one project picked.
// Row opens the detail page. "Add creative" is admin, coordination and creative
// (canWriteCreatives); a CM reads it. The pinned Actions column has Edit for
// writers and Delete for admin / coordination (canFixCreatives).

export default function CreativeLibrary() {
  const navigate = useNavigate();
  const [kind, setKind] = createSignal("");
  const [nomen, setNomen] = createSignal(null);
  const [projectId, setProjectId] = createSignal("");
  const [active, setActive] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [q, setQ] = createSignal("");
  const [modalOpen, setModalOpen] = createSignal(false);
  const [editing, setEditing] = createSignal(null); // row in the edit modal
  const [deleting, setDeleting] = createSignal(null); // row in the delete dialog

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
    active: active(),
    q: q(),
  });

  const [rows, { refetch, mutate }] = createResource(params, (p) => fetchCreatives(p));

  const loaded = () => (rows.error ? [] : rows() ?? []);
  const projects = createMemo(() => distinctProjects(loaded()));
  const list = () =>
    projectId()
      ? loaded().filter((c) => String(c.project_id) === String(projectId()))
      : loaded();

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
          <ProjectFilter
            options={projects()}
            loading={rows.loading}
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

      <ErrorBox
        message={rows.error ? `Could not load creatives. ${loadErrorMessage(rows.error)}` : ""}
        onRetry={refetch}
      />

      {/* A failed load is not "no creatives": the empty line waits for a real answer. */}
      <DataTable
        loading={rows.loading && !list().length}
        empty={!rows.error && !list().length}
        emptyText="No creatives match these filters."
        cols={[
          { label: "Code", sticky: true },
          { label: "Title" },
          { label: "Type" },
          { label: "Client" },
          { label: "Project" },
          { label: "OneDrive" },
          { label: "Status" },
          { label: "Created by" },
          { label: "Created at" },
          ...(canWriteCreatives()
            ? [{ label: "Actions", align: "right", sticky: true, stickyClass: STICKY_RIGHT_TH }]
            : []),
        ]}
      >
        <For each={list()}>
          {(c) => (
            <tr class={ROW + " group cursor-pointer"} onClick={() => navigate(`/creatives/${c.id}`)}>
              {/* Pinned left so the code and its Copy button never scroll off. */}
              <td class={STICKY_TD}>
                <CodeCell code={c.code} />
              </td>
              <td class="font-medium max-w-[18rem]">{c.title || "—"}</td>
              <td class="whitespace-nowrap">{kindLabel(c.kind)}</td>
              {/* Nomens run long and unbroken (e.g. KamleshKumarMeena…RealEstateLlp):
                  cut at a fixed width, full name on hover. */}
              <td>
                <div class="max-w-[12rem] truncate" title={c.client_nomen ?? ""}>
                  {c.client_nomen ?? "—"}
                </div>
              </td>
              <td class="whitespace-nowrap">{c.project ?? "—"}</td>
              <td>
                <OneDriveLink url={c.onedrive_url} />
              </td>
              <td>
                <StatusPill active={c.is_active !== false} />
              </td>
              <td class="whitespace-nowrap text-[#54657E] dark:text-gray-400">
                {c.created_by || "—"}
              </td>
              <td class="whitespace-nowrap text-[#54657E] dark:text-gray-400">
                {fmtDateTimeIST(c.created_at)}
              </td>
              <Show when={canWriteCreatives()}>
                {/* Pinned right, as icon buttons rather than a "⋯" menu, so
                    Edit / Delete are one click and never scroll off. */}
                <td class={STICKY_RIGHT_TD + " !py-1"} onClick={(e) => e.stopPropagation()}>
                  <div class="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      title="Edit creative"
                      aria-label={`Edit ${c.code ?? "creative"}`}
                      class="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[#D89A2B]/30 bg-[#FBF3E6] text-[#9A6512] hover:bg-[#D89A2B] hover:border-[#D89A2B] hover:text-white dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-600 dark:hover:text-white transition-colors"
                    >
                      <Pencil size={15} />
                    </button>
                    <Show when={canFixCreatives()}>
                      <button
                        type="button"
                        onClick={() => setDeleting(c)}
                        title="Delete creative"
                        aria-label={`Delete ${c.code ?? "creative"}`}
                        class="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[#AC2334]/25 bg-[#FBEEF0] text-[#AC2334] hover:bg-[#AC2334] hover:border-[#AC2334] hover:text-white dark:bg-red-900/20 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-700 dark:hover:text-white transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </Show>
                  </div>
                </td>
              </Show>
            </tr>
          )}
        </For>
      </DataTable>

      <CreativeModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        onSaved={() => refetch()}
      />
      <CreativeModal
        open={!!editing()}
        creative={editing()}
        onClose={() => setEditing(null)}
        onSaved={() => refetch()}
      />
      <DeleteCreativeDialog
        open={!!deleting()}
        creative={deleting()}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          const id = deleting()?.id;
          mutate((xs) => (xs ?? []).filter((x) => x.id !== id));
        }}
        onDeactivated={() => refetch()}
      />
    </PageShell>
  );
}
