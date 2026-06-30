import { createSignal } from "solid-js";

// ─── CM switch-mode scope ─────────────────────────────────────────────────────
// A Tier 1 lead can view their data three ways. This module is the single source
// of truth for the scope so no call forgets the right param:
//
//   • "My team (everyone)"  → no param          (own + all team members, merged)
//   • "Just me"             → ?scope=own        (the lead's OWN clients only)
//   • a specific member     → ?as_team_member_id=<id>
//
// scope=own is honoured ONLY by the four switch-mode-aware list views (hierarchy,
// funding, cpl-rules, allowed-budget). Those services pass { supportsOwn: true }.
// Every other switch-mode-aware endpoint sends NO scope=own param (the backend
// doesn't support it there).
//
// For a Tier-1 lead the three modes above are mutually exclusive. The admin
// "Campaign Managers" screen adds a 4th combination via setManagerScope(): a
// selected manager PLUS an own/team choice FOR THAT MANAGER —
// ?as_team_member_id=<id>&scope=own (manager's own clients) vs
// ?as_team_member_id=<id> (manager + their team). So as_team_member_id and
// scope=own CAN be sent together; the query builders below emit whichever of the
// two are active.
//
// Module-level signals persist across route navigations (the app stays mounted);
// we also mirror to sessionStorage so the scope survives a hard reload.

const MEMBER_KEY = "cm_as_team_member_id";
const OWN_KEY = "cm_scope_own";

const initialMember = (() => {
  try {
    const raw = sessionStorage.getItem(MEMBER_KEY);
    return raw ? Number(raw) || null : null;
  } catch {
    return null;
  }
})();
const initialOwn = (() => {
  try {
    return sessionStorage.getItem(OWN_KEY) === "1";
  } catch {
    return false;
  }
})();

// member id (number) or null. null = not viewing a specific member.
export const [asTeamMemberId, setAsTeamMemberIdRaw] = createSignal(initialMember);
// true when in "Just me" (scope=own) mode.
export const [ownScope, setOwnScopeRaw] = createSignal(initialOwn);
// meta.viewing_as from the latest scoped response: { user_id, email, tier } | null
export const [viewingAs, setViewingAs] = createSignal(null);

const persist = () => {
  try {
    const id = asTeamMemberId();
    if (id == null) sessionStorage.removeItem(MEMBER_KEY);
    else sessionStorage.setItem(MEMBER_KEY, String(id));
    if (ownScope()) sessionStorage.setItem(OWN_KEY, "1");
    else sessionStorage.removeItem(OWN_KEY);
  } catch {}
};

// ─── Mode setters (the three modes are mutually exclusive) ────────────────────

// View as a specific team member (id), or pass null to fall back to "My team".
export const setAsTeamMemberId = (id) => {
  const next = id == null ? null : Number(id);
  setOwnScopeRaw(false);
  setAsTeamMemberIdRaw(next);
  if (next == null) setViewingAs(null);
  persist();
};

// "Just me" — the lead's own clients only.
export const setOwnScope = () => {
  setAsTeamMemberIdRaw(null);
  setOwnScopeRaw(true);
  setViewingAs(null);
  persist();
};

// "My team (everyone)" — the merged default.
export const setTeamScope = () => {
  setAsTeamMemberIdRaw(null);
  setOwnScopeRaw(false);
  setViewingAs(null);
  persist();
};

export const clearScope = () => setTeamScope();

// Admin "Campaign Managers" combo: view as a specific manager WITH an own/team
// sub-toggle for that manager. Unlike the Tier-1 modes (own/member mutually
// exclusive), this sets BOTH signals so scoped calls carry as_team_member_id and,
// when own, scope=own too.
//   setManagerScope(133, true)  → ?as_team_member_id=133&scope=own  (own clients)
//   setManagerScope(133, false) → ?as_team_member_id=133            (manager + team)
//   setManagerScope(null)       → falls back to "My team"
export const setManagerScope = (id, own = true) => {
  const next = id == null ? null : Number(id);
  setAsTeamMemberIdRaw(next);
  setOwnScopeRaw(next == null ? false : !!own);
  setViewingAs(null);
  persist();
};

// Active when not on the default merged "My team" view.
export const isSwitched = () => ownScope() || asTeamMemberId() != null;

// Reactive token spanning every mode/combination. Components key their resources
// on this so they refetch on ANY mode change — toggling own/team while a member
// is selected doesn't change asTeamMemberId, so keying on that alone would miss
// the toggle (and switching managers while in own mode must re-key too).
export const scopeKey = () => {
  const id = asTeamMemberId();
  const parts = [];
  if (id != null) parts.push(`member:${id}`);
  if (ownScope()) parts.push("own");
  return parts.join("|") || "team";
};

// ─── Threading helpers ────────────────────────────────────────────────────────
// supportsOwn: pass true ONLY from the four list views that honour scope=own.

// Object-style: merge the active scope params into a params object. Emits
// as_team_member_id when a member is selected, and scope=own when in own mode on
// a supportsOwn endpoint — independently, so the admin member+own combo sends
// both. (Tier-1 modes only ever activate one, so their output is unchanged.)
export const withScope = (params = {}, { supportsOwn = false } = {}) => {
  const out = { ...params };
  const id = asTeamMemberId();
  if (id != null) out.as_team_member_id = id;
  if (ownScope() && supportsOwn) out.scope = "own";
  return out;
};

// String-style: returns the active params as "&as_team_member_id=16&scope=own"
// (any subset, or "") to append to a URL that already has a query string.
export const scopeQuery = ({ supportsOwn = false } = {}) => {
  const id = asTeamMemberId();
  let q = "";
  if (id != null) q += `&as_team_member_id=${id}`;
  if (ownScope() && supportsOwn) q += "&scope=own";
  return q;
};

// Capture meta.viewing_as from any response so the "Viewing as…" banner stays in
// sync with what the server actually scoped to.
export const applyMeta = (meta) => {
  if (meta && meta.viewing_as) setViewingAs(meta.viewing_as);
};
