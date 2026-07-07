import { useParams } from "@solidjs/router";
import LeadsChart from "../components/LeadsCharts";
import {
  Folder,
  Target,
  CalendarDays,
  CalendarClock,
  Activity,
  Wallet,
} from "lucide-solid";
import {
  Eye,
  Users,
  IndianRupee,
  TrendingDown,
  TrendingUp,
} from "lucide-solid";
import { User, MapPin, Crosshair } from "lucide-solid";
import { createSignal, createMemo, onMount, Show } from "solid-js";
import { fetchCampaignDetails } from "../services/campaignDetails-service";
import { fetchCampaignInsights } from "../services/campaigns"; // ← same service used in ProjectDetails
import {
  campaignDetailsCache,
  setCampaignDetailsCache,
  isCampaignCacheStale,
} from "../cacheStore/appStore";
import useRole from "../hooks/useRole";
import AIInsightButton from "../components/AIInsightButton";
import CampaignStatusControl from "../components/CampaignStatusControl";
import { DateRangeFilter } from "../components/DateRangeFilter";
export default function CampaignDetails() {
  const { userRole, isAdmin, isClient } = useRole();

  const params = useParams();
  const campaignId = params.id;

  // ── Read from global cache ───────────────────────────────────────────────
  const campaign = () => campaignDetailsCache[campaignId]?.data ?? null;
  const loading = () => campaignDetailsCache[campaignId]?.loading ?? false;

  // ── Insights (date-wise breakdown for the chart) ─────────────────────────
  const [insights, setInsights] = createSignal([]);

  // ── Date-range filter for the overview KPIs ──────────────────────────────
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");
  const isFiltered = () => Boolean(fromDate() && toDate());
  const resetRange = () => {
    setFromDate("");
    setToDate("");
  };

  // Aggregate KPIs come from campaign() by default; when a date range is set,
  // recompute leads / impressions / reach / spend / cpl from the date-wise
  // insights so the cards + Performance table reflect the selected window.
  const metrics = createMemo(() => {
    const c = campaign();
    const base = {
      leads: c?.leads_count ?? 0,
      impressions: c?.impressions ?? 0,
      reach: c?.reach ?? 0,
      spend: c?.spend ?? 0,
      cpl: c?.cpl ?? 0,
      roas: c?.roas ?? 0,
    };

    if (!isFiltered()) return base;

    const from = fromDate();
    const to = toDate();
    const rows = (insights() ?? []).filter((d) => {
      if (!d?.date) return false;
      const ds = d.date.includes("T") ? d.date.split("T")[0] : d.date;
      return ds >= from && ds <= to;
    });

    let leads = 0;
    let impressions = 0;
    let reach = 0;
    let spend = 0;
    for (const d of rows) {
      leads += d.leads || 0;
      impressions += d.impressions || 0;
      reach += d.reach || 0;
      spend += parseFloat(d.spend || 0);
    }
    // Per-day reach isn't always present; mirror the app-wide impressions proxy.
    if (!reach) reach = impressions;

    const cpl = leads > 0 ? Number((spend / leads).toFixed(2)) : 0;
    const spendRounded = Number(spend.toFixed(2));

    // ROAS isn't derivable from date-wise insights → keep the campaign value.
    return { leads, impressions, reach, spend: spendRounded, cpl, roas: base.roas };
  });

  // ── Write helper ─────────────────────────────────────────────────────────
  const setCampaignCache = (patch) =>
    setCampaignDetailsCache(campaignId, (prev) => ({ ...prev, ...patch }));

  onMount(async () => {
    // ── 1. Fetch campaign details (cached) ───────────────────────────────
    if (isCampaignCacheStale(campaignId)) {
      try {
        setCampaignCache({ loading: true });
        const res = await fetchCampaignDetails(campaignId);
        setCampaignCache({
          data: res.data,
          lastFetched: Date.now(),
          loading: false,
        });
      } catch (err) {
        console.error(err);
        setCampaignCache({ loading: false });
      }
    }

    // ── 2. Fetch date-wise insights for the chart ─────────────────────────
    // Always re-fetch insights (they are not cached separately here).
    // If you want caching, store them under campaignDetailsCache[id].insights.
    try {
      const res = await fetchCampaignInsights(campaignId);
      const raw = res.data || [];
      setInsights(Array.isArray(raw) ? raw : []);
    } catch (err) {
      console.error("Failed to load insights for chart:", err);
      setInsights([]);
    }
  });

  return (
    <div class="p-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* Header */}
      <div class="flex flex-col gap-4">
        <div>
          <h1 class="md:text-2xl text-xl font-semibold text-gray-800 dark:text-white">
            Campaign Details :
            {isAdmin()
              ? campaign()?.name
              : campaign()
                  ?.name?.split("|")
                  ?.filter((_, index) => index < 2)
                  ?.join(" | ")}
          </h1>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <span
            class={`px-4 py-1 text-sm rounded-full ${
              String(campaign()?.status).toLowerCase() === "active"
                ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                : String(campaign()?.status).toLowerCase() === "paused"
                  ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            {campaign()?.status_label}
          </span>
          <Show when={campaign()}>
            <CampaignStatusControl
              campaignId={campaignId}
              campaignName={campaign()?.name}
              status={campaign()?.status}
              onChanged={(s) =>
                setCampaignCache({
                  data: {
                    ...campaign(),
                    status: s,
                    status_label: s === "active" ? "Active" : "Paused",
                  },
                })
              }
            />
          </Show>
        </div>
      </div>

      <nav>
        <ul class="flex items-center gap-1.5 mb-6 mt-2 list-none p-0">
          <li class="flex items-center gap-1 group cursor-pointer">
            <svg
              class="w-4 h-4 text-gray-500 dark:text-gray-400 transition-colors group-hover:text-purple-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001 1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
            <a
              href="/"
              class="text-sm text-gray-600 dark:text-gray-400 transition-colors group-hover:text-purple-600"
            >
              Home
            </a>
          </li>
          <li class="flex items-center">
            <svg
              class="w-3 h-3 text-gray-600 dark:text-gray-400"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path
                d="M4.5 2.5L7.5 6L4.5 9.5"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </li>
          <li class="flex items-center gap-1 group cursor-pointer">
            <a
              href="/all-campaigns"
              class="text-sm text-gray-600 dark:text-gray-400 transition-colors group-hover:text-purple-600"
            >
              All Active Campaigns
            </a>
          </li>
          <li class="flex items-center">
            <svg
              class="w-3 h-3 text-gray-600 dark:text-gray-400"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path
                d="M4.5 2.5L7.5 6L4.5 9.5"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </li>
          <li>
            <span class="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {params.id}
            </span>
          </li>
        </ul>
      </nav>

      {/* AI Insight (admin + Tier 1 CM only) */}
      <AIInsightButton campaignId={campaignId} />

      {/* Date-range filter for the overview KPIs */}
      <div class="flex flex-wrap items-center justify-end gap-3 mb-6">
        <DateRangeFilter
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={setFromDate}
          setToDate={setToDate}
        />
        <Show when={isFiltered()}>
          <button
            onClick={resetRange}
            class="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Reset
          </button>
        </Show>
      </div>

      {/* Campaign Overview */}
      <div class="grid md:grid-cols-5 gap-6 mb-10">
        <div class="bg-red-50 dark:bg-gray-800 px-5 py-9 rounded-xl shadow hover:shadow-lg border border-red-200 dark:border-gray-600">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-lg text-red-800 dark:text-gray-400">Leads</p>
              <h3 class="text-xl font-semibold mt-2 dark:text-white">
                {metrics().leads || "0"}
              </h3>
            </div>
            <div class="flex bg-red-100 dark:bg-purple-500 p-3 rounded items-center gap-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <Users
                size={20}
                class="font-bold text-red-500 dark:text-purple-100"
              />
            </div>
          </div>
        </div>
        <div class="bg-blue-50 dark:bg-gray-800 px-5 py-9 rounded-xl shadow hover:shadow-lg border border-blue-200 dark:border-gray-600">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-lg text-blue-800 dark:text-gray-400">
                Impressions
              </p>
              <h3 class="text-xl font-semibold mt-2 dark:text-white">
                {metrics().impressions}
              </h3>
            </div>
            <div class="flex bg-blue-100 dark:bg-blue-500 p-3 rounded items-center gap-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <Eye
                size={20}
                class="font-bold text-blue-500 dark:text-blue-100"
              />
            </div>
          </div>
        </div>
        <div class="bg-red-50 dark:bg-gray-800 px-5 py-9 rounded-xl shadow hover:shadow-lg border border-red-200 dark:border-gray-600">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-lg text-red-800 dark:text-gray-400">Reach</p>
              <h3 class="text-xl font-semibold mt-2 dark:text-white">
                {metrics().reach}
              </h3>
            </div>
            <div class="flex bg-red-100 dark:bg-purple-500 p-3 rounded items-center gap-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <Users
                size={20}
                class="font-bold text-red-500 dark:text-purple-100"
              />
            </div>
          </div>
        </div>
        <div class="bg-green-50 dark:bg-gray-800 px-5 py-9 rounded-xl shadow hover:shadow-lg border border-green-200 dark:border-gray-600">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-lg text-green-800 dark:text-gray-400">Spend</p>
              <h3 class="text-xl font-semibold mt-2 dark:text-white">
                ₹{metrics().spend}
              </h3>
            </div>
            <div class="flex bg-green-100 dark:bg-green-500 p-3 rounded items-center gap-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <IndianRupee
                size={20}
                class="font-bold text-green-500 dark:text-green-100"
              />
            </div>
          </div>
        </div>
        <div class="bg-purple-50 dark:bg-gray-800 px-5 py-9 rounded-xl shadow hover:shadow-lg border border-purple-200 dark:border-gray-600">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-lg text-purple-800 dark:text-gray-400">ROAS</p>
              <h3 class="text-xl font-semibold mt-2 dark:text-white">
                {campaign()?.roas || "0"}
              </h3>
            </div>
            <div class="flex bg-purple-100 dark:bg-purple-500 p-3 rounded items-center gap-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <TrendingUp
                size={20}
                class="font-bold text-purple-500 dark:text-purple-100"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Campaign Basics */}
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          <div class="p-5 border-b border-gray-200 dark:border-gray-700">
            <h2 class="font-semibold text-gray-800 dark:text-white">
              Campaign Basics
            </h2>
          </div>
          <table class="w-full text-sm">
            <tbody>
              <tr class="border-b dark:border-gray-700">
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <Folder size={16} /> Campaign Name
                </td>
                <td class="p-4 md:font-medium text-sm dark:text-white">
                  {campaign()
                    ?.name?.split("|")
                    ?.filter((_, i) => i < 2)
                    ?.join(" | ")}
                </td>
              </tr>
              <tr class="border-b dark:border-gray-700">
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <Wallet size={16} /> Ad Account
                </td>
                <td class="p-4 md:font-medium text-sm dark:text-white">
                  {campaign()?.ad_account_name || "—"}
                </td>
              </tr>
              <tr class="border-b dark:border-gray-700">
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <Target size={16} /> Objective
                </td>
                <td class="p-4 font-medium dark:text-white">
                  {campaign()?.objective_label}
                </td>
              </tr>
              <tr class="border-b dark:border-gray-700">
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <CalendarDays size={16} /> Start Date
                </td>
                <td class="p-4 font-medium dark:text-white">
                  {campaign()?.start_date}
                </td>
              </tr>
              <tr class="border-b dark:border-gray-700">
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <CalendarClock size={16} /> Stop Date
                </td>
                <td class="p-4 font-medium dark:text-white">
                  {campaign()?.stop_date}
                </td>
              </tr>
              <tr>
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <Activity size={16} /> Status
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
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          <div class="p-5 border-b border-gray-200 dark:border-gray-700">
            <h2 class="font-semibold text-gray-800 dark:text-white">
              Performance Metrics
            </h2>
          </div>
          <table class="w-full text-sm">
            <tbody>
              <tr class="border-b dark:border-gray-700">
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <Eye size={16} class="text-gray-400 dark:text-gray-300" />{" "}
                  Impressions
                </td>
                <td class="p-4 font-medium dark:text-white">
                  {metrics().impressions}
                </td>
              </tr>
              <tr class="border-b dark:border-gray-700">
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <Users size={16} class="text-gray-400 dark:text-gray-300" />{" "}
                  Reach
                </td>
                <td class="p-4 font-medium dark:text-white">
                  {metrics().reach}
                </td>
              </tr>
              <tr class="border-b dark:border-gray-700">
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <IndianRupee size={16} class="text-green-500" /> Spend
                </td>
                <td class="p-4 font-medium dark:text-white">
                  ₹{metrics().spend}
                </td>
              </tr>
              <tr class="border-b dark:border-gray-700">
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <TrendingDown size={16} class="text-yellow-500" /> Cost Per
                  Result
                </td>
                <td class="p-4 font-medium dark:text-white">
                  {metrics().cpl || "0"}
                </td>
              </tr>
              <tr>
                <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <TrendingUp size={16} class="text-green-500" /> ROAS
                </td>
                <td class="p-4 font-medium dark:text-white">
                  {campaign()?.roas || "0"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Chart — now receives live insights ─────────────────────────────── */}
      <div class="grid grid-cols-1 md:grid-cols-1 mb-8">
        <LeadsChart campaign={campaign()} insights={insights()} />
      </div>

      {/* Audience & Targeting */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
        <div class="p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 class="font-semibold text-gray-800 dark:text-white">
            Audience & Targeting
          </h2>
        </div>
        <table class="w-full text-sm">
          <tbody>
            <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
              <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <Users size={16} class="text-gray-400 dark:text-gray-300" /> Age
                Group
              </td>
              <td class="p-4 font-medium dark:text-white">{campaign()?.age}</td>
            </tr>
            <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
              <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <User size={16} class="text-gray-400 dark:text-gray-300" />{" "}
                Gender
              </td>
              <td class="p-4 font-medium dark:text-white">
                {campaign()?.gender}
              </td>
            </tr>
            <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
              <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <MapPin size={16} class="text-red-500" /> Region
              </td>
              <td class="p-4 font-medium dark:text-white">
                {campaign()?.region}
              </td>
            </tr>
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
              <td class="p-4 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <Crosshair size={16} class="text-blue-500" /> Targeting
              </td>
              <td class="p-4 font-medium dark:text-white">
                {campaign()?.targeting}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
