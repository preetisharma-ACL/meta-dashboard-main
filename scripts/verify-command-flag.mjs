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
