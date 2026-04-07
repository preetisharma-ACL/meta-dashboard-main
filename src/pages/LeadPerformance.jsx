import { createSignal, For, createMemo } from "solid-js";
import { onMount } from "solid-js";
import { leads, setLeads, fetchLeads } from "../store/leadsStore";

// ─── Category Mapping ───────────────────────────────────────────────────────
const POSITIVE_STATUSES = new Set([
    "Site Visit Done",
    "Site Visit Scheduled",
    "Meeting Done",
    "Video Call Done",
    "VC Done",
    "Booking Done",
    "Interested",
]);

const JUNK_STATUSES = new Set([
    "Not Interested",
    "Invalid",
    "Fake Lead",
    "Feeded Leads",
    "Broker",
    "Low Budget",
    "Always Not Picked",
]);

const LeadsPage = () => {
    const [search, setSearch] = createSignal("");
    const [performanceFilter, setPerformanceFilter] = createSignal("");
    const [statusFilter, setStatusFilter] = createSignal("");
    const [isEditOpen, setIsEditOpen] = createSignal(false);
    const [selectedLead, setSelectedLead] = createSignal(null);
    const [activeBlock, setActiveBlock] = createSignal("positive"); // 'positive' | 'prospects' | 'junk' | null

    onMount(() => {
        fetchLeads();
    });

    // ─── Status Normalizer ───────────────────────────────────────────────────
    const normalizeStatus = (status) => {
        if (!status) return "";
        const s = status.toLowerCase().trim();

        if (["fresh", "fresh leads"].includes(s)) return "Fresh Leads";
        if (["call later"].includes(s)) return "Call Later";
        if (["not picked", "call not picked"].includes(s)) return "Not Picked";
        if (["asked to call later"].includes(s)) return "Asked to call later";
        if (["always busy", "busy"].includes(s)) return "Always Busy";
        if (["interested"].includes(s)) return "Interested";
        if (["follow-up", "follow up"].includes(s)) return "Follow-Up";
        if (["site visit scheduled"].includes(s)) return "Site Visit Scheduled";
        if (["site visit done", "site visit"].includes(s)) return "Site Visit Done";
        if (["booking done"].includes(s)) return "Booking Done";
        if (["invalid"].includes(s)) return "Invalid";
        if (["low budget"].includes(s)) return "Low Budget";
        if (["not interested"].includes(s)) return "Not Interested";
        if (["broker"].includes(s)) return "Broker";
        if (["always not picked"].includes(s)) return "Always Not Picked";
        if (["fake lead", "fake", "fake feeding", "fake leads"].includes(s)) return "Fake Lead";
        if (["feeded leads", "feeded"].includes(s)) return "Feeded Leads";
        if (["meeting done"].includes(s)) return "Meeting Done";
        if (["video call done", "vc done", "vc"].includes(s)) return "Video Call Done";

        return status;
    };

    // ─── Category Logic ──────────────────────────────────────────────────────
    const getCategory = (status) => {
        const n = normalizeStatus(status);
        if (POSITIVE_STATUSES.has(n)) return "positive";
        if (JUNK_STATUSES.has(n)) return "junk";
        return "prospects";
    };

    // ─── Status Badge Style ──────────────────────────────────────────────────
    const getStatusStyle = (status) => {
        const n = normalizeStatus(status);

        if (n === "Fake Lead")
            return "bg-amber-100 text-amber-800 border border-amber-400 dark:bg-amber-900 dark:text-amber-200";

        if (POSITIVE_STATUSES.has(n))
            return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";

        if (JUNK_STATUSES.has(n))
            return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";

        if (n === "Fresh Leads")
            return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";

        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
    };

    // ─── Filtering ───────────────────────────────────────────────────────────
    const filteredLeads = createMemo(() => {
        return leads().filter((lead) => {
            return (
                (search() === "" ||
                    lead.name.toLowerCase().includes(search().toLowerCase())) &&
                (performanceFilter() === "" ||
                    lead.performance === performanceFilter()) &&
                (statusFilter() === "" ||
                    normalizeStatus(lead.status) === statusFilter())
            );
        });
    });

    // ─── 3 Category Memos ────────────────────────────────────────────────────
    const positiveLeads = createMemo(() =>
        filteredLeads().filter((l) => getCategory(l.status) === "positive")
    );
    const prospectLeads = createMemo(() =>
        filteredLeads().filter((l) => getCategory(l.status) === "prospects")
    );
    const junkLeads = createMemo(() =>
        filteredLeads().filter((l) => getCategory(l.status) === "junk")
    );

    const totalFiltered = createMemo(() => filteredLeads().length || 1);

    const getPct = (count) => Math.round((count / totalFiltered()) * 100);

    // ─── Block Toggle ────────────────────────────────────────────────────────
    const toggleBlock = (key) => {
        setActiveBlock((prev) => (prev === key ? null : key));
    };

    // ─── Edit Handlers ───────────────────────────────────────────────────────
    const handleEdit = (lead) => {
        setSelectedLead({ ...lead });
        setIsEditOpen(true);
    };

    const handleSave = () => {
        const updated = leads().map((l) =>
            l.id === selectedLead().id ? selectedLead() : l
        );
        setLeads(updated);
        setIsEditOpen(false);
    };

    const handleClearFilters = () => {
        setSearch("");
        setPerformanceFilter("");
        setStatusFilter("");
    };

    // ─── Reusable Lead Table ─────────────────────────────────────────────────
    const LeadTable = ({ leadList }) => (
        <div class="hidden md:block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table class="w-full text-sm">
                <thead class="bg-gray-50 dark:bg-gray-800">
                    <tr class="border-b border-gray-200 dark:border-gray-700 [&_th]:text-center [&_th]:whitespace-nowrap [&_th:first-child]:text-left">
                        <th class="p-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
                        <th class="p-3 font-medium text-gray-600 dark:text-gray-400">Contact No</th>
                        <th class="p-3 font-medium text-gray-600 dark:text-gray-400">Email</th>
                        <th class="p-3 font-medium text-gray-600 dark:text-gray-400">Source</th>
                        <th class="p-3 font-medium text-gray-600 dark:text-gray-400">Status</th>
                        <th class="p-3 font-medium text-gray-600 dark:text-gray-400">Performance</th>
                        <th class="p-3 font-medium text-gray-600 dark:text-gray-400">Next Follow-up</th>
                        <th class="p-3 font-medium text-gray-600 dark:text-gray-400">Created On</th>
                        <th class="p-3 font-medium text-gray-600 dark:text-gray-400">Action</th>
                    </tr>
                </thead>
                <tbody>
                    {leadList().length === 0 ? (
                        <tr>
                            <td colspan="9" class="p-6 text-center text-sm text-gray-400 dark:text-gray-500">
                                No leads found in this category.
                            </td>
                        </tr>
                    ) : (
                        <For each={leadList()}>
                            {(lead) => (
                                <tr class="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition [&_td]:text-center [&_td]:whitespace-nowrap [&_td:first-child]:text-left">
                                    <td class="p-3 font-medium">{lead.name}</td>
                                    <td class="p-3">{lead.contact}</td>
                                    <td class="p-3">{lead.email}</td>
                                    <td class="p-3">{lead.source}</td>
                                    <td class="p-3">
                                        <span class={`px-2 py-1 rounded-full text-xs font-medium ${getStatusStyle(lead.status)}`}>
                                            {normalizeStatus(lead.status)}
                                        </span>
                                    </td>
                                    <td class="p-3">{lead.performance}</td>
                                    <td class="p-3">{lead.next_follow}</td>
                                    <td class="p-3">{lead.created}</td>
                                    <td class="p-3">
                                        <div class="flex justify-center">
                                            <button
                                                onClick={() => handleEdit(lead)}
                                                class="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 p-1.5 rounded transition"
                                                title="Edit Lead"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                                                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 .375a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0z" />
                                                </svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </For>
                    )}
                </tbody>
            </table>
        </div>
    );

    // ─── Mobile Card List ─────────────────────────────────────────────────────
    const MobileCards = ({ leadList }) => (
        <div class="md:hidden space-y-3">
            <For each={leadList()}>
                {(lead) => (
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                        <div class="flex justify-between items-start">
                            <div>
                                <h3 class="font-semibold text-gray-900 dark:text-white">{lead.name}</h3>
                                <p class="text-sm text-gray-500 dark:text-gray-400">{lead.contact}</p>
                            </div>
                            <span class={`text-xs px-2 py-1 rounded-full font-medium ${getStatusStyle(lead.status)}`}>
                                {normalizeStatus(lead.status)}
                            </span>
                        </div>
                        <div class="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-600 dark:text-gray-400">
                            <span><span class="font-medium">Source:</span> {lead.source}</span>
                            <span><span class="font-medium">Perf:</span> {lead.performance}</span>
                            <span><span class="font-medium">Follow-up:</span> {lead.next_follow}</span>
                            <span><span class="font-medium">Created:</span> {lead.created}</span>
                        </div>
                        <div class="mt-3 flex justify-end">
                            <button
                                onClick={() => handleEdit(lead)}
                                class="text-blue-500 hover:text-blue-700 text-sm flex items-center gap-1"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                                </svg>
                                Edit
                            </button>
                        </div>
                    </div>
                )}
            </For>
        </div>
    );

    // ─── Block Summary Card ──────────────────────────────────────────────────
    const BlockCard = ({ key, label, sublabel, count, pct, colorScheme, children }) => {
        const schemes = {
            positive: {
                header: "bg-green-50 dark:bg-green-950",
                title: "text-green-700 dark:text-green-300",
                sub: "text-green-600 dark:text-green-400",
                count: "text-green-700 dark:text-green-300",
                bar: "bg-green-500",
                pct: "text-green-600 dark:text-green-400",
                border: "border-green-200 dark:border-green-800",
                activeBorder: "ring-1 ring-green-400 dark:ring-green-500",
                chevron: "text-green-500",
            },
            prospects: {
                header: "bg-yellow-50 dark:bg-amber-950",
                title: "text-yellow-700 dark:text-yellow-300",
                sub: "text-yellow-600 dark:text-yellow-400",
                count: "text-yellow-700 dark:text-yellow-300",
                bar: "bg-yellow-500",
                pct: "text-yellow-600 dark:text-yellow-400",
                border: "border-yellow-200 dark:border-yellow-800",
                activeBorder: "ring-1 ring-yellow-400 dark:ring-yellow-500",
                chevron: "text-yellow-500",
            },
            junk: {
                header: "bg-red-50 dark:bg-red-950",
                title: "text-red-700 dark:text-red-300",
                sub: "text-red-600 dark:text-red-400",
                count: "text-red-700 dark:text-red-300",
                bar: "bg-red-500",
                pct: "text-red-600 dark:text-red-400",
                border: "border-red-200 dark:border-red-800",
                activeBorder: "ring-1 ring-red-400 dark:ring-red-500",
                chevron: "text-red-500",
            },
        };
        const c = schemes[colorScheme];
        const isActive = () => activeBlock() === key;

        return (
            <div class={`rounded-xl border ${c.border} ${isActive() ? c.activeBorder : ""} overflow-hidden cursor-pointer transition-all`}
                onClick={() => toggleBlock(key)}
            >
                {/* Header */}
                <div class={`${c.header} p-4 flex items-center justify-between`}>
                    <div>
                        <div class={`text-sm font-semibold ${c.title}`}>{label}</div>
                        <div class={`text-xs mt-0.5 ${c.sub}`}>{sublabel}</div>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class={`text-3xl font-semibold ${c.count}`}>{count()}</span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none" viewBox="0 0 24 24"
                            stroke-width="2" stroke="currentColor"
                            class={`w-5 h-5 transition-transform ${c.chevron} ${isActive() ? "rotate-180" : ""}`}
                        >
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                    </div>
                </div>

                {/* Progress bar footer */}
                <div class="px-4 py-2.5 flex items-center gap-3 bg-white dark:bg-gray-900">
                    <span class={`text-xs font-semibold ${c.pct} w-9 shrink-0`}>{pct()}%</span>
                    <div class="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div class={`h-full ${c.bar} rounded-full transition-all duration-500`} style={`width: ${pct()}%`} />
                    </div>
                    <span class="text-xs text-gray-500 dark:text-gray-500 shrink-0">of total</span>
                </div>

                {/* Status tags hint */}
                <div class="px-4 pb-3 flex flex-wrap gap-1.5">
                    {children}
                </div>
            </div>
        );
    };

    const StatusTag = ({ label, style }) => (
        <span class={`text-xs px-2 py-0.5 rounded-full ${style}`}>{label}</span>
    );

    return (
        <div class=" min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">

            {/* ── HEADER ─────────────────────────────────────────────────────── */}
            <div class="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-5 shadow-sm">
                <div>
                    <h1 class="text-2xl font-semibold mb-1">Leads Performance</h1>
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                        Track lead progress and optimize your conversion strategy.
                    </p>
                </div>
            </div>

            <div class="p-6">
                {/* ── FILTERS ─────────────────────────────────────────────────────── */}
                <div class="mb-6">
                    <div class="flex gap-3 flex-col md:flex-row flex-wrap">
                        <input
                            value={search()}
                            placeholder="Search leads..."
                            class="w-full md:w-auto bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 
                            placeholder:text-gray-400 text-sm border border-gray-200 dark:border-gray-700 
                            rounded-lg px-4 py-2.5 shadow-sm focus:ring-1 focus:ring-green-400 
                            focus:border-green-400 focus:outline-none transition"
                            onInput={(e) => setSearch(e.target.value)}
                        />

                        <select
                            class="w-full md:w-auto bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 
                            text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 
                            shadow-sm focus:ring-1 focus:ring-green-400 focus:outline-none transition"
                            value={performanceFilter()}
                            onChange={(e) => setPerformanceFilter(e.target.value)}
                        >
                            <option value="">Total Leads Generated</option>
                            <option>Contacted Leads</option>
                            <option>Qualified Leads</option>
                            <option>Follow-ups Pending</option>
                            <option>Site Visits</option>
                            <option>Booking/Conversions</option>
                        </select>

                        <select
                            class="w-full md:w-auto bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 
                            text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 
                            shadow-sm focus:ring-1 focus:ring-green-400 focus:outline-none transition"
                            value={statusFilter()}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="">All Statuses</option>
                            <optgroup label="Positive Outcomes">
                                <option>Site Visit Done</option>
                                <option>Site Visit Scheduled</option>
                                <option>Meeting Done</option>
                                <option>Video Call Done</option>
                                <option>Booking Done</option>
                                <option>Interested</option>
                            </optgroup>
                            <optgroup label="Prospects">
                                <option>Fresh Leads</option>
                                <option>Call Later</option>
                                <option>Not Picked</option>
                                <option>Always Busy</option>
                                <option>Asked to call later</option>
                                <option>Follow-Up</option>
                            </optgroup>
                            <optgroup label="Junk / Invalid">
                                <option>Not Interested</option>
                                <option>Invalid</option>
                                <option>Fake Lead</option>
                                <option>Feeded Leads</option>
                                <option>Broker</option>
                                <option>Low Budget</option>
                                <option>Always Not Picked</option>
                            </optgroup>
                        </select>
                        <button
                            onClick={handleClearFilters}
                            class="px-4 py-2.5 text-sm font-medium rounded-lg bg-white dark:bg-gray-800 
                            text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 
                            hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm transition"
                        >
                            Clear All
                        </button>
                    </div>
                </div>

                {/* ── 3 BLOCK CARDS ───────────────────────────────────────────────── */}
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">

                    {/* Block 1 — Positive Outcomes */}
                    <BlockCard
                        key="positive"
                        label="Positive Outcomes"
                        sublabel="Converted / High Intent"
                        count={() => positiveLeads().length} 
                        pct={() => getPct(positiveLeads().length)}
                        colorScheme="positive"
                    >
                        <StatusTag label="Booking Done" style="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" />
                        <StatusTag label="Site Visit Done" style="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" />
                        <StatusTag label="Interested" style="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" />
                    </BlockCard>

                    {/* Block 2 — Prospects */}
                    <BlockCard
                        key="prospects"
                        label="Prospects"
                        sublabel="Active / Nurturing Stage"
                        count={() => prospectLeads().length}
                        pct={() => getPct(prospectLeads().length)}
                        colorScheme="prospects"
                    >
                        <StatusTag label="Fresh Leads" style="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" />
                        <StatusTag label="Follow-Up" style="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" />
                        <StatusTag label="Not Picked" style="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" />
                    </BlockCard>

                    {/* Block 3 — Junk */}
                    <BlockCard
                        key="junk"
                        label="Junk / Invalid Leads"
                        sublabel="Low Quality"
                        count={()=> junkLeads().length}
                        pct={() => getPct(junkLeads().length)}
                        colorScheme="junk"
                    >
                        <StatusTag label="Not Interested" style="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" />
                        <StatusTag label="Fake Lead" style="bg-amber-100 text-amber-800 border border-amber-400 dark:bg-amber-900 dark:text-amber-200" />
                        <StatusTag label="Invalid" style="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" />
                    </BlockCard>
                </div>

                {/* ── DRILL-DOWN TABLES ────────────────────────────────────────────── */}
                {activeBlock() === "positive" && (
                    <div class="mb-6">
                        <div class="flex items-center gap-2 mb-3">
                            <div class="w-2 h-2 rounded-full bg-green-500" />
                            <span class="text-xs font-semibold uppercase tracking-widest text-green-600 dark:text-green-400">
                                Positive Outcomes
                            </span>
                            <span class="text-sm font-semibold text-gray-600 dark:text-gray-400 ml-1">
                                ({positiveLeads().length} leads)
                            </span>
                        </div>
                        <LeadTable leadList={positiveLeads} />
                        <MobileCards leadList={positiveLeads} />
                    </div>
                )}

                {activeBlock() === "prospects" && (
                    <div class="mb-6">
                        <div class="flex items-center gap-2 mb-3">
                            <div class="w-2 h-2 rounded-full bg-yellow-500" />
                            <span class="text-xs font-semibold uppercase tracking-widest text-yellow-600 dark:text-yellow-400">
                                Prospects
                            </span>
                            <span class="text-sm font-semibold text-gray-600 dark:text-gray-400 ml-1">
                                ({prospectLeads().length} leads)
                            </span>
                        </div>
                        <LeadTable leadList={prospectLeads} />
                        <MobileCards leadList={prospectLeads} />
                    </div>
                )}

                {activeBlock() === "junk" && (
                    <div class="mb-6">
                        <div class="flex items-center gap-2 mb-3">
                            <div class="w-2 h-2 rounded-full bg-red-500" />
                            <span class="text-xs font-semibold uppercase tracking-widest text-red-600 dark:text-red-400">
                                Junk / Invalid Leads
                            </span>
                            <span class="text-sm font-semibold text-gray-600 dark:text-gray-400 ml-1">
                                ({junkLeads().length} leads)
                            </span>
                        </div>
                        <LeadTable leadList={junkLeads} />
                        <MobileCards leadList={junkLeads} />
                    </div>
                )}

                {/* ── EDIT SIDEBAR ─────────────────────────────────────────────────── */}
                {isEditOpen() && (
                    <div class="fixed inset-0 z-50 flex">
                        {/* Overlay */}
                        <div
                            class="absolute inset-0 bg-black/40 transition-opacity"
                            onClick={() => setIsEditOpen(false)}
                        />

                        {/* Sidebar Panel */}
                        <div class="ml-auto w-full md:w-[600px] h-full bg-white dark:bg-gray-900 shadow-2xl p-8 relative z-10 overflow-y-auto">
                            <h2 class="text-lg font-semibold mb-1">Edit Lead Performance</h2>
                            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
                                Track lead progress and optimize your conversion strategy.
                            </p>

                            <div class="space-y-4 border border-gray-200 dark:border-gray-700 rounded-xl p-5 bg-gray-50 dark:bg-gray-800/50">

                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                                        <input
                                            value={selectedLead()?.name}
                                            onInput={(e) => setSelectedLead({ ...selectedLead(), name: e.target.value })}
                                            class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                            placeholder="Name"
                                        />
                                    </div>
                                    <div>
                                        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Contact</label>
                                        <input
                                            value={selectedLead()?.contact}
                                            onInput={(e) => setSelectedLead({ ...selectedLead(), contact: e.target.value })}
                                            class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                            placeholder="Contact"
                                        />
                                    </div>
                                </div>

                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Email</label>
                                        <input
                                            value={selectedLead()?.email}
                                            onInput={(e) => setSelectedLead({ ...selectedLead(), email: e.target.value })}
                                            class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                            placeholder="Email"
                                        />
                                    </div>
                                    <div>
                                        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Source</label>
                                        <input
                                            value={selectedLead()?.source}
                                            onInput={(e) => setSelectedLead({ ...selectedLead(), source: e.target.value })}
                                            class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                            placeholder="Source"
                                        />
                                    </div>
                                </div>

                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
                                        <select
                                            value={selectedLead()?.status}
                                            onChange={(e) => setSelectedLead({ ...selectedLead(), status: e.target.value })}
                                            class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                        >
                                            <optgroup label="Positive Outcomes">
                                                <option>Site Visit Done</option>
                                                <option>Site Visit Scheduled</option>
                                                <option>Meeting Done</option>
                                                <option>Video Call Done</option>
                                                <option>Booking Done</option>
                                                <option>Interested</option>
                                            </optgroup>
                                            <optgroup label="Prospects">
                                                <option>Fresh Leads</option>
                                                <option>Call Later</option>
                                                <option>Not Picked</option>
                                                <option>Always Busy</option>
                                                <option>Asked to call later</option>
                                                <option>Follow-Up</option>
                                            </optgroup>
                                            <optgroup label="Junk / Invalid">
                                                <option>Not Interested</option>
                                                <option>Invalid</option>
                                                <option>Fake Lead</option>
                                                <option>Feeded Leads</option>
                                                <option>Broker</option>
                                                <option>Low Budget</option>
                                                <option>Always Not Picked</option>
                                            </optgroup>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Performance</label>
                                        <select
                                            value={selectedLead()?.performance}
                                            onChange={(e) => setSelectedLead({ ...selectedLead(), performance: e.target.value })}
                                            class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                        >
                                            <option>Contacted Leads</option>
                                            <option>Qualified Leads</option>
                                            <option>Follow-ups Pending</option>
                                            <option>Site Visits</option>
                                            <option>Booking/Conversions</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Next Follow-up</label>
                                        <input
                                            value={selectedLead()?.next_follow}
                                            type="date"
                                            onInput={(e) => setSelectedLead({ ...selectedLead(), next_follow: e.target.value })}
                                            class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                        />
                                    </div>
                                    <div>
                                        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Created At</label>
                                        <input
                                            value={selectedLead()?.created}
                                            type="date"
                                            onInput={(e) => setSelectedLead({ ...selectedLead(), created: e.target.value })}
                                            class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div class="flex gap-3 mt-6">
                                <button
                                    onClick={handleSave}
                                    class="px-5 py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition"
                                >
                                    Save Changes
                                </button>
                                <button
                                    onClick={() => setIsEditOpen(false)}
                                    class="px-5 py-2.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium 
                                    border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LeadsPage;