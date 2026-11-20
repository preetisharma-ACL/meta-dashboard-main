// Cache identity + subtitle scoping for the CM hierarchy tree (CMHierarchy.jsx).
//
// Both live here, out of the component, because both are three-line derivations
// that read as obviously right and were obviously wrong: the tree cached a
// project's campaigns under the project id alone, and a project can sit under
// MANY clients (project 410 "Prestige150" is shared by 13). The first client
// row expanded won the cache and every other row rendered its list — rows
// reading 1, 2 and 5 campaigns all showed the same 5. Asserted in
// scripts/verify-cm-hierarchy-keys.mjs rather than re-read.

// The identity of one project row: the project AS SEEN UNDER ONE CLIENT. Every
// per-row cache in the tree (campaign lists, open/closed state, ad-account
// subtitles) must key on this, never on the project id by itself.
export const nodeKey = (clientNomenId, projectId) => `${clientNomenId}:${projectId}`;

// The ad account's name off a campaign row, whichever shape it arrives in:
// /campaigns/ flattens it to ad_account_name, and the hierarchy leaf may or may
// not carry it at all (hence the fallback fetch in loadAdAccounts).
export const adAccountName = (c) =>
  c?.ad_account_name ?? c?.ad_account?.name ?? c?.account_name ?? null;

// campaign_id → ad account name, for the subtitles under ONE client's rows.
//
// `rows` comes from /campaigns/?project=N, which can return other clients'
// campaigns on a shared project even with client_nomen_id sent. `leafCampaigns`
// is the hierarchy leaf — already the right client's — so its ids are the only
// keys written. A row the leaf doesn't list can never pick up a subtitle, which
// is what keeps a shared project's rows from borrowing each other's accounts.
export const adAccountMapFor = (rows, leafCampaigns) => {
  const wanted = new Set(
    (Array.isArray(leafCampaigns) ? leafCampaigns : []).map((c) => String(c?.campaign_id)),
  );
  const map = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = adAccountName(r);
    if (r?.id != null && name && wanted.has(String(r.id))) map[String(r.id)] = name;
  }
  return map;
};
