# Editing an onboarded client — backend requirements

**For:** Backend team
**Raised by:** Frontend · Edit Clients
**Date:** 8 September 2026 · **Rev 4** — recompute semantics, CPL clearing, and a new audit item
**Status:** R7 ✅ `68ed57d` · §4 ✅ `f7f0773` · R2 next, then R1 · **R8 proposed** · R3–R6 open

The onboarding wizard writes a client login and its full commercial profile in one atomic call, and
almost none of it can be changed afterwards. This is what the frontend needs in order to offer an edit
screen covering every field that wizard collects.

**What changed in Rev 4.** Two answers, one of which changes what the screen has to say. The recompute
is **lazy** — nothing is stored, every figure computes on read — so a type switch on one of the 12
unlocked clients lands the moment anyone next opens the page, the client included. No job to wait for,
no window to revert in. And switching to CPL now clears the service charge server-side instead of
400ing on a rate the caller never sent. One new item: **R8**, a `ClientCommercialHistory`, raised by the
backend team and endorsed here.

**What changed in Rev 3.** R7 is deployed: a `client_type` switch on a client with payment history is
now refused with a 422 `client_type_locked`, months named. 169 of 181 clients are in that state. The
role gate widened to admin + coordination, closing Q7. Three frontend changes followed (§8) — most
notably the typed confirmation no longer invents a month count, because the endpoint now knows the real
one and we never did.

**What changed in Rev 2.** All seven questions came back answered (§6). The writable set turned out to
be three fields, not the unknown quantity Rev 1 assumed — so R1 is real work, not configuration.

---

## 1. Where we are

`POST /auth/onboarding/users/` creates a login plus its role profile in a single transaction. It is
write-once: the endpoint exposes no detail route, so a client onboarded with the wrong sales owner or a
typo in the email cannot be corrected through the API at all.

Route capabilities, probed against `metadashboard.aajneeticonnectltd.com` — an unauthenticated
`OPTIONS` returns the `Allow` header alongside the 401, and an unrouted path returns a bare 404.

| Route | Allow | What that means for editing |
| --- | --- | --- |
| `/auth/onboarding/users/` | `POST, OPTIONS` | Create only. No update path. |
| `/auth/onboarding/users/{id}/` | `404` | Not routed. There is no per-user detail endpoint anywhere in the API. |
| `/clients/admin/clients/` | `GET, POST, HEAD, OPTIONS` | Client list. Rows are a trimmed projection — no service charge, sales owner or visibility date. |
| `/clients/admin/clients/{id}/` | `GET, PUT, PATCH, DELETE, HEAD, OPTIONS` | **The one writable surface we have.** Serializer confirmed below. |
| `/clients/admin/nomens/{id}/` | `GET, PATCH, HEAD, OPTIONS` | A nomen can be renamed, but not reassigned to a different client from here. |
| `/clients/admin/sales-managers/` | `GET, HEAD, OPTIONS` | Read-only roster. No detail route (`/{id}/` is a 404). |
| `/cm/team-members/` | `GET, HEAD, OPTIONS` | Read-only roster. No detail route. |
| `/auth/me/` | `GET, HEAD, OPTIONS` | Self-read only. Cannot edit self, let alone another user. |

> **Also checked, all 404:** `/auth/users/`, `/auth/staff/`, `/auth/profile/`,
> `/auth/staff-profile(s)/`, `/clients/admin/users|staff|sales|sales-users/`, `/users/`, `/staff/`,
> `/accounts/users/`.

### The writable set — confirmed

`ClientUpdateSerializer`, selected at `views.py:145`, accepts **exactly three fields**:

```
client_type      service_charge      is_active
```

`nomen`, `onboarded_by`, `data_visible_from` and `campaign_manager_ids` are not on it. This is the
finding that shapes the rest of the document: R1 is real serializer work rather than a config change,
and the frontend's fallback field list is now an allowlist of these three rather than a reading of the
record — a serializer silently drops what it doesn't accept, so a broader form would have shown
successful saves that changed nothing.

Of those three, `client_type` is now conditionally locked (R7, shipped) and `service_charge` carries a
model `help_text` that describes a one-time setup fee for what is actually a monthly percentage on
marked-up spend — being corrected at source, which also corrects what R2 will publish.

