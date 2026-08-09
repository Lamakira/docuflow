import mammoth from "mammoth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

type Unpdf = typeof import("unpdf");
type PdfDocument = Awaited<ReturnType<Unpdf["getDocumentProxy"]>>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

let unpdf: Unpdf | null = null;

/**
 * The PDF parser, imported on the first PDF rather than at load.
 *
 * The import stays lazy for two reasons: boot does not pay for it, and the
 * specifier is a string literal esbuild can see, so `script/bundles.ts` leaves
 * the package external instead of inlining it into `dist/index.cjs` (#36).
 *
 * **Why not pdfjs-dist, which the client is already built from.** #43 set out
 * to share that one copy and measured the result instead: pdfjs-dist's Node
 * build has no `DOMMatrix`, so it reaches for `@napi-rs/canvas` to borrow one,
 * and `getTextContent()` throws `ReferenceError: DOMMatrix is not defined`
 * without it. That package is 61 MB of Skia for rendering this server never
 * asks for, and it is why `pdf-parse` was 115 MB — not the vendored pdfjs-dist
 * the ticket blamed, which was only a third of it. Depending on pdfjs-dist
 * directly would have carried the same binary and saved 17 MB of 259.
 *
 * `unpdf` is pdfjs with that dependency built out: 2.6 MB, no dependencies of
 * its own, and `@napi-rs/canvas` only an optional peer for the image renderer
 * nothing here calls. `pdfjs-dist` stays a devDependency for the client's
 * viewer (`client/src/pages/FileViewerPage.tsx`), which runs in a browser that
 * has a `DOMMatrix`.
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
 * Vertical distance, in viewport units, below which two items are one line.
 *
 * This and CELL_SEPARATOR_GAP below are pdf-parse's defaults, kept when #43
 * replaced it. They are inherited constants: nothing here derives them, and the
 * reason to keep the numbers rather than pick rounder ones is that every
 * document already in the index was embedded on the text they produce. Changing
 * either re-shapes the searchable content of every PDF ever uploaded, silently,
 * on its next extraction.
 */
const LINE_GAP = 4.6;

/** Horizontal gap, in viewport units, that pdf-parse reads as a table cell. */
const CELL_SEPARATOR_GAP = 7;

/**
 * One page's text, assembled the way pdf-parse assembled it.
 *
 * `getTextContent()` hands back positioned runs, not lines: a PDF has no
 * paragraphs, so where the breaks go is a decision, and the decision pdf-parse
 * made is what every embedding already in the database was computed over. Two
 * rules carry it — a newline for each item flagged `hasEOL`, and a tab between
 * two items on one line separated by more than CELL_SEPARATOR_GAP.
 *
 * pdf-parse had a third: a newline when the vertical step down exceeded the
 * tallest glyph on the line so far. It is not here because it cannot fire.
 * pdfjs sets `hasEOL` on every vertical change it emits, so the previous item
 * has already appended a newline and pdf-parse's own guard (`does the text so
 * far end in a newline`) declines every time. Measured over 94 generated pages
 * — font sizes 8/12/24, one and two text objects, two-column layouts, upward
 * motion, and drops from 3 to 300 units — it fired zero times, while the tab
 * rule changed the answer on 18 of them. Carrying it would have meant two more
 * magic numbers and a branch no test could reach.
 */
async function extractPageText(page: PdfPage): Promise<string> {
  const viewport = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();

  const parts: string[] = [];
  let lastX: number | undefined;
  let lastY: number | undefined;

  for (const item of items) {
    if (!("str" in item)) continue;

    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);

    // pdfjs inserts a synthetic space item across gaps it reads as a word
    // break, and that item's width closes the distance — so this fires only on
    // the gaps it left open, which are the ones that look like columns.
    const sameLine = lastY !== undefined && Math.abs(lastY - y) < LINE_GAP;
    const cellGap = lastX !== undefined && Math.abs(lastX - x) > CELL_SEPARATOR_GAP;
    parts.push(sameLine && cellGap ? `\t${item.str}` : item.str);

    lastX = x + item.width;
    lastY = y;

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
      // pdf-parse's default. Without it every scanned or slightly broken upload
      // writes "Indexing all PDF objects" and a font warning per page to the
      // server log, for a result the caller already reports.
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
    const text = pages.join("\n\n").trim();

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
    // Releases the pdfjs worker and the document's buffers; a document left
    // undestroyed holds both for the life of the process. Cleanup failing is
    // not the caller's problem and must not replace the answer above.
    //
    // Through the loading task, not the document: unpdf's build drops
    // pdfjs's `PDFDocumentProxy.destroy()`, so `doc.destroy?.()` is not a
    // careful version of this line — it is a no-op that leaks a worker per
    // upload and says nothing.
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
