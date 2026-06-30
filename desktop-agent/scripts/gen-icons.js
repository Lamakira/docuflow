/**
 * gen-icons.js — Generate app icons from favicon.svg
 *
 * Outputs:
 *   assets/icon.png  — 256×256 PNG (Linux + generic)
 *   assets/icon.ico  — multi-size ICO (Windows)
 *   assets/icon.icns — multi-size ICNS (macOS) — only on macOS (requires iconutil)
 *
 * Run: node scripts/gen-icons.js
 *
 * On macOS, .icns is generated automatically via macOS built-in iconutil.
 * On Windows/Linux, .icns is skipped — generate it on a Mac or in CI.
 */

const { Resvg } = require('@resvg/resvg-js');
const { default: pngToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const svgPath = path.resolve(ROOT, '../client/public/favicon.svg');
const assetsDir = path.join(ROOT, 'assets');
const outPng = path.join(assetsDir, 'icon.png');
const outIco = path.join(assetsDir, 'icon.ico');
const outIcns = path.join(assetsDir, 'icon.icns');
const outTray = path.join(assetsDir, 'tray-icon.png');

const svgData = fs.readFileSync(svgPath, 'utf8');

// ── PNG 256×256 ──────────────────────────────────────────────────────────────

const resvg = new Resvg(svgData, { fitTo: { mode: 'width', value: 256 } });
const pngData = resvg.render().asPng();
fs.writeFileSync(outPng, pngData);
console.log(`✅ Written: ${outPng} (${pngData.length} bytes)`);

// ── Tray icon 32×32 (transparent) ─────────────────────────────────────────────
// Rendered at 32px (not 16) so the white document glyph survives — a 16×16 render
// collapsed the 1.5px strokes into a flat blue square (Ubuntu top-bar bug).
// macOS resizes this to 16×16 at runtime (see createTray in main/index.ts).
const trayResvg = new Resvg(svgData, { fitTo: { mode: 'width', value: 32 } });
const trayPng = trayResvg.render().asPng();
fs.writeFileSync(outTray, trayPng);
console.log(`✅ Written: ${outTray} (${trayPng.length} bytes)`);

// ── ICO (Windows) ────────────────────────────────────────────────────────────

pngToIco([outPng])
  .then((icoData) => {
    fs.writeFileSync(outIco, icoData);
    console.log(`✅ Written: ${outIco} (${icoData.length} bytes)`);
  })
  .catch((err) => {
    console.error('❌ ICO generation failed:', err);
    process.exit(1);
  });

// ── ICNS (macOS) — requires macOS iconutil ───────────────────────────────────
// iconutil is a macOS built-in tool. This block is skipped on Windows/Linux.
// To generate .icns outside macOS, run this script on a Mac or in a macOS CI runner.

if (process.platform === 'darwin') {
  try {
    console.log('\n[gen-icons] Generating .icns (macOS iconutil)...');

    // ICNS requires a set of sizes in an .iconset folder
    const iconsetDir = path.join(os.tmpdir(), 'docuflow.iconset');
    fs.mkdirSync(iconsetDir, { recursive: true });

    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    for (const size of sizes) {
      const r = new Resvg(svgData, { fitTo: { mode: 'width', value: size } });
      const buf = r.render().asPng();
      // Standard Apple naming: icon_NxN.png + icon_NxN@2x.png (= size/2 × 2)
      fs.writeFileSync(path.join(iconsetDir, `icon_${size}x${size}.png`), buf);
      if (size >= 32) {
        const half = size / 2;
        fs.writeFileSync(path.join(iconsetDir, `icon_${half}x${half}@2x.png`), buf);
      }
    }

    execSync(`iconutil -c icns "${iconsetDir}" -o "${outIcns}"`);
    fs.rmSync(iconsetDir, { recursive: true, force: true });

    const icnsSize = fs.statSync(outIcns).size;
    console.log(`✅ Written: ${outIcns} (${icnsSize} bytes)`);
  } catch (err) {
    console.error('❌ ICNS generation failed:', err.message);
    console.error('   Ensure iconutil is available (Xcode Command Line Tools).');
    process.exit(1);
  }
} else {
  console.log('\n[gen-icons] Skipping .icns — not on macOS.');
  console.log('   Run this script on a Mac (or macOS CI) to generate assets/icon.icns.');
  console.log('   The macOS build will use a default icon without it.');
}