Access is **admin + coordination** since `68ed57d`. Before that deploy, any CM whose team held the
nomen could PATCH a client, `client_type` included.

---

## 2. What the wizard collects

The exact payload `POST /auth/onboarding/users/` receives, taken from the wizard source rather than
from documentation. Every field below needs an edit path — that is the whole of the ask.

### Account — every role

| Field | Type | Rule at create time | Status |
| --- | --- | --- | --- |
| `email` | string | Required. The login identity. | ❌ No route — R4 |
| `password` | string | Required, min 10 chars. | ❌ No route — R6, as an action not a field |
| `first_name` | string | Optional. Omitted entirely when blank. | ❌ No route — R4 |
| `last_name` | string | Optional. | ❌ No route — R4 |
| `organization_id` | int | Exactly one of these two. Both is a 400; neither is a 400. | ❌ No route — R4 |
| `organization_name` | string | The name form creates the organisation. | ❌ No route — R4 |
| `role` | enum | `client`, `campaign_manager`, `sales`, `coordination`, `accounts`. Never `admin`. | 🔒 Immutable by design — see A2 |

### `client` — sent only when role is `client`

| Field | Type | Rule at create time | Status |
| --- | --- | --- | --- |
| `client.client_type` | enum | `cpl` \| `hybrid` \| `retainer`. Required. | 🔐 Writable, **locked on billing history** — R7 shipped |
| `client.service_charge` | number | Required for hybrid and retainer, ≥ 0. **Must be absent for CPL** — sending it is a documented 400. | ✅ Writable. A monthly % on marked-up spend — see A9 |
| `client.onboarded_by_id` | int | Required. A user with role `sales` or `admin`; anything else is a 400. | ❌ Not on the serializer — R1 |
| `client.data_visible_from` | date | Retainer only, optional. Dropped on a type change. | ❌ Not on the serializer — R1 |
| `client.nomen_id` | int | Picks an *unassigned* nomen. | 🔒 Reassignment refused by design — see A3 |
| `client.nomen_name` | string | Creates a nomen by name. A `\|` in the name is a 400. | 🔒 As above |
| `client.campaign_manager_ids` | int[] | Optional. Omitted entirely when empty. | ↗️ Owned by the CM assignment endpoints — see A4 |

`is_active` is also writable on the client serializer. It is not an onboarding field — it is the
account's live/disabled flag — but the edit screen surfaces it, distinct from the engagement status
(active / hold / completed) set on the Client Status screen.

### `campaign_manager` — sent only when role is `campaign_manager`

| Field | Type | Rule at create time | Status |
| --- | --- | --- | --- |
| `campaign_manager.tier` | enum | `tier_1` \| `tier_2`. Required. | ❌ No route — R5 |
| `campaign_manager.team_lead_id` | int | Required for tier 2, **must be absent for tier 1**. Points at a tier-1 manager. | ❌ No route — R5 |

### `staff_profile` — optional, on `campaign_manager` / `sales` / `coordination` / `accounts`

| Field | Type | Rule at create time | Status |
| --- | --- | --- | --- |
| `staff_profile.designation` | string | Optional. | ❌ No route — R5 |
| `staff_profile.whatsapp` | string | Optional. | ❌ No route — R5 |
| `staff_profile.client_email` | string | Optional. | ❌ No route — R5 |
| `staff_profile.photo_url` | string | Optional. | ❌ No route — R5 |
| `staff_profile.intro` | string | Optional. | ❌ No route — R5 |
| `staff_profile.show_to_clients` | bool | Whether this person appears on the client-facing team page. | ❌ No route — R5 |

All `staff_profile` text fields are omitted rather than sent empty when blank. These are the contact
details clients see on "My Team".

---

## 3. What we need built

### R1 — Add the missing client fields to `ClientUpdateSerializer` · **P0**

```
PATCH /clients/admin/clients/{id}/          # views.py:145
```

Two fields to add:

- **`onboarded_by`** — see A5 and A13. This is not a label, it is a live scoping filter, so it needs
  the validation the create endpoint has (role must be `sales` or `admin`) *and* the audit line in R8.
  The frontend confirmation for it is already built (§8), so it arrives guarded rather than as a plain
  dropdown on day one.
- **`data_visible_from`** — retainer-only, with the clearing rule in §4.

