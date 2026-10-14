import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { fetchControlModels, parseControlError } from "../../services/control";
import { PageHead, Banner, INPUT, CARD } from "./ControlUI";

// ─── Data Console: model list (/control/data) ─────────────────────────────────
// Every model Django admin registers, grouped by app the way the admin index
// is. New models show up on their own — nothing here is hardcoded.
export default function ControlModels() {
  const [models] = createResource(fetchControlModels);
  // A resource read while errored throws — read through this instead.
  const modelList = () => (models.error ? null : models());
  const [q, setQ] = createSignal("");

  const groups = createMemo(() => {
    const needle = q().trim().toLowerCase();
    const by = new Map();
    for (const m of modelList() ?? []) {
      if (m.perms && m.perms.view === false) continue;
      const hay = `${m.app_name} ${m.app} ${m.verbose_name} ${m.name} ${m.model}`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      const key = m.app_name || m.app;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(m);
    }
    return [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([app, list]) => [
        app,
        list.sort((a, b) =>
          String(a.verbose_name ?? a.name).localeCompare(String(b.verbose_name ?? b.name)),
        ),
      ]);
  });

  return (
    <div class="min-h-screen min-w-0 overflow-x-clip p-3 lg:p-8">
      <PageHead
        title="Data Console"
        subtitle={`Every admin model${modelList() ? ` · ${modelList().length} models` : ""}. Super admins only; every change is audited.`}
      />
      <Banner>{models.error ? parseControlError(models.error, "Couldn't load models.").message : ""}</Banner>

      <input
        type="search"
        value={q()}
        onInput={(e) => setQ(e.target.value)}
        placeholder="Search models or apps…"
        aria-label="Search models or apps"
        class={`${INPUT} mb-5 max-w-md`}
      />

      <Show when={!models.loading} fallback={<p class="text-sm text-gray-500 dark:text-gray-400">Loading models…</p>}>
        <Show when={groups().length} fallback={<p class="text-sm text-gray-500 dark:text-gray-400">No models match.</p>}>
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <For each={groups()}>
              {([app, list]) => (
                <section class={`${CARD} overflow-hidden`}>
                  <h2 class="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    {app}
                  </h2>
                  <ul>
                    <For each={list}>
                      {(m) => (
                        <li class="border-b last:border-b-0 border-gray-100 dark:border-gray-800">
                          <A
                            href={`/control/data/${encodeURIComponent(m.app)}/${encodeURIComponent(m.model)}`}
                            class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-purple-50/60 dark:hover:bg-gray-800"
                          >
                            <span class="font-medium text-purple-700 dark:text-gray-200">
                              {m.verbose_name ?? m.name}
                            </span>
                            <span class="text-[11px] text-gray-400">
                              {m.perms?.change === false ? "view only" : ""}
                            </span>
                          </A>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
