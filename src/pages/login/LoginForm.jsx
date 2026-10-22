import { createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { loginUser } from "../../services/login-service";
import { clearAllCache } from "../../cacheStore/appStore";
import "./login-v3.css";

// ── v3 decorative geometry (built once at module load, never re-computed) ──
// Nautilus spiral: ellipses anchored at one shared centre, each turned a
// little further round and drawn a little larger than the last, so together
// they fan out into a shell. The staggered delay makes the shell draw itself
// in one sweeping turn on load.
const NAUTILUS = Array.from({ length: 96 }, (_, i) => {
  const t = i / 95;
  const a = -110 + t * 410;                // a little over one full turn
  const s = 0.1 + 0.9 * Math.pow(t, 1.25); // grow from a seed to full size
  const rx = 240 * s;
  const ry = 92 * s;
  const rad = (a * Math.PI) / 180;
  return {
    a: +a.toFixed(2),
    rx: +rx.toFixed(2),
    ry: +ry.toFixed(2),
    // shift the centre out along the turn so one end sits on the shared hub
    cx: +(rx * 0.78 * Math.cos(rad)).toFixed(2),
    cy: +(rx * 0.78 * Math.sin(rad)).toFixed(2),
    delay: `${(i * 0.028).toFixed(3)}s`,
  };
});

// Silk ribbon: one cubic curve repeated with a small drift per strand, so the
// bundle fans open and pinches like a sheet of thread.
const SILK_PATHS = Array.from({ length: 34 }, (_, i) =>
  `M-60 ${430 + i * 4} C 260 ${250 + i * 9}, 640 ${650 - i * 8}, 1260 ${300 + i * 6}`,
);

// Rising embers — fixed positions/timings so the layout is stable per load.
const EMBERS = [
  [6, 0, 14], [14, -5, 18], [23, -9, 16], [31, -2, 20], [42, -12, 17],
  [55, -6, 19], [63, -14, 15], [71, -3, 21], [80, -8, 16], [88, -11, 18],
  [94, -4, 22], [48, -16, 20],
].map(([left, delay, dur]) => ({
  left: `${left}%`,
  delay: `${delay}s`,
  dur: `${dur}s`,
}));

// ✅ Decode JWT expiry
const getTokenExpiry = (token) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000;
  } catch {
    return null;
  }
};

export const handleLogout = () => {
  clearAllCache(); // wipe sessionStorage cache so next login starts fresh
  localStorage.removeItem("auth");
  localStorage.removeItem("selectedClientNomen");

  localStorage.removeItem("selectedClientNomenId");
  localStorage.removeItem("selectedClientId");

  localStorage.removeItem("selectedClientName");
  // Sidebar groups differ by role — don't carry the last one into the next login.
  localStorage.removeItem("sidebarOpenMenu");
  window.location.href = "/login";
};

