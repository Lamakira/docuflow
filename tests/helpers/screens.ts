import sharp from "sharp";

/**
 * Synthetic desktop screens for the fingerprint suites (#341): a window layout
 * plus a small clock. Same layout with a different time is the same screen; a
 * different layout is not.
 */
export type ScreenLayout = "editor" | "browser";

export async function screenPng(layout: ScreenLayout, clock = "10:41"): Promise<Buffer> {
  const windows =
    layout === "editor"
      ? `<rect x="0" y="0" width="480" height="720" fill="#1e1e1e"/>
         <rect x="480" y="0" width="800" height="360" fill="#f2f2f2"/>
         <rect x="480" y="360" width="800" height="360" fill="#3b6ea5"/>`
      : `<rect x="0" y="0" width="1280" height="120" fill="#e0e0e0"/>
         <rect x="0" y="120" width="1280" height="600" fill="#ffffff"/>
         <rect x="200" y="300" width="880" height="200" fill="#d94f4f"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <rect width="1280" height="720" fill="#808080"/>${windows}
    <rect x="1190" y="696" width="80" height="18" fill="#000000"/>
    <text x="1196" y="710" font-size="14" fill="#ffffff">${clock}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
