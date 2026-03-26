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
            name: "Project 1",
            proposedCPL: 500,
            qualificationPct: 50,
            budgetAllocated: 50000,
            qualifiedLeads: 25,
            campaigns: [
                { id: "c1", name: "Brand Awareness – Delhi", spend: 8500, dailyAvg: 850, budgetCap: 15000, leads: 17, result: "Lead" },
                { id: "c2", name: "Retargeting – Mumbai", spend: 16500, dailyAvg: 1650, budgetCap: 20000, leads: 33, result: "Lead" },
            ],
        },
        {
            id: "p2",
            name: "Project 2",
            proposedCPL: 1000,
            qualificationPct: 60,
            budgetAllocated: 80000,
            qualifiedLeads: 18,
            campaigns: [
                { id: "c3", name: "Lead Gen – Bangalore", spend: 19000, dailyAvg: 1900, budgetCap: 40000, leads: 19, result: "Lead" },
                { id: "c4", name: "Conversion – Pune", spend: 11000, dailyAvg: 1100, budgetCap: 25000, leads: 11, result: "Lead" },
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
        { id: "a1", type: "warning", icon: "⚠️", label: "Low Balance Alert", desc: "Trigger when remaining balance falls below 10% of committed budget.", activeMsg: "Budget utilization at 62% — review campaign pacing.", defaultOn: true },
        { id: "a2", type: "warning", icon: "🔴", label: "Budget Exhaustion Alert", desc: "Alert when any campaign reaches 95% of its cap.", activeMsg: null, defaultOn: true },
        { id: "a3", type: "info", icon: "📅", label: "Payment Due Reminder", desc: "Remind 7 days before next billing cycle.", activeMsg: "Next billing cycle: 28 March 2025", defaultOn: true },
        { id: "a4", type: "caution", icon: "📈", label: "CPL Threshold Alert", desc: "Alert when actual CPL exceeds proposed CPL for any project.", activeMsg: null, defaultOn: false },
        { id: "a5", type: "success", icon: "✅", label: "CPL On-Target Notification", desc: "Notify when CPL is within the agreed threshold.", activeMsg: "CPL within threshold for all active campaigns.", defaultOn: true },
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
        <div class={`rounded-xl shadow-md transition border border-gray-200/80 dark:border-gray-800/80 bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl ${props.class || ""}`}>
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
        <div class="h-1 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
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
                <span class={isOver() ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-green-600 dark:text-green-400 font-semibold"}>
                    {isOver()
                        ? `+${Math.round(((props.actual / props.proposed) - 1) * 100)}% over cap`
                        : `✓ ${pct(props.actual, props.proposed)}% of cap`}
                </span>
            </div>
            <ProgressBar value={props.actual} max={props.proposed} colorClass={isOver() ? "bg-amber-500" : "bg-gray-600"} />
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
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-gray-100 dark:border-gray-800">
                        <For each={colHeads}>
                            {(h) => (
                                <th class={`pb-2.5 text-sm font-semibold text-gray-500 dark:text-gray-600 uppercase tracking-wider ${h === "Campaign" ? "text-left pr-4" : "text-right"}`}>
                                    {h}
                                </th>
                            )}
                        </For>
                    </tr>
                </thead>
                <tbody>
                    <For each={props.campaigns}>
                        {(c) => {
                            const cpl = c.leads > 0 ? Math.round(c.spend / c.leads) : 0;
                            return (
                                <tr class="border-b border-gray-50 dark:border-gray-900/60 hover:bg-gray-50/80 dark:hover:bg-gray-800/30 transition-colors">
                                    <td class="py-3 pr-4">
                                        <p class="font-medium text-gray-800 dark:text-gray-200">{c.name}</p>
                                        <Tag variant="gray">{c.result}</Tag>
                                    </td>
                                    <td class="py-3 text-right  text-gray-700 dark:text-gray-400">{fmt(c.spend)}</td>
                                    <td class="py-3 text-right  5">{fmt(c.dailyAvg)}</td>
                                    <td class="py-3 text-right">
                                        <span class=" text-gray-500 dark:text-gray-400 block">{fmt(c.budgetCap)}</span>
                                        <div class="w-20 ml-auto mt-1"><ProgressBar value={c.spend} max={c.budgetCap} /></div>
                                    </td>
                                    <td class="py-3 text-right  font-semibold text-gray-800 dark:text-gray-200">{c.leads}</td>
                                    <td class="py-3 text-right  font-semibold text-gray-800 dark:text-gray-200">{fmt(cpl)}</td>
                                </tr>
                            );
                        }}
                    </For>
                </tbody>
                <tfoot>
                    <tr>
                        <td class="pt-3 font-bold text-gray-900 dark:text-gray-100">Total</td>
                        <td class="pt-3 text-right  font-bold text-gray-900 dark:text-gray-100">{fmt(totalSpend())}</td>
                        <td class="pt-3 text-right  text-gray-400">—</td>
                        <td />
                        <td class="pt-3 text-right  font-bold text-gray-900 dark:text-gray-100">{totalLeads()}</td>
                        <td class="pt-3 text-right  font-bold text-gray-900 dark:text-gray-100">{fmt(totalCPL())}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}

// ─── CPL Calculation Block ────────────────────────────────────────────────────
function CPLBlock(props) {
    return (
        <div class="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 p-4 space-y-3">
            <SectionLabel>CPL Calculation (ex-GST)</SectionLabel>
            <div class="flex flex-wrap gap-4 items-center">
                <div>
                    <p class="text-sm text-gray-600 dark:text-gray-400">Total Leads</p>
                    <p class="text-2xl font-bold  text-gray-900 dark:text-gray-100">{props.totalLeads}</p>
                </div>
                <span class="text-gray-500 dark:text-gray-700 text-xl">÷</span>
                <div>
                    <p class="text-sm text-gray-600 dark:text-gray-400">Total Spend</p>
                    <p class="text-2xl font-bold  text-gray-900 dark:text-gray-100">{fmt(props.totalSpend)}</p>
                </div>
                <span class="text-gray-500 dark:text-gray-700 text-xl">=</span>
                <div>
                    <p class="text-sm text-gray-600 dark:text-gray-400">Actual CPL</p>
                    <p class="text-2xl font-bold  text-gray-900 dark:text-gray-100">{fmt(props.cpl)}</p>
                </div>
                <div class="ml-auto text-right">
                    <p class="text-sm text-gray-4600 dark:text-gray-400">Proposed CPL</p>
                    <p class={`text-2xl font-bold  ${props.cpl <= props.proposedCPL ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {fmt(props.proposedCPL)}
                    </p>
                </div>
            </div>
            <CPLIndicator actual={props.cpl} proposed={props.proposedCPL} />
        </div>
    );
}

// ─── Qualification Logic Block ────────────────────────────────────────────────
function QualBlock(props) {
    const expectedQL = () => Math.round(props.totalLeads * (props.project.qualificationPct / 100));
    const qProg = () => expectedQL() > 0 ? Math.round((props.project.qualifiedLeads / expectedQL()) * 100) : 0;
    const barColor = () => qProg() >= 100 ? "bg-green-500" : qProg() >= 60 ? "bg-amber-500" : "bg-red-500";

    const statCards = () => [
        { label: "Total Leads (TL)", val: props.totalLeads, sub: null, hi: false },
        { label: "Expected QL", val: expectedQL(), sub: `${props.totalLeads} × ${props.project.qualificationPct / 100}`, hi: false },
        { label: "Qualified (QL)", val: props.project.qualifiedLeads, sub: "Delivered", hi: false },
        { label: "Progress", val: `${qProg()}%`, sub: "of QL target", hi: true },
    ];

    return (
        <div class="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 p-4 space-y-4">
            <div class="flex items-center justify-between flex-wrap gap-2">
                <SectionLabel>Proposed CPL &amp; Qualification Logic</SectionLabel>
                <Tag variant="gray">Q% = {props.project.qualificationPct}%</Tag>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <For each={statCards()}>
                    {(item) => (
                        <div class="rounded-lg bg-white dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 p-3">
                            <p class="text-md text-gray-700 dark:text-gray-400">{item.label}</p>
                            <p class={`text-lg font-bold  mt-0.5 ${item.hi ? (qProg() >= 100 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400") : "text-gray-900 dark:text-gray-100"}`}>
                                {item.val}
                            </p>
                            <Show when={item.sub}>
                                <p class="text-sm text-gray-500 dark:text-gray-600 ">{item.sub}</p>
                            </Show>
                        </div>
                    )}
                </For>
            </div>

            <div class="space-y-1.5">
                <div class="flex justify-between text-md text-gray-600 dark:text-gray-400">
                    <span>Progress: {props.project.qualifiedLeads} / {expectedQL()} QL achieved</span>
                    <span>{qProg()}%</span>
                </div>
                <div class="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div class={`h-full rounded-full transition-all duration-700 ${barColor()}`} style={{ width: `${Math.min(100, qProg())}%` }} />
                </div>
                {/* <p class="text-[10px] text-gray-400 dark:text-gray-600 ">
                    Formula: QL ÷ (TL × Q%) × 100 = {props.project.qualifiedLeads} ÷ ({props.totalLeads} × {props.project.qualificationPct / 100}) × 100 = {qProg()}%
                </p> */}
            </div>
        </div>
    );
}

// ─── Project Row (Accordion) ──────────────────────────────────────────────────
function ProjectRow(props) {
    const [open, setOpen] = createSignal(false);

    const totalSpend = () => props.project.campaigns.reduce((s, c) => s + c.spend, 0);
    const totalLeads = () => props.project.campaigns.reduce((s, c) => s + c.leads, 0);
    const cpl = () => totalLeads() > 0 ? Math.round(totalSpend() / totalLeads()) : 0;

    return (
        <Card class="overflow-hidden">
            {/* Header button */}
            <button
                class="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/80 dark:hover:bg-gray-800/30 transition-colors text-left gap-4"
                onClick={() => setOpen((v) => !v)}
            >
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-600 dark:text-gray-400 flex-shrink-0">
                        {props.project.name.replace("Project ", "P")}
                    </div>
                    <div class="min-w-0">
                        <p class="font-semibold text-gray-900 dark:text-gray-100 text-sm">{props.project.name}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">{props.project.campaigns.length} campaigns · {totalLeads()} leads</p>
                    </div>
                </div>
                <div class="flex items-center gap-5 flex-shrink-0">
                    <div class="hidden sm:block text-right">
                        <p class="text-sm text-gray-500 dark:text-gray-400">Allocated</p>
                        <p class="text-sm font-semibold mt-2  text-gray-800 dark:text-gray-200">{fmt(props.project.budgetAllocated)}</p>
                    </div>
                    <div class="hidden sm:block text-right">
                        <p class="text-sm text-gray-500 dark:text-gray-400">Spent</p>
                        <p class="text-sm font-semibold  mt-2  text-gray-800 dark:text-gray-200">{fmt(totalSpend())}</p>
                    </div>
                    <div class="hidden md:block text-right">
                        <p class="text-sm text-gray-500 dark:text-gray-400">CPL</p>
                        <p class="text-sm font-semibold  mt-2  text-gray-800 dark:text-gray-200">{fmt(cpl())}</p>
                    </div>
                    <svg
                        class={`w-4 h-4 text-gray-400 dark:text-gray-600 transition-transform duration-300 ${open() ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>

            {/* Spend bar */}
            <div class="px-5 pb-3">
                <div class="flex justify-between text-sm text-gray-700 dark:text-gray-400 mb-1">
                    <span>Spend progress</span>
                    <span>{pct(totalSpend(), props.project.budgetAllocated)}%</span>
                </div>
                <ProgressBar value={totalSpend()} max={props.project.budgetAllocated} />
            </div>

            {/* Collapsible body */}
            <div style={{
                overflow: "hidden",
                "max-height": open() ? "2000px" : "0px",
                opacity: open() ? "1" : "0",
                transition: "max-height 0.4s ease, opacity 0.3s ease",
            }}>
                <div class="px-5 pb-5 space-y-4 border-t border-gray-100 dark:border-gray-800 pt-4">
                    <SectionLabel>Campaign-Level Spend Details</SectionLabel>
                    <CampaignTable campaigns={props.project.campaigns} />
                    <CPLBlock
                        totalLeads={totalLeads()}
                        totalSpend={totalSpend()}
                        cpl={cpl()}
                        proposedCPL={props.project.proposedCPL}
                    />
                    <QualBlock project={props.project} totalLeads={totalLeads()} />
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
                <div class="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 p-4 space-y-2">
                    <p class="text-md text-gray-500 dark:text-gray-400 font-medium">Overall Avg CPL</p>
                    <p class="text-3xl font-bold  text-gray-900 dark:text-gray-100">{fmt(props.overallCPL)}</p>
                    <p class="text-sm  text-gray-500 dark:text-gray-400">{fmt(props.totalSpend)} ÷ {props.totalLeads} leads</p>
                </div>

                <For each={props.projectStats}>
                    {(proj) => (
                        <div class="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 p-4 space-y-2">
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
                                        <p class="text-sm text-gray-400 dark:text-gray-400 mt-0.5">
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
                                <div class="text-sm text-gray-400 dark:text-gray-600 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2">
                                    ℹ Payment history disabled — amount credited by {pay.creditedBy} on {pay.creditDate}.
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
                        <tr class="border-b border-gray-100 dark:border-gray-800">
                            <th class="pb-2.5 text-sm font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-wider text-left pr-4">Project</th>
                            <th class="pb-2.5 text-sm font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-wider text-right">Leads</th>
                            <th class="pb-2.5 text-sm font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-wider text-right">Amount (ex-GST)</th>
                            <th class="pb-2.5 text-sm font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-wider text-right">With GST (18%)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <For each={props.deliveries}>
                            {(d) => (
                                <tr class="border-b border-gray-50 dark:border-gray-900/50">
                                    <td class="py-2.5 pr-4 font-medium text-gray-800 dark:text-gray-200">{d.project}</td>
                                    <td class="py-2.5 text-right  text-gray-600 dark:text-gray-400">{d.leads}</td>
                                    <td class="py-2.5 text-right  text-gray-600 dark:text-gray-400">{fmt(d.amountExGST)}</td>
                                    <td class="py-2.5 text-right  font-semibold text-gray-900 dark:text-gray-100">{fmt(d.amountWithGST)}</td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                    <tfoot>
                        <tr class="border-t border-gray-200 dark:border-gray-700 font-bold text-gray-900 dark:text-gray-100">
                            <td class="pt-3">Total</td>
                            <td class="pt-3 text-right ">{totalLeads}</td>
                            <td class="pt-3 text-right ">{fmt(totalExGST)}</td>
                            <td class="pt-3 text-right  text-base">{fmt(totalWithGST)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="flex flex-wrap justify-between items-center pt-3 border-t border-gray-100 dark:border-gray-800 gap-2">
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
                                    <p class="text-sm text-gray-400 dark:text-gray-400 mt-0.5">{alert.desc}</p>
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
                            <p class="text-sm text-gray-400 dark:text-gray-400 mt-0.5">Powered by HDFC Payment Gateway</p>
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
                        <p class="text-sm text-gray-400 dark:text-gray-600">
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
                            <p class="text-[10px] text-gray-400 dark:text-gray-600">Secured · PCI-DSS Compliant · 256-bit SSL</p>
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
                <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6">
                    <div>
                        <h1 class="text-2xl md:text-2xl font-semibold mb-1">Billing </h1>
                        <p class="text-md text-gray-700 dark:text-gray-400">Manage your billing and payment information.</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <button
                            onClick={() => setShowModal(true)}
                            class="flex items-center gap-2 px-4 py-3 text-sm font-medium rounded
                            bg-green-500 dark:bg-green-600 text-white
                            shadow-sm hover:shadow-md
                            hover:bg-green-600 dark:hover:bg-green-700
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
                        <Card class="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-all duration-300">
                            <div class="flex items-center justify-between">
                                {/* Left Content */}
                                <div>
                                    <p class="text-sm text-gray-500 dark:text-gray-400 font-medium">
                                        Total Received
                                    </p>
                                    <p class="text-2xl font-bold mt-1 text-gray-900 dark:text-white tracking-tight">
                                        {fmt(MOCK.totalPaid)}
                                    </p>
                                </div>
                                {/* Right Icon */}
                                <div class="p-3 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                                    <svg
                                        class="w-5 h-5 text-blue-600 dark:text-blue-400"
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
                                    <p class="text-sm text-gray-400 dark:text-gray-400">Total Invoiced (Including GST)</p>
                                    <p class="text-2xl font-bold  mt-1 text-gray-900 dark:text-gray-100">{fmt(MOCK.totalSpent)}</p>
                                </div>
                                {/* Right Icon */}
                                <div class="p-3 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
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
                                    <p class="text-sm text-gray-400 dark:text-gray-400">Total Invoiced (Excluding GST)</p>
                                    <p class="text-2xl font-bold  mt-1 text-gray-900 dark:text-gray-100">{fmt(55000)}</p>
                                </div>
                                <div class="p-3 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
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
                                    <p class="text-sm text-gray-400 dark:text-gray-400">Remaining Balance</p>
                                    <p class="text-2xl font-bold  mt-1 text-green-600 dark:text-green-400">{fmt(remaining)}</p>
                                </div>
                                <div class="p-3 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
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
                            Add Funds via HDFC
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