export default function Login() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [isLoggedIn, setIsLoggedIn] = createSignal(false);
  const [showPassword, setShowPassword] = createSignal(false);

  const navigate = useNavigate();

  onMount(() => {
    const auth = JSON.parse(localStorage.getItem("auth") || "null");

    if (auth?.token && auth?.refreshToken) {
      // Both tokens present — safe to continue session
      setIsLoggedIn(true);
      navigate("/dashboard", { replace: true });
    } else if (auth?.token && !auth?.refreshToken) {
      // Access token only, no refresh token — clear and re-login
      console.warn("No refresh token found — clearing session");
      localStorage.removeItem("auth");
    }

    // Listen for token updates from other tabs
    try {
      const channel = new BroadcastChannel("token_refresh");
      channel.onmessage = (e) => {
        if (e.data.type === "TOKEN_REFRESHED") {
          const auth = JSON.parse(localStorage.getItem("auth") || "null");
          if (auth) {
            auth.token = e.data.token;
            auth.tokenExpiresAt = e.data.tokenExpiresAt;
            localStorage.setItem("auth", JSON.stringify(auth));
          }
        }
      };
    } catch {}
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // FIX: Clear stale sessionStorage cache from the expired session BEFORE
    // logging in. Previously, the cache was only cleared on manual logout
    // (handleLogout). After a softLogout (auto session expiry), the cache
    // survived into the new session. Dashboard components then read it on
    // mount and never fired fresh API calls, causing blank/stale data.
    clearAllCache();

    try {
      const res = await loginUser(email(), password());
      const accessToken = res?.data?.access_token;
      const refreshToken = res?.data?.refresh_token;

      if (!accessToken) throw new Error("Access token not found");

      if (!refreshToken) {
        console.warn(
          "⚠️ No refresh token received — user may be logged out when access token expires",
        );
      }

      // Fetch user role — don't block login if it fails
      let role = "client";
      try {
        const meRes = await fetch(
          "https://metadashboard.aajneeticonnectltd.com/api/auth/me",
          { headers: { Authorization: "Bearer " + accessToken } },
        );
        const meData = await meRes.json();
        role = meData?.data?.role ?? "client";
      } catch (err) {
        console.warn("Could not fetch user role, defaulting to client:", err);
      }

      // Fetch client type — don't block login if it fails
      let client_type = null;
      let clientNomen = null; // ← add this
      let serviceCharge = 13; // default
      if (role === "client") {
        try {
          const clientRes = await fetch(
            "https://metadashboard.aajneeticonnectltd.com/api/clients/me/",
            { headers: { Authorization: "Bearer " + accessToken } },
          );
          const clientData = await clientRes.json();
          client_type = clientData?.data?.client_type ?? null;
          clientNomen = clientData?.data?.client_nomen_name ?? null; // ← add this
           serviceCharge = Number(clientData?.data?.service_charge ?? 13);
        } catch (err) {
          console.warn("Could not fetch client type:", err);
        }
      }

      const authData = {
        token: accessToken,
        refreshToken: refreshToken ?? null,
        tokenExpiresAt: getTokenExpiry(accessToken),
        user: res?.data?.user || null,
        isAuthenticated: true,
        role,
        client_type,
        clientNomen, // ← add this
        serviceCharge, // ← add this
      };

      localStorage.setItem("auth", JSON.stringify(authData));

      // FIX: Use window.location.href instead of navigate().
      //
      // navigate("/dashboard", { replace: true }) is an in-memory SolidJS
      // route change — it does NOT remount components that are already in
      // the tree. After a softLogout the router navigated to /login without
      // a page reload, so dashboard components were already mounted.
      // When the user logged back in and navigate() was called, those
      // components never re-ran their onMount data-fetching logic.
      //
      // window.location.href forces a full browser reload, guaranteeing
      // every component initialises from scratch with the new auth token
      // and an empty cache — exactly what handleLogout already does.

      window.location.href = "/dashboard";
    } catch (err) {
      console.error(err);
      setError(err.message || "Login failed. Please try again.");
      setLoading(false); // Only reset loading on error; success navigates away
    }
  };

  return (
    <div class="lg3">
      {/* ── Ambient backdrop ──
          Ivory-to-apricot wash, three drifting aurora glows, a diagonal light
          shaft, a bundle of silk lines along the bottom, rising embers and a
          film-grain overlay. Purely decorative: aria-hidden, no content. */}
      <div class="lg3-bg" aria-hidden="true">
        <div class="lg3-aurora lg3-aurora--1" />
        <div class="lg3-aurora lg3-aurora--2" />
        <div class="lg3-aurora lg3-aurora--3" />
        <div class="lg3-beam" />
        <svg
          class="lg3-silk"
          viewBox="0 0 1200 600"
          preserveAspectRatio="none"
          fill="none"
        >
          <defs>
            <linearGradient id="lg3-silk-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#f2b33d" stop-opacity="0" />
              <stop offset="0.35" stop-color="#f0a845" />
              <stop offset="0.7" stop-color="#e07a5f" />
              <stop offset="1" stop-color="#c8614a" stop-opacity="0" />
            </linearGradient>
          </defs>
          <g stroke="url(#lg3-silk-grad)" stroke-width="0.8">
            {SILK_PATHS.map((d) => (
              <path d={d} />
            ))}
          </g>
        </svg>
        {EMBERS.map((e) => (
          <span
            class="lg3-ember"
            style={{
              left: e.left,
              "animation-delay": e.delay,
              "animation-duration": e.dur,
            }}
          />
        ))}
        <div class="lg3-grain" />
      </div>

      {/* ── Back to the landing page ──
          Always "/" rather than history.back(): /login is often opened
          directly (bookmark, session expiry, logout redirect), where going
          back would leave the app entirely. No visible label, so aria-label
          is the control's only accessible name. */}
      <button
        type="button"
        class="lg3-back"
        onClick={() => navigate("/")}
        aria-label="Back to home"
        title="Back to home"
      >
        <svg
          viewBox="0 0 25 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12.99 5.52h7.83a2.16 2.16 0 0 1 2.16 2.16v7.24a2.16 2.16 0 0 1-2.16 2.16H7.77a2.16 2.16 0 0 1-2.16-2.16V14.2" />
          <path d="M1.6 8.15 7.87 2.3v3.1c2.43.3 7.73 2.4 9.33 9.2-1.5-2.7-5.5-3.7-9.33-3.7v3.1Z" />
        </svg>
      </button>

      {/* ── Company logo — top-right, on a frosted glass pill. */}
      <div class="lg3-logo">
        <img src="/logo.webp" alt="Company Logo" />
      </div>

      <div class="lg3-stage">
        {/* ── HERO: animated spirograph + welcome copy ── */}
        <section class="lg3-hero">
          <div class="lg3-spiro-wrap" aria-hidden="true">
            <svg class="lg3-spiro" viewBox="-430 -430 860 860" fill="none">
              <defs>
                <linearGradient id="lg3-spiro-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="#f2b33d" />
                  <stop offset="0.55" stop-color="#e0893a" />
                  <stop offset="1" stop-color="#c8614a" />
                </linearGradient>
              </defs>
              <g class="lg3-spiro-spin">
                {NAUTILUS.map((r) => (
                  <ellipse
                    class="lg3-spiro-line"
                    cx={r.cx}
                    cy={r.cy}
                    rx={r.rx}
                    ry={r.ry}
                    transform={`rotate(${r.a} ${r.cx} ${r.cy})`}
                    pathLength="1"
                    stroke="url(#lg3-spiro-grad)"
                    style={{ "animation-delay": r.delay }}
                  />
                ))}
              </g>
            </svg>
            <div class="lg3-spiro-core" />
          </div>

          <div class="lg3-hero-copy">
            <h2 class="lg3-welcome">Welcome</h2>
            <p class="lg3-tagline">
              Campaigns that <em>convert.</em> Insights that matter.
            </p>
            <p class="lg3-desc">
              Your all-in-one marketing dashboard to track projects, manage
              campaigns, and measure real ROI — all in one place.
            </p>
          </div>
        </section>

        {/* ── LOGIN FORM — sits open on the backdrop; only the fields are glass ── */}
        <section class="lg3-panel">
          <div class="lg3-card">
            <h1 class="lg3-title">Aajneeti Reporting Dashboard</h1>
            <p class="lg3-sub">Login to your account to continue</p>

            {/* Error */}
            {error() && <div class="lg3-error">{error()}</div>}

            {/* Login Form */}
            {!isLoggedIn() && (
              <form onSubmit={handleSubmit} class="lg3-form">
                <div class="lg3-group">
                  <label class="lg3-label">Email</label>
                  <div class="lg3-field">
                    <svg
                      class="lg3-field-ico"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      aria-hidden="true"
                    >
                      <rect x="3" y="5" width="18" height="14" rx="2.5" />
                      <path d="M3.5 7l8.5 6 8.5-6" stroke-linecap="round" />
                    </svg>
                    <input
                      type="email"
                      value={email()}
                      onInput={(e) => setEmail(e.target.value)}
                      class="lg3-input"
                      placeholder="you@company.com"
                      required
                    />
                  </div>
                </div>

                <div class="lg3-group">
                  <label class="lg3-label">Password</label>
                  <div class="lg3-field">
                    <svg
                      class="lg3-field-ico"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      aria-hidden="true"
                    >
                      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
                      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke-linecap="round" />
                    </svg>
                    <input
                      type={showPassword() ? "text" : "password"}
                      value={password()}
                      onInput={(e) => setPassword(e.target.value)}
                      class="lg3-input"
                      placeholder="••••••••••"
                      required
                    />
                    <button
                      type="button"
                      class="lg3-eye"
                      onClick={() => setShowPassword(!showPassword())}
                      aria-label={
                        showPassword() ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword() ? (
                        // Eye-off icon (password visible → click to hide)
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        // Eye icon (password hidden → click to show)
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={loading()} class="lg3-submit">
                  {loading() && <span class="lg3-spinner" />}
                  {loading() ? "Logging in..." : "Login "}
                </button>
              </form>
            )}

            {/* Logout */}
            {isLoggedIn() && (
              <button onClick={handleLogout} class="lg3-logout">
                Sign out
              </button>
            )}

            <div class="lg3-footer">
              <span class="lg3-secure">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  aria-hidden="true"
                >
                  <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
                </svg>
                Protected by enterprise-grade security.
              </span>
              <span class="lg3-copy">
                &copy; {new Date().getFullYear()} Aajneeti Connect Limited. All
                rights reserved.
              </span>
            </div>

            <div class="lg3-powered">
              <span>Powered by</span>
              <img src="/logo.webp" alt="Company Logo" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
