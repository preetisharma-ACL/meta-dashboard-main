import { createSignal, createMemo, For } from "solid-js";
import { Index } from "solid-js";

const FollowUp = () => {

    // 🔹 Sample Leads Data (same as Leads page)
    const [leads, setLeads] = createSignal([
        {
            name: "Preeti",
            contact: "9876543210",
            status: "Fresh",
            Remark: "Call later",
            next_follow: "2026-03-30",
            project: "ABC Corp",
        },
        {
            name: "ABC",
            contact: "9876543210",
            status: "Interested",
            Remark: "Site visit",
            next_follow: "2026-03-31",
            project: "XYZ Corp",
        },
        {
            name: "Rahul",
            contact: "9876543210",
            status: "Follow-Up",
            Remark: "Budget discussion",
            next_follow: "2026-04-02",
            project: "PQR Corp",
        },
    ]);

    // 🔹 Update field
    const handleFieldChange = (index, field, value) => {
        const updated = [...leads()];
        updated[index] = {
            ...updated[index],
            [field]: value
        };
        setLeads(updated);
    };

    // 🔹 Today Date
    const today = new Date().toISOString().split("T")[0];

    // 🔹 Filter Follow-ups (important logic)
    const followUps = createMemo(() => {
        return leads().filter((lead) => {
            return lead.next_follow && lead.next_follow <= today;
        });
    });

    // 🔹 Status color
    const getFollowUpType = (date) => {
        if (!date) return "";

        if (date < today) return "Overdue";
        if (date === today) return "Today";
        return "Upcoming";
    };

    // const getColor = (type) => {
    //     switch (type) {
    //         case "Overdue":
    //             return "bg-red-100 text-red-700";
    //         case "Today":
    //             return "bg-yellow-100 text-yellow-700";
    //         case "Upcoming":
    //             return "bg-green-100 text-green-700";
    //         default:
    //             return "bg-gray-100 text-gray-700";
    //     }
    // };

    return (
        <div class="p-6 min-h-screen bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">

            {/* HEADER */}
            <div class="mb-6">
                <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">
                    Follow-Up Leads
                </h1>
                <p class="text-gray-500 dark:text-gray-400">
                    Manage today's and overdue follow-ups
                </p>
            </div>

            {/* TABLE */}
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden border border-gray-200 dark:border-gray-700">
                <table class="w-full text-sm">
                    {/* HEAD */}
                    <thead class="bg-gray-100 dark:bg-gray-800">
                        <tr class="border-b border-gray-200 dark:border-gray-700">
                            <th class="p-3 text-left">Name</th>
                            <th class="p-3">Contact</th>
                            <th class="p-3">Project</th>
                            <th class="p-3">Status</th>
                            <th class="p-3">Remark</th>
                            <th class="p-3">Follow-up</th>
                            <th class="p-3">Action</th>
                        </tr>
                    </thead>

                    {/* BODY */}
                    <tbody class="bg-white dark:bg-gray-900">
                        <Index each={followUps()}>
                            {(lead, index) => {
                                const type = getFollowUpType(lead().next_follow);
                                return (
                                    <tr class="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition">

                                        {/* Name */}
                                        <td class="p-3">{lead().name}</td>

                                        {/* Contact */}
                                        <td class="p-3 text-center">{lead().contact}</td>

                                        {/* Project */}
                                        <td class="p-3 text-center">{lead().project}</td>

                                        {/* Status */}
                                        <td class="p-3 text-center">
                                            <select
                                                value={lead().status}
                                                onChange={(e) =>
                                                    handleFieldChange(index(), "status", e.target.value)
                                                }
                                                class="border border-gray-300 dark:border-gray-700 
                                               bg-white dark:bg-gray-800 
                                               text-gray-800 dark:text-gray-200
                                               px-2 py-1 rounded"
                                            >
                                                <option>Fresh</option>
                                                <option>Interested</option>
                                                <option>Follow-Up</option>
                                                <option>Not Interested</option>
                                            </select>
                                        </td>

                                        {/* Remark */}
                                        <td class="p-3">
                                            <input
                                                value={lead().Remark || ""}
                                                placeholder="Enter Remark..."
                                                onInput={(e) =>
                                                    handleFieldChange(index(), "Remark", e.target.value)
                                                }
                                                class="w-full border border-gray-300 dark:border-gray-700 
                                               bg-white dark:bg-gray-800 
                                               text-gray-800 dark:text-gray-200
                                               px-2 py-1 rounded"
                                            />
                                        </td>

                                        {/* Date */}
                                        <td class="p-3 text-center">
                                            <input
                                                type="date"
                                                value={lead().next_follow}
                                                onInput={(e) =>
                                                    handleFieldChange(index(), "next_follow", e.target.value)
                                                }
                                                class="border border-gray-300 dark:border-gray-600 
                                               bg-white dark:bg-gray-700 
                                               text-gray-800 dark:text-gray-200
                                               px-2 py-1 rounded"
                                            />
                                        </td>

                                        {/* Type */}
                                        {/* <td class="p-3 text-center">
                                            <span class={`px-2 py-1 rounded text-xs ${getColor(type)}`}>
                                                {type}
                                            </span>
                                        </td> */}
                                        <td class="p-3 text-center flex gap-3 justify-center">

                                            {/* WhatsApp */}

                                            <a
                                                href="https://api.whatsapp.com/"
                                                // href={`https://wa.me/${lead.contact}`}
                                                target="_blank"
                                                class="p-2 bg-green-500 font-bold hover:bg-green-600 text-white rounded-full"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" class="w-5 h-5 fill-white">
                                                    <path d="M16.04 2C8.94 2 3.1 7.84 3.1 14.94c0 2.63.77 5.16 2.22 7.34L3 30l7.92-2.28c2.09 1.14 4.44 1.74 6.85 1.74 7.1 0 12.94-5.84 12.94-12.94S23.14 2 16.04 2zm0 23.44c-2.19 0-4.33-.59-6.2-1.7l-.44-.26-4.7 1.35 1.26-4.58-.29-.47c-1.18-1.93-1.8-4.15-1.8-6.4 0-6.69 5.45-12.14 12.14-12.14S28.18 7.69 28.18 14.38 22.73 25.44 16.04 25.44zm6.68-9.1c-.36-.18-2.12-1.04-2.45-1.16-.33-.12-.57-.18-.8.18-.24.36-.92 1.16-1.12 1.4-.21.24-.41.27-.77.09-.36-.18-1.5-.55-2.86-1.75-1.06-.95-1.78-2.12-1.99-2.48-.21-.36-.02-.56.16-.74.16-.16.36-.41.54-.62.18-.21.24-.36.36-.6.12-.24.06-.45-.03-.63-.09-.18-.8-1.92-1.1-2.63-.29-.7-.59-.6-.8-.61h-.68c-.24 0-.63.09-.96.45-.33.36-1.26 1.23-1.26 3 0 1.77 1.29 3.48 1.47 3.72.18.24 2.54 3.88 6.16 5.44.86.37 1.53.59 2.06.75.86.27 1.64.23 2.25.14.69-.1 2.12-.87 2.42-1.71.3-.84.3-1.56.21-1.71-.09-.15-.33-.24-.69-.42z" />
                                                </svg>
                                            </a>
                                            {/* Call */}
                                            <a
                                                href={`tel:9871234565`}
                                                class="p-2 bg-blue-900 font-bold hover:bg-blue-800 text-white rounded-full"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                        d="M3 5a2 2 0 012-2h2.28a2 2 0 011.94 1.52l.72 3.11a2 2 0 01-.45 1.95l-1.27 1.27a16.06 16.06 0 006.59 6.59l1.27-1.27a2 2 0 011.95-.45l3.11.72A2 2 0 0121 16.72V19a2 2 0 01-2 2h-1C9.16 21 3 14.84 3 7V5z" />
                                                </svg>
                                            </a>
                                        </td>
                                    </tr>
                                );
                            }}
                        </Index>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default FollowUp;