/**
 * gen-icons.js — Generate icon.png (256x256) and icon.ico from favicon.svg
 * Run: node scripts/gen-icons.js
 */

const { Resvg } = require('@resvg/resvg-js');
const { default: pngToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const svgPath = path.resolve(ROOT, '../client/public/favicon.svg');
const outPng = path.join(ROOT, 'assets', 'icon.png');
const outIco = path.join(ROOT, 'assets', 'icon.ico');

const svgData = fs.readFileSync(svgPath, 'utf8');

// Render at 256x256
const resvg = new Resvg(svgData, {
  fitTo: { mode: 'width', value: 256 },
});
const pngData = resvg.render().asPng();
fs.writeFileSync(outPng, pngData);
console.log(`✅ Written: ${outPng} (${pngData.length} bytes)`);

// Convert PNG → ICO
pngToIco([outPng])
  .then((icoData) => {
    fs.writeFileSync(outIco, icoData);
    console.log(`✅ Written: ${outIco} (${icoData.length} bytes)`);
  })
  .catch((err) => {
    console.error('❌ ICO generation failed:', err);
    process.exit(1);
  });
