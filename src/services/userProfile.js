import { api } from "../api/api";

// ─── The logged-in user's own record ─────────────────────────────────────────
// GET /auth/me/ answers { success, data: { id, email, username, phone,
// organization_id, organization_name, role, cm_profile, is_superuser } } — the
// body every gate in stores/currentUser reads. phone is "" when unset.
//
// Editing it: PATCH on the same route (OPTIONS /auth/me/ → `Allow: GET, PATCH,
// HEAD, OPTIONS`, verified live 26 Oct 2026, backend 16bc718). The contract
// and the server's exact rules are in PROFILE_SETTINGS_API_REQUIREMENTS.md.

// ✅ Fetch logged-in user data
export const fetchUser = async () => {
  return await api("/auth/me", {
    method: "GET",
  });
};

// PATCH /auth/me/ — change your own contact details.
//
// patch is a partial: { email?, phone?, current_password? }. Only the keys the
// user actually changed are sent, so an untouched field can never be
// overwritten with a stale value. current_password rides along ONLY when the
// email changes — email is the login identifier (POST /auth/login/ takes
// {email, password}), so changing it is a credential change and the backend
// is asked to re-verify the password before accepting it.
export const updateMyProfile = async (patch) => {
  return await api("/auth/me/", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
};
