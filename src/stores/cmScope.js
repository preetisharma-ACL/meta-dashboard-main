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
// Every other switch-mode-aware endpoint sends NO param in "own" mode (the
// backend doesn't support it there). as_team_member_id and scope=own are
// independent — "own" sends only scope=own, never both.
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

// Active when not on the default merged "My team" view.
export const isSwitched = () => ownScope() || asTeamMemberId() != null;

// Reactive token spanning all three modes. Components key their resources on
// this so they refetch on ANY mode change — "own" vs "team" doesn't change
// asTeamMemberId, so keying on that alone would miss the toggle.
export const scopeKey = () =>
  ownScope() ? "own" : asTeamMemberId() == null ? "team" : `member:${asTeamMemberId()}`;

// ─── Threading helpers ────────────────────────────────────────────────────────
// supportsOwn: pass true ONLY from the four list views that honour scope=own.

// Object-style: merge the scope param into a params object.
export const withScope = (params = {}, { supportsOwn = false } = {}) => {
  if (ownScope()) return supportsOwn ? { ...params, scope: "own" } : { ...params };
  const id = asTeamMemberId();
  return id == null ? { ...params } : { ...params, as_team_member_id: id };
};

// String-style: returns "&scope=own" / "&as_team_member_id=16" / "" to append to
// a URL that already has a query string.
export const scopeQuery = ({ supportsOwn = false } = {}) => {
  if (ownScope()) return supportsOwn ? "&scope=own" : "";
  const id = asTeamMemberId();
  return id == null ? "" : `&as_team_member_id=${id}`;
};

// Capture meta.viewing_as from any response so the "Viewing as…" banner stays in
// sync with what the server actually scoped to.
export const applyMeta = (meta) => {
  if (meta && meta.viewing_as) setViewingAs(meta.viewing_as);
};
