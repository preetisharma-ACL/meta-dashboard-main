import { onMount, onCleanup } from "solid-js";
import { launchSound, burstSound } from "../../components/diwali/crackerSound";

// Diwali fireworks that play once when the login page loads, then stop and
// remove themselves. A full-screen canvas with pointer-events:none, so nothing
// underneath (the form included) is ever blocked. Skipped entirely for users
// who prefer reduced motion. With the `sound` prop (the dashboard sets it; the
// login page doesn't) some rockets whistle and bang, quietly.

// Saturated warm tones — pale golds vanish against the peach page.
const COLORS = [
  "#ff5e00", "#e01e5a", "#ff9500", "#d4145a",
  "#f2a900", "#c2185b", "#ff7b00", "#8e2de2",
];

const LAUNCH_FOR_MS = 6500; // new rockets stop after this; sparks finish out
const GRAVITY = 0.11;       // px per frame², rockets
const SPARK_GRAVITY = 0.045;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => min + Math.random() * (max - min);

export default function DiwaliFireworks(props) {
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
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const small = () => w < 900;
    const rockets = [];
    const sparks = [];

    const launch = () => {
      // Bursts land in the upper part of the screen, clear of the fields.
      const x = w * rand(0.08, 0.92);
      const targetY = h * rand(0.1, small() ? 0.3 : 0.42);
      rockets.push({
        x,
        y: h + 10,
        vx: rand(-0.8, 0.8),
        vy: -Math.sqrt(2 * GRAVITY * (h + 10 - targetY)),
        color: pick(COLORS),
        loud: !!props.sound && Math.random() < 0.6,
      });
      if (rockets[rockets.length - 1].loud) launchSound(x / w);
    };

    const explode = (r) => {
      const count = Math.round(rand(55, 85) * (small() ? 0.6 : 1));
      const second = pick(COLORS);
      const ring = Math.random() < 0.35; // some bursts are clean rings
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rand(-0.05, 0.05);
        const speed = ring ? rand(3.6, 4.0) : rand(1, 4.6);
        const life = rand(55, 95);
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
          glitter: Math.random() < 0.3,
        });
      }
      if (r.loud) burstSound(r.x / w, 0.9);
    };

    const start = performance.now();
    let last = start;
    let nextLaunch = start;
    let salvo = 3; // a few rockets at once to open the show
    let raf = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.classList.add("dw-fireworks--out");
      setTimeout(() => canvas.remove(), 700);
    };

    const frame = (now) => {
      // Normalised to 60fps; capped so a background tab doesn't jump.
      const f = Math.min((now - last) / 16.67, 3);
      last = now;
      const launching = now - start < LAUNCH_FOR_MS;

      if (launching && now >= nextLaunch) {
        launch();
        if (salvo > 1) {
          salvo--;
          nextLaunch = now + 120;
        } else {
          salvo = 0;
          nextLaunch = now + rand(260, 620);
        }
      }

      // Fade what's already drawn instead of clearing, so sparks leave trails.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.28 * f, 1)})`;
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
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ox, oy + 6);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
        if (r.vy >= -0.6) {
          explode(r);
          rockets.splice(i, 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.px = s.x;
        s.py = s.y;
        s.vx *= Math.pow(0.975, f);
        s.vy = s.vy * Math.pow(0.975, f) + SPARK_GRAVITY * f;
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

      if (!launching && rockets.length === 0 && sparks.length === 0) {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    onCleanup(finish);
  });

  return <canvas ref={canvas} class="dw-fireworks" aria-hidden="true" />;
}
