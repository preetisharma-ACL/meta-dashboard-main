import { api } from "../api/api";
import {
  DEFAULT_PRESET,
  rangeKeyOf,
  derivePagination,
  paginationDisagrees,
  CACHE_TTL_MS,
} from "./commandRules";

// ─── Command page: the fetch ──────────────────────────────────────────────────
// GET /clients/command/ — one row per client, every operational number the desk
// asks for in the morning, over a date range they pick.
//
// The rules this screen applies — what a null premium_spend means, how a balance
// source reads, how every figure is formatted — live in ./commandRules, which
// imports nothing and is therefore checkable by scripts/verify-command-flag.mjs.
// This file only knows how to ask the server.
//
// ADMIN + COORDINATION ONLY. The endpoint 403s everyone else, so the route gate
// on the page only decides whether to offer the screen — it is not the security
// boundary, as everywhere else in this app.
//
// EVERYTHING IS A SERVER PARAM — sort, filter, search, page. That is not a
// preference, it is correctness: the response is one page of a larger set, so
// narrowing or reordering the rows in hand would describe a slice while the
// header claimed to describe the set. The one exception is called out and
// labelled where it happens (the config-gap tally on the page).
//
// TIMING. The first call for a given date range takes ~14s; the server caches it
// for five minutes and everything after that — re-sorting, filtering, paging,
// searching — is ~0.1s off that cached set. So the page is slow to open once and
// instant thereafter, and the loading state has to say which of the two is
// happening rather than show a spinner that reads as stuck.

// ── Server cache warmth (a guess, never a fact) ───────────────────────────────
// We cannot read the server's cache, so we track what this tab has already asked
// for and assume the documented lifetime (900s — see CACHE_TTL_MS). This is only
// half the picture: a refresh task also warms the named presets every ten
// minutes, so a preset can be warm without this tab ever having touched it.
// expectColdLoad() in commandRules is where those two facts are combined.
//
// All of it only steers the wording of the loading state, and the page escalates
// on elapsed time regardless, which is the signal that can't be wrong.
const warmUntil = new Map();

export const isRangeWarm = (key) => (warmUntil.get(key) ?? 0) > Date.now();

// ── Query ─────────────────────────────────────────────────────────────────────
const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

// ── The envelope, verified against the live payload (186 rows) ───────────────
//   { success, message, data: [ ...rows... ], meta: { pagination, range, totals } }
//
// `data` IS the array — not data.clients, not data.results — and `meta` is a
// TOP-LEVEL sibling of it, not nested inside. This reader used to try four row
// keys and two meta positions, written before anyone had seen a response. Now
// that the shape is known, those branches could never fire, and keeping them
// would be worse than useless: if the payload ever did move the rows to
// data.clients, a fallback would quietly find them while `meta` moved out from
// under the paginator and the totals strip — a half-broken page reporting
// confident numbers. Failing loudly is the more useful answer.
const readRows = (res) => {
  const d = res?.data;
  if (Array.isArray(d)) return d;
  console.error(
    "[command] /clients/command/ data is no longer an array of client rows —",
    "the envelope has changed and meta.pagination/meta.totals have probably",
    "moved with it. Got:",
    d,
  );
  return [];
};

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// meta.pagination = { page, page_size, total, pages }. The derivation — which
// key means what, and how has_next/has_prev are computed from fields the server
// doesn't send — lives in commandRules so it can be asserted; this only locates
// the block in the envelope.
const readPagination = (res, rowCount) => {
  const p = res?.meta?.pagination ?? null;
  if (paginationDisagrees(p)) {
    console.warn(
      "[command] meta.pagination.pages disagrees with total/page_size —",
      "the paginator will offer pages that come back empty. Got:",
      p,
    );
  }
  return derivePagination(p, rowCount);
};

