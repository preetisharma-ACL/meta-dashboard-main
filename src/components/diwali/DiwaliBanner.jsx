import { Show } from "solid-js";
import "./diwali-dashboard.css";
import DiwaliFireworks from "../../pages/login/DiwaliFireworks";

// Dashboard-only pieces of the Diwali theme: mandala quarters pinned to the
// bottom corners of the viewport, and a fireworks burst on the first dashboard
// visit of the session. The greeting artwork itself is <DiwaliHero /> in the
// app layout. Decorative only (aria-hidden, pointer-events:none). Removing the
// theme = removing <DiwaliBanner />, <DiwaliHero /> and the `dwd-*` classes.

const FIREWORKS_KEY = "dwd-fireworks";

// Fireworks once per browser session, not on every visit to the dashboard.
function firstVisitThisSession() {
  try {
    if (sessionStorage.getItem(FIREWORKS_KEY)) return false;
    sessionStorage.setItem(FIREWORKS_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export default function DiwaliBanner() {
  const fireworks = firstVisitThisSession();

  return (
    <>
      <img src="/images/mandala-top-right.png" alt="" aria-hidden="true" class="dwd-corner dwd-corner--bl" />
      <img src="/images/mandala-top-right.png" alt="" aria-hidden="true" class="dwd-corner dwd-corner--br" />

      <Show when={fireworks}>
        <DiwaliFireworks />
      </Show>
    </>
  );
}
