import { createSignal, createResource, createEffect, createMemo, on, onCleanup, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { FileText, Copy, Trash2 } from "lucide-solid";
import {
  fetchProposals,
  fetchProposalMeta,
  duplicateProposal,
  deleteProposal,
  fmtWhen,
  nameOf,
  optionsOf,
} from "../../services/proposals";
import { loadErrorMessage, errorMessage } from "../../utils/apiErrors";
import { PageShell, ErrorBox, DataTable, ROW, NUM } from "../../components/creatives/CreativeUI";
import { ConfirmedBadge, ConfirmDialog, FIELD, LABEL, PRIMARY_BTN, GHOST_BTN } from "../../components/proposals/ProposalUI";
import NewProposalDialog from "../../components/proposals/NewProposalDialog";

// ─── Proposals (/proposals) ───────────────────────────────────────────────────
// Sales see their own, admin sees everyone's (the server decides; nothing is
// filtered here). Search (q) and the admin salesperson filter (by) go to the
// server; paging comes back in meta.pagination.

const ICON_BTN =
  "inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors disabled:opacity-40";

export default function ProposalsList() {
  const navigate = useNavigate();
  const [meta, { mutate: setMeta, refetch: refetchMeta }] = createResource(fetchProposalMeta);
  const isAdmin = () => !!(meta.error ? null : meta())?.is_admin;
  const metaVal = () => (meta.error ? null : meta());
  // Model labels come from meta.models (cpl → "CPL"); an unknown key shows as sent.
  const modelLabels = createMemo(() =>
    Object.fromEntries(optionsOf(metaVal()?.models).map((o) => [o.value, o.label])),
  );
  const modelLabel = (m) => modelLabels()[m] ?? m;

  const [search, setSearch] = createSignal("");
  const [q, setQ] = createSignal("");
  const [by, setBy] = createSignal("");
  const [page, setPage] = createSignal(1);
  let timer;
  createEffect(
    on(search, (s) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setQ(s.trim());
        setPage(1);
      }, 300);
    }, { defer: true }),
  );
  onCleanup(() => clearTimeout(timer));

  const [res, { refetch }] = createResource(
    () => ({ q: q(), by: by(), page: page() }),
    (p) => fetchProposals(p),
  );
  const rows = () => (res.error ? [] : res()?.data ?? []);
  const pg = () => (res.error ? null : res()?.meta?.pagination ?? null);
  const totalPages = () => {
    const p = pg();
    if (!p) return 1;
    return p.total_pages ?? p.num_pages ?? p.pages ?? (p.page_size ? Math.max(1, Math.ceil((p.total ?? 0) / p.page_size)) : 1);
  };

  const [newOpen, setNewOpen] = createSignal(false);
  const [removing, setRemoving] = createSignal(null);
  const [busyId, setBusyId] = createSignal(null);
  const [actionError, setActionError] = createSignal("");

  const useAsNew = async (row) => {
    setBusyId(row.id);
    setActionError("");
    try {
      const fresh = await duplicateProposal(row.id);
      if (fresh?.id) navigate(`/proposals/${fresh.id}`);
    } catch (err) {
      setActionError(errorMessage(err, "Could not copy the proposal."));
    } finally {
      setBusyId(null);
    }
  };

  const cols = () => [
    { label: "Number" },
    { label: "Client" },
    { label: "Project" },
    { label: "Model" },
    { label: "Total", align: "right" },
    { label: "Status" },
    ...(isAdmin() ? [{ label: "Created by" }] : []),
    { label: "Updated" },
    { label: "Actions", align: "right" },
  ];

  return (
    <PageShell
      icon={FileText}
      title="Proposals"
      subtitle="Paste a client brief, confirm the details, and download a ready PDF."
      actions={
        <button type="button" class={PRIMARY_BTN} onClick={() => setNewOpen(true)} disabled={!metaVal()}>
          + New proposal
        </button>
      }
    >
      <div class="mb-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="lg:col-span-2">
          <label class={LABEL} for="pl-search">Search</label>
          <input
            id="pl-search"
            class={FIELD}
            placeholder="Number, client or project"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
          />
        </div>
        <Show when={isAdmin()}>
          <div>
            <label class={LABEL} for="pl-by">Salesperson</label>
            <select
              id="pl-by"
              class={FIELD}
              value={by()}
              onChange={(e) => {
                setBy(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Everyone</option>
              <For each={metaVal()?.salespeople ?? []}>
                {(s) => <option value={String(s.id)}>{s.name || s.email || `#${s.id}`}</option>}
              </For>
            </select>
          </div>
        </Show>
      </div>

      <ErrorBox
        message={
          meta.error
            ? `Could not load proposal settings. ${loadErrorMessage(meta.error)}`
            : res.error
              ? `Could not load proposals. ${loadErrorMessage(res.error)}`
              : actionError()
        }
        onRetry={meta.error ? refetchMeta : res.error ? refetch : undefined}
      />

      <DataTable
        loading={res.loading && !rows().length}
        empty={!res.error && !rows().length}
        emptyText={q() || by() ? "No proposals match." : "No proposals yet. Start one with New proposal."}
        cols={cols()}
      >
        <For each={rows()}>
          {(r) => (
            <tr class={ROW + " cursor-pointer"} onClick={() => navigate(`/proposals/${r.id}`)}>
              <td class="whitespace-nowrap font-mono text-xs font-semibold">{r.number || `#${r.id}`}</td>
              <td class="max-w-[14rem] truncate" title={r.client_name ?? ""}>{r.client_name || "—"}</td>
              <td class="max-w-[14rem] truncate" title={r.project_name ?? ""}>{r.project_name || "—"}</td>
              <td class="whitespace-nowrap">{r.model ? modelLabel(r.model) : "—"}</td>
              <td class={NUM + " font-semibold"}>{r.total || "—"}</td>
              <td>
                <ConfirmedBadge confirmed={!!r.confirmed} />
              </td>
              <Show when={isAdmin()}>
                <td class="whitespace-nowrap text-[#54657E] dark:text-gray-400">{nameOf(r.created_by) || "—"}</td>
              </Show>
              <td class="whitespace-nowrap text-[#54657E] dark:text-gray-400">{fmtWhen(r.updated_at)}</td>
              <td class="!py-1" onClick={(e) => e.stopPropagation()}>
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    class={GHOST_BTN + " !px-3 !py-1.5"}
                    onClick={() => navigate(`/proposals/${r.id}`)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    title="Use as new"
                    aria-label={`Use ${r.number ?? "proposal"} as new`}
                    disabled={busyId() === r.id}
                    onClick={() => useAsNew(r)}
                    class={ICON_BTN + " border-[#3E6FB0]/25 bg-[#ECF2FA] text-[#3E6FB0] hover:bg-[#3E6FB0] hover:text-white dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300"}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    type="button"
                    title="Remove"
                    aria-label={`Remove ${r.number ?? "proposal"}`}
                    onClick={() => setRemoving(r)}
                    class={ICON_BTN + " border-[#AC2334]/25 bg-[#FBEEF0] text-[#AC2334] hover:bg-[#AC2334] hover:text-white dark:bg-red-900/20 dark:border-red-800 dark:text-red-300"}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </td>
            </tr>
          )}
        </For>
      </DataTable>

      <Show when={totalPages() > 1}>
        <div class="mt-4 flex items-center justify-end gap-2 text-sm text-[#54657E] dark:text-gray-300">
          <span class="mr-2">
            Page {page()} of {totalPages()}
            <Show when={pg()?.total != null}> · {pg().total} proposals</Show>
          </span>
          <button type="button" class={GHOST_BTN + " !py-1.5"} disabled={page() <= 1 || res.loading} onClick={() => setPage(page() - 1)}>
            Previous
          </button>
          <button type="button" class={GHOST_BTN + " !py-1.5"} disabled={page() >= totalPages() || res.loading} onClick={() => setPage(page() + 1)}>
            Next
          </button>
        </div>
      </Show>

      <NewProposalDialog
        open={newOpen()}
        meta={metaVal()}
        onMeta={(m) => setMeta(m)}
        onClose={() => setNewOpen(false)}
        onCreated={(d) => {
          setNewOpen(false);
          navigate(`/proposals/${d.id}`);
        }}
      />
      <ConfirmDialog
        open={!!removing()}
        title="Remove proposal"
        message={`Remove ${removing()?.number ?? "this proposal"}${removing()?.client_name ? ` for ${removing().client_name}` : ""} from the list?`}
        confirmLabel="Remove"
        onConfirm={async () => {
          await deleteProposal(removing().id);
          refetch();
        }}
        onClose={() => setRemoving(null)}
      />
    </PageShell>
  );
}
