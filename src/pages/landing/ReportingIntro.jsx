/* ─── Reporting intro — public landing page for reports.aajneeti.social ───────
 * SolidJS port of the standalone /src/reporting-intro HTML page. Layout,
 * spacing and typography are Tailwind utilities; the bespoke visuals (pastel
 * blobs, the 3D page-turn showcase, the wired integrations diagram, the grey
 * mock atoms, the watermark) stay in the scoped `.ri` stylesheet — same split
 * the worklog screens already use.
 *
 * Every "Sign in" affordance is a client-side <A href="/login">, so the CTA
 * lands on the app's own login form instead of a full page load.
 * ──────────────────────────────────────────────────────────────────────────── */

import { For, onMount, onCleanup, createSignal } from "solid-js";
import { A } from "@solidjs/router";
import { isAuthenticated } from "../../utils/auth";
import { initLandingMotion, prefersReducedMotion } from "./landingMotion";

/* "/" stays public even for signed-in users, so the CTAs re-point at the app
   rather than showing "Sign in" to someone who already is. Read once at mount:
   the auth blob can't change while this page is on screen. */
const signedIn = () => isAuthenticated();
const ctaHref = () => (signedIn() ? "/dashboard" : "/login");

/* Screenshots live in /public/images/ and are served from the site root.
   The width/height on each <img> below are the files' real pixel dimensions —
   they reserve the right box before the image lands, so nothing shifts. */
const SHOTS = "/images";

/* Hero showcase — DOM order IS the display order. --i sets the stacking order
   (0 = on top = shown first); landingMotion derives the whole turn sequence
   from DOM order, so adding a view here is the only edit needed. `dark: true`
   matches the card gutters to a dark screenshot's own background. */
const HERO_VIEWS = [
  {
    src: `${SHOTS}/reporting-dashboard1.png`,
    alt: "Reporting dashboard showing active projects, total spend and campaign metrics in light mode",
    w: 1907,
    h: 908,
    priority: true,
  },
  {
    src: `${SHOTS}/reporting-dashboard2.png`,
    alt: "Reporting dashboard, active projects and spend, in dark mode",
    w: 1917,
    h: 906,
    dark: true,
  },
  {
    src: `${SHOTS}/reporting-dashboard3.png`,
    alt: "Paused campaign alerts with cost per lead by project and lead sources",
    w: 1617,
    h: 910,
  },
  {
    src: `${SHOTS}/reporting-dashboard4.png`,
    alt: "Campaign performance chart comparing leads against spend",
    w: 1628,
    h: 620,
  },
];

/* SWAP: card titles, screenshots and the one-to-two line copy around each. */
const FEATURE_CARDS = [
  {
    icon: "ri-ico-portal",
    title: "Client portal",
    lead: "Clients Login in to their own projects only — nothing else is visible.",
    src: `${SHOTS}/app-client-portal.png`,
    alt: "Client dashboard listing their live projects with spend against allocation, leads and average CPL",
    w: 1582,
    h: 848,
    cap: "Spend against allocation, leads, CPL and where the month will land.",
  },
  {
    icon: "ri-ico-task",
    title: "Billing you can defend",
    lead: "Opening balance, funds added, service charge and GST — itemised.",
    src: `${SHOTS}/app-billing.png`,
    alt: "Client billing page showing remaining balance, budget utilised and a full monthly account statement",
    w: 1582,
    h: 848,
    cap: "A statement that answers the invoice question before it's asked.",
  },
  {
    icon: "ri-ico-usage",
    title: "Daily reports",
    lead: "Leads, CPL and spend grouped by date and project, ready to download.",
    src: `${SHOTS}/reporting-dashboard8.png`,
    alt: "Daily reports table showing leads, cost per lead and amount spent for each project",
    w: 1657,
    h: 642,
    cap: "Service charge and GST worked out per project, before you ask.",
  },
];

