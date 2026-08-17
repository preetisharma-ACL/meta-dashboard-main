import {
  createSignal,
  createMemo,
  createResource,
  createEffect,
  For,
  Show,
} from "solid-js";
import { A } from "@solidjs/router";
import {
  fetchOnboardingOptions,
  createOnboardedUser,
  collectFieldErrors,
  errorBanner,
} from "../../services/onboarding";

// ─── Onboarding wizard ────────────────────────────────────────────────────────
// Creates a login and its role profile in ONE atomic backend call. Admin and
// coordination only (route-gated; the endpoint 403s everyone else).
//
// Three steps: Account → Role → role-specific profile. The role chosen in step 2
// decides both what step 3 asks for AND which nested object the payload carries:
// exactly one of client / campaign_manager may be sent, and it must match the
// role — a client:{} on a non-client role is a 400. staff_profile is the only
// nested block that rides along with another (campaign_manager), and it is
// optional everywhere it appears.
//
// "admin" is never offered: the backend rejects it with a 400 no matter who
// asks, so listing it would only hand the operator a guaranteed failure.
//
// The creation is ONE transaction — a failure creates NOTHING, so a rejected
// submit safely leaves the operator on the form to fix the value and resubmit.

const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 " +
  "bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-100 " +
  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none " +
  "disabled:opacity-50 transition";

const FIELD_BAD =
  "border-[#AC2334] focus:border-[#AC2334] ring-1 ring-[#AC2334]/30";

const LABEL =
  "block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5";

const HINT = "text-xs text-[#8593A8] mt-1";

const ERR_TEXT = "mt-1.5 text-sm font-medium text-[#AC2334] dark:text-red-400";

// A component, not a shared JSX value: a module-level JSX expression is ONE
// real DOM node in Solid, so reusing it across labels would move the same
// asterisk around instead of rendering one per field.
const Req = () => <span class="text-[#AC2334]">*</span>;

// Roles the wizard can create. `creatable_roles` from the options endpoint is
// the authority for WHICH appear; this only supplies the human wording.
const ROLE_META = {
  client: {
    label: "Client",
    blurb: "A customer login. Creates the client record and its nomen.",
  },
  campaign_manager: {
    label: "Campaign Manager",
    blurb: "Runs campaigns. Tier-2 managers report to a tier-1 team lead.",
  },
  sales: {
    label: "Sales",
    blurb: "Onboards clients and books payments against them.",
  },
  coordination: {
    label: "Coordination",
    blurb: "Cross-client operations desk with org-wide read access.",
  },
  accounts: {
    label: "Accounts",
    blurb: "The payments desk — records and settles client payments.",
  },
};

const roleLabel = (r) => ROLE_META[r]?.label ?? r;

const CLIENT_TYPE_META = {
  cpl: { label: "CPL", blurb: "Billed per qualified lead. No service charge." },
  hybrid: { label: "Hybrid", blurb: "Ad spend plus a service charge." },
  retainer: { label: "Retainer", blurb: "Flat retainer plus a service charge." },
};

// Every path the form can pin a message to. Anything the backend sends OUTSIDE
// this set is still shown — verbatim, in the banner — rather than swallowed,
// because a message nobody sees is the same as no validation at all.
const PINNED_PATHS = new Set([
  "email",
  "password",
  "first_name",
  "last_name",
  "organization_id",
  "role",
  "client.nomen_id",
  "client.nomen_name",
  "client.client_type",
  "client.service_charge",
  "client.onboarded_by_id",
  "client.campaign_manager_ids",
  "client.data_visible_from",
  "campaign_manager.tier",
  "campaign_manager.team_lead_id",
  "staff_profile.designation",
  "staff_profile.whatsapp",
  "staff_profile.client_email",
  "staff_profile.photo_url",
  "staff_profile.intro",
  "staff_profile.show_to_clients",
]);

// non_field_errors are cross-field rules; they belong in the banner, not next to
// an input, so they are neither pinned nor reported as "unpinned".
const BANNER_PATHS = new Set([
  "non_field_errors",
  "client.non_field_errors",
  "campaign_manager.non_field_errors",
  "staff_profile.non_field_errors",
]);

// Which step owns a field, so a rejected submit lands the operator on the step
// holding the offending input instead of on a step showing no error at all.
const stepForPath = (path) => {
  if (path === "role") return 2;
  return path.includes(".") ? 3 : 1;
};

const STAFF_TEXT_FIELDS = [
  "designation",
  "whatsapp",
  "client_email",
  "photo_url",
  "intro",
];

const emptyAccount = () => ({
  email: "",
  password: "",
  confirm: "",
  first_name: "",
  last_name: "",
  organization_id: "",
});

const emptyClient = () => ({
  nomen_id: "",
  nomen_name: "",
  client_type: "",
  service_charge: "",
  onboarded_by_id: "",
  campaign_manager_ids: [],
  data_visible_from: "",
});

const emptyCm = () => ({ tier: "", team_lead_id: "" });

const emptyStaff = () => ({
  designation: "",
  whatsapp: "",
  client_email: "",
  photo_url: "",
  intro: "",
  show_to_clients: false,
});

const trimmed = (v) => (typeof v === "string" ? v.trim() : v);

function ErrorText(props) {
  return (
    <Show when={props.message}>
      <p role="alert" class={ERR_TEXT}>
        {props.message}
      </p>
    </Show>
  );
}

