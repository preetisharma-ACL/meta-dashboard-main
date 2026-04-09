import { For, createMemo } from "solid-js";

export default function RetainerSection() {

  // ---------- DUMMY DATA ----------
  const projects = [
    {
      id: 1,
      name: "Invest advice",
      leads: 900,
      spend: 144828,
      volume: 10,
    },
    {
      id: 2,
      name: "Elegance",
      leads: 840,
      spend: 159869,
      volume: 20,
    },
    {
      id: 3,
      name: "Jenika Ventures",
      leads: 605,
      spend: 133203,
      volume: 30,
    }
  ];

  const CPLprojects = [
    {
      id: 1,
      name: "Birla",
      qualification: "60%",
      totalLeads: 60,
      qualified_leads: 20,
      actual_delivery: 20,
      progress: 60,
      cpl: 160.92,
      spend: 9000,
      status: "On track"
    },
    {
      id: 2,
      name: "Prestige",
      qualification: "50%",
      type: "Overplus",
      totalLeads: 75,
      qualified_leads: 25,
      actual_delivery: 20,
      progress: 50,
      cpl: 190.32,
      spend: 9000,
      status: "Monitor"
    },
    {
      id: 3,
      name: "Shobha",
      qualification: "60%",
      type: "Overplus",
      totalLeads: 100,
      qualified_leads: 40,
      actual_delivery: 30,
      progress: 50,
      cpl: 220.17,
      spend: 9000,
      status: "Over CPL"
    }
  ];

  const hybrid_projects = [
    {
      id: 1,
      name: "Project 1",
      volume: 10,
      type: "Qualification",
      actualCPL: 160.92
    },
    {
      id: 2,
      name: "Project 2",
      volume: 20,
      type: "Overplus",
      actualCPL: 190.32
    },
    {
      id: 3,
      name: "Project 3",
      volume: 30,
      type: "Overplus",
      actualCPL: 220.17
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

  const getStatusStyle = (status) => {
    if (status === "On track") return "bg-green-600/20 text-green-400";
    if (status === "Monitor") return "bg-yellow-500/20 text-yellow-400";
    return "bg-red-600/20 text-red-400";
  };

  const getCPLColor = (cpl) => {
    if (cpl < 180) return "text-green-400";
    if (cpl < 210) return "text-yellow-400";
    return "text-red-400";
  };


  // hybrid logic
  // Modified CPL (20% margin)
  const getModifiedCPL = (cpl) => (cpl * 1.2).toFixed(2);

  const getStatus = (cpl) => (cpl < 200 ? "Under ₹200" : "Over ₹200");

  const getColor = (cpl) => {
    if (cpl < 200) return "text-green-400";
    return "text-red-400";
  };

  const getStatusStyle_hybrid = (cpl) => {
    if (cpl < 200) return "bg-green-600/20 text-green-400";
    return "bg-red-600/20 text-red-400";
  };

  // BEST PROJECT (same logic you used before)
  const bestProject_hybrid = createMemo(() => {
    return projects.reduce((best, p) => {
      if (!best) return p;
      const score = p.volume / p.actualCPL;
      const bestScore = best.volume / best.actualCPL;
      return score > bestScore ? p : best;
    }, null);
  });

  // ---------- UI ----------
  return (
    <div class="p-4 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 ">

      {/* retainer delivery */}

      <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900">
        {/* HEADER */}
        <div class="p-6 border-b border-gray-300 dark:border-gray-700">
          <div class="flex items-center gap-4 ">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <div class="text-xl text-gray-600 dark:text-gray-400 font-semibold  text-gray-500  mb-2">
              Project Summary ( Retainer )
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
          <div class="mt-4 text-sm text-gray-500 flex items-center gap-2">
            <span class="w-2 h-2 bg-green-500 rounded-full"></span>
            Best performing campaign
          </div>
        </div>
      </div>

      {/* cpl delivery */}

      <div class="rounded-xl mt-4 mb-8 border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900">
        {/* HEADER */}
        <div class="p-6 border-b border-gray-300 dark:border-gray-700">
          <div class="flex items-center gap-4 ">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <div class="text-xl text-gray-600 dark:text-gray-400 font-semibold  text-gray-500  mb-2">
              All projects — CPL breakdown
            </div>
          </div>
          <p>Get a clear overview of all projects, including total leads generated, overall spend, and average cost per lead (CPL).</p>
        </div>
        {/* TABLE */}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">

            <thead class="text-gray-400 border-b border-gray-300 dark:border-gray-700">
              <tr>
                <th class="text-left py-3 px-4">Project</th>
                <th>Qualification</th>
                <th>CPL</th>
                <th>Total leads</th>
                <th>Qualified</th>
                <th>Actual delivery</th>
                <th>Progress</th>
                <th>Spend (est.)</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              <For each={CPLprojects}>
                {(p) => (
                  <tr class="border-b border-gray-200 dark:border-gray-700">

                    <td class="py-3 px-4 font-medium">{p.name}</td>
                    <td class="text-center">{p.qualification}</td>
                    {/* CPL */}
                    <td class={`text-center font-semibold ${getCPLColor(p.cpl)}`}>
                      ₹{p.cpl}
                    </td>
                    <td class="text-center">{p.totalLeads}</td>
                    <td class="text-center">{p.qualified_leads}</td>
                    <td class="text-center">{p.actual_delivery} </td>

                    {/* PROGRESS BAR */}
                    <td class="text-center">
                      <div class="flex items-center gap-2 justify-center">
                        <div class="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            class={`h-full ${p.progress >= 60
                              ? "bg-green-500"
                              : "bg-yellow-500"
                              }`}
                            style={{ width: `${p.progress}%` }}
                          ></div>
                        </div>
                        <span class="text-xs">{p.progress}%</span>
                      </div>
                    </td>


                    <td class="text-center">₹{p.spend.toLocaleString()}</td>

                    {/* STATUS */}
                    <td class="text-center">
                      <span class={`px-3 py-1 rounded-full text-xs font-medium ${getStatusStyle(p.status)}`}>
                        {p.status}
                      </span>
                    </td>

                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>

      {/* hybrid delivery */}
      <div class="rounded-xl  mt-4 mb-8 border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900">

        {/* HEADER */}
        <div class="p-6 border-b border-gray-300 dark:border-gray-700">
          <div class="flex items-center gap-4 ">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <div class="text-xl text-gray-600 dark:text-gray-400 font-semibold  text-gray-500  mb-2">
              All projects — Hybrid breakdown
            </div>
          </div>
          <p>Get a clear overview of all projects, including total leads generated, overall spend, and average cost per lead (CPL).</p>
        </div>

        {/* PROJECT CARDS */}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">

            {/* HEADER */}
            <thead class="text-gray-400 border-b border-gray-300 dark:border-gray-700">
              <tr>
                <th class="text-left py-3 px-4">Project</th>
                <th>Total Leads</th>
                <th>Spend</th>
                <th>Volume</th>
                <th>Actual CPL</th>
                <th>Modified CPL (+20%)</th>
                <th>Status</th>
              </tr>
            </thead>

            {/* BODY */}
            <tbody>
              <For each={hybrid_projects}>
                {(p) => {
                  const isBest = bestProject_hybrid()?.id === p.id;

                  return (
                    <tr class={`border-b border-gray-200 dark:border-gray-700`}>

                      {/* PROJECT */}
                      <td class="py-3 px-4 font-medium">
                        <div class="flex items-center gap-2">
                          {p.name}
                          {isBest && (
                            <span class="text-xs px-2 py-1 rounded-full bg-green-600/20 text-green-400">
                              Top performer
                            </span>
                          )}
                        </div>
                      </td>


                      {/* TOTAL LEADS */}
                      <td class="text-center">{p.totalLeads}</td>

                      {/* SPEND */}
                      <td class="text-center">
                        ₹{p.spend?.toLocaleString()}
                      </td>

                      {/* VOLUME */}
                      <td class="text-center">{p.volume}</td>

                      {/* ACTUAL CPL */}
                      <td class={`text-center font-semibold ${getColor(p.actualCPL)}`}>
                        ₹{p.actualCPL}
                      </td>

                      {/* MODIFIED CPL */}
                      <td class="text-center font-semibold">
                        ₹{getModifiedCPL(p.actualCPL)}
                      </td>

                      {/* STATUS */}
                      <td class="text-center">
                        <span class={`px-3 py-1 rounded-full text-xs font-medium ${getStatusStyle_hybrid(p.actualCPL)}`}>
                          {getStatus(p.actualCPL)}
                        </span>
                      </td>

                    </tr>
                  );
                }}
              </For>
            </tbody>

          </table>
        </div>

        {/* DIVIDER */}
        <div class="my-6 border-t border-gray-300 dark:border-gray-700"></div>

        {/* BEST PERFORMANCE */}
        <div class="p-4">
          <p class="text-xs text-gray-400 mb-4 tracking-wide">
            BEST PERFORMING CAMPAIGN
          </p>

          <div class="grid md:grid-cols-2 gap-6">
            <For each={hybrid_projects.slice(0, 2)}>
              {(p) => (
                <div>
                  <p class="text-sm">{p.name}</p>
                  <p class="text-xl font-semibold text-green-400">
                    ₹{p.actualCPL}
                  </p>
                  <p class="text-xs text-gray-500">
                    High vol · Low CPL
                  </p>
                </div>
              )}
            </For>
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





