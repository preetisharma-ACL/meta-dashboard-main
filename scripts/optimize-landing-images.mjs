/* ─── Landing page screenshot optimiser ───────────────────────────────────────
 * Re-run this whenever a screenshot in /public/images is replaced:
 *
 *     node scripts/optimize-landing-images.mjs
 *
 * It writes a .webp next to each .png and prints the new intrinsic dimensions.
 * ReportingIntro.jsx points at the .webp files and carries those dimensions as
 * width/height attributes, so if a number below changes, change it there too —
 * they're what reserves the image's box before it loads, which is the whole
 * reason the page doesn't shift as you scroll.
 *
 * Why: these were 1.5 MB of PNG, at up to 1900px wide, dropped into boxes as
 * narrow as 360px. Chrome's lazy-loading fetches far enough ahead that you
 * never notice; Safari's lookahead is much tighter, so on a phone you scrolled
 * into empty wells and watched them fill. Smaller files fix that at the source.
 *
 * The PNGs are deliberately left in place — they're the editable originals.
 * Nothing in the app references them any more.
 * ──────────────────────────────────────────────────────────────────────────── */
import sharp from 'sharp';
import { statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/images',
);

/* Target width = the widest CSS box the image is ever displayed in, doubled so
   it still looks sharp on a 2x screen. Anything past that is bytes the visitor
   pays for and cannot see. */
const JOBS = [
  // Hero showcase — 1080px container
  ['dashboard1.png', 2160],
  ['dashboard2.png', 2160],
  ['dashboard3.png', 2160],
  ['reporting-dashboard4.png', 2160],
  // Feature cards — ~360px column in the 3-up grid
  ['app-client-portal.png', 760],
  ['app-billing.png', 760],
  ['reporting-dashboard8.png', 760],
  // Bento cards
  ['project-brief.png', 1400],
  ['budget.png', 1100],
  ['campns.png', 1400],
];

let before = 0;
let after = 0;

for (const [file, maxW] of JOBS) {
  const src = path.join(DIR, file);
  const out = src.replace(/\.png$/, '.webp');
  const meta = await sharp(src).metadata();

  const info = await sharp(src)
    .resize({ width: Math.min(meta.width, maxW), withoutEnlargement: true })
    .webp({ quality: 80, effort: 6 })
    .toFile(out);

  const inBytes = statSync(src).size;
  before += inBytes;
  after += info.size;

  console.log(
    file.padEnd(28),
    `${meta.width}x${meta.height} ${(inBytes / 1024).toFixed(0)}KB`.padEnd(22),
    '->',
    `${info.width}x${info.height} ${(info.size / 1024).toFixed(0)}KB`,
  );
}

console.log(
  `\nTOTAL  ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB` +
  `  (${(100 - (after / before) * 100).toFixed(0)}% smaller)`,
);
