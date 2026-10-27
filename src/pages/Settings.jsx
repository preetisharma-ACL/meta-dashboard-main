import { createSignal, createEffect, Show, onMount } from "solid-js";
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
    `input-field ${fieldErr(k) ? "border-red-500 focus:ring-red-400" : ""}`;

  return (
    <div class="p-6 max-w-4xl">
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p class="text-gray-600 dark:text-gray-400 mt-1">
          Manage your account settings and preferences
        </p>
      </div>

      <div class="space-y-6">
        {/* Profile Settings */}
        <form class="card p-6" onSubmit={save} novalidate>
          <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-1">
            Profile Settings
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">
            Your contact details. Name, organisation and role are set by the team
            and can't be changed here.
          </p>

          <Show
            when={currentUser.loaded}
            fallback={
              <Show
                when={currentUser.error}
                fallback={
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    Loading your profile…
                  </p>
                }
              >
                <p class="text-sm text-red-600 dark:text-red-400">
                  Couldn't load your profile. {currentUser.error}
                </p>
              </Show>
            }
          >
            <Show when={banner()}>
              <div
                role="alert"
                class={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                  banner().tone === "info"
                    ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                    : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                }`}
              >
                {banner().text}
              </div>
            </Show>

            <div class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    value={currentUser.username ?? ""}
                    readOnly
                    disabled
                    class="input-field opacity-70 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label
                    for="profile-email"
                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Email
                  </label>
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
                  <Show when={fieldErr("email")}>
                    <p class="mt-1 text-xs text-red-600 dark:text-red-400">
                      {fieldErr("email")}
                    </p>
                  </Show>
                  <Show when={emailChanged() && !fieldErr("email")}>
                    <p class="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      You sign in with this email. After saving, use the new one
                      at the login screen.
                    </p>
                  </Show>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    for="profile-phone"
                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Phone
                  </label>
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
                  <Show when={fieldErr("phone")}>
                    <p class="mt-1 text-xs text-red-600 dark:text-red-400">
                      {fieldErr("phone")}
                    </p>
                  </Show>
                </div>

                {/* Only asked for when the email is actually changing. */}
                <Show when={emailChanged()}>
                  <div>
                    <label
                      for="profile-current-password"
                      class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Current password
                    </label>
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
                    <Show
                      when={fieldErr("current_password")}
                      fallback={
                        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Needed to confirm an email change.
                        </p>
                      }
                    >
                      <p class="mt-1 text-xs text-red-600 dark:text-red-400">
                        {fieldErr("current_password")}
                      </p>
                    </Show>
                  </div>
                </Show>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Organisation
                  </label>
                  <input
                    type="text"
                    value={currentUser.organizationName ?? "—"}
                    readOnly
                    disabled
                    class="input-field opacity-70 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Role
                  </label>
                  <input
                    type="text"
                    value={
                      cmTierLine()
                        ? `${roleLabel(currentUser.role)} · ${cmTierLine()}`
                        : roleLabel(currentUser.role)
                    }
                    readOnly
                    disabled
                    class="input-field opacity-70 cursor-not-allowed"
                  />
                </div>
              </div>

              <div class="flex gap-3 pt-4">
                <button
                  type="submit"
                  class="btn-primary bg-blue-900 hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-900"
                  disabled={saving() || !dirty()}
                >
                  {saving() ? "Saving…" : "Save Changes"}
                </button>
                <button
                  type="button"
                  class="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={reset}
                  disabled={
                    saving() || (!dirty() && !currentPassword() && !banner())
                  }
                >
                  Cancel
                </button>
              </div>
            </div>
          </Show>
        </form>
      </div>
    </div>
  );
}
