import { describe, it, expect, beforeAll } from "vitest";
import { fakeSignedUrl } from "../fakes/gcs";
import { completeUpload } from "../helpers/objects";
import { makePdf, pageOf, stream } from "../helpers/pdf";

/**
 * Characterization: what an uploaded file's text comes out as.
 *
 * This is the path `server/routes.ts` takes after a company-document upload, on
 * its way to the embeddings the document is searched by — storage read, parser,
 * and the shape of the answer. Nothing covered it before #43 moved PDF
 * extraction off `pdf-parse` onto `unpdf`, which is a change to the text itself
 * and not only to what the image installs. (Not onto `pdfjs-dist` directly,
 * which is what the ticket proposed and what measuring it ruled out — see
 * `server/contentExtraction.ts`.)
 *
 * Four outcomes the route distinguishes, none of them an exception:
 *  - text comes back with `success: true`
 *  - a page with no text operators is also `success: true`, with an empty
 *    string and a note, because a scan is a document that was uploaded
 *    correctly and the caller must not treat it as a failure
 *  - a file that will not parse is `success: false`, which the caller logs and
 *    carries on from
 *  - so is one that will not open without a password
 *
 * The result shape is what carries all four. The create route runs extraction
 * inside an unawaited async function with a `catch` of its own
 * (`server/routes.ts:2393`), so a throw would not reach the client either — it
 * would be logged and the document would stay in the index with no text at all,
 * indistinguishable from a scan.
 *
 * Fixtures are generated rather than checked in — see `tests/helpers/pdf.ts`
 * for why and for the builders; the ones below are the shapes only this suite
 * needs.
 */

let extractTextFromFile: typeof import("../../server/contentExtraction").extractTextFromFile;

// Dynamically, never at the top level: `tests/setup.ts` fixes the environment
// before any server module loads, and `server/contentExtraction.ts` reaches
// `server/objectStorage.ts` at import.
beforeAll(async () => {
  ({ extractTextFromFile } = await import("../../server/contentExtraction"));
});

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
 * Two runs whose advance is narrower than the glyphs they draw, so the second
 * starts 12 units *behind* where the first ended.
 *
 * That backwards step, not a gap, is what reaches the tab rule: pdfjs closes
 * every positive gap it leaves, either by merging the runs or by emitting a
 * synthetic space item that spans the distance exactly.
 */
function columnsPdf(): Buffer {
  return pageOf("BT /F1 24 Tf 40 700 Td (AA) Tj 20 0 Td (BB) Tj ET");
}

/** A table drawn as one text object, where pdfjs does supply the spacing. */
function tablePdf(): Buffer {
  return pageOf(
    "BT /F1 12 Tf 40 700 Td (Name) Tj 260 0 Td (Role) Tj " +
      "-260 -18 Td (Ada) Tj 260 0 Td (Engineer) Tj ET"
  );
}

/**
 * A superscript footnote marker, drawn with the text-rise operator.
 *
 * `Ts` moves the baseline without moving the line, so pdfjs leaves `hasEOL`
 * false and the line rule's guard does not decline — the one shape in which
 * pdf-parse's third rule fires. #43 first shipped without that rule on a
 * measurement that had varied everything except the rise.
 */
function superscriptPdf(): Buffer {
  return pageOf("BT /F1 6 Tf 40 700 Td (Result) Tj 8 Ts (2) Tj 0 Ts ( per litre) Tj ET");
}

/**
 * Two runs on one line, `gap` units of backwards step apart.
 *
 * "AA" at 12 pt is 16.01 wide, so an advance of `n` leaves `16.01 - n` between
 * the previous run's end and this one's start — which is what CELL_SEPARATOR_GAP
 * is compared against.
 */
function cellGapPdf(advance: number): Buffer {
  return pageOf(`BT /F1 12 Tf 40 700 Td (AA) Tj ${advance} 0 Td (BB) Tj ET`);
}

/** The same two runs, `drop` units apart vertically, to straddle LINE_GAP. */
function lineGapPdf(drop: number): Buffer {
  return pageOf(`BT /F1 12 Tf 40 700 Td (AA) Tj 8 -${drop} Td (BB) Tj ET`);
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

/** Password-protected: a standard security handler the parser cannot unlock. */
function encryptedPdf(): Buffer {
  const content = "BT /F1 18 Tf 40 700 Td (secret) Tj ET";
  return makePdf(
    [
      "<</Type/Catalog/Pages 2 0 R>>",
      "<</Type/Pages/Kids[3 0 R]/Count 1>>",
      "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
      stream(content),
      "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
      `<</Filter/Standard/V 1/R 2/O <${"AB".repeat(32)}>/U <${"CD".repeat(32)}>/P -1>>`,
    ],
    "/Encrypt 6 0 R/ID[<0102030405060708090A0B0C0D0E0F10><0102030405060708090A0B0C0D0E0F10>]"
  );
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

  it("separates two runs that overlap backwards with a tab", async () => {
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

  it("breaks the line at a superscript, the way pdf-parse did", async () => {
    const path = upload("footnote.pdf", superscriptPdf(), "application/pdf");

    const result = await extractTextFromFile(path, "application/pdf", "footnote.pdf");

    // pdf-parse@2.4.5's answer, rise up and rise back down. Without the line
    // rule this is "Result2 per litre" — the marker fused into the words on
    // either side of it, indexed as a token no one will search for.
    expect(result.text).toBe("Result\n2 \nper litre");
  });

  it("pins CELL_SEPARATOR_GAP: 8.01 units apart tabs, 6.01 does not", async () => {
    // The constant is 7 and inherited from pdf-parse, so the suite has to fail
    // if it drifts — not merely if it is deleted. These two straddle it by one
    // unit on each side.
    const wide = upload("wide.pdf", cellGapPdf(8), "application/pdf");
    const narrow = upload("narrow.pdf", cellGapPdf(10), "application/pdf");

    expect((await extractTextFromFile(wide, "application/pdf", "wide.pdf")).text).toBe("AA\tBB");
    expect((await extractTextFromFile(narrow, "application/pdf", "narrow.pdf")).text).toBe("AABB");
  });

  it("pins LINE_GAP: 4 units below is one line, 5.2 is not", async () => {
    // Same idea for the other inherited constant, 4.6. Under it the two runs
    // are one line and the tab rule applies; over it they are not, and the line
    // rule still declines because the step is shorter than the glyphs.
    const together = upload("same-line.pdf", lineGapPdf(4), "application/pdf");
    const apart = upload("next-line.pdf", lineGapPdf(5.2), "application/pdf");

    expect((await extractTextFromFile(together, "application/pdf", "same-line.pdf")).text).toBe("AA\tBB");
    expect((await extractTextFromFile(apart, "application/pdf", "next-line.pdf")).text).toBe("AABB");
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
    // The parser's own words, relayed rather than replaced. Matched loosely
    // because the string is pdfjs's and moves with it; that it is non-empty and
    // reaches the caller is the contract.
    expect(result.error).toMatch(/invalid pdf/i);
  });

  it("answers a password-protected PDF with a failed result too", async () => {
    const path = upload("locked.pdf", encryptedPdf(), "application/pdf");

    const result = await extractTextFromFile(path, "application/pdf", "locked.pdf");

    // pdfjs raises PasswordException before any page is reached. It must land
    // as a result, not an exception: an encrypted upload is a document someone
    // meant to send, and the route logs it and carries on.
    expect(result.success).toBe(false);
    expect(result.text).toBe("");
    expect(result.error).toMatch(/password/i);
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
