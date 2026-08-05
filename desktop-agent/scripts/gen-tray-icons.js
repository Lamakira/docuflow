/**
 * gen-tray-icons.js — Generate the tray icon and its status variants.
 *
 * Outputs (32×32 PNG, assets/):
 *   tray-icon.png          — no timer running
 *   tray-icon-running.png  — blue badge
 *   tray-icon-paused.png   — marigold badge
 *
 * Run: node scripts/gen-tray-icons.js
 *
 * The tray is often the only visible part of the app, so it has to answer
 * "am I tracking?" without opening a window. A single static icon cannot.
 *
 * GLYPH — Heroicons `clock` (solid), MIT licensed, vendored below rather than
 * fetched at build time so the build stays offline. Solid, not outline: at the
 * 16px macOS menu-bar size hairline strokes turn to mush.
 *
 * COLOUR — the whole tile carries the state, not a corner badge. A badge was
 * tried first and failed the only test that matters: at the 16px menu-bar size
 * a blue dot on a blue tile is indistinguishable from no dot at all. Recolouring
 * the tile changes the icon's overall value, which survives downscaling.
 *
 * Traffic-light, matching the app: green recording, amber paused, red stopped.
 * Marigold is light, so the paused glyph is ink rather than white — white on
 * marigold fails contrast.
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.resolve(__dirname, '..');
const assetsDir = path.join(ROOT, 'assets');

/** Heroicons 2.1.5 — 24/solid/clock.svg (MIT, github.com/tailwindlabs/heroicons) */
const CLOCK_PATH =
  'M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 ' +
  '9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 ' +
  '0 0 0 0-1.5h-3.75V6Z';

const STATES = {
  '':         { tile: '#f64932', glyph: '#ffffff' },  // stopped — coral
  '-running': { tile: '#12805a', glyph: '#ffffff' },  // recording — green
  '-paused':  { tile: '#ffb110', glyph: '#0f1524' },  // paused — marigold
};

/**
 * The glyph sits on a rounded tile so the mark keeps a silhouette on busy
 * wallpapers — Linux and Windows trays sit over arbitrary backgrounds.
 */
function trayIcon({ tile, glyph }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${tile}"/>
  <g transform="translate(5.5 5.5) scale(0.875)" fill="${glyph}">
    <path fill-rule="evenodd" clip-rule="evenodd" d="${CLOCK_PATH}"/>
  </g>
</svg>`;
}

for (const [suffix, spec] of Object.entries(STATES)) {
  const png = new Resvg(trayIcon(spec), { fitTo: { mode: 'width', value: 32 } })
    .render()
    .asPng();
  const out = path.join(assetsDir, `tray-icon${suffix}.png`);
  fs.writeFileSync(out, png);
  console.log(`✅ Written: ${path.relative(ROOT, out)} (${png.length} bytes)`);
}
