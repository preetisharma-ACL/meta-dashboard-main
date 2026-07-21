import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchSalesClients } from "../../services/sales";
import { typeBadge } from "../../components/sales/salesFormat";
import { CMChips } from "../../components/sales/salesUI";
import Avatar from "../../components/common/Avatar";
import {
  CLIENT_TYPES,
  toggleClientTypeIn,
} from "../../components/funding/ClientTypeFilter";

// A client route is "/:client-nomen-name" — nomen name lowercased, whitespace
// runs collapsed to "-" (matches Clients.jsx:413 and ClientDashboard's slugify).
const slugify = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-");

// All type keys (cpl · hybrid · retainer). A roster shows every type by default,
// so the toggle starts fully selected (unlike the funding view, which excludes
// client-funded retainers by default).
const ALL_TYPE_KEYS = CLIENT_TYPES.map((t) => t.key);

export default function SalesClients() {
  const navigate = useNavigate();

  const [clientsRes] = createResource(async () => {
    try {
      return await fetchSalesClients();
    } catch (err) {
      console.error("[SalesClients] failed to load sales clients", err);
      return [];
    }
  });
  const clients = () => clientsRes() ?? [];

  // ── Controls: search · type toggle · sort ───────────────────────────────────
  const [search, setSearch] = createSignal("");
  const [clientTypes, setClientTypes] = createSignal(ALL_TYPE_KEYS);
  const [sortKey, setSortKey] = createSignal("name"); // "name" | "type"
  const [sortDir, setSortDir] = createSignal("asc");

  const toggleSort = (key) => {
    if (sortKey() === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIcon = (key) => {
    if (sortKey() !== key)
      return <span class="ml-1 text-[#C3CDDB] dark:text-gray-600">⇅</span>;
    return (
      <span class="ml-1 text-[#AC2334] dark:text-red-300">
        {sortDir() === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const sortValue = (c) =>
    sortKey() === "type"
      ? String(c.client_type ?? "").toLowerCase()
      : String(c.client_nomen_name ?? "").toLowerCase();

  const visibleClients = createMemo(() => {
    let data = [...clients()];

    // Search — client name or any campaign-manager name/email.
    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter((c) => {
        const inName = c.client_nomen_name?.toLowerCase().includes(q);
        const inCM = (c.campaign_managers ?? []).some(
          (cm) =>
            cm?.name?.toLowerCase().includes(q) ||
            cm?.email?.toLowerCase().includes(q),
        );
        return inName || inCM;
      });
    }

    // Type toggle (multi-select). Clients with no type always pass through.
    const types = clientTypes();
    if (types.length < ALL_TYPE_KEYS.length) {
      data = data.filter(
        (c) =>
          !c.client_type ||
          types.includes(String(c.client_type).toLowerCase()),
      );
    }

    data.sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      if (va < vb) return sortDir() === "asc" ? -1 : 1;
      if (va > vb) return sortDir() === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  });

  const hasActiveFilters = () =>
    search().trim() || clientTypes().length < ALL_TYPE_KEYS.length;
  const clearFilters = () => {
    setSearch("");
    setClientTypes(ALL_TYPE_KEYS);
  };

  const openClient = (client) => {
    const name = client.client_nomen_name;
    // Sales scopes purely by nomen. Write name + nomen id + display name; NEVER
    // selectedClientId — that Client PK feeds as_client_id (admin-only preview).
    localStorage.setItem("selectedClientNomen", name);
    localStorage.setItem("selectedClientNomenId", client.client_nomen);
    localStorage.setItem("selectedClientName", name);
    navigate(`/${slugify(name)}`);
  };

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="mb-6">
        <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
          Sales manager · My clients
        </p>
        <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
          Clients
        </h1>
        <p class="text-md text-[#54657E] dark:text-gray-400">
          {clients().length} onboarded · click a row to open that client's
          dashboard
        </p>
      </div>

      {/* ════════ CONTROLS: type toggle · search · clear (all left-aligned) ════════ */}
      <Show when={!clientsRes.loading && clients().length > 0}>
        <div class="flex-col sm:flex-wrap sm:items-center gap-3 mb-5">
          {/* Type toggle — multi-select pills */}
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mr-1">
              Client type
            </span>
            <For each={CLIENT_TYPES}>
              {(t) => {
                const on = () => clientTypes().includes(t.key);
                return (
                  <button
                    onClick={() =>
                      setClientTypes((prev) => toggleClientTypeIn(prev, t.key))
                    }
                    aria-pressed={on()}
                    class={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                      on()
                        ? "bg-[#14233A] text-white border-[#14233A]"
                        : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
                    }`}
                  >
                    <svg
                      class="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <Show
                        when={on()}
                        fallback={
                          <circle cx="12" cy="12" r="9" stroke-width="1.6" />
                        }
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </Show>
                    </svg>
                    {t.label}
                  </button>
                );
              }}
            </For>
          </div>
          
          {/* Search */}
          <div class="relative w-full sm:w-80 mt-4 ">
            <svg
              class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8593A8]"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
              />
            </svg>
            <input
              type="text"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search client or campaign manager…"
              class="w-full pl-9 pr-9 py-2.5 rounded-lg text-sm bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-200 border border-[#E2E8F1] dark:border-gray-700 placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
            />
            <Show when={search()}>
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8593A8] hover:text-[#AC2334]"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </Show>
          </div>

          {/* Clear all filters */}
          <Show when={hasActiveFilters()}>
            <button
              onClick={clearFilters}
              class="inline-flex items-center gap-1.5 px-3.5 py-2 mt-2 rounded-lg text-sm font-semibold text-[#AC2334] dark:text-red-300 bg-[#FBEEF0] dark:bg-red-900/30 hover:bg-[#F7DDE1] dark:hover:bg-red-900/50 transition-colors whitespace-nowrap"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Clear filters
            </button>
          </Show>
        </div>
      </Show>

      <Show
        when={!clientsRes.loading}
        fallback={
          <div class="space-y-2">
            <For each={Array(6).fill(0)}>
              {() => (
                <div class="h-14 bg-gray-100 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-lg animate-pulse" />
              )}
            </For>
          </div>
        }
      >
        <Show
          when={clients().length > 0}
          fallback={
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-10 text-center text-[#8593A8] dark:text-gray-500">
              No onboarded clients yet.
            </div>
          }
        >
          {/* Result count / empty-after-filter */}
          <p class="text-sm text-[#54657E] dark:text-gray-400 mb-3">
            Showing <b class="text-[#14233A] dark:text-white">{visibleClients().length}</b>{" "}
            of {clients().length}
          </p>

          <Show
            when={visibleClients().length > 0}
            fallback={
              <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-10 text-center text-[#8593A8] dark:text-gray-500">
                No clients match your search.
              </div>
            }
          >
            {/* ── Desktop / tablet: table ── */}
            <div class="hidden md:block overflow-x-auto bg-gray-50 dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
              <table class="w-full text-sm table-auto">
                <thead class="bg-[#F8FAFC] dark:bg-gray-800">
                  <tr class="[&_th]:whitespace-nowrap [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:px-4 [&_th]:py-3.5 text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700">
                    <th class="text-center w-12">S.No</th>
                    <th class="text-left">
                      <button
                        onClick={() => toggleSort("name")}
                        class="inline-flex items-center uppercase tracking-wider font-bold hover:text-[#AC2334] dark:hover:text-red-300 transition"
                      >
                        Client
                        {sortIcon("name")}
                      </button>
                    </th>
                    <th class="text-center">
                      <button
                        onClick={() => toggleSort("type")}
                        class="inline-flex items-center uppercase tracking-wider font-bold hover:text-[#AC2334] dark:hover:text-red-300 transition"
                      >
                        Type
                        {sortIcon("type")}
                      </button>
                    </th>
                    <th class="text-left">Campaign managers</th>
                    <th class="text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={visibleClients()}>
                    {(client, i) => (
                      <tr
                        onClick={() => openClient(client)}
                        class={
                          "border-t border-[#E2E8F1] dark:border-gray-700 cursor-pointer transition-colors group hover:bg-[#F6F9FC] dark:hover:bg-gray-700/40 " +
                          (i() % 2 === 0
                            ? "bg-gray-50 dark:bg-gray-800"
                            : "bg-[#FAFBFD] dark:bg-gray-800")
                        }
                      >
                        <td class="px-4 py-3 text-center">
                          <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-xs font-bold">
                            {i() + 1}
                          </span>
                        </td>
                        <td class="px-4 py-3">
                          <div class="flex items-center gap-3">
                            <Avatar name={client.client_nomen_name} />
                            <span class="font-semibold text-blue-900 dark:text-gray-100 group-hover:text-[#AC2334] dark:group-hover:text-red-300 transition">
                              {client.client_nomen_name}
                            </span>
                          </div>
                        </td>
                        <td class="px-4 py-3 text-center">
                          <Show
                            when={client.client_type}
                            fallback={<span class="text-[#8593A8]">—</span>}
                          >
                            <span
                              class={`inline-block px-2.5 py-1 text-xs font-bold rounded-full uppercase tracking-wide ${typeBadge(client.client_type)}`}
                            >
                              {client.client_type}
                            </span>
                          </Show>
                        </td>
                        <td class="px-4 py-3">
                          <CMChips managers={client.campaign_managers} />
                        </td>
                        <td class="px-4 py-3 text-right">
                          <svg
                            class="w-4 h-4 inline text-[#8593A8] transition-transform group-hover:translate-x-0.5 group-hover:text-[#AC2334]"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>

            {/* ── Mobile: cards ── */}
            <div class="md:hidden grid grid-cols-1 gap-3">
              <For each={visibleClients()}>
                {(client) => (
                  <button
                    onClick={() => openClient(client)}
                    class="text-left bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05)] p-4 hover:border-[#AC2334]/40 transition-all group"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="flex items-center gap-3 min-w-0">
                        <Avatar name={client.client_nomen_name} />
                        <h3 class="text-base font-bold text-[#14233A] dark:text-white group-hover:text-[#AC2334] dark:group-hover:text-red-300 transition line-clamp-2">
                          {client.client_nomen_name}
                        </h3>
                      </div>
                      <Show when={client.client_type}>
                        <span
                          class={`flex-none inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${typeBadge(client.client_type)}`}
                        >
                          {client.client_type}
                        </span>
                      </Show>
                    </div>
                    <div class="mt-3">
                      <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-500 mb-1.5">
                        Campaign managers
                      </p>
                      <CMChips managers={client.campaign_managers} />
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
