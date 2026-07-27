/* ─── Reporting intro — interaction + animation layer ─────────────────────────
 * Straight port of the standalone landing page's main.js, reshaped so it can be
 * started and torn down by a SolidJS component instead of running once at
 * document load:
 *   - every query is scoped to the page root, never `document`
 *   - GSAP/Lenis come off the CDN lazily (they aren't project dependencies), so
 *     nothing is downloaded on any other route
 *   - everything registers inside a gsap.context() and a listener list, so
 *     onCleanup can revert it completely when the visitor navigates to /login
 *
 * Everything is transform/opacity only, and the whole layer no-ops under
 * `prefers-reduced-motion` or if the CDN libraries fail to load.
 * ──────────────────────────────────────────────────────────────────────────── */

const CDN = {
  gsap: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
  scrollTrigger: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js',
  lenis: 'https://unpkg.com/lenis@1.1.13/dist/lenis.min.js',
};

// One promise per URL — remounting the page must not re-inject the script tag.
const scriptCache = new Map();

function loadScript(src) {
  if (scriptCache.has(src)) return scriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(el);
  });
  scriptCache.set(src, p);
  return p;
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Wire up the landing page's motion layer.
 * @param {HTMLElement} root  the `.ri` wrapper
 * @param {object} handles    { onNoMotion } — called if animation can't run
 * @returns {() => void}      cleanup
 */
