import { For, createMemo } from "solid-js";

export default function RetainerSection() {

  // ---------- DUMMY DATA ----------
  const projects = [
    {
      id: 1,
      name: "Birla",
      leads: 900,
      spend: 144828,
      volume: 10,
    },
    {
      id: 2,
      name: "Prestige",
      leads: 840,
      spend: 159869,
      volume: 20,
    },
    {
      id: 3,
      name: "Shobha",
      leads: 605,
      spend: 133203,
      volume: 30,
    }
  ];

  // ---------- CALCULATIONS ----------
  const totalLeads = createMemo(() =>
    projects.reduce((s, p) => s + p.leads, 0)
  );

  const totalSpend = createMemo(() =>
    projects.reduce((s, p) => s + p.spend, 0)
  );

  const avgCPL = createMemo(() =>
    Math.round(totalSpend() / totalLeads())
  );

  const getCPL = (p) => p.spend / p.leads;

  // BEST PROJECT = highest volume + lowest CPL logic
  const bestProject = createMemo(() => {
    return projects.reduce((best, p) => {
      if (!best) return p;
      const score = p.volume / getCPL(p);
      const bestScore = best.volume / getCPL(best);
      return score > bestScore ? p : best;
    }, null);
  });

  // ---------- UI ----------
  return (
    <div class="p-4 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">

      <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900">

        {/* HEADER */}
        <div class="p-6 border-b border-gray-300 dark:border-gray-700">
          <div class="flex items-center gap-4 ">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <div class="text-xl text-gray-600 dark:text-gray-400 font-semibold  text-gray-500  mb-2">
            Project Summary
          </div>
          </div>
          <p>Get a clear overview of all projects, including total leads generated, overall spend, and average cost per lead (CPL).</p>
        </div>

        {/* STATS */}
        <div class="p-6 grid md:grid-cols-4 gap-4">
          <Stat label="Total Leads" value={`₹${totalLeads().toLocaleString()}`} />
          <Stat label="Total spent" value={`₹${totalSpend().toLocaleString()}`} />
          <Stat label="Average CPL" value={`₹${avgCPL()}`} />
          <Stat label="Projects active" value={projects.length} />
        </div>

        {/* TABLE */}
        <div class="px-6 pb-6 overflow-x-auto">
          <table class="w-full text-sm">

            <thead class="text-gray-400 border-b border-gray-300 dark:border-gray-700">
              <tr>
                <th class="text-left py-3">Project</th>
                <th>Leads</th>
                <th>Total spent</th>
                <th>Avg CPL</th>
                <th>Volume</th>
                <th>Performance</th>
              </tr>
            </thead>

            <tbody>
              <For each={projects}>
                {(p) => {
                  const cpl = getCPL(p);
                  const isBest = bestProject()?.id === p.id;

                  return (
                    <tr class="border-b border-gray-200 dark:border-gray-700 "
                    >

                      <td class="py-3 font-medium">
                        {p.name} {isBest && "⭐"}
                      </td>

                      <td class="text-center">{p.leads}</td>

                      <td class="text-center">₹{p.spend.toLocaleString()}</td>

                      <td class="text-center">
                        <span class={`px-3 py-1 rounded-full text-xs text-center font-medium
                          ${cpl < 180 ? "bg-green-600 text-white" :
                            cpl < 210 ? "bg-yellow-500 text-black" :
                              "bg-red-600 text-white"}`}>
                          ₹{cpl.toFixed(2)}
                        </span>
                      </td>

                      <td class="text-center">{p.volume}</td>

                      <td class="text-green-500 text-center">
                        {isBest ? "High vol - Low CPL" : "—"}
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>

          {/* FOOTER NOTE */}
          <div class="mt-4 text-xs text-gray-400 flex items-center gap-2">
            <span class="w-2 h-2 bg-green-500 rounded-full"></span>
            Best performing campaign = highest volume + lowest CPL
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- STAT CARD ----------
function Stat(props) {
  return (
    <div class="shadow-md border border-gray-50 dark:border-gray-600 dark:bg-gray-800 p-4 rounded-lg">
      <div class="text-md text-gray-500 dark;text-gray">{props.label}</div>
      <div class="text-xl font-semibold mt-1">{props.value}</div>
    </div>
  );
}