`nomen` and `campaign_manager_ids` are deliberately **not** requested: A3 and A4 settled both as
belonging elsewhere.

**Partial semantics matter.** The screen sends only the fields the operator touched. An absent key must
mean "leave alone", never "clear".

Where the read serializer expands a relation (returning `onboarded_by` as an object rather than an id),
please state the write name explicitly — we handle both, but only if we know which is which.

### R2 — Publish the writable field set through OPTIONS · **P0**

```
OPTIONS /clients/admin/clients/{id}/        # returns no actions block today
```

DRF's default metadata class answers an authenticated `OPTIONS` with an `actions.PUT` map: every
writable field, its type, required flag and — for relations — its valid choices. Switch it on for this
route and the edit form configures itself from the serializer, staying correct as R1 lands.

Still the highest-leverage item here, and now more so: the frontend currently carries a hardcoded
allowlist of your three fields precisely because the serializer doesn't describe itself. That list is a
copy of your code and will go stale. R2 deletes it.

```jsonc
// what we want back from OPTIONS, abridged
{
  "actions": {
    "PUT": {
      "client_type":       { "type": "choice", "required": true,
                             "choices": [ {"value": "cpl", "display_name": "CPL"} ] },
      "service_charge":    { "type": "decimal", "required": false },
      "is_active":         { "type": "boolean", "required": false },
      "onboarded_by":      { "type": "field", "required": true,
                             "choices": [ {"value": 12, "display_name": "priya@..."} ] },
      "data_visible_from": { "type": "date", "required": false }
    }
  }
}
```

### ✅ R7 — Guard the `client_type` switch server-side · **shipped `68ed57d`**

*Raised by the backend team in Rev 2, closed in Rev 3.*

`client_type` decides which billing branch computes a client's invoices, and it applies to **every past
month**, not just future ones. A hybrid switched to CPL has closed months recomputed on qualified leads
× fixed CPL instead of markup + service charge + GST — moving figures the carryover and the billing
screen were reconciled against.

**Implemented as option 1, refusal.** A switch on a client with payment history returns:

```
422  { "error": { "code": "client_type_locked",
                  "fields": { "client_type": [
                    "Locked: 2 month(s) already billed (2026-08, 2026-09)." ] } } }
```

Verified on client 134. **169 of 181 clients are in that state**, so this is the normal outcome rather
than the edge case.

The frontend handles the code specifically — the refusal is shown whole, as a refusal with named
months, rather than as a red line under a dropdown (§8). We kept the typed confirmation for the ~12
clients the endpoint lets through: for those the switch still decides how they are billed from here on,
which is worth a second deliberate action even though nothing historical moves.

**The recompute is lazy** (`f7f0773`): nothing is stored, every figure computes on read. So a switch on
one of the 12 lands the moment anyone next opens the page — the client included. There is no job to
wait for and no window in which to revert, which is now the most prominent line on the confirmation
panel. Closed.

### R8 — `ClientCommercialHistory` · **P1** — *proposed by the backend team, endorsed*

Nothing records a `client_type` or `service_charge` change today. `ClientStatusHistory` covers
engagement status and `ClientValueTierHistory` covers value tier; the two fields that move money have
no equivalent.

`client_type` is now mostly closed by R7 — locked for 169 of 181 clients. **`service_charge` is not.**
It stays freely editable, it is a monthly percentage, and every month is recomputed against it on read,
so a single edit silently changes what every past month bills at. That is exactly the change you most
need to be able to answer for months later, and right now nothing would.

The proposal is a `ClientCommercialHistory` in the same shape as `ClientStatusHistory`, covering both
fields. Endorsed, and the timing argument is right: **cheaper before the screen is in daily use than
after.** Worth adding that the window is still fully open — the Edit Clients screen is built but not
yet committed on our side, so there is no history to backfill and no habit to unpick. That will not be
true for long.

Two frontend asks that come with it, both cheap once the model exists:

- A read route in the shape of `/clients/{id}/status-history/`, so the drawer can show the history
  where the edit is made. We already have the component pattern — `ClientStatusHistoryDrawer` — so this
  is a service function and a mount.
- A `reason` on the write, mandatory the way the status PATCH makes it mandatory. "Who and when" is
  worth much less than "why" when someone is reconstructing a billing dispute.