export default function OnboardingWizard() {
  const [options, { refetch }] = createResource(fetchOnboardingOptions);

  const [step, setStep] = createSignal(1);
  const [account, setAccount] = createSignal(emptyAccount());
  const [role, setRole] = createSignal("");
  const [client, setClient] = createSignal(emptyClient());
  const [cm, setCm] = createSignal(emptyCm());
  const [staff, setStaff] = createSignal(emptyStaff());

  const [errors, setErrors] = createSignal({});
  const [banner, setBanner] = createSignal(null);
  const [unpinned, setUnpinned] = createSignal([]);

  const [submitting, setSubmitting] = createSignal(false);
  const [result, setResult] = createSignal(null);
  const [showPassword, setShowPassword] = createSignal(false);

  // Nomen combobox local state (the picker doubles as a "create new" input).
  const [nomenQuery, setNomenQuery] = createSignal("");
  const [nomenOpen, setNomenOpen] = createSignal(false);
  const [cmQuery, setCmQuery] = createSignal("");

  const errFor = (path) => errors()[path];

  const clearErr = (...paths) =>
    setErrors((prev) => {
      const next = { ...prev };
      for (const p of paths) delete next[p];
      return next;
    });

  const setA = (key, value) => {
    setAccount((prev) => ({ ...prev, [key]: value }));
    clearErr(key, "confirm");
  };
  const setC = (key, value) => {
    setClient((prev) => ({ ...prev, [key]: value }));
    clearErr(`client.${key}`);
  };
  const setM = (key, value) => {
    setCm((prev) => ({ ...prev, [key]: value }));
    clearErr(`campaign_manager.${key}`);
  };
  const setS = (key, value) => {
    setStaff((prev) => ({ ...prev, [key]: value }));
    clearErr(`staff_profile.${key}`);
  };

  // A single organization is not a choice — preselect it so the operator isn't
  // asked to confirm the only possible answer.
  createEffect(() => {
    const orgs = options()?.organizations ?? [];
    if (orgs.length === 1 && !account().organization_id) {
      setAccount((prev) => ({ ...prev, organization_id: String(orgs[0].id) }));
    }
  });

  const roles = () => options()?.creatableRoles ?? [];
  const clientTypes = () => options()?.clientTypes ?? [];

  const isClient = () => role() === "client";
  const isCampaignManager = () => role() === "campaign_manager";
  // sales / coordination / accounts — the roles whose only nested block is the
  // optional staff profile.
  const isStaffRole = () => !!role() && !isClient() && !isCampaignManager();
  // The staff profile also rides along with a campaign manager.
  const showsStaffProfile = () => isStaffRole() || isCampaignManager();

  // ── Client type consequences ───────────────────────────────────────────────
  // service_charge must be ABSENT for CPL and PRESENT for hybrid/retainer;
  // data_visible_from is retainer-only. The fields are hidden AND their values
  // dropped on a type change, so a value typed under one type can never leak
  // into a payload for another.
  const needsServiceCharge = () =>
    client().client_type === "hybrid" || client().client_type === "retainer";
  const isRetainer = () => client().client_type === "retainer";

  const pickClientType = (t) => {
    setClient((prev) => ({
      ...prev,
      client_type: t,
      service_charge: t === "cpl" ? "" : prev.service_charge,
      data_visible_from: t === "retainer" ? prev.data_visible_from : "",
    }));
    clearErr(
      "client.client_type",
      "client.service_charge",
      "client.data_visible_from",
    );
  };

  const pickTier = (t) => {
    // team_lead_id must be ABSENT for tier_1 — drop any value the operator
    // picked before switching, so it can't ride along in the payload.
    setCm((prev) => ({
      ...prev,
      tier: t,
      team_lead_id: t === "tier_2" ? prev.team_lead_id : "",
    }));
    clearErr("campaign_manager.tier", "campaign_manager.team_lead_id");
  };

  // ── Nomen combobox ─────────────────────────────────────────────────────────
  const filteredNomens = createMemo(() => {
    const q = nomenQuery().trim().toLowerCase();
    const list = options()?.unassignedNomens ?? [];
    if (!q) return list;
    return list.filter((n) => (n.name || "").toLowerCase().includes(q));
  });

  const exactNomenMatch = createMemo(() => {
    const q = nomenQuery().trim().toLowerCase();
    if (!q) return false;
    return (options()?.unassignedNomens ?? []).some(
      (n) => (n.name || "").toLowerCase() === q,
    );
  });

  const selectedNomen = createMemo(() =>
    (options()?.unassignedNomens ?? []).find(
      (n) => String(n.id) === String(client().nomen_id),
    ),
  );

  // Typing after a pick clears the selection: the operator must land on either
  // an existing nomen or an explicit "create new", never on a stale one.
  const onNomenInput = (value) => {
    setNomenQuery(value);
    setNomenOpen(true);
    setClient((prev) => ({ ...prev, nomen_id: "", nomen_name: "" }));
    clearErr("client.nomen_id", "client.nomen_name");
  };

  const chooseExistingNomen = (n) => {
    setClient((prev) => ({ ...prev, nomen_id: String(n.id), nomen_name: "" }));
    setNomenQuery(n.name);
    setNomenOpen(false);
    clearErr("client.nomen_id", "client.nomen_name");
  };

  const chooseNewNomen = () => {
    setClient((prev) => ({
      ...prev,
      nomen_id: "",
      nomen_name: nomenQuery().trim(),
    }));
    setNomenOpen(false);
    clearErr("client.nomen_id", "client.nomen_name");
  };

  // ── Campaign-manager multi-select ──────────────────────────────────────────
  const filteredCms = createMemo(() => {
    const q = cmQuery().trim().toLowerCase();
    const list = options()?.campaignManagers ?? [];
    if (!q) return list;
    return list.filter((m) => (m.email || "").toLowerCase().includes(q));
  });

  const cmSelected = (id) =>
    client().campaign_manager_ids.includes(String(id));

  const toggleCm = (id) => {
    const key = String(id);
    setClient((prev) => ({
      ...prev,
      campaign_manager_ids: prev.campaign_manager_ids.includes(key)
        ? prev.campaign_manager_ids.filter((x) => x !== key)
        : [...prev.campaign_manager_ids, key],
    }));
    clearErr("client.campaign_manager_ids");
  };

  // ── Local validation ───────────────────────────────────────────────────────
  // The backend stays the authority on every one of these; validating here only
  // saves a round trip on the mistakes we can name without asking.
  const validateAccount = () => {
    const a = account();
    const found = {};
    if (!trimmed(a.email)) found.email = "Email is required.";
    else if (!/^\S+@\S+\.\S+$/.test(trimmed(a.email)))
      found.email = "Enter a valid email address.";
    if (!a.password) found.password = "Password is required.";
    else if (a.password.length < 10)
      found.password = "Password must be at least 10 characters.";
    if (!a.confirm) found.confirm = "Confirm the password.";
    else if (a.confirm !== a.password)
      found.confirm = "The two passwords do not match.";
    if (!a.organization_id) found.organization_id = "Pick an organization.";
    return found;
  };

  const validateRole = () =>
    role() ? {} : { role: "Pick the role this user will have." };

  const validateProfile = () => {
    const found = {};

    if (isClient()) {
      const c = client();
      if (!c.nomen_id && !trimmed(c.nomen_name)) {
        found["client.nomen_id"] =
          "Pick an unassigned client nomen, or type a name to create a new one.";
      } else if (!c.nomen_id && trimmed(c.nomen_name).includes("|")) {
        // The backend 400s a name containing "|" — it is the field separator in
        // the nomen's stored form.
        found["client.nomen_name"] =
          'A new client nomen name cannot contain the "|" character.';
      }
      if (!c.client_type) found["client.client_type"] = "Pick a client type.";
      if (needsServiceCharge()) {
        const raw = trimmed(c.service_charge);
        if (raw === "" || raw == null)
          found["client.service_charge"] =
            `Service charge is required for ${CLIENT_TYPE_META[c.client_type]?.label ?? c.client_type} clients.`;
        else if (!Number.isFinite(Number(raw)) || Number(raw) < 0)
          found["client.service_charge"] =
            "Service charge must be a number of 0 or more.";
      }
      if (!c.onboarded_by_id)
        found["client.onboarded_by_id"] =
          "Pick the sales user who onboarded this client.";
    }

    if (isCampaignManager()) {
      const m = cm();
      if (!m.tier) found["campaign_manager.tier"] = "Pick a tier.";
      else if (m.tier === "tier_2" && !m.team_lead_id)
        found["campaign_manager.team_lead_id"] =
          "A tier-2 manager must report to a tier-1 team lead.";
    }

    return found;
  };

  const goNext = () => {
    const current = step();
    const found = current === 1 ? validateAccount() : validateRole();

    // Replace only THIS step's messages. A server rejection can pin errors to
    // several steps at once; walking forward past one of them must not erase
    // the ones the operator hasn't reached yet.
    setErrors((prev) => {
      const kept = Object.fromEntries(
        Object.entries(prev).filter(([path]) => stepForPath(path) !== current),
      );
      return { ...kept, ...found };
    });

    if (Object.keys(found).length) return;
    setBanner(null);
    setUnpinned([]);
    setStep(current + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    setStep(Math.max(1, step() - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Payload ────────────────────────────────────────────────────────────────
  // ONLY the nested object matching the chosen role is attached. Empty strings
  // are never sent: an omitted optional field takes the backend default, an
  // empty one is a value the serializer has to reject.
  const buildStaffProfile = () => {
    const s = staff();
    const out = {};
    for (const key of STAFF_TEXT_FIELDS) {
      const v = trimmed(s[key]);
      if (v) out[key] = v;
    }
    if (!Object.keys(out).length && !s.show_to_clients) return null;
    out.show_to_clients = !!s.show_to_clients;
    return out;
  };

  const buildClient = () => {
    const c = client();
    const out = { client_type: c.client_type };

    // EITHER an existing nomen OR a new name — never both.
    if (c.nomen_id) out.nomen_id = Number(c.nomen_id);
    else out.nomen_name = trimmed(c.nomen_name);

    // Absent for CPL by design: sending it is a documented 400.
    if (needsServiceCharge()) out.service_charge = Number(trimmed(c.service_charge));

    out.onboarded_by_id = Number(c.onboarded_by_id);

    if (c.campaign_manager_ids.length)
      out.campaign_manager_ids = c.campaign_manager_ids.map(Number);

    // Retainer-only.
    if (isRetainer() && trimmed(c.data_visible_from))
      out.data_visible_from = c.data_visible_from;

    return out;
  };

  const buildCampaignManager = () => {
    const m = cm();
    const out = { tier: m.tier };
    // Absent for tier_1 by design: sending it is a documented 400.
    if (m.tier === "tier_2") out.team_lead_id = Number(m.team_lead_id);
    return out;
  };

  const buildPayload = () => {
    const a = account();
    const payload = {
      email: trimmed(a.email),
      password: a.password,
      organization_id: Number(a.organization_id),
      role: role(),
    };
    const first = trimmed(a.first_name);
    const last = trimmed(a.last_name);
    if (first) payload.first_name = first;
    if (last) payload.last_name = last;

    if (isClient()) {
      payload.client = buildClient();
    } else if (isCampaignManager()) {
      payload.campaign_manager = buildCampaignManager();
      const sp = buildStaffProfile();
      if (sp) payload.staff_profile = sp;
    } else {
      const sp = buildStaffProfile();
      if (sp) payload.staff_profile = sp;
    }

    return payload;
  };

  const handleSubmit = async () => {
    setBanner(null);
    setUnpinned([]);

    // Re-run every step's checks, not just this one's — the operator can walk
    // back and edit step 1 after reaching step 3.
    const found = {
      ...validateAccount(),
      ...validateRole(),
      ...validateProfile(),
    };
    setErrors(found);
    const paths = Object.keys(found);
    if (paths.length) {
      const earliest = Math.min(...paths.map(stepForPath));
      setStep(earliest);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSubmitting(true);
    try {
      const data = await createOnboardedUser(buildPayload());
      setResult(data ?? {});
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      // The field map is read FIRST — err.message is only the wrapper string
      // ("Validation failed") on the 4xx path, and every actual reason (which
      // nomen is taken, why the password failed, that onboarded_by isn't a
      // sales user) lives in error.fields. Messages are shown verbatim.
      const pinnedAll = collectFieldErrors(err);

      const pinned = {};
      const leftovers = [];
      for (const [path, message] of Object.entries(pinnedAll)) {
        if (PINNED_PATHS.has(path)) pinned[path] = message;
        else if (!BANNER_PATHS.has(path)) leftovers.push({ path, message });
      }

      setErrors(pinned);
      setUnpinned(leftovers);
      setBanner(errorBanner(err, pinnedAll));

      // Land on the step that owns the first rejected field, so the message the
      // operator has to act on is actually on screen.
      const pinnedPaths = Object.keys(pinned);
      if (pinnedPaths.length) {
        setStep(Math.min(...pinnedPaths.map(stepForPath)));
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    setResult(null);
    setStep(1);
    setAccount(emptyAccount());
    setRole("");
    setClient(emptyClient());
    setCm(emptyCm());
    setStaff(emptyStaff());
    setErrors({});
    setBanner(null);
    setUnpinned([]);
    setNomenQuery("");
    setNomenOpen(false);
    setCmQuery("");
    setShowPassword(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const stepTitle = () =>
    step() === 1 ? "Account" : step() === 2 ? "Role" : "Profile";

  // Every string value the server echoed back on the created staff profile,
  // rendered without assuming the exact key set.
  const staffProfileRows = createMemo(() => {
    const sp = result()?.staff_profile;
    if (!sp || typeof sp !== "object") return [];
    return Object.entries(sp).filter(
      ([, v]) => v != null && v !== "" && typeof v !== "object",
    );
  });

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Onboarding
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Create a user
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            Sets up the login and its role profile in one go. Nothing is created
            unless every part succeeds, so a rejected form is safe to correct and
            submit again.
          </p>
        </div>

        <A
          href="/clients"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
        >
          Back to Clients
        </A>
      </div>

      {/* ════════ SUCCESS ════════ */}
      <Show when={result()}>
        <div class="max-w-3xl">
          <div class="rounded-2xl border border-[#15966A]/25 bg-[#E9F7F1] dark:bg-green-900/15 px-5 py-5">
            <div class="flex items-start gap-3">
              <span class="w-9 h-9 flex-none rounded-xl bg-[#15966A] text-white grid place-items-center">
                <svg
                  class="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </span>
              <div class="min-w-0">
                <p class="text-sm font-bold text-[#14233A] dark:text-white">
                  {roleLabel(result().role)} created
                </p>
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                  {trimmed(account().email)} can sign in with the password you
                  set.
                </p>
              </div>
            </div>

            <dl class="mt-4 pt-4 border-t border-[#15966A]/20 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
              <Show when={result().user_id != null}>
                <div class="flex justify-between gap-3">
                  <dt class="text-[#54657E] dark:text-gray-400">User ID</dt>
                  <dd class="font-semibold text-[#14233A] dark:text-gray-100">
                    {result().user_id}
                  </dd>
                </div>
              </Show>
              <Show when={result().client_id != null}>
                <div class="flex justify-between gap-3">
                  <dt class="text-[#54657E] dark:text-gray-400">Client ID</dt>
                  <dd class="font-semibold text-[#14233A] dark:text-gray-100">
                    {result().client_id}
                  </dd>
                </div>
              </Show>
              <Show when={result().client_nomen != null}>
                <div class="flex justify-between gap-3">
                  <dt class="text-[#54657E] dark:text-gray-400">Client nomen</dt>
                  <dd class="font-semibold text-[#14233A] dark:text-gray-100 text-right">
                    {String(result().client_nomen)}
                    <Show when={result().nomen_created}>
                      <span class="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#15966A]/15 text-[#0F7A55]">
                        new
                      </span>
                    </Show>
                  </dd>
                </div>
              </Show>
              <Show when={result().cm_profile_id != null}>
                <div class="flex justify-between gap-3">
                  <dt class="text-[#54657E] dark:text-gray-400">CM profile</dt>
                  <dd class="font-semibold text-[#14233A] dark:text-gray-100">
                    {result().cm_profile_id}
                  </dd>
                </div>
              </Show>
              <Show when={result().tier}>
                <div class="flex justify-between gap-3">
                  <dt class="text-[#54657E] dark:text-gray-400">Tier</dt>
                  <dd class="font-semibold text-[#14233A] dark:text-gray-100">
                    {String(result().tier).replace("_", "-")}
                  </dd>
                </div>
              </Show>
              <Show when={result().team_lead}>
                <div class="flex justify-between gap-3">
                  <dt class="text-[#54657E] dark:text-gray-400">Team lead</dt>
                  <dd class="font-semibold text-[#14233A] dark:text-gray-100 text-right break-all">
                    {String(result().team_lead)}
                  </dd>
                </div>
              </Show>
              <Show when={result().campaign_managers?.length}>
                <div class="sm:col-span-2 flex justify-between gap-3">
                  <dt class="text-[#54657E] dark:text-gray-400 flex-none">
                    Campaign managers
                  </dt>
                  <dd class="font-semibold text-[#14233A] dark:text-gray-100 text-right break-all">
                    {result().campaign_managers.join(", ")}
                  </dd>
                </div>
              </Show>
              <For each={staffProfileRows()}>
                {([key, value]) => (
                  <div class="flex justify-between gap-3">
                    <dt class="text-[#54657E] dark:text-gray-400">
                      {key.replace(/_/g, " ")}
                    </dt>
                    <dd class="font-semibold text-[#14233A] dark:text-gray-100 text-right break-all">
                      {String(value)}
                    </dd>
                  </div>
                )}
              </For>
            </dl>
          </div>

          {/* Billing is a SEPARATE setup step — the client exists but cannot be
              invoiced until a display config / rate is added. */}
          <Show when={result().billing_setup_pending}>
            <div
              role="alert"
              class="mt-4 rounded-2xl border border-[#D89A2B]/40 bg-[#FDF6E7] dark:bg-yellow-900/15 dark:border-yellow-700/50 px-5 py-4"
            >
              <div class="flex items-start gap-3">
                <svg
                  class="w-5 h-5 flex-none text-[#8A6410] dark:text-yellow-300 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  />
                </svg>
                <div>
                  <p class="text-sm font-bold text-[#8A6410] dark:text-yellow-200">
                    Billing setup pending
                  </p>
                  <p class="text-sm text-[#8A6410]/90 dark:text-yellow-200/90 mt-0.5">
                    This client has no display config/rate yet and can't be
                    billed until one is added.
                  </p>
                  <A
                    href="/project-display-config"
                    class="inline-block mt-2 text-sm font-semibold text-[#8A6410] dark:text-yellow-200 underline underline-offset-2"
                  >
                    Open Project Display Config
                  </A>
                </div>
              </div>
            </div>
          </Show>

          <div class="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={startOver}
              class="px-4 py-2.5 rounded-lg bg-[#AC2334] text-white font-semibold hover:bg-[#93192a] transition"
            >
              Create another user
            </button>
            <A
              href="/clients"
              class="px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition"
            >
              Go to Clients
            </A>
          </div>
        </div>
      </Show>

      {/* ════════ WIZARD ════════ */}
      <Show when={!result()}>
        <div class="max-w-3xl">
          {/* Step rail */}
          <ol class="flex items-center gap-2 mb-5">
            <For each={[1, 2, 3]}>
              {(n) => (
                <>
                  <li class="flex items-center gap-2">
                    <span
                      class={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold transition ${
                        step() === n
                          ? "bg-[#AC2334] text-white"
                          : step() > n
                            ? "bg-[#15966A] text-white"
                            : "bg-[#E2E8F1] dark:bg-gray-700 text-[#54657E] dark:text-gray-400"
                      }`}
                    >
                      {step() > n ? "✓" : n}
                    </span>
                    <span
                      class={`text-sm font-semibold hidden sm:inline ${
                        step() === n
                          ? "text-[#14233A] dark:text-white"
                          : "text-[#8593A8]"
                      }`}
                    >
                      {n === 1 ? "Account" : n === 2 ? "Role" : "Profile"}
                    </span>
                  </li>
                  <Show when={n < 3}>
                    <li
                      aria-hidden="true"
                      class="flex-1 h-px bg-[#E2E8F1] dark:bg-gray-700"
                    />
                  </Show>
                </>
              )}
            </For>
          </ol>

          {/* Options load failure — the dropdowns are the whole form, so this is
              a hard stop with a retry rather than an empty set of selects. */}
          <Show when={options.error}>
            <div
              role="alert"
              class="mb-5 rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300 flex items-center justify-between gap-3"
            >
              <span>
                Could not load the onboarding options.{" "}
                {options.error?.message ?? ""}
              </span>
              <button
                type="button"
                onClick={() => refetch()}
                class="flex-none px-3 py-1.5 rounded-lg border border-[#AC2334]/40 font-semibold hover:bg-white/60 transition"
              >
                Retry
              </button>
            </div>
          </Show>

          {/* Server rejection banner. The wrapper string is only ever the last
              resort — this shows the most specific text the server gave. */}
          <Show when={banner()}>
            <div
              role="alert"
              class="mb-5 rounded-lg border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
            >
              {banner()}
              <Show when={unpinned().length}>
                <ul class="mt-2 space-y-1 list-disc list-inside font-normal">
                  <For each={unpinned()}>
                    {(u) => (
                      <li>
                        <span class="font-semibold">
                          {u.path.replace(/_/g, " ")}:
                        </span>{" "}
                        {u.message}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>

          <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6">
            <h2 class="text-lg font-bold text-[#14233A] dark:text-white mb-5">
              {step()}. {stepTitle()}
            </h2>

            {/* ─────────── STEP 1 — ACCOUNT ─────────── */}
            <Show when={step() === 1}>
              <div class="space-y-5">
                <div>
                  <label class={LABEL}>Email <Req /></label>
                  <input
                    type="email"
                    autocomplete="off"
                    value={account().email}
                    onInput={(e) => setA("email", e.target.value)}
                    placeholder="name@example.com"
                    class={`${FIELD} ${errFor("email") ? FIELD_BAD : ""}`}
                    aria-invalid={!!errFor("email")}
                  />
                  <ErrorText message={errFor("email")} />
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label class={LABEL}>Password <Req /></label>
                    <div class="relative">
                      <input
                        type={showPassword() ? "text" : "password"}
                        autocomplete="new-password"
                        value={account().password}
                        onInput={(e) => setA("password", e.target.value)}
                        class={`${FIELD} pr-16 ${errFor("password") ? FIELD_BAD : ""}`}
                        aria-invalid={!!errFor("password")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword())}
                        class="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-semibold text-[#54657E] dark:text-gray-400 hover:text-[#AC2334]"
                      >
                        {showPassword() ? "Hide" : "Show"}
                      </button>
                    </div>
                    <Show
                      when={errFor("password")}
                      fallback={
                        <p class={HINT}>
                          At least 10 characters.
                          <Show when={account().password}>
                            {" "}
                            ({account().password.length})
                          </Show>
                        </p>
                      }
                    >
                      <ErrorText message={errFor("password")} />
                    </Show>
                  </div>

                  <div>
                    <label class={LABEL}>Confirm password <Req /></label>
                    <input
                      type={showPassword() ? "text" : "password"}
                      autocomplete="new-password"
                      value={account().confirm}
                      onInput={(e) => setA("confirm", e.target.value)}
                      class={`${FIELD} ${errFor("confirm") ? FIELD_BAD : ""}`}
                      aria-invalid={!!errFor("confirm")}
                    />
                    <ErrorText message={errFor("confirm")} />
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label class={LABEL}>First name</label>
                    <input
                      type="text"
                      value={account().first_name}
                      onInput={(e) => setA("first_name", e.target.value)}
                      class={`${FIELD} ${errFor("first_name") ? FIELD_BAD : ""}`}
                    />
                    <ErrorText message={errFor("first_name")} />
                  </div>
                  <div>
                    <label class={LABEL}>Last name</label>
                    <input
                      type="text"
                      value={account().last_name}
                      onInput={(e) => setA("last_name", e.target.value)}
                      class={`${FIELD} ${errFor("last_name") ? FIELD_BAD : ""}`}
                    />
                    <ErrorText message={errFor("last_name")} />
                  </div>
                </div>

                <div>
                  <label class={LABEL}>Organization <Req /></label>
                  <select
                    value={account().organization_id}
                    onChange={(e) => setA("organization_id", e.target.value)}
                    disabled={options.loading}
                    class={`${FIELD} ${errFor("organization_id") ? FIELD_BAD : ""}`}
                    aria-invalid={!!errFor("organization_id")}
                  >
                    <option value="">
                      {options.loading
                        ? "Loading organizations…"
                        : "Select an organization…"}
                    </option>
                    <For each={options()?.organizations ?? []}>
                      {(o) => <option value={String(o.id)}>{o.name}</option>}
                    </For>
                  </select>
                  <ErrorText message={errFor("organization_id")} />
                </div>
              </div>
            </Show>

            {/* ─────────── STEP 2 — ROLE ─────────── */}
            <Show when={step() === 2}>
              <div class="space-y-3">
                <p class="text-sm text-[#54657E] dark:text-gray-400 -mt-2 mb-4">
                  The role decides what the next step asks for. Admin accounts
                  can't be created here.
                </p>
                <Show
                  when={roles().length}
                  fallback={
                    <p class="text-sm text-[#8593A8]">
                      {options.loading
                        ? "Loading roles…"
                        : "No creatable roles are available."}
                    </p>
                  }
                >
                  <For each={roles()}>
                    {(r) => (
                      <button
                        type="button"
                        onClick={() => {
                          setRole(r);
                          clearErr("role");
                        }}
                        class={`w-full text-left px-4 py-3 rounded-xl border transition flex items-start gap-3 ${
                          role() === r
                            ? "border-[#AC2334] bg-[#FBEEF0] dark:bg-[#AC2334]/15 shadow-[inset_0_0_0_1px_rgba(172,35,52,.25)]"
                            : "border-[#E2E8F1] dark:border-gray-700 hover:bg-[#F6F9FC] dark:hover:bg-gray-700/40"
                        }`}
                      >
                        <span
                          class={`mt-0.5 w-4 h-4 flex-none rounded-full border-2 grid place-items-center ${
                            role() === r
                              ? "border-[#AC2334]"
                              : "border-[#C6D0DE] dark:border-gray-600"
                          }`}
                        >
                          <Show when={role() === r}>
                            <span class="w-2 h-2 rounded-full bg-[#AC2334]" />
                          </Show>
                        </span>
                        <span>
                          <span class="block font-semibold text-[#14233A] dark:text-gray-100">
                            {roleLabel(r)}
                          </span>
                          <span class="block text-xs text-[#8593A8] mt-0.5">
                            {ROLE_META[r]?.blurb ?? ""}
                          </span>
                        </span>
                      </button>
                    )}
                  </For>
                </Show>
                <ErrorText message={errFor("role")} />
              </div>
            </Show>

            {/* ─────────── STEP 3 — PROFILE ─────────── */}
            <Show when={step() === 3}>
              <div class="space-y-5">
                {/* ── CLIENT ── */}
                <Show when={isClient()}>
                  {/* Nomen: existing OR new */}
                  <div>
                    <label class={LABEL}>Client nomen <Req /></label>
                    <div class="relative">
                      <input
                        type="text"
                        value={nomenQuery()}
                        placeholder={
                          options.loading
                            ? "Loading nomens…"
                            : "Search unassigned nomens, or type a new name…"
                        }
                        onFocus={() => setNomenOpen(true)}
                        onInput={(e) => onNomenInput(e.target.value)}
                        onBlur={() => setTimeout(() => setNomenOpen(false), 150)}
                        class={`${FIELD} ${
                          errFor("client.nomen_id") || errFor("client.nomen_name")
                            ? FIELD_BAD
                            : ""
                        }`}
                      />
                      <Show when={nomenOpen()}>
                        <div class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                          <For each={filteredNomens()}>
                            {(n) => (
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  chooseExistingNomen(n);
                                }}
                                class="w-full text-left px-3 py-2 hover:bg-[#FBEEF0] dark:hover:bg-gray-800 transition-colors"
                              >
                                <span class="font-medium text-[#14233A] dark:text-gray-100">
                                  {n.name}
                                </span>
                                <span class="block text-xs text-[#8593A8]">
                                  Unassigned · #{n.id}
                                </span>
                              </button>
                            )}
                          </For>

                          <Show when={nomenQuery().trim() && !exactNomenMatch()}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                chooseNewNomen();
                              }}
                              class="w-full text-left px-3 py-2.5 border-t border-[#E2E8F1] dark:border-gray-700 hover:bg-[#E9F7F1] dark:hover:bg-green-900/20 transition-colors"
                            >
                              <span class="font-semibold text-[#0F7A55]">
                                + Create new nomen “{nomenQuery().trim()}”
                              </span>
                            </button>
                          </Show>

                          <Show
                            when={
                              !filteredNomens().length && !nomenQuery().trim()
                            }
                          >
                            <p class="px-3 py-3 text-sm text-[#8593A8]">
                              No unassigned nomens — type a name to create one.
                            </p>
                          </Show>
                        </div>
                      </Show>
                    </div>

                    <Show when={selectedNomen()}>
                      <p class={HINT}>
                        Using existing nomen{" "}
                        <span class="font-semibold text-[#14233A] dark:text-gray-200">
                          {selectedNomen().name}
                        </span>{" "}
                        (#{selectedNomen().id}).
                      </p>
                    </Show>
                    <Show when={!selectedNomen() && trimmed(client().nomen_name)}>
                      <p class={HINT}>
                        Creating a new nomen named{" "}
                        <span class="font-semibold text-[#0F7A55]">
                          {trimmed(client().nomen_name)}
                        </span>
                        .
                      </p>
                    </Show>
                    <Show
                      when={!selectedNomen() && !trimmed(client().nomen_name)}
                    >
                      <p class={HINT}>
                        Pick one from the list, or type a name and choose “Create
                        new nomen”. A new name can't contain “|”.
                      </p>
                    </Show>

                    <ErrorText message={errFor("client.nomen_id")} />
                    <ErrorText message={errFor("client.nomen_name")} />
                  </div>

                  {/* Client type */}
                  <div>
                    <label class={LABEL}>Client type <Req /></label>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <For each={clientTypes()}>
                        {(t) => (
                          <button
                            type="button"
                            onClick={() => pickClientType(t)}
                            class={`text-left px-3.5 py-3 rounded-xl border transition ${
                              client().client_type === t
                                ? "border-[#AC2334] bg-[#FBEEF0] dark:bg-[#AC2334]/15 shadow-[inset_0_0_0_1px_rgba(172,35,52,.25)]"
                                : "border-[#E2E8F1] dark:border-gray-700 hover:bg-[#F6F9FC] dark:hover:bg-gray-700/40"
                            }`}
                          >
                            <span class="block font-semibold text-[#14233A] dark:text-gray-100">
                              {CLIENT_TYPE_META[t]?.label ?? t}
                            </span>
                            <span class="block text-xs text-[#8593A8] mt-0.5">
                              {CLIENT_TYPE_META[t]?.blurb ?? ""}
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                    <ErrorText message={errFor("client.client_type")} />
                  </div>

                  {/* Service charge — hybrid + retainer only. Deliberately not
                      rendered for CPL: the backend 400s a CPL client that
                      carries one, so there must be no way to type it. */}
                  <Show when={needsServiceCharge()}>
                    <div>
                      <label class={LABEL}>Service charge <Req /></label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={client().service_charge}
                        onInput={(e) => setC("service_charge", e.target.value)}
                        class={`${FIELD} ${errFor("client.service_charge") ? FIELD_BAD : ""}`}
                        aria-invalid={!!errFor("client.service_charge")}
                      />
                      <Show
                        when={errFor("client.service_charge")}
                        fallback={
                          <p class={HINT}>
                            Required for{" "}
                            {CLIENT_TYPE_META[client().client_type]?.label ??
                              client().client_type}{" "}
                            clients. CPL clients never carry one.
                          </p>
                        }
                      >
                        <ErrorText message={errFor("client.service_charge")} />
                      </Show>
                    </div>
                  </Show>

                  {/* Onboarded by — sales users only */}
                  <div>
                    <label class={LABEL}>Onboarded by <Req /></label>
                    <select
                      value={client().onboarded_by_id}
                      onChange={(e) => setC("onboarded_by_id", e.target.value)}
                      disabled={options.loading}
                      class={`${FIELD} ${errFor("client.onboarded_by_id") ? FIELD_BAD : ""}`}
                      aria-invalid={!!errFor("client.onboarded_by_id")}
                    >
                      <option value="">
                        {options.loading
                          ? "Loading sales users…"
                          : "Select the sales user…"}
                      </option>
                      <For each={options()?.salesUsers ?? []}>
                        {(u) => <option value={String(u.id)}>{u.email}</option>}
                      </For>
                    </select>
                    <Show
                      when={errFor("client.onboarded_by_id")}
                      fallback={
                        <p class={HINT}>
                          Must be a sales user — the client's payments are
                          credited to them.
                        </p>
                      }
                    >
                      <ErrorText message={errFor("client.onboarded_by_id")} />
                    </Show>
                  </div>

                  {/* Campaign managers — optional multi-select */}
                  <div>
                    <label class={LABEL}>
                      Campaign managers{" "}
                      <span class="font-normal text-[#8593A8]">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={cmQuery()}
                      onInput={(e) => setCmQuery(e.target.value)}
                      placeholder="Filter by email…"
                      class={`${FIELD} mb-2`}
                    />
                    <div
                      class={`max-h-52 overflow-y-auto rounded-lg border ${
                        errFor("client.campaign_manager_ids")
                          ? "border-[#AC2334]"
                          : "border-[#E2E8F1] dark:border-gray-700"
                      } divide-y divide-[#E2E8F1] dark:divide-gray-700`}
                    >
                      <Show
                        when={filteredCms().length}
                        fallback={
                          <p class="px-3 py-3 text-sm text-[#8593A8]">
                            {options.loading
                              ? "Loading campaign managers…"
                              : "No campaign managers match."}
                          </p>
                        }
                      >
                        <For each={filteredCms()}>
                          {(m) => (
                            <label class="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[#F6F9FC] dark:hover:bg-gray-700/40 transition-colors">
                              <input
                                type="checkbox"
                                checked={cmSelected(m.id)}
                                onChange={() => toggleCm(m.id)}
                                class="w-4 h-4 accent-[#AC2334]"
                              />
                              <span class="min-w-0 flex-1">
                                <span class="block text-sm text-[#14233A] dark:text-gray-100 truncate">
                                  {m.email}
                                </span>
                                <Show when={m.tier}>
                                  <span class="block text-xs text-[#8593A8]">
                                    {String(m.tier).replace("_", "-")}
                                  </span>
                                </Show>
                              </span>
                            </label>
                          )}
                        </For>
                      </Show>
                    </div>
                    <Show
                      when={errFor("client.campaign_manager_ids")}
                      fallback={
                        <p class={HINT}>
                          {client().campaign_manager_ids.length
                            ? `${client().campaign_manager_ids.length} selected — they'll see this client straight away.`
                            : "Leave empty to assign managers later."}
                        </p>
                      }
                    >
                      <ErrorText
                        message={errFor("client.campaign_manager_ids")}
                      />
                    </Show>
                  </div>

                  {/* Data visible from — retainer only */}
                  <Show when={isRetainer()}>
                    <div>
                      <label class={LABEL}>
                        Data visible from{" "}
                        <span class="font-normal text-[#8593A8]">
                          (optional)
                        </span>
                      </label>
                      <input
                        type="date"
                        value={client().data_visible_from}
                        onInput={(e) => setC("data_visible_from", e.target.value)}
                        class={`${FIELD} ${errFor("client.data_visible_from") ? FIELD_BAD : ""}`}
                      />
                      <Show
                        when={errFor("client.data_visible_from")}
                        fallback={
                          <p class={HINT}>
                            Retainer clients only — the client sees no reporting
                            before this date.
                          </p>
                        }
                      >
                        <ErrorText message={errFor("client.data_visible_from")} />
                      </Show>
                    </div>
                  </Show>
                </Show>

                {/* ── CAMPAIGN MANAGER ── */}
                <Show when={isCampaignManager()}>
                  <div>
                    <label class={LABEL}>Tier <Req /></label>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <For each={["tier_1", "tier_2"]}>
                        {(t) => (
                          <button
                            type="button"
                            onClick={() => pickTier(t)}
                            class={`text-left px-3.5 py-3 rounded-xl border transition ${
                              cm().tier === t
                                ? "border-[#AC2334] bg-[#FBEEF0] dark:bg-[#AC2334]/15 shadow-[inset_0_0_0_1px_rgba(172,35,52,.25)]"
                                : "border-[#E2E8F1] dark:border-gray-700 hover:bg-[#F6F9FC] dark:hover:bg-gray-700/40"
                            }`}
                          >
                            <span class="block font-semibold text-[#14233A] dark:text-gray-100">
                              {t === "tier_1" ? "Tier 1" : "Tier 2"}
                            </span>
                            <span class="block text-xs text-[#8593A8] mt-0.5">
                              {t === "tier_1"
                                ? "Team lead. Reports to nobody."
                                : "Reports to a tier-1 team lead."}
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                    <ErrorText message={errFor("campaign_manager.tier")} />
                  </div>

                  {/* Team lead — tier-2 only. Deliberately not rendered for
                      tier-1: the backend 400s a tier-1 manager that carries
                      one, so there must be no way to set it. */}
                  <Show when={cm().tier === "tier_2"}>
                    <div>
                      <label class={LABEL}>Team lead <Req /></label>
                      <select
                        value={cm().team_lead_id}
                        onChange={(e) => setM("team_lead_id", e.target.value)}
                        disabled={options.loading}
                        class={`${FIELD} ${errFor("campaign_manager.team_lead_id") ? FIELD_BAD : ""}`}
                        aria-invalid={!!errFor("campaign_manager.team_lead_id")}
                      >
                        <option value="">
                          {options.loading
                            ? "Loading team leads…"
                            : "Select a tier-1 manager…"}
                        </option>
                        <For each={options()?.tier1CampaignManagers ?? []}>
                          {(u) => (
                            <option value={String(u.id)}>{u.email}</option>
                          )}
                        </For>
                      </select>
                      <Show
                        when={errFor("campaign_manager.team_lead_id")}
                        fallback={
                          <p class={HINT}>
                            Required for tier 2. Tier-1 managers never have one.
                          </p>
                        }
                      >
                        <ErrorText
                          message={errFor("campaign_manager.team_lead_id")}
                        />
                      </Show>
                    </div>
                  </Show>
                </Show>

                {/* ── STAFF PROFILE (optional) ──
                    Shown for sales / coordination / accounts, and alongside the
                    campaign-manager fields. Sent only when something is filled
                    in — an empty object is a value the serializer has to judge,
                    an omitted one isn't. */}
                <Show when={showsStaffProfile()}>
                  <div
                    class={
                      isCampaignManager()
                        ? "pt-5 border-t border-[#E2E8F1] dark:border-gray-700"
                        : ""
                    }
                  >
                    <h3 class="text-sm font-bold text-[#14233A] dark:text-white">
                      Staff profile{" "}
                      <span class="font-normal text-[#8593A8]">(optional)</span>
                    </h3>
                    <p class="text-xs text-[#8593A8] mt-0.5 mb-4">
                      How this person appears to clients on “Meet Your Team”.
                      Leave it blank to skip it entirely.
                    </p>

                    <div class="space-y-5">
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                          <label class={LABEL}>Designation</label>
                          <input
                            type="text"
                            value={staff().designation}
                            onInput={(e) => setS("designation", e.target.value)}
                            placeholder="e.g. Senior Campaign Manager"
                            class={`${FIELD} ${errFor("staff_profile.designation") ? FIELD_BAD : ""}`}
                          />
                          <ErrorText
                            message={errFor("staff_profile.designation")}
                          />
                        </div>
                        <div>
                          <label class={LABEL}>WhatsApp</label>
                          <input
                            type="tel"
                            value={staff().whatsapp}
                            onInput={(e) => setS("whatsapp", e.target.value)}
                            class={`${FIELD} ${errFor("staff_profile.whatsapp") ? FIELD_BAD : ""}`}
                          />
                          <ErrorText message={errFor("staff_profile.whatsapp")} />
                        </div>
                      </div>

                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                          <label class={LABEL}>Client-facing email</label>
                          <input
                            type="email"
                            value={staff().client_email}
                            onInput={(e) => setS("client_email", e.target.value)}
                            class={`${FIELD} ${errFor("staff_profile.client_email") ? FIELD_BAD : ""}`}
                          />
                          <ErrorText
                            message={errFor("staff_profile.client_email")}
                          />
                        </div>
                        <div>
                          <label class={LABEL}>Photo URL</label>
                          <input
                            type="url"
                            value={staff().photo_url}
                            onInput={(e) => setS("photo_url", e.target.value)}
                            placeholder="https://…"
                            class={`${FIELD} ${errFor("staff_profile.photo_url") ? FIELD_BAD : ""}`}
                          />
                          <ErrorText
                            message={errFor("staff_profile.photo_url")}
                          />
                        </div>
                      </div>

                      <div>
                        <label class={LABEL}>Intro</label>
                        <textarea
                          rows="3"
                          value={staff().intro}
                          onInput={(e) => setS("intro", e.target.value)}
                          placeholder="A short line clients will read."
                          class={`${FIELD} resize-none ${errFor("staff_profile.intro") ? FIELD_BAD : ""}`}
                        />
                        <ErrorText message={errFor("staff_profile.intro")} />
                      </div>

                      <label class="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={staff().show_to_clients}
                          onChange={(e) =>
                            setS("show_to_clients", e.target.checked)
                          }
                          class="w-4 h-4 accent-[#AC2334]"
                        />
                        <span class="text-sm font-medium text-[#14233A] dark:text-gray-200">
                          Show this person to clients
                        </span>
                      </label>
                      <ErrorText
                        message={errFor("staff_profile.show_to_clients")}
                      />
                    </div>
                  </div>
                </Show>

                <Show when={isStaffRole()}>
                  <p class="text-xs text-[#8593A8]">
                    {roleLabel(role())} accounts need nothing beyond the login —
                    submit whenever you're ready.
                  </p>
                </Show>
              </div>
            </Show>

            {/* ════════ FOOTER ════════ */}
            <div class="mt-6 pt-5 border-t border-[#E2E8F1] dark:border-gray-700 flex flex-wrap gap-3 justify-end">
              <Show when={step() > 1}>
                <button
                  type="button"
                  onClick={goBack}
                  disabled={submitting()}
                  class="px-4 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#E2E8F1]/60 dark:hover:bg-gray-700 disabled:opacity-40 transition"
                >
                  Back
                </button>
              </Show>
              <Show
                when={step() < 3}
                fallback={
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting()}
                    class="px-5 py-2.5 rounded-lg bg-[#AC2334] text-white font-semibold hover:bg-[#93192a] disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {submitting()
                      ? "Creating…"
                      : `Create ${roleLabel(role()).toLowerCase()}`}
                  </button>
                }
              >
                <button
                  type="button"
                  onClick={goNext}
                  class="px-5 py-2.5 rounded-lg bg-[#AC2334] text-white font-semibold hover:bg-[#93192a] transition"
                >
                  Next
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
}
