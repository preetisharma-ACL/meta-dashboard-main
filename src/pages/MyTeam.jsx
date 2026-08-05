import { createResource, createSignal, For, Show } from "solid-js";
import { MessageCircle, Phone, Mail, Users } from "lucide-solid";
import { getMyTeam } from "../services/clientType-service";

// ── Avatar helpers ──────────────────────────────────────────────────────────

// "Shresth Kumar" → "SK"; single word "shresth" → "SH". Anything unusable
// (empty/punctuation-only name) falls back to "?" rather than an empty circle.
const initialsOf = (name) => {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

// Deterministic colour per person: same name always lands on the same swatch,
// so a contact looks identical on every visit and across the three groups.
// Brand-compatible, all dark enough for white text.
const AVATAR_COLORS = [
  "#2563EB", // blue
  "#7C3AED", // violet
  "#0D9488", // teal
  "#D97706", // amber
  "#DB2777", // pink
  "#4F46E5", // indigo
  "#059669", // emerald
  "#DC2626", // red
];

const colorFor = (name) => {
  const s = String(name || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0; // keep it a 32-bit int
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

// ── Contact-link helpers ────────────────────────────────────────────────────

// wa.me wants digits only. A bare 10-digit number is an Indian mobile missing
// its country code; anything longer already carries one, so it is left alone.
// The test is on LENGTH, not a "starts with 91" check — plenty of valid
// 10-digit mobiles genuinely begin with 91 (e.g. 9123456789) and prefixing
// those would be wrong.
const waLink = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
};

const clean = (v) => String(v ?? "").trim();

// ── Avatar ──────────────────────────────────────────────────────────────────
// photo_url wins when present, but a broken/expired image URL must not leave a
// hole in the card — onerror flips this to the generated initials, which is the
// same thing everyone without a photo gets. The initials avatar is the intended
// default look, not a placeholder.
function Avatar(props) {
  const [broken, setBroken] = createSignal(false);
  const photo = () => clean(props.contact.photo_url);
  const showPhoto = () => !!photo() && !broken();

  return (
    <Show
      when={showPhoto()}
      fallback={
        <div
          class="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center text-white font-semibold text-lg tracking-wide select-none shadow-sm"
          style={{ "background-color": colorFor(props.contact.name) }}
          aria-hidden="true"
        >
          {initialsOf(props.contact.name)}
        </div>
      }
    >
      <img
        src={photo()}
        alt={clean(props.contact.name)}
        onError={() => setBroken(true)}
        class="flex-shrink-0 w-14 h-14 rounded-full object-cover bg-gray-100 dark:bg-gray-700 shadow-sm"
      />
    </Show>
  );
}

// ── Contact action (WhatsApp / phone / email) ───────────────────────────────

function ActionLink(props) {
  return (
    <a
      href={props.href}
      target={props.href.startsWith("http") ? "_blank" : undefined}
      rel={props.href.startsWith("http") ? "noopener noreferrer" : undefined}
      title={props.title}
      aria-label={props.title}
      class={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${props.tone}`}
    >
      {props.children}
    </a>
  );
}

// ── Contact card ────────────────────────────────────────────────────────────

function ContactCard(props) {
  const c = () => props.contact || {};
  const wa = () => waLink(c().whatsapp);
  const phone = () => clean(c().phone);
  const email = () => clean(c().email);
  const designation = () => clean(c().designation);
  const intro = () => clean(c().intro);

  // Every empty field is simply omitted — no blank rows, no dead links.
  const hasActions = () => !!(wa() || phone() || email());

  return (
    <div class="rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl shadow-sm p-5 transition hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600">
      <div class="flex items-start gap-4">
        <Avatar contact={c()} />

        <div class="min-w-0 flex-1">
          <p class="font-semibold text-gray-900 dark:text-gray-100 truncate">
            {clean(c().name) || "—"}
          </p>

          <Show when={designation()}>
            <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400 truncate">
              {designation()}
            </p>
          </Show>

          <Show when={hasActions()}>
            <div class="mt-3 flex items-center gap-2">
              <Show when={wa()}>
                <ActionLink
                  href={wa()}
                  title="Chat on WhatsApp"
                  tone="border-emerald-200 dark:border-emerald-900/60 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                >
                  <MessageCircle size={16} />
                </ActionLink>
              </Show>

              <Show when={phone()}>
                <ActionLink
                  href={`tel:${phone()}`}
                  title={`Call ${phone()}`}
                  tone="border-blue-200 dark:border-blue-900/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                >
                  <Phone size={16} />
                </ActionLink>
              </Show>

              <Show when={email()}>
                <ActionLink
                  href={`mailto:${email()}`}
                  title={email()}
                  tone="border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/40 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  <Mail size={16} />
                </ActionLink>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <Show when={intro()}>
        <p class="mt-4 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {intro()}
        </p>
      </Show>
    </div>
  );
}

// ── Labelled group ──────────────────────────────────────────────────────────
// Rendered only when it has at least one contact, so a null head_of_operations
// (or an empty coordination list) drops the whole section rather than leaving a
// heading over nothing.

function TeamGroup(props) {
  return (
    <Show when={props.contacts.length}>
      <section class="mb-8">
        <h2 class="text-xs font-bold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500 mb-3">
          {props.title}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <For each={props.contacts}>{(c) => <ContactCard contact={c} />}</For>
        </div>
      </section>
    </Show>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function MyTeam() {
  const [team] = createResource(getMyTeam);

  const managers = () => team()?.campaign_managers ?? [];
  const coordination = () => team()?.coordination_team ?? [];
  // head_of_operations is a single object; the group renderer takes a list.
  const headOfOps = () => (team()?.head_of_operations ? [team().head_of_operations] : []);

  const isEmpty = () =>
    !managers().length && !coordination().length && !headOfOps().length;

  return (
    <div class="p-4 sm:p-6 max-w-6xl mx-auto">
      <header class="mb-6">
        <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Meet Your Team
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          The people looking after your campaigns — reach them any time.
        </p>
      </header>

      <Show when={team.loading}>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <For each={[0, 1, 2]}>
            {() => (
              <div class="rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 p-5 animate-pulse">
                <div class="flex items-start gap-4">
                  <div class="w-14 h-14 rounded-full bg-gray-200 dark:bg-gray-700" />
                  <div class="flex-1 space-y-2 pt-1">
                    <div class="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
                    <div class="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* A failed endpoint is a soft state, never a crash — the rest of the
          client dashboard is unaffected and the page still renders. */}
      <Show when={team.error}>
        <div class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/50 dark:bg-gray-800/40 p-10 text-center">
          <Users size={28} class="mx-auto text-gray-300 dark:text-gray-600" />
          <p class="mt-3 text-sm font-medium text-gray-600 dark:text-gray-300">
            Team details unavailable right now
          </p>
          <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Please try again in a little while.
          </p>
        </div>
      </Show>

      <Show when={!team.loading && !team.error}>
        <Show
          when={!isEmpty()}
          fallback={
            <div class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/50 dark:bg-gray-800/40 p-10 text-center">
              <Users size={28} class="mx-auto text-gray-300 dark:text-gray-600" />
              <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
                No team members assigned to your account yet.
              </p>
            </div>
          }
        >
          <TeamGroup title="Your Campaign Manager" contacts={managers()} />
          <TeamGroup title="Coordination Team" contacts={coordination()} />
          <TeamGroup title="Head of Operations" contacts={headOfOps()} />
        </Show>
      </Show>
    </div>
  );
}
