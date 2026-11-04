import "./diwali-dashboard.css";

// Sidebar pieces of the dashboard's Diwali theme: a mandala quarter in the top
// corner, and the diyas-and-waves artwork (/images/bottom-sidebar-theme.png)
// as a band just above the footer. Hidden unless the theme is on — see
// diwali-dashboard.css.

export function SideMandalas() {
  return (
    <img src="/images/mandala-top-right.png" alt="" aria-hidden="true" class="dwd-side-mandala dwd-side-mandala--tl" />
  );
}

export function SideArt() {
  return <div class="dwd-side-art" aria-hidden="true" />;
}
