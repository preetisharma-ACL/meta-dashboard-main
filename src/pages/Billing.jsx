import { createSignal, createMemo, For, Show } from "solid-js";


// ─── Mock Data ────────────────────────────────────────────────────────────────
const MOCK = {
    client: "Acme Corp Pvt Ltd",
    gstRate: 0.18,
    budgetCommitted: 500000,
    totalPaid: 100000,
    totalSpent: 64900,
    pendingPayment: 0,
    nextBillingDate: "28 March 2025",

    projects: [
        {
            id: "p1",
            name: "Birla",
            proposedCPL: 500,
            qualificationPct: 50,
            deliveredLeads: 30,
            budgetAllocated: 50000,
            qualifiedLeads: 25,
            campaigns: [
                { id: "c1", name: "Birla 1", spend: 8500, dailyAvg: 850, budgetCap: 15000, leads: 17, result: "Lead" },
                { id: "c2", name: "Birla 2", spend: 16500, dailyAvg: 1650, budgetCap: 20000, leads: 33, result: "Lead" },
            ],
        },
        {
            id: "p2",
            name: "Prestige",
            proposedCPL: 1000,
            qualificationPct: 60,
            deliveredLeads: 30,
            budgetAllocated: 80000,
            qualifiedLeads: 18,
            campaigns: [
                { id: "c3", name: "Prestige 1", spend: 19000, dailyAvg: 1900, budgetCap: 40000, leads: 19, result: "Lead" },
                { id: "c4", name: "Prestige 2", spend: 11000, dailyAvg: 1100, budgetCap: 25000, leads: 11, result: "Lead" },
            ],
        },
    ],

    payments: [
        { id: "INV-002", date: "28 Feb 2025", amount: 100000, method: "UPI", status: "paid", gstFiled: true, invoiceUrl: "#", credit: false, creditedBy: null, creditDate: null },
        { id: "INV-001", date: "11 Jan 2025", amount: 100000, method: null, status: "credit", gstFiled: false, invoiceUrl: "#", credit: true, creditedBy: "ACL", creditDate: "21 Feb 2025" },
    ],

    deliveries: [
        { project: "Project 1", leads: 50, amountExGST: 25000, amountWithGST: 29500 },
        { project: "Project 2", leads: 30, amountExGST: 30000, amountWithGST: 35400 },
    ],

    alerts: [
        { id: "a1", type: "warning", label: "Low Balance Alert", desc: "Trigger when remaining balance falls below 10% of committed budget.", activeMsg: "Budget utilization at 62% — review campaign pacing.", defaultOn: true },
        { id: "a2", type: "warning", label: "Budget Exhaustion Alert", desc: "Alert when any campaign reaches 95% of its cap.", activeMsg: null, defaultOn: true },
        { id: "a3", type: "info", label: "Payment Due Reminder", desc: "Remind 7 days before next billing cycle.", activeMsg: "Next billing cycle: 28 March 2025", defaultOn: true },
        { id: "a4", type: "caution", label: "CPL Threshold Alert", desc: "Alert when actual CPL exceeds proposed CPL for any project.", activeMsg: null, defaultOn: false },
        { id: "a5", type: "success", label: "CPL On-Target Notification", desc: "Notify when CPL is within the agreed threshold.", activeMsg: "CPL within threshold for all active campaigns.", defaultOn: true },
    ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n) => "₹" + Number(n).toLocaleString("en-IN");
const pct = (a, b) => (b === 0 ? 0 : Math.min(100, Math.round((a / b) * 100)));

// ─── Primitive UI Components ──────────────────────────────────────────────────

function SectionLabel(props) {
    return (
        <p class="text-md font-semibold text-gray-600 dark:text-gray-400 mb-3 mt-4 ">
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

// ─── CPL Indicator ────────────────────────────────────────────────────────────
function CPLIndicator(props) {
    const isOver = () => props.actual > props.proposed;
    return (
        <div class="space-y-1">
            <div class="flex justify-between text-sm">
                <span class="text-gray-500 dark:text-gray-400">vs Proposed {fmt(props.proposed)}</span>
                {/* <span class={isOver() ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-green-600 dark:text-green-400 font-semibold"}>
                    {isOver()
                        ? `+${Math.round(((props.actual / props.proposed) - 1) * 100)}% over cap`
                        : `✓ ${pct(props.actual, props.proposed)}% of cap`}
                </span> */}
            </div>
        </div>
    );
}

// ─── Budget Card ──────────────────────────────────────────────────────────────
function BudgetCard(props) {
    return (
        <Card class="p-5 space-y-3 shadow-lg">
            <div class="flex items-start justify-between">
                <div class="space-y-0.5">
                    <p class="text-md text-gray-700 dark:text-gray-400  font-semibold ">{props.label}</p>
                    <p class="text-lg font-bold  text-gray-800 dark:text-gray-100 ">{fmt(props.value)}</p>
                </div>
                <span class="text-2xl">{props.icon}</span>
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-400">{props.sub}</p>
            <ProgressBar value={props.pctValue} max={props.pctMax} />
        </Card>
    );
}

// ─── Campaign Table ───────────────────────────────────────────────────────────
function CampaignTable(props) {
    const colHeads = ["Campaign", "Spend", "Daily Avg", "Budget Cap", "Leads", "CPL"];

    const totalSpend = () => props.campaigns.reduce((s, c) => s + c.spend, 0);
    const totalLeads = () => props.campaigns.reduce((s, c) => s + c.leads, 0);
    const totalCPL = () => totalLeads() > 0 ? Math.round(totalSpend() / totalLeads()) : 0;

    return (
        <div class="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700
                bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition">

            <table class="w-full text-base">

                {/* ── Head ── */}
                <thead>
                    <tr class="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                        <For each={colHeads}>
                            {(h) => (
                                <th class={`py-3 px-4 text-md font-semibold 
                            text-gray-500 dark:text-gray-400
                            ${h === "Campaign" ? "text-left" : "text-center"}`}>
                                    {h}
                                </th>
                            )}
                        </For>
                    </tr>
                </thead>

                {/* ── Body ── */}
                <tbody>
                    <For each={props.campaigns}>
                        {(c, i) => {
                            const cpl = c.leads > 0 ? Math.round(c.spend / c.leads) : 0;

                            return (
                                <tr class={`group transition-all duration-200
                            hover:bg-gray-50 dark:hover:bg-gray-800/60
                            ${i() < props.campaigns.length - 1
                                        ? "border-b border-gray-100 dark:border-gray-700"
                                        : ""}`}>

                                    {/* Campaign */}
                                    <td class="py-4 px-4">
                                        <p class="font-semibold text-sm md:text-base text-gray-800 dark:text-gray-100">
                                            {c.name}
                                        </p>

                                        <span class="inline-block mt-1 px-2.5 py-0.5 rounded-full
                                 text-xs font-medium
                                 bg-purple-100 dark:bg-purple-900/30
                                 text-purple-700 dark:text-purple-400">
                                            {c.result}
                                        </span>
                                    </td>

                                    {/* Spend */}
                                    <td class="py-4 px-4 text-center text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">
                                        {fmt(c.spend)}
                                    </td>

                                    {/* Daily Avg */}
                                    <td class="py-4 px-4 text-center text-sm md:text-base text-gray-500 dark:text-gray-400">
                                        {fmt(c.dailyAvg)}
                                    </td>

                                    {/* Budget Cap */}
                                    <td class="py-4 px-4 text-center">
                                        <span class="block text-sm md:text-base text-gray-600 dark:text-gray-400">
                                            {fmt(c.budgetCap)}
                                        </span>


                                    </td>

                                    {/* Leads */}
                                    <td class="py-4 px-4 text-center text-sm md:text-base font-semibold text-gray-800 dark:text-gray-200">
                                        {c.leads.toLocaleString()}
                                    </td>

                                    {/* CPL */}
                                    <td class="py-4 px-4 text-right text-sm md:text-base font-semibold text-indigo-600 dark:text-indigo-400">
                                        {fmt(cpl)}
                                    </td>

                                </tr>
                            );
                        }}
                    </For>
                </tbody>

                {/* ── Footer ── */}
                <tfoot>
                    <tr class="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">

                        <td class="py-4 px-4 text-xs font-bold uppercase tracking-wider text-gray-500">
                            Total
                        </td>

                        <td class="py-4 px-4 text-center text-sm md:text-base font-bold text-gray-900 dark:text-white">
                            {fmt(totalSpend())}
                        </td>

                        <td class="py-4 px-4 text-right text-gray-400">—</td>

                        <td></td>

                        <td class="py-4 px-4 text-center text-sm md:text-base font-bold text-gray-900 dark:text-white">
                            {totalLeads().toLocaleString()}
                        </td>

                        <td class="py-4 px-4 text-right text-sm md:text-base font-bold text-indigo-600 dark:text-indigo-400">
                            {fmt(totalCPL())}
                        </td>

                    </tr>
                </tfoot>

            </table>
        </div>
    );
}

// ─── CPL Calculation Block ────────────────────────────────────────────────────
// function CPLBlock(props) {
//     return (
//         <div class="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-4 space-y-3">
//             <SectionLabel>CPL Calculation (ex-GST)</SectionLabel>
//             <div class="flex flex-wrap gap-4 items-center">
//                 <div>
//                     <p class="text-sm text-gray-600 dark:text-gray-400">Total Leads</p>
//                     <p class="text-2xl font-bold  text-gray-900 dark:text-gray-100">{props.totalLeads}</p>
//                 </div>
//                 <span class="text-gray-500 dark:text-gray-700 text-xl">÷</span>
//                 <div>
//                     <p class="text-sm text-gray-600 dark:text-gray-400">Total Spend</p>
//                     <p class="text-2xl font-bold  text-gray-900 dark:text-gray-100">{fmt(props.totalSpend)}</p>
//                 </div>
//                 <span class="text-gray-500 dark:text-gray-700 text-xl">=</span>
//                 <div>
//                     <p class="text-sm text-gray-600 dark:text-gray-400">Actual CPL</p>
//                     <p class="text-2xl font-bold  text-gray-900 dark:text-gray-100">{fmt(props.cpl)}</p>
//                 </div>
//                 <div class="ml-auto text-right">
//                     <p class="text-sm text-gray-4600 dark:text-gray-400">Proposed CPL</p>
//                     <p class={`text-2xl font-bold  ${props.cpl <= props.proposedCPL ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
//                         {fmt(props.proposedCPL)}
//                     </p>
//                 </div>
//             </div>
//             <CPLIndicator actual={props.cpl} proposed={props.proposedCPL} />
//         </div>
//     );
// }

// ─── Qualification Logic Block ────────────────────────────────────────────────
function QualBlock(props) {

    const totalLeads = () =>
        props.project.campaigns.reduce((s, c) => s + c.leads, 0);

    const commitment = () => Number(props.project.qualificationPct);

    const requiredQualified = () =>
        Math.round(totalLeads() * (commitment() / 100));

    const deliveredLeads = () =>
        props.project.campaigns.reduce((s, c) => s + c.leads, 0);


    const qualifiedLeads = () => props.project.qualifiedLeads;

    const isCommitmentMet = () =>
        qualifiedLeads() >= requiredQualified();

    const remainingLeads = () =>
        isCommitmentMet()
            ? 0
            : requiredQualified() - qualifiedLeads();

    const colorMap = {
        blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
        purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
        green: "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400",
        amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
        red: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
    };

    return (

        <>
            <Show when={true}>
                {/* Header */}
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-lg font-semibold text-gray-800 dark:text-white">
                        Qualification Summary
                    </h2>
                    <span
                        class="text-sm px-4 py-1 rounded-full font-medium"
                        classList={{
                            "bg-green-100 text-green-700": isCommitmentMet(),
                            "bg-yellow-100 text-yellow-700": !isCommitmentMet(),
                        }}
                    >
                        {isCommitmentMet() ? "Completed" : "In Progress"}
                    </span>
                </div>
                {/* Cards */}
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

                    {/* Card */}
                    {[
                        { label: "Total Required", value: totalLeads() },
                        { label: "Delivered", value: deliveredLeads() },
                        { label: "Commitment", value: `${commitment()}%` },
                        { label: "Target Qualified", value: requiredQualified(), color: "text-blue-600" },
                        { label: "Achieved", value: qualifiedLeads(), color: "text-green-600" },
                        { label: "Remaining", value: remainingLeads(), color: "text-yellow-500" },
                    ].map((item) => (
                        <div class="group bg-white dark:bg-gray-800/70 backdrop-blur-sm p-4 rounded-xl border border-gray-100 shadow-md dark:border-gray-700 hover:shadow-lg transition-all duration-300">

                            <p class="text-sm text-gray-700 dark:text-gray-400 mb-1">
                                {item.label}
                            </p>

                            <h2 class={`text-2xl font-semibold ${item.color || "text-gray-800 dark:text-white"}`}>
                                {item.value}
                            </h2>

                        </div>
                    ))}
                </div>

                {/* Progress Bar */}
                <div class="mt-6">
                    <div class="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Qualification Progress</span>
                        <span>
                            {qualifiedLeads} / {requiredQualified()}
                        </span>
                    </div>

                    <div class="w-full bg-gray-200 dark:bg-gray-700 h-1 rounded-full overflow-hidden">
                        <div
                            class="h-1 rounded-full transition-all duration-700"
                            classList={{
                                "bg-green-700": isCommitmentMet(),
                                "bg-yellow-500": !isCommitmentMet(),
                            }}
                            style={{
                                width: `${Math.min(
                                    (qualifiedLeads / requiredQualified()) * 100,
                                    100
                                )}%`,
                            }}
                        />
                    </div>
                </div>

                {/* Insight Box */}
                <div class="mt-6 p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">

                    <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                        You have received <span class="font-semibold text-gray-900 dark:text-white">{deliveredLeads}</span> leads.
                        Based on <span class="font-semibold">{commitment}%</span> commitment,
                        <span class="font-semibold">{requiredQualified()}</span> should be qualified.
                        Currently, <span class="font-semibold text-green-600">{qualifiedLeads}</span> are achieved.

                        <span class={`ml-1 font-medium ${isCommitmentMet() ? "text-green-600" : "text-yellow-600"}`}>
                            {isCommitmentMet()
                                ? "Requirement has been fulfilled."
                                : "More qualified leads are required."}
                        </span>
                    </p>

                </div>
            </Show>
        </>
    );
}
// ─── Project Row (Accordion) ──────────────────────────────────────────────────
function ProjectRow(props) {
    const [open, setOpen] = createSignal(false);

    const totalSpend = () => props.project.campaigns.reduce((s, c) => s + c.spend, 0);
    const totalLeads = () => props.project.campaigns.reduce((s, c) => s + c.leads, 0);
    const cpl = () => totalLeads() > 0 ? Math.round(totalSpend() / totalLeads()) : 0;

    return (
        <Card class="group overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 
              dark:bg-gray-900/70 backdrop-blur-sm 
             shadow-sm  transition-all duration-300">

            {/* Header button */}
            <button
                class="w-full flex items-center justify-between px-5 py-4 text-left bg-blue-50 dark:bg-gray-800 gap-4 
          dark:hover:bg-gray-800/50 transition-all duration-200"
                onClick={() => setOpen((v) => !v)}
            >
                {/* LEFT */}
                <div class="flex items-center gap-3 min-w-0">

                    {/* Avatar */}
                    <div class="w-10 h-10 rounded 
                  bg-gradient-to-br from-blue-900 to-blue-600 
                  flex items-center justify-center 
                  text-white text-sm font-semibold ">
                        {props.project.name?.charAt(0).toUpperCase()}
                    </div>
                    {/* Title */}
                    <div class="min-w-0">
                        <p class="font-semibold text-gray-900 dark:text-white text-sm truncate">
                            {props.project.name}
                        </p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                            {props.project.campaigns.length} campaigns · {totalLeads()} leads
                        </p>
                    </div>
                </div>

                {/* RIGHT STATS */}
                <div class="flex items-center gap-6 flex-shrink-0">

                    {/* Allocated */}
                    <div class="hidden sm:block text-right border border-blue-200 dark:border-gray-700 py-2 px-4 rounded-lg">
                        <p class="text-sm text-blue-900 dark:text-gray-400">Allocated</p>
                        <p class="text-sm font-semibold text-gray-800 dark:text-gray-200">
                            {fmt(props.project.budgetAllocated)}
                        </p>
                    </div>

                    {/* Spent */}
                    <div class="hidden sm:block text-right border border-blue-200 dark:border-gray-700 py-2 px-4 rounded-lg">
                        <p class="text-sm text-blue-900 dark:text-gray-400">Spent</p>
                        <p class="text-sm font-semibold text-gray-800 dark:text-gray-200">
                            {fmt(totalSpend())}
                        </p>
                    </div>

                    {/* CPL */}
                    <div class="hidden md:block text-right border border-blue-200 dark:border-gray-700 py-2 px-4 rounded-lg">
                        <p class="text-sm text-blue-900 dark:text-gray-400">CPL</p>
                        <p class="text-sm font-semibold text-gray-800 dark:text-gray-200">
                            {fmt(cpl())}
                        </p>
                    </div>

                    {/* Chevron */}
                    <div class="p-1.5 rounded-lg bg-blue-100 dark:bg-gray-800 
                  group-hover:bg-blue-200 dark:group-hover:bg-gray-700 transition">
                        <svg
                            class={`w-4 h-4 text-blue-500 dark:text-blue-400 transition-transform duration-300 ${open() ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
            </button>


            {/* Collapsible body */}
            <div
                style={{
                    overflow: "hidden",
                    "max-height": open() ? "2000px" : "0px",
                    opacity: open() ? "1" : "0",
                    transition: "all 0.4s ease",
                }}
            >
                <div class="px-5 pb-5 pt-4 space-y-5 
                border-t border-gray-100 dark:border-gray-700">
                    <SectionLabel>Campaign-Level Spend Details</SectionLabel>

                    {/* Inner cards wrapper */}
                    <div class="space-y-4">
                        <CampaignTable campaigns={props.project.campaigns} />
                    </div>

                    {/* Qualification */}
                    <div class="p-4 rounded-xl border 
                  bg-gray-50 dark:bg-gray-800/50 
                  border-gray-200 dark:border-gray-700">
                        <QualBlock project={props.project} />
                    </div>
                </div>
            </div>
        </Card>
    );
}

// ─── CPL Comparison Panel ─────────────────────────────────────────────────────
function CPLComparisonPanel(props) { 

    return (
        <Card class="p-5 space-y-4">
            <SectionLabel>CPL Comparison Across Projects</SectionLabel>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">

                {/* Overall */}
                <div class="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-4 space-y-2">
                    <p class="text-md text-gray-500 dark:text-gray-400 font-medium">Overall Avg CPL</p>
                    <p class="text-3xl font-bold  text-gray-900 dark:text-gray-100">{fmt(props.overallCPL)}</p>
                    <p class="text-sm  text-gray-500 dark:text-gray-400">{fmt(props.totalSpend)} ÷ {props.totalLeads} leads</p>
                </div>
                <For each={props.projectStats}>
                    {(proj) => (
                        <div class="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-4 space-y-2">
                            <div class="flex items-center justify-between gap-2">
                                <p class="text-md text-gray-600 dark:text-gray-400 font-medium">{proj.name}</p>
                                <Tag variant={proj.cpl <= proj.proposedCPL ? "green" : "amber"}>
                                    {proj.cpl <= proj.proposedCPL ? "On Target" : " Over"}
                                </Tag>
                            </div>
                            <p class="text-2xl font-bold  text-gray-900 dark:text-gray-100">{fmt(proj.cpl)}</p>
                            <p class="text-md text-gray-500 dark:text-gray-400">
                                Proposed: <span class="font-semibold text-gray-600 dark:text-gray-400">{fmt(proj.proposedCPL)}</span>
                            </p>
                            <CPLIndicator actual={proj.cpl} proposed={proj.proposedCPL} />
                        </div>
                    )}
                </For>
            </div>
        </Card>
    );
}

// ─── Payment History ──────────────────────────────────────────────────────────
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
                                            <Show when={pay.credit} fallback={<Tag variant="green">PAID</Tag>}>
                                                <Tag variant="gray">CREDITED by {pay.creditedBy}</Tag>
                                            </Show>
                                            <Show when={pay.gstFiled}>
                                                <Tag variant="blue">GST Filed</Tag>
                                            </Show>
                                        </div>
                                        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                                            {pay.credit
                                                ? `Credited on ${pay.creditDate} by ${pay.creditedBy}`
                                                : `${pay.date} · via ${pay.method} · ${pay.id}`}
                                        </p>
                                    </div>
                                </div>
                                <Show when={!pay.credit}>
                                    <a href={pay.invoiceUrl} class="flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        Invoice
                                    </a>
                                </Show>
                            </div>
                            <Show when={pay.credit}>
                                <div class="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 border dark:border-gray-700 rounded-lg px-3 py-2">
                                    Amount credited by {pay.creditedBy} on {pay.creditDate}.
                                </div>
                            </Show>
                        </div>
                    )}
                </For>
            </div>
        </Card>
    );
}

// ─── Delivery Breakdown ───────────────────────────────────────────────────────
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
                            <th class="pb-2.5 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Leads</th>
                            <th class="pb-2.5 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Amount (ex-GST)</th>
                            <th class="pb-2.5 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">With GST (18%)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <For each={props.deliveries}>
                            {(d) => (
                                <tr class="border-b border-gray-50 dark:border-gray-700">
                                    <td class="py-2.5 pr-4 font-medium text-gray-800 dark:text-gray-200">{d.project}</td>
                                    <td class="py-2.5 text-center  text-gray-600 dark:text-gray-400">{d.leads}</td>
                                    <td class="py-2.5 text-center  text-gray-600 dark:text-gray-400">{fmt(d.amountExGST)}</td>
                                    <td class="py-2.5 text-right  font-semibold text-gray-900 dark:text-gray-100">{fmt(d.amountWithGST)}</td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                    <tfoot>
                        <tr class="border-t border-gray-200 dark:border-gray-700 font-bold text-gray-900 dark:text-gray-100">
                            <td class="pt-3">Total</td>
                            <td class="pt-3 text-center ">{totalLeads}</td>
                            <td class="pt-3 text-center ">{fmt(totalExGST)}</td>
                            <td class="pt-3 text-right text-base">{fmt(totalWithGST)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="flex flex-wrap justify-between items-center pt-3 border-t border-gray-100 dark:border-gray-700 gap-2">
                <span class="text-sm text-gray-500 dark:text-gray-400">Remaining: {fmt(props.totalPaid)} – {fmt(totalWithGST)}</span>
                <span class="text-sm font-bold  text-green-600 dark:text-green-400">{fmt(remaining)}</span>
            </div>
        </Card>
    );
}

// ─── Alerts Tab ───────────────────────────────────────────────────────────────
function AlertsTab(props) {
    const [enabled, setEnabled] = createSignal(
        Object.fromEntries(props.alerts.map((a) => [a.id, a.defaultOn]))
    );

    const toggle = (id) => setEnabled((prev) => ({ ...prev, [id]: !prev[id] }));

    const borderMap = { warning: "border-l-amber-400", info: "border-l-blue-400", caution: "border-l-orange-400", success: "border-l-green-400" };
    const msgMap = { warning: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400", info: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400", caution: "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400", success: "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" };

    return (
        <div class="space-y-3">
            <For each={props.alerts}>
                {(alert) => (
                    <Card class={`p-4 flex items-start gap-4 border-l-4 ${borderMap[alert.type]}`}>
                        <span class="text-xl mt-0.5 flex-shrink-0">{alert.icon}</span>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-start justify-between gap-3 flex-wrap">
                                <div>
                                    <p class="font-semibold text-gray-800 dark:text-gray-200 text-sm">{alert.label}</p>
                                    <p class="text-sm text-gray-700 dark:text-gray-400 mt-0.5">{alert.desc}</p>
                                </div>
                                <Toggle checked={enabled()[alert.id]} onChange={() => toggle(alert.id)} />
                            </div>
                            <Show when={alert.activeMsg && enabled()[alert.id]}>
                                <div class={`mt-3 rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-2 ${msgMap[alert.type]}`}>
                                    <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-shrink-0" />
                                    {alert.activeMsg}
                                </div>
                            </Show>
                        </div>
                    </Card>
                )}
            </For>
        </div>
    );
}

// ─── Add Funds Modal ──────────────────────────────────────────────────────────
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

                    {/* Header */}
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



                    {/* Amount input */}
                    <div class="space-y-1.5">
                        <label class="text-sm font-semibold text-gray-600 dark:text-gray-400">Amount (INR, ex-GST)</label>
                        <div class="relative">
                            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-600 font-bold select-none">₹</span>
                            <input
                                type="number"
                                placeholder="0"
                                value={amount()}
                                onInput={(e) => setAmount(e.currentTarget.value)}
                                class="w-full pl-8 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100  text-lg focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600 placeholder-gray-300 dark:placeholder-gray-700"
                            />
                        </div>
                        <p class="text-sm text-gray-600 dark:text-gray-400">
                            +18% GST · You pay:{" "}
                            <span class="font-semibold text-gray-700 dark:text-gray-400">
                                {totalWithGST() ? fmt(totalWithGST()) : "—"}
                            </span>
                        </p>
                    </div>

                    {/* Quick amounts */}
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

                    {/* Payment method */}
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

                    {/* HDFC badge */}
                    <div class="flex items-center gap-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl px-4 py-3 border border-gray-100 dark:border-gray-800">
                        <div class="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center font-bold text-sm text-gray-700 dark:text-gray-400 flex-shrink-0">H</div>
                        <div>
                            <p class="text-sm font-semibold text-gray-800 dark:text-gray-200">HDFC Payment Gateway</p>
                            <p class="text-[10px] text-gray-400 dark:text-gray-400">Secured · PCI-DSS Compliant · 256-bit SSL</p>
                        </div>
                        <svg class="w-4 h-4 text-green-500 ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                        </svg>
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

// ─── Root Component ───────────────────────────────────────────────────────────
export default function Billing() {
    
    const [tab, setTab] = createSignal("overview");
    const [showModal, setShowModal] = createSignal(false);

    // Derived project stats
    const projectStats = createMemo(() =>
        MOCK.projects.map((p) => {
            const ts = p.campaigns.reduce((s, c) => s + c.spend, 0);
            const tl = p.campaigns.reduce((s, c) => s + c.leads, 0);
            return { ...p, totalSpend: ts, totalLeadsP: tl, cpl: tl > 0 ? Math.round(ts / tl) : 0 };
        })
    );

    const totalLeads = createMemo(() => projectStats().reduce((s, p) => s + p.totalLeadsP, 0));
    const totalSpend = createMemo(() => projectStats().reduce((s, p) => s + p.totalSpend, 0));
    const overallCPL = createMemo(() => totalLeads() > 0 ? Math.round(totalSpend() / totalLeads()) : 0);
    const remaining = MOCK.totalPaid - MOCK.totalSpent;

    const tabs = [
        { id: "overview", label: " Overview" },
        { id: "payments", label: "Payments & Invoices" },
        { id: "alerts", label: "Alerts" },
    ];

    return (
        <div class="min-h-screen bg-white p-6 dark:bg-gray-900 text-gray-800 dark:text-gray-200 transition-all duration-300 selection:bg-gray-800 selection:text-white">
            {/* ── Header ── */}
            <header >
                <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-3">
                    <div>
                        <h1 class="text-2xl md:text-2xl font-semibold mb-1">Billing </h1>
                        <p class="text-md text-gray-700 dark:text-gray-400">Manage your billing and payment information.</p>
                    </div>

                    <div class="flex items-center gap-3">
                        <button
                            onClick={() => setShowModal(true)}
                            class="flex items-center gap-2 px-4 py-3 text-sm font-medium rounded
                            bg-blue-900 dark:bg-blue-800 text-white
                            shadow-sm hover:shadow-md
                            hover:bg-blue-800 dark:hover:bg-blue-700
                            active:scale-95 transition-all duration-200"
                        >
                            <svg
                                class="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M12 4v16m8-8H4"
                                />
                            </svg>

                            <span>Add Funds</span>
                        </button>
                    </div>
                </div>
            </header>
            {/* Sub-nav tabs */}
            <div class=" mx-auto flex gap-1">
                <For each={tabs}>
                    {(t) => (
                        <button
                            onClick={() => setTab(t.id)}
                            class={`text-md font-semibold px-4 py-2.5 border-b-2 transition-colors ${tab() === t.id ? "border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100" : "border-transparent text-gray-400 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
                        >
                            {t.label}
                        </button>
                    )}
                </For>
            </div>


            {/* ══ OVERVIEW TAB ══ */}
            <Show when={tab() === "overview"}>
                <div class="space-y-6">
                    {/* ── GST Notice ── */}
                    <div class="flex items-center gap-2 text-sm font-medium
                        bg-gray-50 dark:bg-gray-800/60
                        text-gray-600 dark:text-gray-400
                        border border-gray-200 dark:border-gray-800
                        rounded-lg px-4 py-2.5 mt-3">
                        <span>
                            All amounts shown{" "}
                            <span class="font-semibold text-gray-800 dark:text-gray-200">
                                excluding GST (18%)
                            </span>{" "}
                            unless stated otherwise.
                        </span>
                    </div>

                    {/* ① Budget Overview */}
                    <section>
                        <SectionLabel>Budget Overview</SectionLabel>
                        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <BudgetCard

                                label="Budget Committed"
                                value={MOCK.budgetCommitted}
                                icon={
                                    <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
                                        <svg class="w-5 h-5 text-blue-600 dark:text-blue-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                        </svg>
                                    </div>
                                }
                                sub="Total contracted"
                                pctValue={MOCK.budgetCommitted}
                                pctMax={MOCK.budgetCommitted}
                            />
                            <BudgetCard
                                label="Budget Utilized" value={totalSpend()} icon={
                                    <div class="p-3 rounded-lg bg-purple-100 dark:bg-purle-300">
                                        <svg class="w-5 h-5 text-purple-600 dark:text-purple-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                            <path d="M3 3v18h18" />
                                            <path d="M18 17l-5-5-4 4-3-3" />
                                        </svg>
                                    </div>
                                }
                                sub={`${pct(totalSpend(), MOCK.budgetCommitted)}% of committed`}
                                pctValue={totalSpend()} pctMax={MOCK.budgetCommitted}
                            />
                            <BudgetCard
                                label="Remaining Balance" value={remaining} icon={
                                    <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
                                        <svg class="w-5 h-5 text-blue-600 dark:text-blue-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                            <circle cx="12" cy="12" r="9" />
                                            <path d="M12 7v5l3 3" />
                                        </svg>
                                    </div>
                                }
                                sub="Of amount received"
                                pctValue={remaining} pctMax={MOCK.totalPaid}
                            />
                            <BudgetCard
                                label="Pending Payment" value={MOCK.pendingPayment} icon={
                                    <div class="p-3 rounded-lg bg-red-100 dark:bg-red-300">
                                        <svg class="w-5 h-5 text-red-600 dark:text-red-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                            <path d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                }
                                sub={MOCK.pendingPayment > 0 ? "Due immediately" : "No dues outstanding"}
                                pctValue={MOCK.pendingPayment} pctMax={MOCK.budgetCommitted}
                            />
                        </div>
                    </section>

                    {/* KPI strip */}
                    <div class="grid grid-cols-3 gap-3">
                        <Card class="p-4 text-center">
                            <p class="text-md text-gray-700 dark:text-gray-400 font-medium">Total Leads (All Projects)</p>
                            <p class="text-xl font-bold  mt-1 text-gray-700 dark:text-gray-400">{totalLeads()}</p>
                        </Card>
                        <Card class="p-4 text-center">
                            <p class="text-md text-gray-700 dark:text-gray-400 font-medium">Total Spend (ex-GST)</p>
                            <p class="text-xl font-bold  mt-1 text-gray-700 dark:text-gray-400">{fmt(totalSpend())}</p>
                        </Card>
                        <Card class="p-4 text-center">
                            <p class="text-md text-gray-700 dark:text-gray-400 font-medium">Overall Avg CPL</p>
                            <p class="text-xl font-bold  mt-1 text-gray-900 dark:text-gray-100">{fmt(overallCPL())}</p>
                        </Card>
                    </div>

                    {/* Project Breakdown */}
                    <section>
                        <SectionLabel>Project-wise Budget Breakdown</SectionLabel>
                        <div class="space-y-3">
                            <For each={MOCK.projects}>
                                {(p) => <ProjectRow project={p} />}
                            </For>
                        </div>
                    </section>

                    {/* CPL Comparison */}
                    <CPLComparisonPanel
                        projectStats={projectStats()}
                        overallCPL={overallCPL()}
                        totalLeads={totalLeads()}
                        totalSpend={totalSpend()}
                    />
                </div>
            </Show>

            {/* ══ PAYMENTS TAB ══ */}
            <Show when={tab() === "payments"}>
                <div class="space-y-5">
                    <div class="flex items-center justify-between">
                        <SectionLabel>Payment &amp; Invoice Tracking</SectionLabel>
                        <span class="text-sm text-gray-400 dark:text-gray-400">Managed by Accounts Team</span>
                    </div>

                    {/* Summary cards */}
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Card class="p-4 ">
                            <div class="flex items-center justify-between ">
                                {/* Left Content */}
                                <div>
                                    <p class="text-md text-gray-600 dark:text-gray-400 ">
                                        Total Received
                                    </p>
                                    <p class="text-xl font-bold mt-2 text-gray-900 dark:text-white ">
                                        {fmt(MOCK.totalPaid)}
                                    </p>
                                </div>
                                {/* Right Icon */}
                                <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300 flex items-center justify-center">
                                    <svg
                                        class="w-5 h-5 text-blue-800 dark:text-blue-800"
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
                            </div>
                        </Card>
                        <Card class="p-4">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-md text-gray-600 dark:text-gray-400">Total Invoiced (Including GST)</p>
                                    <p class="text-xl font-bold  mt-2 text-gray-900 dark:text-gray-100">{fmt(MOCK.totalSpent)}</p>
                                </div>
                                {/* Right Icon */}
                                <div class="p-3 rounded-lg bg-purple-100 dark:bg-purple-300 flex items-center justify-center">
                                    <svg class="w-5 h-5 text-purple-600 dark:text-purple-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M3 3v18h18" />
                                        <path d="M18 17l-5-5-4 4-3-3" />
                                    </svg>
                                </div>
                            </div>

                            {/* <p class="text-sm text-gray-400 dark:text-gray-600  mt-0.5">ex-GST: {fmt(55000)}</p> */}
                        </Card>
                        <Card class="p-4">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-md text-gray-600 dark:text-gray-400">Total Invoiced (Excluding GST)</p>
                                    <p class="text-xl font-bold  mt-2 text-gray-900 dark:text-gray-100">{fmt(55000)}</p>
                                </div>
                                <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300 flex items-center justify-center">
                                    <svg class="w-5 h-5 text-blue-600 dark:text-blue-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <circle cx="12" cy="12" r="9" />
                                        <path d="M12 7v5l3 3" />
                                    </svg>
                                </div>
                            </div>
                        </Card>
                        <Card class="p-4">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-md text-gray-600 dark:text-gray-400">Remaining Balance</p>
                                    <p class="text-xl font-bold  mt-2 text-green-600 dark:text-green-400">{fmt(remaining)}</p>
                                </div>
                                <div class="p-3 rounded-lg bg-red-100 dark:bg-red-300 flex items-center justify-center">
                                    <svg class="w-5 h-5 text-red-600 dark:text-red-800" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            </div>
                        </Card>
                    </div>

                    <DeliveryBreakdown deliveries={MOCK.deliveries} totalPaid={MOCK.totalPaid} />
                    <PaymentHistory payments={MOCK.payments} />

                    {/* Next billing cycle */}
                    <Card class="p-4 flex items-center gap-3 flex-wrap">
                        <div class="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-lg flex-shrink-0">📅</div>
                        <div>
                            <p class="text-sm text-gray-400 dark:text-gray-400">Next Billing Cycle</p>
                            <p class="font-semibold text-gray-900 dark:text-gray-100">{MOCK.nextBillingDate}</p>
                        </div>
                        <button
                            onClick={() => setShowModal(true)}
                            class="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-semibold hover:opacity-85 transition-opacity"
                        >
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
                            </svg>
                            Add Funds
                        </button>
                    </Card>
                </div>
            </Show>

            {/* ══ ALERTS TAB ══ */}
            <Show when={tab() === "alerts"}>
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <SectionLabel>Alerts &amp; Notifications</SectionLabel>
                        <Tag variant="gray">Proactive System</Tag>
                    </div>
                    <AlertsTab alerts={MOCK.alerts} />
                </div>
            </Show>

            {/* Add Funds Modal */}
            <AddFundsModal open={showModal()} onClose={() => setShowModal(false)} />
        </div>
    );
}  