/* SWAP: the three onboarding steps. */
const STEPS = [
  {
    av: "ri-av-2",
    lead: "Connect the ad account.",
    body: "Your Meta ad accounts and lead forms link to the projects they belong to. Nothing to install, nothing to tag.",
    step: "Step one",
    label: "Ad accounts & lead forms",
  },
  {
    av: "ri-av-3",
    lead: "Set the monthly budget.",
    body: "Each project gets an allocation, so spend can be read against a plan instead of a running total.",
    step: "Step two",
    label: "Allocation per project",
  },
  {
    av: "ri-av-4",
    lead: "Login  and read it.",
    body: "Spend, leads, CPL and pacing update through the month — with a billing statement that already adds up.",
    step: "Step three",
    label: "Live, on your own login",
  },
];

const NAV_LINKS = [
  { href: "#integrations", label: "Product" },
  { href: "#features", label: "What you get" },
  { href: "#bento", label: "Reporting" },
  { href: "#testimonials", label: "How it works" },
];

/* ── Small layout primitives, so the Tailwind classes aren't repeated ─────── */
const Container = (props) => (
  <div
    class={`ri-container mx-auto w-full max-w-[1200px] px-[18px] min-[721px]:px-6 ${props.class || ""}`}
  >
    {props.children}
  </div>
);