// meta.totals covers clients, leads, raw_spend, premium_spend, daily_budget.
//
// BALANCE IS NOT IN HERE AND MUST NOT BE ADDED. A CPL client bills per qualified
// lead with no service charge and no GST; a hybrid bills on spend plus both.
// Adding those two columns produces a number that describes nothing — not what
// anyone owes, not what we would invoice. The server declines to total it for
// that reason; deriving it here would just move the meaningless number.
const readTotals = (res) => {
  const t = res?.meta?.totals ?? {};
  return {
    clients: num(t.clients),
    leads: num(t.leads),
    raw_spend: num(t.raw_spend),
    premium_spend: num(t.premium_spend),
    daily_budget: num(t.daily_budget),
  };
};

// meta.range = { since, until }, both ISO, always present, resolved server-side
// in Asia/Kolkata. This is the window the figures were actually computed over —
// authoritative, and not re-derivable here: "last7" is the server's arithmetic
// in its own timezone, and a browser recomputing it would sometimes disagree
// with the numbers it was labelling.
const readRange = (res) => {
  const r = res?.meta?.range ?? null;
  if (!r?.since || !r?.until) return null;
  return { since: r.since, until: r.until };
};

// Projects arrive sorted biggest-budget-first. Normalised for shape only, never
// re-ordered: the server chose the order and the UI says whose order it is.
const normaliseProjects = (row) => {
  const list = Array.isArray(row?.projects) ? row.projects : [];
  return list.map((p) => ({
    project_id: p?.project_id ?? p?.id ?? null,
    project_name: p?.project_name ?? p?.name ?? null,
    daily_budget: num(p?.daily_budget),
  }));
};

const normaliseRow = (row) => {
  const projects = normaliseProjects(row);
  return {
    ...row,
    client_type: String(row?.client_type ?? "").toLowerCase() || null,
    // Kept strictly true / false / null. Coercing an absent key to false would
    // mark every client dormant — see deliveryState in commandRules.
    delivered_last_7d:
      row?.delivered_last_7d === true
        ? true
        : row?.delivered_last_7d === false
          ? false
          : null,
    projects,
    project_count: num(row?.project_count) ?? projects.length,
    daily_budget: num(row?.daily_budget),
    active_campaigns: num(row?.active_campaigns),
    ad_accounts: num(row?.ad_accounts),
    leads: num(row?.leads),
    raw_spend: num(row?.raw_spend),
    raw_cpl: num(row?.raw_cpl),
    // Stays a raw null-or-number. WHICH of the two it is drives the config-gap
    // flag in commandRules, so it must not be coerced anywhere on the way here.
    premium_spend: num(row?.premium_spend),
    balance_inc_gst: num(row?.balance_inc_gst),
  };
};

// filters: { preset, start, end, sort, dir, type, q, activeOnly, page, pageSize }
//
// `activeOnly` sends ?active_only=true and drops clients with no leads and no
// spend in the last SEVEN days — a fixed window, independent of preset/start/end.
// Sent only when true: ?active_only=false is not a documented value, and an
// undocumented param is a guess.
// `start`/`end` go only with preset === "custom"; sending them alongside a named
// preset would leave the server to pick a winner we can't predict.
export const fetchCommandBoard = async (filters = {}) => {
  const preset = filters.preset ?? DEFAULT_PRESET;
  const custom = preset === "custom";
  const res = await api(
    `/clients/command/${qs({
      preset,
      start: custom ? filters.start : null,
      end: custom ? filters.end : null,
      sort: filters.sort,
      dir: filters.dir,
      type: filters.type,
      q: filters.q,
      active_only: filters.activeOnly ? "true" : null,
      page: filters.page,
      page_size: filters.pageSize ?? filters.page_size,
    })}`,
    { method: "GET" },
  );

  warmUntil.set(
    rangeKeyOf({ preset, start: filters.start, end: filters.end }),
    Date.now() + CACHE_TTL_MS,
  );

  const rows = readRows(res);
  return {
    rows: rows.map(normaliseRow),
    pagination: readPagination(res, rows.length),
    totals: readTotals(res),
    range: readRange(res),
  };
};
