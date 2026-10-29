import { createSignal, createResource, createEffect, createMemo, createUniqueId, on, onCleanup, For, Show } from "solid-js";
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
import { Pencil, Trash2, Clapperboard, Image, UserRound, Ban, Users } from "lucide-solid";
import Avatar from "../../components/common/Avatar";

// ─── Totals card: white, soft blurred waves along the bottom, tinted icon chip,
// and the animated border trace (.tile-trace) from the Campaign Analysis tiles.
// from → to runs left → right across the silk; wash tints the top-left corner.
const WAVE_TONES = {
  blue: { trace: "#3B6FE0", chip: "bg-[#E6EEFC] text-[#2F5FCC] dark:bg-blue-900/40 dark:text-blue-300", from: "#F6CBD1", to: "#E3899A", wash: "#F7D9DE" },
  green: { trace: "#1E9A5C", chip: "bg-[#DDF3E6] text-[#17804B] dark:bg-emerald-900/40 dark:text-emerald-300", from: "#A9D6B6", to: "#D6AE7A", wash: "#E7F2EA" },
  gold: { trace: "#E0A030", chip: "bg-[#FCEBCB] text-[#C4801A] dark:bg-amber-900/40 dark:text-amber-300", from: "#F8D9B2", to: "#EEA25A", wash: "#FBEBD8" },
  red: { trace: "#D92D45", chip: "bg-[#FBDDE2] text-[#C8243B] dark:bg-red-900/40 dark:text-red-300", from: "#F5C9CF", to: "#E06A7C", wash: "#F9E0E4" },
};

