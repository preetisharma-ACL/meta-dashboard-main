import { createResource, createSignal, For, Show } from "solid-js";
import { Phone, Mail, Users } from "lucide-solid";
import { getMyTeam } from "../services/clientType-service";

// ── Brand tokens ────────────────────────────────────────────────────────────
// The reference design runs on brass over paper; this is the same layout in the
// project's own palette. Navy (#1e3a8a — the seed MyWork and the payments
// screens already use) carries the routine contacts, and crimson (#AC2334) →
// gold (#D89A2B) is the ramp already running through the scrollbars, the
// sidebar's active rail and the section headings.
//
// Crimson is reserved for the Head of Operations: it reads as "escalation
// path", so spending it anywhere else on this page would dilute that.
const NAVY = "#1e3a8a";
const NAVY_DEEP = "#14233A";
const RED = "#AC2334";
const GOLD = "#D89A2B";
// WhatsApp keeps its own green even inside the navy/crimson theme — the colour
// IS the affordance, and recolouring it to navy makes the glyph unrecognisable.
// It sits as a glyph on a navy button, exactly as the reference does it.
const WA_GREEN = "#5DD07E";

// ── Value helpers ───────────────────────────────────────────────────────────

const clean = (v) => String(v ?? "").trim();
const digitsOf = (raw) => clean(raw).replace(/\D/g, "");

// Names arrive from the API lower-cased ("shresth", "rishabh"), and the design
// sets them at 21px as the loudest thing on the card — so they are cased for
// display. Word-by-word, so "ram kumar" doesn't become "Ram kumar".
const titleCase = (v) =>
  clean(v).replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1));

// Strip whatever country/trunk prefix a number arrived with so formatting and
// grouping always work off the bare 10-digit subscriber number.
const localDigits = (raw) => {
  const d = digitsOf(raw);
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d;
};

// "92173 28322" — 5-5 grouping, the way Indian mobiles are read aloud. A number
// that isn't 10 digits is returned ungrouped rather than mis-grouped.
const fmtLocal = (raw) => {
  const d = localDigits(raw);
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
};

// "+91 92173 28303" — the full display form for the featured card's rail.
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

// The number worth putting on the "Direct line" rail: WhatsApp is the one people
// actually reach out on, with the desk phone as the fallback.
const directNumber = (c) => clean(c?.whatsapp) || clean(c?.phone);

// ── Avatar ──────────────────────────────────────────────────────────────────
// A real headshot when photo_url is set, otherwise a monogram on a brand
// gradient disc — the same fallback Slack, Notion and Linear use. A broken or
// expired photo URL falls through to the monogram rather than leaving a hole in
// the card.
//
// Nothing about the person is drawn from their name beyond the initial: the
// roster is different for every client and grows over time, so anything the page
// had to infer or keep a list of would be wrong for someone eventually. The
// monogram is the one fallback that never is.

// Deep navy for the routine contacts, crimson for the escalation tier. Both
// carry a gold letter — the third colour of the app's ramp — and both are two
// stops of ONE hue rather than a hue-to-hue blend, which is what keeps the disc
// reading as a solid object with light falling on it.
const AV_TONES = {
  navy: {
    fill: "linear-gradient(140deg, #24407F 0%, #1E3A8A 42%, #14233A 100%)",
    letter: "#E8C27E",
    ring: "rgba(20, 35, 58, 0.16)",
  },
  red: {
    fill: "linear-gradient(140deg, #C2394B 0%, #AC2334 46%, #7A1723 100%)",
    letter: "#F2D7A6",
    ring: "rgba(122, 23, 35, 0.18)",
  },
};

// "Shresth" → S. "Ram Kumar" → RK. Two letters at most: three is a filing code,
// not a monogram. Middle names are skipped — first and last are what people
// recognise themselves by.
const initialsOf = (contact) => {
  const parts = clean(contact?.name).split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
};