### R3 — Eligible-value lists that work in an edit context · **P1**

```
GET /auth/onboarding/options/               # exists
```

Built for creation, so `sales_users` lists who may be *picked*. A client owned by someone since
deactivated shows a value with no matching option. Either include inactive users flagged as such, or
confirm that reassignment away from them is intended.

The nomen half of this requirement is withdrawn — A3 settled it.

If R2 lands with relation choices included, this dissolves — the choices come from the serializer.

### R4 — A user detail route for the account fields · **P1**

```
GET   /auth/onboarding/users/{id}/          # to be created
PATCH /auth/onboarding/users/{id}/          # to be created
```

`email`, `first_name`, `last_name`, the organisation and the account's active flag belong to the user,
not the client record — and no route reaches them for anyone but yourself. This is the gap that makes
"fix the typo in their email" impossible today.

Per A6, `email` is the login credential. The route should treat a change to it as a credential change:
we will say so on the screen, and it deserves its own audit line.

The path mirrors the create route and is our preference, but any stable path works. It should carry the
same `organization_id` / `organization_name` either-or rule the create endpoint uses.

### R5 — The same reach for non-client roles · **P2**

The wizard onboards campaign managers, sales, coordination and accounts users too, and none of those
profiles can be edited. A campaign manager cannot be moved between tiers or reassigned to a different
team lead; a staff member's designation, WhatsApp number, photo or client-facing visibility cannot be
corrected after the fact.

Nesting these under R4 as writable `campaign_manager` and `staff_profile` blocks — the shape the create
payload already uses — covers it in one route rather than three.

### R6 — Password reset as its own action · **P2**

```
POST /auth/onboarding/users/{id}/reset-password/     # to be created
```

Deliberately not a field on R4. A password that can ride along in a general update is a password that
gets changed by accident, and it needs its own audit line and its own confirmation in the UI.

---

## 4. Create-time rules that need an edit-time answer

Two of the four in Rev 1 are now resolved. These remain:

| Rule at create | The situation it doesn't cover | What we'd like |
| --- | --- | --- |
| ~~`service_charge` must be absent for CPL~~ | — | ✅ Resolved `f7f0773`: switching to CPL clears the rate server-side. An explicitly-sent rate is still rejected, so the frontend drops the field from the payload entirely on a switch to CPL. |
| `data_visible_from` is retainer-only | A retainer moves to hybrid while carrying a visibility date. | Cleared server-side with the type change. Lands with R1. |
| `team_lead_id` must be absent for tier 1 | A tier-2 manager is promoted to tier 1 while still pointing at a team lead. | Cleared with the tier change. And a rule for what happens to *their* reports. Lands with R5. |
| ~~`nomen_id` must be unassigned~~ | — | ✅ Resolved by A3: reassignment refused outright. |

In every case our preference is the same: let the server clear the field that the new state makes
invalid, rather than requiring the client to send an explicit `null`. That keeps the rule in one place,
and it is the only version that survives a second caller who does not know about the pairing.

---

## 5. Permissions, audit and errors

### Who may edit — settled

**Admin + coordination**, since `68ed57d`. The same audience as Onboarding, which is the right shape:
correcting a client is the same job as creating one. CMs get a 403.

Worth recording what that deploy also closed: before it, any campaign manager whose team held the nomen
could PATCH a client — `client_type` included, ungated, retroactive. The route and sidebar entry now
match the endpoint.

The endpoint stays the authority either way. We do not filter by role on the frontend.

### Audit trail — now R8

The gap is named precisely as of Rev 4. What exists: `ClientStatusHistory` (engagement status),
`ClientValueTierHistory` (value tier). What doesn't: any record of a `client_type` or `service_charge`
change, and — when R1 lands — `onboarded_by`. All three move money or visibility:

- **`service_charge`** is a monthly percentage, and every month recomputes against it on read. One edit
  changes what every past month bills at, with nothing recording that it happened. **The live gap.**
- **`client_type`** rewrites which branch computes every invoice. Mostly closed by R7's lock, but the 12
  unlocked clients still pass through unrecorded.
- **`onboarded_by`** moves a client between two salespeople's dashboards for all history.

Tracked as **R8** above.

### Error envelope

Please keep the envelope the onboarding endpoint uses. We read the nested field map to pin each message
to the input that caused it, and we show your wording verbatim — so a rejection that names the
offending value is worth far more to the operator than a generic one.

