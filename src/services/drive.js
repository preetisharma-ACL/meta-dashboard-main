import { api } from "../api/api";

// ─── Google Drive, per client ─────────────────────────────────────────────────
// All under /clients/drive/ (same prefix as /clients/command/). Login required.
//
//   GET  drive/<nomen_id>/                 → the card
//   POST drive/<nomen_id>/refresh/         → 202 + the card
//   POST drive/<nomen_id>/create-folder/   → 202 + the card
//   POST drive/<nomen_id>/create-sheet/    → 202 + the card   body {confirm:true}
//   GET  drive/links/?nomen_ids=1,2,3      → { "1": url, "2": null }  (≤500 ids)
//   GET  drive/logs/?limit=100[&nomen_id=] → admin + coordination
//   GET  drive/missing/                    → admin + coordination
//
// nomen_id is the client's client_nomen id, NOT the Client PK.
//
// Who sees it: admin, coordination, and CMs for their own clients (the backend
// 404s a CM on anyone else's). Accounts, sales, creative and client logins
// never get the card.
//
// Errors on the buttons: 403 no create permission, 409 already working on
// this client, 503 Drive not set up. The backend's `detail` is the sentence.

export const DRIVE_ROLES = ["admin", "coordination", "campaign_manager"];
export const DRIVE_ADMIN_ROLES = ["admin", "coordination"];

export const POLL_MS = 3000;
export const LINKS_MAX = 500;

const authRole = () => {
  try {
    return JSON.parse(localStorage.getItem("auth") || "{}")?.role ?? null;
  } catch {
    return null;
  }
};
export const canSeeDrive = () => DRIVE_ROLES.includes(authRole());
export const canSeeDriveAdmin = () => DRIVE_ADMIN_ROLES.includes(authRole());

// The card and the links map are plain objects. If the server ever wraps them
// in the usual { success, data } envelope, take the inner object; nothing in
// either payload carries its own `success` key, so this can't misfire.
const unwrap = (res) =>
  res && typeof res === "object" && "success" in res && res.data !== undefined
    ? res.data
    : res;

const readList = (res) => {
  const d = unwrap(res);
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.results)) return d.results;
  console.error("[drive] expected a list of rows, got:", d);
  return [];
};

const base = (nomenId) => `/clients/drive/${encodeURIComponent(nomenId)}/`;

export const fetchDriveCard = async (nomenId) => unwrap(await api(base(nomenId)));

const post = async (nomenId, path, body) =>
  unwrap(
    await api(`${base(nomenId)}${path}/`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  );

export const refreshDrive = (nomenId) => post(nomenId, "refresh");
export const createDriveFolder = (nomenId) => post(nomenId, "create-folder");
// Never retried automatically: a retry after a slow-but-successful call would
// make a second sheet.
export const createDriveSheet = (nomenId) =>
  post(nomenId, "create-sheet", { confirm: true });

// { "<nomen_id>": url | null }. One call for a whole page of rows.
export const fetchDriveLinks = async (nomenIds) => {
  const ids = [...new Set(nomenIds.filter((x) => x != null && x !== "").map(String))];
  if (!ids.length) return {};
  const out = {};
  for (let i = 0; i < ids.length; i += LINKS_MAX) {
    const chunk = ids.slice(i, i + LINKS_MAX);
    const res = unwrap(
      await api(`/clients/drive/links/?nomen_ids=${chunk.join(",")}`),
    );
    Object.assign(out, res && typeof res === "object" ? res : {});
  }
  return out;
};

export const fetchDriveLogs = async ({ limit = 100, nomenId } = {}) => {
  const sp = new URLSearchParams({ limit: String(limit) });
  if (nomenId != null && nomenId !== "") sp.set("nomen_id", String(nomenId));
  return readList(await api(`/clients/drive/logs/?${sp}`));
};

export const fetchDriveMissing = async () =>
  readList(await api("/clients/drive/missing/"));

// ── Display helpers ───────────────────────────────────────────────────────────
export const ACTION_LABEL = {
  refresh: "Refreshing",
  create_folder: "Creating folder",
  "create-folder": "Creating folder",
  create_sheet: "Creating sheet",
  "create-sheet": "Creating sheet",
};
export const workingLabel = (action) =>
  ACTION_LABEL[action] ??
  (action ? String(action).replace(/[_-]+/g, " ") : "Working");

// The button errors. `detail` is what the backend says; the fallbacks only
// cover a body without one.
const ERROR_FALLBACK = {
  403: "You don't have permission to create in Google Drive for this client.",
  409: "Already working on this client. Please wait for it to finish.",
  503: "Google Drive is not set up on the server.",
};
export const driveErrorMessage = (err) => {
  const d = err?.data?.detail;
  if (typeof d === "string" && d) return d;
  return ERROR_FALLBACK[err?.status] ?? err?.message ?? "Something went wrong.";
};

export const timeAgo = (iso, now = Date.now()) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.round(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
};
