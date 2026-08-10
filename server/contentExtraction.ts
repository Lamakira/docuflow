import mammoth from "mammoth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

type Unpdf = typeof import("unpdf");
type PdfDocument = Awaited<ReturnType<Unpdf["getDocumentProxy"]>>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

let unpdf: Unpdf | null = null;

/**
 * The PDF parser, imported on the first PDF rather than at load.
 *
 * Lazy so that boot does not pay for it. Staying out of `dist/index.cjs` is a
 * different decision and not this line's doing: `script/bundles.ts` inlines a
 * short allowlist and marks every other package external, and `unpdf` is not on
 * the allowlist (#36).
 *
 * **Why not pdfjs-dist, which the client is already built from.** #43 set out
 * to share that one copy and measured the result instead: pdfjs-dist's Node
 * build evaluates `new DOMMatrix()` at module scope, so with no
 * `@napi-rs/canvas` to borrow one from, `import("pdfjs-dist")` throws
 * `ReferenceError: DOMMatrix is not defined` before any call is made. That is a
 * load failure, not the request-time failure it was first written up as — the
 * legacy build fails the same way, one warning earlier. The package it wants is
 * 61 MB of Skia for rendering this server never asks for, so depending on
 * pdfjs-dist directly would have carried the same binary and saved 17 MB of 259.
 *
 * That canvas is most of why `pdf-parse` was 115 MB, but not all of it, and the
 * arithmetic is worth keeping straight: the copy nested under pdf-parse was
 * 58 MB, its nested `pdfjs-dist` 37 MB, and pdf-parse's own `dist/` — largely a
 * third bundled copy of pdfjs, `pdf.worker.mjs` and its source map — the
 * remaining 20 MB.
 *
 * `unpdf` is pdfjs with that dependency built out: 2.6 MB, no dependencies of
 * its own, `@napi-rs/canvas` only an optional peer for the image renderer
 * nothing here calls, and a `DOMMatrix` polyfill of its own, which is why the
 * load above cannot happen here. `pdfjs-dist` stays a devDependency for the
 * client's viewer (`client/src/pages/FileViewerPage.tsx`), which runs in a
 * browser that has a `DOMMatrix`.
 */
async function getUnpdf(): Promise<Unpdf> {
  if (!unpdf) {
    unpdf = await import("unpdf");
  }
  return unpdf;
}

export interface ContentExtractionResult {
  success: boolean;
  text: string;
  error?: string;
}