```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code": "validation_error",
    "fields": {
      "service_charge": ["A CPL client cannot carry a service charge."],
      "non_field_errors": ["..."]
    }
  }
}
```

---

## 6. Answers received

**A1 — The writable set.** `ClientUpdateSerializer` (`views.py:145`) accepts `client_type`,
`service_charge`, `is_active`. Nothing else. → shapes R1, R2 and the frontend allowlist.

**A2 — `role` is not mutable.** Different operation. → dropped from the form entirely.

**A3 — Nomen reassignment: no**, and the endpoint should refuse it rather than leave it to the UI.
`Campaigns`, `CampaignNomenHistory`, payments, configs and the per-day ownership filter all key on
`client_nomen`; reassigning orphans every one. The client's own current nomen is accepted by its own
picker, anything else rejected. → R3's nomen half withdrawn, §4 row closed.

**A4 — CM assignments stay authoritative.** One writer. → `campaign_manager_ids` dropped from the R1
ask.

**A5 — `onboarded_by` is a live scoping filter, not attribution metadata.**
`Client.objects.filter(onboarded_by=user)` appears in nine places — insights, ledger, leads,
replacements, disqualifications, campaigns, billing — and none of them scope by date. Changing it
removes the client from one salesperson's dashboard entirely and adds it to another's, for all history,
immediately. → typed confirmation required when R1 makes it writable; audit line in §5.

**A6 — `email` is the login identity.** Sessions carry `user_id`, so existing tokens survive, but the
person's credential changes at their next login. → the screen will say so at the point of edit; folded
into R4.

**A7 — `client_type` is already writable, unguarded, and retroactive.** Raised by the backend team, not
asked by us. → R7, now shipped as a refusal.

**A8 — Editing is admin + coordination** (`68ed57d`). CMs get a 403; previously any CM whose team held
the nomen could PATCH, `client_type` included. → closes Q7; route and sidebar widened to match.

**A9 — The `service_charge` help text is wrong at source.** The model's `help_text` says "one-time
setup fee, unchanged thereafter". It is a **monthly percentage on marked-up spend**, and it is
writable. Being fixed at source, which also fixes what R2 publishes. → the frontend now prefers its own
curated hint over a serializer `help_text` where it has one.

**A10 — The recompute is lazy** (`f7f0773`). Nothing is stored; every figure computes on read. A switch
on one of the 12 unlocked clients lands the next time anyone opens the page, the client included. No
job to wait for, no window to revert. → now the most prominent line on the confirmation panel.

**A11 — Switching to CPL clears the service charge server-side** (`f7f0773`). Verified against prod
before the fix: `VijayChaudharyMdvProfessionalsLLP` at 10.00 returned *"Not allowed for cpl clients —
leave empty"* on a rate the caller never sent. After: valid, `service_charge: None` in
`validated_data`. An explicitly-sent rate is still rejected. → the frontend drops `service_charge` from
the payload entirely on a switch to CPL, and disables the input.

**A12 — The `service_charge` help text is fixed at source** (`f7f0773`), and is what R2 will publish:
*"Monthly percentage applied to marked-up spend when billing this client. Hybrid and retainer only; CPL
carries none. Editable — changing it moves every month recomputed against it."* → better than our own
wording, so the frontend reverted to serializer-first precedence (§8).

**A13 — `onboarded_by` deserves the same treatment as `client_type`** when R1 lands: a confirmation
naming who gains and who loses the client, not a plain dropdown. → built ahead of the field, §8.

### Still open

- **R2**, then **R1** — R2 first on purpose: once the form configures itself from the serializer, R1's
  fields appear with no frontend change.
- **R8** — proposed and endorsed, not yet scheduled.
- **R3–R6** — untouched.

---

## 7. Done means

