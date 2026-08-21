// ─── Organization → client rule ───────────────────────────────────────────────
// What choosing an organization on the payment form should do to the client
// field. Pure and separate from the form because the interesting part is the
// decision, not the wiring, and the decision has a rule per case that is easy to
// break later — particularly the two that are about NOT doing something.
//
// The two invariants worth stating out loud:
//
//   NOTHING HERE EVER CLEARS THE CLIENT. Clearing the organization leaves it
//   alone (an operator blanking an optional field has not asked to lose a
//   required one), and so does an organization with no clients. The only write
//   into the client field is the single-match pre-fill.
//
//   NOTHING HERE IS SILENT. Every case returns a notice, including the ones that
//   change nothing, because "the field filled itself and I didn't notice" is how
//   a payment gets booked against the wrong client.
//
// The caller stays free either way: the narrowing is a VIEW over the client list
// with a way back to the full one, never a restriction. Some clients have no org
// link at all, and a hard filter would make them unreachable.

const sameId = (a, b) =>
  a !== null && a !== undefined && String(a) === String(b);

// Clients belonging to one organization. Exported because the form shows the
// count in its "showing N of…" hint and must count them the same way.
export const clientsForOrg = (clients, orgId) =>
  orgId === null || orgId === undefined || orgId === ""
    ? []
    : (clients ?? []).filter((c) => sameId(c?.organizationId, orgId));

// → {
//     pick        {id, name} | null   pre-fill the client field with this
//     filterOrgId id | null           narrow the client list to this org
//     focusClient boolean             open + focus the client list
//     notice      {tone, text} | null "info" reports, "warn" wants a decision
//   }
//
// `pick: null` always means "leave the client exactly as it is" — never "clear
// it". There is no return value that clears the client, by design.
export const resolveOrgSelection = ({
  orgId,
  clients = [],
  currentClientId = null,
  currentClientName = null,
  orgLabel = "this organization",
} = {}) => {
  // Organization cleared. Drop the narrowing, keep the client, say nothing —
  // there is nothing to report about a field the operator just emptied.
  if (orgId === null || orgId === undefined || orgId === "") {
    return { pick: null, filterOrgId: null, focusClient: false, notice: null };
  }

  const matches = clientsForOrg(clients, orgId);

  // None. Don't narrow to an empty list, and don't touch a client the operator
  // already chose — this role's payable list simply contains nobody under this
  // org, which is not a reason to undo their work.
  if (matches.length === 0) {
    return {
      pick: null,
      filterOrgId: null,
      focusClient: false,
      notice: {
        tone: "warn",
        text: "No clients under this organization — pick the client yourself.",
      },
    };
  }

  // Exactly one. Pre-fill it AND name it: a value appearing in a field the
  // operator never touched has to read as a choice they can see and undo.
  if (matches.length === 1) {
    return {
      pick: { id: matches[0].id, name: matches[0].name },
      filterOrgId: orgId,
      focusClient: false,
      notice: {
        tone: "info",
        text: `Client set to ${matches[0].name} — change it if needed.`,
      },
    };
  }

  // Several. Don't guess. Narrow to them and hand the operator into the list.
  const currentIsInOrg = matches.some((m) => sameId(m.id, currentClientId));

  // A client already chosen and still valid: leave it, and don't yank focus away
  // from whatever they were doing to re-ask a question they've answered.
  if (currentIsInOrg) {
    return {
      pick: null,
      filterOrgId: orgId,
      focusClient: false,
      notice: {
        tone: "info",
        text: `${matches.length} clients under ${orgLabel} — pick one.`,
      },
    };
  }

  // A client from a DIFFERENT org. Keep it — losing typed work is worse than a
  // mismatch — but never let it sit there looking deliberate.
  if (currentClientId !== null && currentClientId !== undefined) {
    return {
      pick: null,
      filterOrgId: orgId,
      focusClient: true,
      notice: {
        tone: "warn",
        text:
          `${currentClientName ?? "The selected client"} isn't under ` +
          `${orgLabel} — pick one of the ${matches.length} below, or change ` +
          `the organization.`,
      },
    };
  }

  // Nothing chosen yet: the plain org-first path.
  return {
    pick: null,
    filterOrgId: orgId,
    focusClient: true,
    notice: {
      tone: "info",
      text: `${matches.length} clients under ${orgLabel} — pick one.`,
    },
  };
};
