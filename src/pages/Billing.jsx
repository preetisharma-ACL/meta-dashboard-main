import { createSignal, createMemo, createResource, For, Show, onMount } from "solid-js";
import { fetchBillingOverview, fetchAllProjectsBilling } from "../services/billing-service";
import { billingCache, setBillingCache, isCacheStale } from "../cacheStore/appStore";
import { fetchPaymentsDetails } from "../services/payments-service";



// --- Helpers ------------------------------------------------------------------
const fmt = (n) => "₹" + Number(n).toLocaleString("en-IN");
const pct = (a, b) => (b === 0 ? 0 : Math.min(100, Math.round((a / b) * 100)));



const MOCK_DELIVERIES = [
  { project: "Project 1", leads: 50, amountExGST: 25000, amountWithGST: 29500 },
  { project: "Project 2", leads: 30, amountExGST: 30000, amountWithGST: 35400 },
];

const MOCK_ALERTS = [
  { id: "a1", type: "warning", label: "Low Balance Alert", desc: "Trigger when remaining balance falls below 10% of committed budget.", activeMsg: "Budget utilization at 62% — review campaign pacing.", defaultOn: true },
  { id: "a2", type: "warning", label: "Budget Exhaustion Alert", desc: "Alert when any campaign reaches 95% of its cap.", activeMsg: null, defaultOn: true },
  { id: "a3", type: "info", label: "Payment Due Reminder", desc: "Remind 7 days before next billing cycle.", activeMsg: "Next billing cycle: 28 March 2025", defaultOn: true },
  { id: "a4", type: "caution", label: "CPL Threshold Alert", desc: "Alert when actual CPL exceeds proposed CPL for any project.", activeMsg: null, defaultOn: false },
  { id: "a5", type: "success", label: "CPL On-Target Notification", desc: "Notify when CPL is within the agreed threshold.", activeMsg: "CPL within threshold for all active campaigns.", defaultOn: true },
];

// --- Transform API project → component-friendly shape ------------------------
// projectMeta comes from the /projects/ list API (has name, status, logo, etc.)
// apiData comes from /billing/project/:id
function transformProject(apiData, projectMeta = {}) {
  const campaigns = (apiData.campaign_breakdown || []).map((c) => ({
    id: String(c.campaign_id),
    // Show 2nd and 4th segments (index 1 and 3) joined
    name: [c.campaign_name.split("|")[1]?.trim(), c.campaign_name.split("|")[3]?.trim()].filter(Boolean).join(" | "),
    // fullName: c.campaign_name,
    status: c.status,
    spend: parseFloat(c.spent) || 0,
    budgetCap: parseFloat(c.budget) || 0,
    leads: c.leads || 0,
    cpl: c.cpl ? parseFloat(c.cpl) : 0,
    result: "Lead",
    // dailyAvg is not in this API — set 0 until available
    dailyAvg: 0,
  }));

  return {
    // prefer billing API fields, fall back to projectMeta from projects list
    id: String(apiData.project_id ?? projectMeta.id),
    name: apiData.project_name ?? projectMeta.name,
    status: projectMeta.status ?? "active",
    logo: projectMeta.logo ?? null,
    budgetAllocated: parseFloat(apiData.budget_allocated),
    totalSpend: parseFloat(apiData.cpl?.total_spend),
    remaining: parseFloat(apiData.remaining),
    qualificationPct: apiData.cpl?.qualification_percent || 30,
    qualifiedLeads: apiData.cpl?.qualified_leads,
    expectedQualifiedLeads: apiData.cpl?.expected_qualified_leads,
    totalLeads: apiData.cpl?.total_leads,
    avgCPL: parseFloat(apiData.cpl?.avg_cpl),
    campaigns,
  };
}

// --- Primitive UI Components --------------------------------------------------

function SectionLabel(props) {
  return (
    <p class="text-md font-semibold text-gray-600 dark:text-gray-400 mb-3 mt-4">
      {props.children}
    </p>
  );
}

function Card(props) {
  return (
    <div class={`rounded-xl shadow-md transition border border-gray-200/80 dark:border dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl ${props.class || ""}`}>
      {props.children}
    </div>
  );
}

