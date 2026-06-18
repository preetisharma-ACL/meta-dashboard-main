import { createSignal, createEffect, onCleanup, untrack } from "solid-js";
export default function CountUp(props) {
  const [display, setDisplay] = createSignal(0);
  let revealed = false; // becomes true after the first real reveal

  const fmt = (n) =>
    (props.format ?? ((v) => Number(v).toLocaleString("en-IN")))(n);

  createEffect(() => {
    const loading = props.loading;
    const target = Number(props.value) || 0;

    if (loading) {
      // Loading: keep counting upward so the user sees activity, not ₹0.
      let frame;
      let cur = untrack(display);
      const step = () => {
        // Gentle, ever-increasing ramp — no upper cap, so it keeps climbing for
        // large datasets instead of looping back to 0.
        cur += Math.max(1, cur * 0.015) + 1;
        setDisplay(Math.round(cur));
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      onCleanup(() => cancelAnimationFrame(frame));
      return;
    }

    // Data is loaded.
    if (revealed) {
      // Already revealed → mirror subsequent changes instantly (old behaviour).
      setDisplay(target);
      return;
    }

    // First time we have real data → one-time smooth count-up reveal.
    revealed = true;
    let frame;
    const start = untrack(display);
    const startedAt = performance.now();
    const dur = props.duration ?? 900;
    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      if (t < 1) {
        setDisplay(Math.round(start + (target - start) * eased));
        frame = requestAnimationFrame(tick);
      } else {
        setDisplay(target); // exact final value → formats identically to before
      }
    };
    frame = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return <>{fmt(display())}</>;
}
