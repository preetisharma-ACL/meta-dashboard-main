import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import { Phone, Mail, Users } from "lucide-solid";
import { createAvatar } from "@dicebear/core";
import { avataaars } from "@dicebear/collection";
import { getMyTeam } from "../services/clientType-service";

// ── Brand tokens ────────────────────────────────────────────────────────────
// Navy (blue-900 / #1e3a8a) and red (#AC2334) are the project's existing brand
// pair — the same two MyWork seeds its avatars from and the payments screens
// use for accents. Red is reserved for the Head of Operations here: it reads as
// "escalation path", so spending it anywhere else would dilute that.
const NAVY = "#1e3a8a";
const RED = "#AC2334";
// WhatsApp keeps its own green even inside the navy/red theme — the colour IS
// the affordance, and recolouring it to navy makes the pill unrecognisable.
const WA_GREEN = "#25D366";

// ── Value helpers ───────────────────────────────────────────────────────────

const clean = (v) => String(v ?? "").trim();
const digitsOf = (raw) => clean(raw).replace(/\D/g, "");

// Strip whatever country/trunk prefix a number arrived with so formatting and
// grouping always work off the bare 10-digit subscriber number.
const localDigits = (raw) => {
  const d = digitsOf(raw);
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d;
};

// "92173 28303" — 5-5 grouping, the way Indian mobiles are read aloud. A number
// that isn't 10 digits is returned ungrouped rather than mis-grouped.
const fmtLocal = (raw) => {
  const d = localDigits(raw);
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
};

// "+91 92173 28303" — the full display form for the featured card.
const fmtIntl = (raw) => {
  const d = localDigits(raw);
  if (!d) return "";
  return d.length === 10 ? `+91 ${fmtLocal(raw)}` : `+${digitsOf(raw)}`;
};

// wa.me wants digits only. A bare 10-digit number is an Indian mobile missing
// its country code; anything longer already carries one, so it is left alone.
// The test is on LENGTH, not a "starts with 91" check — plenty of valid
// 10-digit mobiles genuinely begin with 91 (e.g. 9123456789) and prefixing
// those would be wrong.
//
// Built off localDigits(), not the raw digits: a number stored with a trunk
// "0" (09217328303) would otherwise sail past the 10-digit test and produce a
// dead wa.me/0… link.
const waLink = (raw) => {
  const local = localDigits(raw);
  if (!local) return "";
  return `https://wa.me/${local.length === 10 ? `91${local}` : local}`;
};

// ── Avatar ──────────────────────────────────────────────────────────────────

// Generated LOCALLY by the DiceBear npm package — no runtime call to
// api.dicebear.com, so the page carries no external-request or CSP dependency
// in production. Seeded from the name (email as backup) so a person keeps the
// same face on every visit and in every group.
const avatarSvgFor = (contact) =>
  createAvatar(avataaars, {
    seed: clean(contact.name) || clean(contact.email) || "aajneeti-team",
  }).toString();

// photo_url wins when present, but a broken or expired URL must not leave a
// hole in the card — onerror falls through to the generated avatar, which is
// also what everyone without a photo gets. `tone` supplies the brand-tinted
// backing circle: navy for CM/coordination, red for the Head of Operations.
function Avatar(props) {
  const [broken, setBroken] = createSignal(false);
  const photo = () => clean(props.contact.photo_url);
  const showPhoto = () => !!photo() && !broken();

  // Generating the SVG is pure string work, but memoise it so a re-render for
  // any other reason doesn't redraw ~4.5 KB of paths.
  const svg = createMemo(() => avatarSvgFor(props.contact));

  return (
    <div
      class={`relative flex-shrink-0 rounded-full overflow-hidden ring-2 ${props.tone}`}
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
    >
      <Show
        when={showPhoto()}
        fallback={
          <div
            class="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
            aria-hidden="true"
            innerHTML={svg()}
          />
        }
      >
        <img
          src={photo()}
          alt={clean(props.contact.name)}
          onError={() => setBroken(true)}
          class="w-full h-full object-cover"
        />
      </Show>
    </div>
  );
}

// ── Contact pills ───────────────────────────────────────────────────────────
// Pills, not bare icons: the number itself is the point, so it's rendered as
// text. Any pill whose field is empty is never rendered — no dead links.

const PILL_BASE =
  "inline-flex items-center gap-2 rounded-full font-semibold transition-colors whitespace-nowrap";

const WA_TONE =
  "text-white border border-transparent shadow-sm hover:brightness-95";
