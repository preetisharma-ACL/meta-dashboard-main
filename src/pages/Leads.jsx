import { createSignal, For, createMemo } from "solid-js";
import { Index } from "solid-js";

const Leads = () => {
    const [darkMode, setDarkMode] = createSignal(false);
    const [search, setSearch] = createSignal("");
    const [statusFilter, setStatusFilter] = createSignal("");
    const [isEditOpen, setIsEditOpen] = createSignal(false);
    const [selectedLead, setSelectedLead] = createSignal(null);
    const [editIndex, setEditIndex] = createSignal(null);
    const [leads, setLeads] = createSignal([
        {
            name: "Preeti",
            contact: "9876543210",
            status: "Fresh",
            Remark: null,
            next_follow: "Mar 25 2026",
            project: "ABC Corp",
            action: "",
        },
        {
            name: "Akhil",
            contact: "9876543210",
            status: "site visit done",
            Remark: null,
            next_follow: "Mar 25 2026",
            project: "XYZ Corp",
            action: "",
        },
        {
            name: "Preeti",
            contact: "9876543210",
            status: "Fresh",
            Remark: null,
            next_follow: "Mar 25 2026",
            project: "ABC Corp",
            action: "",
        },
        {
            name: "Preeti",
            contact: "9876543210",
            status: "Fresh",
            Remark: null,
            next_follow: "Mar 25 2026",
            project: "ABC Corp",
            action: "",
        },
        {
            name: "Preeti",
            contact: "9876543210",
            status: "Fresh",
            Remark: null,
            next_follow: "Mar 25 2026",
            project: "ABC Corp",
            action: "",
        },
        {
            name: "Preeti",
            contact: "9876543210",
            status: "Fresh",
            Remark: null,
            next_follow: "Mar 25 2026",
            project: "ABC Corp",
            action: "",
        },
    ]);

    // 🔹 Leads Data (you can replace with API)

    // Open Edit
    const handleEdit = (lead, index) => {
        setSelectedLead({ ...lead });
        setEditIndex(index);
        setIsEditOpen(true);
    };

    // Save Edit
    const handleSave = () => {
        const updated = [...leads()];
        updated[editIndex()] = selectedLead();
        setLeads(updated);
        setIsEditOpen(false);
    };

    //  Delete
    const handleDelete = (index) => {
        if (confirm("Are you sure you want to delete this lead?")) {
            const updated = leads().filter((_, i) => i !== index);
            setLeads(updated);
        }
    };
    // 🔹 Status Color Logic (YOUR FUNNEL RULES)
    const getStatusStyle = (status) => {
        switch (status) {
            case "Fresh Leads":
                return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";

            case "Call Later":
            case "Not Picked":
            case "Asked to call later":
            case "Always Busy":
                return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";

            case "Interested":
            case "Follow-Up":
            case "Site Visit Scheduled":
            case "Site Visit Done":
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

    // 🔹 Filtering Logic
    const filteredLeads = createMemo(() => {
        return leads().filter((lead) => {
            return (
                (search() === "" ||
                    lead.name.toLowerCase().includes(search().toLowerCase())) &&
                (statusFilter() === "" || normalizeStatus(lead.status) === statusFilter())
            );
        });
    });
    const normalizeStatus = (status) => {
        if (!status) return "";

        const s = status.toLowerCase().trim();

        // Blue
        if (["fresh", "fresh leads"].includes(s)) return "Fresh Leads";

        // Yellow
        if (["call later"].includes(s)) return "Call Later";
        if (["not picked", "call not picked"].includes(s)) return "Not Picked";
        if (["asked to call later"].includes(s)) return "Asked to call later";
        if (["always busy", "busy"].includes(s)) return "Always Busy";

        // Green
        if (["interested"].includes(s)) return "Interested";
        if (["follow-up", "follow up"].includes(s)) return "Follow-Up";
        if (["site visit scheduled"].includes(s)) return "Site Visit Scheduled";
        if (["site visit done", "site visit"].includes(s)) return "Site Visit Done";
        if (["booking done"].includes(s)) return "Booking Done";

        // Red
        if (["invalid"].includes(s)) return "Invalid";
        if (["low budget"].includes(s)) return "Low Budget";
        if (["not interested"].includes(s)) return "Not Interested";
        if (["broker"].includes(s)) return "Broker";
        if (["always not picked"].includes(s)) return "Always Not Picked";
        if (["feeded leads"].includes(s)) return "Feeded Leads";

        return status; // fallback
    };
    const handleClearFilters = () => {
        setSearch("");
        setStatusFilter("");
    }

    const STATUS_OPTIONS = [
        "Fresh Leads",
        "Call Later",
        "Not Picked",
        "Always Busy",
        "Asked to call later",
        "Interested",
        "Follow-Up",
        "Site Visit Scheduled",
        "Site Visit Done",
        "Booking Done",
        "Invalid",
        "Low Budget",
        "Not Interested",
        "Broker",
        "Always Not Picked",
        "Feeded Leads"
    ];
    const handleFieldChange = (index, field, value) => {
        const updated = [...leads()];
        updated[index] = {
            ...updated[index],
            [field]: value
        };
        setLeads(updated);
    };

    return (
        <div class="p-4 md:p-6 min-h-screen bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">

            {/* HEADER */}
            <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6">
                <div>
                    <h1 class="text-2xl md:text-2xl font-semibold mb-1">Leads </h1>
                    <p class="text-md text-gray-700 dark:text-gray-400">Track lead progress and optimize your conversion strategy.</p>
                </div>
                {/* <div class="flex gap-2">
                    <button
                        class="px-4 py-2.5 text-sm font-medium rounded 
                        bg-green-500 dark:bg-green-600 
                        text-white 
                        border border-green-500 dark:border-green-600 
                        shadow-sm
                        hover:bg-green-600 dark:hover:bg-green-700 
                        hover:border-green-400 dark:hover:border-green-500
                        transition duration-200"
                    >
                        Export All
                    </button>
                </div> */}
            </div>

            {/* FILTERS */}
            <div class=" mb-6 space-y-3">
                <div class="flex gap-4 flex-col md:flex-row">

                    {/* Search Input */}
                    <input
                        placeholder="Search leads..."
                        class="w-full md:w-auto 
                        bg-white dark:bg-gray-800 
                        text-gray-800 dark:text-gray-200 
                        placeholder:text-gray-500 dark:placeholder:text-gray-400 
                        text-sm border border-gray-300 dark:border-gray-700 
                        rounded-lg px-4 py-3 shadow-sm
                        focus:ring-1 focus:ring-green-500 focus:border-green-500 focus:outline-none focus:ring-offset-2
                        hover:border-gray-400 dark:hover:border-gray-500
                        transition duration-200"
                        onInput={(e) => setSearch(e.target.value)}
                    />

                    {/* Status Filter */}
                    <select
                        class="w-full md:w-auto 
                        bg-white shadow dark:bg-gray-800 
                        text-gray-800 dark:text-gray-200 
                        text-sm border border-gray-300 dark:border-gray-700 
                        rounded-lg px-4 py-3 
                        focus:ring-1 focus:ring-green-500 focus:border-green-500 focus:outline-none focus:ring-offset-2
                        transition duration-200 "
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="">Status</option>
                        <option>Fresh Leads</option>
                        <option>Call Later</option>
                        <option>Not Picked</option>
                        <option>Always Busy</option>
                        <option>Asked to call later</option>
                        <option>Interested</option>
                        <option>Site Visit Done</option>
                        <option>Site Visit Scheduled</option>
                        <option>Booking Done</option>
                        <option>Follow-Up</option>
                        <option>Invalid</option>
                        <option>Low Budget</option>
                        <option>Not Interested</option>
                        <option>Broker</option>
                        <option>Always Not Picked</option>
                        <option>Feeded Leads</option>
                        <option>Not Interested</option>
                    </select>
                    <div>
                        <button onClick={handleClearFilters} class="px-4 py-2.5 text-sm font-medium rounded-md bg-green-500 text-white border border-green-500 hover:bg-green-600 hover:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-500 focus:ring-offset-2">
                            Clear All
                        </button>
                    </div>
                </div>
            </div>

            {/* DESKTOP TABLE */}
            <div class="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                <table class="w-full text-sm border dark:border-gray-700">

                    {/* Table Head */}
                    <thead class="bg-gray-100 dark:bg-gray-800">
                        <tr class="[&_th]:text-center [&_th]:whitespace-nowrap [&_th:first-child]:text-left border-b border-gray-200 dark:border-gray-700">
                            <th class="p-3">Name</th>
                            <th class="p-3">Contact No</th>
                            <th class="p-3">Project</th>
                            <th class="p-3">Status</th>
                            <th class="p-3">Remark</th>
                            <th class="p-3">Next Follow-up</th>
                            <th class="p-3">Action</th>
                        </tr>
                    </thead>

                    {/* Table Body */}
                    <tbody class="bg-white dark:bg-gray-900">

                        <Index each={filteredLeads()}>
                            {(lead, index) => (
                                <tr class="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition
                                    [&_td]:text-center [&_td]:whitespace-nowrap [&_td:first-child]:text-left">

                                    <td class="p-3">{lead().name}</td>

                                    <td class="p-3">{lead().contact}</td>

                                    <td class="p-3">{lead().project}</td>

                                    <td class="p-3">
                                        <select
                                            value={normalizeStatus(lead().status)}
                                            onChange={(e) => handleFieldChange(index, "status", e.target.value)}
                                            class={`px-2 py-1 rounded border text-sm 
                                                ${getStatusStyle(normalizeStatus(lead().status))}
                                                bg-white dark:bg-gray-800`}
                                        >
                                            <For each={STATUS_OPTIONS}>
                                                {(status) => (
                                                    <option value={status}>{status}</option>
                                                )}
                                            </For>
                                        </select>
                                    </td>

                                    <td class="p-3">
                                        <input
                                            type="text"
                                            value={lead().Remark}
                                            onInput={(e) =>
                                                handleFieldChange(index, "Remark", e.target.value)
                                            }
                                            placeholder="Enter remark..."
                                            class="w-full px-2 py-1 text-sm border rounded 
                                                    bg-white dark:bg-gray-800 
                                                    text-gray-800 dark:text-gray-200"
                                        />
                                    </td>

                                    <td class="p-3">{lead().next_follow}</td>

                                    <td class="p-3 flex justify-center gap-3">

                                        {/* Edit */}
                                        <button
                                            onClick={() => handleEdit(lead(), index)}
                                            class="text-blue-500 hover:text-blue-700 text-lg"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                                                <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 .375a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0z" />
                                            </svg>
                                        </button>
                                        {/* Delete */}
                                        <button
                                            onClick={() => handleDelete(index)}
                                            class="text-red-500 hover:text-red-700 text-lg"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                                                <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0c.34.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79" />
                                            </svg>
                                        </button>
                                    </td>
                                </tr>
                            )}
                        </Index>
                    </tbody>
                </table>
            </div>

            {/* MOBILE CARDS */}
            <div class="md:hidden space-y-3">
                <For each={filteredLeads()}>
                    {(lead) => (
                        <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow">
                            <div class="flex justify-between">
                                <h3 class="font-semibold">{lead.name}</h3>
                                <span class={`text-xs px-2 py-1 rounded ${getStatusStyle(normalizeStatus(lead.status))}`}>
                                    {normalizeStatus(lead.status)}
                                </span>
                            </div>

                            <p class="text-sm text-gray-500">{lead.project}</p>

                            <div class="flex justify-between mt-2 text-sm">
                                <span>{lead.next}</span>
                                <span class="text-red-500">{lead.user}</span>
                            </div>
                        </div>
                    )}
                </For>
            </div>

            {/* Edit Sidebar */}
            {
                isEditOpen() && (
                    <div class="fixed inset-0 z-50 flex">

                        {/* Overlay */}
                        <div
                            class="absolute inset-0 bg-black/40"
                            onClick={() => setIsEditOpen(false)}
                        ></div>

                        {/* Sidebar */}
                        <div class="ml-auto w-full md:w-[600px] h-full bg-white dark:bg-gray-900 shadow-xl p-8 relative z-10 transition">
                            <h2 class="text-lg font-semibold mb-2">Edit Leads Data</h2>
                            <p class="text-md text-gray-700 dark:text-gray-400 mb-5">Track lead progress and optimize your conversion strategy.</p>

                            {/* Inputs */}
                            <div class="space-y-3 border rounded p-6 bg-gray-50 dark:bg-gray-900">

                                <div class="grid grid-cols-2 gap-4 mb-5">
                                    <div>
                                        <label class="text-md text-gray-600 dark:text-gray-400 mb-1">Name</label>
                                        <input
                                            value={selectedLead()?.name || ""}
                                            onInput={(e) =>
                                                setSelectedLead({ ...selectedLead(), name: e.target.value })
                                            }
                                            class="w-full p-2 border rounded dark:bg-gray-800"
                                            placeholder="Name"
                                        />
                                    </div>

                                    <div>
                                        <label class="text-md text-gray-600 dark:text-gray-400 mb-1">Contact</label>
                                        <input
                                            value={selectedLead()?.contact || ""}
                                            onInput={(e) =>
                                                setSelectedLead({ ...selectedLead(), contact: e.target.value })
                                            }
                                            class="w-full p-2 border rounded dark:bg-gray-800"
                                            placeholder="Contact"
                                        />
                                    </div>
                                </div>

                                <div class="grid grid-cols-2 gap-4 mb-5">
                                    <div>
                                        <label class="text-md text-gray-600 dark:text-gray-400 mb-1">Next Follow-up</label>
                                        <input
                                            value={selectedLead()?.next_follow || ""}
                                            type="date"
                                            onInput={(e) =>
                                                setSelectedLead({ ...selectedLead(), next_follow: e.target.value })
                                            }
                                            class="w-full p-2 border rounded dark:bg-gray-800"
                                            placeholder="Next Follow-up"
                                        />
                                    </div>
                                    <div>
                                        <label class="text-md text-gray-600 mb-2">Status</label>
                                        <input
                                            value={selectedLead()?.status || ""}
                                            onInput={(e) =>
                                                setSelectedLead({ ...selectedLead(), status: e.target.value })
                                            }
                                            class="w-full p-2 border rounded dark:bg-gray-800"
                                            placeholder="Status"
                                        />
                                    </div>
                                </div>
                                 <div class="grid grid-cols-2 gap-4 mb-5">
                                    <div>
                                        <label class="text-md text-gray-600 dark:text-gray-400 mb-1">Project</label>
                                        <input
                                            value={selectedLead()?.project || ""}
                                            type="date"
                                            onInput={(e) =>
                                                setSelectedLead({ ...selectedLead(), project: e.target.value })
                                            }
                                            class="w-full p-2 border rounded dark:bg-gray-800"
                                            placeholder="Project"
                                        />
                                    </div>
                                    <div>
                                        <label class="text-md text-gray-600 mb-2">Remark</label>
                                        <input
                                            value={selectedLead()?.Remark || ""}
                                            onInput={(e) =>
                                                setSelectedLead({ ...selectedLead(), Remark : e.target.value })
                                            }
                                            class="w-full p-2 border rounded dark:bg-gray-800"
                                            placeholder="Remark"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Buttons */}
                            <div class="flex gap-2 mt-6">
                                <button
                                    onClick={handleSave}
                                    class="px-4 py-2 bg-green-600 text-white rounded"
                                >
                                    Save
                                </button>

                                <button
                                    onClick={() => setIsEditOpen(false)}
                                    class="px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                >
                                    Cancel
                                </button>
                            </div>

                        </div>
                    </div>
                )
            }
        </div>
    );
};

export default Leads;