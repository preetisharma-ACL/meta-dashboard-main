import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";

export default function AddProject() {
    const navigate = useNavigate();

    const [formData, setFormData] = createSignal({
        name: "",
        type: "",
        location: "",
        priority: "Standard",
        budget: "",
        leadsRequired: "",
        summary: "",
        file: null,
        logoFile: null,   //  NEW
        // Campaign managed fields (default 0)
        budget: 0,
        leadsgenerated: 0,
        activeCampaigns: 0,
        pausedCampaigns: 0,
        cpl: 0,
    });

    const handleChange = (e) => {
        const { name, value, files } = e.target;

        if (name === "file") {
            setFormData({ ...formData(), file: files[0] });
        }
        else if (name === "logoFile") {
            setFormData({ ...formData(), logoFile: files[0] });
        }
        else {
            setFormData({ ...formData(), [name]: value });
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        const logoReader = new FileReader();
        const pdfReader = new FileReader();

        let logoBase64 = null;
        let pdfBase64 = null;

        const saveIfReady = () => {
            saveProject(logoBase64, pdfBase64);
        };

        if (formData().logoFile) {
            logoReader.readAsDataURL(formData().logoFile);
            logoReader.onload = () => {
                logoBase64 = logoReader.result;
                if (!formData().file) saveIfReady();
            };
        }

        if (formData().file) {
            pdfReader.readAsDataURL(formData().file);
            pdfReader.onload = () => {
                pdfBase64 = pdfReader.result;
                if (!formData().logoFile) saveIfReady();
            };
        }

        if (!formData().logoFile && !formData().file) {
            saveIfReady();
        }

        if (formData().logoFile && formData().file) {
            pdfReader.onload = () => {
                pdfBase64 = pdfReader.result;
                saveProject(logoBase64, pdfBase64);
            };
        }
    };

    const saveProject = (logoData, fileData) => {
        const newProject = {
            ...formData(),
            id: Date.now(),
            logo: logoData, //  save logo base64
            status: "active",
            clientRequest: null,
            projectControl: "Live",
            url: "/all-campaigns",
            uploaddocument: fileData,
            fileName: formData().file?.name || null
        };

        const existing = JSON.parse(localStorage.getItem("projects")) || [];

        localStorage.setItem(
            "projects",
            JSON.stringify([newProject, ...existing])
        );

        navigate(`/`);
    };
    return (
        <section class="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-6 transition-colors duration-300">
            {/* Page Header */}
            <div class=" mx-auto mb-2 mt-2">
                <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                    Create New Project
                </h2>
                <p class="text-sm text-gray-500 mt-1 dark:text-gray-400">
                    Configure project details for campaign activation
                </p>
            </div>
            <nav>
                <ul class="flex items-center gap-1.5 mb-6 list-none p-0">
                    <li class="flex items-center gap-1 group cursor-pointer">
                        <svg class="w-4 h-4 text-gray-500 text-gray-400 transition-colors group-hover:text-purple-600"
                            fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001 1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>

                        <a href="/"
                            class="text-sm text-gray-500 dark:text-gray-400 transition-colors group-hover:text-purple-600">
                            Home
                        </a>
                    </li>
                    <li class="flex items-center">
                        <svg class="w-3 h-3 text-gray-600 dark:text-gray-500" viewBox="0 0 12 12" fill="none">
                            <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2"
                                stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                    </li>
                    <li>
                        <span class="text-sm text-gray-500 dark:text-gray-400 font-medium">Add New Project</span>
                    </li>
                </ul>
            </nav>

            <div class=" grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* LEFT SECTION */}
                <div class="lg:col-span-2 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8">
                    <form onSubmit={handleSubmit} class="space-y-8">
                        {/* Logo Upload */}
                        <div>
                            <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                                Upload Project Logo
                            </h3>

                            <div class="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-6 text-center bg-gray-50 dark:bg-gray-800 hover:border-green-500 transition">
                                <p class="text-sm text-gray-500 dark:text-gray-400">
                                    Upload Logo (PNG / JPG)
                                </p>

                                <input
                                    type="file"
                                    name="logoFile"
                                    accept="image/*"
                                    class="mt-3 text-sm"
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        {/* Basic Info Section */}
                        <div>
                            <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                                Basic Information
                            </h3>
                            <div class="grid md:grid-cols-2 gap-6">
                                <input
                                    type="text"
                                    name="name"
                                    placeholder="Project Name"
                                    class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition"
                                    required
                                    onInput={handleChange}
                                />
                                <select
                                    name="type"
                                    class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition"
                                    required
                                    onChange={handleChange}
                                >
                                    <option value="">Project Type</option>
                                    <option value="Residential">Residential</option>
                                    <option value="Commercial">Commercial</option>
                                </select>

                                <input
                                    type="text"
                                    name="location"
                                    placeholder="Location"
                                    class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition"
                                    onInput={handleChange}
                                />
                                <select
                                    name="priority"
                                    class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition"
                                    onChange={handleChange}
                                >
                                    <option value="Standard">Standard Priority</option>
                                    <option value="High">High Priority</option>
                                    <option value="Urgent">Urgent</option>
                                </select>
                            </div>
                        </div>

                        {/* Budget & Leads */}
                        <div>
                            <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                                Budget & Lead Planning
                            </h3>
                            <div class="grid md:grid-cols-2 gap-6">
                                {/* <input
                                    type="number"
                                    name="budget"
                                    placeholder="Total Budget"
                                    class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition"
                                    onInput={handleChange}
                                /> */}
                                <input
                                    type="number"
                                    name="leadsRequired"
                                    placeholder="Leads Required"
                                    class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition"
                                    onInput={handleChange}
                                />
                            </div>
                            <textarea
                                name="summary"
                                placeholder="Project Summary (Pricing, Typology, Highlights)"
                                rows="4"
                                class="mt-6 w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition"
                                onInput={handleChange}
                            />
                        </div>
                        {/* File Upload */}
                        <div>
                            <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                                Upload Documents
                            </h3>
                            <div class="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-6 text-center bg-gray-50 dark:bg-gray-800 hover:border-green-500 transition">
                                <p class="text-sm text-gray-500 dark:text-gray-400">
                                    Upload Project Brochure / Pricing PDF
                                </p>
                                <input
                                    type="file"
                                    name="file"
                                    accept=".pdf"
                                    class="mt-3 text-sm"
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        {/* Submit */}
                        <div class="pt-4">
                            <button
                                type="submit"
                                class="bg-blue-900 hover:bg-blue-800 text-white px-6 py-3 rounded-xl font-medium shadow-md transition"
                            >
                                Create Project
                            </button>
                        </div>
                    </form>
                </div>

                {/* RIGHT SECTION – Campaign Metrics */}
                <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8">
                    <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-6">
                        Campaign Metrics
                    </h3>
                    <div class="space-y-4">
                        <div class="flex justify-between bg-gray-100 dark:bg-gray-800 p-4 rounded-xl">
                            <span>Total Leads</span>
                            <span class="font-semibold">0</span>
                        </div>
                        <div class="flex justify-between bg-gray-100 dark:bg-gray-800 p-4 rounded-xl">
                            <span>Budget</span>
                            <span class="font-semibold">0</span>
                        </div>

                        <div class="flex justify-between bg-gray-100 dark:bg-gray-800 p-4 rounded-xl">
                            <span>Active Campaigns</span>
                            <span class="font-semibold">0</span>
                        </div>

                        <div class="flex justify-between bg-gray-100 dark:bg-gray-800 p-4 rounded-xl">
                            <span>Paused Campaigns</span>
                            <span class="font-semibold">0</span>
                        </div>

                        <div class="flex justify-between bg-gray-100 dark:bg-gray-800 p-4 rounded-xl">
                            <span>CPL</span>
                            <span class="font-semibold">0</span>
                        </div>
                    </div>
                    <p class="text-xs text-gray-400 mt-6">
                        These values will be managed by the campaign team.
                    </p>
                </div>
            </div>
        </section>
    );
}