const PHONE_TONE =
  "border border-blue-900/30 text-blue-900 hover:bg-blue-900/[0.06] dark:border-blue-400/40 dark:text-blue-300 dark:hover:bg-blue-400/10";
const MAIL_TONE =
  "border border-gray-300 text-gray-600 hover:border-blue-900/40 hover:text-blue-900 hover:bg-blue-900/[0.04] dark:border-gray-600 dark:text-gray-300 dark:hover:border-blue-400/40 dark:hover:text-blue-300 dark:hover:bg-blue-400/10";

const WhatsAppGlyph = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width={props.size}
    height={props.size}
    class="flex-shrink-0"
    aria-hidden="true"
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.896 9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.8 11.8 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.9 11.9 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.82 11.82 0 0 0 20.885 3.4" />
  </svg>
);

function Pill(props) {
  const external = () => props.href.startsWith("http");
  return (
    <a
      href={props.href}
      target={external() ? "_blank" : undefined}
      rel={external() ? "noopener noreferrer" : undefined}
      title={props.title}
      aria-label={props.title}
      class={`${PILL_BASE} ${props.pad} ${props.tone}`}
      style={props.style}
    >
      {props.children}
    </a>
  );
}

// ── Contact body (name / designation / pills / intro) ────────────────────────
// `compact` drives the coordination cards: shorter WhatsApp label (local
// grouping, no +91) and an icon-only email pill, so two cards sit side by side
// without the pills wrapping.