- [ ] An authenticated `OPTIONS /clients/admin/clients/{id}/` returns an `actions.PUT` map listing every writable field, with choices on the relations.
- [ ] A `PATCH` carrying one field changes that field and leaves every other one untouched.
- [ ] `onboarded_by` and `data_visible_from` can be changed and read back changed on the next `GET`.
- [ ] `onboarded_by` rejects a user whose role is neither `sales` nor `admin`.
- [x] A `client_type` switch on a client with billed history is refused with a coded error. — `68ed57d`, verified on client 134
- [x] A non-admin caller gets a 403, not a silent success. — `68ed57d`, admin + coordination
- [x] Switching a hybrid client to CPL leaves no service charge behind. — `f7f0773`, verified on VijayChaudharyMdvProfessionalsLLP
- [ ] A `client_type` or `service_charge` change is recorded with actor, timestamp, before/after and a reason. — R8
- [ ] A `nomen` reassignment is refused by the endpoint, not just by the UI.
- [ ] `email`, `first_name`, `last_name` and the organisation are reachable through a user detail route.
- [ ] Every rejection arrives in the existing envelope with a field map naming the offending value.
- [ ] `client_type`, `service_charge` and `onboarded_by` changes appear in an audit log with actor, timestamp and before/after.

---

## 8. What the frontend has already done

Live behind **Admin › Edit Clients**. The form discovers its fields from whatever the API publishes, so
it picks up new writable fields as they ship — no frontend release is needed per field once R1 and R2
are in.

### Rev 4 — in response to `f7f0773`

- **The confirmation leads with "immediately, for all history".** Lazy recompute is the part people get
  wrong — it sounds like the safer of the two options and is the opposite. The panel now says figures
  are computed on read, that the new numbers appear the next time anyone opens the page *including the
  client*, and that there is nothing to wait for and nothing to undo.
- **`service_charge` is dropped from the payload on a switch to CPL**, not sent as null. The server
  clears it; an explicitly-sent rate is still a 400, so sending anything is the one way to turn a valid
  switch into a rejection. The input is disabled when the type reads CPL, saying so before the save
  rather than after.
- **`onboarded_by` is guarded ahead of the field existing.** The same two-step confirmation as
  `client_type`, naming who gains and who loses the client — by name, since "12 → 31" tells the operator
  nothing — and stating that the move is complete and immediate across insights, ledger, leads,
  replacements, disqualifications, campaigns and billing. It arrives guarded rather than as a plain
  dropdown the day R1 lands.
- **Serializer-first precedence restored**, with a narrower exception. Rev 3 made our wording beat
  `help_text` because `service_charge`'s was wrong; you fixed it at source and yours is now better than
  ours. So `help_text` wins again, our text fills the silence until R2, and a separate always-shown
  `note` carries only what a serializer structurally cannot know — that a field belongs on the Client
  Status or Value Tier screen.

### Rev 3 — in response to `68ed57d`

- **The typed confirmation no longer invents a month count.** It used to derive one from `created_at`
  and ask the operator to type it. That number was months-of-existence, not months-billed — an
  approximation dressed as a fact, and the arithmetic is now deleted rather than kept alongside the
  real thing. The endpoint knows which months were actually billed; we never did. The confirmation
  stays for the 12 unlocked clients and confirms by naming the client.
- **`client_type_locked` is handled as its own outcome.** The 422 is shown whole, with your months, as
  a refusal with a reason — not as a red line under a dropdown. The panel says up front that most
  clients will be refused, so it reads as expected rather than as a failure.
- **Client nomen is read-only, by name.** It was rendering the raw id in an editable box that saved
  nothing. It now sits in a new read-only "This client" block with email, organisation, sales person
  and onboarding date — each carrying the reason it is fixed, so a missing input is answered rather
  than just noticed.
- **A curated hint now beats a serializer `help_text`.** Precedence ran the other way until
  `service_charge` turned up describing a one-time setup fee (A9). A `help_text` is documentation and
  documentation goes stale; the hints here are few and checked. Your `help_text` still fills in every
  field we have not written one for — including everything R1 adds.
- **Route and sidebar widened to admin + coordination**, matching the endpoint.

### Rev 2

- **The fallback field list is your three fields**, not a reading of the record. Prevents an operator
  editing a field the serializer drops and being told it saved.
- **`onboarded_by` support is built and dormant.** The picker, sourced from
  `/auth/onboarding/options/`, renders the moment the serializer exposes the field. Until then the
  drawer says plainly that the sales owner cannot be reassigned here.

Route capabilities in §1 were probed on 8 September 2026. Payload fields in §2 come from the onboarding
wizard source (`src/pages/onboarding/OnboardingWizard.jsx`), not from documentation.
