/**
 * brand-assets.ts — npm run brand:assets
 *
 * Renders every raster the product ships from the hand-written SVG sources in
 * brand/. Output is deterministic for a given sharp/libvips build: sharp writes
 * no timestamps or metadata and the ICO and ICNS containers are assembled here,
 * so re-running gives identical bytes. A different libvips (package.json allows
 * sharp ^0.34.5) may encode PNGs differently; regenerate and commit then.
 *
 *   client/public      favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png,
 *                      icon-192.png, icon-512.png
 *   desktop-agent/assets  icon.png (512), icon.ico (16…256), icon.icns,
 *                      tray-icon.png / -running / -paused (32×32)
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = join(ROOT, "brand");
const WEB = join(ROOT, "client/public");
const AGENT = join(ROOT, "desktop-agent/assets");

/** An SVG source and the side of its viewBox grid. */
type Source = { file: string; grid: number };

const TILE: Source = { file: "mark-tile.svg", grid: 64 };
// 16 px has its own pixel-aligned source: the 64-grid mark smears to mush there.
const TILE_16: Source = { file: "mark-tile-16.svg", grid: 16 };

const tileFor = (size: number): Source => (size === 16 ? TILE_16 : TILE);

async function png({ file, grid }: Source, size: number): Promise<Buffer> {
  const svg = readFileSync(join(BRAND, file));
  // Rasterise at the target size (density scales the viewBox grid), not
  // rendered large and shrunk, so thin edges stay crisp at small sizes.
  return sharp(svg, { density: (72 * size) / grid })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** ICO container with PNG payloads: ICONDIR, one ICONDIRENTRY per size, then the PNGs. */
function buildIco(entries: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = entries.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

/** ICNS container with PNG payloads (ic07 128, ic08 256, ic09 512, ic10 1024). */
function buildIcns(entries: { type: string; data: Buffer }[]): Buffer {
  const chunks = entries.map(({ type, data }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([h, data]);
  });
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const h = Buffer.alloc(8);
  h.write("icns", 0, "ascii");
  h.writeUInt32BE(total, 4);
  return Buffer.concat([h, ...chunks]);
}

async function main() {
  mkdirSync(WEB, { recursive: true });
  mkdirSync(AGENT, { recursive: true });

  const tile512 = await png(TILE, 512);
  const tiles = (sizes: number[]) =>
    Promise.all(sizes.map(async (size) => ({ size, data: await png(tileFor(size), size) })));

  // Web
  copyFileSync(join(BRAND, TILE.file), join(WEB, "favicon.svg"));
  writeFileSync(join(WEB, "favicon.ico"), buildIco(await tiles([16, 32, 48])));
  writeFileSync(join(WEB, "apple-touch-icon.png"), await png(TILE, 180));
  writeFileSync(join(WEB, "icon-192.png"), await png(TILE, 192));
  writeFileSync(join(WEB, "icon-512.png"), tile512);

  // Desktop agent
  writeFileSync(join(AGENT, "icon.png"), tile512);
  writeFileSync(join(AGENT, "icon.ico"), buildIco(await tiles([16, 32, 48, 64, 128, 256])));
  writeFileSync(
    join(AGENT, "icon.icns"),
    buildIcns([
      { type: "ic07", data: await png(TILE, 128) },
      { type: "ic08", data: await png(TILE, 256) },
      { type: "ic09", data: tile512 },
      { type: "ic10", data: await png(TILE, 1024) },
    ]),
  );
  // Tray: one 32x32 PNG per state. macOS resizes it to 16 at runtime
  // (loadTrayImage in desktop-agent/src/main/index.ts), there is no @2x, and it
  // is not a macOS template image because the status dot carries colour.
  const tray = (file: string): Source => ({ file, grid: 64 });
  writeFileSync(join(AGENT, "tray-icon.png"), await png(tray("tray-idle.svg"), 32));
  writeFileSync(join(AGENT, "tray-icon-running.png"), await png(tray("tray-running.svg"), 32));
  writeFileSync(join(AGENT, "tray-icon-paused.png"), await png(tray("tray-paused.svg"), 32));
  console.log("brand assets written");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
