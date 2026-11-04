import "./diwali-dashboard.css";

// The Diwali greeting artwork (/images/dashboard-diwali-theme.png) across the
// top of the content column, just under the header: lanterns, "Happy Diwali"
// and diyas behind the page title. Shown only on the dashboard (light and dark
// mode; dark swaps in a keyed copy of the artwork) — see diwali-dashboard.css.
export default function DiwaliHero() {
  return <div class="dwd-hero" aria-hidden="true" />;
}
