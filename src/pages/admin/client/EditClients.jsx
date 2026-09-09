import { createSignal, createMemo, createResource, For, Show } from "solid-js";
import RowsPerPageSelect from "../../../components/common/RowsPerPageSelect";
import SuccessToast, {
  showToast,
} from "../../../components/common/SuccessToast";
import EditClientDrawer from "../../../components/clientEdit/EditClientDrawer";
import { fetchAllAdminClients } from "../services/fetchClients";

// ─── Edit Clients ─────────────────────────────────────────────────────────────
// The other half of onboarding. The wizard at /onboarding creates a client login
// and its record in one atomic POST and then has no way to change any of it —
// /auth/onboarding/users/ answers `Allow: POST, OPTIONS` and has no detail
// route at all. This screen is where an already-onboarded client is corrected.
//
// It is a picker, not an editor: the table exists to find the right client, and
// every actual write happens in EditClientDrawer against
// PATCH /clients/admin/clients/{id}/.
//
// ADMIN ONLY, matching the endpoint. /clients/admin/clients/ 403s a campaign
// manager (see Clients.jsx, which sources CMs from the hierarchy instead) — so
// unlike the Clients screen there is no CM fallback here: there is no CM-scoped
// endpoint that can WRITE a client, and a screen whose every save 403s is worse
// than no entry in the sidebar.

const TYPE_COLORS = {
  hybrid: "bg-purple-100 text-purple-700 ring-1 ring-purple-300",
  cpl: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
  retainer: "bg-sky-100 text-sky-700 ring-1 ring-sky-300",
};

const fmtType = (t) =>
  String(t ?? "")
    .charAt(0)
    .toUpperCase() + String(t ?? "").slice(1);

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// The label the drawer shows in its header, and what the toast names after a
// save. The nomen name is what people call a client; the email is the fallback
// for a row whose nomen came back empty.
const clientLabel = (c) =>
  c?.client_nomen_name || c?.client_nomen || c?.email || `Client #${c?.id}`;

