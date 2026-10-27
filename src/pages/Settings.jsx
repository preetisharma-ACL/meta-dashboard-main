import { createSignal, createEffect, Show, onMount } from "solid-js";
import {
  Mail,
  Phone,
  KeyRound,
  Lock,
  User,
  Building2,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Check,
  Settings2,
} from "lucide-solid";
import { currentUser, loadCurrentUser } from "../stores/currentUser";
import { updateMyProfile } from "../services/userProfile";
import { setHeaderCache } from "../cacheStore/appStore";
import { showToast } from "../components/common/SuccessToast";
import { collectFieldErrors, errorBanner } from "../utils/apiErrors";

// ─── Settings → Profile ───────────────────────────────────────────────────────
// Reached from the header avatar menu ("Profile Settings"). The card is seeded
// from the /auth/me store, not typed in: before this it showed one hardcoded
// person's name and email to everyone who opened it.
//
// What is editable is deliberately narrow — the two contact fields the user
// owns. Name, organisation and role are shown but locked: username is the
// display identity the header and audit trails key on, and the other two are
// assignments made BY the business, not personal details.
//
// Email is also the login identifier (POST /auth/login/ takes {email,
// password}), so changing it is a credential change: the form asks for the
// current password only once the email differs from what is on record, and
// sends it only then. The server re-verifies it, lower-cases the email,
// enforces uniqueness, keeps the session alive (the token is keyed by id)
// and mails the OLD address. Phone is User.phone, served as data.phone (""
// when unset) — the only key read here, no aliases. Contract and live
// confirmation (backend 16bc718): PROFILE_SETTINGS_API_REQUIREMENTS.md.
//
// Not here by decision: a change-password section (R4 declined).
//
// Look: brand crimson (#AC2334) → gold (#D89A2B), the same run the sidebar
// rail and scrollbar use, over the page's marigold/lavender wash. Inputs use
// their own classes rather than .input-field — the unlayered .input-field rule
// in index.css would beat Tailwind utilities on padding and background.

const ROLE_LABEL = {
  admin: "Admin",
  campaign_manager: "Campaign Manager",
  client: "Client",
  sales: "Sales",
  coordination: "Coordination",
  accounts: "Accounts",
  creative: "Creative",
};
const roleLabel = (r) => ROLE_LABEL[r] ?? (r ? String(r) : "—");

