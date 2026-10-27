# Profile Settings (self-service email + phone) — backend requirements

**For:** Backend team
**Raised by:** Frontend · Settings → Profile Settings
**Date:** 26 October 2026 · **Rev 2** — backend shipped
**Status:** R1–R3 ✅ backend `16bc718` (verified live: `OPTIONS /auth/me/` → `GET, PATCH, HEAD, OPTIONS`) · R4 ❌ declined · all questions answered

The avatar menu in the header has a "Profile Settings" item. It opens `/settings`, where a user sees
their own record (from `GET /auth/me/`) and can edit the two contact fields they own: **email** and
**phone**. The screen sends the request described in §3.

**What changed in Rev 2.** The backend landed exactly as specified, with these confirmed details:
phone is the **existing `User.phone`** (26 users already had one), served as `data.phone` and `""`
when unset; `StaffContactProfile.whatsapp` is a separate number and is untouched. Email is trimmed,
lower-cased and unique case-insensitively. The token is keyed by user id, so an email change does
**not** end the session; the old address is emailed on every change; every change is written to the
activity log (old → new, who, IP). **R4 is not being built** (decision from Alok): no password
section on the screen. Answers to §4: username stays read-only (identity used in audit and search);
no duplicate phone; old-address notification is sent. The frontend's "isn't live yet" line for a 405
has been removed — §1 below is kept as the pre-ship record.

---

## 1. Where we are

Probed against `metadashboard.aajneeticonnectltd.com` on 26 Oct 2026 — an unauthenticated `OPTIONS`
returns the `Allow` header alongside the 401, and an unrouted path returns a bare 404.

| Route | Allow | What that means |
| --- | --- | --- |
| `/auth/me/` | `GET, HEAD, OPTIONS` | Self-read only. **No write verb.** |
| `/auth/me` | `301` → `/auth/me/` | Trailing-slash redirect only. |
| `/auth/profile/`, `/auth/profile/update/`, `/auth/users/me/`, `/users/me/` | `404` | Not routed. |
| `/auth/change-password/`, `/auth/password/change/`, `/auth/password-change/`, `/auth/me/password/` | `404` | No password endpoint exists either. |
| `/auth/onboarding/users/` | `POST, OPTIONS` | Create only; no detail route (see CLIENT_EDIT_API_REQUIREMENTS.md §1). |

So today **nobody can change their own email or phone through the API at all**, and there is no phone
field on the user record that the frontend can see.

### What `GET /auth/me/` returns today

Keys the frontend reads from `data` (verified live, used by `stores/currentUser.js`):

```
id  email  username  organization_id  organization_name  role  cm_profile{tier,is_active}  is_superuser
```

There is **no `phone`** key. The frontend reads `data.phone` and nothing else — no aliases
(`phone_number`, `mobile`, …) are tried, so the key name in R1 is load-bearing.

---

## 2. Requirements

### R1 — `phone` on the user record and on `GET /auth/me/`

- Add a `phone` field to the user (or the profile model every role shares — it must exist for **all**
  roles: admin, campaign_manager, client, sales, coordination, accounts, creative).
- Nullable / blank allowed. Max length 20. Store as entered after trimming; do not reformat.
- Return it on `GET /auth/me/` as `data.phone` (`null` or `""` when unset — either is fine, the
  frontend treats both as empty).
