// Checks the CM hierarchy tree's per-row cache identity against the case that
// broke it. Run: node scripts/verify-cm-hierarchy-keys.mjs
//
// Project 410 "Prestige150" sits under 13 clients. The tree cached each
// project's campaign list, open/closed state and ad-account subtitles under the
// project id alone, so the first client row expanded filled the cache and the
// other twelve rendered ITS campaigns: three rows whose counts read 1, 2 and 5
// all showed the same 5. The counts come from the per-client projects payload
// and the lists from a project-keyed cache — two sources, one row.
//
// Imports the real module; no copied logic.

import {
  nodeKey,
  adAccountName,
  adAccountMapFor,
  foreignNomens,
} from "../src/components/cmHierarchyKeys.js";

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`);
  if (!cond) failures++;
};

// The real shape: one project id, three client nomens, three different leaves.
const PROJECT = 410;
const RAMAN = 101;
const SHADAB = 102;
const BHAVYA = 103;

const leaf = (ids) => ids.map((id) => ({ campaign_id: id, campaign_name: `C${id}` }));
const RAMAN_LEAF = leaf([16860]);
const SHADAB_LEAF = leaf([16767, 16833]);
const BHAVYA_LEAF = leaf([16901, 16902, 16903, 16904, 16905]);

console.log("\none project under many clients → one cache entry each");
{
  const keys = [
    nodeKey(RAMAN, PROJECT),
    nodeKey(SHADAB, PROJECT),
    nodeKey(BHAVYA, PROJECT),
  ];
  check("three client rows, three distinct keys", new Set(keys).size === 3, keys.join(" "));
  check(
    "the project id alone is not the key",
    keys.every((k) => k !== String(PROJECT)),
    keys.join(" "),
  );
  check(
    "same client + same project is the SAME key (no refetch per render)",
    nodeKey(RAMAN, PROJECT) === nodeKey(RAMAN, PROJECT),
  );
  // The collision that produced the bug, stated as the thing that must not hold.
  check(
    "Raman's key never reads Bhavya's entry",
    nodeKey(RAMAN, PROJECT) !== nodeKey(BHAVYA, PROJECT),
  );
}

console.log("\ntwo projects under one client stay apart");
{
  check("different project, same client → different key", nodeKey(RAMAN, 410) !== nodeKey(RAMAN, 411));
  // 1:410 and 14:10 would collide under naive concatenation; the separator is
  // the whole reason this is a function and not a template inline at each site.
  check("ids can't run together into one string", nodeKey(1, 410) !== nodeKey(14, 10));
}

console.log("\na cache keyed this way serves each row its own list");
{
  const cache = {};
  cache[nodeKey(RAMAN, PROJECT)] = { data: RAMAN_LEAF };
  cache[nodeKey(SHADAB, PROJECT)] = { data: SHADAB_LEAF };
  cache[nodeKey(BHAVYA, PROJECT)] = { data: BHAVYA_LEAF };

  const lengthFor = (c) => cache[nodeKey(c, PROJECT)].data.length;
  check("Raman shows 1 (count said 1)", lengthFor(RAMAN) === 1, `got ${lengthFor(RAMAN)}`);
  check("Shadab shows 2 (count said 2)", lengthFor(SHADAB) === 2, `got ${lengthFor(SHADAB)}`);
  check("Bhavya shows 5 (count said 5)", lengthFor(BHAVYA) === 5, `got ${lengthFor(BHAVYA)}`);

  const ids = (c) => cache[nodeKey(c, PROJECT)].data.map((x) => x.campaign_id);
  check("Raman's list is #16860", JSON.stringify(ids(RAMAN)) === "[16860]", ids(RAMAN).join(","));
  check(
    "Shadab's list is #16767, #16833",
    JSON.stringify(ids(SHADAB)) === "[16767,16833]",
    ids(SHADAB).join(","),
  );

  // Open/closed state is keyed the same way, so the chevrons move independently.
  const open = { [nodeKey(BHAVYA, PROJECT)]: true };
  check("expanding Bhavya leaves Raman's row shut", !open[nodeKey(RAMAN, PROJECT)]);
  check("…and Shadab's too", !open[nodeKey(SHADAB, PROJECT)]);
}

console.log("\nad-account subtitles never borrow another client's rows");
{
  // What /campaigns/?project=410 can still hand back: every client's campaigns
  // on the shared project. Only the parent client's leaf ids may be keyed.
  const ROWS = [
    { id: 16860, ad_account_name: "Raman Ads" },
    { id: 16767, ad_account_name: "TrueGrowth Ads" },
    { id: 16833, ad_account: { name: "TrueGrowth Ads 2" } },
    { id: 16901, account_name: "Bhavya Ads" },
  ];

  const ramanMap = adAccountMapFor(ROWS, RAMAN_LEAF);
  check("Raman gets his own account", ramanMap["16860"] === "Raman Ads");
  check(
    "Raman gets nobody else's",
    Object.keys(ramanMap).length === 1,
    JSON.stringify(ramanMap),
  );

  const shadabMap = adAccountMapFor(ROWS, SHADAB_LEAF);
  check("ad_account_name shape read", shadabMap["16767"] === "TrueGrowth Ads");
  check("nested ad_account.name shape read", shadabMap["16833"] === "TrueGrowth Ads 2");
  check("no Bhavya row leaks in", shadabMap["16901"] === undefined);

  check("account_name shape read", adAccountMapFor(ROWS, BHAVYA_LEAF)["16901"] === "Bhavya Ads");

  // Degenerate inputs: a failed/empty list must yield an empty map, not throw.
  check("no rows → empty map", Object.keys(adAccountMapFor([], RAMAN_LEAF)).length === 0);
  check("no leaf → empty map", Object.keys(adAccountMapFor(ROWS, [])).length === 0);
  check("undefined inputs → empty map", Object.keys(adAccountMapFor(undefined, undefined)).length === 0);
  check("a row with no account name is skipped", adAccountMapFor([{ id: 16860 }], RAMAN_LEAF)["16860"] === undefined);
  check("adAccountName on an empty row is null", adAccountName({}) === null);
}

console.log("\nthe response says whether client_nomen_id=<id> actually bit");
{
  // Rows as /campaigns/ sends them: the id under client_nomen_id, and the NAME
  // under client_nomen — CampaignFilter's two filters match those two things,
  // which is why only the id side may be compared to an id.
  const SCOPED = [
    { id: 16767, client_nomen_id: SHADAB, client_nomen: "ShadabAhmadTrueGrowthRealtyLLP" },
    { id: 16833, client_nomen_id: SHADAB, client_nomen: "ShadabAhmadTrueGrowthRealtyLLP" },
  ];
  const UNSCOPED = [
    ...SCOPED,
    { id: 16860, client_nomen_id: RAMAN, client_nomen: "RamanRujbhoomiRealtech" },
    { id: 16901, client_nomen_id: BHAVYA, client_nomen: "BhavyaPaarthPromoters" },
  ];

  check("a scoped response disagrees with nobody", foreignNomens(SCOPED, SHADAB).length === 0);
  check(
    "an unscoped response is caught, and names the intruders",
    foreignNomens(UNSCOPED, SHADAB).sort().join(",") === [String(RAMAN), String(BHAVYA)].sort().join(","),
    foreignNomens(UNSCOPED, SHADAB).join(","),
  );
  // The regression this guards: a client NAME compared against an id marks
  // every row foreign and the warning fires on every project in the tree.
  check(
    "a name in client_nomen is never read as a foreign id",
    foreignNomens(
      [{ id: 16767, client_nomen: "ShadabAhmadTrueGrowthRealtyLLP" }],
      SHADAB,
    ).length === 0,
  );
  // The id arrives as a number on the row and often a string in the URL/state;
  // a type mismatch must not read as a different client.
  check("102 and \"102\" are the same client", foreignNomens([{ client_nomen_id: 102 }], "102").length === 0);
  check("a bare id under client_nomen still counts", foreignNomens([{ client_nomen: RAMAN }], SHADAB).length === 1);
  // A row identifying its client in neither form proves nothing either way.
  check("a row with no nomen field is not evidence", foreignNomens([{ id: 16767 }], SHADAB).length === 0);
  check("no rows → nothing to disagree about", foreignNomens([], SHADAB).length === 0);
  check("undefined rows → no throw", foreignNomens(undefined, SHADAB).length === 0);
}

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