function WaveTile(props) {
  const t = () => WAVE_TONES[props.tone] ?? WAVE_TONES.blue;
  const Icon = props.icon;
  const id = createUniqueId();
  return (
    <div class="relative rounded-xl border border-[#ECEFF4] dark:border-gray-700 bg-white dark:bg-gray-900 px-5 pt-4 pb-7 shadow-[0_2px_10px_rgba(20,35,58,0.06)] hover:shadow-[0_8px_22px_rgba(20,35,58,0.10)] transition-shadow"
      style={{ "--tile-accent": t().trace }}>
      <span class="tile-trace" aria-hidden="true" />
      {/* Silk lives in its own clipped layer so the trace on the border isn't clipped. */}
      <span class="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] dark:opacity-40" aria-hidden="true"
        style={{ background: `radial-gradient(90% 80% at 0% 0%, ${t().wash}38 0%, transparent 60%)` }}>
        {/* opacity keeps the silk a faint backdrop behind the numbers. 12% wider
            than the card so the drifting layers never show an edge. */}
        <svg class="absolute top-0 -left-[6%] h-full w-[112%]" viewBox="0 0 400 160" preserveAspectRatio="none" style={{ filter: "blur(0.6px)", opacity: 0.3 }}>
          <defs>
            <linearGradient id={`${id}-g1`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color={t().from} stop-opacity="0.15" />
              <stop offset="0.4" stop-color={t().from} stop-opacity="0.75" />
              <stop offset="0.7" stop-color={t().to} stop-opacity="0.35" />
              <stop offset="1" stop-color={t().to} stop-opacity="0.8" />
            </linearGradient>
            <linearGradient id={`${id}-g2`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color={t().from} stop-opacity="0.05" />
              <stop offset="0.5" stop-color={t().to} stop-opacity="0.25" />
              <stop offset="1" stop-color={t().to} stop-opacity="0.6" />
            </linearGradient>
            <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#fff" stop-opacity="0" />
              <stop offset="1" stop-color="#fff" stop-opacity="0.55" />
            </linearGradient>
          </defs>
          {/* Each layer drifts on its own slow loop (silk-* in index.css). */}
          {/* back hill — the soft mound in the middle */}
          <g class="silk-drift-rev">
            <path d="M40 160 C 100 140, 130 98, 175 94 C 215 90, 240 128, 300 160 Z" fill={`url(#${id}-g1)`} opacity="0.55" />
          </g>
          {/* main silk ribbon, rising again to the bottom-right corner, with its sheen */}
          <g class="silk-drift">
            <path d="M0 160 L0 152 C 60 150, 105 112, 155 104 C 205 96, 232 136, 285 146 C 335 155, 372 126, 400 108 L400 160 Z" fill={`url(#${id}-g1)`} />
            <path d="M30 160 C 95 146, 128 110, 160 103 C 196 96, 226 126, 268 142" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="1.6" />
          </g>
          {/* front fold, lighter, swelling gently */}
          <g class="silk-swell">
            <path d="M0 160 C 90 158, 150 138, 210 142 C 270 146, 330 152, 400 130 L400 160 Z" fill={`url(#${id}-g2)`} />
            <path d="M120 160 C 170 150, 200 122, 228 120 C 258 118, 290 150, 330 158" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="1.2" />
            <path d="M250 160 C 300 152, 350 134, 400 116" fill="none" stroke="#fff" stroke-opacity="0.65" stroke-width="1.4" />
          </g>
          <rect x="0" y="0" width="400" height="160" fill={`url(#${id}-fade)`} opacity="0.35" />
        </svg>
      </span>
      <div class="relative flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-[15px] font-medium text-gray-700 dark:text-gray-200">{props.label}</p>
          <p class="mt-1 text-3xl font-bold tabular-nums text-[#14233A] dark:text-white">{props.value}</p>
        </div>
        <span class={`flex h-12 w-12 flex-none items-center justify-center rounded-xl ${t().chip}`}>
          <Icon size={22} stroke-width={1.8} />
        </span>
      </div>
    </div>
  );
}

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

  // Totals follow the filters — they count the rows in the table below.
  const activeCount = () => list().filter((c) => c.is_active !== false).length;
  const clientCount = () => new Set(list().map((c) => c.client_nomen).filter(Boolean)).size;
  const fmtCount = (n) => n.toLocaleString("en-IN");

  return (
    <PageShell
      icon={Clapperboard}
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
      {/* ══ Totals ══ */}
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Show when={!rows.loading || list().length} fallback={
          <For each={[1, 2, 3, 4]}>{() => <div class="h-[110px] rounded-xl bg-white dark:bg-gray-900 border border-[#E2E8F1] dark:border-gray-700 animate-pulse" />}</For>
        }>
          <WaveTile label="Creatives" icon={Image} tone="blue" value={fmtCount(list().length)} />
          <WaveTile label="Active" icon={UserRound} tone="green" value={fmtCount(activeCount())} />
          <WaveTile label="Inactive" icon={Ban} tone="gold" value={fmtCount(list().length - activeCount())} />
          <WaveTile label="Clients" icon={Users} tone="red" value={fmtCount(clientCount())} />
        </Show>
      </div>

      {/* ══ Filters ══ */}
      <div class="mb-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
          { label: "S.No.", class: "w-px !pr-1" },
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
          {(c, i) => (
            <tr class={ROW + " group cursor-pointer"} onClick={() => navigate(`/creatives/${c.id}`)}>
              {/* Position in the filtered list, 1-based. */}
              {/* w-px + tight right padding: the column hugs its number. */}
              <td class="w-px !pr-1 whitespace-nowrap tabular-nums text-[#8593A8] dark:text-gray-400">{i() + 1}</td>
              {/* Pinned left so the code and its Copy button never scroll off. */}
              <td class={STICKY_TD}>
                <CodeCell code={c.code} />
              </td>
              <td class="max-w-[18rem]">
                <div class="flex items-center gap-2.5 min-w-0">
                  <Avatar name={c.title || c.code} />
                  <span class="font-medium truncate" title={c.title ?? ""}>{c.title || "—"}</span>
                </div>
              </td>
              <td class="whitespace-nowrap">{kindLabel(c.kind)}</td>
              {/* Nomens run long and unbroken (e.g. KamleshKumarMeena…RealEstateLlp):
                  cut at a fixed width, full name on hover. */}
              <td>
                <div class="flex items-center gap-2.5 max-w-[14rem]">
                  <Show when={c.client_nomen} fallback="—">
                    <Avatar name={c.client_nomen} size="w-7 h-7" textSize="text-[10px]" />
                    <span class="truncate" title={c.client_nomen}>{c.client_nomen}</span>
                  </Show>
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