export function initLandingMotion(root, handles = {}) {
  if (!root) return () => {};

  const listeners = [];
  let disposed = false;
  let ctx = null;      // gsap.context — reverts every tween/ScrollTrigger it made
  let lenis = null;
  let tickerFn = null;
  let bailTimer = null;

  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    listeners.push(() => target.removeEventListener(type, fn, opts));
  };

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));

  /* ---------------------------------------------------------------- *
   * 0. Always-on UI (works without any library)
   * ---------------------------------------------------------------- */
  const navWrap = $('[data-nav-wrap]');
  const navLinks = $('[data-nav-links]');
  const burger = $('[data-burger]');

  function closeMenu() {
    if (!navLinks || !burger) return;
    navLinks.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Open menu');
  }

  if (navWrap) {
    const onScroll = () => navWrap.classList.toggle('is-stuck', window.scrollY > 24);
    on(window, 'scroll', onScroll, { passive: true });
    onScroll();
  }

  if (burger && navLinks) {
    on(burger, 'click', (e) => {
      e.stopPropagation();
      const open = navLinks.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    on(document, 'click', (e) => {
      if (navLinks.classList.contains('is-open') && !navLinks.contains(e.target)) closeMenu();
    });
    on(document, 'keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    on(window, 'resize', () => { if (window.innerWidth > 900) closeMenu(); });
  }

  /* ---------------------------------------------------------------- *
   * 1. Bail out cleanly if animation isn't possible/wanted
   * ---------------------------------------------------------------- */
  function bail() {
    if (disposed) return;
    // Reveal everything; the CSS keys its pre-animation states off this class.
    handles.onNoMotion?.();
    // Native anchor scrolling still applies via scroll-behavior.
    $$('a[href^="#"]').forEach((a) => on(a, 'click', closeMenu));
  }

  if (prefersReducedMotion()) {
    bail();
    return dispose;
  }

  // Guard against a CDN that resolves but never finishes: after 5s, show the
  // page rather than leaving every [data-reveal] stuck at opacity 0.
  bailTimer = setTimeout(bail, 5000);

  Promise.all([
    loadScript(CDN.gsap).then(() => loadScript(CDN.scrollTrigger)),
    // Lenis is optional — smooth scroll degrades to native if it 404s.
    loadScript(CDN.lenis).catch(() => null),
  ])
    .then(() => {
      clearTimeout(bailTimer);
      if (disposed) return;
      if (!window.gsap || !window.ScrollTrigger) { bail(); return; }
      start();
    })
    .catch(() => {
      clearTimeout(bailTimer);
      bail();
    });

  /* ---------------------------------------------------------------- *
   * The animation layer proper — runs once the libraries have landed
   * ---------------------------------------------------------------- */
  function start() {
    const { gsap, ScrollTrigger } = window;
    gsap.registerPlugin(ScrollTrigger);

    ctx = gsap.context(() => {
      /* ------------------------------------------------------------ *
       * 2. Lenis smooth scroll, driven by the GSAP ticker
       * ------------------------------------------------------------ */
      if (typeof window.Lenis !== 'undefined') {
        lenis = new window.Lenis({
          duration: 1.15,
          easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          smoothWheel: true,
          touchMultiplier: 1.6,
        });
        lenis.on('scroll', ScrollTrigger.update);
        tickerFn = (time) => lenis.raf(time * 1000);
        gsap.ticker.add(tickerFn);
        gsap.ticker.lagSmoothing(0);
      }

      // Anchor links routed through Lenis so in-page jumps stay smooth.
      $$('a[href^="#"]').forEach((a) => {
        on(a, 'click', (e) => {
          const id = a.getAttribute('href');
          if (!id || id === '#') return;
          const target = root.querySelector(id);
          if (!target) return;
          e.preventDefault();
          closeMenu();
          if (lenis) lenis.scrollTo(target, { offset: -92, duration: 1.2 });
          else target.scrollIntoView({ behavior: 'smooth' });
        });
      });

      /* ------------------------------------------------------------ *
       * 3. Generic reveals — fade in + rise
       *    [data-stagger] on a wrapper staggers its [data-reveal] children.
       * ------------------------------------------------------------ */
      /* y is the reveal travel. Keep it SMALL relative to the gap under any
         header: the element sits at +y until its ScrollTrigger fires, so if y
         exceeds the gap below it, it visually overlaps the next block on the
         way in. 24 stays comfortably under every section's spacing. */
      const REVEAL = { y: 24, dur: 0.85, ease: 'power3.out', start: 'top 85%' };

      const revealTo = (targets, stagger) => {
        gsap.set(targets, { opacity: 0, y: REVEAL.y });
        return gsap.to(targets, {
          opacity: 1,
          y: 0,
          duration: REVEAL.dur,
          ease: REVEAL.ease,
          stagger: stagger || 0,
          clearProps: 'transform',
        });
      };

      $$('[data-stagger]').forEach((group) => {
        const items = group.querySelectorAll('[data-reveal]');
        if (!items.length) return;
        gsap.set(items, { opacity: 0, y: REVEAL.y });
        ScrollTrigger.create({
          trigger: group,
          start: REVEAL.start,
          once: true,
          onEnter: () => revealTo(items, 0.12),
        });
      });

      $$('[data-reveal]').forEach((el) => {
        if (el.closest('[data-stagger]')) return; // handled by its group
        gsap.set(el, { opacity: 0, y: REVEAL.y });
        ScrollTrigger.create({
          trigger: el,
          start: REVEAL.start,
          once: true,
          onEnter: () => revealTo(el),
        });
      });

      /* ------------------------------------------------------------ *
       * 4. Hero showcase — the stack lands, then turns page by page.
       *    Runs once, on mount, above the fold, so it's a plain timeline
       *    rather than a ScrollTrigger.
       * ------------------------------------------------------------ */
      const showcase = $('[data-showcase]');
      const stack = $('[data-stack]');
      const layers = $$('[data-layer]');          // DOM order = display order
      const contact = $('.ri-book-contact');

      /* Gentle one-shot scroll that brings the screenshot pair fully into
         frame. Aborts the moment the visitor takes over — never fight input. */
      function introScroll() {
        if (!showcase || disposed) return;
        if (window.scrollY > 8) return;           // they already started scrolling
        if (!lenis) {                             // no Lenis: native smooth scroll
          showcase.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }

        let cancelled = false;
        const events = ['wheel', 'touchstart', 'keydown', 'mousedown'];
        const teardown = () => events.forEach((evt) => window.removeEventListener(evt, cancel));
        function cancel() {
          if (cancelled) return;
          cancelled = true;
          // Halt mid-flight by re-targeting the current position.
          const here = typeof lenis.animatedScroll === 'number' ? lenis.animatedScroll : window.scrollY;
          lenis.scrollTo(here, { immediate: true });
          teardown();
        }
        events.forEach((evt) => window.addEventListener(evt, cancel, { passive: true, once: true }));
        listeners.push(teardown);

        // SWAP: change the target/offset to scroll somewhere else on arrival.
        lenis.scrollTo(showcase, {
          offset: -104,             // clears the floating navbar
          duration: 1.9,
          easing: (t) => 1 - Math.pow(1 - t, 3),
          onComplete: teardown,
        });
      }

      const TURN_DUR = 1.5;   // SWAP: length of one page turn
      const TURN_HOLD = 1.1;  // SWAP: how long each view sits before the next turn
      const TURN_BLUR = 2.5;  // SWAP: motion blur through the fastest part of the arc, in px (0 disables)
      let turned = 0;
      let busy = false;

      /* One page turn: the top layer is hinged on its left edge and rotates
         -180°. Once past 90° its backface is culled (CSS backface-visibility),
         so the layer beneath is revealed in exactly the same place.

         rotationY goes on the LAYER; blur goes on the <img>, never on the
         layer. `filter` on the rotating element flattens it into a 2D grouping
         context and disables backface culling — you'd see a mirrored
         screenshot instead. */
      function turnPage(i) {
        const layer = layers[i];
        if (!layer) return null;
        const img = layer.querySelector('img');
        const d = TURN_DUR;

        const tl = gsap.timeline();
        tl.to(layer, { rotationY: -180, duration: d, ease: 'power2.inOut' }, 0);

        if (img && TURN_BLUR > 0) {
          tl.to(img, { filter: 'blur(' + TURN_BLUR + 'px)', duration: d * 0.5, ease: 'power1.inOut' }, 0)
            .to(img, { filter: 'blur(0px)', duration: d * 0.5, ease: 'power1.inOut' }, d * 0.5);
        }
        // The stack settles as the page lifts off it
        if (contact) {
          tl.to(contact, { opacity: 0.32, scaleX: 0.92, duration: d * 0.5, ease: 'power1.inOut' }, 0)
            .to(contact, { opacity: 0.2, scaleX: 1, duration: d * 0.5, ease: 'power1.inOut' }, d * 0.5);
        }
        return tl;
      }

      // Put every layer back to its opening state (view 1 on top, nothing turned).
      function resetShowcase() {
        gsap.set(layers, { rotationY: 0 });
        gsap.set(layers.map((l) => l.querySelector('img')).filter(Boolean), { filter: 'blur(0px)' });
      }

      /* One turn per view except the last — the bottom view has nothing to
         reveal, so N views give N-1 turns. */
      const steps = layers.slice(0, -1).map((_, i) => () => turnPage(i));

      // Step forward; once the last view is showing, snap back to the first.
      function advance() {
        if (busy || !steps.length || disposed) return;
        busy = true;
        const done = () => { busy = false; };

        if (turned >= steps.length) {
          turned = 0;
          resetShowcase();
          done();
          return;
        }
        const tl = steps[turned]();
        turned++;
        if (tl) tl.eventCallback('onComplete', done);
        else done();
      }

      if (stack && showcase) {
        gsap.set(showcase, { opacity: 0, y: 60, scale: 0.95, transformOrigin: '50% 100%' });
        // Book opening: it tips up off the surface and settles flat
        gsap.set(stack, { rotationX: 14, rotationY: -12, transformOrigin: '50% 100%' });

        const intro = gsap.timeline({ delay: 0.2 })
          .to(showcase, { opacity: 1, y: 0, scale: 1, duration: 1.1, ease: 'power3.out' }, 0)
          .to(stack, { rotationX: 0, rotationY: 0, duration: 1.35, ease: 'power3.out' }, 0)
          // Frame the stack before the views start changing.
          // Remove this `.add()` line if you don't want the page to move itself.
          .add(introScroll, '+=0.5');

        // Then turn one page at a time: each waits out the previous turn plus a
        // hold, so every screenshot gets a beat on screen.
        steps.forEach((_, i) => {
          intro.call(advance, null, '+=' + (i === 0 ? 0.9 : TURN_DUR + TURN_HOLD));
        });

        // Manual stepping — click or keyboard advances, then resets to view one.
        on(showcase, 'click', advance);
        on(showcase, 'keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); }
        });
      }

      $$('[data-parallax]').forEach((el) => {
        gsap.to(el, {
          yPercent: -6,
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom top', scrub: 0.6 },
        });
      });

      /* ------------------------------------------------------------ *
       * 5. Integrations diagram — draw the connectors, pop the chips
       * ------------------------------------------------------------ */
      const diagram = $('[data-diagram]');
      if (diagram) {
        const paths = Array.from(diagram.querySelectorAll('.ri-conn-lines path'));
        const chips = Array.from(diagram.querySelectorAll('[data-chip]'));
        const core = diagram.querySelector('.ri-chip-core');

        paths.forEach((p) => {
          const len = p.getTotalLength();
          gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
        });
        gsap.set(chips, { opacity: 0, scale: 0.6 });

        ScrollTrigger.create({
          trigger: diagram,
          start: 'top 78%',
          once: true,
          onEnter: () => {
            const tl = gsap.timeline();
            // Core chip lands first, then lines draw outward, then logos pop.
            tl.to(core, { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.8)' })
              .to(paths, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut', stagger: 0.09 }, '-=0.25')
              .to(
                chips.filter((c) => c !== core),
                { opacity: 1, scale: 1, duration: 0.55, ease: 'back.out(2)', stagger: 0.08 },
                '-=0.55',
              );
          },
        });
      }

      /* ------------------------------------------------------------ *
       * 6. Footer watermark — subtle rise as the page bottoms out
       * ------------------------------------------------------------ */
      const watermark = $('.ri-watermark span');
      if (watermark) {
        gsap.fromTo(
          watermark,
          { yPercent: 18, opacity: 0.4 },
          {
            yPercent: 0,
            opacity: 1,
            ease: 'none',
            scrollTrigger: {
              trigger: root.querySelector('.ri-footer'),
              start: 'top 85%',
              end: 'bottom bottom',
              scrub: 0.5,
            },
          },
        );
      }
    }, root);

    // Fonts land late and change layout heights — recalc once they're ready.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (!disposed) ScrollTrigger.refresh(); });
    }
    on(window, 'load', () => { if (!disposed) ScrollTrigger.refresh(); });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(bailTimer);
    listeners.forEach((off) => { try { off(); } catch { /* already gone */ } });
    listeners.length = 0;
    if (tickerFn && window.gsap) window.gsap.ticker.remove(tickerFn);
    if (lenis) { try { lenis.destroy(); } catch { /* noop */ } lenis = null; }
    if (ctx) { try { ctx.revert(); } catch { /* noop */ } ctx = null; }
  }

  return dispose;
}