function ContactBody(props) {
  const c = () => props.contact || {};
  const wa = () => waLink(c().whatsapp);
  const waLabel = () =>
    props.compact ? fmtLocal(c().whatsapp) : fmtIntl(c().whatsapp);
  const phone = () => clean(c().phone);
  const email = () => clean(c().email);
  const designation = () => clean(c().designation);
  const intro = () => clean(c().intro);

  const pad = () => (props.compact ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm");
  const iconSize = () => (props.compact ? 13 : 15);

  return (
    <div class="min-w-0 flex-1">
      <p
        class={`font-bold text-gray-900 dark:text-gray-50 truncate ${
          props.compact ? "text-[15px]" : "text-lg"
        }`}
      >
        {clean(c().name) || "—"}
      </p>

      <Show when={designation()}>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400 truncate">
          {designation()}
        </p>
      </Show>

      <Show when={props.subline}>
        <p
          class="mt-1.5 text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ color: props.sublineColor }}
        >
          {props.subline}
        </p>
      </Show>

      <div class="mt-3.5 flex flex-wrap items-center gap-2">
        <Show when={wa()}>
          <Pill
            href={wa()}
            title={`WhatsApp ${fmtIntl(c().whatsapp)}`}
            pad={pad()}
            tone={WA_TONE}
            style={{ "background-color": WA_GREEN }}
          >
            <WhatsAppGlyph size={iconSize()} />
            <span class="tabular-nums tracking-wide">{waLabel()}</span>
          </Pill>
        </Show>

        <Show when={phone()}>
          <Pill
            href={`tel:${phone()}`}
            title={`Call ${fmtIntl(phone()) || phone()}`}
            pad={pad()}
            tone={PHONE_TONE}
          >
            <Phone size={iconSize()} class="flex-shrink-0" />
            <span>Call</span>
          </Pill>
        </Show>

        <Show when={email()}>
          <Pill
            href={`mailto:${email()}`}
            title={email()}
            pad={props.compact ? "w-8 h-8 justify-center" : pad()}
            tone={MAIL_TONE}
          >
            <Mail size={iconSize()} class="flex-shrink-0" />
            <Show when={!props.compact}>
              <span>Email</span>
            </Show>
          </Pill>
        </Show>
      </div>

      <Show when={intro()}>
        <p
          class={`mt-3.5 leading-relaxed text-gray-500 dark:text-gray-400 ${
            props.compact ? "text-xs" : "text-sm"
          }`}
        >
          {intro()}
        </p>
      </Show>
    </div>
  );
}

// ── Group heading ───────────────────────────────────────────────────────────

function GroupLabel(props) {
  return (
    <div class="flex items-center gap-3 mb-3.5">
      <span
        class="h-4 w-1 rounded-full"
        style={{ "background-color": props.accent }}
      />
      <h2 class="text-xs font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
        {props.children}
      </h2>
      <span class="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
    </div>
  );
}

// ── Card shells ─────────────────────────────────────────────────────────────

const CARD_BASE =
  "rounded-2xl bg-white/80 dark:bg-gray-800/70 backdrop-blur-xl shadow-sm transition hover:shadow-md";

// Featured — the dedicated CM. 2px navy border and the largest avatar make it
// unmistakably the primary contact.
function FeaturedCard(props) {
  return (
    <div
      class={`${CARD_BASE} border-2 p-6 border-blue-900/70 dark:border-blue-400/50`}
    >
      <div class="flex items-start gap-5">
        <Avatar
          contact={props.contact}
          size={56}
          tone="bg-blue-900/10 dark:bg-blue-400/15 ring-blue-900/20 dark:ring-blue-400/30"
        />
        <ContactBody
          contact={props.contact}
          subline="Your dedicated point of contact"
          sublineColor={NAVY}
        />
      </div>
    </div>
  );
}

// Coordination — thin navy strip along the top edge.
function CoordinationCard(props) {
  return (
    <div
      class={`${CARD_BASE} border border-gray-200/80 dark:border-gray-700 border-t-[3px] p-5 border-t-blue-900 dark:border-t-blue-400`}
    >
      <div class="flex items-start gap-4">
        <Avatar
          contact={props.contact}
          size={46}
          tone="bg-blue-900/10 dark:bg-blue-400/15 ring-blue-900/15 dark:ring-blue-400/25"
        />
        <ContactBody contact={props.contact} compact />
      </div>
    </div>
  );
}

// Head of Operations — red left strip and a red avatar ring. The colour shift
// is the whole point: this is the escalation route, not a routine contact.
function HeadOfOpsCard(props) {
  return (
    <div
      class={`${CARD_BASE} border border-gray-200/80 dark:border-gray-700 border-l-[4px] p-6`}
      style={{ "border-left-color": RED }}
    >
      <div class="flex items-start gap-5">
        <Avatar
          contact={props.contact}
          size={52}
          tone="bg-[#FBEEF0] dark:bg-red-900/25 ring-[#AC2334]/30 dark:ring-red-400/30"
        />
        <ContactBody
          contact={props.contact}
          subline="For escalations"
          sublineColor={RED}
        />
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function MyTeam() {
  const [team] = createResource(getMyTeam);

  const managers = () => team()?.campaign_managers ?? [];
  const coordination = () => team()?.coordination_team ?? [];
  const headOfOps = () => team()?.head_of_operations || null;

  const isEmpty = () =>
    !managers().length && !coordination().length && !headOfOps();

  return (
    <div class="p-4 sm:p-6 max-w-5xl mx-auto">
      <header class="mb-7">
        <div class="flex items-center gap-2.5">
          <span
            class="h-5 w-1.5 rounded-full"
            style={{ "background-color": NAVY }}
          />
          <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
            Meet Your Team
          </h1>
        </div>
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
          The people looking after your campaigns — reach them any time.
        </p>
      </header>

      <Show when={team.loading}>
        <div class="space-y-4">
          <For each={[0, 1, 2]}>
            {() => (
              <div class="rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 p-6 animate-pulse">
                <div class="flex items-start gap-5">
                  <div class="w-14 h-14 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                  <div class="flex-1 space-y-2.5 pt-1">
                    <div class="h-4 w-2/5 rounded bg-gray-200 dark:bg-gray-700" />
                    <div class="h-3 w-1/4 rounded bg-gray-200 dark:bg-gray-700" />
                    <div class="h-8 w-48 rounded-full bg-gray-200 dark:bg-gray-700 !mt-4" />
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
          <p class="mt-3 text-sm font-semibold text-gray-600 dark:text-gray-300">
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
              <Users
                size={28}
                class="mx-auto text-gray-300 dark:text-gray-600"
              />
              <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
                No team members assigned to your account yet.
              </p>
            </div>
          }
        >
          {/* Each group renders only when populated, so a null head_of_operations
              or an empty coordination list drops the whole section rather than
              leaving a heading over nothing. */}
          <Show when={managers().length}>
            <section class="mb-8">
              <GroupLabel accent={NAVY}>Your Campaign Manager</GroupLabel>
              <div class="space-y-4">
                <For each={managers()}>
                  {(c) => <FeaturedCard contact={c} />}
                </For>
              </div>
            </section>
          </Show>

          <Show when={coordination().length}>
            <section class="mb-8">
              <GroupLabel accent={NAVY}>Coordination Team</GroupLabel>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <For each={coordination()}>
                  {(c) => <CoordinationCard contact={c} />}
                </For>
              </div>
            </section>
          </Show>

          <Show when={headOfOps()}>
            <section class="mb-8">
              <GroupLabel accent={RED}>Head of Operations</GroupLabel>
              <HeadOfOpsCard contact={headOfOps()} />
            </section>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
