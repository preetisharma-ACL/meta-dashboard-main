// Checks the organization → client rule on the payment form, clause by clause
// against the spec it was written from. Run: node scripts/verify-org-client-rule.mjs
//
// The cases that matter most are the ones where the rule must NOT act: clearing
// the organization must not clear a client, and an organization with no clients
// must not either. Those are invisible when they regress — the field just
// quietly empties — so they are asserted explicitly rather than assumed.
//
// Imports the real module; no copied logic.

import {
  resolveOrgSelection,
  clientsForOrg,
} from "../src/components/payments/orgClientRule.js";

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`);
  if (!cond) failures++;
};

// A stand-in for /payments/clients/, including the two shapes that bite: an org
// with several clients (Lions Property, the one real case) and clients with no
// org link at all.
const CLIENTS = [
  { id: 11, name: "SwarnenduGuhaRoyLionsProperty", organizationId: 7 },
  { id: 12, name: "LionsPropertyDelhi", organizationId: 7 },
  { id: 20, name: "SKAImperia", organizationId: 9 },
  { id: 31, name: "Rosemont", organizationId: 4 },
  { id: 40, name: "NoOrgClient", organizationId: null },
];

const LIONS = 7; // 2 clients
const SOLO = 9; // 1 client
const EMPTY = 77; // 0 clients

console.log("\nexactly one client → pre-fill, and say which");
{
  const r = resolveOrgSelection({
    orgId: SOLO,
    clients: CLIENTS,
    orgLabel: "SKA Group",
  });
  check("pre-fills that client", r.pick?.id === 20, `(${r.pick?.id})`);
  check("narrows the list to the org", r.filterOrgId === SOLO);
  check(
    "does not steal focus — nothing left to choose",
    r.focusClient === false,
  );
  check(
    "names the client it picked",
    r.notice?.text.includes("SKAImperia"),
    `(${r.notice?.text})`,
  );
  check(
    "says it can be changed",
    /change it/i.test(r.notice?.text ?? ""),
    `(${r.notice?.text})`,
  );
  check("reported, not warned", r.notice?.tone === "info");
}

console.log("\nmore than one → no guess, narrow and open");
{
  const r = resolveOrgSelection({
    orgId: LIONS,
    clients: CLIENTS,
    orgLabel: "Lions Property",
  });
  check("picks NOTHING", r.pick === null);
  check("narrows to the org", r.filterOrgId === LIONS);
  check("opens the list for them", r.focusClient === true);
  check(
    "says how many there are",
    r.notice?.text.includes("2 clients"),
    `(${r.notice?.text})`,
  );
}

console.log("\nno clients → leave the field alone, and say so");
{
  const r = resolveOrgSelection({
    orgId: EMPTY,
    clients: CLIENTS,
    currentClientId: 31,
    currentClientName: "Rosemont",
    orgLabel: "Empty Org",
  });
  check("picks nothing — the client survives", r.pick === null);
  check("does NOT narrow to an empty list", r.filterOrgId === null);
  check("does not open an empty list", r.focusClient === false);
  check(
    "says there are none",
    /no clients under this organization/i.test(r.notice?.text ?? ""),
    `(${r.notice?.text})`,
  );
  check("flagged as needing a decision", r.notice?.tone === "warn");
}

console.log("\nclearing the organization must NOT clear the client");
{
  for (const [label, orgId] of [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ]) {
    const r = resolveOrgSelection({
      orgId,
      clients: CLIENTS,
      currentClientId: 20,
      currentClientName: "SKAImperia",
    });
    check(
      `${label}: picks nothing, so the client is untouched`,
      r.pick === null,
    );
    check(`${label}: drops the narrowing`, r.filterOrgId === null);
    check(
      `${label}: says nothing about a field just emptied`,
      r.notice === null,
    );
  }
}

console.log("\nchanging the org AFTER a client is chosen re-runs the rule");
{
  // Client from another org + an org with several: keep it, but never let it
  // sit there looking deliberate.
  const r = resolveOrgSelection({
    orgId: LIONS,
    clients: CLIENTS,
    currentClientId: 31,
    currentClientName: "Rosemont",
    orgLabel: "Lions Property",
  });
  check("does not clear the mismatched client", r.pick === null);
  check("narrows to the new org", r.filterOrgId === LIONS);
  check("opens the list so they can correct it", r.focusClient === true);
  check(
    "names the mismatch rather than staying quiet",
    r.notice?.tone === "warn" &&
      r.notice.text.includes("Rosemont") &&
      r.notice.text.includes("Lions Property"),
    `(${r.notice?.text})`,
  );

  // Client from another org + an org with exactly one: the spec says pre-fill.
  const r2 = resolveOrgSelection({
    orgId: SOLO,
    clients: CLIENTS,
    currentClientId: 31,
    currentClientName: "Rosemont",
    orgLabel: "SKA Group",
  });
  check("single-match org overwrites the stale client", r2.pick?.id === 20);
  check(
    "...and announces the overwrite",
    r2.notice?.text.includes("SKAImperia"),
  );

  // Client already valid for the new org: leave it, and don't yank focus back
  // to a question they have already answered.
  const r3 = resolveOrgSelection({
    orgId: LIONS,
    clients: CLIENTS,
    currentClientId: 12,
    currentClientName: "LionsPropertyDelhi",
    orgLabel: "Lions Property",
  });
  check("valid client is kept", r3.pick === null);
  check("no focus steal when nothing is wrong", r3.focusClient === false);
  check("no warning when nothing is wrong", r3.notice?.tone === "info");
}

console.log("\nno outcome of the rule can ever clear the client");
{
  // Exhaustive over the shapes the form can hand it: every org in the fixture
  // plus the empty ones, against every client state.
  const orgIds = [null, undefined, "", LIONS, SOLO, EMPTY, 4];
  const clientIds = [null, 11, 12, 20, 31, 40];
  let clears = 0;
  let silentChanges = 0;

  for (const orgId of orgIds) {
    for (const currentClientId of clientIds) {
      const r = resolveOrgSelection({
        orgId,
        clients: CLIENTS,
        currentClientId,
        currentClientName: CLIENTS.find((c) => c.id === currentClientId)?.name,
      });
      // "pick" is the only write. A falsy-but-present pick (id 0, "") would be
      // a write of an unusable id — count it as a clear.
      if (r.pick !== null && (r.pick.id === null || r.pick.id === undefined))
        clears++;
      // A pick that changes the client without a notice would be a silent write.
      if (
        r.pick &&
        String(r.pick.id) !== String(currentClientId ?? "") &&
        !r.notice
      )
        silentChanges++;
    }
  }
  check(
    `no outcome clears the client (${orgIds.length * clientIds.length} combinations)`,
    clears === 0,
  );
  check("no outcome changes the client without saying so", silentChanges === 0);
}

console.log("\nclientsForOrg matches the rule's own counting");
{
  check("two under Lions Property", clientsForOrg(CLIENTS, LIONS).length === 2);
  check("one under SKA", clientsForOrg(CLIENTS, SOLO).length === 1);
  check(
    "none under an unknown org",
    clientsForOrg(CLIENTS, EMPTY).length === 0,
  );
  check("none for a null org", clientsForOrg(CLIENTS, null).length === 0);
  check(
    "a client with no org link is never matched into one",
    clientsForOrg(CLIENTS, null).length === 0 &&
      !clientsForOrg(CLIENTS, LIONS).some((c) => c.id === 40),
  );
  check(
    "string and number ids match (the API sends both)",
    clientsForOrg(CLIENTS, "7").length === 2,
  );
  check(
    "undefined client list → none, no throw",
    clientsForOrg(undefined, 7).length === 0,
  );
}

console.log("\ndefensive: called with nothing at all");
{
  const r = resolveOrgSelection();
  check(
    "no throw, and nothing happens",
    r.pick === null && r.filterOrgId === null,
  );
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
