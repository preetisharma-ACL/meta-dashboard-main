import { For, createMemo, createSignal } from "solid-js";

export default function RetainerSection() {

  // ---------- TAB STATE ----------
  const [activeTab, setActiveTab] = createSignal("retainer");

  // ---------- DUMMY DATA ----------
  const projects = [
    { id: 1, name: "Invest advice", leads: 900, spend: 144828, volume: 10 },
    { id: 2, name: "Elegance", leads: 840, spend: 159869, volume: 20 },
    { id: 3, name: "Jenika Ventures", leads: 605, spend: 133203, volume: 30 },
  ];

  const CPLprojects = [
    { id: 1, name: "Birla", commitmentLeads: 100, qualification: "60%", totalLeads: 60, qualified_leads: 20, actual_delivery: 20, progress: 60, cpl: 500, spend: 9000 },
    { id: 2, name: "Prestige", commitmentLeads: 120, qualification: "50%", type: "Overplus", totalLeads: 75, qualified_leads: 25, actual_delivery: 20, progress: 50, cpl: 300, spend: 9000 },
    { id: 3, name: "Shobha", commitmentLeads: 100, qualification: "60%", type: "Overplus", totalLeads: 100, qualified_leads: 40, actual_delivery: 30, progress: 50, cpl: 600, spend: 9000 },
  ];

  const hybrid_projects = [
    { id: 1, name: "Project 1", total_leads: 120, spent: 24000, volume: 10, type: "Qualification", actualCPL: 160.92 },
    { id: 2, name: "Project 2", total_leads: 100, spent: 20000, volume: 20, type: "Overplus", actualCPL: 190.32 },
    { id: 3, name: "Project 3", total_leads: 90, spent: 18000, volume: 30, type: "Overplus", actualCPL: 220.17 },
  ];

  // ---------- RETAINER CALCULATIONS ----------
  const totalLeads = createMemo(() => projects.reduce((s, p) => s + p.leads, 0));
  const totalSpend = createMemo(() => projects.reduce((s, p) => s + p.spend, 0));
  const avgCPL = createMemo(() => Math.round(totalSpend() / totalLeads()));
  const getCPL = (p) => p.spend / p.leads;
  const bestProject = createMemo(() =>
    projects.reduce((best, p) => {
      if (!best) return p;
      return p.volume / getCPL(p) > best.volume / getCPL(best) ? p : best;
    }, null)
  );

  // ---------- CPL CALCULATIONS ----------
  const getQualificationPercent = (q) => Number(q.replace("%", "")) / 100;
  const getProjectSpend = (p) => p.cpl * p.totalLeads * 1.18;

  const totalLeads_CPL = createMemo(() => CPLprojects.reduce((sum, p) => sum + p.totalLeads, 0));
  const totalQualified = createMemo(() => CPLprojects.reduce((sum, p) => sum + p.qualified_leads, 0));
  const totalActualDelivery = createMemo(() =>
    CPLprojects.reduce((sum, p) => {
      const percent = getQualificationPercent(p.qualification);
      return sum + Math.floor(p.qualified_leads / percent);
    }, 0)
  );
  const totalSpent = createMemo(() =>
    CPLprojects.reduce((sum, p) => sum + getProjectSpend(p), 0)
  );
  const receivedAmount = 200000;
  const remainingBalance = createMemo(() => receivedAmount * 0.82 - totalSpent());

  const cpl_getStatus = (progress) => {
    if (progress < 50) return "Lagging";
    if (progress < 100) return "On Track";
    return "Completed";
  };
  const cpl_getStatusStyle = (progress) => {
    if (progress < 50) return "bg-red-600 text-red-100";
    if (progress < 100) return "bg-yellow-600 text-yellow-100";
    return "bg-green-600 text-green-100";
  };

  // ---------- HYBRID CALCULATIONS ----------
  const getModifiedCPL = (cpl) => (cpl * 1.2).toFixed(2);
  const getStatus = (cpl) => (cpl < 200 ? "Under ₹200" : "Over ₹200");
  const getColor = (cpl) => cpl < 200 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400";
  const getStatusStyle_hybrid = (cpl) => cpl < 200 ? "bg-green-700 text-green-100" : "bg-red-600 text-red-100";

  const bestProject_hybrid = createMemo(() => {
    const validProjects = hybrid_projects.filter((p) => p.actualCPL < 200);
    const list = validProjects.length ? validProjects : hybrid_projects;
    return list.reduce((best, p) => {
      if (!best) return p;
      return (p.volume * 2) - p.actualCPL > (best.volume * 2) - best.actualCPL ? p : best;
    }, null);
  });

  const hybridTotalLeads = createMemo(() => hybrid_projects.reduce((sum, p) => sum + p.total_leads, 0));
  const hybridTotalSpent = createMemo(() => hybrid_projects.reduce((sum, p) => sum + p.spent, 0));
  const hybridAvgCPL = createMemo(() => (hybridTotalSpent() / hybridTotalLeads()).toFixed(2));

  // ---------- TABS CONFIG ----------
  const tabs = [
    { id: "retainer", label: "Retainer" },
    { id: "cpl", label: "CPL breakdown" },
    { id: "hybrid", label: "Hybrid breakdown" },
  ];

  // ---------- UI ----------
  return (
    <div class="p-4 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">

        {/* TAB BAR */}
        <div class="flex border-b border-gray-300 dark:border-gray-700">
          <For each={tabs}>
            {(tab) => (
              <button
                onClick={() => setActiveTab(tab.id)}
                class={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px
                  ${activeTab() === tab.id
                    ? "border-blue-600 text-blue-700 dark:text-blue-400 dark:border-blue-400"
                    : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                  }`}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>

        {/* ─── RETAINER TAB ─── */}
        {activeTab() === "retainer" && (
          <div>
            <div class="p-6 border-b border-gray-300 dark:border-gray-700">
              <div class="flex items-center gap-4">
                <svg class="w-5 h-5 text-blue-900 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <div class="text-xl text-blue-900 dark:text-blue-400 font-semibold mb-2">
                  All Projects - Retainer
                </div>
              </div>
              <p>Get a clear overview of all projects, including total leads generated, overall spend, and average cost per lead (CPL).</p>
            </div>

            <div class="p-6 grid md:grid-cols-4 gap-4">
              <Stat label="Total Leads" value={`₹${totalLeads().toLocaleString()}`} />
              <Stat label="Total spent" value={`₹${totalSpend().toLocaleString()}`} />
              <Stat label="Average CPL" value={`₹${avgCPL()}`} />
              <Stat label="Total Project" value={projects.length} />
            </div>

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
                        <tr class="border-b border-gray-200 dark:border-gray-700">
                          <td class="py-3 font-medium">{p.name} {isBest && "⭐"}</td>
                          <td class="text-center">{p.leads}</td>
                          <td class="text-center">₹{p.spend.toLocaleString()}</td>
                          <td class="text-center">
                            <span class={`px-3 py-1 rounded-full text-xs font-medium
                              ${cpl < 180 ? "bg-green-600 text-white" : cpl < 210 ? "bg-yellow-500 text-black" : "bg-red-600 text-white"}`}>
                              ₹{cpl.toFixed(2)}
                            </span>
                          </td>
                          <td class="text-center">{p.volume}</td>
                          <td class="text-green-500 text-center">{isBest ? "High vol - Low CPL" : "—"}</td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
              <div class="mt-4 text-sm text-gray-500 flex items-center gap-2">
                <span class="w-2 h-2 bg-green-500 rounded-full"></span>
                Best performing campaign
              </div>
            </div>
          </div>
        )}

        {/* ─── CPL TAB ─── */}
        {activeTab() === "cpl" && (
          <div>
            <div class="p-6 border-b border-gray-300 dark:border-gray-700">
              <div class="flex items-center gap-4">
                <svg class="w-5 h-5 text-blue-900 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <div class="text-xl text-blue-900 dark:text-blue-400 font-semibold mb-2">
                  All projects — CPL breakdown
                </div>
              </div>
              <p>Get a clear overview of all projects, including total leads generated, overall spend, and average cost per lead (CPL).</p>
            </div>

            <div class="p-6 grid md:grid-cols-5 gap-4">
              <Stat label="Total Leads" value={totalLeads_CPL()} />
              <Stat label="Qualified Leads" value={totalQualified()} />
              <Stat label="Actual Delivery" value={Math.round(totalActualDelivery())} />
              <Stat label="Total Spent (incl GST)" value={`₹${Math.round(totalSpent()).toLocaleString()}`} />
              <Stat label="Remaining Balance" value={`₹${Math.round(remainingBalance()).toLocaleString()}`} />
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="text-gray-400 border-b border-gray-300 dark:border-gray-700">
                  <tr>
                    <th class="text-left py-3 px-4">Project</th>
                    <th>Commitment Leads</th>
                    <th>Qualification</th>
                    <th>CPL</th>
                    <th>Total Delivered leads</th>
                    <th>Qualified</th>
                    <th>Actual delivery</th>
                    <th>Progress</th>
                    <th>Spend (est.)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={CPLprojects}>
                    {(p) => {
                      const qualificationPercent = getQualificationPercent(p.qualification);
                      const actualDelivery = p.qualified_leads / qualificationPercent;
                      const progress = (actualDelivery / p.commitmentLeads) * 100;
                      return (
                        <tr class="border-b border-gray-200 dark:border-gray-700">
                          <td class="py-3 px-4 font-medium">{p.name}</td>
                          <td class="text-center">{p.commitmentLeads}</td>
                          <td class="text-center">{p.qualification}</td>
                          <td class="text-center">₹{p.cpl}</td>
                          <td class="text-center">{p.totalLeads}</td>
                          <td class="text-center">{p.qualified_leads}</td>
                          <td class="text-center">{Math.floor(actualDelivery)}</td>
                          <td class="text-center">
                            <div class="flex items-center gap-2 justify-center">
                              <div class="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  class={`h-full ${progress >= 100 ? "bg-green-500" : progress >= 60 ? "bg-yellow-500" : "bg-red-500"}`}
                                  style={{ width: `${Math.min(progress, 100)}%` }}
                                />
                              </div>
                              <span class="text-xs">{Math.round(progress)}%</span>
                            </div>
                          </td>
                          <td class="text-center font-semibold">₹{Math.round(getProjectSpend(p)).toLocaleString()}</td>
                          <td class="text-center">
                            <span class={`px-3 py-1 rounded-full text-xs font-medium ${cpl_getStatusStyle(progress)}`}>
                              {cpl_getStatus(progress)}
                            </span>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── HYBRID TAB ─── */}
        {activeTab() === "hybrid" && (
          <div>
            <div class="p-6 border-b border-gray-300 dark:border-gray-700">
              <div class="flex items-center gap-4">
                <svg class="w-5 h-5 text-blue-900 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <div class="text-xl text-blue-900 dark:text-blue-400 font-semibold mb-2">
                  All projects — Hybrid breakdown
                </div>
              </div>
              <p>Get a clear overview of all projects, including total leads generated, overall spend, and average cost per lead (CPL).</p>
            </div>

            <div class="p-6 grid md:grid-cols-4 gap-4">
              <Stat label="Total Leads" value={hybridTotalLeads()} />
              <Stat label="Total spent" value={`₹${hybridTotalSpent().toLocaleString()}`} />
              <Stat label="Avg Modified CPL" value={`₹${hybridAvgCPL()}`} />
              <Stat label="Projects active" value={hybrid_projects.length} />
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-sm">
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
                <tbody>
                  <For each={hybrid_projects}>
                    {(p) => {
                      const isBest = bestProject_hybrid()?.id === p.id;
                      return (
                        <tr class="border-b border-gray-200 dark:border-gray-700">
                          <td class="py-3 px-4 font-medium">
                            <div class="flex items-center gap-2">
                              {p.name}
                              {isBest && (
                                <span class="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-600/20 text-green-700 dark:text-green-400">
                                  Top performer
                                </span>
                              )}
                            </div>
                          </td>
                          <td class="text-center">{p.total_leads}</td>
                          <td class="text-center">₹{p.spent?.toLocaleString()}</td>
                          <td class="text-center">{p.volume}</td>
                          <td class={`text-center font-semibold ${getColor(p.actualCPL)}`}>₹{p.actualCPL}</td>
                          <td class="text-center font-semibold">₹{getModifiedCPL(p.actualCPL)}</td>
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

            <div class="my-6 border-t border-gray-300 dark:border-gray-700" />

            <div class="p-4">
              <p class="text-sm text-green-700 mb-2 tracking-wide">Best Performing Campaign</p>
              <div class="grid md:grid-cols-2 gap-6">
                <For each={[bestProject_hybrid()]}>
                  {(p) => (
                    <div>
                      <p class="text-sm mb-2">{p.name}</p>
                      <p class="text-xl font-semibold text-green-700 dark:text-green-400">₹{p.actualCPL}</p>
                      <p class="text-xs text-gray-500">High vol · Low CPL</p>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ---------- STAT CARD ----------
function Stat(props) {
  return (
    <div class="shadow-md border border-gray-50 dark:border-gray-600 dark:bg-gray-800 p-4 rounded-lg">
      <div class="text-md text-gray-500 dark:text-gray-400">{props.label}</div>
      <div class="text-xl font-semibold mt-1">{props.value}</div>
    </div>
  );
}