export async function extractTextFromFile(
  storagePath: string,
  mimeType: string,
  fileName: string
): Promise<ContentExtractionResult> {
  const objectStorageService = new ObjectStorageService();
  
  try {
    const normalizedPath = objectStorageService.normalizeObjectEntityPath(storagePath);
    const objectFile = await objectStorageService.getObjectEntityFile(normalizedPath);
    
    const chunks: Buffer[] = [];
    const stream = objectFile.createReadStream();
    
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    
    const buffer = Buffer.concat(chunks);
    
    if (isPdfFile(mimeType, fileName)) {
      return await extractTextFromPdf(buffer);
    } else if (isWordFile(mimeType, fileName)) {
      return await extractTextFromWord(buffer);
    } else if (isTextFile(mimeType, fileName)) {
      return await extractTextFromTextFile(buffer);
    } else {
      return {
        success: false,
        text: "",
        error: `Unsupported file type: ${mimeType || fileName}`
      };
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return {
        success: false,
        text: "",
        error: "File not found in storage"
      };
    }
    console.error("Error extracting text from file:", error);
    return {
      success: false,
      text: "",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

function isPdfFile(mimeType: string, fileName: string): boolean {
  return mimeType === 'application/pdf' || fileName?.toLowerCase().endsWith('.pdf');
}

function isWordFile(mimeType: string, fileName: string): boolean {
  return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
         mimeType === 'application/msword' ||
         fileName?.toLowerCase().endsWith('.docx') ||
         fileName?.toLowerCase().endsWith('.doc');
}

function isTextFile(mimeType: string, fileName: string): boolean {
  const textMimeTypes = [
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/html',
    'text/xml',
    'application/json',
    'application/xml'
  ];
  
  const textExtensions = ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.log', '.yaml', '.yml'];
  
  return textMimeTypes.includes(mimeType) || 
         textExtensions.some(ext => fileName?.toLowerCase().endsWith(ext));
}

export function isVideoFile(mimeType: string, fileName: string): boolean {
  const videoMimeTypes = [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-ms-wmv'
  ];
  
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.wmv', '.mkv'];
  
  return videoMimeTypes.includes(mimeType) || 
         videoExtensions.some(ext => fileName?.toLowerCase().endsWith(ext));
}

/**
 * pdf-parse's text-assembly defaults, kept when #43 replaced it.
 *
 * All four are `setDefaultParseParameters`' values in pdf-parse@2.4.5, under
 * that file's names so the correspondence stays auditable: nothing here derives
 * them. The reason to keep the numbers rather than pick rounder ones is that
 * every document already in the index was embedded on the text they produce,
 * and an uploaded document is re-extracted when it is renamed or when
 * `POST /api/embeddings/rebuild` runs — so changing one re-shapes searchable
 * content that already exists.
 *
 * How far that reaches is worth knowing: `chunkText` in `server/embeddings.ts`
 * returns short documents whole and splits longer ones on `/\s+/`, rejoining
 * with single spaces. So tabs and page breaks survive into the index for a
 * document under the chunker's 800-character threshold and are collapsed above
 * it. The rules below still decide word boundaries either way — `AA\tBB` and
 * `AABB` are different tokens after the collapse — but the whitespace itself
 * only matters for the short half.
 */

/** `lineThreshold`: vertical distance, in viewport units, within which two items are one line. */
const LINE_GAP = 4.6;

/** `cellThreshold`: horizontal distance between two items on one line that reads as a cell boundary. */
const CELL_SEPARATOR_GAP = 7;

/** `cellSeparator`: what goes between two items that far apart. */
const CELL_SEPARATOR = "\t";

/** `pageJoiner`, set empty: a blank line between pages, and no page marker in the text. */
const PAGE_JOINER = "\n\n";

/**
 * One page's text, assembled the way pdf-parse assembled it.
 *
 * `getTextContent()` hands back positioned runs, not lines: a PDF has no
 * paragraphs, so where the breaks go is a decision, and the decision pdf-parse
 * made is what every embedding already in the database was computed over. Three
 * rules carry it, in pdf-parse's own order — its `lineEnforce` newline, then the
 * cell tab, then a newline for each item flagged `hasEOL`.
 *
 * **The line rule was dropped once and is back.** #43 first left it out on a
 * measurement saying it could not fire: pdfjs sets `hasEOL` on a vertical
 * change, so the previous item has already appended a newline and pdf-parse's
 * own guard declines. That holds for every layout that moves the line — `Td`,
 * `TD`, `Tm`, `T*`, `'` — 0 firings across 1008 generated pages. It does not
 * hold for `Ts`, the text-rise operator, which moves the baseline without
 * moving the line: pdfjs leaves `hasEOL` false, and pdf-parse emits a newline
 * wherever the rise clears the tallest glyph seen so far (measured: rise >
 * font size + 1). A superscript footnote marker is what LaTeX and Word emit, so
 * `(Result) Tj 8 Ts (2) Tj` is an ordinary document rather than a corner case:
 * without the rule it indexes as `Result2`, with it as `Result\n2`. The blind
 * spot was in the sample, not the reasoning — every shape measured varied the
 * line and none varied the rise.
 *
 * **The tab rule fires on distance, not on a gap.** pdfjs closes every positive
 * gap it leaves, either by merging two runs or by emitting a synthetic space
 * item whose width spans the gap exactly; measured over 1224 two-run layouts,
 * the rule fired 134 times and not once on a positive gap. What reaches it is
 * `Math.abs` over *backwards* motion — a run that starts behind where the
 * previous one ended, which is how a narrow-advance column reads. That is
 * pdf-parse's behaviour and the reason the tab lands where it does.
 *
 * `lineHeight` accumulates across the page and is reset only by the line rule,
 * never by a `hasEOL` newline. Also pdf-parse's, also load-bearing.
 */
async function extractPageText(page: PdfPage): Promise<string> {
  const viewport = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();

  const parts: string[] = [];
  let lastX: number | undefined;
  let lastY: number | undefined;
  let lineHeight = 0;

  for (const item of items) {
    if (!("str" in item)) continue;

    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const yStep = lastY === undefined ? 0 : Math.abs(lastY - y);

    if (lastY !== undefined && yStep > LINE_GAP) {
      const previous = parts.length ? parts[parts.length - 1] : undefined;
      const alreadyBreaking = item.str.startsWith("\n") || (item.str.trim() === "" && item.hasEOL);
      if (previous?.endsWith("\n") === false && !alreadyBreaking && yStep - 1 > lineHeight) {
        parts.push("\n");
        lineHeight = 0;
      }
    }

    const sameLine = lastY !== undefined && yStep < LINE_GAP;
    const cellGap = lastX !== undefined && Math.abs(lastX - x) > CELL_SEPARATOR_GAP;
    parts.push(sameLine && cellGap ? `${CELL_SEPARATOR}${item.str}` : item.str);

    lastX = x + item.width;
    lastY = y;
    lineHeight = Math.max(lineHeight, item.height);

    if (item.hasEOL) parts.push("\n");
  }

  return parts.join("");
}

async function extractTextFromPdf(buffer: Buffer): Promise<ContentExtractionResult> {
  let doc: PdfDocument | undefined;

  try {
    const { getDocumentProxy, getResolvedPDFJS } = await getUnpdf();
    const { VerbosityLevel } = await getResolvedPDFJS();
    doc = await getDocumentProxy(new Uint8Array(buffer), {
      // pdf-parse's default, kept for the same reason as the constants above.
      // Measured, what it silences is one "Indexing all PDF objects" line per
      // damaged file, for a result the caller already reports — a scan logs
      // nothing at either level, and there is no per-page font warning here to
      // suppress.
      verbosity: VerbosityLevel.ERRORS,
    });

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      pages.push(await extractPageText(page));
      page.cleanup();
    }

    // A blank line between pages, and nothing else. pdf-parse's `pageJoiner`
    // defaulted to appending "-- 1 of 12 --" after every one; that text becomes
    // the document's searchable content, so the marker would be indexed as if
    // the document said it. The call site passed `pageJoiner: ""` to reach this
    // same branch.
    const text = pages.join(PAGE_JOINER).trim();

    if (!text) {
      return {
        success: true,
        text: "",
        error: "PDF contains no extractable text (may be image-based)"
      };
    }
    
    return {
      success: true,
      text: text
    };
  } catch (error) {
    console.error("Error parsing PDF:", error);
    return {
      success: false,
      text: "",
      error: error instanceof Error ? error.message : "Failed to parse PDF"
    };
  } finally {
    // Releases the document's buffers, which a document left undestroyed holds
    // for the life of the process — measured at 2.4x heap over 300 documents.
    // Cleanup failing is not the caller's problem and must not replace the
    // answer above.
    //
    // Not "releases the worker": unpdf runs pdfjs over a `LoopbackPort` in this
    // same process, so there is no thread and no open handle to leak either
    // way, and the process exits without this line.
    //
    // Through the loading task, not the document: pdf.js 6 removed
    // `PDFDocumentProxy.destroy()` — present in the 5.4.x the client is built
    // from, absent from the 6.1.x unpdf bundles — so `doc.destroy?.()` would be
    // a silent no-op rather than a careful version of this line.
    await doc?.loadingTask.destroy().catch(() => {});
  }
}

async function extractTextFromWord(buffer: Buffer): Promise<ContentExtractionResult> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value?.trim() || "";
    
    return {
      success: true,
      text: text
    };
  } catch (error) {
    console.error("Error parsing Word document:", error);
    return {
      success: false,
      text: "",
      error: error instanceof Error ? error.message : "Failed to parse Word document"
    };
  }
}

async function extractTextFromTextFile(buffer: Buffer): Promise<ContentExtractionResult> {
  try {
    const text = buffer.toString('utf-8').trim();
    
    return {
      success: true,
      text: text
    };
  } catch (error) {
    console.error("Error reading text file:", error);
    return {
      success: false,
      text: "",
      error: error instanceof Error ? error.message : "Failed to read text file"
    };
  }
}

export function isSupportedForExtraction(mimeType: string, fileName: string): boolean {
  return isPdfFile(mimeType, fileName) || 
         isWordFile(mimeType, fileName) || 
         isTextFile(mimeType, fileName);
}
