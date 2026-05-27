/**
 * ImpersonationBanner
 *
 * Renders a fixed top banner when an admin is impersonating a client.
 * Drop this at the top level of your App / Layout component, e.g.:
 *
 *   <ImpersonationBanner />
 *   <Sidebar />
 *   <main>…</main>
 *
 * It reads from localStorage on every render and shows/hides itself
 * automatically. The "Exit" button restores the admin's original auth.
 */

import { createSignal, createEffect, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";

export default function ImpersonationBanner() {
    const navigate = useNavigate();
    const [info, setInfo] = createSignal(null);

    // Poll localStorage so the banner appears/disappears without a page reload.
    // (A reactive store would be cleaner — see note below.)
    const readAuth = () => {
        try {
            const auth = JSON.parse(localStorage.getItem("auth") ?? "{}");
            if (auth._impersonating) {
                setInfo(auth);
            } else {
                setInfo(null);
            }
        } catch {
            setInfo(null);
        }
    };

    // Read once on mount, then on every storage change from other tabs
    readAuth();
    window.addEventListener("storage", readAuth);

    const exitImpersonation = () => {
        const backup = sessionStorage.getItem("admin_auth_backup");
        if (backup) {
            localStorage.setItem("auth", backup);
            sessionStorage.removeItem("admin_auth_backup");
        } else {
            // Fallback: clear auth and send to login
            localStorage.removeItem("auth");
        }

        // Optionally: clear project/campaign caches here so they reload for admin
        // setProjectsCache({ data: [], insightsMap: {}, lastFetched: 0 });

        navigate("/admin/clients");
    };

    return (
        <Show when={info()}>
            <div class="fixed top-0 inset-x-0 z-[9999] flex items-center justify-between
                        gap-3 px-4 py-2
                        bg-amber-500 text-white text-sm font-medium shadow-lg">
                <div class="flex items-center gap-2">
                    {/* Eye icon */}
                    <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                         stroke="currentColor" stroke-width="2.2">
                        <path stroke-linecap="round" stroke-linejoin="round"
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round"
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>
                        Viewing as&nbsp;
                        <strong>{info()?.clientName ?? info()?.email}</strong>
                        &nbsp;—&nbsp;logged in as&nbsp;
                        <strong>{info()?._adminEmail}</strong>
                    </span>
                </div>

                <button
                    onClick={exitImpersonation}
                    class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md
                           bg-white/20 hover:bg-white/30 transition-colors text-xs font-semibold"
                >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
                         stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round"
                              d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Exit client view
                </button>
            </div>

            {/* Spacer so page content isn't hidden under the banner */}
            <div class="h-9" />
        </Show>
    );
}