import { createResource, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchSalesClients } from "../../services/sales";
import { typeBadge } from "../../components/sales/salesFormat";
import { CMChips } from "../../components/sales/salesUI";

// A client route is "/:client-nomen-name" — nomen name lowercased, whitespace
// runs collapsed to "-" (matches Clients.jsx:413 and ClientDashboard's slugify).
const slugify = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-");

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
          {/* ── Desktop / tablet: table ── */}
          <div class="hidden md:block overflow-x-auto bg-gray-50 dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
            <table class="w-full text-sm table-auto">
              <thead class="bg-[#F8FAFC] dark:bg-gray-800">
                <tr class="[&_th]:whitespace-nowrap [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:px-4 [&_th]:py-3.5 text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700">
                  <th class="text-left w-12 text-center">S.No</th>
                  <th class="text-left">Client</th>
                  <th class="text-center">Type</th>
                  <th class="text-left">Campaign managers</th>
                  <th class="text-right"></th>
                </tr>
              </thead>
              <tbody>
                <For each={clients()}>
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
                      <td class="px-4 py-3 font-semibold text-blue-900 dark:text-gray-100 group-hover:text-[#AC2334] dark:group-hover:text-red-300 transition">
                        {client.client_nomen_name}
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
            <For each={clients()}>
              {(client) => (
                <button
                  onClick={() => openClient(client)}
                  class="text-left bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05)] p-4 hover:border-[#AC2334]/40 transition-all group"
                >
                  <div class="flex items-start justify-between gap-3">
                    <h3 class="text-base font-bold text-[#14233A] dark:text-white group-hover:text-[#AC2334] dark:group-hover:text-red-300 transition line-clamp-2">
                      {client.client_nomen_name}
                    </h3>
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
    </section>
  );
}