function Tag(props) {
  const variantMap = {
    gray: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
    green: "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400",
    amber: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400",
    blue: "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400",
    red: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400",
  };
  return (
    <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-sm font-bold tracking-wide ${variantMap[props.variant || "gray"]}`}>
      {props.children}
    </span>
  );
}

function ProgressBar(props) {
  const width = () => pct(props.value, props.max);
  return (
    <div class="h-1 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
      <div
        class={`h-full rounded-full transition-all duration-700 ${props.colorClass || "bg-gray-700 dark:bg-gray-300"}`}
        style={{ width: `${width()}%` }}
      />
    </div>
  );
}

function Toggle(props) {
  return (
    <button
      role="switch"
      aria-checked={props.checked}
      onClick={props.onChange}
      class={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none ${props.checked ? "bg-gray-800 dark:bg-gray-200" : "bg-gray-200 dark:bg-gray-700"}`}
    >
      <span class={`inline-block h-4 w-4 rounded-full bg-white dark:bg-gray-800 shadow-sm transform transition-transform duration-200 mt-0.5 ${props.checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

function CPLIndicator(props) {
  return (
    <div class="space-y-1">
      <div class="flex justify-between text-sm">
        <span class="text-gray-500 dark:text-gray-400">vs Proposed {fmt(props.proposed)}</span>
      </div>
    </div>
  );
}

// --- Budget Card --------------------------------------------------------------
function BudgetCard(props) {
  return (
    <Card class="p-5 space-y-3 shadow-lg">
      <div class="flex items-start justify-between">
        <div class="space-y-0.5">
          <p class="text-md font-semibold text-gray-700 dark:text-gray-400">
            {props.label}
          </p>

          <p class="text-lg font-bold text-gray-800 dark:text-gray-100">
            {fmt(props.value)}
          </p>
        </div>

        <span class="text-2xl">{props.icon}</span>
      </div>

      {props.allocation && (
        <span class="inline-block text-[12px] px-2 text-gray-800 dark:text-gray-300 bg-blue-100 dark:bg-blue-800 px-2 py-1 rounded-full">
          {props.allocation}
        </span>
      )}
      <p
        class={`text-sm text-gray-600 dark:text-gray-400 ${props.allocation ? "pt-0" : "pt-10"
          }`}
      >
        {props.sub}
      </p>

      {/* <p class="text-sm text-gray-600 dark:text-gray-400">
        {props.sub}
      </p> */}

      <ProgressBar value={props.pctValue} max={props.pctMax} />
    </Card>
  );
}

// --- Campaign Table -----------------------------------------------------------
function CampaignTable(props) {
  const colHeads = ["Campaign", "Status", "Spend", "Budget Cap", "Leads", "CPL"];

  const totalSpend = () => props.campaigns.reduce((s, c) => s + c.spend, 0);
  const totalLeads = () => props.campaigns.reduce((s, c) => s + c.leads, 0);
  const totalCPL = () => totalLeads() > 0 ? Math.round(totalSpend() / totalLeads()) : 0;

  return (
    <div class="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition">
      <table class="w-full text-base">
        <thead>
          <tr class="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <For each={colHeads}>
              {(h) => (
                <th class={`py-3 px-4 text-md font-semibold text-gray-500 dark:text-gray-400 ${h === "Campaign" ? "text-left" : "text-center"}`}>
                  {h}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.campaigns}>
            {(c, i) => (
              <tr class={`group transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 ${i() < props.campaigns.length - 1 ? "border-b border-gray-100 dark:border-gray-700" : ""}`}>
                {/* Campaign */}
                <td class="py-4 px-4">
                  <p class="font-semibold text-sm md:text-base text-gray-800 dark:text-gray-100">
                    {c.name}
                  </p>
                  <p class="text-xs text-gray-400 dark:text-gray-600 mt-0.5 truncate max-w-xs" title={c.fullName}>
                    {c.fullName}
                  </p>
                  {/* <span class="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                    {c.result}
                  </span> */}
                </td>
                {/* Status */}
                <td class="py-4 px-4 text-center">
                  <span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${c.status === "active" ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"}`}>
                    {c.status === "active" ? "● Active" : "⏸ Paused"}
                  </span>
                </td>
                {/* Spend */}
                <td class="py-4 px-4 text-center text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">
                  {fmt(c.spend)}
                </td>
                {/* Budget Cap */}
                <td class="py-4 px-4 text-center text-sm md:text-base text-gray-600 dark:text-gray-400">
                  {fmt(c.budgetCap)}
                </td>
                {/* Leads */}
                <td class="py-4 px-4 text-center text-sm md:text-base font-semibold text-gray-800 dark:text-gray-200">
                  {c.leads.toLocaleString()}
                </td>
                {/* CPL */}
                <td class="py-4 px-4 text-right text-sm md:text-base font-semibold text-indigo-600 dark:text-indigo-400">
                  {c.cpl > 0 ? fmt(c.cpl) : "—"}
                </td>
              </tr>
            )}
          </For>
        </tbody>
        <tfoot>
          <tr class="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
            <td class="py-4 px-4 text-xs font-bold uppercase tracking-wider text-gray-500">Total</td>
            <td></td>
            <td class="py-4 px-4 text-center text-sm md:text-base font-bold text-gray-900 dark:text-white">{fmt(totalSpend())}</td>
            <td></td>
            <td class="py-4 px-4 text-center text-sm md:text-base font-bold text-gray-900 dark:text-white">{totalLeads().toLocaleString()}</td>
            <td class="py-4 px-4 text-right text-sm md:text-base font-bold text-indigo-600 dark:text-indigo-400">{fmt(totalCPL())}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Replace ProjectRow with this ProjectTable component
