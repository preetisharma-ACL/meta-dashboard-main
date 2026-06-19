import { createSignal } from "solid-js";

// ─── CM switch-mode scope ─────────────────────────────────────────────────────
// When a Tier 1 CM "switches" to view as one of their team members, every
// data-fetching call must carry ?as_team_member_id=<uid>. This module is the
// single source of truth so no call forgets it. Module-level signals persist
// across route navigations (the app stays mounted); we also mirror to
// sessionStorage so the scope survives a hard reload within the session.

const SCOPE_KEY = "cm_as_team_member_id";

const initialScope = (() => {
  try {
    const raw = sessionStorage.getItem(SCOPE_KEY);
    return raw ? Number(raw) || null : null;
  } catch {
    return null;
  }
})();

// null = the Tier 1's own full view (own + team). A number = viewing as that member.
export const [asTeamMemberId, setAsTeamMemberIdRaw] = createSignal(initialScope);

// meta.viewing_as from the latest scoped response: { user_id, email, tier } | null
export const [viewingAs, setViewingAs] = createSignal(null);

export const setAsTeamMemberId = (id) => {
  const next = id == null ? null : Number(id);
  setAsTeamMemberIdRaw(next);
  try {
    if (next == null) sessionStorage.removeItem(SCOPE_KEY);
    else sessionStorage.setItem(SCOPE_KEY, String(next));
  } catch {}
  // Clear the stale banner immediately; the next scoped response repopulates it.
  if (next == null) setViewingAs(null);
};

export const clearScope = () => {
  setAsTeamMemberId(null);
  setViewingAs(null);
};

export const isSwitched = () => asTeamMemberId() != null;

// ─── Threading helpers ────────────────────────────────────────────────────────

// Object-style: merge the scope param into a params object for services that
// build query strings from objects.  withScope({ page: 1 }) →
// { page: 1, as_team_member_id: 16 }  (or unchanged when not switched).
export const withScope = (params = {}) => {
  const id = asTeamMemberId();
  return id == null ? { ...params } : { ...params, as_team_member_id: id };
};

// String-style: returns "&as_team_member_id=16" (or "") to append to a URL that
// already has a query string. Matches the existing `url += ...` service idiom.
export const scopeQuery = () => {
  const id = asTeamMemberId();
  return id == null ? "" : `&as_team_member_id=${id}`;
};

// Capture meta.viewing_as from any response so the "Viewing as…" banner stays
// in sync with what the server actually scoped to.
export const applyMeta = (meta) => {
  if (meta && meta.viewing_as) setViewingAs(meta.viewing_as);
};