const TIER_LABEL = { tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Permissive on purpose: +, digits, spaces, dashes, brackets; 7–15 digits in
// total. The backend owns the real rule and its message is shown verbatim.
const digitsOf = (s) => (s.match(/\d/g) || []).length;
const PHONE_CHARS_RE = /^[+\d\s()-]*$/;

const clean = (v) => (v == null ? "" : String(v).trim());

// Same rule as the header avatar, so both show the same letters.
const initialsOf = (name) => {
  if (!name) return "?";
  if (name.includes("@")) return name.charAt(0).toUpperCase();
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
};

const LABEL_CLS =
  "block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400 mb-2";

export default function Settings() {
  // Values on record, as last loaded. The form diffs against these so only
  // changed keys go over the wire.
  const onRecord = () => ({
    email: clean(currentUser.email),
    phone: clean(currentUser.raw?.phone),
  });

  const [email, setEmail] = createSignal("");
  const [phone, setPhone] = createSignal("");
  const [currentPassword, setCurrentPassword] = createSignal("");

  const [saving, setSaving] = createSignal(false);
  const [fieldErrors, setFieldErrors] = createSignal({});
  const [banner, setBanner] = createSignal(null); // { tone: "error"|"info", text }
  const [seeded, setSeeded] = createSignal(false);

  const emailChanged = () => clean(email()) !== onRecord().email;
  const phoneChanged = () => clean(phone()) !== onRecord().phone;
  const dirty = () => emailChanged() || phoneChanged();

  onMount(() => {
    loadCurrentUser();
  });

  // Seed the inputs the moment the store has a user, and re-seed after a
  // successful save (which force-reloads the store). Never while the user is
  // mid-edit: a background reload must not stomp on typed text.
  createEffect(() => {
    if (!currentUser.loaded) return;
    const rec = onRecord();
    if (!seeded() || !dirty()) {
      setEmail(rec.email);
      setPhone(rec.phone);
      setSeeded(true);
    }
  });

  const reset = () => {
    const rec = onRecord();
    setEmail(rec.email);
    setPhone(rec.phone);
    setCurrentPassword("");
    setFieldErrors({});
    setBanner(null);
  };

  const validate = () => {
    const errs = {};
    const e = clean(email());
    const p = clean(phone());
    if (!e) errs.email = "Email is required.";
    else if (!EMAIL_RE.test(e)) errs.email = "Enter a valid email address.";
    if (p) {
      if (!PHONE_CHARS_RE.test(p))
        errs.phone = "Use digits, spaces, +, - or brackets only.";
      else if (digitsOf(p) < 7 || digitsOf(p) > 15)
        errs.phone = "Enter a phone number with 7 to 15 digits.";
    }
    if (emailChanged() && !currentPassword())
      errs.current_password =
        "Enter your current password to change your email.";
    return errs;
  };

  const save = async (ev) => {
    ev?.preventDefault?.();
    if (saving() || !dirty()) return;
    setBanner(null);

    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    const patch = {};
    const changingEmail = emailChanged();
    if (changingEmail) {
      patch.email = clean(email());
      patch.current_password = currentPassword();
    }
    if (phoneChanged()) patch.phone = clean(phone());

    setSaving(true);
    try {
      const res = await updateMyProfile(patch);
      // api() resolves undefined only on the soft-logout path (refresh
      // failed); the app is already navigating to /login.
      if (!res) return;

      await loadCurrentUser(true);
      // The header reads its own cached copy of /auth/me — keep it in step so
      // the new email shows in the avatar menu without a reload.
      setHeaderCache("user", currentUser.raw);

      setCurrentPassword("");
      setFieldErrors({});
      showToast(
        changingEmail
          ? "Your profile was updated. Use your new email next time you sign in."
          : "Your profile was updated.",
        "Profile saved",
      );
    } catch (err) {
      // 400 { error:{ fields:{ email | phone | current_password } } } — the
      // server's wording names the actual reason ("A user with this email
      // already exists.", "Current password is incorrect."), so it is pinned
      // to the input verbatim and never paraphrased.
      const pinned = collectFieldErrors(err);
      setFieldErrors(pinned);
      setBanner({
        tone: "error",
        text: errorBanner(err, pinned, "Couldn't save your profile."),
      });
    } finally {
      setSaving(false);
    }
  };

  const cmTierLine = () => {
    const cp = currentUser.cmProfile;
    if (!cp?.tier) return null;
    const t = TIER_LABEL[cp.tier] ?? cp.tier;
    return cp.is_active === false ? `${t} · inactive` : t;
  };

  const fieldErr = (k) => fieldErrors()[k];
  const inputCls = (k) =>
    "w-full h-12 rounded-xl border pl-11 pr-4 text-[15px] outline-none transition " +
    "bg-white/80 dark:bg-gray-900/60 text-gray-900 dark:text-gray-100 " +
    "placeholder:text-gray-400 dark:placeholder:text-gray-500 " +
    "disabled:opacity-60 disabled:cursor-not-allowed " +
    (fieldErr(k)
      ? "border-[#AC2334] ring-4 ring-[#AC2334]/10"
      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 " +
        "focus:border-[#D89A2B] focus:ring-4 focus:ring-[#D89A2B]/15");
  const iconCls = (k) =>
    `pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] ${
      fieldErr(k) ? "text-[#AC2334]" : "text-gray-400 dark:text-gray-500"
    }`;

  const ErrorLine = (p) => (
    <p class="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[#AC2334] dark:text-red-400">
      <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
      {p.children}
    </p>
  );

  // One read-only fact in the Account panel: icon, label, value, lock.
  const LockedRow = (p) => (
    <div class="flex items-center gap-3.5 py-3.5">
      <div class="w-10 h-10 shrink-0 rounded-xl bg-[#FBF3E6] dark:bg-amber-900/20 text-[#B57C1A] dark:text-amber-300 flex items-center justify-center">
        {p.icon}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">
          {p.label}
        </p>
        <p
          class="mt-0.5 truncate text-[15px] font-medium text-gray-900 dark:text-gray-100"
          title={p.value}
        >
          {p.value}
        </p>
      </div>
      <Lock class="w-4 h-4 shrink-0 text-gray-300 dark:text-gray-600" />
    </div>
  );

  return (
    <div class="p-4 sm:p-6 max-w-6xl">
      {/* Same heading treatment as the other pages: crimson→gold tile,
          gradient wordmark, and the description indented by tile (36px) +
          gap (10px) so it starts under the heading text. */}
      <div class="mb-6">
        <h1 class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
          <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
            <Settings2 class="w-5 h-5" stroke-width={2} />
          </span>
          <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
            Settings
          </span>
        </h1>
        <p class="pl-[46px] text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Manage your account settings and preferences
        </p>
      </div>

      <Show
        when={currentUser.loaded}
        fallback={
          <div class="rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 p-8 shadow-sm">
            <Show
              when={currentUser.error}
              fallback={
                <div class="flex items-center gap-4 animate-pulse">
                  <div class="w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-700" />
                  <div class="space-y-2.5">
                    <div class="h-4 w-44 rounded bg-gray-200 dark:bg-gray-700" />
                    <div class="h-3 w-60 rounded bg-gray-200 dark:bg-gray-700" />
                    <span class="sr-only">Loading your profile…</span>
                  </div>
                </div>
              }
            >
              <p class="flex items-center gap-2 text-sm font-medium text-[#AC2334] dark:text-red-400">
                <AlertTriangle class="w-4 h-4" />
                Couldn't load your profile. {currentUser.error}
              </p>
            </Show>
          </div>
        }
      >
        {/* ── Identity banner ─────────────────────────────────────────────── */}
        <section class="relative overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 shadow-sm backdrop-blur">
          <div class="h-24 sm:h-28 bg-[linear-gradient(115deg,#AC2334_0%,#C4552F_45%,#D89A2B_100%)] relative overflow-hidden">
            <div class="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_85%_20%,rgba(255,255,255,0.55),transparent_45%),radial-gradient(circle_at_10%_120%,rgba(255,255,255,0.35),transparent_40%)]" />
            {/* Layered waves running left → right; stretched to the band's
                width (preserveAspectRatio none) so they span any card size. */}
            <svg
              class="absolute inset-0 w-full h-full"
              viewBox="0 0 1200 120"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M0 70 C 150 30, 300 30, 450 62 S 750 105, 900 70 S 1100 30, 1200 50 L 1200 120 L 0 120 Z"
                fill="rgba(255,255,255,0.10)"
              />
              <path
                d="M0 92 C 180 60, 340 70, 520 92 S 860 120, 1020 88 S 1160 66, 1200 78 L 1200 120 L 0 120 Z"
                fill="rgba(255,255,255,0.12)"
              />
              <path
                d="M0 40 C 200 10, 380 75, 600 45 S 960 5, 1200 35"
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                stroke-width="1.5"
              />
              <path
                d="M0 55 C 220 25, 400 90, 620 60 S 980 20, 1200 50"
                fill="none"
                stroke="rgba(255,255,255,0.16)"
                stroke-width="1"
              />
            </svg>
          </div>
          <div class="px-5 sm:px-8 pb-6 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-6">
            <div class="relative -mt-8 sm:-mt-9 w-16 h-16 sm:w-[72px] sm:h-[72px] shrink-0 rounded-full p-[2.5px] bg-[linear-gradient(135deg,#AC2334,#D89A2B)] shadow-lg">
              <div class="w-full h-full rounded-full bg-white dark:bg-gray-800 flex items-center justify-center">
                <span class="text-xl sm:text-2xl font-bold bg-[linear-gradient(135deg,#AC2334,#D89A2B)] bg-clip-text text-transparent">
                  {initialsOf(currentUser.username)}
                </span>
              </div>
            </div>
            <div class="min-w-0 flex-1 sm:pt-3">
              <h2
                class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate"
                title={currentUser.username ?? ""}
              >
                {currentUser.username ?? "—"}
              </h2>
              <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400 truncate">
                {currentUser.email ?? ""}
              </p>
            </div>
            <div class="flex flex-wrap gap-2 sm:pt-4">
              <span class="inline-flex items-center gap-1.5 rounded-full border border-[#AC2334]/20 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3 py-1 text-xs font-semibold text-[#AC2334] dark:text-red-300">
                <ShieldCheck class="w-3.5 h-3.5" />
                {roleLabel(currentUser.role)}
              </span>
              <Show when={cmTierLine()}>
                <span class="inline-flex items-center rounded-full border border-[#D89A2B]/30 bg-[#FBF3E6] dark:bg-amber-900/20 dark:border-amber-800 px-3 py-1 text-xs font-semibold text-[#9A6512] dark:text-amber-300">
                  {cmTierLine()}
                </span>
              </Show>
              <Show when={currentUser.organizationName}>
                <span class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-1 text-xs font-semibold text-gray-700 dark:text-gray-300">
                  <Building2 class="w-3.5 h-3.5" />
                  {currentUser.organizationName}
                </span>
              </Show>
            </div>
          </div>
        </section>

        <div class="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* ── Contact details (editable) ──────────────────────────────── */}
          <form
            class="lg:col-span-3 rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 shadow-sm backdrop-blur"
            onSubmit={save}
            novalidate
          >
            <div class="px-5 sm:px-7 pt-6 pb-5 border-b border-gray-100 dark:border-gray-700/70">
              <h3 class="text-lg font-bold text-gray-900 dark:text-white">
                Contact details
              </h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                How the team reaches you. Your email is also what you sign in
                with.
              </p>
            </div>

            <div class="px-5 sm:px-7 py-6 space-y-5">
              <Show when={banner()}>
                <div
                  role="alert"
                  class={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
                    banner().tone === "info"
                      ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                      : "border-[#AC2334]/25 bg-[#FBEEF0] text-[#8E1C2B] dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                  }`}
                >
                  <AlertTriangle class="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{banner().text}</span>
                </div>
              </Show>

              <div>
                <label for="profile-email" class={LABEL_CLS}>
                  Email address
                </label>
                <div class="relative">
                  <Mail class={iconCls("email")} />
                  <input
                    id="profile-email"
                    type="email"
                    autocomplete="email"
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                    disabled={saving()}
                    aria-invalid={!!fieldErr("email")}
                    class={inputCls("email")}
                  />
                </div>
                <Show when={fieldErr("email")}>
                  <ErrorLine>{fieldErr("email")}</ErrorLine>
                </Show>
                <Show when={emailChanged() && !fieldErr("email")}>
                  <p class="mt-2 rounded-lg bg-[#FBF3E6] dark:bg-amber-900/20 px-3 py-2 text-xs font-medium text-[#8A5A10] dark:text-amber-300">
                    You sign in with this email. After saving, use the new one
                    at the login screen.
                  </p>
                </Show>
              </div>

              {/* Only asked for when the email is actually changing. */}
              <Show when={emailChanged()}>
                <div>
                  <label for="profile-current-password" class={LABEL_CLS}>
                    Current password
                  </label>
                  <div class="relative">
                    <KeyRound class={iconCls("current_password")} />
                    <input
                      id="profile-current-password"
                      type="password"
                      autocomplete="current-password"
                      value={currentPassword()}
                      onInput={(e) => setCurrentPassword(e.currentTarget.value)}
                      disabled={saving()}
                      aria-invalid={!!fieldErr("current_password")}
                      class={inputCls("current_password")}
                    />
                  </div>
                  <Show
                    when={fieldErr("current_password")}
                    fallback={
                      <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                        Needed to confirm an email change.
                      </p>
                    }
                  >
                    <ErrorLine>{fieldErr("current_password")}</ErrorLine>
                  </Show>
                </div>
              </Show>

              <div>
                <label for="profile-phone" class={LABEL_CLS}>
                  Phone number
                </label>
                <div class="relative">
                  <Phone class={iconCls("phone")} />
                  <input
                    id="profile-phone"
                    type="tel"
                    autocomplete="tel"
                    inputmode="tel"
                    placeholder="+91 98765 43210"
                    value={phone()}
                    onInput={(e) => setPhone(e.currentTarget.value)}
                    disabled={saving()}
                    aria-invalid={!!fieldErr("phone")}
                    class={inputCls("phone")}
                  />
                </div>
                <Show when={fieldErr("phone")}>
                  <ErrorLine>{fieldErr("phone")}</ErrorLine>
                </Show>
              </div>
            </div>

            <div class="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 px-5 sm:px-7 py-4 rounded-b-2xl border-t border-gray-100 dark:border-gray-700/70 bg-gray-50/70 dark:bg-gray-900/30">
              <p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <Show
                  when={dirty()}
                  fallback={
                    <>
                      <Check class="w-3.5 h-3.5 text-emerald-600" />
                      All changes saved
                    </>
                  }
                >
                  <span class="w-2 h-2 rounded-full bg-[#D89A2B] animate-pulse" />
                  Unsaved changes
                </Show>
              </p>
              <div class="flex gap-3">
                <button
                  type="button"
                  class="h-10 px-5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={reset}
                  disabled={
                    saving() || (!dirty() && !currentPassword() && !banner())
                  }
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="h-10 px-6 inline-flex items-center gap-2 rounded-xl text-sm font-semibold text-white shadow-sm bg-[linear-gradient(115deg,#AC2334,#C4552F_60%,#D89A2B)] hover:shadow-md hover:brightness-105 transition disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100 disabled:cursor-not-allowed"
                  disabled={saving() || !dirty()}
                >
                  <Show when={saving()}>
                    <Loader2 class="w-4 h-4 animate-spin" />
                  </Show>
                  {saving() ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </form>

          {/* ── Account (set by the team, read-only) ────────────────────── */}
          <aside class="lg:col-span-2 rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 shadow-sm backdrop-blur">
            <div class="px-5 sm:px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700/70">
              <h3 class="text-lg font-bold text-gray-900 dark:text-white">
                Account
              </h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Set by the team and can't be changed here.
              </p>
            </div>
            <div class="px-5 sm:px-6 divide-y divide-gray-100 dark:divide-gray-700/70">
              <LockedRow
                icon={<User class="w-[18px] h-[18px]" />}
                label="Name"
                value={currentUser.username ?? "—"}
              />
              <LockedRow
                icon={<Building2 class="w-[18px] h-[18px]" />}
                label="Organisation"
                value={currentUser.organizationName ?? "—"}
              />
              <LockedRow
                icon={<ShieldCheck class="w-[18px] h-[18px]" />}
                label="Role"
                value={
                  cmTierLine()
                    ? `${roleLabel(currentUser.role)} · ${cmTierLine()}`
                    : roleLabel(currentUser.role)
                }
              />
            </div>
            <p class="mx-5 sm:mx-6 mb-6 mt-2 rounded-xl bg-gray-50 dark:bg-gray-900/40 px-4 py-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              Need one of these changed? Ask your admin to update it.
            </p>
          </aside>
        </div>
      </Show>
    </div>
  );
}
