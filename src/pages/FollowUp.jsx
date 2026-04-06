import { createMemo, createSignal, Index, onMount, Show } from "solid-js";
import { leads, fetchLeads, updateLead, deleteLead } from "../store/leadsStore";

const FollowUp = () => {

    const [editingLead, setEditingLead] = createSignal(null);
    const [formData, setFormData] = createSignal({});

    // Separate mount vs visible signals so CSS transition has time to run
    const [sidebarVisible, setSidebarVisible] = createSignal(false);
    const [sidebarMounted, setSidebarMounted] = createSignal(false);
    const [modalVisible, setModalVisible] = createSignal(false);
    const [modalMounted, setModalMounted] = createSignal(false);

    onMount(() => {
        fetchLeads();
    });

    const handleFieldChange = (id, field, value) => {
        const lead = leads().find((l) => l.id === id);
        if (!lead) return;
        updateLead({ ...lead, [field]: value });
    };

    // ── Sidebar ──
    const openEdit = (lead) => {
        setFormData({ ...lead });
        setEditingLead(lead);
        setSidebarMounted(true);
        // Two rAFs: first lets the DOM mount, second starts the CSS transition
        requestAnimationFrame(() => {
            requestAnimationFrame(() => setSidebarVisible(true));
        });
    };

    const closeEdit = () => {
        setSidebarVisible(false);
        setTimeout(() => {
            setSidebarMounted(false);
            setEditingLead(null);
            setFormData({});
        }, 300); // matches transition-duration below
    };





    const handleFormChange = (field, value) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSave = () => {
        updateLead({ ...formData() });
        closeEdit();
    };



    const followStatuses = [
        "call later", "not picked", "call not picked",
        "asked to call later", "interested", "site visit scheduled",
        "follow-up", "follow up", "always busy", "site visit done",
    ];

    const allStatuses = [
        "Fresh Leads", "Call Later", "Not Picked", "Call Not Picked",
        "Asked to Call Later", "Always Busy", "Interested", "Follow-Up",
        "Site Visit Scheduled", "Site Visit Done", "Booking Done",
        "Invalid", "Low Budget", "Not Interested", "Broker",
        "Always Not Picked", "Feeded Leads",
    ];

    const getStatusStyle = (status) => {
        switch (status) {
            case "Fresh Leads":
                return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
            case "Call Later":
            case "not picked":
            case "call not picked":
            case "Asked to call later":
            case "Always Busy":
                return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
            case "Interested":
            case "Follow-Up":
            case "Site Visit Scheduled":
            case "site visit done":
            case "Booking Done":
                return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
            case "Invalid":
            case "Low Budget":
            case "Not Interested":
            case "Broker":
            case "Always Not Picked":
            case "Feeded Leads":
                return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
            default:
                return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
        }
    };

    const followUps = createMemo(() => {
        return leads().filter((lead) => {
            const status = lead.status?.toLowerCase().trim();
            return followStatuses.includes(status);
        });
    });

    return (
        <div class="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 transition">

            {/* HEADER */}
            <div class="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-5 shadow-sm">
                <h1 class="text-2xl font-bold">Follow-Up Leads</h1>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                    Manage and track your follow-up leads
                </p>
            </div>

            {/* TABLE */}
            <div class="p-6">
                <div class="bg-white dark:bg-gray-900 rounded-2xl shadow border border-gray-200 dark:border-gray-800 overflow-hidden">
                    <table class="w-full text-sm border dark:border-gray-700">

                        <thead>
                            <tr class="[&_th]:text-center [&_th]:whitespace-nowrap [&_th:first-child]:text-left bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                <th class="p-4">Name</th>
                                <th class="p-4">Contact</th>
                                <th class="p-4">Email</th>
                                <th class="p-4">Project</th>
                                <th class="p-4">Status</th>
                                <th class="p-4">Remark</th>
                                <th class="p-4">Next Follow-Up</th>
                                <th class="p-4">Action</th>
                            </tr>
                        </thead>

                        <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
                            <Index each={followUps()}>
                                {(lead) => (
                                    <tr class="[&_td]:text-center [&_td]:whitespace-nowrap [&_td:first-child]:text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition">

                                        <td class="p-3 font-medium">{lead().name}</td>
                                        <td class="p-3 text-gray-600 dark:text-gray-300">{lead().contact}</td>
                                        <td class="p-3 text-gray-600 dark:text-gray-300">{lead().email}</td>
                                        <td class="p-3 text-gray-600 dark:text-gray-300">{lead().project}</td>
                                        <td class="p-3">
                                            <span class={`px-2 py-1 rounded ${getStatusStyle(lead().status)}`}>
                                                {lead().status}
                                            </span>
                                        </td>

                                        <td class="p-3">
                                            <input
                                                value={lead().Remark || ""}
                                                placeholder="Add remark..."
                                                onInput={(e) => handleFieldChange(lead().id, "Remark", e.target.value)}
                                                class="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent focus:ring-1 focus:ring-blue-900 outline-none"
                                            />
                                        </td>

                                        <td class="p-3">
                                            <input
                                                type="date"
                                                value={lead().next_follow}
                                                onInput={(e) => handleFieldChange(lead().id, "next_follow", e.target.value)}
                                                class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                        </td>

                                        <td class="px-4 py-3.5">
                                            <div class="flex items-center justify-center gap-2">

                                                {/* Call */}
                                                <a href={`tel:${lead().contact}`} title={`Call ${lead().name}`}
                                                    class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-900 text-white hover:bg-blue-100 border border-gray-200 dark:border-blue-500 hover:border-blue-300 hover:text-blue-600 transition-all duration-150 shadow-sm hover:shadow">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.36 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z" />
                                                    </svg>
                                                </a>

                                                {/* WhatsApp */}
                                                <a href={`https://wa.me/${lead().contact?.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title={`WhatsApp ${lead().name}`}
                                                    class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-600 text-white hover:bg-emerald-100 border border-gray-200 hover:border-emerald-300 hover:text-emerald-600 transition-all duration-150 shadow-sm hover:shadow">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
                                                    </svg>
                                                </a>

                                                {/* Edit */}
                                                <button onClick={() => openEdit(lead())} title={`Edit ${lead().name}`}
                                                    class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white hover:bg-amber-100 border border-amber-400 hover:border-amber-300 hover:text-amber-600 transition-all duration-150 shadow-sm hover:shadow">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </td>

                                    </tr>
                                )}
                            </Index>
                        </tbody>
                    </table>

                    {followUps().length === 0 && (
                        <div class="text-center py-10 text-gray-500 dark:text-gray-400">
                            No follow-up leads found
                        </div>
                    )}
                </div>
            </div>


            {/* ── EDIT SIDEBAR ── */}
            <Show when={sidebarMounted()}>
                <div class="fixed inset-0 z-50 flex">
                    {/* Backdrop */}
                    <div
                        onClick={closeEdit}
                        class="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity duration-300"
                        style={{ opacity: sidebarVisible() ? "1" : "0" }}
                    />

                    {/* Panel — slides in from the right */}
                    <div
                        class="fixed inset-y-0 right-0 z-50 w-full max-w-md flex flex-col bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 transition-transform duration-300 ease-in-out"
                        style={{ transform: sidebarVisible() ? "translateX(0)" : "translateX(100%)" }}
                    >

                        {/* Header */}
                        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                            <div>
                                <h2 class="text-lg font-bold text-gray-800 dark:text-gray-100">Edit Lead</h2>
                                <p class="text-sm text-gray-500 dark:text-gray-400">Update lead information</p>
                            </div>
                            <button onClick={closeEdit}
                                class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition">
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>

                        {/* Scrollable body */}
                        <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
                                <input type="text" value={formData().name || ""} onInput={(e) => handleFormChange("name", e.target.value)}
                                    placeholder="Lead name"
                                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm transition" />
                            </div>

                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Contact</label>
                                <input type="text" value={formData().contact || ""} onInput={(e) => handleFormChange("contact", e.target.value)}
                                    placeholder="Phone number"
                                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm transition" />
                            </div>

                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Project</label>
                                <input type="text" value={formData().project || ""} onInput={(e) => handleFormChange("project", e.target.value)}
                                    placeholder="Project name"
                                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm transition" />
                            </div>

                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Status</label>
                                <select value={formData().status || ""} onChange={(e) => handleFormChange("status", e.target.value)}
                                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm transition">
                                    <option value="" disabled>Select status</option>
                                    {allStatuses.map((s) => <option value={s}>{s}</option>)}
                                </select>
                            </div>

                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Remark</label>
                                <textarea value={formData().Remark || ""} onInput={(e) => handleFormChange("Remark", e.target.value)}
                                    rows={3} placeholder="Add remark..."
                                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm transition resize-none" />
                            </div>

                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Next Follow-Up Date</label>
                                <input type="date" value={formData().next_follow || ""} onInput={(e) => handleFormChange("next_follow", e.target.value)}
                                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm transition" />
                            </div>

                        </div>

                        {/* Footer */}
                        <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex gap-3">
                            <button onClick={closeEdit}
                                class="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-sm font-medium">
                                Cancel
                            </button>
                            <button onClick={handleSave}
                                class="flex-1 px-4 py-2.5 rounded-lg bg-blue-900 text-white hover:bg-blue-800 transition text-sm font-medium shadow-sm">
                                Save Changes
                            </button>
                        </div>

                    </div>
                </div>
            </Show>

        </div>
    );
};

export default FollowUp;