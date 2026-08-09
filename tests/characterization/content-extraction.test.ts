import { describe, it, expect } from "vitest";
import { extractTextFromFile } from "../../server/contentExtraction";
import { fakeSignedUrl } from "../fakes/gcs";
import { completeUpload } from "../helpers/objects";

/**
 * Characterization: what an uploaded file's text comes out as.
 *
 * This is the path `server/routes.ts` takes after a company-document upload, on
 * its way to the embeddings the document is searched by — storage read, parser,
 * and the shape of the answer. Nothing covered it before #43 moved PDF
 * extraction off `pdf-parse` onto `pdfjs-dist` directly, which is a change to
 * the text itself and not only to what the image installs.
 *
 * The three PDFs are the three outcomes the route distinguishes, and none of
 * them is an exception:
 *  - text comes back with `success: true`
 *  - a page with no text operators is also `success: true`, with an empty
 *    string and a note, because a scan is a document that was uploaded
 *    correctly and the caller must not treat it as a failure
 *  - a file that will not parse is `success: false`, which the caller logs and
 *    carries on from — a throw here would reach an upload handler that has
 *    already replied
 *
 * Fixtures are assembled here rather than checked in: ADR-0018 wants generated
 * or synthetic, and `makePdf` below is a few hundred bytes of PDF syntax with a
 * real xref table, which is enough for a parser to open.
 */

/** A PDF whose objects are numbered in array order, with a real xref table. */
function makePdf(objects: string[]): Buffer {
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
    `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\n` +
    `startxref\n${startxref}\n%%EOF\n`;

  // latin1, not utf8: a PDF's byte offsets are what the xref table above points
  // at, and any multi-byte encoding moves them.
  return Buffer.from(header + body + xref + trailer, "latin1");
}

const stream = (content: string) =>
  `<</Length ${content.length}>>\nstream\n${content}\nendstream`;

/** Two pages of Helvetica, so the page break is observable. */
function textPdf(): Buffer {
  return makePdf([
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R 6 0 R]/Count 2>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    stream("BT /F1 18 Tf 40 700 Td (Hello Techma) Tj 0 -24 Td (second line) Tj ET"),
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 7 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    stream("BT /F1 18 Tf 40 700 Td (Page two body) Tj ET"),
  ]);
}

/**
 * Two columns whose gap is wide enough to read as a column but too narrow for
 * pdfjs to insert a space of its own — the only shape that reaches the tab rule.
 */
function columnsPdf(): Buffer {
  return makePdf([
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    stream("BT /F1 24 Tf 40 700 Td (AA) Tj 20 0 Td (BB) Tj ET"),
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ]);
}

/** A table drawn as one text object, where pdfjs does supply the spacing. */
function tablePdf(): Buffer {
  return makePdf([
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    stream(
      "BT /F1 12 Tf 40 700 Td (Name) Tj 260 0 Td (Role) Tj " +
        "-260 -18 Td (Ada) Tj 260 0 Td (Engineer) Tj ET"
    ),
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ]);
}

/** A valid page that draws a filled rectangle and no text at all — a scan. */
function imageOnlyPdf(): Buffer {
  return makePdf([
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>",
    stream("0.2 0.4 0.9 rg 100 400 300 200 re f"),
  ]);
}

/** The header, then nothing a parser can use: no catalog, no xref to recover. */
function corruptPdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n${"this is not a pdf body at all, not even close\n".repeat(4)}`,
    "latin1"
  );
}

/** Seed the fake bucket and hand back what the route stores as `storagePath`. */
function upload(name: string, body: Buffer, contentType: string): string {
  const url = fakeSignedUrl(`test-bucket/.private/uploads/${name}`);
  completeUpload(url, body, contentType);
  return url;
}

describe("file text extraction (characterization)", () => {
  it("extracts both pages of a text PDF, separated by a blank line", async () => {
    const path = upload("text.pdf", textPdf(), "application/pdf");

    const result = await extractTextFromFile(path, "application/pdf", "text.pdf");

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    // The exact shape, not a `toContain`: this string is what the document is
    // embedded and searched on, so a change to the spacing is a change to the
    // index and should fail here rather than land quietly (#43).
    expect(result.text).toBe("Hello Techma\nsecond line\n\nPage two body");
  });

  it("separates columns pdfjs left no space between with a tab", async () => {
    const path = upload("columns.pdf", columnsPdf(), "application/pdf");

    const result = await extractTextFromFile(path, "application/pdf", "columns.pdf");

    // pdf-parse@2.4.5 returned exactly this. Without the tab rule the two runs
    // arrive as "AABB" — one word that is in neither column.
    expect(result.text).toBe("AA\tBB");
  });

  it("leaves a table alone where pdfjs already spaced it", async () => {
    const path = upload("table.pdf", tablePdf(), "application/pdf");

    const result = await extractTextFromFile(path, "application/pdf", "table.pdf");

    // Also pdf-parse's answer. pdfjs emits a synthetic space item spanning the
    // column gap here, and its width closes the distance the tab rule measures
    // — so the rule correctly does not fire, and the row keeps its space.
    expect(result.text).toBe("Name Role\nAda Engineer");
  });

  it("reports an image-only PDF as extracted-but-empty rather than failed", async () => {
    const path = upload("scan.pdf", imageOnlyPdf(), "application/pdf");

    const result = await extractTextFromFile(path, "application/pdf", "scan.pdf");

    expect(result).toEqual({
      success: true,
      text: "",
      error: "PDF contains no extractable text (may be image-based)",
    });
  });

  it("answers a corrupt PDF with a failed result, not a thrown error", async () => {
    const path = upload("broken.pdf", corruptPdf(), "application/pdf");

    const result = await extractTextFromFile(path, "application/pdf", "broken.pdf");

    expect(result.success).toBe(false);
    expect(result.text).toBe("");
    expect(result.error).toBe("Invalid PDF structure.");
  });

  it("routes on the extension when the browser sends no PDF mime type", async () => {
    // Uploads arrive with whatever the browser guessed, and
    // `isPdfFile` accepts either signal. A PDF sent as a generic blob still
    // reaches the parser.
    const path = upload("guessed.pdf", textPdf(), "application/octet-stream");

    const result = await extractTextFromFile(path, "", "guessed.pdf");

    expect(result.success).toBe(true);
    expect(result.text).toBe("Hello Techma\nsecond line\n\nPage two body");
  });

  it("answers a storage path with no object behind it", async () => {
    const missing = fakeSignedUrl("test-bucket/.private/uploads/never-uploaded.pdf");

    const result = await extractTextFromFile(missing, "application/pdf", "gone.pdf");

    expect(result).toEqual({
      success: false,
      text: "",
      error: "File not found in storage",
    });
  });

  it("reads a plain text upload straight out of the buffer", async () => {
    const path = upload("notes.md", Buffer.from("  # Heading\n\nbody  "), "text/markdown");

    const result = await extractTextFromFile(path, "text/markdown", "notes.md");

    // Trimmed at the ends and nowhere else — the file's own bytes.
    expect(result).toEqual({ success: true, text: "# Heading\n\nbody" });
  });

  it("refuses a type it has no parser for, naming the type", async () => {
    const path = upload("archive.zip", Buffer.from("PK\x03\x04"), "application/zip");

    const result = await extractTextFromFile(path, "application/zip", "archive.zip");

    expect(result).toEqual({
      success: false,
      text: "",
      error: "Unsupported file type: application/zip",
    });
  });
});
