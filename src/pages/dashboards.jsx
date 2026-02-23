import { createSignal, For, Show } from 'solid-js';

export default function ClientDashboard() {
    const [searchTerm, setSearchTerm] = createSignal('');
    const [filterStatus, setFilterStatus] = createSignal('all');
    const [viewMode, setViewMode] = createSignal('grid'); // 'grid' or 'list'

    // Mock data - replace with real data from API
    const [projects] = createSignal([
        {
            id: 1,
            name: 'Birla Trimaya',
            location: 'Bangalore, Karnataka',
            type: 'Residential',
            status: 'active',
            activeCampaigns: 5,
            totalCampaigns: 8,
            budget: '₹45,00,000',
            startDate: '2024-01-15',
            image: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=400&h=300&fit=crop',
            progress: 65,
            leads: 234,
            conversions: 45,
            lastUpdated: '2 hours ago',
            color: 'purple',
        },
        {
            id: 2,
            name: 'Prestige City',
            location: 'Mumbai, Maharashtra',
            type: 'Commercial',
            status: 'active',
            activeCampaigns: 3,
            totalCampaigns: 5,
            budget: '₹32,00,000',
            startDate: '2024-02-01',
            image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400&h=300&fit=crop',
            progress: 45,
            leads: 156,
            conversions: 28,
            lastUpdated: '5 hours ago',
            color: 'blue',
        },
        {
            id: 3,
            name: 'Godrej Properties',
            location: 'Pune, Maharashtra',
            type: 'Residential',
            status: 'active',
            activeCampaigns: 4,
            totalCampaigns: 6,
            budget: '₹28,50,000',
            startDate: '2024-01-20',
            image: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400&h=300&fit=crop',
            progress: 78,
            leads: 312,
            conversions: 67,
            lastUpdated: '1 day ago',
            color: 'green',
        },
        {
            id: 4,
            name: 'DLF Luxury Homes',
            location: 'Delhi NCR',
            type: 'Luxury Residential',
            status: 'planning',
            activeCampaigns: 0,
            totalCampaigns: 3,
            budget: '₹52,00,000',
            startDate: '2024-03-01',
            image: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=400&h=300&fit=crop',
            progress: 15,
            leads: 45,
            conversions: 8,
            lastUpdated: '3 days ago',
            color: 'amber',
        },
        {
            id: 5,
            name: 'Sobha Dream Acres',
            location: 'Bangalore, Karnataka',
            type: 'Residential',
            status: 'active',
            activeCampaigns: 6,
            totalCampaigns: 9,
            budget: '₹38,75,000',
            startDate: '2023-12-10',
            image: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=400&h=300&fit=crop',
            progress: 82,
            leads: 428,
            conversions: 89,
            lastUpdated: '30 minutes ago',
            color: 'indigo',
        },
        {
            id: 6,
            name: 'Brigade Orchards',
            location: 'Chennai, Tamil Nadu',
            type: 'Mixed Use',
            status: 'paused',
            activeCampaigns: 1,
            totalCampaigns: 4,
            budget: '₹25,00,000',
            startDate: '2024-01-05',
            image: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&h=300&fit=crop',
            progress: 38,
            leads: 98,
            conversions: 12,
            lastUpdated: '1 week ago',
            color: 'rose',
        },
    ]);

    const filteredProjects = () => {
        let filtered = projects();

        if (searchTerm()) {
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(searchTerm().toLowerCase()) ||
                p.location.toLowerCase().includes(searchTerm().toLowerCase())
            );
        }

        if (filterStatus() !== 'all') {
            filtered = filtered.filter(p => p.status === filterStatus());
        }

        return filtered;
    };

    const totalActiveProjects = () => projects().filter(p => p.status === 'active').length;
    const totalActiveCampaigns = () => projects().reduce((sum, p) => sum + p.activeCampaigns, 0);
    const totalLeads = () => projects().reduce((sum, p) => sum + p.leads, 0);
    const totalConversions = () => projects().reduce((sum, p) => sum + p.conversions, 0);

    const getStatusColor = (status) => {
        switch (status) {
            case 'active': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
            case 'paused': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400';
            case 'planning': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
            default: return 'bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-400';
        }
    };

    const getAccentColor = (color) => {
        const colors = {
            purple: 'from-purple-500 to-pink-500',
            blue: 'from-blue-500 to-cyan-500',
            green: 'from-green-500 to-emerald-500',
            amber: 'from-amber-500 to-orange-500',
            indigo: 'from-indigo-500 to-purple-500',
            rose: 'from-rose-500 to-pink-500',
        };
        return colors[color] || colors.purple;
    };

    return (
        <div class="p-6 space-y-6 max-w-[1600px] mx-auto">
            {/* Header Section */}
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
                        Client Dashboard
                    </h1>
                    <p class="text-gray-600 dark:text-gray-400 mt-1">
                        Manage and monitor all your active projects and campaigns
                    </p>
                </div>

                <div class="flex items-center gap-3">
                    <button class="btn-secondary flex items-center gap-2">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export Report
                    </button>
                    <button class="btn-primary flex items-center gap-2">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                        </svg>
                        New Project
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div class="stat-card group hover:scale-105 transition-transform duration-200">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">
                                Active Projects
                            </p>
                            <h3 class="text-4xl font-bold text-gray-900 dark:text-white mt-2">
                                {totalActiveProjects()}
                            </h3>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                Out of {projects().length} total
                            </p>
                        </div>
                        <div class="bg-purple-100 dark:bg-purple-900/30 p-3 rounded-xl">
                            <svg class="w-7 h-7 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                        </div>
                    </div>
                </div>

                <div class="stat-card group hover:scale-105 transition-transform duration-200">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">
                                Active Campaigns
                            </p>
                            <h3 class="text-4xl font-bold text-gray-900 dark:text-white mt-2">
                                {totalActiveCampaigns()}
                            </h3>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                Across all projects
                            </p>
                        </div>
                        <div class="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-xl">
                            <svg class="w-7 h-7 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                            </svg>
                        </div>
                    </div>
                </div>

                <div class="stat-card group hover:scale-105 transition-transform duration-200">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">
                                Total Leads
                            </p>
                            <h3 class="text-4xl font-bold text-gray-900 dark:text-white mt-2">
                                {totalLeads().toLocaleString()}
                            </h3>
                            <p class="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
                                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                </svg>
                                +12.5% this month
                            </p>
                        </div>
                        <div class="bg-green-100 dark:bg-green-900/30 p-3 rounded-xl">
                            <svg class="w-7 h-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                        </div>
                    </div>
                </div>

                <div class="stat-card group hover:scale-105 transition-transform duration-200">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">
                                Conversions
                            </p>
                            <h3 class="text-4xl font-bold text-gray-900 dark:text-white mt-2">
                                {totalConversions()}
                            </h3>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                {((totalConversions() / totalLeads()) * 100).toFixed(1)}% conversion rate
                            </p>
                        </div>
                        <div class="bg-amber-100 dark:bg-amber-900/30 p-3 rounded-xl">
                            <svg class="w-7 h-7 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters and Search */}
            <div class="card p-4">
                <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div class="flex flex-col sm:flex-row gap-3 flex-1">
                        {/* Search */}
                        <div class="relative flex-1 max-w-md">
                            <svg class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Search projects..."
                                value={searchTerm()}
                                onInput={(e) => setSearchTerm(e.target.value)}
                                class="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                        </div>

                        {/* Filter */}
                        <select
                            value={filterStatus()}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="all">All Status</option>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                            <option value="planning">Planning</option>
                        </select>
                    </div>

                    {/* View Mode Toggle */}
                    <div class="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                        <button
                            onClick={() => setViewMode('grid')}
                            class={`p-2 rounded-lg transition-colors ${viewMode() === 'grid'
                                    ? 'bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 shadow-sm'
                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                }`}
                        >
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                            </svg>
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            class={`p-2 rounded-lg transition-colors ${viewMode() === 'list'
                                    ? 'bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 shadow-sm'
                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                }`}
                        >
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* Projects Section */}
            <div>
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-xl font-bold text-gray-900 dark:text-white">
                        Projects ({filteredProjects().length})
                    </h2>
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                        Showing all active initiatives
                    </p>
                </div>

                {/* Grid View */}
                <Show when={viewMode() === 'grid'}>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <For each={filteredProjects()}>
                            {(project) => (
                                <div class="card overflow-hidden group hover:shadow-xl transition-all duration-300 cursor-pointer">
                                    {/* Project Image with Gradient Overlay */}
                                    <div class="relative h-48 overflow-hidden">
                                        <div class={`absolute inset-0 bg-gradient-to-br ${getAccentColor(project.color)} opacity-90`}></div>
                                        <img
                                            src={project.image}
                                            alt={project.name}
                                            class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                        />
                                        <div class="absolute top-3 right-3">
                                            <span class={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(project.status)}`}>
                                                {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                                            </span>
                                        </div>
                                        <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                                            <h3 class="text-xl font-bold text-white">{project.name}</h3>
                                            <p class="text-sm text-gray-200 flex items-center gap-1 mt-1">
                                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                                </svg>
                                                {project.location}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Project Details */}
                                    <div class="p-5 space-y-4">
                                        {/* Campaigns */}
                                        <div class="flex items-center justify-between">
                                            <div>
                                                <p class="text-sm text-gray-600 dark:text-gray-400">Active Campaigns</p>
                                                <p class="text-2xl font-bold text-gray-900 dark:text-white">
                                                    {project.activeCampaigns}
                                                    <span class="text-sm text-gray-500 dark:text-gray-400 font-normal">
                                                        /{project.totalCampaigns}
                                                    </span>
                                                </p>
                                            </div>
                                            <div class="text-right">
                                                <p class="text-sm text-gray-600 dark:text-gray-400">Budget</p>
                                                <p class="text-lg font-semibold text-gray-900 dark:text-white">
                                                    {project.budget}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Progress Bar */}
                                        <div>
                                            <div class="flex items-center justify-between text-sm mb-2">
                                                <span class="text-gray-600 dark:text-gray-400">Campaign Progress</span>
                                                <span class="font-semibold text-gray-900 dark:text-white">{project.progress}%</span>
                                            </div>
                                            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                                <div
                                                    class={`h-2 rounded-full bg-gradient-to-r ${getAccentColor(project.color)} transition-all duration-500`}
                                                    style={{ width: `${project.progress}%` }}
                                                ></div>
                                            </div>
                                        </div>

                                        {/* Metrics */}
                                        <div class="grid grid-cols-2 gap-3">
                                            <div class="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                                <p class="text-xs text-gray-600 dark:text-gray-400">Leads</p>
                                                <p class="text-lg font-bold text-gray-900 dark:text-white">{project.leads}</p>
                                            </div>
                                            <div class="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                                <p class="text-xs text-gray-600 dark:text-gray-400">Conversions</p>
                                                <p class="text-lg font-bold text-gray-900 dark:text-white">{project.conversions}</p>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div class="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
                                            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                Updated {project.lastUpdated}
                                            </div>
                                            <button class="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium text-sm flex items-center gap-1">
                                                View Details
                                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>

                {/* List View */}
                <Show when={viewMode() === 'list'}>
                    <div class="space-y-4">
                        <For each={filteredProjects()}>
                            {(project) => (
                                <div class="card p-6 hover:shadow-lg transition-all duration-300 cursor-pointer">
                                    <div class="flex flex-col lg:flex-row gap-6">
                                        {/* Image */}
                                        <div class="relative w-full lg:w-64 h-40 rounded-lg overflow-hidden flex-shrink-0">
                                            <div class={`absolute inset-0 bg-gradient-to-br ${getAccentColor(project.color)} opacity-90`}></div>
                                            <img
                                                src={project.image}
                                                alt={project.name}
                                                class="w-full h-full object-cover"
                                            />
                                            <div class="absolute top-3 right-3">
                                                <span class={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(project.status)}`}>
                                                    {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Details */}
                                        <div class="flex-1 space-y-4">
                                            <div>
                                                <div class="flex items-start justify-between">
                                                    <div>
                                                        <h3 class="text-2xl font-bold text-gray-900 dark:text-white">{project.name}</h3>
                                                        <p class="text-gray-600 dark:text-gray-400 flex items-center gap-2 mt-1">
                                                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            </svg>
                                                            {project.location}
                                                            <span class="mx-2">•</span>
                                                            <span class="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-sm">{project.type}</span>
                                                        </p>
                                                    </div>
                                                    <button class="btn-primary">View Details</button>
                                                </div>
                                            </div>

                                            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                <div>
                                                    <p class="text-sm text-gray-600 dark:text-gray-400">Active Campaigns</p>
                                                    <p class="text-xl font-bold text-gray-900 dark:text-white">
                                                        {project.activeCampaigns}/{project.totalCampaigns}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p class="text-sm text-gray-600 dark:text-gray-400">Budget</p>
                                                    <p class="text-xl font-bold text-gray-900 dark:text-white">{project.budget}</p>
                                                </div>
                                                <div>
                                                    <p class="text-sm text-gray-600 dark:text-gray-400">Leads</p>
                                                    <p class="text-xl font-bold text-gray-900 dark:text-white">{project.leads}</p>
                                                </div>
                                                <div>
                                                    <p class="text-sm text-gray-600 dark:text-gray-400">Conversions</p>
                                                    <p class="text-xl font-bold text-gray-900 dark:text-white">{project.conversions}</p>
                                                </div>
                                            </div>

                                            <div>
                                                <div class="flex items-center justify-between text-sm mb-2">
                                                    <span class="text-gray-600 dark:text-gray-400">Campaign Progress</span>
                                                    <span class="font-semibold text-gray-900 dark:text-white">{project.progress}%</span>
                                                </div>
                                                <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                                    <div
                                                        class={`h-2 rounded-full bg-gradient-to-r ${getAccentColor(project.color)} transition-all duration-500`}
                                                        style={{ width: `${project.progress}%` }}
                                                    ></div>
                                                </div>
                                            </div>

                                            <div class="flex items-center text-xs text-gray-500 dark:text-gray-400">
                                                <svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                Updated {project.lastUpdated}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>

                {/* Empty State */}
                <Show when={filteredProjects().length === 0}>
                    <div class="card p-12 text-center">
                        <div class="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg class="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">No projects found</h3>
                        <p class="text-gray-600 dark:text-gray-400 mb-6">
                            Try adjusting your search or filter criteria
                        </p>
                        <button
                            class="btn-primary"
                            onClick={() => {
                                setSearchTerm('');
                                setFilterStatus('all');
                            }}
                        >
                            Clear Filters
                        </button>
                    </div>
                </Show>
            </div>
        </div>
    );
}