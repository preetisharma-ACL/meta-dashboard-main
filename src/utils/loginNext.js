// ─── Where to land after logging in ───────────────────────────────────────────
// Normally /dashboard. A `?next=` param on /login overrides it, which is how
// the PUBLIC /payment-result page sends an unauthenticated client to log in and
// get them back to the exact receipt they were trying to read.
//
// ONLY a same-origin path is honoured, and the refusals are the point of this
// file. The value must start with a SINGLE "/":
//
//   "//evil.test"        is protocol-relative and resolves to another HOST.
//                        Honouring it would make the login form an open
//                        redirect: a crafted /login?next=//evil.test link would
//                        hand a freshly signed-in user to someone else's page,
//                        with our own domain in the referrer.
//   "https://evil.test"  the same thing, said plainly.
//   "javascript:…"       no slash at all, so the leading-slash rule covers it.
//   "dashboard"          relative to whatever path happens to be current.
//
// Anything that fails the test falls back to /dashboard. It is NEVER repaired
// into something that looks close enough: a redirect target is exactly the kind
// of value where a helpful guess is the vulnerability.
//
// Pure and separate from LoginForm.jsx so scripts/verify-online-pay.mjs can
// assert the refusals directly. The form calls it in two places (the
// already-signed-in path on mount, and the full reload after a successful
// login), so both honour the same rule.

const SAFE_NEXT = /^\/(?!\/)[^\s]*$/;

export const DEFAULT_LANDING = "/dashboard";

export const nextAfterLogin = (search) => {
  const raw = (() => {
    try {
      const qs =
        search ??
        (typeof window !== "undefined" ? window.location?.search : "") ??
        "";
      return new URLSearchParams(qs).get("next");
    } catch {
      return null;
    }
  })();
  return raw && SAFE_NEXT.test(raw) ? raw : DEFAULT_LANDING;
};