const Blobs = (props) => (
  <div
    class={`ri-blobs ${props.soft ? "ri-blobs-soft" : ""}`}
    aria-hidden="true"
  >
    <For each={props.items}>
      {(b) => (
        <span
          class={`ri-blob ri-blob-${b.tone}`}
          style={{ "--x": b.x, "--y": b.y, "--s": b.s }}
        />
      )}
    </For>
  </div>
);

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function ReportingIntro() {
  let rootEl;
  // Decided during render, not in onMount, so the pre-animation states are on
  // the very first paint and nothing flashes visible then jumps to hidden.
  const [noMotion, setNoMotion] = createSignal(prefersReducedMotion());

  onMount(() => {
    const dispose = initLandingMotion(rootEl, {
      onNoMotion: () => setNoMotion(true),
    });
    onCleanup(dispose);
  });

  return (
    <div
      ref={rootEl}
      class="ri is-js min-h-screen"
      classList={{ "ri-no-motion": noMotion() }}
    >
      {/* ══ NAVBAR — floating pill, shrinks + blurs on scroll ══════════════ */}
      <header
        data-nav-wrap
        class="ri-nav-wrap fixed inset-x-0 top-0 z-[100] px-[18px] py-[18px] min-[721px]:px-6"
      >
        <nav
          class="ri-nav relative mx-auto flex max-w-[1080px] items-center gap-5 rounded-full py-2.5 pl-4 pr-2.5 min-[901px]:pl-[18px]"
          aria-label="Primary"
        >
          {/* The lockup already carries the wordmark, so there's no separate
              text label — its alt text is what names this link. The page is
              always light, so it's the light-background logo the sidebar uses. */}
          <a class="inline-flex items-center" href="#top">
            <img
              src="/logo.webp"
              alt="Aajneeti"
              width="150"
              height="140"
              class="h-12 w-auto object-contain"
            />
          </a>

          <ul data-nav-links class="ri-nav-links">
            <For each={NAV_LINKS}>
              {(l) => (
                <li>
                  <a href={l.href}>{l.label}</a>
                </li>
              )}
            </For>
          </ul>

          <A
            href={ctaHref()}
            class="ri-btn ri-btn-dark ri-btn-sm max-[900px]:!hidden"
          >
            {signedIn() ? "Dashboard" : "Login "}
          </A>

          <button
            data-burger
            type="button"
            class="ri-burger ml-auto hidden h-10 w-10 rounded-full px-2.5 py-[11px] max-[900px]:block"
            aria-label="Open menu"
            aria-expanded="false"
          >
            <span />
            <span />
            <span />
          </button>
        </nav>
      </header>

      <main id="top">
        {/* ══ HERO ═══════════════════════════════════════════════════════════ */}
        <section class="ri-section ri-hero" id="hero">
          <Blobs
            items={[
              { tone: "lilac", x: "8%", y: "-10%", s: "1.15" },
              { tone: "peach", x: "78%", y: "-6%", s: "1" },
              { tone: "pink", x: "44%", y: "22%", s: "1.3" },
            ]}
          />

          <Container class="grid justify-items-center gap-[22px]">
            <p class="ri-eyebrow" data-reveal>
              Reporting dashboard for performance marketing
            </p>

            <h1
              class="ri-display max-w-[1100px] !text-[clamp(34px,4.6vw,54px)]"
              data-reveal
            >
              Campaigns that convert.
              <br class="ri-br" />
              Insights that matter.
            </h1>

            <p class="ri-lede !max-w-[640px]" data-reveal>
              One dashboard to track every project, manage Meta campaigns and
              show clients exactly where their budget went — leads, CPL and
              spend, live.
            </p>

            <div
              class="mt-1.5 flex flex-wrap justify-center gap-3 max-[420px]:w-full"
              data-reveal
            >
              <A href={ctaHref()} class="ri-btn ri-btn-dark">
                {signedIn() ? "Go to dashboard" : "Login"}
              </A>
              <a class="ri-btn ri-btn-ghost" href="#features">
                See how it works
              </a>
            </div>

            {/* ── HERO SHOWCASE ─────────────────────────────────────────────
                Four screenshots stacked in one box. Each view is hinged on its
                left edge and turns like a page to reveal the next, landing in
                exactly the same place. Click / Enter steps forward; after the
                last view it resets to the first. Timing lives in
                landingMotion.js § 4. */}
            <div
              class="ri-book relative mx-auto mt-9 w-full max-w-[1080px] min-[721px]:mt-[54px]"
              data-showcase
              data-intro
              data-parallax
              role="button"
              tabindex="0"
              aria-label="Reporting dashboard — press to step through the views"
            >
              {/* Blurred soft shapes sitting behind the stack */}
              <div class="ri-aura-wrap" aria-hidden="true">
                <span class="ri-aura ri-aura-1" />
                <span class="ri-aura ri-aura-2" />
                <span class="ri-aura ri-aura-3" />
              </div>

              <div class="ri-book-stack" data-stack>
                <For each={HERO_VIEWS}>
                  {(v, i) => (
                    <div
                      class="ri-layer"
                      classList={{ "is-dark": !!v.dark }}
                      data-layer
                      style={{ "--i": String(i()) }}
                    >
                      {/* eager, not lazy: a lazy layer would still be blank the
                          moment the page above it turns to reveal it */}
                      <img
                        src={v.src}
                        alt={v.alt}
                        width={v.w}
                        height={v.h}
                        decoding="async"
                        fetchpriority={v.priority ? "high" : undefined}
                      />
                    </div>
                  )}
                </For>
              </div>

              <span class="ri-book-contact" aria-hidden="true" />
            </div>
          </Container>
        </section>

        {/* ══ INTEGRATIONS DIAGRAM + FEATURE CARDS ═══════════════════════════
            One block: connector lines run from the logo chips into the hub,
            then down and out into the three cards, so the whole thing reads as
            a single wired diagram. The SVG viewBoxes and the chip --l/--t
            percentages are two views of the same coordinate space — if you move
            a chip, move its path too. */}
        <section class="ri-section" id="integrations">
          <Blobs
            items={[
              { tone: "lilac", x: "-6%", y: "10%", s: "1" },
              { tone: "peach", x: "86%", y: "40%", s: ".9" },
            ]}
          />

          <Container>
            <header class="mb-9 text-center">
              <h2 class="ri-display" data-reveal>
                Every campaign, every rupee,
                <br class="ri-br" /> in one ledger
              </h2>
              <p class="ri-lede ri-lede-narrow mx-auto mt-4" data-reveal>
                Meta ad accounts feed straight in. Spend, leads and CPL roll up
                by campaign, project and client — automatically.
              </p>
            </header>

            <div class="w-full" data-diagram>
              {/* Hub: four logo chips wired into the central mark */}
              <div class="ri-hub">
                <svg
                  class="ri-conn-svg"
                  viewBox="0 0 1000 190"
                  fill="none"
                  aria-hidden="true"
                  preserveAspectRatio="none"
                >
                  <g
                    class="ri-conn-lines"
                    stroke="#DDDDE4"
                    stroke-width="1.6"
                    stroke-linecap="round"
                  >
                    <path d="M200 52 H288 Q300 52 300 64 V83 Q300 95 312 95 H470" />
                    <path d="M200 138 H288 Q300 138 300 126 V107 Q300 95 312 95 H470" />
                    <path d="M800 52 H712 Q700 52 700 64 V83 Q700 95 688 95 H530" />
                    <path d="M800 138 H712 Q700 138 700 126 V107 Q700 95 688 95 H530" />
                    <path d="M500 126 V190" />
                  </g>
                </svg>

                {/* SWAP: the data sources that feed the ledger */}
                <span
                  class="ri-chip"
                  style={{ "--l": "14%", "--t": "27.4%" }}
                  data-chip
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" fill="#0866FF" />
                    <path
                      d="M13.2 21.9V13.9h2.7l.5-3.1h-3.2V8.8c0-.9.3-1.5 1.6-1.5h1.7V4.5c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.1v3.1h2.7v8Z"
                      fill="#fff"
                    />
                  </svg>
                  Meta Ads
                </span>

                <span
                  class="ri-chip"
                  style={{ "--l": "14%", "--t": "72.6%" }}
                  data-chip
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    aria-hidden="true"
                  >
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="4"
                      fill="#7B68EE"
                    />
                    <rect
                      x="6.5"
                      y="8"
                      width="11"
                      height="1.9"
                      rx=".95"
                      fill="#fff"
                    />
                    <rect
                      x="6.5"
                      y="11.5"
                      width="11"
                      height="1.9"
                      rx=".95"
                      fill="#fff"
                    />
                    <rect
                      x="6.5"
                      y="15"
                      width="6.5"
                      height="1.9"
                      rx=".95"
                      fill="#fff"
                    />
                  </svg>
                  Lead Forms
                </span>

                <span
                  class="ri-chip"
                  style={{ "--l": "86%", "--t": "27.4%" }}
                  data-chip
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    aria-hidden="true"
                  >
                    <rect
                      x="2.5"
                      y="5"
                      width="19"
                      height="14"
                      rx="3"
                      fill="#2F8F5B"
                    />
                    <rect
                      x="2.5"
                      y="8.5"
                      width="19"
                      height="2.6"
                      fill="#fff"
                      opacity=".85"
                    />
                    <rect
                      x="5.5"
                      y="14"
                      width="5"
                      height="1.8"
                      rx=".9"
                      fill="#fff"
                    />
                  </svg>
                  Ad Accounts
                </span>

                <span
                  class="ri-chip"
                  style={{ "--l": "86%", "--t": "72.6%" }}
                  data-chip
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    aria-hidden="true"
                  >
                    <rect
                      x="3"
                      y="4"
                      width="18"
                      height="16"
                      rx="3.5"
                      fill="#E6398A"
                    />
                    <rect
                      x="6"
                      y="8.5"
                      width="12"
                      height="2.2"
                      rx="1.1"
                      fill="#fff"
                      opacity=".9"
                    />
                    <rect
                      x="6"
                      y="13"
                      width="7"
                      height="2.2"
                      rx="1.1"
                      fill="#fff"
                      opacity=".6"
                    />
                  </svg>
                  Budgets
                </span>

                {/* Deliberately the drawn mark, NOT the brand lockup: this chip
                    is a node in a diagram alongside the Meta/Lead Forms/etc.
                    chips, so it needs to read at their weight. The real logo
                    lives in the navbar. */}
                <span
                  class="ri-chip ri-chip-core"
                  style={{ "--l": "50%", "--t": "50%" }}
                  data-chip
                >
                  <svg
                    viewBox="0 0 32 32"
                    width="24"
                    height="24"
                    aria-hidden="true"
                  >
                    <circle cx="16" cy="16" r="15" fill="#fff" />
                    <circle cx="16" cy="16" r="5.5" fill="#141416" />
                  </svg>
                  Aajneeti
                </span>
              </div>

              {/* Branch: the trunk fans out and drops into each card below.
                  Drop x-coords (161 / 500 / 839) are the card centres of a
                  3-column grid — keep them in sync with the grid below. */}
              <div class="ri-branch">
                <svg
                  class="ri-conn-svg"
                  viewBox="0 0 1000 62"
                  fill="none"
                  aria-hidden="true"
                  preserveAspectRatio="none"
                >
                  <g
                    class="ri-conn-lines"
                    stroke="#DDDDE4"
                    stroke-width="1.6"
                    stroke-linecap="round"
                  >
                    <path d="M500 0 V62" />
                    <path d="M500 22 H173 Q161 22 161 34 V62" />
                    <path d="M500 22 H827 Q839 22 839 34 V62" />
                  </g>
                </svg>
              </div>
            </div>

            <div
              class="grid grid-cols-1 gap-6 min-[901px]:grid-cols-3"
              id="features"
              data-stagger
            >
              <For each={FEATURE_CARDS}>
                {(c) => (
                  <article class="ri-card flex flex-col p-[22px]" data-reveal>
                    <h3 class="flex items-center gap-2.5 ri-h text-[17px] font-bold tracking-[-0.02em]">
                      <span class={`ri-ico ${c.icon}`} aria-hidden="true" />
                      {c.title}
                    </h3>
                    <p class="mt-2 text-sm leading-[1.6] text-[color:var(--grey)]">
                      {c.lead}
                    </p>
                    <div class="ri-shot mb-4 mt-[14px] rounded-[14px] p-2.5">
                      <img
                        src={c.src}
                        alt={c.alt}
                        width={c.w}
                        height={c.h}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    <p class="mt-auto text-[13px] leading-[1.55] text-[color:var(--grey-2)]">
                      {c.cap}
                    </p>
                  </article>
                )}
              </For>
            </div>
          </Container>
        </section>

        {/* ══ BENTO FEATURE GRID ═════════════════════════════════════════════ */}
        <section class="ri-section" id="bento">
          <Container>
            <div class="ri-bento-panel relative isolate overflow-hidden px-6 py-9 min-[1081px]:px-10 min-[1081px]:py-12">
              <Blobs
                soft
                items={[
                  { tone: "lilac", x: "5%", y: "15%", s: ".7" },
                  { tone: "pink", x: "70%", y: "55%", s: ".8" },
                ]}
              />

              <header class="relative z-[1] mb-9 text-center">
                <h2 class="ri-display" data-reveal>
                  Reporting without the spreadsheet
                </h2>
                <p class="ri-lede mx-auto mt-4" data-reveal>
                  Everything that used to live in exports, WhatsApp threads and
                  end-of-month reconciliation — in one place.
                </p>
              </header>

              <div class="relative z-[1] grid grid-cols-12 gap-5" data-stagger>
                {/* Bento A — chat */}
                <article
                  class="ri-bcard col-span-12 grid content-start gap-5 p-[22px] min-[901px]:col-span-7"
                  data-reveal
                >
                  <div class="ri-bcard-ui ri-bshot p-4">
                    <img
                      src={`${SHOTS}/project-brief.png`}
                      alt="Daily brief panel: what went well on the left, and an auto-tracked issues log flagging two accounts that have gone dark and one buying leads 65% over the portfolio average"
                      width={1547}
                      height={557}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div>
                    <h3 class="ri-h text-xl font-bold tracking-[-0.025em]">
                      Alerts before you have to ask
                    </h3>
                    <p class="mt-2 text-[14.5px] leading-[1.65] text-[color:var(--grey)]">
                      A cost-per-lead ceiling sits on every project. If a
                      campaign drifts past it — or quietly goes dark — the alert
                      reaches you, rather than surfacing in next month's report.
                    </p>
                  </div>
                </article>

                {/* Bento B — integrations */}
                <article
                  class="ri-bcard col-span-12 grid content-start gap-5 p-[22px] min-[901px]:col-span-5"
                  data-reveal
                >
                  <div class="ri-bcard-ui ri-bshot p-4">
                    <img
                      src={`${SHOTS}/budget.png`}
                      alt="Project ledger table listing each project's budget, total leads, total spent and average CPL, with a portfolio total row"
                      width={1487}
                      height={535}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div>
                    <h3 class="ri-h text-xl font-bold tracking-[-0.025em]">
                      Budget pacing you can read
                    </h3>
                    <p class="mt-2 text-[14.5px] leading-[1.65] text-[color:var(--grey)]">
                      Spend against allocation, days elapsed against budget
                      used, and where the month lands at the current run rate —
                      in a sentence, not a spreadsheet.
                    </p>
                  </div>
                </article>

                {/* Bento C — report */}
                <article
                  class="ri-bcard col-span-12 grid items-center gap-5 p-[22px] min-[1081px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] min-[1081px]:gap-8"
                  data-reveal
                >
                  <div>
                    <h3 class="ri-h text-xl font-bold tracking-[-0.025em]">
                      Every campaign, itemised
                    </h3>
                    <p class="mt-2 text-[14.5px] leading-[1.65] text-[color:var(--grey)]">
                      Drill from a project down to the individual campaign:
                      leads, spend and cost per lead side by side, so it's
                      obvious which ones are earning their budget and which are
                      quietly draining it.
                    </p>
                  </div>
                  <div class="ri-bcard-ui ri-bshot p-4">
                    <img
                      src={`${SHOTS}/campns.png`}
                      alt="A single campaign's detail view: leads, impressions, reach, spend and ROAS, with cost per result broken out alongside"
                      width={1650}
                      height={802}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                </article>
              </div>
            </div>
          </Container>
        </section>

        {/* ══ HOW IT WORKS ═══════════════════════════════════════════════════
            NOTE: a real customer-quote block belongs here. It was removed
            rather than filled with invented names — see the handover notes. */}
        <section class="ri-section" id="testimonials">
          <Container>
            <header class="mb-9 text-center">
              <h2 class="ri-display" data-reveal>
                From Ad account to answer
              </h2>
              <p class="ri-lede ri-lede-narrow mx-auto mt-4" data-reveal>
                Three steps, then the reporting runs itself.
              </p>
            </header>

            {/* Steps stack vertically on mobile — NOT a horizontal carousel. A
                nested overflow-x scroller here fights Lenis's touch handling
                and makes the whole page feel like the scroll is jamming. */}
            <div
              class="grid grid-cols-1 gap-[14px] min-[901px]:grid-cols-3 min-[901px]:gap-5"
              data-stagger
            >
              <For each={STEPS}>
                {(s) => (
                  <article
                    class="ri-quote grid content-between gap-[18px] p-6"
                    data-reveal
                  >
                    <p class="text-[15.5px] leading-[1.6]">
                      <strong>{s.lead}</strong> {s.body}
                    </p>
                    <footer class="flex items-center gap-2.5">
                      <i class={`ri-av ${s.av} !h-[34px] !w-[34px]`} />
                      <span>
                        <strong class="block ri-h text-sm">{s.step}</strong>
                        <em class="block text-[12.5px] not-italic text-[color:var(--grey-2)]">
                          {s.label}
                        </em>
                      </span>
                    </footer>
                  </article>
                )}
              </For>
            </div>
          </Container>
        </section>

        {/* ══ CTA BAND ═══════════════════════════════════════════════════════ */}
        <section class="ri-section ri-cta" id="cta">
          <Blobs
            items={[
              { tone: "lilac", x: "12%", y: "0%", s: "1.1" },
              { tone: "peach", x: "72%", y: "20%", s: "1" },
              { tone: "pink", x: "42%", y: "45%", s: "1.2" },
            ]}
          />
          <Container class="grid justify-items-center gap-5">
            <h2 class="ri-display max-w-[880px]" data-reveal>
              See your campaigns the way
              <br class="ri-br" /> your clients see them
            </h2>
            <p class="ri-lede mx-auto" data-reveal>
              Connect a Meta ad account and the ledger fills itself. Everything
              after that is just reading it.
            </p>
            <div data-reveal class="max-[420px]:w-full">
              <A href={ctaHref()} class="ri-btn ri-btn-dark">
                {signedIn()
                  ? "Go to the dashboard"
                  : "Login to the dashboard"}
              </A>
            </div>
          </Container>
        </section>
      </main>

      {/* ══ FOOTER — copyright only ══════════════════════════════════════════
          Link columns and socials were removed deliberately: they pointed at
          internal routes (manager performance, leaderboard, funding) that a
          client shouldn't see. */}
      <footer class="ri-footer relative pt-2">
        {/* Huge watermark, filled with the page's pastel wash */}
        <div class="ri-watermark px-[18px] min-[721px]:px-6 pt-[50px]" aria-hidden="true">
          <span>Aajneeti</span>
        </div>
        <Container>
          <div class=" flex justify-center gap-4 pb-[30px] ">
            <small class="text-[13px] text-[color:var(--grey-2)]">
              © 2026 Aajneeti Connect Limited. All rights reserved.
            </small>
          </div>
        </Container>
      </footer>
    </div>
  );
}