- If a phone already exists elsewhere for some roles (e.g. a client contact number used by
  `/clients/me/` or the My Team roster's `phone`/`whatsapp`), say which field this is and whether
  R2 writes to that one or to a new one. The frontend does not care which, but two phones for one
  person that drift apart is the bug we want to avoid.

### R2 — `PATCH /auth/me/` (the write)

Same route, new verb. Authenticated user edits **their own** record only; there is no `{id}` and no
way to target another user.

**Request** — partial; only the keys the user changed are sent:

```jsonc
PATCH /auth/me/
{
  "email": "new@example.com",        // optional
  "phone": "+91 98765 43210",        // optional; "" clears it
  "current_password": "…"            // REQUIRED when "email" is present, otherwise absent
}
```

**Rules**

| Field | Rule |
| --- | --- |
| `email` | Required non-blank if present. Valid email. Normalise (lower-case, trim). **Unique across users** → 400 `fields.email: ["A user with this email already exists."]`. Must be accompanied by a correct `current_password` → otherwise 400 `fields.current_password: ["Current password is incorrect."]` (or `["This field is required."]` when missing). |
| `phone` | Optional. Trim. Allow `+ digits space - ( )`, 7–15 digits. Empty string clears. Invalid → 400 `fields.phone: [<reason>]`. |
| `current_password` | Only read when `email` is present. Never echoed back. Never required for a phone-only change. |
| anything else | `username`, `role`, `organization_*`, `cm_profile`, `is_superuser`, `is_active` etc. must be **rejected or ignored** — but please reject (400 `fields.<name>: ["This field cannot be changed here."]`) rather than silently drop, so a future frontend mistake is visible. |

**Why `current_password` on an email change.** `POST /auth/login/` takes `{email, password}` — email
*is* the credential. A session left open on a shared machine should not be enough to re-point an
account's login identity. Phone is not a credential, so it needs no re-auth.

**Response** — the standard envelope with the **full, updated** `/auth/me/` body:

```jsonc
200
{ "success": true, "message": "Profile updated", "data": { …same shape as GET /auth/me/, with new email/phone… } }
```

**Errors** — the standard validation envelope the frontend already parses
(`utils/apiErrors.js`): `{ success:false, message:"Validation failed", error:{ code, detail,
fields:{ <field>:[msg] } } }` with HTTP 400. Field keys must be exactly `email`, `phone`,
`current_password` — the form pins messages to inputs by those names.

**Tokens.** Changing the email must **not** invalidate the current access/refresh token (the user
stays logged in and the next request works). If your JWT embeds the email, re-read it from the DB on
`/auth/me/` rather than from the claim, or document that we must re-login — the frontend currently
assumes the session survives and just tells the user to use the new email next time.

**Audit.** Log who changed what (old → new email, old → new phone, timestamp, IP) — an email change is
an account-takeover vector and should be traceable. Same shape as the CM profile history is fine.

### R3 — `OPTIONS /auth/me/` reflects the new verb

`Allow: GET, PATCH, HEAD, OPTIONS`. The frontend treats a `405` on PATCH as "not deployed yet" and
shows an informational line instead of an error, so this is how we tell the two apart in prod.

### R4 — Change password (proposed, optional, separate endpoint)

Not built on the frontend yet, listed so it can be designed alongside R2 rather than bolted on:

```
POST /auth/me/password/
{ "current_password": "…", "new_password": "…", "confirm_password": "…" }
→ 200 { success:true, message:"Password changed" }
→ 400 fields.current_password / fields.new_password (Django validators' messages verbatim)
```

Should rotate the refresh token (invalidate other sessions). Reply if you'd rather it be `PATCH
/auth/me/` with a `new_password` key — either works, but the frontend will build to whichever you
pick, so please say.

---

## 3. What the frontend sends today

File: `src/services/userProfile.js` → `updateMyProfile(patch)`; screen: `src/pages/Settings.jsx`.

- Diffs the inputs against the loaded `/auth/me/` values and sends **only changed keys**.
- Adds `current_password` **only** when `email` changed; the password box only appears then.
- Client-side pre-checks (email format, phone charset + 7–15 digits) exist to save a round trip, but
  the server's `fields.*` messages are shown verbatim and win.
- On 200: re-fetches `/auth/me/`, updates the header's cached user, shows "Profile saved".
- On 400: pins `fields.email / phone / current_password` to the inputs; `non_field_errors` or
  `error.detail` becomes the banner.

## 4. Questions

1. Is `username` meant to be editable as a display name, or is it an identity (unique, used in
   audit trails)? The screen shows it read-only for now; if it is safe to edit, add it to R2 and we
   will unlock the input.
2. Does any role already have a phone somewhere (clients via `/clients/me/`, CMs via the team
   roster)? See R1's last bullet.
3. Should an email change send a notification to the **old** address? Recommended; no frontend
   impact either way.
