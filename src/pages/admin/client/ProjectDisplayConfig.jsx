import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import {
  fetchProjectDisplayConfig,
  createProjectDisplayConfig,
  updateProjectDisplayConfig,
  fetchClients,
  previewClientCpl, // ← NEW: CPL preview
  resolveConfigRule, // ← NEW: server-side rule resolution
  // ← CHANGED: removed fetchProjects, added this
} from "../services/projectDisplayConfig";
import Avatar from "../../../components/common/Avatar";
import RowsPerPageSelect from "../../../components/common/RowsPerPageSelect";
import DateTimePicker from "../../../components/DateTimePicker";
import { fetchProjectsByClient } from "../services/fetchProjectsByClient"; // ← NEW
import { fetchAllowedBudgetClients } from "../../../services/allowedBudget"; // ← CM-scoped client source
import { isAdmin, isTier1 } from "../../../stores/currentUser"; // ← validity-window gate
import SuccessToast, {
  showToast,
} from "../../../components/common/SuccessToast";

const TYPE_COLORS = {
  hybrid: "bg-blue-100 text-blue-800 ring-1 ring-blue-300",
  cpl: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
  retainer: "bg-sky-100 text-sky-700 ring-1 ring-sky-300",
};

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// ── Validity-window datetime helpers ──────────────────────────────────────────
// <input type="datetime-local"> works in local wall-clock with the value shape
// "YYYY-MM-DDTHH:mm" (no timezone). These convert between that and the ISO
// datetime the backend expects.
const pad2 = (n) => String(n).padStart(2, "0");

// Format a Date as a datetime-local input value in LOCAL time.
const dateToLocalInput = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
  `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// "now" as a datetime-local value — used to default valid_from on create.
const nowLocalInput = () => dateToLocalInput(new Date());

// ISO (possibly with offset/Z) → datetime-local value in the viewer's local
// wall-clock. Empty/invalid → "".
const isoToLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateToLocalInput(d);
};

// datetime-local value ("YYYY-MM-DDTHH:mm") → ISO string WITH the local UTC
// offset appended, e.g. "2026-07-07T14:30:00+05:30". Carrying the offset keeps
// the exact wall-clock the user picked regardless of how the backend interprets
// a naive datetime.
const localInputToIso = (val) => {
  if (!val) return null;
  const d = new Date(val); // parsed as local time
  if (Number.isNaN(d.getTime())) return null;
  const offMin = -d.getTimezoneOffset(); // e.g. +330 for IST
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  return `${val}:00${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
};

// Caller's role, read from the same auth blob the route guards use. CMs can't
// read the admin all-clients endpoint (403), so the client picker is sourced
// from the CM-scoped allowed-budget list instead (same client-account id the
// config endpoints expect). Admins keep the admin endpoint.
const authRole = (() => {
  try {
    return JSON.parse(localStorage.getItem("auth") || "{}")?.role ?? null;
  } catch {
    return null;
  }
})();
const isCampaignManager = () => authRole === "campaign_manager";

