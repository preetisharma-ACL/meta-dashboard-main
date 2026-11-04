import "./diwali-dashboard.css";

// The Diwali greeting artwork (/images/dashboard-diwali-theme.png) across the
// top of the content column: its string lights run through the header, the
// lanterns, "Happy Diwali" and diyas sit behind the page title. The header
// paints the same image slice as its own background, so the two read as one
// picture and the header stays opaque when the page scrolls. Shown only on
// the dashboard in light mode — see diwali-dashboard.css.
export default function DiwaliHero() {
  return <div class="dwd-hero" aria-hidden="true" />;
}
