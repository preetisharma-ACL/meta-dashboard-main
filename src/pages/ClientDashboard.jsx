import { For, Show, createMemo, createSignal } from "solid-js";
import Swal from "sweetalert2";
import godrejlogo from "../assets/project-logo/dlf.png";
import birlalogo from "../assets/project-logo/godrej.png";
import prestigelogo from "../assets/project-logo/prestige.png";
import { A, } from "@solidjs/router";
export default function ClientDashboard() {
    const [viewType, setViewType] = createSignal("table"); // "grid" | "table"
    const [projects, setProjects] = createSignal([
        {
            id: 1,
            name: "Birla Trimaya",
            logo: birlalogo,
            location: "Bangalore",
            budget: 100000,
            leadsgenerated: 10,
            type: "Residential",
            activeCampaigns: 3,
            pausedCampaigns: 1,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 2,
            name: "Prestige Lakeside",
            logo: prestigelogo,
            location: "Bangalore",
            budget: 95000,
            leadsgenerated: 10,
            type: "Residential",
            activeCampaigns: 2,
            pausedCampaigns: 2,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 3,
            name: "Sobha Dream Acres",
            logo: birlalogo,
            location: "Bangalore",
            budget: 85000,
            leadsgenerated: 10,
            type: "Residential",
            activeCampaigns: 1,
            pausedCampaigns: 2,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 4,
            name: "Godrej Properties",
            logo: godrejlogo,
            location: "Bangalore",
            budget: 98000,
            leadsgenerated: 10,
            type: "Residential",
            activeCampaigns: 1,
            pausedCampaigns: 1,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 5,
            name: "DLF Luxury Homes",
            logo: prestigelogo,
            location: "Bangalore",
            budget: 90000,
            leadsgenerated: 10,
            type: "Residential",
            activeCampaigns: 1,
            pausedCampaigns: 2,
            status: "paused",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
        {
            id: 6,
            name: "Brigade Orchards",
            logo: birlalogo,
            location: "Bangalore",
            budget: 92000,
            leadsgenerated: 10,
            type: "Residential",
            activeCampaigns: 1,
            pausedCampaigns: 2,
            status: "active",
            clientRequest: null,
            priority: "Standard", // NEW
            projectControl: "Live", // NEW
            url: "/all-campaigns",
            cpl: 200
        },
    ]);

    const handlePriorityChange = (id, value) => {
        setProjects(prev =>
            prev.map(p =>
                p.id === id ? { ...p, priority: value } : p
            )
        );
    };

    const handleClientControlRequest = (id, value) => {
        Swal.fire({
            title: "Are you sure?",
            text: `You want to ${value} this project.`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#16a34a",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes, Send Request"
        }).then((result) => {
            if (result.isConfirmed) {
                Swal.fire(
                    "Request Sent!",
                    "Campaign team will review it.",
                    "success"
                );
            }
        });
    };
    return (
        <section class="w-full px-4 sm:px-6 lg:px-8 py-6">

            {/* Section Header */}
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
                <div>
                    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Active Projects
                    </h2>
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                        All projects with live marketing campaigns
                    </p>
                </div>

                <div class="flex items-center gap-2">
                    <button
                        onClick={() => setViewType("table")}
                        class={`p-2 rounded-lg border ${viewType() === "table"
                            ? "bg-green-600 text-white"
                            : "bg-white text-gray-600"
                            }`}
                        title="Table View"
                    >
                        {/* Table Icon */}
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <line x1="4" y1="6" x2="20" y2="6" />
                            <line x1="4" y1="12" x2="20" y2="12" />
                            <line x1="4" y1="18" x2="20" y2="18" />
                        </svg>
                    </button>
                    <button
                        onClick={() => setViewType("grid")}
                        class={`p-2 rounded-lg border ${viewType() === "grid"
                            ? "bg-green-600 text-white"
                            : "bg-white text-gray-600"
                            }`}
                        title="Grid View"
                    >
                        {/* Grid Icon */}
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="7" height="7" rx="1" />
                            <rect x="14" y="3" width="7" height="7" rx="1" />
                            <rect x="3" y="14" width="7" height="7" rx="1" />
                            <rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                    </button>
                </div>

                {/* <div class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {activeProjects().length} Active
                </div> */}
            </div>


            <Show
                when={viewType() === "grid"}
                fallback={
                    /* TABLE VIEW */
                    <div class="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border">
                        <table class="w-full text-sm table-auto">
                            <thead class="bg-gray-100 dark:bg-gray-800">
                                <tr class="[&_th]:text-center  [&_th]:whitespace-nowrap [&_th:first-child]:text-left">
                                    <th class="p-3">Project</th>
                                    <th class="p-3">Location</th>
                                    <th class="p-3">Type</th>
                                    <th class="p-3">Status</th>
                                    <th class="p-3">Customer Priority</th>
                                    <th class="p-3">Project Control</th>
                                    <th class="p-3">Budget</th>
                                    <th class="p-3">CPL</th>
                                    <th class="p-3">Leads Generated</th>
                                    <th class="p-3">Active Campaigns</th>
                                    <th class="p-3">Paused Campaigns</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={projects()}>
                                    {(project) => (
                                        <tr class="[&_td]:text-center [&_td]:px-6 [&_td:first-child]:px-2 [&_td]:whitespace-nowrap [&_td:first-child]:text-left border-t hover:bg-gray-50 dark:hover:bg-gray-800">
                                            <td class="p-2 flex items-center gap-2">
                                                <div class="rounded bg-gray-100 dark:bg-gray-300 p-1 px-2 min-w-max">
                                                    <img src={project.logo} class="w-10 h-10  " />
                                                </div>
                                                <A href={project.url} class="text-blue-600 dark:text-blue-400">
                                                    {project.name}
                                                </A>
                                            </td>
                                            <td class="p-2">{project.location}</td>
                                            <td class="p-2">{project.type}</td>
                                            <td class="px-4 py-3">
                                                <span class="px-2 py-1 text-sm rounded-full capitalize"
                                                    classList={{
                                                        "bg-green-100 text-green-700": project.status === "active",
                                                        "bg-yellow-100 text-yellow-700": project.status === "paused",
                                                        "bg-red-100 text-red-700": project.status === "stopped",
                                                    }}>
                                                    {project.status}
                                                </span>
                                            </td>
                                            {/* Priority Column */}
                                            <td class="p-2">
                                                <select
                                                    class="border rounded px-2 py-1 text-sm bg-gray-100 dark:bg-gray-800 min-w-max"
                                                    value={project.priority}
                                                    onChange={(e) =>
                                                        handlePriorityChange(project.id, e.target.value)
                                                    }
                                                >
                                                    <option value="Urgent">Urgent</option>
                                                    <option value="High">High Priority</option>
                                                    <option value="Standard">Standard</option>
                                                </select>
                                            </td>

                                            {/* Project Status Dropdown */}
                                            <td class="p-2">
                                                <select
                                                    class="border rounded px-2 py-1 text-sm bg-gray-100 dark:bg-gray-800 min-w-max"
                                                    value={
                                                        project.status === "active"
                                                            ? "Live"
                                                            : project.status === "paused"
                                                                ? "Temporary Pause"
                                                                : "Stopped"
                                                    }
                                                    onChange={(e) =>
                                                        handleClientControlRequest(project.id, e.target.value)
                                                    }
                                                >
                                                    <option value="Live">Live</option>
                                                    <option value="Temporary Pause">Temporary Pause</option>
                                                    <option value="Stopped">Stopped</option>
                                                </select>
                                            </td>
                                            <td class="p-2">
                                                ₹ {project.budget.toLocaleString("en-IN")}
                                            </td>
                                            <td class="p-2">{project.cpl}</td>
                                            <td class="p-2">{project.leadsgenerated}</td>
                                            <td class="p-2 text-center">
                                                {project.activeCampaigns}
                                            </td>
                                            <td class="p-2 text-center">
                                                {project.pausedCampaigns}
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                }
            >
                {/* GRID VIEW (Your Existing Cards – unchanged) */}
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    <For each={projects()}>
                        {(project) => (
                            <For each={projects()}>
                                {(project) => (
                                    <div
                                        class="
                                group rounded-xl border border-gray-200 dark:border-gray-700
                                bg-white dark:bg-gray-900
                                p-4 transition-all duration-300 shadow-md
                                hover:shadow-lg hover:-translate-y-1
                                "
                                    >

                                        {/* Header */}
                                        <div class="flex items-start justify-between">
                                            <div class="flex items-center gap-3">

                                                {/* Project Logo */}

                                                <div
                                                    class="
                                            h-12 w-12 rounded-lg
                                            flex items-center justify-center
                                            bg-gray-100 
                                            shadow-sm
                                        "
                                                >
                                                    <img
                                                        src={project.logo}
                                                        alt={project.name}
                                                        class=" object-cover"
                                                    />
                                                </div>

                                                {/* Title */}
                                                <div>
                                                    <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100">
                                                        {project.name}
                                                    </h3>
                                                    <p class="text-sm text-gray-500 dark:text-gray-400">
                                                        Property Type · {project.type}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Status */}
                                            <span class="flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400">
                                                <span class="h-2 w-2 rounded-full bg-green-500"></span>
                                                Active
                                            </span>
                                        </div>

                                        {/* Location */}
                                        <div class="flex justify-between">
                                            <p class="mt-3 text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1">
                                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                                </svg>
                                                {project.location}
                                            </p>
                                            <p class="mt-3 text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1">

                                                ₹ {project.budget.toLocaleString("en-IN")}
                                            </p>
                                        </div>

                                        {/* Divider */}
                                        <div class="my-4 border-t border-gray-200 dark:border-gray-700"></div>

                                        {/* Campaign Stats */}
                                        <div class="grid grid-cols-2 gap-4 text-sm ">
                                            <div class="bg-green-50 dark:bg-gray-800 rounded-lg p-3">
                                                <p class="text-sm text-green-700 dark:text-green-500">
                                                    Active Campaigns
                                                </p>
                                                <p class="text-lg font-bold text-gray-900 dark:text-white">
                                                    {project.activeCampaigns}
                                                </p>
                                            </div>

                                            <div class="bg-red-50 dark:bg-gray-800 rounded-lg p-3">
                                                <p class="text-sm text-red-500">
                                                    Paused Campaigns
                                                </p>
                                                <p class="text-lg font-bold text-gray-900 dark:text-white">
                                                    {project.pausedCampaigns}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Footer CTA */}

                                        {/* Footer CTA */}
                                        <A
                                            href={project.url}
                                            class="
                                        mt-4 w-full
                                        text-primary-600 dark:text-primary-400
                                        hover:text-primary-700 dark:hover:text-primary-300
                                        font-medium text-sm
                                        flex items-center justify-center gap-1
                                    "
                                        >
                                            View Details
                                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M9 5l7 7-7 7"
                                                />
                                            </svg>
                                        </A>
                                    </div>
                                )}
                            </For>
                        )}
                    </For>
                </div>
            </Show>

            {/* Empty State */}
            <Show when={projects().length === 0}>
                <div class="mt-8 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center">
                    <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                        No active projects found
                    </p>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Your live projects will appear here once campaigns are started
                    </p>
                </div>
            </Show>
        </section>
    );
}

