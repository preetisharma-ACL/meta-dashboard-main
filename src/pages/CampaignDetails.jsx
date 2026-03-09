import { useParams } from "@solidjs/router";

export default function CampaignDetails() {
    const params = useParams();

    const campaign = {
        name: "Summer Sale Campaign",
        objective: "Conversions",
        startDate: "2026-02-01",
        stopDate: "2026-02-28",
        status: "Active",

        impressions: "120,450",
        reach: "95,300",
        spend: "₹45,200",
        costPerResult: "₹120",
        roas: "3.8x",

        age: "18 - 35",
        gender: "Male & Female",
        region: "Delhi, Mumbai, Bangalore",
        targeting: "Shopping & Fashion Interests"
    };

    return (
        <div class="p-6 bg-gray-50 dark:bg-gray-900 min-h-screen">

            {/* Header */}
            <div class="mb-8 flex items-center gap-4">
                <div>
                    <h1 class="text-2xl font-semibold text-gray-800 dark:text-white">
                        Campaign Details : {params.id}
                    </h1>
                    {/* <p class="text-sm text-gray-500 dark:text-gray-400">
                        Campaign ID: {params.id}
                    </p> */}
                </div>

                <span class="px-4 py-1 text-sm rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                    {campaign.status}
                </span>
            </div>

            {/* Campaign Overview */}
            <div class="grid md:grid-cols-4 gap-6 mb-10">
                <div class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600">
                    <p class="text-md text-gray-400">Impressions</p>
                    <h3 class="text-xl font-semibold mt-1 dark:text-white">
                        {campaign.impressions}
                    </h3>
                </div>
                <div class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600">
                    <p class="text-md text-gray-400">Reach</p>
                    <h3 class="text-xl font-semibold mt-1 dark:text-white">
                        {campaign.reach}
                    </h3>
                </div>
                <div class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600">
                    <p class="text-md text-gray-400">Spend</p>
                    <h3 class="text-xl font-semibold mt-1 dark:text-white">
                        {campaign.spend}
                    </h3>
                </div>
                <div class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600">
                    <p class="text-md text-gray-400">ROAS</p>
                    <h3 class="text-xl font-semibold mt-1 dark:text-white">
                        {campaign.roas}
                    </h3>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

                {/* Campaign Basics */}
                <div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <div class="p-5 border-b border-gray-200 dark:border-gray-700">
                        <h2 class="font-semibold text-gray-800 dark:text-white">
                            Campaign Basics
                        </h2>
                    </div>
                    <table class="w-full text-sm">
                        <tbody>
                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400">Campaign Name</td>
                                <td class="p-4 font-medium dark:text-white">{campaign.name}</td>
                            </tr>
                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400">Objective</td>
                                <td class="p-4 font-medium dark:text-white">{campaign.objective}</td>
                            </tr>
                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400">Start Date</td>
                                <td class="p-4 font-medium dark:text-white">{campaign.startDate}</td>
                            </tr>
                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400">Stop Date</td>
                                <td class="p-4 font-medium dark:text-white">{campaign.stopDate}</td>
                            </tr>
                            <tr>
                                <td class="p-4 text-gray-500 dark:text-gray-400">Status</td>
                                <td class="p-4 font-medium dark:text-white">
                                    <span class="px-4 py-1 text-sm rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                                        {campaign.status}
                                    </span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>


                {/* Performance Metrics */}
                <div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">

                    <div class="p-5 border-b border-gray-200 dark:border-gray-700">
                        <h2 class="font-semibold text-gray-800 dark:text-white">
                            Performance Metrics
                        </h2>
                    </div>

                    <table class="w-full text-sm">
                        <tbody>
                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400">Impressions</td>
                                <td class="p-4 font-medium dark:text-white">{campaign.impressions}</td>
                            </tr>
                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400">Reach</td>
                                <td class="p-4 font-medium dark:text-white">{campaign.reach}</td>
                            </tr>
                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400">Spend</td>
                                <td class="p-4 font-medium dark:text-white">{campaign.spend}</td>
                            </tr>
                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400">Cost Per Result</td>
                                <td class="p-4 font-medium dark:text-white">{campaign.costPerResult}</td>
                            </tr>
                            <tr>
                                <td class="p-4 text-gray-500 dark:text-gray-400">ROAS</td>
                                <td class="p-4 font-medium dark:text-white">{campaign.roas}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Audience & Targeting */}
            <div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <div class="p-5 border-b border-gray-200 dark:border-gray-700">
                    <h2 class="font-semibold text-gray-800 dark:text-white">
                        Audience & Targeting
                    </h2>
                </div>

                <table class="w-full text-sm">
                    <tbody>
                        <tr class="border-b dark:border-gray-800">
                            <td class="p-4 text-gray-500 dark:text-gray-400">Age Group</td>
                            <td class="p-4 font-medium dark:text-white">{campaign.age}</td>
                        </tr>
                        <tr class="border-b dark:border-gray-800">
                            <td class="p-4 text-gray-500 dark:text-gray-400">Gender</td>
                            <td class="p-4 font-medium dark:text-white">{campaign.gender}</td>
                        </tr>
                        <tr class="border-b dark:border-gray-800">
                            <td class="p-4 text-gray-500 dark:text-gray-400">Region</td>
                            <td class="p-4 font-medium dark:text-white">{campaign.region}</td>
                        </tr>
                        <tr>
                            <td class="p-4 text-gray-500 dark:text-gray-400">Targeting</td>
                            <td class="p-4 font-medium dark:text-white">{campaign.targeting}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
}