import { useParams } from "@solidjs/router";
import LeadsChart from "../components/LeadsCharts";
import { Folder, Target, CalendarDays, CalendarClock, Activity } from "lucide-solid";
import { Eye, Users, IndianRupee, TrendingDown, TrendingUp } from "lucide-solid";
import { User, MapPin, Crosshair } from "lucide-solid";
import { createSignal, onMount } from "solid-js";
import { fetchCampaignDetails } from "../services/campaignDetails-service";

export default function CampaignDetails() {
    const params = useParams();
    const [campaign, setCampaign] = createSignal(null);
    // const campaign = {
    //     name: "Summer Sale Campaign",
    //     objective: "Conversions",
    //     startDate: "2026-02-01",
    //     stopDate: "2026-02-28",
    //     status: "Active",

    //     impressions: "120,450",
    //     reach: "95,300",
    //     spend: "₹45,200",
    //     costPerResult: "₹120",
    //     roas: "3.8x",

    //     age: "18 - 35",
    //     gender: "Male & Female",
    //     region: "Delhi, Mumbai, Bangalore",
    //     targeting: "Shopping & Fashion Interests"
    // };
    onMount(async () => {
        try {
            const res = await fetchCampaignDetails(params.id);
            setCampaign(res.data); //  IMPORTANT
        } catch (err) {
            console.log(err);
        }
    });

    return (
        <div class="p-6  bg-gray-50 dark:bg-gray-900 min-h-screen">

            {/* Header */}

            <div class=" flex flex-col  gap-4">
                <div>
                    <h1 class="md:text-2xl text-xl font-semibold text-gray-800 dark:text-white">
                        Campaign Details : {campaign()?.name}
                    </h1>
                    {/* <p class="text-sm text-gray-500 dark:text-gray-400">
                        Campaign ID: {params.id}
                    </p> */}
                </div>

                <span class="px-4 py-1 text-sm rounded-full w-20 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                   {campaign()?.status_label}
                </span>
            </div>
            <nav>
                <ul class="flex items-center gap-1.5 mb-6 mt-2 list-none p-0">
                    <li class="flex items-center gap-1 group cursor-pointer">
                        <svg class="w-4 h-4 text-gray-500 dark:text-gray-400 transition-colors group-hover:text-purple-600"
                            fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001 1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>

                        <a href="/"
                            class="text-sm text-gray-600 dark:text-gray-400 transition-colors group-hover:text-purple-600">
                            Home
                        </a>
                    </li>
                    <li class="flex items-center">
                        <svg class="w-3 h-3 text-gray-600 dark:text-gray-400" viewBox="0 0 12 12" fill="none">
                            <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2"
                                stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                    </li>
                    <li class="flex items-center gap-1 group cursor-pointer">

                        <a href="/all-campaigns"
                            class="text-sm text-gray-600 dark:text-gray-400 transition-colors group-hover:text-purple-600">
                            All Active Campaigns
                        </a>
                    </li>
                    <li class="flex items-center">
                        <svg class="w-3 h-3 text-gray-600 dark:text-gray-400" viewBox="0 0 12 12" fill="none">
                            <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2"
                                stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                    </li>
                    <li>
                        <span class="text-sm text-gray-500 dark:text-gray-400 font-medium">{params.id}</span>
                    </li>
                </ul>
            </nav>

            {/* Campaign Overview */}
            <div class="grid md:grid-cols-4 gap-6 mb-10">
                <div class="bg-blue-50 dark:bg-gray-800 px-5 py-9 rounded-xl shadow hover:shadow-lg  border border-blue-200 dark:border-gray-600">
                    <div class="flex items-center justify-between gap-2">
                        <div>
                            <p class="text-lg text-blue-800 dark:text-gray-400">Impressions</p>
                            <h3 class="text-xl font-semibold mt-2 dark:text-white">
                                {campaign()?.impressions}
                            </h3>
                        </div>
                        <div class="flex bg-blue-100 dark:bg-blue-500 p-3 rounded items-center gap-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
                            <Eye size={20} class=" font-bold text-blue-500 dark:text-blue-100" />
                        </div>
                    </div>
                </div>
                <div class="bg-red-50 dark:bg-gray-800 px-5 py-9 rounded-xl shadow hover:shadow-lg rounded  border border-red-200 dark:border-gray-600">
                    <div class="flex items-center justify-between gap-2">
                        <div>
                            <p class="text-lg text-red-800 dark:text-gray-400">Reach</p>
                            <h3 class="text-xl font-semibold mt-2 dark:text-white">
                               {campaign()?.reach}
                            </h3>
                        </div>
                        <div class="flex bg-red-100 dark:bg-purple-500 p-3 rounded items-center gap-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
                            <Users size={20} class="font-bold text-red-500 dark:text-purple-100" />
                        </div>
                    </div>
                </div>
                <div class="bg-green-50 dark:bg-gray-800 px-5 py-9 rounded-xl shadow hover:shadow-lg rounded  border border-green-200 dark:border-gray-600">
                    <div class="flex items-center justify-between gap-2">
                        <div>
                            <p class="text-lg text-green-800 dark:text-gray-400">Spend</p>
                            <h3 class="text-xl font-semibold mt-2 dark:text-white">
                               ₹{campaign()?.spend}
                            </h3>
                        </div>
                        <div class="flex bg-green-100 dark:bg-green-500 p-3 rounded items-center gap-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
                            <IndianRupee size={20} class="font-bold text-green-500 dark:text-green-100" />
                        </div>
                    </div>
                </div>
                <div class="bg-purple-50 dark:bg-gray-800 px-5 py-9 rounded-xl shadow hover:shadow-lg rounded  border border-purple-200 dark:border-gray-600">
                    <div class="flex items-center justify-between gap-2">
                        <div>
                            <p class="text-lg text-purple-800 dark:text-gray-400">ROAS</p>
                            <h3 class="text-xl font-semibold mt-2 dark:text-white">
                               {campaign()?.roas || "N/A"}
                            </h3>
                        </div>
                        <div class="flex bg-purple-100 dark:bg-purple-500 p-3 rounded items-center gap-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
                            <TrendingUp size={20} class="font-bold text-purple-500 dark:text-purple-100" />
                        </div>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

                {/* Campaign Basics */}
                <div class="bg-white dark:bg-gray-900 rounded-xl  border border-gray-200 dark:border-gray-700">
                    <div class="p-5 border-b border-gray-200 dark:border-gray-700">
                        <h2 class="font-semibold text-gray-800 dark:text-white">
                            Campaign Basics
                        </h2>
                    </div>
                    <table class="w-full text-sm">
                        <tbody>

                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <Folder size={16} />
                                    Campaign Name
                                </td>
                                <td class="p-4 md:font-medium text-sm dark:text-white">{campaign()?.name}</td>
                            </tr>

                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <Target size={16} />
                                    Objective
                                </td>
                                <td class="p-4 font-medium dark:text-white">{campaign()?.objective_label}</td>
                            </tr> 

                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <CalendarDays size={16} />
                                    Start Date
                                </td>
                                <td class="p-4 font-medium dark:text-white">{campaign()?.start_date}</td>
                            </tr>

                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <CalendarClock size={16} />
                                    Stop Date
                                </td>
                                <td class="p-4 font-medium dark:text-white">{campaign()?.stop_date}</td>
                            </tr>

                            <tr>
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <Activity size={16} />
                                    Status
                                </td>
                                <td class="p-4 font-medium dark:text-white">
                                    <span class="px-4 py-1 text-sm rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                                        {campaign()?.status_label}
                                    </span>
                                </td>
                            </tr>

                        </tbody>
                    </table>
                </div>

                {/* Performance Metrics */}
                <div class="bg-white dark:bg-gray-900 rounded-xl  border border-gray-200 dark:border-gray-700">

                    <div class="p-5 border-b border-gray-200 dark:border-gray-700">
                        <h2 class="font-semibold text-gray-800 dark:text-white">
                            Performance Metrics
                        </h2>
                    </div>

                    <table class="w-full text-sm">
                        <tbody>

                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <Eye size={16} class="text-gray-400 dark:text-gray-300" />
                                    Impressions
                                </td>
                                <td class="p-4 font-medium dark:text-white">{campaign()?.impressions}</td>
                            </tr>

                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <Users size={16} class="text-gray-400 dark:text-gray-300" />
                                    Reach
                                </td>
                                <td class="p-4 font-medium dark:text-white">{campaign()?.reach}</td>
                            </tr>

                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <IndianRupee size={16} class="text-green-500" />
                                    Spend
                                </td>
                                <td class="p-4 font-medium dark:text-white">₹{campaign()?.spend}</td>
                            </tr>

                            <tr class="border-b dark:border-gray-700">
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <TrendingDown size={16} class="text-yellow-500" />
                                    Cost Per Result
                                </td>
                                <td class="p-4 font-medium dark:text-white">{campaign()?.cpl || "N/A"}</td>
                            </tr>

                            <tr>
                                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <TrendingUp size={16} class="text-green-500" />
                                    ROAS
                                </td>
                                <td class="p-4 font-medium dark:text-white">{campaign()?.roas || "N/A"}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-1  mb-8">
                <LeadsChart />
            </div>


            {/* Audience & Targeting */}
            <div class="bg-white dark:bg-gray-900 rounded-xl  border border-gray-200 dark:border-gray-700">
                <div class="p-5 border-b border-gray-200 dark:border-gray-700">
                    <h2 class="font-semibold text-gray-800 dark:text-white">
                        Audience & Targeting
                    </h2>
                </div>

                <table class="w-full text-sm">
                    <tbody>
                        <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                            <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                <Users size={16} class="text-gray-400 dark:text-gray-300" />
                                Age Group
                            </td>
                            <td class="p-4 font-medium dark:text-white">{campaign()?.age}</td>
                        </tr>
                        <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                            <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                <User size={16} class="text-gray-400 dark:text-gray-300" />
                                Gender
                            </td>
                            <td class="p-4 font-medium dark:text-white">{campaign()?.gender}</td>
                        </tr>
                        <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                            <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                <MapPin size={16} class="text-red-500" />
                                Region
                            </td>
                            <td class="p-4 font-medium dark:text-white">{campaign()?.region}</td>
                        </tr>
                        <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                            <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                <Crosshair size={16} class="text-blue-500" />
                                Targeting
                            </td>
                            <td class="p-4 font-medium dark:text-white">{campaign()?.targeting}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
}