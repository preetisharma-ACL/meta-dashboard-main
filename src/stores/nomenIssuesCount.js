import { createSignal } from "solid-js";
import { canSeeNomenIssues, fetchNomenIssues } from "../services/nomenIssues";

// ─── Open nomen-issue count ───────────────────────────────────────────────────
// One number, three readers: the sidebar badge, the Coordination desk card and
// the CM dashboard banner. Fetched once when the sidebar mounts (no polling: the
// check itself runs on the server's schedule), again when a reader mounts, and
// set directly by the Nomen issues page whenever it loads the open tab.
//
// null = not known yet. Gated on role: every role outside admin / coordination /
// campaign_manager 403s, so they never call it.
const [nomenIssuesOpen, setNomenIssuesOpen] = createSignal(null);
export { nomenIssuesOpen, setNomenIssuesOpen };

let inFlight = null;

export const refreshNomenIssuesCount = async () => {
  if (!canSeeNomenIssues()) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      setNomenIssuesOpen((await fetchNomenIssues("open")).count);
    } catch (err) {
      // Keep the last number: a vanished badge would read as "nothing wrong".
      console.warn("[nomen issues] count refresh failed:", err?.message);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};
