import { extractTextFromFile, isSupportedForExtraction, isVideoFile } from "./contentExtraction";

/**
 * The two halves of a company document, as the embedding pipeline sees them.
 *
 * A native page carries `content` — the TipTap document the editor writes. An
 * uploaded file carries none, and its text lives only in object storage.
 */
export interface CompanyDocumentSource {
  name: string;
  content?: unknown;
  storagePath?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
}

/**
 * What to embed a company document on, or `null` if there is nothing to embed.
 *
 * One answer for three callers — the upload route, the update route, and the
 * rebuild — because they disagreed, and the disagreement was silent. The update
 * route re-embedded `document.content`, which is always `null` for an uploaded
 * file, so renaming an uploaded PDF replaced its chunks with a single
 * `(Empty page)` placeholder: the only write path that ever touched an existing
 * upload's index deleted it (#43).
 *
 * An uploaded file is therefore re-extracted from storage here rather than read
 * out of a column that never held it. That costs a storage read on rename,
 * which is the honest price: the title is part of every chunk's text, so a
 * rename genuinely does re-shape what the document is searched by.
 *
 * `null` means *leave the index alone*. Callers must not treat it as empty
 * content — a failed extraction and a document with nothing in it are the same
 * value here, and neither is a reason to delete chunks that already exist.
 */
export async function companyDocumentEmbeddingContent(
  document: CompanyDocumentSource
): Promise<unknown | null> {
  // A native page: hand the TipTap document over whole, so
  // `extractTextFromContent` walks it into prose. Stringifying it here would
  // embed `type` and `attrs` keys along with the words.
  if (document.content) {
    return document.content;
  }

  const { storagePath, mimeType, fileName, name } = document;
  if (!storagePath || !mimeType || !fileName) {
    return null;
  }

  if (isVideoFile(mimeType, fileName)) {
    console.log(`[Embeddings] Video file detected: ${fileName} - transcripts are synced separately`);
    return null;
  }

  if (!isSupportedForExtraction(mimeType, fileName)) {
    console.log(`[Embeddings] Unsupported file type for extraction: ${mimeType}`);
    return null;
  }

  console.log(`[Embeddings] Extracting text from uploaded file: ${fileName}`);
  const extraction = await extractTextFromFile(storagePath, mimeType, fileName);

  if (!extraction.success || !extraction.text) {
    console.log(`[Embeddings] Extraction warning for ${fileName}: ${extraction.error ?? "no text"}`);
    return null;
  }

  console.log(`[Embeddings] Extracted ${extraction.text.length} characters from ${fileName}`);
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: extraction.text }] }],
  };
}
