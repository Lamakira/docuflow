import mammoth from "mammoth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

type PDFParseClass = typeof import("pdf-parse").PDFParse;

let pdfParse: PDFParseClass | null = null;

/**
 * pdf-parse's parser class, imported on the first PDF rather than at load.
 *
 * The import stays lazy for two reasons: boot does not pay for pdfjs-dist, and
 * the specifier is a string literal esbuild can see, so `script/bundles.ts`
 * leaves the package external instead of inlining 115 MB into `dist/index.cjs`
 * (#36).
 *
 * **v2 is a class, not a callable module.** Until #36 exercised this path, the
 * import was read as `module.default || module` — and pdf-parse 2.x publishes
 * no default export, so that resolved to the namespace object and every
 * extraction died calling it. A version that changes this shape does not fail
 * the build; it fails the first upload.
 */
async function getPdfParser(): Promise<PDFParseClass> {
  if (!pdfParse) {
    ({ PDFParse: pdfParse } = await import("pdf-parse"));
  }
  return pdfParse;
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

async function extractTextFromPdf(buffer: Buffer): Promise<ContentExtractionResult> {
  let parser: InstanceType<PDFParseClass> | undefined;

  try {
    const PDFParse = await getPdfParser();
    parser = new PDFParse({ data: buffer });
    // `pageJoiner` defaults to appending "-- 1 of 12 --" after every page. This
    // text becomes the document's searchable content, so the marker would be
    // indexed as if the document said it.
    const text = (await parser.getText({ pageJoiner: "" })).text?.trim() || "";

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
    // Releases the pdfjs worker and the document's buffers; a parser left
    // undestroyed holds both for the life of the process. Cleanup failing is
    // not the caller's problem and must not replace the answer above.
    await parser?.destroy().catch(() => {});
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
