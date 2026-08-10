/**
 * Generated PDFs, for suites that need a file a parser will actually open.
 *
 * Assembled rather than checked in: a real PDF is someone's document, and a few
 * hundred bytes with a real xref table is all `unpdf` needs. Shared because
 * three places were building the same header/offsets/trailer by hand — here,
 * `tests/characterization/content-extraction.test.ts`, and the "PDF text
 * extracts inside the image" step in `.github/workflows/ci.yml`, which cannot
 * import this and says so.
 */

/** A PDF whose objects are numbered in array order, with a real xref table. */
export function makePdf(objects: string[], trailerExtra = ""): Buffer {
  const header = "%PDF-1.4\n";
  const offsets: number[] = [];
  let body = "";
  objects.forEach((object, index) => {
    offsets.push(header.length + body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const startxref = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer\n<</Size ${objects.length + 1}/Root 1 0 R${trailerExtra}>>\n` +
    `startxref\n${startxref}\n%%EOF\n`;

  // latin1, not utf8: a PDF's byte offsets are what the xref table above points
  // at, and any multi-byte encoding moves them. Every fixture built here is
  // ASCII, so the two agree today — the encoding is named so that a fixture
  // with an accent in it does not silently break the table.
  return Buffer.from(header + body + xref + trailer, "latin1");
}

/** A content stream object with its `/Length` filled in. */
export const stream = (content: string) =>
  `<</Length ${content.length}>>\nstream\n${content}\nendstream`;

/** One Helvetica page drawing `content`. */
export function pageOf(content: string): Buffer {
  return makePdf([
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    stream(content),
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ]);
}

/** One page saying `words`, at 18pt. */
export function pdfSaying(words: string): Buffer {
  return pageOf(`BT /F1 18 Tf 40 700 Td (${words}) Tj ET`);
}
