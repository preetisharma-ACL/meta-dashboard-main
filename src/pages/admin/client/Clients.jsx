import {
  createSignal,
  createMemo,
  createResource,
  createEffect,
  on,
  onMount,
  For,
  Show,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchClients } from "../services/fetchClients";
import { fetchHierarchyClients } from "../../../services/cm";
import { fetchManagerPerformance } from "../../../services/performance";
import {
  probeAdminSwitchMode,
  fetchManagerOwnClients,
} from "../../../services/cmAdmin";
import { setProjectsCache } from "../../../cacheStore/appStore";
import Avatar from "../../../components/common/Avatar";
import RowsPerPageSelect from "../../../components/common/RowsPerPageSelect";
import ClientStatusControl from "../../../components/clientStatus/ClientStatusControl";
import ClientStatusHistoryDrawer from "../../../components/clientStatus/ClientStatusHistoryDrawer";
import {
  fetchStatusBoard,
  STATUS_FILTERS,
  STATUS_DOT,
  normaliseStatus,
} from "../../../services/clientStatus";
import ValueTierControl from "../../../components/clientValueTier/ValueTierControl";
import ValueTierHistoryDrawer from "../../../components/clientValueTier/ValueTierHistoryDrawer";
import {
  fetchValueTierBoard,
  VALUE_TIER_FILTERS,
  VALUE_TIER_DOT,
  isValueTierMismatch,
  normaliseValueTier,
} from "../../../services/valueTier";
import { canSeeValueTier } from "../../../stores/currentUser";
import CampaignActivityBadge from "../../../components/clientActivity/CampaignActivityBadge";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_MISMATCH,
  ACTIVITY_RUNNING,
  activityParam,
  matchesActivityFilter,
} from "../../../services/campaignActivity";

// ─── helpers ─────────────────────────────────────────────────────────────────

const TYPE_COLORS = {
  hybrid: "bg-purple-100 text-purple-700 ring-1 ring-purple-300",
  cpl: "bg-amber-100  text-amber-700  ring-1 ring-amber-300",
  retainer: "bg-sky-100    text-sky-700    ring-1 ring-sky-300",
};

const fmtType = (t) =>
  String(t ?? "")
    .charAt(0)
    .toUpperCase() + String(t ?? "").slice(1);

// Client-type multi-select chips (same pattern as Allowed Budget / Account
// Funding). CPL + Hybrid are on by default; Retainer is off by default.
const CLIENT_TYPE_CHIPS = [
  { key: "cpl", label: "CPL" },
  { key: "hybrid", label: "Hybrid" },
  { key: "retainer", label: "Retainer" },
];
const DEFAULT_CLIENT_TYPES = ["cpl", "hybrid"];

// Assignment (has a campaign manager) filter options.
const ASSIGN_OPTIONS = [
  { value: "all", label: "All Assignment" },
  { value: "assigned", label: "Assigned" },
  { value: "unassigned", label: "Not assigned yet" },
];

// Current month key (YYYY-MM) — the manager roster is month-scoped.
const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Friendly manager name from their email local-part.
const labelFromEmail = (email) => {
  const local = String(email ?? "").split("@")[0] || "—";
  return local.charAt(0).toUpperCase() + local.slice(1);
};

const fmt = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// ─── component ───────────────────────────────────────────────────────────────

// Read the caller's role synchronously (same source the route guards use).
const authRole = (() => {
  try {
    return JSON.parse(localStorage.getItem("auth") || "{}")?.role ?? null;
  } catch {
    return null;
  }
})();
const isCampaignManager = () => authRole === "campaign_manager";
const isAdmin = () => authRole === "admin";

// The admin clients endpoint is 403 for CMs, so CMs are sourced from the
// CM-scoped hierarchy endpoint instead. That payload is smaller — this maps it
// onto the fields the table reads. Columns the hierarchy doesn't expose
// (email, organisation, created-at) fall back to null → rendered as "—"; the
// active flag is inferred from has_client_login.
const adaptHierarchyClient = (c) => ({
  id: c.client_nomen_id,
  client_nomen: c.client_nomen_id,
  client_nomen_name: c.client_name ?? "",
  organization_name: c.organization_name ?? null,
  email: c.email ?? null,
  client_type: c.client_type ?? null,
  is_active: c.is_active ?? c.has_client_login ?? true,
  created_at: c.created_at ?? null,
  // Client PK, served by the hierarchy as `client_id`. DISTINCT from `id`
  // above, which is the NOMEN id on this adapted row — the status PATCH is
  // keyed by PK, and sending a nomen would patch a different client.
  client_pk: c.client_id ?? null,
  engagement_status: c.engagement_status ?? null,
  // Derived "any campaign live right now" flag. Absent on hierarchy payloads
  // cached before the field shipped — left null there, which the badge renders
  // as nothing rather than inventing "Paused".
  campaign_activity: c.campaign_activity ?? null,
});