function ProjectTable(props) {
  const [sortKey, setSortKey] = createSignal("");
  const [sortDir, setSortDir] = createSignal("desc");

  const textCols = new Set(["name", "status"]);

  const handleSort = (key) => {
    if (sortKey() === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(textCols.has(key) ? "asc" : "desc");
    }
  };

  const sortIcon = (key) => {
    if (sortKey() !== key) return "⇅";
    return sortDir() === "asc" ? "↑" : "↓";
  };

  const sorted = createMemo(() => {
    const key = sortKey();
    const dir = sortDir();
    return [...props.projects].sort((a, b) => {
      let va, vb;
      if (key === "name") { va = a.name; vb = b.name; }
      else if (key === "status") { va = a.status; vb = b.status; }
      else if (key === "campaigns") { va = a.campaigns.length; vb = b.campaigns.length; }
      else if (key === "leads") { va = a.totalLeads; vb = b.totalLeads; }
      else if (key === "budget") { va = a.budgetAllocated; vb = b.budgetAllocated; }
      else if (key === "spent") { va = a.totalSpend; vb = b.totalSpend; }
      else if (key === "cpl") { va = a.avgCPL; vb = b.avgCPL; }
      else return 0;
      if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return dir === "asc" ? va - vb : vb - va;
    });
  });

  const totals = createMemo(() => ({
    campaigns: props.projects.reduce((s, p) => s + p.campaigns.length, 0),
    leads: props.projects.reduce((s, p) => s + p.totalLeads, 0),
    budget: props.projects.reduce((s, p) => s + p.budgetAllocated, 0),
    spent: props.projects.reduce((s, p) => s + p.totalSpend, 0),
    cpl: (() => {
      const tl = props.projects.reduce((s, p) => s + p.totalLeads, 0);
      const ts = props.projects.reduce((s, p) => s + p.totalSpend, 0);
      return tl > 0 ? Math.round(ts / tl) : 0;
    })(),
  }));

  const thClass = "py-3 px-4 text-md font-semibold text-gray-700 dark:text-gray-400  cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-200 transition-colors";

  return (
    <div class="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <th class={`${thClass} text-left`} onClick={() => handleSort("name")}>Project name {sortIcon("name")}</th>
            <th class={`${thClass} text-center`} onClick={() => handleSort("campaigns")}>Campaigns {sortIcon("campaigns")}</th>
            <th class={`${thClass} text-center`} onClick={() => handleSort("leads")}>Total leads {sortIcon("leads")}</th>
            <th class={`${thClass} text-center`} onClick={() => handleSort("budget")}>Budget allocated {sortIcon("budget")}</th>
            <th class={`${thClass} text-center`} onClick={() => handleSort("spent")}>Total spent {sortIcon("spent")}</th>
            <th class={`${thClass} text-right`} onClick={() => handleSort("cpl")}>Avg CPL {sortIcon("cpl")}</th>
          </tr>
        </thead>
        <tbody>
          <For each={sorted()}>
            {(p, i) => (
              <tr class={`transition-all hover:bg-blue-50 dark:hover:bg-gray-800/60 ${i() < sorted().length - 1 ? "border-b border-gray-100 dark:border-gray-700" : ""}`}>
                <td class="py-3 px-4">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-900 to-blue-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                      {p.name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p class="font-semibold text-gray-900 dark:text-white text-sm">{p.name}</p>
                      <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{p.campaigns.length} campaign{p.campaigns.length !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                </td>

                <td class="py-3 px-4 text-center font-medium text-gray-700 dark:text-gray-300">{p.campaigns.length}</td>
                <td class="py-3 px-4 text-center font-semibold text-gray-800 dark:text-gray-200">{p.totalLeads.toLocaleString()}</td>
                <td class="py-3 px-4 text-center text-gray-600 dark:text-gray-400">{fmt(p.budgetAllocated)}</td>
                <td class="py-3 px-4 text-center font-medium text-gray-700 dark:text-gray-300">{fmt(p.totalSpend)}</td>
                <td class="py-3 px-4 text-right font-semibold text-indigo-600 dark:text-indigo-400">{p.avgCPL > 0 ? fmt(p.avgCPL) : "—"}</td>
              </tr>
            )}
          </For>
        </tbody>
        <tfoot>
          <tr class="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
            <td class="py-3 px-4 text-xs font-bold uppercase tracking-wider text-gray-500">Total</td>
            <td class="py-3 px-4 text-center font-bold text-gray-900 dark:text-white">{totals().campaigns}</td>
            <td class="py-3 px-4 text-center font-bold text-gray-900 dark:text-white">{totals().leads.toLocaleString()}</td>
            <td class="py-3 px-4 text-center font-bold text-gray-900 dark:text-white">{fmt(totals().budget)}</td>
            <td class="py-3 px-4 text-center font-bold text-gray-900 dark:text-white">{fmt(totals().spent)}</td>
            <td class="py-3 px-4 text-right font-bold text-indigo-600 dark:text-indigo-400">{fmt(totals().cpl)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// --- CPL Comparison Panel -----------------------------------------------------
function CPLComparisonPanel(props) {

}

// --- Payment History ----------------------------------------------------------
function PaymentHistory(props) {
  return (
    <Card class="p-5 space-y-4">
      <SectionLabel>Payment History</SectionLabel>
      <div class="space-y-3">
        <For each={props.payments}>
          {(pay) => (
            <div class={`rounded-xl border p-4 space-y-2 ${pay.credit ? "border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30" : "border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-800/20"}`}>
              <div class="flex items-start justify-between gap-3 flex-wrap">
                <div class="flex items-center gap-3">
                  <div class={`w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${pay.credit ? "bg-gray-100 dark:bg-gray-800 text-gray-500" : "bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900"}`}>
                    {pay.credit ? "📋" : "✓"}
                  </div>
                  <div>
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-semibold text-gray-900 dark:text-gray-100">{fmt(pay.amount)}</span>
                      <Show when={pay.credit} fallback={<Tag
                        variant={
                          pay.status === "succeeded"
                            ? "green"
                            : pay.status === "pending"
                              ? "amber"
                              : "red"
                        }
                      >
                        {pay.status_label || pay.status?.toUpperCase()}
                      </Tag>}>
                        <Tag variant="gray">CREDITED by {pay.creditedBy}</Tag>
                      </Show>
                      <Show when={pay.gstFiled}>
                        <Tag variant="blue">GST Filed</Tag>
                      </Show>
                    </div>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      {pay.credit ? `Credited on ${pay.creditDate} by ${pay.creditedBy}` : `${pay.date} · via ${pay.method} · ${pay.id}`}
                    </p>
                  </div>
                </div>
                <Show when={!pay.credit}>
                  <button
                    onClick={() => props.onViewInvoice(pay)} class="flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Invoice
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </Card>
  );
}

// --- Delivery Breakdown -------------------------------------------------------
function DeliveryBreakdown(props) {
  const totalExGST = props.deliveries.reduce((s, d) => s + d.amountExGST, 0);
  const totalWithGST = props.deliveries.reduce((s, d) => s + d.amountWithGST, 0);
  const totalLeads = props.deliveries.reduce((s, d) => s + d.leads, 0);
  const remaining = props.totalPaid - totalWithGST;

  return (
    <Card class="p-5 space-y-4">
      <SectionLabel>Delivery Breakdown</SectionLabel>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-100 dark:border-gray-700">
              <th class="pb-2.5 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left pr-4">Project</th>
              {/* <th class="pb-2.5 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Leads</th> */}
              <th class="pb-2.5 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Amount (ex-GST)</th>
              <th class="pb-2.5 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">With GST (18%)</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.deliveries}>
              {(d) => (
                <tr class="border-b border-gray-50 dark:border-gray-700">
                  <td class="py-2.5 pr-4 font-medium text-gray-800 dark:text-gray-200">{d.project}</td>
                  {/* <td class="py-2.5 text-center text-gray-600 dark:text-gray-400">{d.leads}</td> */}
                  <td class="py-2.5 text-center text-gray-600 dark:text-gray-400">{fmt(d.amountExGST)}</td>
                  <td class="py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">{fmt(d.amountWithGST)}</td>
                </tr>
              )}
            </For>
          </tbody>
          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 font-bold text-gray-900 dark:text-gray-100">
              <td class="pt-3">Total</td>
              {/* <td class="pt-3 text-center">{totalLeads}</td> */}
              <td class="pt-3 text-center">{fmt(totalExGST)}</td>
              <td class="pt-3 text-right text-base">{fmt(totalWithGST)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="flex flex-wrap justify-between items-center pt-3 border-t border-gray-100 dark:border-gray-700 gap-2">
        <span class="text-sm text-gray-500 dark:text-gray-400">Remaining: {fmt(props.totalPaid)} – {fmt(totalWithGST)}</span>
        <span class="text-sm font-bold text-green-600 dark:text-green-400">{fmt(remaining)}</span>
      </div>
    </Card>
  );
}



// --- Add Funds Modal ----------------------------------------------------------
function AddFundsModal(props) {
  const [amount, setAmount] = createSignal("");
  const [method, setMethod] = createSignal("UPI");
  const quickAmounts = [50000, 100000, 200000, 500000];
  const methods = ["UPI", "Bank Transfer", "Credit Card", "Cheque"];
  const totalWithGST = () => amount() ? Math.round(Number(amount()) * 1.18) : null;

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) props.onClose(); };

  return (
    <div
      class={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${props.open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      style={{ background: "rgba(0,0,0,0.45)", "backdrop-filter": "blur(4px)" }}
      onClick={handleBackdrop}
    >
      <div class={`w-full max-w-md transition-all duration-200 ${props.open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"}`}>
        <Card class="p-6 space-y-5 shadow-2xl">
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-bold text-gray-900 dark:text-gray-100 text-lg">Add Funds</h3>
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Powered by HDFC Payment Gateway</p>
            </div>
            <button onClick={props.onClose} class="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-semibold text-gray-600 dark:text-gray-400">Amount (INR, ex-GST)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-600 font-bold select-none">₹</span>
              <input
                type="number"
                placeholder="0"
                value={amount()}
                onInput={(e) => setAmount(e.currentTarget.value)}
                class="w-full pl-8 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-lg focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600 placeholder-gray-300 dark:placeholder-gray-700"
              />
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              +18% GST · You pay: <span class="font-semibold text-gray-700 dark:text-gray-400">{totalWithGST() ? fmt(totalWithGST()) : "—"}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <For each={quickAmounts}>
              {(a) => (
                <button
                  onClick={() => setAmount(String(a))}
                  class={`text-sm font-semibold px-3 py-1.5 rounded-lg border transition-colors ${String(amount()) === String(a) ? "bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 border-transparent" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400"}`}
                >
                  {fmt(a)}
                </button>
              )}
            </For>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-semibold text-gray-600 dark:text-gray-400">Payment Method</label>
            <div class="grid grid-cols-4 gap-2">
              <For each={methods}>
                {(m) => (
                  <button
                    onClick={() => setMethod(m)}
                    class={`text-[11px] font-semibold py-2 px-1 rounded-xl border transition-colors text-center ${method() === m ? "bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 border-transparent" : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"}`}
                  >
                    {m}
                  </button>
                )}
              </For>
            </div>
          </div>
          <button
            disabled={!amount() || Number(amount()) <= 0}
            class="w-full py-3 rounded-2xl bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 font-bold text-sm hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {totalWithGST() ? `Proceed to Pay ${fmt(totalWithGST())} →` : "Enter Amount to Continue"}
          </button>
        </Card>
      </div>
    </div>
  );
}

function InvoiceModal(props) {
  const gst = () => props.invoice?.gstAmount || 0;
  const total = () => props.invoice?.amount || 0;

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  return (
    <div
      class={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${props.open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      style={{ background: "rgba(0,0,0,0.45)", "backdrop-filter": "blur(4px)" }}
      onClick={handleBackdrop}
    >
      <div
        class={`w-full max-w-md transition-all duration-200 ${props.open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
          }`}
      >
        <Card class="p-6 space-y-5 shadow-2xl">

          {/* ── Header ── */}
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-bold text-gray-900 dark:text-gray-100 text-lg">Invoice</h3>
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                {props.invoice?.id ?? "—"}
              </p>
            </div>
            <button
              onClick={props.onClose}
              class="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── Issued by / Date row ── */}
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-0.5">
              <p class="text-sm font-semibold text-gray-600 dark:text-gray-400">Issued by</p>
              <p class="text-sm font-bold text-gray-900 dark:text-gray-100">Aajneeti Connect Ltd.</p>
              <p class="text-xs text-gray-500 dark:text-gray-500">Delhi, India</p>
            </div>
            <div class="text-right space-y-0.5">
              <p class="text-sm font-semibold text-gray-600 dark:text-gray-400">Payment Date</p>
              <p class="text-sm font-bold text-gray-900 dark:text-gray-100">
                {props.invoice?.date ?? "—"}
              </p>
            </div>
          </div>

          {/* ── Amount Breakdown ── */}
          <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {[
              { label: "Base Amount", value: props.invoice?.baseAmount ?? 0 },
              { label: `GST (${props.invoice?.gstLabel || "18%"})`, value: gst() },
            ].map(({ label, value }) => (
              <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <span class="text-sm text-gray-600 dark:text-gray-400">{label}</span>
                <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">{fmt(value)}</span>
              </div>
            ))}
            <div class="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/60">
              <span class="text-sm font-bold text-gray-900 dark:text-gray-100">Total</span>
              <span class="text-base font-bold text-gray-900 dark:text-gray-100">{fmt(total())}</span>
            </div>
          </div>

          {/* ── Status ── */}
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <p class="text-sm font-semibold text-gray-600 dark:text-gray-400">Payment Status</p>
              <Tag
                variant={
                  props.invoice?.status === "succeeded" ? "green"
                    : props.invoice?.status === "pending" ? "amber"
                      : "red"
                }
              >
                {props.invoice?.status?.toUpperCase() ?? "—"}
              </Tag>
            </div>
            <button
              onClick={() => window.print()}
              class="flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Invoice
            </button>
          </div>

          {/* ── Primary CTA ── */}
          <button
            onClick={props.onClose}
            class="w-full py-3 rounded-2xl bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 font-bold text-sm hover:opacity-85 transition-opacity"
          >
            Done
          </button>

        </Card>
      </div>
    </div>
  );
}

// --- Skeleton Loader ----------------------------------------------------------
// function Skeleton() {
//   return (
//     <div class="space-y-4 animate-pulse">
//       <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
//         {[1, 2, 3, 4].map(() => <div class="h-28 rounded-xl bg-gray-100 dark:bg-gray-800" />)}
//       </div>
//       <div class="h-40 rounded-xl bg-gray-100 dark:bg-gray-800" />
//       <div class="h-64 rounded-xl bg-gray-100 dark:bg-gray-800" />
//     </div>
//   );
// }

// --- Root Component -----------------------------------------------------------
export default function Billing() {
  const [tab, setTab] = createSignal("overview");
  const [showModal, setShowModal] = createSignal(false);
  const [selectedInvoice, setSelectedInvoice] = createSignal(null);
  const [showInvoiceModal, setShowInvoiceModal] = createSignal(false);
  const [paymentsData] = createResource(fetchPaymentsDetails);



  const payments = createMemo(() => {
    const apiData = paymentsData()?.data || [];

    return apiData.map((item) => ({
      id: `PAY-${item.id}`,

      date: new Date(item.paid_at).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),

      // updated field
      amount: parseFloat(item.final_amount || 0),

      // optional extra fields from latest API
      baseAmount: parseFloat(item.base_amount || 0),

      gstPct: item.gst_pct,

      gstLabel: item.gst_pct_label,

      gstAmount: parseFloat(item.gst_amount || 0),

      includingGst: parseFloat(item.including_gst || 0),

      method: item.method_label || item.method,

      status: item.status,

      statusLabel: item.status_label,

      gstFiled: false,

      invoiceUrl: "#",

      credit: false,

      creditedBy: null,
 
      creditDate: null,
    }));
  });

  const totalReceived = createMemo(() => {
    return payments().reduce((sum, payment) => {
      return sum + (payment.amount || 0);
    }, 0);
  });

  // ✅ Single combined resource — fires overview + projects in parallel
  // ✅ Replace createResource with a manual effect that respects cache
  onMount(async () => {
    if (!isCacheStale(billingCache.lastFetched)) return; // already fresh

    setBillingCache("loading", true);
    try {
      const [overviewRes, projectsRes] = await Promise.all([
        fetchBillingOverview(),
        fetchAllProjectsBilling(),
      ]);
      setBillingCache({
        overview: overviewRes?.data || {},
        projects: projectsRes.map(({ projectMeta, billing }) =>
          transformProject(billing, projectMeta)
        ),
        lastFetched: Date.now(),
        loading: false,
      });
    } catch (err) {
      console.error(err);
      setBillingCache("loading", false);
    }
  });

  // ✅ Derived accessors from single resource
  const overview = () => billingCache.overview;
  const projects = () => billingCache.projects;
  const isLoading = () => billingCache.loading;

  const totalLeads = createMemo(() => projects().reduce((s, p) => s + p.totalLeads, 0));
  const totalSpend = createMemo(() => projects().reduce((s, p) => s + p.totalSpend, 0).toFixed(2));
  const overallCPL = createMemo(() => totalLeads() > 0 ? parseFloat((totalSpend() / totalLeads()).toFixed(2)) : 0);

  const budgetCommitted = () => parseFloat(overview().total_budget).toFixed(2) || 0;
  const budgetUtilized = () => parseFloat(overview().utilized).toFixed(2) || 0;
  const budgetRemaining = () => parseFloat(overview().remaining).toFixed(2) || 0;
  const pendingPayment = () => parseFloat(overview().pending_payment).toFixed(2) || 0;
  const utilizationPct = () => parseFloat(overview().utilization_percentage).toFixed(2) || 0;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "payments", label: "Payments & Invoices" },
  ];

  return (
    <div class="min-h-screen bg-white p-6 dark:bg-gray-900 text-gray-800 dark:text-gray-200 transition-all duration-300">
      {/* Header */}
      <header>
        <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-3">
          <div>
            <h1 class="text-2xl font-semibold mb-1">Billing</h1>
            <p class="text-md text-gray-700 dark:text-gray-400">Manage your billing and payment information.</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            class="flex items-center gap-2 px-4 py-3 text-sm font-medium rounded bg-blue-900 dark:bg-blue-800 text-white shadow-sm hover:bg-blue-800 active:scale-95 transition-all duration-200"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            <span>Add Funds</span>
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div class="mx-auto flex gap-1 mb-2">
        <For each={tabs}>
          {(t) => (
            <button
              onClick={() => setTab(t.id)}
              class={`text-md font-semibold px-4 py-2.5 border-b-2 transition-colors ${tab() === t.id ? "border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100" : "border-transparent text-gray-400 hover:text-gray-600"}`}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>

      {/* ══ OVERVIEW TAB ══ */}
      <Show when={tab() === "overview"}>
        <div class="space-y-6">
          <div class="flex items-center gap-2 text-sm font-medium bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2.5 mt-3">
            All amounts shown <span class="font-semibold text-gray-800 dark:text-gray-200 mx-1">excluding GST (18%)</span> unless stated otherwise.
          </div>

          {/* ✅ Single loading gate for everything */}
          <div
            class={`transition-all duration-500 rounded-2xl
  ${isLoading()
                ? "animate-pulse shadow-inner"
                : ""
              }`}
          >
            <section>
              <SectionLabel>Budget Overview</SectionLabel>

              <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <BudgetCard
                  label="Budget Committed"
                  value={budgetCommitted()}
                  icon={
                    <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
                      <svg
                        class="w-5 h-5 text-blue-600 dark:text-blue-800"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                        />
                      </svg>
                    </div>
                  }
                  allocation="Monthly Allocation"
                  sub="Total contracted"
                  pctValue={budgetCommitted()}
                  pctMax={budgetCommitted()}
                />

                <BudgetCard
                  label="Budget Utilized"
                  value={budgetUtilized()}
                  icon={
                    <div class="p-3 rounded-lg bg-purple-100 dark:bg-purple-300">
                      <svg
                        class="w-5 h-5 text-purple-600 dark:text-purple-800"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M3 3v18h18" />
                        <path d="M18 17l-5-5-4 4-3-3" />
                      </svg>
                    </div>
                  }
                  sub={`${utilizationPct()}% of committed`}
                  pctValue={budgetUtilized()}
                  pctMax={budgetCommitted()}
                />

                <BudgetCard
                  label="Remaining Balance"
                  value={budgetRemaining()}
                  icon={
                    <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
                      <svg
                        class="w-5 h-5 text-blue-600 dark:text-blue-800"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 3" />
                      </svg>
                    </div>
                  }
                  sub="Available to spend"
                  pctValue={budgetRemaining()}
                  pctMax={budgetCommitted()}
                />

                <BudgetCard
                  label="Pending Payment"
                  value={pendingPayment()}
                  icon={
                    <div class="p-3 rounded-lg bg-red-100 dark:bg-red-300">
                      <svg
                        class="w-5 h-5 text-red-600 dark:text-red-800"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  }
                  sub={
                    pendingPayment() > 0
                      ? "Due immediately"
                      : "No dues outstanding"
                  }
                  pctValue={pendingPayment()}
                  pctMax={budgetCommitted()}
                />
              </div>
            </section>
          </div>
          <div
            class={`transition-all duration-500 rounded-2xl
  ${isLoading()
                ? "animate-pulse shadow-inner"
                : ""
              }`}
          >
            <div class="grid grid-cols-3 gap-3">
              <Card class="p-4 text-center">
                <p class="text-md text-gray-700 dark:text-gray-400 font-medium">Total Leads</p>
                <p class="text-xl font-bold mt-1 text-gray-700 dark:text-gray-400">{totalLeads()}</p>
              </Card>
              <Card class="p-4 text-center">
                <p class="text-md text-gray-700 dark:text-gray-400 font-medium">Total Spend (ex-GST)</p>
                <p class="text-xl font-bold mt-1 text-gray-700 dark:text-gray-400">{fmt(totalSpend())}</p>
              </Card>
              <Card class="p-4 text-center">
                <p class="text-md text-gray-700 dark:text-gray-400 font-medium">Overall Avg CPL</p>
                <p class="text-xl font-bold mt-1 text-gray-900 dark:text-gray-100">{fmt(overallCPL())}</p>
              </Card>
            </div>
          </div>
          <section>
            <SectionLabel>Project-wise Budget Breakdown</SectionLabel>
            <ProjectTable projects={projects()} />
          </section>
        </div>
      </Show>

      {/* ══ PAYMENTS TAB ══ */}
      <Show when={tab() === "payments"}>
        <div class="space-y-5">
          <div class="flex items-center justify-between">
            <SectionLabel>Payment & Invoice Tracking</SectionLabel>
            <span class="text-sm text-gray-400">Managed by Accounts Team</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card class="p-4">
              <p class="text-md text-gray-600 dark:text-gray-400">
                Total Received
              </p>
              <p class="text-xl font-bold mt-2 text-gray-900 dark:text-white">
                {fmt(totalReceived())}
              </p>
            </Card>
            <Card class="p-4">
              <p class="text-md text-gray-600 dark:text-gray-400">Total Utilized</p>
              <p class="text-xl font-bold mt-2 text-gray-900 dark:text-gray-100">0</p>
            </Card>
            <Card class="p-4">
              <p class="text-md text-gray-600 dark:text-gray-400">Remaining Balance</p>
              <p class="text-xl font-bold mt-2 text-green-600 dark:text-green-400">0</p>
            </Card>
            <Card class="p-4">
              <p class="text-md text-gray-600 dark:text-gray-400">Pending Payment</p>
              <p class="text-xl font-bold mt-2 text-gray-900 dark:text-gray-100">0</p>
            </Card>
          </div>
          <Show
            when={!paymentsData.loading}
            fallback={
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Loading payments...
              </p>
            }
          >
            <PaymentHistory
              payments={payments()}
              onViewInvoice={(payment) => {
                setSelectedInvoice(payment);
                setShowInvoiceModal(true);
              }}
            />
          </Show>
          {/* <DeliveryBreakdown deliveries={MOCK_DELIVERIES} totalPaid={budgetCommitted()} /> */}
        </div>
      </Show>

      <AddFundsModal open={showModal()} onClose={() => setShowModal(false)} />
      <InvoiceModal
        open={showInvoiceModal()}
        invoice={selectedInvoice()}
        onClose={() => setShowInvoiceModal(false)}
      />
    </div>
  );
}