export default function ProjectDisplayConfig() {
  const [configs, setConfigs] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [search, setSearch] = createSignal("");
  const [typeFilter, setTypeFilter] = createSignal("all");
  const [activeFilter, setActiveFilter] = createSignal("All");
  const [sortKey, setSortKey] = createSignal("id");
  const [sortDir, setSortDir] = createSignal("desc");
  const [sidebarMounted, setSidebarMounted] = createSignal(false);
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  // Save-time error (e.g. a scoped-out CM hitting a 403 with
  // "This client is not in your scope."). Rendered as a red box in the modal.
  const [submitError, setSubmitError] = createSignal("");
  const [clients, setClients] = createSignal([]);
  const [projects, setProjects] = createSignal([]);
  const [projectsLoading, setProjectsLoading] = createSignal(false); // ← NEW
  const [projectSearch, setProjectSearch] = createSignal("");
  const [showProjectDropdown, setShowProjectDropdown] = createSignal(false);
  const [formData, setFormData] = createSignal({
    client_id: "",
    project_id: "",
    rule_type: "cpl_markup_pct",
    rule_value: "",
    notes: "",
    // Optional validity window — only admins + Tier-1 CMs may set these
    // (see canSetValidity). Blank valid_from → backend auto-stamps "now,
    // open-ended"; blank valid_to → open-ended from valid_from onward.
    valid_from: "",
    valid_to: "",
  });
  const [clientSearch, setClientSearch] = createSignal("");
  const [showClientDropdown, setShowClientDropdown] = createSignal(false);
  const [editingConfig, setEditingConfig] = createSignal(null);
  // Where the auto-filled Rule Type came from:
  //   "existing" | "inherited_from_client" | "default_by_client_type" | null
  const [ruleSource, setRuleSource] = createSignal(null);
  // Resolved client_type ("cpl" | "hybrid" | "retainer" | null) — gates whether
  // Rule Type is a fixed read-only value (cpl), an editable dropdown (hybrid),
  // or N/A (retainer). Rule Value unit ("percent" | "amount" | null) labels the
  // value field. Both come from the server /resolve/ call.
  const [resolvedClientType, setResolvedClientType] = createSignal(null);
  const [resolvedUnit, setResolvedUnit] = createSignal(null);
  const [ruleResolving, setRuleResolving] = createSignal(false);

  const RULE_TYPE_OPTIONS = [
    { value: "cpl_markup_pct", label: "cpl_markup_pct (% markup)" },
    { value: "cpl_markup_flat", label: "cpl_markup_flat (₹ flat markup)" },
    { value: "target_cpl", label: "target_cpl (flat ₹, ignores raw)" },
    { value: "fixed_cpl", label: "fixed_cpl (fixed ₹, ignores raw)" },
  ];
  const ruleTypeLabel = (value) =>
    RULE_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value ?? "—";
  const ALL_RULE_TYPES = RULE_TYPE_OPTIONS.map((o) => o.value);

  // Which rule types actually BILL, per client type.
  //   • cpl — the CPL billing path reads fixed_cpl ONLY. A CPL client given
  //     target_cpl / cpl_markup_pct / cpl_markup_flat bills ₹0 and lands in the
  //     missing-rate list, which reads as "no rate set" rather than "wrong rate
  //     type set". One live row violates this (config 313,
  //     RishabhYadavHomeVisionContinuous, target_cpl, project 341) and is being
  //     corrected separately — this gate is against future rows.
  //   • hybrid — all four are real; pct is what the team uses (412 of 502
  //     hybrid configs are pct, 88 target, 2 flat), so it stays the default.
  //   • retainer — flat-fee passthrough, deliberately no display config at all.
  const ALLOWED_RULE_TYPES = {
    cpl: ["fixed_cpl"],
    hybrid: ALL_RULE_TYPES,
    retainer: [],
  };

  // Unit is a property of the rule type, not of the client.
  const unitForRuleType = (rt) => (rt === "cpl_markup_pct" ? "percent" : "amount");
  const defaultRuleTypeFor = (clientType) =>
    clientType === "cpl" ? "fixed_cpl" : "cpl_markup_pct";

  // Retainer clients bill on raw passthrough — no per-lead display rule applies,
  // and the backend rejects a config for them. Used to disable the rule section
  // and block the save.
  const isRetainer = createMemo(() => resolvedClientType() === "retainer");

  // An UNRESOLVED client type restricts nothing — all four stay on offer rather
  // than guessing a restriction from a type we could not read.
  const allowedRuleTypes = createMemo(() => {
    const t = resolvedClientType();
    return t && ALLOWED_RULE_TYPES[t] ? ALLOWED_RULE_TYPES[t] : ALL_RULE_TYPES;
  });

  // An existing config whose rule type its client type does not permit — e.g.
  // config 313's target_cpl on a CPL client. It stays viewable and editable and
  // is never rewritten behind the user's back; it is flagged instead, so a wrong
  // type reads as wrong rather than as missing.
  const ruleTypeFlagged = createMemo(() => {
    const rt = formData().rule_type;
    return (
      !!rt && !isRetainer() && !!resolvedClientType() && !allowedRuleTypes().includes(rt)
    );
  });

  // Options actually offered: what the client type permits, plus the current
  // value when it is a flagged leftover (so the field can display it, and can
  // be switched off it).
  const ruleTypeChoices = createMemo(() => {
    const allowed = allowedRuleTypes();
    const current = formData().rule_type;
    const values =
      current && !allowed.includes(current) ? [...allowed, current] : allowed;
    return RULE_TYPE_OPTIONS.filter((o) => values.includes(o.value));
  });

  // Exactly one permitted type and nothing flagged → there is no choice to make,
  // so the type renders as a fixed label with the amount beside it.
  const ruleTypeIsFixed = createMemo(
    () => !isRetainer() && ruleTypeChoices().length === 1,
  );

  // Only admins and Tier-1 CMs may pick a custom validity window. Tier-2 CMs
  // keep the existing behavior (no date fields → backend auto-stamps "starts
  // now, open-ended"). The backend also 403s a Tier-2 that sends dates.
  const canSetValidity = createMemo(() => isAdmin() || isTier1());

  // ── NEW: CPL preview state ──────────────────────────────────────────────
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewData, setPreviewData] = createSignal(null);
  const [previewError, setPreviewError] = createSignal("");

  const isEditMode = createMemo(() => editingConfig() !== null);

  // Preview is allowed only once client + project + a non-empty rule value are set.
  const canPreview = createMemo(
    () =>
      !!formData().client_id &&
      !!formData().project_id &&
      String(formData().rule_value ?? "").trim() !== "",
  );

  // Stale preview is cleared whenever any input that affects it changes.
  const clearPreview = () => {
    setPreviewData(null);
    setPreviewError("");
  };

  // ₹ formatter for the string money fields (display only — no math).
  const formatMoney = (val) => {
    const n = parseFloat(val);
    if (val == null || Number.isNaN(n)) return "—";
    return `₹${n.toFixed(2)}`;
  };

  const handlePreviewCpl = async () => {
    if (!canPreview()) return;
    setPreviewError("");
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      const res = await previewClientCpl({
        clientId: formData().client_id,
        projectId: formData().project_id,
        ruleType: formData().rule_type,
        ruleValue: formData().rule_value,
      });

      if (!res || res.success === false) {
        setPreviewError(res?.message || "Failed to compute CPL preview.");
      } else {
        setPreviewData(res.data ?? null);
      }
    } catch (err) {
      setPreviewError(err?.message || "Failed to compute CPL preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  // Pagination is client-side (every config is already loaded), so a rows-per-page
  // change only re-slices.
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(
    Number(localStorage.getItem("projectDisplayConfigRowsPerPage")) || 20,
  );

  const changePageSize = (size) => {
    setPageSize(size);
    localStorage.setItem("projectDisplayConfigRowsPerPage", String(size));
    setPage(1); // the old page number can be past the end once rows grow
  };

  // ── CHANGED: removed fetchProjects() — projects are loaded on demand ──────
  onMount(async () => {
    try {
      const cm = isCampaignManager();
      const [configRes, clientRes] = await Promise.all([
        fetchProjectDisplayConfig(),
        // CMs 403 on the admin all-clients endpoint — source their own clients
        // from the CM-scoped allowed-budget list instead.
        cm ? fetchAllowedBudgetClients() : fetchClients(1, 500),
      ]);

      setConfigs(configRes.data ?? []);

      if (cm) {
        // Allowed-budget rows carry the config-compatible client_id + a display
        // name. Normalise onto the { id, email } shape the picker reads (it
        // displays/searches on `email`; the client name stands in for it).
        const rows = Array.isArray(clientRes?.data) ? clientRes.data : [];
        setClients(
          rows
            .filter((c) => c.client_id != null)
            .map((c) => ({
              id: c.client_id,
              email: c.name ?? `Client #${c.client_id}`,
            })),
        );
      } else {
        setClients(
          Array.isArray(clientRes?.data?.results)
            ? clientRes.data.results
            : clientRes.data || [],
        );
      }
    } catch (err) {
      console.error("Failed to load configs:", err);
    } finally {
      setLoading(false);
    }
  });

  // ── NEW: fetch projects for a given clientId via AJAX ─────────────────────
  const loadProjectsForClient = async (clientId) => {
    setProjects([]);
    setProjectSearch("");
    setShowProjectDropdown(false);
    // Reset the pair-derived fields — a new client means no project chosen yet.
    setFormData((prev) => ({
      ...prev,
      project_id: "",
      rule_type: "cpl_markup_pct",
      rule_value: "",
    }));
    setRuleSource(null);
    setResolvedClientType(null);
    setResolvedUnit(null);
    clearPreview();
    setProjectsLoading(true);

    try {
      const clientProjects = await fetchProjectsByClient(clientId);
      setProjects(clientProjects);
    } catch (err) {
      console.error("Failed to load projects for client:", err);
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  // ── Resolve Rule Type (+ Rule Value) for a client+project pair ────────────
  // The backend /resolve/ endpoint owns the whole resolution (existing →
  // inherited → default, gated by client_type) so it's correct even when the
  // config list paginates and for brand-new clients. Populates the form fields
  // and the client_type/unit signals that drive the Rule Type control.
  const resolveRuleForPair = async (clientId, projectId) => {
    setRuleResolving(true);
    try {
      const resolved = await resolveConfigRule(clientId, projectId);
      if (!resolved) return;

      const clientType = resolved.client_type ?? null;
      const allowed =
        (clientType && ALLOWED_RULE_TYPES[clientType]) || ALL_RULE_TYPES;

      // The pre-filled type. Two ways it can end up not being what the server
      // handed back:
      //   • nothing resolved → fall back to this client type's default
      //     (cpl → fixed_cpl, hybrid → cpl_markup_pct).
      //   • an INHERITED or DEFAULT type the client type doesn't permit → use
      //     the default instead of seeding a new config with a rule that bills
      //     ₹0. An "existing" type is left exactly as saved and flagged in the
      //     form instead — an existing row is never silently rewritten.
      let ruleType = resolved.rule_type ?? "";
      if (!ruleType) {
        ruleType = clientType === "retainer" ? "" : defaultRuleTypeFor(clientType);
      } else if (resolved.source !== "existing" && !allowed.includes(ruleType)) {
        ruleType = defaultRuleTypeFor(clientType);
      }

      setFormData((prev) => ({
        ...prev,
        project_id: projectId,
        rule_type: ruleType,
        // Value is only pre-filled for an existing exact-pair config; inherited
        // and default sources leave it blank for a fresh entry.
        rule_value:
          resolved.source === "existing"
            ? String(resolved.rule_value ?? "")
            : "",
      }));
      setRuleSource(resolved.source ?? null);
      setResolvedClientType(clientType);
      // Unit follows the type we actually pre-filled, not the one the server
      // described — they differ whenever the type above was substituted.
      setResolvedUnit(
        ruleType
          ? unitForRuleType(ruleType)
          : (resolved.rule_value_unit ?? null),
      );
    } catch (err) {
      console.error("Failed to resolve config rule:", err);
    } finally {
      setRuleResolving(false);
    }
  };

  const toggleSort = (key) => {
    if (sortKey() === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
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

  const filtered = createMemo(() => {
    let data = [...configs()];
    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter(
        (c) =>
          c.client_email?.toLowerCase().includes(q) ||
          c.project_name?.toLowerCase().includes(q),
      );
    }
    if (typeFilter() !== "all") {
      data = data.filter((c) => c.client_type === typeFilter());
    }
    if (activeFilter() === "Yes") data = data.filter((c) => c.is_active);
    if (activeFilter() === "No") data = data.filter((c) => !c.is_active);

    data.sort((a, b) => {
      let va = a[sortKey()];
      let vb = b[sortKey()];
      if (sortKey() === "valid_from") {
        va = new Date(va);
        vb = new Date(vb);
      } else if (sortKey() === "rule_value") {
        va = parseFloat(va ?? 0);
        vb = parseFloat(vb ?? 0);
      } else if (["id", "client_id", "project_id"].includes(sortKey())) {
        va = Number(va ?? 0);
        vb = Number(vb ?? 0);
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

  const paginated = createMemo(() => {
    const start = (page() - 1) * pageSize();
    return filtered().slice(start, start + pageSize());
  });

  const totalPages = createMemo(() =>
    Math.max(1, Math.ceil(filtered().length / pageSize())),
  );

  const filteredClients = createMemo(() => {
    const query = clientSearch().trim().toLowerCase();
    if (!query) return clients();
    return clients().filter((c) => c.email?.toLowerCase().includes(query));
  });

  const filteredProjects = createMemo(() => {
    const query = projectSearch().trim().toLowerCase();
    if (!query) return projects();
    return projects().filter((p) => p.name?.toLowerCase().includes(query));
  });

  const applyFilter = (setter, value) => {
    setter(value);
    setPage(1);
  };

  const openSidebar = () => {
    setShowClientDropdown(false);
    setShowProjectDropdown(false);
    // Privileged users get valid_from defaulted to now (required, but editable
    // incl. past). Tier-2 CMs never see the fields, so leave theirs blank.
    if (canSetValidity()) {
      setFormData((prev) => ({
        ...prev,
        valid_from: nowLocalInput(),
        valid_to: "",
      }));
    }
    setSidebarMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSidebarVisible(true));
    });
  };

  // ── CHANGED: async, pre-loads projects for the client being edited ────────
  const handleEdit = async (cfg) => {
    setEditingConfig(cfg);
    setFormData({
      client_id: cfg.client_id,
      project_id: cfg.project_id,
      rule_type: cfg.rule_type,
      rule_value: cfg.rule_value,
      notes: cfg.notes ?? "",
      // Pre-fill the existing window as local datetime-local values. valid_to
      // may be null (open-ended) → "".
      valid_from: isoToLocalInput(cfg.valid_from),
      valid_to: isoToLocalInput(cfg.valid_to),
    });
    setClientSearch(cfg.client_email);
    setProjectSearch(cfg.project_name ?? "");
    setRuleSource("existing");
    setResolvedClientType(cfg.client_type ?? null);
    // The list row doesn't carry a unit — derive it from the rule type. The
    // type itself is loaded exactly as saved, even when this client type no
    // longer permits it (config 313): the form flags it rather than rewriting.
    setResolvedUnit(unitForRuleType(cfg.rule_type));

    // Pre-load the projects for this client so the dropdown works immediately
    setProjectsLoading(true);
    try {
      const clientProjects = await fetchProjectsByClient(cfg.client_id);
      setProjects(clientProjects);
    } catch (err) {
      console.error("Failed to load projects on edit:", err);
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }

    setSidebarMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSidebarVisible(true));
    });
  };

  // ── CHANGED: also resets projects and loading state ───────────────────────
  const closeSidebar = () => {
    setSidebarVisible(false);
    setClientSearch("");
    setProjectSearch("");
    setProjects([]); // ← NEW
    setProjectsLoading(false); // ← NEW
    setShowProjectDropdown(false);
    setShowClientDropdown(false);
    setEditingConfig(null);
    setRuleSource(null);
    setResolvedClientType(null);
    setResolvedUnit(null);
    clearPreview(); // ← NEW: drop any stale CPL preview
    setPreviewLoading(false);
    setSubmitError(""); // drop any stale save error

    setTimeout(() => {
      setSidebarMounted(false);
      setFormData({
        client_id: "",
        project_id: "",
        rule_type: "cpl_markup_pct",
        rule_value: "",
        notes: "",
        valid_from: "",
        valid_to: "",
      });
    }, 300);
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Any change to a preview input invalidates the current preview table.
    if (["client_id", "project_id", "rule_type", "rule_value"].includes(field)) {
      clearPreview();
    }
    // Editing the form clears a prior save error — the user is retrying.
    if (submitError()) setSubmitError("");
  };

  const handleSubmitConfig = async () => {
    // Retainer clients bill on raw passthrough — the backend rejects a config
    // for them (422), so don't attempt a save.
    if (isRetainer()) {
      showToast(
        "Retainer clients use raw passthrough — no display config to save.",
        "Not applicable",
      );
      return;
    }
    // Validity-window rules (privileged users only). Match the backend so we
    // fail fast in the UI instead of surfacing a 422/403.
    if (canSetValidity()) {
      const vf = formData().valid_from;
      const vt = formData().valid_to;
      // valid_from is required for admin/Tier-1 — block submit without it.
      if (!vf) {
        setSubmitError("Start date/time (valid from) is required.");
        return;
      }
      // If both are set, valid_from must be strictly before valid_to. String
      // compare is safe — both are fixed-width "YYYY-MM-DDTHH:mm".
      if (vt && vf >= vt) {
        setSubmitError("Start date/time must be before the end date/time.");
        return;
      }
    }
    try {
      setSubmitting(true);
      setSubmitError("");
      const payload = {
        client_id: Number(formData().client_id),
        project_id: Number(formData().project_id),
        rule_type: formData().rule_type,
        rule_value: formData().rule_value,
        notes: formData().notes,
      };

      // Attach the validity window for privileged users. valid_from is required
      // (validated above) and sent as an ISO datetime carrying the local offset
      // so the exact time chosen is preserved. valid_to is optional; omit it →
      // open-ended. Tier-2 CMs send no dates → backend auto-stamps.
      if (canSetValidity()) {
        payload.valid_from = localInputToIso(formData().valid_from);
        if (formData().valid_to)
          payload.valid_to = localInputToIso(formData().valid_to);
      }

      // Capture for the toast before the sidebar reset wipes them. Show the
      // value with the correct unit (₹ for amount rules, % for markup pct).
      const ruleValue = formData().rule_value;
      const ruleValueLabel =
        resolvedUnit() === "amount" ? `₹${ruleValue}` : `${ruleValue}%`;
      const projectName =
        projects().find((p) => p.id === Number(formData().project_id))?.name ||
        projectSearch();
      const wasEdit = isEditMode();

      if (wasEdit) {
        await updateProjectDisplayConfig(editingConfig().id, payload);
      } else {
        await createProjectDisplayConfig(payload);
      }

      const res = await fetchProjectDisplayConfig();
      setConfigs(res.data ?? []);
      closeSidebar();

      showToast(
        wasEdit
          ? `Successfully updated "${ruleValueLabel}" configuration for the "${projectName}" project.`
          : `Successfully added "${ruleValueLabel}" configuration to the "${projectName}" project.`,
        "Configuration saved",
      );
    } catch (err) {
      console.error("Failed to save config:", err);
      // Surface the backend message (e.g. a CM's out-of-scope 403) instead of
      // failing silently. Falls back to a generic line if none was provided.
      setSubmitError(
        err?.message || "Failed to save configuration. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-3 lg:p-8">
      {/* Page Header */}
      <div class="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div class="mb-6">
          {/* Same heading treatment as the dashboard: crimson→gold tile with
              this section's sidebar glyph, gradient wordmark, description
              indented by tile (36px) + gap (10px). */}
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
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Project Display Configs
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {configs().length} total · billing rules per project
          </p>
        </div>
        <button
          onClick={openSidebar}
          class="mb-6 px-4 py-2 text-sm rounded-md bg-blue-900 text-white hover:bg-blue-800 transition-colors shadow-sm"
        >
          + Add Project Config
        </button>
       
      </div>
      {/* Filters Bar */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-[500px]">
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
            placeholder="Search by email or project name…"
            value={search()}
            onInput={(e) => applyFilter(setSearch, e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>
        <select
          value={typeFilter()}
          onChange={(e) => applyFilter(setTypeFilter, e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="all">All Types</option>
          <option value="hybrid">Hybrid</option>
          <option value="cpl">CPL</option>
          <option value="retainer">Retainer</option>
        </select>
        <select
          value={activeFilter()}
          onChange={(e) => applyFilter(setActiveFilter, e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="All">All Status</option>
          <option value="Yes">Active</option>
          <option value="No">Inactive</option>
        </select>
        <button
          onClick={() => {
            setSearch("");
            setTypeFilter("all");
            setActiveFilter("All");
            setSortKey("id");
            setSortDir("desc");
            setPage(1);
          }}
          class="px-3 py-2 text-sm rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:border-red-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 transition-colors"
        >
          Clear All
        </button>
        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {filtered().length} result{filtered().length !== 1 ? "s" : ""}
        </span>
      </div>
      {/* Table — unchanged from original */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          {/* Table Head */}
          <thead>
            <tr
              class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60
                       text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider"
            >
              <th class="p-3 text-center whitespace-nowrap w-12">S.No</th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("id")}
              >
                ID {sortIcon("id")}
              </th>
              <th
                class="hidden p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("client_id")}
              >
                Client ID {sortIcon("client_id")}
              </th>
              <th
                class="hidden p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("project_id")}
              >
                Project ID {sortIcon("project_id")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("client_email")}
              >
                Client {sortIcon("client_email")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("client_type")}
              >
                Type {sortIcon("client_type")}
              </th>
              <th
                class="hidden p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("rule_type")}
              >
                Rule Type {sortIcon("rule_type")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("project_name")}
              >
                Project {sortIcon("project_name")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("rule_value")}
              >
                Markup {sortIcon("rule_value")}
              </th>
              <th class="p-3 text-center whitespace-nowrap">Status</th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("valid_from")}
              >
                Effective From {sortIcon("valid_from")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("created_by_email")}
              >
                Created By {sortIcon("created_by_email")}
              </th>
              <th class="p-3 text-center whitespace-nowrap">Action</th>
            </tr>
          </thead>

          {/* Loading Skeleton */}
          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <td class="p-3 text-center">
                        <div class="h-3 w-6 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-44 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={paginated()}>
                {(cfg, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                               hover:bg-purple-50/60 transition-colors
                               ${
                                 i() % 2 === 0
                                   ? "bg-white dark:bg-gray-900"
                                   : "bg-gray-50/60 dark:bg-gray-800/30"
                               }`}
                  >
                    <td class="p-3 text-center text-gray-500 dark:text-gray-400 tabular-nums">
                      {(page() - 1) * pageSize() + i() + 1}
                    </td>
                    {/* Client — maps to client_email */}
                    <td class="p-3 text-purple-700 dark:text-gray-300 font-medium">
                      {cfg.id}
                    </td>
                    <td class="hidden p-3 text-purple-700 dark:text-gray-300 font-medium">
                      {cfg.client_id}
                    </td>
                    <td class="hidden p-3 text-purple-700 dark:text-gray-300 font-medium">
                      {cfg.project_id}
                    </td>
                    {/* Client — maps to client_email */}
                    <td class="p-3">
                      <div class="flex items-center gap-2">
                        <Avatar name={cfg.client_email} />
                        <span class="text-purple-700 dark:text-gray-300 font-medium">
                          {cfg.client_email}
                        </span>
                      </div>
                    </td>

                    {/* Type — maps to client_type */}
                    <td class="p-3 text-center">
                      <span
                        class={`px-2.5 py-0.5 rounded-full text-xs font-semibold
                                    ${TYPE_COLORS[cfg.client_type] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {String(cfg.client_type ?? "").toUpperCase()}
                      </span>
                    </td>

                    {/* Project — maps to project_name */}
                    <td class="hidden p-3 text-gray-700 dark:text-gray-300 font-medium">
                      {cfg.rule_type}
                    </td>

                    {/* Project — maps to project_name */}
                    <td class="p-3 text-gray-700 dark:text-gray-300 font-medium">
                      {cfg.project_name}
                    </td>

                    {/* Markup — maps to rule_value. Unit depends on rule_type:
                        only cpl_markup_pct is a percentage; fixed_cpl,
                        cpl_markup_flat and target_cpl are rupee amounts. */}
                    <td class="p-3 text-center text-blue-800 dark:text-blue-400 font-semibold">
                      {cfg.rule_type === "cpl_markup_pct"
                        ? `+${parseFloat(cfg.rule_value ?? 0).toFixed(2)}%`
                        : `₹${parseFloat(cfg.rule_value ?? 0).toFixed(2)}`}
                    </td>

                    {/* Status — maps to is_active */}
                    <td class="p-3 text-center">
                      {cfg.is_active ? (
                        <span
                          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                     bg-green-100 text-green-700 text-xs font-semibold"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          Active
                        </span>
                      ) : (
                        <span
                          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                     bg-red-100 text-red-600 text-xs font-semibold"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                          Inactive
                        </span>
                      )}
                    </td>

                    {/* Effective From — maps to valid_from */}
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(cfg.valid_from)}
                    </td>

                    {/* Created By — maps to created_by_email */}
                    <td class="p-3 text-gray-500 dark:text-gray-400 text-sm">
                      {cfg.created_by_email}
                    </td>
                    <td class="p-3 text-center">
                      {/* Edit */}
                      <button
                        onClick={() => handleEdit(cfg)}
                        class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white hover:bg-amber-100 border border-amber-400 hover:border-amber-300 hover:text-amber-600 transition-all duration-150 shadow-sm hover:shadow"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="w-4 h-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                )}
              </For>

              {/* Empty State */}
              <Show when={filtered().length === 0}>
                <tr>
                  <td
                    colspan="8"
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
                        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    No configs match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          {/* Table Footer */}
          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td
                colspan="8"
                class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400"
              >
                {filtered().length} config{filtered().length !== 1 ? "s" : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {/* Pagination */}
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-500 dark:text-gray-400">
            {filtered().length === 0
              ? "No results"
              : `Showing ${(page() - 1) * pageSize() + 1}–${Math.min(page() * pageSize(), filtered().length)} of ${filtered().length} configs`}
          </span>

          <RowsPerPageSelect value={pageSize()} onChange={changePageSize} />
        </div>

        <div class="flex items-center gap-2">
          <button
            onClick={() => {
              setPage((p) => p - 1);
            }}
            disabled={page() <= 1 || loading()}
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
            Page {page()} of {totalPages()}
          </span>

          <button
            onClick={() => {
              setPage((p) => p + 1);
            }}
            disabled={page() >= totalPages() || loading()}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-md
                   bg-blue-900 border border-blue-900 text-white
                   hover:bg-blue-800 disabled:opacity-35 disabled:cursor-default transition-colors"
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
      {/* ───────────────── Sidebar Modal ───────────────── */}
      <Show when={sidebarMounted()}>
        <div class="fixed inset-0 z-50 flex">
          <div
            onClick={closeSidebar}
            class="fixed inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-300"
            style={{ opacity: sidebarVisible() ? "1" : "0" }}
          />
          <div
            class="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out"
            style={{
              transform: sidebarVisible()
                ? "translateX(0)"
                : "translateX(100%)",
            }}
          >
            {/* Header */}
            <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <div>
                <h2 class="text-lg font-bold text-gray-800 dark:text-white">
                  {isEditMode() ? "Edit Project Config" : "Add Project Config"}
                </h2>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {isEditMode()
                    ? "Update existing billing rule"
                    : "Create new billing rule"}
                </p>
              </div>
              <button
                onClick={closeSidebar}
                class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* ── Client dropdown ── */}
              <div>
                <label class="block text-sm font-medium mb-1.5">
                  Client Name
                </label>
                <div class="relative">
                  <input
                    type="text"
                    value={clientSearch()}
                    placeholder="Search client…"
                    onFocus={() => setShowClientDropdown(true)}
                    onInput={(e) => {
                      setClientSearch(e.target.value);
                      setShowClientDropdown(true);
                    }}
                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                  <Show when={showClientDropdown()}>
                    <div class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                      <Show
                        when={filteredClients().length > 0}
                        fallback={
                          <div class="px-3 py-2 text-sm text-gray-500">
                            No client found
                          </div>
                        }
                      >
                        <For each={filteredClients()}>
                          {(client) => (
                            <button
                              type="button"
                              // ── CHANGED: triggers AJAX project load ──────
                              onClick={() => {
                                handleInputChange("client_id", client.id);
                                setClientSearch(client.email);
                                setShowClientDropdown(false);
                                loadProjectsForClient(client.id); // ← NEW
                              }}
                              class="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-gray-800 transition-colors"
                            >
                              {client.email}
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>

              {/* ── Project dropdown — CHANGED entirely ── */}
              <div>
                <label class="block text-sm font-medium mb-1.5">
                  Project Name
                  {/* Live status hint next to label */}
                  <Show when={projectsLoading()}>
                    <span class="ml-2 text-xs text-purple-500 font-normal animate-pulse">
                      Loading…
                    </span>
                  </Show>
                  <Show
                    when={
                      !projectsLoading() &&
                      formData().client_id &&
                      projects().length > 0
                    }
                  >
                    <span class="ml-2 text-xs text-gray-400 font-normal">
                      {projects().length} project
                      {projects().length !== 1 ? "s" : ""} found
                    </span>
                  </Show>
                </label>

                <div class="relative">
                  <input
                    type="text"
                    value={projectSearch()}
                    // ── Placeholder communicates current state clearly ──
                    placeholder={
                      !formData().client_id
                        ? "Select a client first…"
                        : projectsLoading()
                          ? "Loading projects…"
                          : projects().length === 0
                            ? "No projects for this client"
                            : "Search project…"
                    }
                    // ── Disabled until a client is chosen and projects have loaded ──
                    disabled={!formData().client_id || projectsLoading()}
                    onClick={() => {
                      if (
                        formData().client_id &&
                        !projectsLoading() &&
                        projects().length > 0
                      ) {
                        setShowProjectDropdown(true);
                      }
                    }}
                    onInput={(e) => {
                      setProjectSearch(e.target.value);
                      setShowProjectDropdown(true);
                    }}
                    class={`w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600
                      bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none
                      transition-opacity
                      ${
                        !formData().client_id || projectsLoading()
                          ? "opacity-50 cursor-not-allowed"
                          : ""
                      }`}
                  />

                  {/* Spinner inside the input when loading */}
                  <Show when={projectsLoading()}>
                    <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg
                        class="w-4 h-4 text-purple-500 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        />
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v8H4z"
                        />
                      </svg>
                    </div>
                  </Show>

                  {/* Dropdown list */}
                  <Show when={showProjectDropdown() && !projectsLoading()}>
                    <div class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                      <Show
                        when={filteredProjects().length > 0}
                        fallback={
                          <div class="px-3 py-2 text-sm text-gray-500">
                            No project found
                          </div>
                        }
                      >
                        <For each={filteredProjects()}>
                          {(project) => (
                            <button
                              type="button"
                              onClick={async () => {
                                setProjectSearch(project.name);
                                setShowProjectDropdown(false);
                                clearPreview();
                                // Ask the server what rule to pre-fill for this
                                // client+project pair (sets form + client_type).
                                await resolveRuleForPair(
                                  formData().client_id,
                                  project.id,
                                );
                              }}
                              class="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-gray-800 transition-colors"
                            >
                              {project.name}
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>

              {/* Rule Type + Rule Value. A CPL client has exactly one billable
                  type, so the type becomes a fixed label with the amount field
                  beside it — nothing to get wrong. Every other case keeps the
                  stacked layout. */}
              <div
                class={
                  ruleTypeIsFixed()
                    ? "grid grid-cols-2 gap-4 items-start"
                    : "space-y-5"
                }
              >
                <div>
                  <label class="block text-sm font-medium mb-1.5">
                    Rule Type
                    <Show when={ruleResolving()}>
                      <span class="ml-2 text-xs text-purple-500 font-normal animate-pulse">
                        Resolving…
                      </span>
                    </Show>
                  </label>

                  {/* Retainer → no rule on offer at all. One permitted type →
                      a fixed label. Otherwise the dropdown, carrying only the
                      types this client type actually bills on (plus a flagged
                      leftover, so it stays selectable and correctable). */}
                  <Show
                    when={!isRetainer() && !ruleTypeIsFixed()}
                    fallback={
                      <input
                        type="text"
                        value={
                          isRetainer()
                            ? "N/A — retainer (raw passthrough)"
                            : ruleTypeLabel(formData().rule_type)
                        }
                        readonly
                        class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-not-allowed outline-none"
                      />
                    }
                  >
                    <select
                      value={formData().rule_type}
                      onChange={(e) => {
                        handleInputChange("rule_type", e.target.value);
                        setResolvedUnit(unitForRuleType(e.target.value));
                      }}
                      class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                    >
                      <For each={ruleTypeChoices()}>
                        {(opt) => <option value={opt.value}>{opt.label}</option>}
                      </For>
                    </select>
                  </Show>

                  <Show when={isRetainer()}>
                    <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Retainer clients are flat-fee passthrough — they have no
                      display config, so there is no rule to set.
                    </p>
                  </Show>
                  {/* The wrong-type warning. Saved as-is; the form never swaps it
                      out from under the user. */}
                  <Show when={ruleTypeFlagged()}>
                    <p class="mt-1 text-xs text-red-600 dark:text-red-400">
                      Flagged: {resolvedClientType()} clients bill on{" "}
                      {allowedRuleTypes().join(" / ") || "no rule type"} only, so{" "}
                      {formData().rule_type} bills ₹0 and shows up as a missing
                      rate. Left exactly as saved — change it here to fix it.
                    </p>
                  </Show>
                  <Show when={ruleTypeIsFixed()}>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {resolvedClientType()?.toUpperCase()} clients bill on{" "}
                      {formData().rule_type} only.
                    </p>
                  </Show>
                  <Show when={!isRetainer() && ruleSource() === "existing"}>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      From this project's existing configuration.
                    </p>
                  </Show>
                  <Show when={!isRetainer() && ruleSource() === "inherited_from_client"}>
                    <p class="mt-1 text-xs text-blue-600 dark:text-blue-400">
                      New project — inherited from this client's other projects.
                    </p>
                  </Show>
                  <Show when={!isRetainer() && ruleSource() === "default_by_client_type"}>
                    <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      No existing rule for this client — using the default for this
                      client type.
                    </p>
                  </Show>
                </div>

                {/* Rule Value — unit-aware label; disabled for retainer */}
                <div>
                  <label class="block text-sm font-medium mb-1.5">
                    Rule Value
                    <Show when={resolvedUnit() === "percent"}>
                      <span class="text-gray-400 font-normal"> (%)</span>
                    </Show>
                    <Show when={resolvedUnit() === "amount"}>
                      <span class="text-gray-400 font-normal"> (₹)</span>
                    </Show>
                  </label>
                  <input
                    type="number"
                    value={formData().rule_value}
                    disabled={isRetainer()}
                    onInput={(e) =>
                      handleInputChange("rule_value", e.target.value)
                    }
                    placeholder={
                      isRetainer()
                        ? "Not applicable for retainer"
                        : resolvedUnit() === "amount"
                          ? "Enter amount (₹)"
                          : "Enter markup %"
                    }
                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* ── NEW: Preview client CPL ── */}
              <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-4 space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      Preview client CPL
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      See what the client would pay across recent time windows
                      before saving.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePreviewCpl}
                    disabled={!canPreview() || previewLoading()}
                    class="shrink-0 px-3 py-2 text-sm rounded-lg bg-blue-900 text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {previewLoading() ? "Previewing…" : "Preview client CPL"}
                  </button>
                </div>

                {/* Error state */}
                <Show when={previewError()}>
                  <div class="rounded-md border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                    {previewError()}
                  </div>
                </Show>

                {/* Results */}
                <Show when={previewData()}>
                  {/* rule_used caption */}
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    Rule applied:{" "}
                    <span class="font-medium text-gray-700 dark:text-gray-300">
                      {previewData().rule_used}
                    </span>
                  </p>

                  <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table class="min-w-full text-sm">
                      <thead>
                        <tr class="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                          <th class="p-2.5 text-left">Window</th>
                          <th class="p-2.5 text-right">Raw CPL</th>
                          <th class="p-2.5 text-right">Client sees</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={previewData().windows ?? []}>
                          {(w) => (
                            <tr class="border-t border-gray-100 dark:border-gray-800">
                              <td class="p-2.5 text-gray-700 dark:text-gray-300">
                                {w.label}
                                <Show when={w.has_data}>
                                  <span class="block text-xs text-gray-400">
                                    {w.raw_leads} lead
                                    {Number(w.raw_leads) !== 1 ? "s" : ""}
                                  </span>
                                </Show>
                              </td>
                              <Show
                                when={w.has_data}
                                fallback={
                                  <td
                                    colspan="2"
                                    class="p-2.5 text-center text-gray-400 italic"
                                  >
                                    — no leads —
                                  </td>
                                }
                              >
                                <td class="p-2.5 text-right text-gray-600 dark:text-gray-400">
                                  {formatMoney(w.raw_cpl)}
                                </td>
                                <td class="p-2.5 text-right font-semibold text-blue-800 dark:text-blue-400">
                                  {formatMoney(w.displayed_cpl)}
                                </td>
                              </Show>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </div>

              {/* ── Validity window — admins + Tier-1 CMs only ── */}
              <Show when={canSetValidity()}>
                <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-4 space-y-3">
                  <div>
                    <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      Validity window
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Set when this config starts applying (date &amp; time). A
                      past start is allowed for backdated reports.
                    </p>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    {/* Start datetime — required */}
                    <div>
                      <label class="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">
                        Start (valid from){" "}
                        <span class="text-red-500">*</span>
                      </label>
                      <DateTimePicker
                        value={formData().valid_from}
                        max={formData().valid_to || undefined}
                        placeholder="Select start date & time"
                        onChange={(val) => {
                          handleInputChange("valid_from", val);
                          // Clearing the start drops the (now-orphaned) end so we
                          // never submit an end-without-start.
                          if (!val && formData().valid_to) {
                            handleInputChange("valid_to", "");
                          }
                        }}
                      />
                    </div>

                    {/* End datetime — optional, requires a start first */}
                    <div>
                      <label class="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">
                        End{" "}
                        <span class="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <DateTimePicker
                        value={formData().valid_to}
                        min={formData().valid_from || undefined}
                        disabled={!formData().valid_from}
                        placeholder="date & time (optional)"
                        onChange={(val) => handleInputChange("valid_to", val)}
                      />
                    </div>
                  </div>

                  <p class="text-xs text-gray-400 dark:text-gray-500">
                    {!formData().valid_from
                      ? "A start date/time is required."
                      : formData().valid_to
                        ? "Applies within the selected window."
                        : "Open-ended — applies from the start until a newer config replaces it."}
                  </p>
                </div>
              </Show>

              {/* Notes — unchanged */}
              <div>
                <label class="block text-sm font-medium mb-1.5">Notes</label>
                <textarea
                  rows="4"
                  value={formData().notes}
                  onInput={(e) => handleInputChange("notes", e.target.value)}
                  placeholder="Add notes..."
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                />
              </div>
            </div>

            {/* Save error (e.g. a CM's out-of-scope 403) */}
            <Show when={submitError()}>
              <div class="mx-6 mb-1 mt-3 rounded-md border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {submitError()}
              </div>
            </Show>

            {/* Footer — unchanged */}
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex gap-3">
              <button
                onClick={closeSidebar}
                class="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitConfig}
                disabled={submitting() || isRetainer() || ruleResolving()}
                class="flex-1 px-4 py-2.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {submitting()
                  ? isEditMode()
                    ? "Saving…"
                    : "Adding…"
                  : isEditMode()
                    ? "Save Changes"
                    : "Add Config"}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* ── Success Toast (blue + confetti) ── */}
      <SuccessToast />
    </div>
  );
}
