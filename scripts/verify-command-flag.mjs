// Checks the Command page's premium-spend rule, clause by clause against the
// spec it was written from. Run: node scripts/verify-command-flag.mjs
//
// The rule is one line of code and the whole point of the screen: premium_spend
// arrives null for two unrelated reasons, and showing them the same way turns a
// real alarm into wallpaper. The cases that matter most are the ones where the
// flag must NOT fire — a retainer is null by design, and there are far more
// retainers than gaps, so a false positive there buries every true one.
//
// Imports the real module; no copied logic. commandRules.js imports nothing,
// which is what makes this runnable outside a browser — if it ever grows an
// `api` import, this file stops working and that is the intended alarm.

import {
  premiumSpendState,
  isConfigGap,
  PREMIUM,
  balanceSourceNote,
  isUnrecorded,
  rangeKeyOf,
  isoDate,
  fmtRange,
  derivePagination,
  paginationDisagrees,
  deliveryState,
  isDormant,
  DELIVERY,
  DELIVERY_WINDOW_DAYS,
  DELIVERY_WINDOW_LABEL,
  expectColdLoad,
  CACHE_TTL_MINUTES,
  CACHE_TTL_MS,
  inr,
  count,
  asList,
  DASH,
} from "../src/services/commandRules.js";

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`);
  if (!cond) failures++;
};

console.log("\na retainer's null is by design — never the flag");
{
  const row = { client_type: "retainer", premium_spend: null };
  check("reads as n/a", premiumSpendState(row) === PREMIUM.NA);
  check("does NOT count as a config gap", isConfigGap(row) === false);
}

console.log("\na cpl or hybrid null IS the flag");
for (const type of ["cpl", "hybrid"]) {
  const row = { client_type: type, premium_spend: null };
  check(`${type}: reads as a gap`, premiumSpendState(row) === PREMIUM.GAP);
  check(`${type}: counts as a config gap`, isConfigGap(row) === true);
}

console.log("\na value is a value, whatever the type");
for (const type of ["cpl", "hybrid", "retainer"]) {
  check(
    `${type}: a number reads as a value`,
    premiumSpendState({ client_type: type, premium_spend: 41250 }) ===
      PREMIUM.VALUE,
  );
}

console.log("\nzero is a number, not an absence");
{
  // The trap: `if (!row.premium_spend)` would call a priced client with no spend
  // in the window an unpriced one, and put a warning on a row that is fine.
  const row = { client_type: "cpl", premium_spend: 0 };
  check("0 reads as a value, not a gap", premiumSpendState(row) === PREMIUM.VALUE);
  check("0 is not a config gap", isConfigGap(row) === false);
  check("0 prints as ₹0, not a dash", inr(0) === "₹0");
  check("0 counts as 0, not a dash", count(0) === "0");
}

console.log("\nno client type → say so; never guess either way");
{
  // Documented as present on every row, so this should never happen. If it does,
  // inventing an alarm and hiding a real one are both worse than a question mark.
  for (const type of [null, undefined, "", "something_new"]) {
    const row = { client_type: type, premium_spend: null };
    check(
      `${JSON.stringify(type)} → unknown`,
      premiumSpendState(row) === PREMIUM.UNKNOWN,
    );
    check(
      `${JSON.stringify(type)} → not silently flagged`,
      isConfigGap(row) === false,
    );
  }
}

console.log("\nthe live census — 186 rows, as served on 2026-09-18");
{
  // Not a hypothetical. This is the real distribution, and it is here because it
  // is the argument for the rule: the naive `!premium_spend` check would have
  // raised 64 warnings of which 35 were wrong, and a flag that cries wolf on
  // more than half its rows is ignored inside a week.
  const CENSUS = [
    ["cpl", 41250, 77], // priced, spent
    ["hybrid", 41250, 35],
    ["cpl", 0, 25], // priced, no spend in the window — NOT a gap
    ["hybrid", 0, 10],
    ["cpl", null, 24], // the real gap
    ["hybrid", null, 5],
    ["retainer", null, 10], // by design
  ];
  const rows = CENSUS.flatMap(([client_type, premium_spend, n]) =>
    Array.from({ length: n }, () => ({ client_type, premium_spend })),
  );

  check("the census is the whole book", rows.length === 186, `(${rows.length})`);

  const gaps = rows.filter(isConfigGap).length;
  const nas = rows.filter((r) => premiumSpendState(r) === PREMIUM.NA).length;
  const values = rows.filter((r) => premiumSpendState(r) === PREMIUM.VALUE).length;
  const unknowns = rows.filter(
    (r) => premiumSpendState(r) === PREMIUM.UNKNOWN,
  ).length;

  check("29 clients are genuinely unpriced", gaps === 29, `(${gaps})`);
  check("10 retainers read as n/a", nas === 10, `(${nas})`);
  check("147 carry a figure", values === 147, `(${values})`);
  check(
    "nothing is unknown — client_type is on every row today",
    unknowns === 0,
    `(${unknowns})`,
  );

  // The counterfactuals, asserted rather than asserted-about. premiumSpendState
  // makes TWO independent decisions, and there is a live cost to getting either
  // wrong. These are the numbers that tell anyone "simplifying" it what they'd
  // be buying.
  //
  // 1. Falsy instead of null, retainer branch still correct. This is the near
  //    miss — the code looks right and the bug is one character.
  const falsyOnly = rows.filter(
    (r) => r.client_type !== "retainer" && !r.premium_spend,
  ).length;
  check("a falsy check would have raised 64", falsyOnly === 64, `(${falsyOnly})`);
  check(
    "…of which 35 are priced clients with no spend in the window",
    falsyOnly - gaps === 35,
    `(${falsyOnly - gaps})`,
  );
  check(
    "…so more than half the flag is wrong, and the flag gets ignored",
    falsyOnly - gaps > gaps / 2,
  );

  // 2. Falsy AND no client_type branch — the version written without knowing
  //    retainers carry no configs. Worse again: 45 of 74.
  const fullyNaive = rows.filter((r) => !r.premium_spend).length;
  check(
    "dropping the retainer branch too would raise 74",
    fullyNaive === 74,
    `(${fullyNaive})`,
  );
  check(
    "…45 of them false — nearly two wrong for every one right",
    fullyNaive - gaps === 45,
    `(${fullyNaive - gaps})`,
  );
}

console.log("\nmissing values print as absence, not as zero");
{
  check("null money → dash", inr(null) === DASH);
  check("undefined money → dash", inr(undefined) === DASH);
  check("null count → dash", count(null) === DASH);
}

console.log("\nbalance_source explains the number it sits on");
{
  check(
    "stored payment",
    balanceSourceNote("explicit_payment_row").includes("recorded"),
  );
  check(
    "carried forward",
    balanceSourceNote("computed_from_previous_month").includes("last month"),
  );
  check("no history", balanceSourceNote("zero_no_history").includes("zero"));
  check(
    "an unknown source still says something true",
    balanceSourceNote("some_new_source").includes("some_new_source"),
  );
  check(
    "an absent source does not claim one",
    balanceSourceNote(null) === "Balance source not reported.",
  );
}

console.log("\nthe records' own gaps read as missing, not as data");
{
  check('"Not recorded yet" is absence', isUnrecorded("Not recorded yet"));
  check("case doesn't matter", isUnrecorded("not recorded YET"));
  check("empty is absence", isUnrecorded(""));
  check("whitespace is absence", isUnrecorded("   "));
  check("null is absence", isUnrecorded(null));
  check("a real name is not absence", isUnrecorded("Preeti Sharma") === false);
}

console.log("\na cached range is keyed by what actually varies");
{
  check(
    "a named preset keys on its name alone",
    rangeKeyOf({ preset: "last7", start: "2026-01-01", end: "2026-01-09" }) ===
      "last7",
    "(stray dates must not split the cache key: they aren't sent)",
  );
  check(
    "two custom ranges are different keys",
    rangeKeyOf({ preset: "custom", start: "2026-01-01", end: "2026-01-09" }) !==
      rangeKeyOf({ preset: "custom", start: "2026-02-01", end: "2026-02-09" }),
  );
}

console.log("\ndates are local, not UTC");
{
  // 11pm in an en-IN browser is still today. toISOString() would call it
  // tomorrow-minus-one and quietly shift a "today" filter by a day.
  const d = new Date(2026, 8, 18, 23, 30);
  check("late evening stays on its own date", isoDate(d) === "2026-09-18");
  check("single digits are padded", isoDate(new Date(2026, 0, 5)) === "2026-01-05");
}

console.log("\nthe loading state promises the right wait");
{
  // One cache, 900s, written by both the endpoint and the refresh task. It was
  // 300 from one and 900 from the other, so an entry's lifetime depended on who
  // wrote it. One constant here, quoted by the UI copy, so the number on screen
  // cannot drift from the number in the map.
  check("the TTL is 15 minutes", CACHE_TTL_MINUTES === 15);
  check("…and the ms form agrees", CACHE_TTL_MS === 15 * 60 * 1000);

  // The task refreshes every ten minutes, so named presets are warm
  // continuously. Presuming a preset cold because THIS TAB hadn't fetched it
  // put "about 15 seconds" on the most common event on the page — opening it —
  // for a wait of 0.1s.
  for (const preset of ["today", "yesterday", "last7", "last30", "this_month"]) {
    check(
      `${preset} on a cold tab is not warned about`,
      expectColdLoad({ preset, fetchedInThisTab: false }) === false,
    );
  }

  // Nothing pre-warms an arbitrary window, so the first call for one is a build
  // and the reader should be told.
  check(
    "a custom range not yet fetched IS a build",
    expectColdLoad({ preset: "custom", fetchedInThisTab: false }) === true,
  );
  check(
    "…but not a second time",
    expectColdLoad({ preset: "custom", fetchedInThisTab: true }) === false,
  );
}

console.log("\ndormancy is delivery, and a missing field is not dormancy");
{
  check(
    "delivered true → delivering",
    deliveryState({ delivered_last_7d: true }) === DELIVERY.DELIVERING,
  );
  check(
    "delivered false → dormant",
    deliveryState({ delivered_last_7d: false }) === DELIVERY.DORMANT,
  );
  check("…and isDormant agrees", isDormant({ delivered_last_7d: false }));
  check("a delivering row is not dormant", isDormant({ delivered_last_7d: true }) === false);

  // The failure this guards. `!row.delivered_last_7d` reads every one of these
  // as dormant, which would grey out and mis-count all 186 clients the day the
  // key is renamed — or, more likely, the day a cache at an older version
  // serves rows from before the field existed. The spec flags exactly that:
  // bump the cache key or a new field reads as missing on every row.
  for (const missing of [undefined, null, "", 0, "false", "no"]) {
    check(
      `${JSON.stringify(missing)} → unknown, not dormant`,
      deliveryState({ delivered_last_7d: missing }) === DELIVERY.UNKNOWN,
    );
    check(
      `${JSON.stringify(missing)} → isDormant false`,
      isDormant({ delivered_last_7d: missing }) === false,
    );
  }
  check("a row with no such key at all", deliveryState({}) === DELIVERY.UNKNOWN);

  // A stale-cache page must not turn into 186 greyed rows and a "186 dormant"
  // count offering to hide the entire book.
  {
    const stale = Array.from({ length: 186 }, () => ({ client_type: "cpl" }));
    check(
      "a whole page from before the field existed reads as 0 dormant",
      stale.filter(isDormant).length === 0,
    );
  }

  // The window is fixed at 7 days and must never be described as the selected
  // range. The label is a constant precisely so no caller can interpolate one.
  check("the window says 7 days", DELIVERY_WINDOW_LABEL === "last 7 days");
  check("…and is not preset-derived", DELIVERY_WINDOW_DAYS === 7);
}

console.log("\npagination: four served fields, two derived");
{
  // The live shape. `pages`, not `total_pages`, and no has_next/has_prev — the
  // DRF-ish names this was first written against left both flags false forever,
  // and the nav only renders when one is true. At the default 200 that looked
  // fine (186 rows really is one page); at 50 it stranded the reader on page 1
  // of 4 with no controls at all. These checks exist to keep that shut.
  const served = (page, page_size, total) => ({
    page,
    page_size,
    total,
    pages: Math.ceil(total / page_size),
  });

  {
    const p = derivePagination(served(1, 200, 186), 186);
    check("the default: 186 of 186", p.total === 186, `(${p.total})`);
    check("…is one page", p.totalPages === 1, `(${p.totalPages})`);
    check("…with nothing after it", p.hasNext === false);
    check("…and nothing before it", p.hasPrev === false);
  }

  {
    // The case that was broken. Four pages, and every one of them navigable.
    const first = derivePagination(served(1, 50, 186), 50);
    check("at 50 per page there are 4 pages", first.totalPages === 4, `(${first.totalPages})`);
    check("page 1 can go forward", first.hasNext === true);
    check("page 1 cannot go back", first.hasPrev === false);

    const mid = derivePagination(served(2, 50, 186), 50);
    check("page 2 can go both ways", mid.hasNext === true && mid.hasPrev === true);

    const last = derivePagination(served(4, 50, 186), 36);
    check("the last page cannot go forward", last.hasNext === false);
    check("the last page can go back", last.hasPrev === true);
    check(
      "a short last page does not shrink the total",
      last.total === 186,
      `(${last.total})`,
    );
  }

  console.log("\n  …and it degrades without stranding anyone");
  {
    // `total` must never borrow the row count: that is how a page size ends up
    // impersonating a total.
    const blind = derivePagination(null, 50);
    check("no meta at all → total unknown", blind.total === null);
    check("…page size falls back to what arrived", blind.pageSize === 50);
    check("…and forward is closed rather than guessed", blind.hasNext === false);

    // One renamed key must never take the navigation away again.
    const noPages = derivePagination(
      { page: 2, page_size: 50, total: 186 },
      50,
    );
    check(
      "pages missing → derived from total and page size",
      noPages.totalPages === 4,
      `(${noPages.totalPages})`,
    );
    check("…so forward still works", noPages.hasNext === true);

    // The worse half of stranding: unable to retreat. hasPrev must not depend
    // on knowing how many pages there are.
    const lost = derivePagination({ page: 3, page_size: 50 }, 50);
    check("page 3 with no totals can still go back", lost.hasPrev === true);
  }

  console.log("\n  …and the fallback reproduces the serializer, not just plausible arithmetic");
  {
    // Three calls confirmed off the wire on 2026-09-18, all 186 clients. The
    // backend computes (total + size - 1) // size; the fallback here is
    // Math.ceil(total / size). They agree for positive integers, but that is
    // worth asserting rather than assuming: the fallback stands in for the
    // server's own number whenever `pages` is absent, so a divergence would
    // put a page count on screen that the server would never have served.
    const CONFIRMED = [
      { page_size: 3, pages: 62 },
      { page_size: 50, pages: 4 },
      { page_size: 200, pages: 1 },
    ];
    for (const { page_size, pages } of CONFIRMED) {
      const served = derivePagination(
        { page: 1, page_size, total: 186, pages },
        Math.min(page_size, 186),
      );
      const fellBack = derivePagination(
        { page: 1, page_size, total: 186 }, // no `pages`
        Math.min(page_size, 186),
      );
      check(
        `${page_size} per page → ${pages} pages, as served`,
        served.totalPages === pages,
        `(${served.totalPages})`,
      );
      check(
        `…and the fallback derives the same ${pages}`,
        fellBack.totalPages === pages,
        `(${fellBack.totalPages})`,
      );
    }
  }

  console.log("\n  …and a self-contradicting payload is surfaced, not absorbed");
  {
    // 186 rows at 200 per page is 1 page, not 62. Both numbers come from the
    // same serializer, so a disagreement is a backend bug — and it shows up as
    // pages of empty rows the reader can page into.
    check(
      "pages that contradict total/page_size are flagged",
      paginationDisagrees({ page: 1, page_size: 200, total: 186, pages: 62 }),
    );
    check(
      "a consistent block is not flagged",
      paginationDisagrees({ page: 1, page_size: 200, total: 186, pages: 1 }) ===
        false,
    );
    check(
      "a partial block is not flagged — nothing to contradict",
      paginationDisagrees({ page: 1, total: 186 }) === false,
    );
  }
}

console.log("\nthe server's window is printed exactly as served");
{
  // meta.range is authoritative — resolved in Asia/Kolkata, and the dates the
  // figures were actually computed over. The failure this guards against is
  // subtle and total: `new Date("2026-08-20")` is UTC midnight, so any browser
  // west of Greenwich renders the server's 20 Aug as 19 Aug, and the page
  // contradicts the numbers it is labelling. fmtRange never builds a Date.
  check(
    "a cross-month window",
    fmtRange("2026-08-20", "2026-09-18") === "20 Aug – 18 Sep 2026",
    `(${fmtRange("2026-08-20", "2026-09-18")})`,
  );
  check(
    "within one month, the month is said once",
    fmtRange("2026-09-12", "2026-09-18") === "12–18 Sep 2026",
    `(${fmtRange("2026-09-12", "2026-09-18")})`,
  );
  check(
    "a single day is one date, not a range",
    fmtRange("2026-09-18", "2026-09-18") === "18 Sep 2026",
    `(${fmtRange("2026-09-18", "2026-09-18")})`,
  );
  check(
    "a cross-year window carries both years",
    fmtRange("2025-12-20", "2026-01-18") === "20 Dec 2025 – 18 Jan 2026",
    `(${fmtRange("2025-12-20", "2026-01-18")})`,
  );

  // The one that actually bites. The first of a month is where a UTC reparse
  // rolls backwards past a month boundary, turning "1 Sep" into "31 Aug".
  check(
    "the 1st of a month does not roll back a day",
    fmtRange("2026-09-01", "2026-09-30") === "1–30 Sep 2026",
    `(${fmtRange("2026-09-01", "2026-09-30")})`,
  );
  check(
    "1 Jan does not roll back a year",
    fmtRange("2026-01-01", "2026-01-01") === "1 Jan 2026",
    `(${fmtRange("2026-01-01", "2026-01-01")})`,
  );

  // Half a window is worse than none: it would label the columns with a date
  // the figures were not computed over.
  check("a missing end yields nothing", fmtRange("2026-09-01", null) === null);
  check("a missing start yields nothing", fmtRange(null, "2026-09-30") === null);
  check("junk yields nothing", fmtRange("last7", "today") === null);
  check("an impossible month yields nothing", fmtRange("2026-13-01", "2026-13-02") === null);
}

console.log("\npeople lists survive whichever shape they arrive in");
{
  check("an array passes through", asList(["Aditi", "Rohan"]).length === 2);
  check("a comma string splits", asList("Aditi, Rohan").length === 2);
  // A manager silently dropped makes the Team column claim a client has none —
  // a false gap, the same failure mode as flagging a retainer.
  for (const key of ["name", "full_name", "username", "email"]) {
    check(
      `an object keyed on ${key} is not dropped`,
      asList([{ [key]: "Aditi" }])[0] === "Aditi",
    );
  }
  check("nothing is an empty list", asList(null).length === 0);
  check('"Not recorded yet" is an empty list', asList("Not recorded yet").length === 0);
}

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
