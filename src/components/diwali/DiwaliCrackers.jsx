import { onMount, onCleanup } from "solid-js";
import { launchSound, burstSound } from "./crackerSound";

// Small crackers going off now and then in the greeting area at the top of the
// dashboard, for as long as the dashboard is open. The canvas sits behind the
// page content (z-index -1, pointer-events none, see diwali-dashboard.css), so
// it never covers a number or blocks a click. Colours follow the theme: deep
// marigold and rose on the light page, bright gold and pink at night.
// Only the first few bursts of a visit make a sound; after that it's silent
// motion. Paused while the tab is hidden; off for reduced motion.

const LIGHT = ["#ff5e00", "#e01e5a", "#ff9500", "#d4145a", "#f2a900", "#c2185b"];
const DARK = ["#ffd166", "#ff8a3d", "#ff4d6d", "#ffb3c6", "#f9c74f", "#c77dff", "#fff1c1"];
const SOUND_BURSTS = 6;
const GRAVITY = 0.09;
const SPARK_GRAVITY = 0.035;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => min + Math.random() * (max - min);

export default function DiwaliCrackers() {
  let canvas;

  onMount(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      canvas.remove();
      return;
    }
    const ctx = canvas.getContext("2d");
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const rockets = [];
    const sparks = [];
    let sounded = 0;
    let raf = 0;
    let timer = 0;
    let running = false;
    let alive = true;
    let last = 0;

    const palette = () =>
      document.documentElement.classList.contains("dark") ? DARK : LIGHT;

    const launch = () => {
      const x = w * rand(0.08, 0.92);
      const targetY = h * rand(0.15, 0.45);
      const loud = sounded < SOUND_BURSTS;
      rockets.push({
        x,
        y: h + 6,
        vx: rand(-0.5, 0.5),
        vy: -Math.sqrt(2 * GRAVITY * (h + 6 - targetY)),
        color: pick(palette()),
        loud,
      });
      if (loud) launchSound(canvasX(x));
    };

    // Rocket position as a 0..1 share of the window, for stereo panning.
    const canvasX = (x) => {
      const r = canvas.getBoundingClientRect();
      return (r.left + x) / window.innerWidth;
    };

    const explode = (r) => {
      const colors = palette();
      const count = Math.round(rand(45, 70));
      const second = pick(colors);
      const ring = Math.random() < 0.35;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rand(-0.06, 0.06);
        const speed = ring ? rand(2.8, 3.2) : rand(0.8, 3.5);
        const life = rand(48, 85);
        sparks.push({
          x: r.x,
          y: r.y,
          px: r.x,
          py: r.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life,
          max: life,
          color: Math.random() < 0.7 ? r.color : second,
          glitter: Math.random() < 0.35,
        });
      }
      if (r.loud) {
        sounded++;
        burstSound(canvasX(r.x), 0.8);
      }
    };

    const frame = (now) => {
      const f = Math.min((now - last) / 16.67, 3);
      last = now;

      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.24 * f, 1)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        const ox = r.x;
        const oy = r.y;
        r.x += r.vx * f;
        r.y += r.vy * f;
        r.vy += GRAVITY * f;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 1.8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ox, oy + 5);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
        if (r.vy >= -0.5) {
          explode(r);
          rockets.splice(i, 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.px = s.x;
        s.py = s.y;
        s.vx *= Math.pow(0.97, f);
        s.vy = s.vy * Math.pow(0.97, f) + SPARK_GRAVITY * f;
        s.x += s.vx * f;
        s.y += s.vy * f;
        s.life -= f;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        let alpha = s.life / s.max;
        if (s.glitter) alpha *= Math.random() < 0.5 ? 0.25 : 1;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.px, s.py);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Nothing in the air: stop drawing until the next launch.
      if (rockets.length === 0 && sparks.length === 0) {
        ctx.clearRect(0, 0, w, h);
        running = false;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const fire = () => {
      if (!alive) return;
      // Hidden tab, or the canvas is hidden (theme off): check back later.
      if (document.hidden || w === 0 || h === 0) {
        timer = setTimeout(fire, 1500);
        return;
      }
      launch();
      if (Math.random() < 0.3) setTimeout(() => alive && launch(), 220);
      if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
      timer = setTimeout(fire, rand(1400, 3200));
    };
    timer = setTimeout(fire, 900);

    onCleanup(() => {
      alive = false;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      ro.disconnect();
    });
  });

  return <canvas ref={canvas} class="dwd-crackers" aria-hidden="true" />;
}
