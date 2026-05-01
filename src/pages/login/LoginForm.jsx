import { createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { loginUser } from "../../services/login-service";


// ✅ Logout Function (FIXED)
export const handleLogout = () => {
    console.log("User Logout");

    // ✅ 1. Remove auth
    localStorage.removeItem("auth");

    // ✅ 2. Force redirect (works globally)
    window.location.href = "/login";
};

export default function Login() {
    const [email, setEmail] = createSignal("");
    const [password, setPassword] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal("");
    const [isLoggedIn, setIsLoggedIn] = createSignal(false);

    const navigate = useNavigate();

    // ✅ Check if already logged in
    onMount(() => {
        const auth = JSON.parse(localStorage.getItem("auth"));
        if (auth?.token) {
            setIsLoggedIn(true);
            navigate("/", { replace: true });
        }
    });

    // const handleSubmit = async (e) => {
    //     e.preventDefault();

    //     setLoading(true);
    //     setError("");

    //     try {
    //         const res = await fetch("http://192.168.1.48:4756/api/auth/login/", {
    //             method: "POST",
    //             headers: {
    //                 "Content-Type": "application/json",
    //             },
    //             body: JSON.stringify({
    //                 email: email(),
    //                 password: password(),
    //             }),
    //         });

    //         const data = await res.json();
    //         console.log("Login response:", data);

    //         if (!res.ok) {
    //             throw new Error(data?.message || "Invalid credentials");
    //         }

    //         const token = data?.data?.access_token;

    //         if (!token) {
    //             throw new Error("Token not found in response");
    //         }

    //         const authData = {
    //             token: token,
    //             user: data?.data?.user || null,
    //             isAuthenticated: true,
    //         };

    //         localStorage.setItem("auth", JSON.stringify(authData));

    //         setIsLoggedIn(true);

    //         // 🚀 Redirect after login
    //         navigate("/", { replace: true });

    //     } catch (err) {
    //         console.error(err);
    //         setError(err.message);
    //     } finally {
    //         setLoading(false);
    //     }
    // };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await loginUser(email(), password());
            const token = res?.data?.access_token;
            if (!token) throw new Error("Token not found");

            // ✅ Fetch role
            const meRes = await fetch(
                "https://metadashboard.aajneeticonnectltd.com/api/auth/me",
                { headers: { Authorization: "Bearer " + token } }
            );
            const meData = await meRes.json();
            const role = meData?.data?.role ?? "client";

            // ✅ NEW: Fetch client_type (only for client role)
            let client_type = null;
            if (role === "client") {
                try {
                    const clientRes = await fetch(
                        "https://metadashboard.aajneeticonnectltd.com/api/clients/me/",
                        { headers: { Authorization: "Bearer " + token } }
                    );
                    const clientData = await clientRes.json();
                    client_type = clientData?.data?.client_type ?? null; // "retainer" | "cpl" | "hybrid"
                } catch (err) {
                    console.warn("Could not fetch client type:", err);
                }
            }

            const authData = {
                token,
                user: res?.data?.user || null,
                isAuthenticated: true,
                role,
                client_type, // ✅ stored here
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
        <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-100 via-white to-blue-100 px-4">

            <div class="w-full max-w-md backdrop-blur-lg bg-white/70 shadow-xl rounded-2xl p-8 border border-gray-200">

                <h2 class="text-2xl font-bold text-gray-800 text-center mb-2">
                    Welcome Back 👋
                </h2>

                <p class="text-sm text-gray-500 text-center mb-6">
                    {isLoggedIn() ? "You are logged in" : "Login to your account"}
                </p>

                {/* ❌ Error */}
                {error() && (
                    <div class="mb-4 text-red-500 text-sm text-center">
                        {error()}
                    </div>
                )}

                {/* ✅ Show Login Form only if NOT logged in */}
                {!isLoggedIn() && (
                    <form onSubmit={handleSubmit} class="space-y-4">

                        <div>
                            <label class="text-sm text-gray-600">Email</label>
                            <input
                                type="email"
                                value={email()}
                                onInput={(e) => setEmail(e.target.value)}
                                class="w-full mt-1 px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-400"
                                required
                            />
                        </div>

                        <div>
                            <label class="text-sm text-gray-600">Password</label>
                            <input
                                type="password"
                                value={password()}
                                onInput={(e) => setPassword(e.target.value)}
                                class="w-full mt-1 px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-400"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading()}
                            class="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition shadow-md disabled:opacity-50"
                        >
                            {loading() ? "Logging in..." : "Login"}
                        </button>
                    </form>
                )}

                {/* ✅ Logout Button */}
                {isLoggedIn() && (
                    <button
                        onClick={handleLogout}
                        class="w-full mt-4 bg-red-500 text-white py-2 rounded-lg hover:bg-red-600 transition shadow-md"
                    >
                        Logout
                    </button>
                )}

            </div>
        </div>
    );
}