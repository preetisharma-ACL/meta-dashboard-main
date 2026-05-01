import { createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { loginUser } from "../../services/login-service";

export const handleLogout = () => {
    console.log("User Logout");
    localStorage.removeItem("auth");
    window.location.href = "/login";
};

export default function Login() {
    const [email, setEmail] = createSignal("");
    const [password, setPassword] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal("");
    const [isLoggedIn, setIsLoggedIn] = createSignal(false);

    const navigate = useNavigate();

    onMount(() => {
        const auth = JSON.parse(localStorage.getItem("auth"));
        if (auth?.token) {
            setIsLoggedIn(true);
            navigate("/", { replace: true });
        }
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await loginUser(email(), password());
            const accessToken = res?.data?.access_token;
            const refreshToken = res?.data?.refresh_token;
            if (!accessToken) throw new Error("Access token not found");

            const meRes = await fetch(
                "https://metadashboard.aajneeticonnectltd.com/api/auth/me",
                { headers: { Authorization: "Bearer " + accessToken } }
            );
            const meData = await meRes.json();
            const role = meData?.data?.role ?? "client";

            let client_type = null;
            if (role === "client") {
                try {
                    const clientRes = await fetch(
                        "https://metadashboard.aajneeticonnectltd.com/api/clients/me/",
                        { headers: { Authorization: "Bearer " + accessToken } }
                    );
                    const clientData = await clientRes.json();
                    client_type = clientData?.data?.client_type ?? null;
                } catch (err) {
                    console.warn("Could not fetch client type:", err);
                }
            }

            const authData = {
                token: accessToken,
                refreshToken,
                user: res?.data?.user || null,
                isAuthenticated: true,
                role,
                client_type,
            };
                

            localStorage.setItem("auth", JSON.stringify(authData));
            window.dispatchEvent(new Event("storage"));
            setIsLoggedIn(true);
            navigate("/", { replace: true });

        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div class="login-root">
                {/* ── LEFT DECORATIVE PANEL ── */}
                <div class="login-left">
                    <div class="blob blob-1" />
                    <div class="blob blob-2" />
                    <div class="blob blob-3" />
                    <div class="left-glass-card">
                        <div class="brand-dots">
                            <div class="brand-dot" style="background:#5b7fa6" />
                            <div class="brand-dot" style="background:#8a6fc4" />
                            <div class="brand-dot" style="background:#f0a8b8" />
                        </div>
                        <h2 class="left-tagline">
                            Campaigns that<br /><em>convert.</em><br />Insights that matter.
                        </h2>
                        <p class="left-desc">
                            Your all-in-one marketing dashboard to track projects,
                            manage campaigns, and measure real ROI — all in one place.
                        </p>
                        {/* <div class="left-email-row">
                            <input
                                class="left-email-input"
                                type="text"
                                placeholder="Enter your email address"
                                disabled
                            />
                            <button class="left-signup-btn">Get access</button>
                        </div> */}
                        <div class="orb-ring" />
                    </div>
                </div>

                {/* ── RIGHT LOGIN PANEL ── */}
                <div class="login-right">
                    <div class="form-wrapper">

                        {/* Logo */}
                        <div class="form-logo">
                            <div class="form-logo-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                            </div>
                            <span class="form-logo-text">MetaDashboard</span>
                        </div>

                        <h1 class="form-heading">
                            {isLoggedIn() ? "You're in." : "Welcome back"}
                        </h1>
                        <p class="form-subheading">
                            {isLoggedIn()
                                ? "You are already logged in to your account."
                                : "Sign in to your account to continue"}
                        </p>

                        {/* Error */}
                        {error() && (
                            <div class="error-box">
                                {error()}
                            </div>
                        )}

                        {/* Login Form */}
                        {!isLoggedIn() && (
                            <form onSubmit={handleSubmit}>
                                <div class="input-group">
                                    <label class="input-label">Email address</label>
                                    <input
                                        type="email"
                                        value={email()}
                                        onInput={(e) => setEmail(e.target.value)}
                                        class="input-field"
                                        placeholder="you@company.com"
                                        required
                                    />
                                </div>

                                <div class="input-group">
                                    <label class="input-label">Password</label>
                                    <input
                                        type="password"
                                        value={password()}
                                        onInput={(e) => setPassword(e.target.value)}
                                        class="input-field"
                                        placeholder="••••••••••"
                                        required
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading()}
                                    class="submit-btn"
                                >
                                    {loading() && <span class="spinner" />}
                                    {loading() ? "Signing in..." : "Sign in"}
                                </button>
                            </form>
                        )}

                        {/* Logout */}
                        {isLoggedIn() && (
                            <button onClick={handleLogout} class="logout-btn">
                                Sign out
                            </button>
                        )}

                        <p class="form-footer">
                            Protected by enterprise-grade security.<br />
                            &copy; {new Date().getFullYear()} MetaDashboard. All rights reserved.
                        </p>
                    </div>
                </div>

            </div>
        </>
    );
}