export default function Clients() {
  const navigate = useNavigate();

  const [loading, setLoading] = createSignal(true);
  const [search, setSearch] = createSignal("");
  const [clientTypes, setClientTypes] = createSignal(DEFAULT_CLIENT_TYPES); // multi-select
  const [assignFilter, setAssignFilter] = createSignal("all"); // all | assigned | unassigned
  const [cmFilter, setCmFilter] = createSignal("all"); // "all" | manager_email
  const [activeFilter, setActiveFilter] = createSignal("All");
  // Engagement status (manual label) — NOT the is_active flag above.
  const [statusFilter, setStatusFilter] = createSignal("all");
  // Campaign activity (DERIVED from live campaigns) — a different axis from the
  // engagement label above, and filtered differently: admins get a server-side
  // ?activity=, CMs read the hierarchy, which has no such param.
  const [activityFilter, setActivityFilter] = createSignal("all");
  // Value tier (MANUAL, commercial, INTERNAL) — a fourth label, and the only one
  // of the four that a client must never see. Admin + coordination only.
  const [tierFilter, setTierFilter] = createSignal("all");
  const [historyFor, setHistoryFor] = createSignal(null);
  const [tierHistoryFor, setTierHistoryFor] = createSignal(null);

  // ── Engagement status ─────────────────────────────────────────────────────
  // The admin client rows now carry `engagement_status`, but not the latest
  // change (reason / who / when) — and the CM path here reads the hierarchy,
  // which carries neither. The status board serves both, scoped server-side to
  // whatever the caller may see, so ONE call fills the column for admin and CM
  // alike and gives us the reason caption the badge needs.
  const [statusBoard, { mutate: mutateBoard }] = createResource(async () => {
    try {
      return await fetchStatusBoard();
    } catch (err) {
      console.error("Clients: status board failed", err);
      return { counts: {}, clients: [] };
    }
  });

  // Client PK (as string) → { status, change }.
  const statusByPk = createMemo(() => {
    const map = {};
    for (const c of statusBoard()?.clients ?? []) {
      map[String(c.id)] = {
        status: c.engagement_status ?? null,
        change: c.latest_change ?? null,
      };
    }
    return map;
  });

  // The PK for a row. Admin rows come from /clients/admin/clients/ where `id`
  // IS the PK; CM rows are adapted hierarchy rows whose `id` is the nomen, so
  // they carry the PK separately in `client_pk`.
  const pkOf = (c) => (isCampaignManager() ? c.client_pk : c.id);

  // Board first (freshest + carries the reason), then whatever the list row
  // itself reported.
  const statusOf = (c) => {
    const pk = pkOf(c);
    const fromBoard = pk != null ? statusByPk()[String(pk)] : null;
    return fromBoard?.status ?? c.engagement_status ?? null;
  };
  const changeOf = (c) => {
    const pk = pkOf(c);
    return pk != null ? (statusByPk()[String(pk)]?.change ?? null) : null;
  };

  // Keep the board in sync after an inline change so the badge, the caption and
  // the status filter all agree without a refetch.
  const applyStatusChange = (pk, { status, change }) => {
    mutateBoard((prev) => {
      const clients = prev?.clients ?? [];
      const hit = clients.some((c) => String(c.id) === String(pk));
      const next = hit
        ? clients.map((c) =>
            String(c.id) === String(pk)
              ? { ...c, engagement_status: status, latest_change: change }
              : c,
          )
        : [...clients, { id: pk, engagement_status: status, latest_change: change }];
      return { counts: prev?.counts ?? {}, clients: next };
    });
  };

  // ── Value tier ────────────────────────────────────────────────────────────
  // The list rows carry `value_tier`, but not the SUGGESTION — and the
  // suggestion (with the funds behind it) is the reason this feature exists. The
  // board serves tier + suggested_value_tier + month_funds_inc_gst + mismatch for
  // every client the caller may see, so one call fills the column properly.
  //
  // Gated on canSeeValueTier(): a CM or any other role never issues this request
  // at all, which keeps an internal classification off the wire for people who
  // must not see it — not merely un-rendered.
  const [tierBoard, { mutate: mutateTierBoard }] = createResource(
    () => (canSeeValueTier() ? "load" : null),
    async () => {
      try {
        return await fetchValueTierBoard();
      } catch (err) {
        console.error("Clients: value tier board failed", err);
        return { counts: {}, clients: [] };
      }
    },
  );

  // Indexed by Client PK AND by nomen. Two keys because this board names its
  // columns `client_id`/`client_nomen` while the engagement board next door uses
  // `id` — if that difference ever moves, the column still resolves.
  const tierByKey = createMemo(() => {
    const byPk = {};
    const byNomen = {};
    for (const c of tierBoard()?.clients ?? []) {
      const entry = {
        tier: c.value_tier ?? null,
        suggested: c.suggested_value_tier ?? null,
        monthFunds: c.month_funds_inc_gst ?? null,
        mismatch: c.mismatch ?? null,
      };
      if (c.client_id != null) byPk[String(c.client_id)] = entry;
      if (c.client_nomen != null) byNomen[String(c.client_nomen)] = entry;
    }
    return { byPk, byNomen };
  });

  const tierEntry = (c) => {
    const { byPk, byNomen } = tierByKey();
    const pk = pkOf(c);
    const hit =
      (pk != null ? byPk[String(pk)] : null) ??
      byNomen[String(c.client_nomen)] ??
      null;
    // Board first (it carries the suggestion); fall back to the tier the list row
    // itself reported so the badge still renders if the board call failed.
    return {
      tier: hit?.tier ?? c.value_tier ?? null,
      suggested: hit?.suggested ?? null,
      monthFunds: hit?.monthFunds ?? null,
      mismatch: hit?.mismatch ?? null,
    };
  };

  // Keep the board in sync after an inline change so the badge, the hint and the
  // tier filter agree without a refetch.
  const applyTierChange = (pk, nomen, { tier, suggested, monthFunds }) => {
    mutateTierBoard((prev) => {
      const clients = prev?.clients ?? [];
      const isRow = (c) =>
        (c.client_id != null && String(c.client_id) === String(pk)) ||
        (c.client_nomen != null && String(c.client_nomen) === String(nomen));
      const patch = (c) => ({
        ...c,
        value_tier: tier,
        suggested_value_tier: suggested ?? c.suggested_value_tier,
        month_funds_inc_gst: monthFunds ?? c.month_funds_inc_gst,
        // Recomputed, not carried over: the server's boolean described the tier
        // we just replaced.
        mismatch: isValueTierMismatch(tier, suggested ?? c.suggested_value_tier),
      });
      const hit = clients.some(isRow);
      const next = hit
        ? clients.map((c) => (isRow(c) ? patch(c) : c))
        : [
            ...clients,
            patch({ client_id: pk, client_nomen: nomen }),
          ];
      return { counts: prev?.counts ?? {}, clients: next };
    });
  };

  // Toggle a client-type chip; never allow an empty selection.
  const toggleClientType = (key) => {
    setClientTypes((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      return next.length ? next : prev;
    });
  };

  // ── Campaign-manager map (client_nomen → owning CM) ────────────────────────
  // The admin clients endpoint carries no owner, so we assemble it the same way
  // the "Campaign Manager's Clients" screen does: roster → switch-mode probe →
  // per-manager own-client lists, joined on the client nomen id.
  // Roster + switch-mode probing are admin-only; skip them entirely for CMs so
  // they don't 403 (and leave the CM filter stuck on "Loading managers…").
  const [rosterRes] = createResource(
    () => (isCampaignManager() ? false : currentMonthKey()),
    async (m) => {
      const res = await fetchManagerPerformance(m);
      return Array.isArray(res?.data) ? res.data : [];
    },
  );
  const managers = () => rosterRes() ?? [];

  const [switchMode, setSwitchMode] = createSignal("unknown");
  createEffect(
    on(managers, (list) => {
      if (switchMode() !== "unknown") return;
      if (!list || list.length === 0) return;
      setSwitchMode("checking");
      probeAdminSwitchMode(list[0].manager_id)
        .then((r) => setSwitchMode(r.allowed ? "allowed" : "denied"))
        .catch(() => setSwitchMode("denied"));
    }),
  );
  const cmAllowed = () => switchMode() === "allowed";

  const [ownLists] = createResource(
    () => (cmAllowed() && managers().length ? managers() : null),
    async (list) => {
      const entries = await Promise.all(
        list.map(async (m) => [
          m.manager_id,
          await fetchManagerOwnClients(m.manager_id),
        ]),
      );
      return Object.fromEntries(entries);
    },
  );

  // nomen (as string) → { email, name } of the first manager that owns it.
  const cmByNomen = createMemo(() => {
    const own = ownLists() ?? {};
    const map = {};
    for (const m of managers()) {
      for (const c of own[m.manager_id] ?? []) {
        const key = String(c.client_nomen_id);
        if (!(key in map)) {
          map[key] = { email: m.manager_email, name: labelFromEmail(m.manager_email) };
        }
      }
    }
    return map;
  });
  const cmForClient = (c) => cmByNomen()[String(c.client_nomen)] ?? null;
  // Map is trustworthy only once the probe allowed it AND the lists resolved.
  const cmReady = () => cmAllowed() && !ownLists.loading && !!ownLists();

  // Every manager from the roster, A→Z, for the CM filter dropdown.
  const managerOptions = createMemo(() =>
    managers()
      .map((m) => ({ email: m.manager_email, name: labelFromEmail(m.manager_email) }))
      .filter((m) => m.email)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const [sortKey, setSortKey] = createSignal("created_at");
  const [sortDir, setSortDir] = createSignal("desc");
  const [selected, setSelected] = createSignal(new Set());
  const [impersonating, setImpersonating] = createSignal(null);
  const [allClients, setAllClients] = createSignal([]);

  // ── pagination state ──────────────────────────────────────────────────────
  // Paging is client-side: the table renders allClients(), which loadAllClients()
  // fetches in full (the API is paged at 1000/request, then joined). Driving the
  // paginator off the server's page meta put every row on one page, so page and
  // size here just slice the filtered set.
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(
    Number(localStorage.getItem("adminClientsRowsPerPage")) || 20,
  );

  // ── load ──────────────────────────────────────────────────────────────────
  // CMs: one CM-scoped call returns their whole (small) client set.
  const loadCmClients = async () => {
    const res = await fetchHierarchyClients();
    const rows = (Array.isArray(res?.data) ? res.data : []).map(
      adaptHierarchyClient,
    );
    setAllClients(rows);
    setPage(1);
  };

  // Rows per page — restart at page 1, the old page number can be past the end
  // once the page grows. Select-all is per-page, so the selection clears too.
  const changeRowsPerPage = (size) => {
    if (size === pageSize()) return;
    setPageSize(size);
    localStorage.setItem("adminClientsRowsPerPage", String(size));
    setSelected(new Set());
    setPage(1);
  };

  const loadAllClients = async () => {
    // CMs already have their full set from loadCmClients (hierarchy has no paging).
    if (isCampaignManager()) return;
    // The activity chip is the one filter the API applies for us. Everything else
    // on this page is filtered in the browser off the full roster.
    const activity = activityParam(activityFilter());
    try {
      let currentPage = 1;
      let hasMore = true;
      let allData = [];

      while (hasMore) {
        const res = await fetchClients(currentPage, 1000, undefined, activity);
        const clientsData = res.data || [];

        allData = [...allData, ...clientsData];

        const pagination = res.meta?.pagination;

        hasMore = pagination?.has_next;
        currentPage++;
      }

      setAllClients(allData);
    } catch (err) {
      console.error("Failed to load all clients:", err);
    }
  };

  onMount(async () => {
    setLoading(true);
    try {
      await (isCampaignManager() ? loadCmClients() : loadAllClients());
    } catch (err) {
      console.error("Failed to load clients:", err);
    } finally {
      setLoading(false);
    }
  });

  // Activity is filtered SERVER-side for admins (?activity=running|paused), so
  // changing the chip re-fetches the roster. CMs are sourced from the hierarchy,
  // which takes no such param — their rows are already in memory and get filtered
  // locally in filtered() below, so no refetch there.
  createEffect(
    on(
      activityFilter,
      async () => {
        if (isCampaignManager()) return;
        setLoading(true);
        setSelected(new Set());
        try {
          await loadAllClients();
        } finally {
          setLoading(false);
        }
      },
      { defer: true },
    ),
  );

  // ── sort ──────────────────────────────────────────────────────────────────
  const toggleSort = (key) => {
    if (sortKey() === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIcon = (key) => {
    if (sortKey() !== key) return <span class="text-gray-300 ml-1">⇅</span>;
    return (
      <span class="ml-1 text-purple-600">
        {sortDir() === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  // ── client-side filter + sort (applied to the current page's data) ────────
  const filtered = createMemo(() => {
    let data = [...allClients()];

    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter(
        (c) =>
          c.email?.toLowerCase().includes(q) ||
          c.client_nomen_name?.toLowerCase().includes(q) ||
          c.organization_name?.toLowerCase().includes(q),
      );
    }
 
    // Multi-select client-type filter. Clients with no type always pass through.
    const types = clientTypes();
    data = data.filter((c) => !c.client_type || types.includes(c.client_type));

    // Assignment filter — only applied once the CM map is trustworthy.
    if (cmReady() && assignFilter() !== "all") {
      const wantAssigned = assignFilter() === "assigned";
      data = data.filter((c) => Boolean(cmForClient(c)) === wantAssigned);
    }

    // Campaign-manager filter — clients owned by the selected manager.
    if (cmReady() && cmFilter() !== "all") {
      data = data.filter((c) => cmForClient(c)?.email === cmFilter());
    }

    if (activeFilter() === "Yes") data = data.filter((c) => c.is_active);
    else if (activeFilter() === "No") data = data.filter((c) => !c.is_active);

    // Engagement-status filter. Applied client-side against the resolved
    // status, like every other filter on this page — the full roster is already
    // in memory, so a ?status= round-trip would only add latency and would not
    // work for the CM path (hierarchy-sourced rows). fetchClients() does accept
    // the param for callers that fetch per-status.
    if (statusFilter() !== "all") {
      data = data.filter((c) => normaliseStatus(statusOf(c)) === statusFilter());
    }

    // Activity filter (derived). Two paths, because the two data sources differ:
    //   • CM rows come from the hierarchy, which has no ?activity= — filter here.
    //   • Admin rows were already narrowed by the API. Do NOT re-apply the same
    //     predicate locally: if the endpoint ever answers the param without also
    //     echoing campaign_activity on each row, a second local pass would empty
    //     the table. Only Mismatch needs more work, and only the half the query
    //     couldn't express — the server gave us the paused rows, so all that's
    //     left is "and the manual label says Active".
    const wantActivity = activityFilter();
    if (wantActivity !== "all") {
      if (isCampaignManager()) {
        data = data.filter((c) =>
          matchesActivityFilter(wantActivity, {
            engagement: statusOf(c),
            activity: c.campaign_activity,
          }),
        );
      } else if (wantActivity === ACTIVITY_MISMATCH) {
        data = data.filter((c) => normaliseStatus(statusOf(c)) === "active");
      }
    }

    // Value-tier filter — client-side against the resolved tier. The whole board
    // is already in memory, and this filter only exists for roles that fetched
    // it, so there is nothing to gain from a round-trip.
    if (canSeeValueTier() && tierFilter() !== "all") {
      data = data.filter(
        (c) => normaliseValueTier(tierEntry(c).tier) === tierFilter(),
      );
    }

    data.sort((a, b) => {
      let va = a[sortKey()],
        vb = b[sortKey()];
      if (sortKey() === "created_at") {
        va = new Date(va);
        vb = new Date(vb);
      } else {
        va = String(va ?? "").toLowerCase();
        vb = String(vb ?? "").toLowerCase();
      }
      if (va < vb) return sortDir() === "asc" ? -1 : 1;
      if (va > vb) return sortDir() === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  });

  // ── client-side pagination over the filtered set ──────────────────────────
  const totalPages = createMemo(() =>
    Math.max(1, Math.ceil(filtered().length / pageSize())),
  );

  // Clamped: a filter can shrink the result set below the page we were on.
  const currentPage = () => Math.min(page(), totalPages());

  const paginated = createMemo(() => {
    const start = (currentPage() - 1) * pageSize();
    return filtered().slice(start, start + pageSize());
  });

  const hasPrev = () => currentPage() > 1;
  const hasNext = () => currentPage() < totalPages();

  // Snap back to page 1 when the result set changes underneath us.
  createEffect(
    on(
      [
        search,
        clientTypes,
        assignFilter,
        cmFilter,
        activeFilter,
        statusFilter,
        activityFilter,
        tierFilter,
      ],
      () => setPage(1),
      { defer: true },
    ),
  );

  // ── select-all (scoped to the rows visible on this page) ───────────────────
  const allSelected = createMemo(
    () =>
      paginated().length > 0 && paginated().every((c) => selected().has(c.id)),
  );
  const toggleAll = () => {
    setSelected(
      allSelected() ? new Set() : new Set(paginated().map((c) => c.id)),
    );
  };
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── impersonation ─────────────────────────────────────────────────────────
  const handleImpersonate = (client) => {
    setImpersonating(client.id);

    const realAdmin = localStorage.getItem("auth");
    if (realAdmin) sessionStorage.setItem("admin_auth_backup", realAdmin);

    const clientAuth = client.auth ?? {
      token: client.impersonation_token ?? JSON.parse(realAdmin ?? "{}").token,
      role: "client",
      clientId: client.id,
      clientName: client.client_nomen_name,
      organizationId: client.organization,
      email: client.email,
      _impersonating: true,
      _adminEmail: JSON.parse(realAdmin ?? "{}").email,
    };

    // localStorage.setItem("auth", JSON.stringify(clientAuth));
    // navigate("/");
  };

  const handleClientDashboard = (client) => {
    localStorage.setItem("selectedClientNomen", client.client_nomen_name);
    localStorage.setItem("selectedClientNomenId", client.client_nomen); // nomen id
    // Client PK — what as_client_id expects. Distinct from the nomen id above for
    // all but one client, and the backend 404s if handed a nomen id.
    // Admin only: `client.id` is the Client PK only on the admin roster. For CMs
    // the rows come from /cm/hierarchy/clients/ via adaptHierarchyClient, whose
    // `id` is the NOMEN id (66, not PK 6) — writing it here would send a nomen as
    // as_client_id and 403 "This client is not in your scope" → silent zeros.
    if (isAdmin()) localStorage.setItem("selectedClientId", String(client.id));
    localStorage.setItem("selectedClientName", client.organization_name);

    setProjectsCache({
      data: [],
      insightsMap: {},
      lastFetched: 0,
      loading: false,
      meta: {
        page: 1,
        page_size: 20,
        total: 0,
        total_pages: 1,
        has_next: false,
        has_prev: false,
      },
    });
    // In Clients.jsx, wherever you currently bust the cache before navigating:
    setProjectsCache("lastFetched", 0);
    setProjectsCache("lastFetchedAll", 0); // ← add this
    setProjectsCache("allProjects", []);
    setProjectsCache("insightsMap", {});

    navigate(`/${client.client_nomen_name.toLowerCase().replace(/\s+/g, "-")}`);
  };

  // ─── render ───────────────────────────────────────────────────────────────
  // p-2 left the heading and the chips 8px off the screen edge, reading as
  // flush against it. p-4 matches the other screens' mobile gutter; the sm:/lg:
  // steps are unchanged.
  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6 lg:p-8">
      {/* ── Page header ── */}
      <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          {/* Matches the dashboard's heading treatment: crimson→gold tile,
              same gradient across the word. */}
          <h1 class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464"
                />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Clients
            </span>
          </h1>
          {/* pl-[46px] = tile (36px) + gap (10px), so this starts under the
              heading text rather than under the icon. */}
          <p class="pl-[46px] text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {allClients().length} total
            {/* Admins get a server-narrowed roster when an Activity chip is on,
                so say so — otherwise "total" reads as the whole book. */}
            <Show when={!isCampaignManager() && activityFilter() !== "all"}>
              <span>
                {" "}
                with{" "}
                {activityFilter() === ACTIVITY_MISMATCH
                  ? "paused campaigns"
                  : `campaigns ${activityFilter()}`}
              </span>
            </Show>
            {" "}· click a row to open that client's dashboard
          </p>
        </div>
      </div>

      {/* ── Client-type toggle chips ── */}
      <div class="flex flex-wrap items-center gap-1.5 mb-4">
        <span class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mr-1">
          Client type
        </span>
        {/* Keep CPL/Hybrid/Retainer together on a single line */}
        <div class="flex items-center gap-1.5">
          <For each={CLIENT_TYPE_CHIPS}>
            {(t) => {
              const on = () => clientTypes().includes(t.key);
              return (
                <button
                  type="button"
                  onClick={() => toggleClientType(t.key)}
                  aria-pressed={on()}
                  class={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                    on()
                      ? "bg-[#14233A] text-white border-[#14233A]"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                  }`}
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <Show when={on()} fallback={<circle cx="12" cy="12" r="9" stroke-width="1.6" />}>
                      <path d="M20 6L9 17l-5-5" />
                    </Show>
                  </svg>
                  {t.label}
                </button>
              );
            }}
          </For>
        </div>
      </div>

      {/* ── Engagement-status chips ──
          The manual active/hold/completed label, deliberately in its own row and
          worded "Engagement" so it never reads as the is_active column. */}
      <div class="flex flex-wrap items-center gap-1.5 mb-4">
        <span class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mr-1">
          Engagement
        </span>
        <div class="flex flex-wrap items-center gap-1.5">
          <For each={STATUS_FILTERS}>
            {(f) => {
              const on = () => statusFilter() === f.key;
              return (
                <button
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  aria-pressed={on()}
                  class={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                    on()
                      ? "bg-[#14233A] text-white border-[#14233A]"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                  }`}
                >
                  <Show when={f.key !== "all"}>
                    <span class={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[f.key]}`} />
                  </Show>
                  {f.label}
                </button>
              );
            }}
          </For>
        </div>
      </div>

      {/* ── Activity chips (DERIVED) ──
          A different fact from the Engagement row above, so it gets its own row,
          its own name, its own chip shape (rounded rectangle, monochrome ●/○
          marks — not the coloured pills) and a caption saying where it comes
          from. "Active" is somebody's label; "Running" is what the campaigns are
          actually doing. */}
      <div class="mb-4">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mr-1">
            Activity
          </span>
          <div class="flex flex-wrap items-center gap-1.5">
            <For each={ACTIVITY_FILTERS}>
              {(f) => {
                const on = () => activityFilter() === f.key;
                const isMismatchChip = f.key === ACTIVITY_MISMATCH;
                return (
                  <button
                    type="button"
                    onClick={() => setActivityFilter(f.key)}
                    aria-pressed={on()}
                    title={
                      isMismatchChip
                        ? "Clients marked Active whose campaigns are all paused"
                        : undefined
                    }
                    class={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold uppercase tracking-[0.05em] border transition-colors whitespace-nowrap ${
                      on()
                        ? "bg-gray-800 text-white border-gray-800 dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-gray-500"
                    }`}
                  >
                    <Show when={f.key !== "all"}>
                      <Show
                        when={!isMismatchChip}
                        fallback={
                          <svg
                            class="w-3.5 h-3.5 text-[#B07A14] dark:text-amber-400"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <path d="M12 9v4M12 17h.01" />
                          </svg>
                        }
                      >
                        {/* ● running · ○ paused — the badge's own marks */}
                        <span
                          class={`h-1.5 w-1.5 rounded-full ${
                            f.key === ACTIVITY_RUNNING
                              ? on()
                                ? "bg-white dark:bg-gray-900"
                                : "bg-gray-700 dark:bg-gray-200"
                              : on()
                                ? "border border-white dark:border-gray-900"
                                : "border border-gray-400 dark:border-gray-500"
                          }`}
                        />
                      </Show>
                    </Show>
                    {f.label}
                  </button>
                );
              }}
            </For>
          </div>
        </div>
        <p class="pl-1 mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          Derived from live campaigns — not the manual Engagement label above.
        </p>
      </div>

      {/* ── Value Tier chips (MANUAL · INTERNAL) ──
          The fourth label, and the only one clients must never see — hence the
          whole row is behind canSeeValueTier() (admin + coordination), and the
          caption says so out loud so nobody screen-shares this into a client
          call by accident. ◆ marks match the badge on the rows. */}
      <Show when={canSeeValueTier()}>
        <div class="mb-4">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mr-1">
              Value tier
            </span>
            <div class="flex flex-wrap items-center gap-1.5">
              <For each={VALUE_TIER_FILTERS}>
                {(f) => {
                  const on = () => tierFilter() === f.key;
                  return (
                    <button
                      type="button"
                      onClick={() => setTierFilter(f.key)}
                      aria-pressed={on()}
                      class={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[6px] text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                        on()
                          ? "bg-[#14233A] text-white border-[#14233A]"
                          : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                      }`}
                    >
                      <Show when={f.key !== "all"}>
                        <span
                          class={`h-1.5 w-1.5 rounded-full ${
                            on() ? "bg-[#E9AE5C]" : VALUE_TIER_DOT[f.key]
                          }`}
                        />
                      </Show>
                      {f.label}
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
          <p class="pl-1 mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
            Internal commercial classification — never shown to the client, and
            unrelated to the billing basis in Client type.
          </p>
        </div>
      </Show>

      {/* ── Filters ── */}
      <div
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                        dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3"
      >
        {/* Search */}
        <div class="relative flex w-full sm:w-[360px]">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by email, client name, or org…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                               dark:border-gray-700 dark:bg-gray-800 dark:text-white
                               focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        {/* Active filter */}
        {/* Active Status Dropdown */}
        <select
          value={activeFilter()}
          onChange={(e) => setActiveFilter(e.target.value)}
          class="w-full sm:w-auto px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
         bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
         focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="All">All Status</option>
          <option value="Yes">Active</option>
          <option value="No">Inactive</option>
        </select>

        {/* Assignment + Campaign-manager filters are admin-only: they depend on
            the manager roster, which CMs can't read. Hidden for CMs. */}
        <Show when={!isCampaignManager()}>
        <div class="flex w-full sm:w-auto sm:inline-flex items-stretch sm:items-center gap-1 p-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <For each={ASSIGN_OPTIONS}>
            {(o) => {
              const on = () => assignFilter() === o.value;
              return (
                <button
                  type="button"
                  onClick={() => setAssignFilter(o.value)}
                  aria-pressed={on()}
                  class={`flex-1 sm:flex-none min-w-0 sm:min-w-fit flex items-center justify-center text-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors sm:whitespace-nowrap ${
                    on()
                      ? "bg-blue-900 text-white shadow-sm"
                      : "text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700"
                  }`}
                >
                  {o.label}
                </button>
              );
            }}
          </For>
        </div>

        {/* Campaign-manager filter */}
        {/* Campaign Manager Dropdown — lists every manager; select to see their clients */}
        <select
          value={cmFilter()}
          onChange={(e) => setCmFilter(e.target.value)}
          disabled={!cmReady() || managerOptions().length === 0}
          class="w-full sm:w-auto px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
         bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
         focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer
         disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <option value="all">
            {cmReady() ? "All Campaign Managers" : "Loading managers…"}
          </option>
          <For each={managerOptions()}>
            {(m) => <option value={m.email}>{m.name}</option>}
          </For>
        </select>
        </Show>
        {/* Clear All Filters Button */}
        <button
          onClick={() => {
            setSearch("");
            setClientTypes(DEFAULT_CLIENT_TYPES);
            setAssignFilter("all");
            setCmFilter("all");
            setActiveFilter("All");
            setStatusFilter("all");
            setActivityFilter("all");
            setTierFilter("all");
            setSortKey("created_at");
            setSortDir("desc");
          }}
          class="px-3 py-2 text-sm  rounded-lg
                bg-red-50 text-red-600 border border-red-200
                hover:bg-red-100 hover:border-red-300
                dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700
                transition-colors"
        >
          Clear All
        </button>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {filtered().length} results
        </span>
      </div>

      {/* ── Table ── */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr
              class="border-b border-gray-200 dark:border-gray-700
                                   bg-gray-50 dark:bg-gray-800/60 text-gray-500
                                   dark:text-gray-400 uppercase text-xs tracking-wider"
            >
              <th class="p-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected()}
                  onChange={toggleAll}
                  class="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("email")}
              >
                User {sortIcon("email")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("client_nomen_name")}
              >
                Client Nomen {sortIcon("client_nomen_name")}
              </th>
              <Show when={!isCampaignManager()}>
                <th class="p-3 text-left whitespace-nowrap">
                  Campaign Manager
                </th>
              </Show>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("organization_name")}
              >
                Organisation {sortIcon("organization_name")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("client_type")}
              >
                Client Type {sortIcon("client_type")}
              </th>
              {/* Engagement status — the manual label, distinct from Is Active */}
              <th class="p-3 text-left whitespace-nowrap">Status</th>
              {/* Internal commercial classification — admin + coordination only */}
              <Show when={canSeeValueTier()}>
                <th class="p-3 text-left whitespace-nowrap">Value Tier</th>
              </Show>
              <th class="p-3 text-center whitespace-nowrap">Is Active</th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("created_at")}
              >
                Created At {sortIcon("created_at")}
              </th>
              <th class="p-3 text-right whitespace-nowrap">History</th>
            </tr>
          </thead>

          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <td class="p-3">
                        <div class="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="flex items-center gap-2">
                          <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700" />
                          <div class="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                        </div>
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-44 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      {/* Engagement status */}
                      <td class="p-3">
                        <div class="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
                      </td>
                      {/* Value tier */}
                      <Show when={canSeeValueTier()}>
                        <td class="p-3">
                          <div class="h-5 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                        </td>
                      </Show>
                      <td class="p-3 text-center">
                        <div class="h-5 w-5 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-8 w-20 bg-gray-200 dark:bg-gray-700 rounded-lg mx-auto" />
                      </td>
                      <td class="p-3 text-right">
                        <div class="h-3 w-10 bg-gray-200 dark:bg-gray-700 rounded ml-auto" />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={paginated()}>
                {(client, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                                                hover:bg-purple-50/60 
                                                transition-colors group cursor-pointer
                                                ${
                                                  selected().has(client.id)
                                                    ? "bg-purple-50 dark:bg-purple-900/10"
                                                    : i() % 2 === 0
                                                      ? "bg-white dark:bg-gray-900"
                                                      : "bg-gray-50/60 dark:bg-gray-800/30"
                                                }`}
                    onClick={() => handleClientDashboard(client)}
                  >
                    {/* Checkbox */}
                    <td class="p-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected().has(client.id)}
                        onChange={() => toggleOne(client.id)}
                        class="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                      />
                    </td>

                    {/* Email + avatar */}
                    <td class="p-3">
                      <div class="flex items-center gap-2.5">
                        <Avatar name={client.email} />
                        <span class="text-purple-700 dark:text-gray-300 group-hover:underline font-medium">
                          {client.email}
                        </span>
                      </div>
                    </td>

                    {/* client_nomen_name */}
                    <td class="p-3 text-gray-700 dark:text-gray-300 font-medium">
                      {client.client_nomen_name}
                    </td>

                    {/* Assigned campaign manager */}
                    <Show when={!isCampaignManager()}>
                      <td class="p-3" onClick={(e) => e.stopPropagation()}>
                        <Show
                          when={cmReady()}
                          fallback={
                            <span class="text-gray-300 dark:text-gray-600">—</span>
                          }
                        >
                          <Show
                            when={cmForClient(client)}
                            fallback={
                              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300">
                                Not assigned
                              </span>
                            }
                          >
                            <div class="flex items-center gap-2">
                              <Avatar name={cmForClient(client).email} size="w-7 h-7" />
                              <span
                                class="text-gray-700 dark:text-gray-300 font-medium truncate max-w-[160px]"
                                title={cmForClient(client).email}
                              >
                                {cmForClient(client).name}
                              </span>
                            </div>
                          </Show>
                        </Show>
                      </td>
                    </Show>

                    {/* organization_name */}
                    <td class="p-3 text-gray-500 dark:text-gray-400">
                      {client.organization_name ?? "—"}
                    </td>

                    {/* Type badge */}
                    <td class="p-3 text-center">
                      <span
                        class={`px-2.5 py-0.5 rounded-full text-xs font-semibold
                                                          ${TYPE_COLORS[client.client_type] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {fmtType(client.client_type)}
                      </span>
                    </td>

                    {/* Engagement status — clickable badge + latest reason.
                        stopPropagation: the row itself navigates to the client
                        dashboard, and opening the popover must not do that. */}
                    <td class="p-3" onClick={(e) => e.stopPropagation()}>
                      <div class="flex items-start gap-2">
                        <ClientStatusControl
                          clientId={pkOf(client)}
                          status={statusOf(client)}
                          latestChange={changeOf(client)}
                          showCaption
                          onChanged={(payload) =>
                            applyStatusChange(pkOf(client), payload)
                          }
                        />
                        {/* Derived activity + the mismatch flag. Read-only — it
                            follows the campaigns, there is nothing to set. */}
                        <CampaignActivityBadge
                          activity={client.campaign_activity}
                          engagement={statusOf(client)}
                          class="mt-[1px]"
                        />
                      </div>
                    </td>

                    {/* Value tier — its own column rather than crowded into the
                        Status cell: the suggestion hint needs a line of its own,
                        and three badges in one cell would undo the work of
                        keeping the labels distinguishable. Adjacent to
                        Engagement, which is what matters for reading them
                        together. Internal — hidden outright for other roles. */}
                    <Show when={canSeeValueTier()}>
                      <td class="p-3" onClick={(e) => e.stopPropagation()}>
                        <ValueTierControl
                          clientId={pkOf(client)}
                          tier={tierEntry(client).tier}
                          suggested={tierEntry(client).suggested}
                          monthFunds={tierEntry(client).monthFunds}
                          mismatch={tierEntry(client).mismatch}
                          showSuggestion
                          onChanged={(payload) =>
                            applyTierChange(
                              pkOf(client),
                              client.client_nomen,
                              payload,
                            )
                          }
                        />
                        <button
                          onClick={() =>
                            setTierHistoryFor({
                              id: pkOf(client),
                              label: client.client_nomen_name || client.email,
                            })
                          }
                          disabled={pkOf(client) == null}
                          class="mt-1 block text-[11px] font-semibold text-[#3E6FB0] hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          Tier history
                        </button>
                      </td>
                    </Show>

                    {/* Is Active */}
                    <td class="p-3 text-center">
                      {client.is_active ? (
                        <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600">
                          <svg
                            class="w-3.5 h-3.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        </span>
                      ) : (
                        <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-500">
                          <svg
                            class="w-3.5 h-3.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        </span>
                      )}
                    </td>

                    {/* Created at */}
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {fmt(client.created_at)}
                    </td>

                    {/* Status history */}
                    <td
                      class="p-3 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Show
                        when={pkOf(client) != null}
                        fallback={
                          <span class="text-gray-300 dark:text-gray-600">—</span>
                        }
                      >
                        <button
                          onClick={() =>
                            setHistoryFor({
                              id: pkOf(client),
                              label:
                                client.client_nomen_name || client.email,
                            })
                          }
                          class="text-xs font-semibold text-[#3E6FB0] hover:underline"
                        >
                          View
                        </button>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>

              {/* Empty state */}
              <Show when={filtered().length === 0}>
                <tr>
                  <td
                    colspan={
                      (isCampaignManager() ? 9 : 10) +
                      (canSeeValueTier() ? 1 : 0)
                    }
                    class="py-16 text-center text-gray-400 dark:text-gray-500"
                  >
                    <svg
                      class="w-10 h-10 mx-auto mb-3 opacity-30"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    No clients match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          {/* ── Footer: row count + selection ── */}
          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td
                colspan={
                  (isCampaignManager() ? 7 : 8) + (canSeeValueTier() ? 1 : 0)
                }
                class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400"
              >
                {paginated().length} client
                {paginated().length !== 1 ? "s" : ""} on this page
                {selected().size > 0 && ` · ${selected().size} selected`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        {/* On a phone the "Showing …" line wraps to two or three lines and was
            squeezing the rows-per-page pill next to it. Give the group the full
            width and push the pill to the right edge instead. */}
        <div class="flex items-center gap-3 max-sm:w-full max-sm:justify-between">
          <span class="text-sm text-gray-500 dark:text-gray-400">
            {filtered().length === 0
              ? "No results"
              : `Showing ${(currentPage() - 1) * pageSize() + 1}–${Math.min(
                  currentPage() * pageSize(),
                  filtered().length,
                )} of ${filtered().length} clients${
                  filtered().length === allClients().length
                    ? ""
                    : ` (filtered from ${allClients().length})`
                }`}
          </span>

          <RowsPerPageSelect value={pageSize()} onChange={changeRowsPerPage} />
        </div>

        {/* Spread Prev / page / Next across the row on a phone — bigger thumb
            targets than the left-huddled default the wrap produces. */}
        <div class="flex items-center gap-2 max-sm:w-full max-sm:justify-between">
          <button
            onClick={() => {
              if (hasPrev()) {
                setSelected(new Set()); // clear selection on page change
                setPage(currentPage() - 1);
              }
            }}
            disabled={!hasPrev() || loading()}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border
                   border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900
                   text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800
                   disabled:opacity-35 disabled:cursor-default transition-colors"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 16 16"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M10 12L6 8l4-4" />
            </svg>
            Prev
          </button>

          <span class="text-sm text-gray-500 dark:text-gray-400 px-1">
            Page {currentPage()} of {totalPages()}
          </span>

          <button
            onClick={() => {
              if (hasNext()) {
                setSelected(new Set()); // clear selection on page change
                setPage(currentPage() + 1);
              }
            }}
            disabled={!hasNext() || loading()}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg
                   bg-red-800 border border-red-800 text-white
                   hover:bg-red-700 disabled:opacity-35 disabled:cursor-default transition-colors"
          >
            Next
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 16 16"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>

      <ClientStatusHistoryDrawer
        open={!!historyFor()}
        clientId={historyFor()?.id}
        clientLabel={historyFor()?.label}
        onClose={() => setHistoryFor(null)}
      />

      {/* Separate drawer from the engagement one: different endpoint, different
          fields (from_tier/to_tier), and an optional reason. */}
      <ValueTierHistoryDrawer
        open={!!tierHistoryFor()}
        clientId={tierHistoryFor()?.id}
        clientLabel={tierHistoryFor()?.label}
        onClose={() => setTierHistoryFor(null)}
      />
    </div>
  );
}