export default function EditClients() {
  const [search, setSearch] = createSignal("");
  const [typeFilter, setTypeFilter] = createSignal("all");
  const [activeFilter, setActiveFilter] = createSignal("all");
  // "all" | "none" | "<user id>"
  const [ownerFilter, setOwnerFilter] = createSignal("all");

  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(
    Number(localStorage.getItem("editClientsRowsPerPage")) || 20,
  );

  const changePageSize = (size) => {
    setPageSize(size);
    localStorage.setItem("editClientsRowsPerPage", String(size));
    setPage(1); // the old page number can be past the end once rows grow
  };

  // The whole roster in one shot — fetchAllAdminClients sweeps every page and
  // works around the backend capping page_size, so the search below covers all
  // clients rather than only the first page of them.
  const [clients, { mutate, refetch }] = createResource(async () => {
    const rows = await fetchAllAdminClients();
    return Array.isArray(rows) ? rows : [];
  });

  const [editing, setEditing] = createSignal(null);

  // ── Sales owner ────────────────────────────────────────────────────────────
  // The rows carry `onboarded_by` (id) and `onboarded_by_email` since fa8dcc4 —
  // the list and the detail route share a serializer, so the column and this
  // filter cost no extra request.
  //
  // Filtered here rather than through the endpoint's ?onboarded_by=, which was
  // added for this. The page already sweeps EVERY client into memory for the
  // search, so the rows are in hand: filtering locally is instant and composes
  // with the type and login filters, where a server round trip per change would
  // re-sweep to answer a question the data already answers. The param is the
  // right tool for a paginated screen; this one isn't.
  const ownerEmail = (c) => c?.onboarded_by_email || null;
  const ownerId = (c) => c?.onboarded_by ?? null;

  // Every owner actually present in the data, so the dropdown can only offer a
  // filter that matches something. Sorted by name; the count rides along because
  // "who holds the biggest book" is the question people bring to this list.
  const owners = createMemo(() => {
    const seen = new Map();
    for (const c of clients() ?? []) {
      const id = ownerId(c);
      if (id == null) continue;
      const key = String(id);
      const row = seen.get(key) ?? { id: key, email: ownerEmail(c) || `#${id}`, count: 0 };
      row.count += 1;
      seen.set(key, row);
    }
    return [...seen.values()].sort((a, b) => a.email.localeCompare(b.email));
  });

  const unattributedCount = createMemo(
    () => (clients() ?? []).filter((c) => ownerId(c) == null).length,
  );

  const filtered = createMemo(() => {
    const q = search().trim().toLowerCase();
    const type = typeFilter();
    const active = activeFilter();
    const owner = ownerFilter();

    return (clients() ?? []).filter((c) => {
      if (type !== "all" && String(c.client_type ?? "") !== type) return false;
      if (active === "active" && !c.is_active) return false;
      if (active === "inactive" && c.is_active) return false;
      // "none" is a real bucket, not the absence of a filter — a client owned by
      // nobody is invisible to every sales dashboard, which is the whole reason
      // this control exists.
      if (owner === "none" && ownerId(c) != null) return false;
      if (owner !== "all" && owner !== "none" && String(ownerId(c) ?? "") !== owner)
        return false;
      if (!q) return true;
      return [
        c.client_nomen_name,
        c.email,
        c.organization_name,
        c.client_nomen,
        ownerEmail(c),
        c.id,
      ]
        .filter((v) => v != null && v !== "")
        .some((v) => String(v).toLowerCase().includes(q));
    });
  });

  const total = () => filtered().length;
  const totalPages = () => Math.max(1, Math.ceil(total() / pageSize()));
  // Clamped rather than reset: a filter that shrinks the list should leave the
  // operator on the last page of what remains, not bounce them to page 1.
  const safePage = () => Math.min(page(), totalPages());
  const pageRows = createMemo(() => {
    const start = (safePage() - 1) * pageSize();
    return filtered().slice(start, start + pageSize());
  });

  // A saved client is merged into the loaded roster rather than refetched: the
  // sweep is many round-trips, and the PATCH already answered with the new row.
  // Only the columns this table shows need to agree; anything else the drawer
  // changed is re-read next time it opens that client.
  const applySaved = (saved, changedLabels) => {
    const id = editing()?.id;
    mutate((prev) =>
      (prev ?? []).map((c) =>
        String(c.id) === String(id) ? { ...c, ...saved } : c,
      ),
    );
    showToast(
      changedLabels?.length
        ? `Updated ${changedLabels.join(", ")}.`
        : "Changes saved.",
      `${clientLabel(editing())} updated`,
    );
  };

  return (
    <div class="p-6 text-[#14233A] dark:text-gray-100">
      <SuccessToast />

      {/* Header */}
      <div class="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Edit Clients
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Change a client that was already onboarded — {total()} shown
          </p>
        </div>

        <button
          onClick={() => refetch()}
          disabled={clients.loading}
          class="flex items-center gap-1.5 px-4 h-9 text-sm font-medium rounded-lg
                 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200
                 hover:bg-gray-100 dark:hover:bg-gray-700 transition disabled:opacity-50"
        >
          {clients.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Filters */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-[420px] max-w-full">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by client, email or organisation…"
            value={search()}
            onInput={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        <select
          value={typeFilter()}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
        >
          <option value="all">All Types</option>
          <option value="cpl">CPL</option>
          <option value="hybrid">Hybrid</option>
          <option value="retainer">Retainer</option>
        </select>

        <select
          value={activeFilter()}
          onChange={(e) => {
            setActiveFilter(e.target.value);
            setPage(1);
          }}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
        >
          <option value="all">All Logins</option>
          <option value="active">Active</option>
          <option value="inactive">Disabled</option>
        </select>

        {/* Unattributed is first and counted, because it is the reason this
            control exists rather than one option among many: a client with no
            sales person is invisible to every sales dashboard. */}
        <select
          value={ownerFilter()}
          onChange={(e) => {
            setOwnerFilter(e.target.value);
            setPage(1);
          }}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer max-w-[16rem]"
        >
          <option value="all">All Sales People</option>
          <option value="none">
            No sales person{unattributedCount() ? ` (${unattributedCount()})` : ""}
          </option>
          <For each={owners()}>
            {(o) => (
              <option value={o.id}>
                {o.email} ({o.count})
              </option>
            )}
          </For>
        </select>

        <button
          onClick={() => {
            setSearch("");
            setTypeFilter("all");
            setActiveFilter("all");
            setOwnerFilter("all");
            setPage(1);
          }}
          class="px-3 py-2 text-sm rounded-lg
                 bg-red-50 text-red-600 border border-red-200
                 hover:bg-red-100 hover:border-red-300
                 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700
                 transition-colors"
        >
          Clear All
        </button>

        <div class="ml-auto">
          <RowsPerPageSelect value={pageSize()} onChange={changePageSize} />
        </div>
      </div>

      {/* Table */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="bg-gray-50 dark:bg-gray-800 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th class="px-4 py-3">Client</th>
              <th class="px-4 py-3">Email</th>
              <th class="px-4 py-3">Organisation</th>
              <th class="px-4 py-3">Sales person</th>
              <th class="px-4 py-3">Type</th>
              <th class="px-4 py-3">Login</th>
              <th class="px-4 py-3">Onboarded</th>
              <th class="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <Show when={!clients.loading} fallback={
              <tr>
                <td colspan="8" class="px-4 py-10 text-center text-gray-400">
                  Loading clients…
                </td>
              </tr>
            }>
              <Show when={clients.error}>
                <tr>
                  <td colspan="8" class="px-4 py-10 text-center text-[#AC2334]">
                    {clients.error?.message || "Could not load clients."}
                  </td>
                </tr>
              </Show>
              <For
                each={pageRows()}
                fallback={
                  <Show when={!clients.error}>
                    <tr>
                      <td colspan="8" class="px-4 py-10 text-center text-gray-400">
                        No clients match these filters.
                      </td>
                    </tr>
                  </Show>
                }
              >
                {(c) => (
                  <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                    <td class="px-4 py-3 font-medium">{clientLabel(c)}</td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {c.email || "—"}
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {c.organization_name || "—"}
                    </td>
                    {/* Not an em-dash like the other empty cells: an unowned
                        client is not a blank field, it is a client missing from
                        every sales dashboard, and it should look different from
                        an organisation nobody filled in. */}
                    <td class="px-4 py-3">
                      <Show
                        when={ownerEmail(c)}
                        fallback={
                          <span class="px-2 py-[2px] rounded-full text-[11px] font-semibold whitespace-nowrap bg-amber-50 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800">
                            Unattributed
                          </span>
                        }
                      >
                        <span class="text-gray-600 dark:text-gray-300">
                          {ownerEmail(c)}
                        </span>
                      </Show>
                    </td>
                    <td class="px-4 py-3">
                      <Show when={c.client_type} fallback={<span class="text-gray-400">—</span>}>
                        <span
                          class={`px-2 py-[2px] rounded-full text-[11px] font-semibold whitespace-nowrap ${
                            TYPE_COLORS[c.client_type] ??
                            "bg-gray-100 text-gray-600 ring-1 ring-gray-300"
                          }`}
                        >
                          {fmtType(c.client_type)}
                        </span>
                      </Show>
                    </td>
                    <td class="px-4 py-3">
                      <span
                        class={`px-2 py-[2px] rounded-full text-[11px] font-semibold whitespace-nowrap ${
                          c.is_active
                            ? "bg-green-100 text-green-700 ring-1 ring-green-300"
                            : "bg-gray-100 text-gray-500 ring-1 ring-gray-300"
                        }`}
                      >
                        {c.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(c.created_at)}
                    </td>
                    <td class="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditing(c)}
                        class="px-3 h-8 text-sm font-medium rounded-lg
                               bg-red-800 border border-red-800 text-white
                               hover:bg-red-700 transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Show when={totalPages() > 1}>
        <div class="flex items-center justify-between mt-4 text-sm">
          <span class="text-gray-500 dark:text-gray-400">
            Page {safePage()} of {totalPages()}
          </span>
          <div class="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, safePage() - 1))}
              disabled={safePage() <= 1}
              class="px-3 h-8 rounded-lg border border-gray-300 dark:border-gray-600
                     text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700
                     transition disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages(), safePage() + 1))}
              disabled={safePage() >= totalPages()}
              class="px-3 h-8 rounded-lg border border-gray-300 dark:border-gray-600
                     text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700
                     transition disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </Show>

      <EditClientDrawer
        open={!!editing()}
        clientId={editing()?.id}
        clientLabel={clientLabel(editing())}
        onSaved={applySaved}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
