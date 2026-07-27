/* ==========================================================================
   RETAINABLE — interaction + animation layer
   - Lenis smooth scrolling
   - GSAP ScrollTrigger reveals (fade + 40px rise, staggered per section)
   - Hero mockup scale-in + parallax
   - Integration connectors drawing in, chips popping with overshoot
   - Number counters, chart bars, progress fills
   - Navbar shrink/blur, mobile menu

   Everything is transform/opacity only, and the whole layer no-ops under
   `prefers-reduced-motion` or if the CDN libraries fail to load.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = root.classList.contains('reduced-motion');
  var hasGSAP = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

  /* ------------------------------------------------------------------ *
   * 0. Always-on UI (works without any library)
   * ------------------------------------------------------------------ */
  var navWrap = document.getElementById('navWrap');
  var navLinks = document.getElementById('navLinks');
  var burger = document.getElementById('navBurger');

  function onScroll() {
    navWrap.classList.toggle('is-stuck', window.scrollY > 24);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  function closeMenu() {
    navLinks.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Open menu');
  }

  burger.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = navLinks.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });

  document.addEventListener('click', function (e) {
    if (navLinks.classList.contains('is-open') && !navLinks.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth > 900) closeMenu();
  });

  /* ------------------------------------------------------------------ *
   * 1. Bail out cleanly if animation isn't possible/wanted
   * ------------------------------------------------------------------ */
  if (!hasGSAP || reduced) {
    // Reveal everything; CSS keys its pre-animation states off these classes.
    root.classList.add('no-motion');
    // Native anchor scrolling still applies (html { scroll-behavior: smooth }).
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', closeMenu);
    });
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ------------------------------------------------------------------ *
   * 2. Lenis smooth scroll, driven by the GSAP ticker
   * ------------------------------------------------------------------ */
  var lenis = null;
  if (typeof window.Lenis !== 'undefined') {
    lenis = new Lenis({
      duration: 1.15,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: true,
      touchMultiplier: 1.6
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  // Anchor links routed through Lenis so in-page jumps stay smooth.
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      closeMenu();
      if (lenis) lenis.scrollTo(target, { offset: -92, duration: 1.2 });
      else target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  /* ------------------------------------------------------------------ *
   * 3. Generic reveals — fade in + 40px rise
   *    [data-stagger] on a wrapper staggers its [data-reveal] children.
   * ------------------------------------------------------------------ */
  /* y is the reveal travel. Keep it SMALL relative to the gap under any header
     (see .sec-head--tight): the element sits at +y until its ScrollTrigger
     fires, so if y exceeds the gap below it, it visually overlaps the next
     block on the way in. 24 stays comfortably under every section's spacing. */
  var REVEAL = { y: 24, dur: 0.85, ease: 'power3.out', start: 'top 85%' };

  function revealTo(targets, stagger) {
    gsap.set(targets, { opacity: 0, y: REVEAL.y });
    return gsap.to(targets, {
      opacity: 1,
      y: 0,
      duration: REVEAL.dur,
      ease: REVEAL.ease,
      stagger: stagger || 0,
      clearProps: 'transform'
    });
  }

  var staggerGroups = gsap.utils.toArray('[data-stagger]');

  staggerGroups.forEach(function (group) {
    var items = group.querySelectorAll('[data-reveal]');
    if (!items.length) return;
    gsap.set(items, { opacity: 0, y: REVEAL.y });
    ScrollTrigger.create({
      trigger: group,
      start: REVEAL.start,
      once: true,
      onEnter: function () { revealTo(items, 0.12); }
    });
  });

  gsap.utils.toArray('[data-reveal]').forEach(function (el) {
    if (el.closest('[data-stagger]')) return; // handled by its group
    gsap.set(el, { opacity: 0, y: REVEAL.y });
    ScrollTrigger.create({
      trigger: el,
      start: REVEAL.start,
      once: true,
      onEnter: function () { revealTo(el); }
    });
  });

  /* ------------------------------------------------------------------ *
   * 4. Hero intro — light shot lands, dark shot rises over it, then the
   *    page eases down to frame both. Runs once, on load, above the fold,
   *    so it's a plain timeline rather than a ScrollTrigger.
   * ------------------------------------------------------------------ */
  var showcase = document.getElementById('showcase');
  var stack = document.querySelector('[data-stack]');
  var layers = gsap.utils.toArray('[data-layer]');   // DOM order = display order
  var contact = document.querySelector('.book__contact');

  /* Gentle one-shot scroll that brings the screenshot pair fully into frame.
     Aborts the moment the visitor takes over — never fight the user's input. */
  function introScroll() {
    if (!showcase) return;
    if (window.scrollY > 8) return;          // they already started scrolling
    if (!lenis) {                            // no Lenis: plain native smooth scroll
      showcase.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    var cancelled = false;
    function cancel() {
      if (cancelled) return;
      cancelled = true;
      // Halt mid-flight by re-targeting the current position.
      var here = typeof lenis.animatedScroll === 'number' ? lenis.animatedScroll : window.scrollY;
      lenis.scrollTo(here, { immediate: true });
      teardown();
    }
    var events = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    function teardown() {
      events.forEach(function (evt) { window.removeEventListener(evt, cancel); });
    }
    events.forEach(function (evt) { window.addEventListener(evt, cancel, { passive: true, once: true }); });

    // SWAP: change the target/offset to scroll somewhere else on arrival.
    lenis.scrollTo(showcase, {
      offset: -104,               // clears the floating navbar
      duration: 1.9,
      easing: function (t) { return 1 - Math.pow(1 - t, 3); },
      onComplete: teardown
    });
  }

  var TURN_DUR = 1.5;   // SWAP: length of one page turn
  var TURN_HOLD = 1.1;  // SWAP: how long each view sits before the next turn
  var TURN_BLUR = 2.5;  // SWAP: motion blur through the fastest part of the arc, in px (0 disables)
  var turned = 0;
  var busy = false;

  /* One page turn: the top layer is hinged on its left edge and rotates -180°.
     Once it passes 90° its backface is culled (CSS backface-visibility), so the
     layer beneath is revealed in exactly the same place.

     rotationY goes on the LAYER; blur goes on the <img>, never on the layer.
     `filter` on the rotating element flattens it into a 2D grouping context and
     disables backface culling — you'd see a mirrored screenshot instead. */
  function turnPage(i) {
    var layer = layers[i];
    if (!layer) return null;
    var img = layer.querySelector('img');
    var d = TURN_DUR;

    var tl = gsap.timeline();
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
    gsap.set('.layer img', { filter: 'blur(0px)' });
  }

  /* One turn per view except the last — the bottom view has nothing to
     reveal, so N views give N-1 turns. */
  var steps = layers.slice(0, -1).map(function (_, i) {
    return function () { return turnPage(i); };
  });

  // Step forward; once the last view is showing, snap back to the first.
  function advance() {
    if (busy || !steps.length) return;
    busy = true;
    var done = function () { busy = false; };

    if (turned >= steps.length) {
      turned = 0;
      resetShowcase();
      done();
      return;
    }
    var tl = steps[turned]();
    turned++;
    if (tl) tl.eventCallback('onComplete', done); else done();
  }

  if (stack && showcase) {
    gsap.set(showcase, { opacity: 0, y: 60, scale: 0.95, transformOrigin: '50% 100%' });
    // Book opening: it tips up off the surface and settles flat
    gsap.set(stack, { rotationX: 14, rotationY: -12, transformOrigin: '50% 100%' });

    var intro = gsap.timeline({ delay: 0.2 })
      .to(showcase, { opacity: 1, y: 0, scale: 1, duration: 1.1, ease: 'power3.out' }, 0)
      .to(stack, { rotationX: 0, rotationY: 0, duration: 1.35, ease: 'power3.out' }, 0)
      // Frame the stack before the views start changing.
      // Remove this `.add()` line if you don't want the page to move on its own.
      .add(introScroll, '+=0.5');

    // Then turn one page at a time: each waits out the previous turn plus a
    // hold, so every screenshot gets a beat on screen.
    steps.forEach(function (_, i) {
      intro.call(advance, null, '+=' + (i === 0 ? 0.9 : TURN_DUR + TURN_HOLD));
    });

    // Manual stepping — click or keyboard advances, then resets to view one.
    showcase.addEventListener('click', advance);
    showcase.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); }
    });
  }

  gsap.utils.toArray('[data-parallax]').forEach(function (el) {
    gsap.to(el, {
      yPercent: -6,
      ease: 'none',
      scrollTrigger: {
        trigger: el,
        start: 'top 80%',
        end: 'bottom top',
        scrub: 0.6
      }
    });
  });

  /* ------------------------------------------------------------------ *
   * 5. Integrations diagram — draw the connectors, pop the chips
   * ------------------------------------------------------------------ */
  var diagram = document.querySelector('[data-diagram]');
  if (diagram) {
    var paths = diagram.querySelectorAll('.conn__lines path');
    var chips = diagram.querySelectorAll('[data-chip]');
    var core = diagram.querySelector('.chip--core');

    paths.forEach(function (p) {
      var len = p.getTotalLength();
      gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
    });
    gsap.set(chips, { opacity: 0, scale: 0.6 });

    ScrollTrigger.create({
      trigger: diagram,
      start: 'top 78%',
      once: true,
      onEnter: function () {
        var tl = gsap.timeline();
        // Core chip lands first, then lines draw outward, then the logos pop.
        tl.to(core, { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.8)' })
          .to(paths, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut', stagger: 0.09 }, '-=0.25')
          .to(
            gsap.utils.toArray(chips).filter(function (c) { return c !== core; }),
            { opacity: 1, scale: 1, duration: 0.55, ease: 'back.out(2)', stagger: 0.08 },
            '-=0.55'
          );
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 6. Mock data animations — counters, chart bars, progress fills
   * ------------------------------------------------------------------ */
  gsap.utils.toArray('[data-count]').forEach(function (el) {
    var end = parseFloat(el.getAttribute('data-count'));
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    var obj = { v: 0 };
    gsap.to(obj, {
      v: end,
      duration: 1.4,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      onUpdate: function () { el.textContent = prefix + Math.round(obj.v) + suffix; }
    });
  });

  gsap.utils.toArray('.bars').forEach(function (chart) {
    var bars = chart.querySelectorAll('b');
    gsap.set(bars, { scaleY: 0, transformOrigin: 'bottom center' });
    gsap.to(bars, {
      scaleY: 1,
      duration: 0.7,
      ease: 'power3.out',
      stagger: 0.05,
      scrollTrigger: { trigger: chart, start: 'top 92%', once: true }
    });
  });

  gsap.utils.toArray('.prog b').forEach(function (fill) {
    gsap.set(fill, { scaleX: 0, transformOrigin: 'left center' });
    gsap.to(fill, {
      scaleX: 1,
      duration: 0.9,
      ease: 'power3.out',
      scrollTrigger: { trigger: fill, start: 'top 96%', once: true }
    });
  });

  /* ------------------------------------------------------------------ *
   * 7. Footer watermark — subtle rise as the page bottoms out
   * ------------------------------------------------------------------ */
  var watermark = document.querySelector('.watermark span');
  if (watermark) {
    gsap.fromTo(
      watermark,
      { yPercent: 18, opacity: 0.4 },
      {
        yPercent: 0,
        opacity: 1,
        ease: 'none',
        scrollTrigger: { trigger: '.footer', start: 'top 85%', end: 'bottom bottom', scrub: 0.5 }
      }
    );
  }

  // Fonts land late and change layout heights — recalc once they're ready.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  }
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
