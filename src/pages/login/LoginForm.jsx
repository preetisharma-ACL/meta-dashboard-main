import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";

export default function Login() {
    const [email, setEmail] = createSignal("");
    const [password, setPassword] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal("");

    const navigate = useNavigate();
    const handleSubmit = async (e) => {
        e.preventDefault();

        setLoading(true);
        setError("");

        try {
            const res = await fetch("http://192.168.1.38:4756/api/auth/login/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: email(),
                    password: password(),
                }),
            });

            const data = await res.json();
            console.log("Login response:", data);

            if (!res.ok) {
                throw new Error(data?.message || "Invalid credentials");
            }

            // ✅ Extract correct token
            const token = data?.data?.access_token;

            if (!token) {
                throw new Error("Token not found in response");
            }

            // ✅ Create single auth object
            const authData = {
                token: token,
                user: data.user || null, // depends on API
                isAuthenticated: true,
            };

            // ✅ Store in localStorage
            localStorage.setItem("auth", JSON.stringify(authData));

            // 🚀 Redirect
            navigate("/");

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
                    Login to your account
                </p>

                {/* ❌ Error Message */}
                {error() && (
                    <div class="mb-4 text-red-500 text-sm text-center">
                        {error()}
                    </div>
                )}

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
            </div>
        </div>
    );
}