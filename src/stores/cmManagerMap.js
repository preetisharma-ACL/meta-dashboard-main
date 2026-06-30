import { createSignal } from "solid-js";

// ─── Client-nomen → owning campaign-manager map ───────────────────────────────
// The hierarchy endpoint doesn't say WHICH campaign manager owns each client, so
// in the admin "Campaign Managers → Full team" view the merged client list mixes
// several CMs' clients with no way to tell them apart. The admin screen builds
// this map (by unioning every manager's scope=own client list) and the hierarchy
// reads it to render a coloured CM tag per client row.
//
// Shape: { [String(nomen_id)]: { label, id } }. Empty by default — populated only
// by the admin screen, so for normal CM logins the hierarchy renders no tags.

export const [clientManagerMap, setClientManagerMap] = createSignal({});

export const lookupManager = (nomenId) =>
  clientManagerMap()[String(nomenId)] ?? null;

export const clearClientManagerMap = () => setClientManagerMap({});

// A stable, distinct chip colour per manager. Hash the key (manager id/label) so
// the same manager always gets the same colour across rows and renders. Full
// literal class strings so Tailwind's content scan keeps them.
const PALETTE = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
];

export const managerColor = (key) => {
  const s = String(key ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
