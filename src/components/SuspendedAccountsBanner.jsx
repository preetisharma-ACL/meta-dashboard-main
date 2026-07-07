import { createSignal, createEffect, onMount, onCleanup, For, Show, on } from "solid-js";
import Swal from "sweetalert2";
import {
  fetchSuspendedAccountAlerts,
  acknowledgeAlert,
} from "../services/alert-service";
import { asTeamMemberId } from "../stores/cmScope";

// Poll cadence — a newly-suspended account surfaces without a manual reload.
const POLL_MS = 60_000;

// Pull the account name out of the alert message, e.g.
//   "Ad account 'Aman' is suspended on Meta (status 2). ..." → "Aman"
// Falls back to null so the caller shows the raw message instead.
function accountNameFrom(message) {
  if (!message) return null;
  const m = message.match(/ad account\s+['"]([^'"]+)['"]/i) || message.match(/['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

// Prominent, dismissable banner for suspended Meta ad accounts. Reads the
// existing alerts endpoint (category=account_suspended, unacknowledged only) and
// renders nothing when the list is empty — the default prod state. Dismissing an
// entry calls the shared acknowledge endpoint and drops it; when all are gone the
// banner disappears. Server-side role scoping means clients never see anything.
export default function SuspendedAccountsBanner() {
  const [items, setItems] = createSignal([]);

  const load = async () => {
    try {
      const res = await fetchSuspendedAccountAlerts();
      if (!res) return; // redirected to login
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      // Non-fatal — a failed poll just leaves the current banner state as-is.
      console.error("[SuspendedAccountsBanner] load failed:", err);
    }
  };

  // Fetch on mount + whenever the switch scope changes (a switched CM sees the
  // accounts relevant to them), and poll on the shared alerts cadence.
  createEffect(on(asTeamMemberId, () => load()));
  onMount(() => {
    const timer = setInterval(load, POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const dismiss = async (alert) => {
    const id = alert.id;
    // Optimistic: remove immediately; restore on genuine failure.
    const prev = items();
    setItems((list) => list.filter((a) => a.id !== id));
    try {
      await acknowledgeAlert(id);
    } catch (err) {
      if (err?.status === 404) {
        // Out of scope / already gone — keep it removed, just inform.
        Swal.fire({
          icon: "info",
          title: "Alert no longer available",
          toast: true,
          position: "top-end",
          timer: 3000,
          showConfirmButton: false,
        });
        return;
      }
      console.error("[SuspendedAccountsBanner] acknowledge failed:", err);
      setItems(prev);
      Swal.fire({
        icon: "error",
        title: "Couldn't dismiss",
        text: "Please try again.",
        toast: true,
        position: "top-end",
        timer: 3000,
        showConfirmButton: false,
      });
    }
  };

  return (
    <Show when={items().length > 0}>
      <div class="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800/60">
        <div class="px-4 py-3 space-y-2.5">
          {/* Headline */}
          <div class="flex items-center gap-2 text-red-800 dark:text-red-300">
            <svg
              class="w-5 h-5 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span class="font-semibold text-sm">
              {items().length} ad account{items().length > 1 ? "s" : ""} suspended on Meta
            </span>
          </div>

          {/* One row per suspended account */}
          <div class="space-y-1.5">
            <For each={items()}>
              {(a) => {
                const name = accountNameFrom(a.message);
                return (
                  <div class="flex items-start justify-between gap-3 rounded-lg bg-white/60 dark:bg-red-950/30 border border-red-100 dark:border-red-800/40 px-3 py-2">
                    <p class="text-sm text-red-700 dark:text-red-200 leading-relaxed min-w-0">
                      <Show when={name} fallback={a.message}>
                        <span class="font-semibold">{name}</span>
                        {" — suspended, review & pause its campaigns. Campaigns may still show active."}
                      </Show>
                    </p>
                    <button
                      onClick={() => dismiss(a)}
                      title="Dismiss"
                      class="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg
                             bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      <svg
                        class="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      Dismiss
                    </button>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}
