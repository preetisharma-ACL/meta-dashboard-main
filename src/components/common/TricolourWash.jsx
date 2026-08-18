// ─── Tricolour ambience ───────────────────────────────────────────────────────
// The app-wide tiranga-inspired backdrop: corner glows in marigold / emerald /
// navy over a faint diagonal veil. One element, decorative and inert
// (aria-hidden, plus pointer-events:none in the CSS), so it isn't reachable by
// keyboard, a screen reader, or a click.
//
// Mounted ONCE, at the router root, which is why it reaches every page —
// including /login and the public intro, which render outside the app Layout.
// Removing the theme is deleting this one element from App.jsx; the styles live
// in index.css under "Tricolour ambience".
export default function TricolourWash() {
  return <div class="tricolour-wash" aria-hidden="true" />;
}