function Avatar(props) {
  const [broken, setBroken] = createSignal(false);
  const photo = () => clean(props.contact.photo_url);
  const tone = () => AV_TONES[props.tone || "navy"];
  const initials = () => initialsOf(props.contact);

  return (
    <div
      class="relative flex-shrink-0 rounded-full overflow-hidden grid place-items-center"
      style={{
        width: `${props.size}px`,
        height: `${props.size}px`,
        "background-image": tone().fill,
        // Ring, inner top highlight and drop shadow as one declaration — a
        // `ring` utility can't take a per-tier colour without a class for each.
        "box-shadow": `0 0 0 3px ${tone().ring}, inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 3px 10px -2px rgba(15, 23, 42, 0.28)`,
      }}
    >
      <Show
        when={photo() && !broken()}
        fallback={
          <span
            class="font-bold leading-none select-none"
            style={{
              color: tone().letter,
              // One letter can sit large; two need to come down or they touch
              // the rim on the 46px coordination disc.
              "font-size": `${Math.round(
                props.size * (initials().length > 1 ? 0.34 : 0.42)
              )}px`,
              "letter-spacing": initials().length > 1 ? "0.02em" : "0",
              "text-shadow": "0 1px 2px rgba(0, 0, 0, 0.22)",
            }}
            aria-hidden="true"
          >
            {initials()}
          </span>
        }
      >
        <img
          src={photo()}
          alt={titleCase(props.contact.name)}
          onError={() => setBroken(true)}
          class="w-full h-full object-cover"
        />
      </Show>
    </div>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────
// Full-height pills on the featured card, circular icon buttons on the
// coordination cards — same split the reference makes, so the primary contact
// gets labelled actions and the two secondary cards stay compact side by side.

const WhatsAppGlyph = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width={props.size}
    height={props.size}
    class="flex-shrink-0"
    style={props.style}
    aria-hidden="true"
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.896 9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.8 11.8 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.9 11.9 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.82 11.82 0 0 0 20.885 3.4" />
  </svg>
);

// Solid navy — the primary action on the card.
const BTN_SOLID =
  "inline-flex items-center gap-2 h-11 px-5 rounded-full text-white text-sm font-medium transition-colors hover:brightness-110";
// Outlined — the same height, so a row of them sits on one baseline.
const BTN_GHOST =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium transition-colors hover:border-gray-900 dark:hover:border-gray-400";
// Circular, icon only — the coordination cards' footer row.
const BTN_ICON =
  "w-9 h-9 grid place-items-center rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-100";

function LinkBtn(props) {
  const external = () => props.href.startsWith("http");
  return (
    <a
      href={props.href}
      target={external() ? "_blank" : undefined}
      rel={external() ? "noopener noreferrer" : undefined}
      title={props.title}
      aria-label={props.title}
      class={props.class}
      style={props.style}
    >
      {props.children}
    </a>
  );
}

// ── Copy-to-clipboard number ────────────────────────────────────────────────
// The number is rendered as text and IS the button — on desktop, where a tel:
// link does nothing useful, copying is the action people actually want.
//
// The confirmation is a tooltip above the number rather than a change to the
// number itself, so the row never reflows and the digits stay readable while it
// shows. navigator.clipboard is absent on insecure origins, so the whole thing
// is guarded: a failed copy simply leaves the number on screen to read.
function CopyNumber(props) {
  const [copied, setCopied] = createSignal(false);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* no clipboard permission — the number is still on screen to read */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${props.value}`}
      aria-label={`Copy ${props.value}`}
      class={`relative tabular-nums whitespace-nowrap transition-colors ${props.class}`}
    >
      {props.children}
      <Show when={copied()}>
        <span
          class="absolute left-1/2 -translate-x-1/2 -top-7 px-2 py-1 rounded-md text-[11px] font-medium text-white whitespace-nowrap pointer-events-none"
          style={{ "background-color": NAVY_DEEP }}
        >
          Copied
        </span>
      </Show>
    </button>
  );
}

// ── Ladder scaffolding ──────────────────────────────────────────────────────
// The page is an escalation ladder, so the tiers are numbered down a rail: node
// 1 is where you start, and you only move down if you have to. The rail is the
// app's crimson→gold ramp, fading out past the last rung.
//
// Rail and nodes are md-and-up only. Below that they'd eat the gutter on a
// phone, and the tier labels alone carry the same order.

const EYEBROW = "text-[10.5px] font-bold uppercase tracking-[0.16em]";

function TierNode(props) {
  return (
    <div
      class={`hidden md:grid absolute -left-14 top-0 w-8 h-8 place-items-center rounded-full text-[11px] font-bold ring-4 ring-gray-50 dark:ring-gray-900 ${
        props.filled
          ? "text-white"
          : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
      }`}
      style={props.filled ? { "background-color": NAVY_DEEP } : undefined}
      aria-hidden="true"
    >
      {props.n}
    </div>
  );
}

function TierLabel(props) {
  return (
    <p class={`${EYEBROW} text-gray-400 dark:text-gray-500 mb-3.5`}>
      {props.children}
    </p>
  );
}

// ── Tier 1 — first point of contact ─────────────────────────────────────────
// The dedicated CM. Navy border, the largest monogram, labelled actions, and a
// "Direct line" rail down the right edge: everything about it says start here.

function FeaturedCard(props) {
  const c = () => props.contact;
  const wa = () => waLink(c().whatsapp);
  const phone = () => clean(c().phone);
  const email = () => clean(c().email);
  const number = () => directNumber(c());

  return (
    // The featured card is the only one that carries a navy wash and a lifted
    // shadow — on a page of five cards, "primary" has to be visible before any
    // of the labels are read.
    <article
      class="relative overflow-hidden rounded-2xl border border-blue-900/25 dark:border-blue-400/25 bg-white/90 dark:bg-gray-800/80 backdrop-blur-xl p-6 sm:p-7 transition-shadow hover:shadow-[0_14px_40px_-18px_rgba(20,35,58,0.45)]"
      style={{
        "box-shadow": "0 10px 34px -20px rgba(20, 35, 58, 0.40)",
        "background-image":
          "radial-gradient(120% 90% at 0% 0%, rgba(30, 58, 138, 0.055) 0%, rgba(30, 58, 138, 0) 58%)",
      }}
    >
      {/* Crimson→gold hairline across the top edge — the app's ramp, used here
          as the marker for the top rung of the ladder. */}
      <span
        aria-hidden="true"
        class="absolute inset-x-0 top-0 h-[3px]"
        style={{
          "background-image": `linear-gradient(90deg, ${RED} 0%, ${GOLD} 100%)`,
        }}
      />

      <div class="flex flex-col sm:flex-row sm:items-start gap-5">
        <Avatar contact={c()} size={68} />

        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-1">
            <h2 class="text-[21px] font-bold tracking-[-0.01em] text-gray-900 dark:text-gray-50">
              {titleCase(c().name) || "—"}
            </h2>
            <span
              class="text-[10px] font-bold uppercase tracking-[0.14em] px-2 py-1 rounded"
              style={{ color: NAVY, "background-color": `${NAVY}14` }}
            >
              Dedicated
            </span>
          </div>

          <Show when={clean(c().designation)}>
            <p class="text-[14.5px] text-gray-500 dark:text-gray-400 mb-4">
              {clean(c().designation)}
            </p>
          </Show>

          <div class="flex flex-wrap items-center gap-2.5">
            <Show when={wa()}>
              <LinkBtn
                href={wa()}
                title={`WhatsApp ${fmtIntl(c().whatsapp)}`}
                class={BTN_SOLID}
                style={{ "background-color": NAVY_DEEP }}
              >
                <WhatsAppGlyph size={17} style={{ color: WA_GREEN }} />
                WhatsApp
              </LinkBtn>
            </Show>

            <Show when={phone()}>
              <LinkBtn
                href={`tel:${phone()}`}
                title={`Call ${fmtIntl(phone()) || phone()}`}
                class={BTN_GHOST}
              >
                <Phone size={16} />
                Call
              </LinkBtn>
            </Show>

            <Show when={email()}>
              <LinkBtn href={`mailto:${email()}`} title={email()} class={BTN_GHOST}>
                <Mail size={16} />
                Email
              </LinkBtn>
            </Show>
          </div>
        </div>

        {/* The number as text, not just as a link target — on desktop this is
            what gets copied into a phone. Hidden below sm, where the WhatsApp
            button is a tap away and the column would stack into dead space. */}
        <Show when={number()}>
          <div class="hidden sm:block sm:w-[188px] sm:text-right sm:border-l sm:pl-6 border-gray-200 dark:border-gray-700 flex-shrink-0 pt-1">
            <p class={`${EYEBROW} text-gray-400 dark:text-gray-500 mb-2`}>
              Direct line
            </p>
            <CopyNumber
              value={fmtIntl(number())}
              class="inline-flex items-center gap-2 text-[15px] font-bold text-gray-900 dark:text-gray-50 hover:text-blue-900 dark:hover:text-blue-300"
            >
              <span
                class="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"
                style={{ "background-color": `${NAVY}16`, color: NAVY }}
              >
                <Phone size={13} />
              </span>
              {fmtIntl(number())}
            </CopyNumber>
            <p class="text-[12px] text-gray-400 dark:text-gray-500 mt-3 leading-relaxed">
              Mon–Sat
              <br />
              10am–7pm
            </p>
          </div>
        </Show>
      </div>
    </article>
  );
}

// ── Tier 2 — day-to-day coordination ────────────────────────────────────────
// Compact cards, two across. Navy strip along the top edge, and a footer row
// carrying the number on the left with icon-only actions on the right, so the
// pair never wraps.

function CoordinationCard(props) {
  const c = () => props.contact;
  const wa = () => waLink(c().whatsapp);
  const email = () => clean(c().email);
  const number = () => directNumber(c());

  return (
    // h-full + flex-col with an mt-auto footer: the two cards in the row keep a
    // common height and a common footer baseline even when one blurb runs a
    // line longer than the other.
    <article class="h-full flex flex-col rounded-2xl border border-gray-200/80 dark:border-gray-700 border-t-[3px] border-t-blue-900 dark:border-t-blue-400 bg-white/85 dark:bg-gray-800/70 backdrop-blur-xl shadow-sm p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-blue-900/40 dark:hover:border-blue-400/40">
      <div class="flex items-center gap-3.5 mb-4">
        <Avatar contact={c()} size={48} />
        <div class="min-w-0">
          <h3 class="text-[16px] font-bold leading-snug text-gray-900 dark:text-gray-50 truncate">
            {titleCase(c().name) || "—"}
          </h3>
          <Show when={clean(c().designation)}>
            <p class="text-[13px] text-gray-500 dark:text-gray-400 truncate">
              {clean(c().designation)}
            </p>
          </Show>
        </div>
      </div>

      <div class="mt-auto flex items-center justify-between gap-2 pt-3.5 border-t border-gray-200 dark:border-gray-700">
        <Show when={number()} fallback={<span />}>
          <CopyNumber
            value={fmtIntl(number())}
            class="inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-white/5 text-[13px] font-bold text-gray-800 dark:text-gray-100 hover:border-blue-900/35 dark:hover:border-blue-400/35 hover:text-blue-900 dark:hover:text-blue-300"
          >
            <span
              class="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"
              style={{ "background-color": `${NAVY}16`, color: NAVY }}
            >
              <Phone size={13} />
            </span>
            {fmtLocal(number())}
          </CopyNumber>
        </Show>

        <div class="flex gap-1.5 flex-shrink-0">
          <Show when={wa()}>
            <LinkBtn
              href={wa()}
              title={`WhatsApp ${titleCase(c().name)}`}
              class={BTN_ICON}
            >
              <WhatsAppGlyph size={15} style={{ color: "#25A455" }} />
            </LinkBtn>
          </Show>
          <Show when={email()}>
            <LinkBtn
              href={`mailto:${email()}`}
              title={`Email ${titleCase(c().name)}`}
              class={BTN_ICON}
            >
              <Mail size={15} />
            </LinkBtn>
          </Show>
        </div>
      </div>
    </article>
  );
}

// ── Tier 3 — escalation ─────────────────────────────────────────────────────
// Head of Operations. A recessed, faintly warmed surface instead of a white
// card, with the actions stacked down the right edge — the reference's way of
// making the last rung read as a different KIND of contact rather than a third
// person to call. Crimson does the rest: the disc, the chip, the top hairline.

function HeadOfOpsCard(props) {
  const c = () => props.contact;
  const wa = () => waLink(c().whatsapp);
  const email = () => clean(c().email);

  return (
    <article
      class="rounded-2xl border border-gray-200/80 dark:border-gray-700 border-t-[3px] bg-[#FBF6F3] dark:bg-white/[0.035] p-5 sm:p-6"
      style={{ "border-top-color": RED }}
    >
      {/* items-start, not items-center: with three lines of copy in the middle
          column a centred disc floats below the name it belongs to. */}
      <div class="flex flex-col sm:flex-row sm:items-start gap-5">
        <Avatar contact={c()} size={56} tone="red" />

        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
            <h3 class="text-[17px] font-bold text-gray-900 dark:text-gray-50">
              {titleCase(c().name) || "—"}
            </h3>
            <span
              class="text-[10px] font-bold uppercase tracking-[0.14em] px-2 py-1 rounded"
              style={{ color: RED, "background-color": `${RED}14` }}
            >
              Escalation
            </span>
          </div>

          <Show when={clean(c().designation)}>
            <p class="text-[13.5px] text-gray-500 dark:text-gray-400">
              {clean(c().designation)}
            </p>
          </Show>
        </div>

        <div class="flex sm:flex-col gap-2 flex-shrink-0">
          <Show when={wa()}>
            <LinkBtn
              href={wa()}
              title={`WhatsApp ${fmtIntl(c().whatsapp)}`}
              class="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-[13.5px] font-medium transition-colors hover:border-gray-900 dark:hover:border-gray-400"
            >
              <WhatsAppGlyph size={15} style={{ color: "#25A455" }} />
              WhatsApp
            </LinkBtn>
          </Show>
          <Show when={email()}>
            <LinkBtn
              href={`mailto:${email()}`}
              title={email()}
              class="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-[13.5px] font-medium transition-colors hover:border-gray-900 dark:hover:border-gray-400"
            >
              <Mail size={15} />
              Email
            </LinkBtn>
          </Show>
        </div>
      </div>
    </article>
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

  const headcount = () =>
    managers().length + coordination().length + (headOfOps() ? 1 : 0);

  // The rail only makes sense while there is more than one rung on it — with a
  // single tier populated the numbering would be counting to one.
  const tiers = () =>
    [managers().length, coordination().length, headOfOps() ? 1 : 0].filter(
      Boolean
    ).length;

  return (
    <div class="p-4 sm:p-6 max-w-[900px] mx-auto">
      {/* ── Page header ── */}
      <header class="mb-11 flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <p class={`${EYEBROW} mb-3`} style={{ color: RED }}>
            AAJneeti Connect · Account team
          </p>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-gray-900 dark:text-gray-50">
            Meet your team
          </h1>
          <p class="mt-3 text-[15px] leading-relaxed text-gray-500 dark:text-gray-400 max-w-[52ch]">
            These are the people running your campaigns day to day. Reach any of
            them directly — no ticket queue, no switchboard. Start at the top and
            move down only if you need to.
          </p>
        </div>

        {/* Headcount, from the loaded roster — it answers "how many people am I
            about to scroll past" before the scroll starts. Hidden until the
            resource resolves rather than counting to zero. */}
        <Show when={!team.loading && !team.error && headcount() > 0}>
          <span class="hidden sm:inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 px-3.5 py-2 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 shadow-sm">
            <Users size={14} style={{ color: NAVY }} />
            {headcount()} {headcount() === 1 ? "person" : "people"} on your
            account
          </span>
        </Show>
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
          {/* ── Escalation ladder ──
              Each tier renders only when populated, so a null head_of_operations
              or an empty coordination list drops the whole rung rather than
              leaving a numbered label over nothing. */}
          <div class={`relative ${tiers() > 1 ? "md:pl-14" : ""}`}>
            {/* The rail — crimson at the top rung, fading through gold to
                nothing past the last one. Decorative, so it is drawn on a bare
                span rather than as a border on the content. */}
            <Show when={tiers() > 1}>
              <span
                aria-hidden="true"
                class="hidden md:block absolute left-[15px] top-[34px] bottom-3 w-px"
                style={{
                  "background-image": `linear-gradient(180deg, ${RED} 0%, ${GOLD} 55%, rgba(216,154,43,0) 100%)`,
                  opacity: "0.55",
                }}
              />
            </Show>

            <Show when={managers().length}>
              <section class="relative mb-9">
                <TierNode n="1" filled />
                <TierLabel>First point of contact</TierLabel>
                <div class="space-y-4">
                  <For each={managers()}>
                    {(c) => <FeaturedCard contact={c} />}
                  </For>
                </div>
              </section>
            </Show>

            <Show when={coordination().length}>
              <section class="relative mb-9">
                <TierNode n="2" />
                <TierLabel>Day-to-day coordination</TierLabel>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <For each={coordination()}>
                    {(c) => <CoordinationCard contact={c} />}
                  </For>
                </div>
              </section>
            </Show>

            <Show when={headOfOps()}>
              <section class="relative">
                <TierNode n="3" />
                <TierLabel>If something isn't moving</TierLabel>
                <HeadOfOpsCard contact={headOfOps()} />
              </section>
            </Show>
          </div>

          {/* ── Footer note ── */}
          <div class="mt-12 pt-6 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-4">
            <p class="text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400 max-w-[46ch]">
              Office hours are 10am–7pm, Monday to Saturday. WhatsApp is the
              fastest route outside those hours.
            </p>
            <p class={`${EYEBROW} text-gray-400 dark:text-gray-500`}>
              AAJneeti Connect
            </p>
          </div>
        </Show>
      </Show>
    </div>
  );
}
