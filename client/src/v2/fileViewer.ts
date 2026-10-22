/**
 * File viewer (#216). A File is Knowledge: opening one previews it under v2
 * chrome with the depth v1 had — image, PDF, Word — over the
 * `/api/company-documents/:id/{stream,download,word-html}` routes that already
 * exist, or over the object path a Project note attachment carries. A type
 * nothing here can render says so and offers the download instead of pretending.
 *
 * Novelty: none. Zoom is tens/day — a control, not an animation.
 */

import { isReadableDocument } from "@shared/documentAccess";

export type FilePreviewKind = "image" | "pdf" | "word" | "text" | "none";

/** What a File is, whatever this viewer can preview of it: it picks the icon and the words. */
export type FileFamily =
  | "slides"
  | "sheet"
  | "document"
  | "pdf"
  | "image"
  | "text"
  | "archive"
  | "video"
  | "audio"
  | "file";

/** The designed state for a File this viewer cannot show (#335 follow-up). */
export type FileFallback = { title: string; copy: string };

/** `workspace` is a Workspace Document row; `object` is an attachment's object path. */
export type FileViewerSource = "workspace" | "object";

export type FileViewerInput = {
  source: FileViewerSource;
  documentId?: string | null;
  name: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  access?: string | null;
  effectiveAccess?: string | null;
  objectPath?: string | null;
  backHref?: string | null;
};

export type FileViewerModel = {
  missing: boolean;
  title: string;
  /** The name the File is saved under, which is not always what it is called. */
  fileName: string | null;
  meta: string;
  preview: FilePreviewKind;
  streamHref: string | null;
  downloadHref: string | null;
  wordHtmlHref: string | null;
  emptyCopy: string;
  /** What the File is, for the icon; `file` when nothing says. */
  family: FileFamily;
  /** Set when the File exists but has no preview here. */
  fallback: FileFallback | null;
  backHref: string;
  backLabel: string;
  zoomable: boolean;
};

export const FILE_ZOOM_MIN = 0.5;
export const FILE_ZOOM_MAX = 3;
export const FILE_ZOOM_STEP = 0.25;

const WORD_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const TEXT_MIME_TYPES = new Set(["application/json", "application/xml"]);

const EXTENSION_KINDS: Record<string, FilePreviewKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  pdf: "pdf",
  doc: "word",
  docx: "word",
  txt: "text",
  md: "text",
  csv: "text",
  json: "text",
  log: "text",
};

const FAMILY_BY_EXTENSION: Record<string, FileFamily> = {
  ppt: "slides", pptx: "slides", pps: "slides", ppsx: "slides", key: "slides", odp: "slides",
  xls: "sheet", xlsx: "sheet", ods: "sheet", numbers: "sheet",
  doc: "document", docx: "document", odt: "document", rtf: "document", pages: "document",
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image", heic: "image",
  txt: "text", md: "text", csv: "text", json: "text", log: "text", xml: "text",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive", tgz: "archive",
  mp4: "video", mov: "video", webm: "video", avi: "video", mkv: "video",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", flac: "audio",
};

const FAMILY_LABELS: Record<FileFamily, string> = {
  slides: "Presentation",
  sheet: "Spreadsheet",
  document: "Document",
  pdf: "PDF",
  image: "Image",
  text: "Text",
  archive: "Archive",
  video: "Video",
  audio: "Audio",
  file: "File",
};

/** Where a person opens what this viewer cannot show. */
const FALLBACK_COPY: Record<FileFamily, string> = {
  slides: "Download it to open it in PowerPoint, Keynote or Google Slides.",
  sheet: "Download it to open it in Excel, Numbers or Google Sheets.",
  document: "Download it to open it in Word, Pages or Google Docs.",
  pdf: "Download it to open it in a PDF reader.",
  image: "Download it to open it in an image viewer.",
  text: "Download it to open it in a text editor.",
  archive: "Download it and extract it to see the files it holds.",
  video: "Download it to play it.",
  audio: "Download it to play it.",
  file: "Download it to open it in an application that reads it.",
};

/** The mime type when it says, else the file name's extension. */
export function fileFamilyFor(input: { mimeType?: string | null; fileName?: string | null }): FileFamily {
  const mimeType = (input.mimeType ?? "").toLowerCase();
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "slides";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "sheet";
  if (WORD_MIME_TYPES.has(mimeType) || mimeType.includes("wordprocessing") || mimeType.includes("opendocument.text")) {
    return "document";
  }
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (/zip|compressed|x-tar|gzip|x-7z|rar/.test(mimeType)) return "archive";
  if (mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType)) return "text";
  return FAMILY_BY_EXTENSION[extensionOf(input.fileName)] ?? "file";
}

export function fileFallbackFor(family: FileFamily): FileFallback {
  const what = family === "pdf" ? "PDF" : FAMILY_LABELS[family].toLowerCase();
  return { title: `No preview for this ${what}`, copy: FALLBACK_COPY[family] };
}

const NO_PREVIEW_COPY =
  "Preview is not available for this File. Download it to open it in an application that reads it.";
const MISSING_COPY = "This File is not in this Workspace, or you cannot access it.";

export function companyDocumentStreamHref(id: string): string {
  return `/api/company-documents/${id}/stream`;
}

export function companyDocumentDownloadHref(id: string): string {
  return `/api/company-documents/${id}/download`;
}

export function companyDocumentWordHtmlHref(id: string): string {
  return `/api/company-documents/${id}/word-html`;
}

export function previewKindFor(input: {
  mimeType?: string | null;
  fileName?: string | null;
}): FilePreviewKind {
  const mimeType = (input.mimeType ?? "").toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (WORD_MIME_TYPES.has(mimeType)) return "word";
  if (mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType)) return "text";
  if (mimeType) return "none";

  // An upload that never carried a mime type still has its name.
  return EXTENSION_KINDS[extensionOf(input.fileName)] ?? "none";
}

export function composeFileViewer(input: FileViewerInput): FileViewerModel {
  const backHref = safeBackHref(input.backHref ?? "/documents");
  const backLabel = backLabelFor(backHref);
  const workspace = input.source === "workspace";
  const readable = isReadableDocument(input);
  const objectPath = input.objectPath && isObjectPath(input.objectPath) ? input.objectPath : null;
  const origin = workspace
    ? input.documentId
      ? companyDocumentStreamHref(input.documentId)
      : null
    : objectPath;

  if (!readable || !origin) {
    return {
      missing: true,
      title: input.name,
      fileName: null,
      meta: "",
      preview: "none",
      streamHref: null,
      downloadHref: null,
      wordHtmlHref: null,
      emptyCopy: MISSING_COPY,
      family: fileFamilyFor(input),
      fallback: null,
      backHref,
      backLabel,
      zoomable: false,
    };
  }

  const kind = previewKindFor(input);
  const family = fileFamilyFor(input);
  // Only a Workspace Document has a conversion route; converting nothing would
  // render an empty page where the File was.
  const wordHtmlHref =
    kind === "word" && workspace && input.documentId
      ? companyDocumentWordHtmlHref(input.documentId)
      : null;
  const preview: FilePreviewKind = kind === "word" && !wordHtmlHref ? "none" : kind;
  const downloadHref =
    workspace && input.documentId
      ? companyDocumentDownloadHref(input.documentId)
      : PROJECT_FILE_STREAM.test(origin)
        ? origin.replace(/\/stream$/, "/download")
        : origin;

  return {
    missing: false,
    title: input.name,
    fileName: input.fileName ?? null,
    meta: fileMeta(input, family),
    preview,
    streamHref: origin,
    downloadHref,
    wordHtmlHref,
    emptyCopy: preview === "none" ? NO_PREVIEW_COPY : "",
    family,
    fallback: preview === "none" ? fileFallbackFor(family) : null,
    backHref,
    backLabel,
    zoomable: preview === "pdf",
  };
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${parseFloat(value.toFixed(1))} ${units[index]}`;
}

export function zoomFile(scale: number, direction: "in" | "out"): number {
  const next = scale + (direction === "in" ? FILE_ZOOM_STEP : -FILE_ZOOM_STEP);
  return Math.min(FILE_ZOOM_MAX, Math.max(FILE_ZOOM_MIN, parseFloat(next.toFixed(2))));
}

export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

const PROJECT_FILE_STREAM = /^\/api\/projects\/[^/?#]+\/files\/[^/?#]+\/stream$/;

/**
 * A File the backend serves as an object, not a route wouter can resolve. A
 * Project File streams through its Project's route, which checks the reader's
 * Project Assignment (#278).
 */
export function isObjectPath(href: string | null | undefined): boolean {
  if (!href) return false;
  return href.startsWith("/objects/") || href.startsWith("/public-objects/") || PROJECT_FILE_STREAM.test(href);
}

export function projectFileStreamHref(projectId: string, fileId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/stream`;
}

/** A Project File opens in the File viewer, and its back link returns to where it was listed. */
export function projectFileHref(input: { projectId: string; id: string; name: string; back: string }): string {
  return fileViewerHref({ src: projectFileStreamHref(input.projectId, input.id), name: input.name, back: input.back });
}

export function fileViewerHref(input: { src: string; name: string; back?: string | null }): string {
  const params = new URLSearchParams({ src: input.src, name: input.name });
  if (input.back) params.set("back", input.back);
  return `/files?${params.toString()}`;
}

export function parseFileViewerQuery(search: string): {
  src: string | null;
  name: string;
  backHref: string;
} {
  const params = new URLSearchParams(search);
  const src = params.get("src");
  return {
    src: isObjectPath(src) ? src : null,
    name: params.get("name") ?? "",
    backHref: safeBackHref(params.get("back")),
  };
}

/** A Back target comes off the URL, so it may only ever be a path in this app. */
export function safeBackHref(value: string | null | undefined): string {
  if (!value) return "/documents";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/documents";
  return value;
}

export type DossierFileDestination = {
  href: string;
  target: "file" | "app" | "none";
};

/**
 * Where a Dossier File row goes. An object path is this app's File viewer; an
 * address somewhere else stays a link out; a row with no href has no
 * destination and must not invent one (#213).
 */
export function dossierFileDestination(input: {
  href?: string | null;
  name: string;
  backHref: string;
}): DossierFileDestination {
  const href = input.href ?? "";
  if (!href) return { href: "", target: "none" };
  if (isObjectPath(href)) {
    return {
      href: fileViewerHref({ src: href, name: input.name, back: input.backHref }),
      target: "app",
    };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return { href, target: "file" };
  }
  return { href, target: "app" };
}

/**
 * Word preview allowlist. The converted HTML came out of a File someone
 * uploaded, so the preview is built from these tags as elements — a tag that is
 * not here is dropped rather than rendered.
 */
const WORD_TAGS: Record<string, string> = {
  p: "p",
  h1: "h2",
  h2: "h3",
  h3: "h4",
  h4: "h4",
  h5: "h4",
  h6: "h4",
  ul: "ul",
  ol: "ol",
  li: "li",
  blockquote: "blockquote",
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  u: "u",
  a: "a",
  br: "br",
  table: "table",
  thead: "thead",
  tbody: "tbody",
  tr: "tr",
  td: "td",
  th: "th",
  pre: "pre",
  code: "code",
};

export function wordTagFor(tag: string): string | null {
  return WORD_TAGS[tag.toLowerCase()] ?? null;
}

/**
 * Tags whose content goes with them. A tag that is merely not on the allowlist
 * keeps its text — a `<span>` around a sentence is still that sentence — but
 * the body of one of these is not document copy at all.
 */
const WORD_DROPPED = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "svg",
  "math",
  "link",
  "meta",
]);

export function wordDropsContent(tag: string): boolean {
  return WORD_DROPPED.has(tag.toLowerCase());
}

const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function safeLinkHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const value = href.trim();
  if (!value) return null;
  if (value.startsWith("//")) return null;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(value);
  if (!scheme) return value;
  return LINK_SCHEMES.has(scheme[1].toLowerCase()) ? value : null;
}

/** The label says what the File is, not whether this viewer can preview it. */
function fileMeta(input: FileViewerInput, family: FileFamily): string {
  return [input.fileName ?? "", formatFileSize(input.fileSize), FAMILY_LABELS[family]]
    .filter(Boolean)
    .join(" · ");
}

function backLabelFor(href: string): string {
  if (href.startsWith("/projects/")) return "Project";
  if (href.startsWith("/project-documentation")) return "Project Documentation";
  if (href.startsWith("/documents")) return "Workspace Documents";
  return "Today";
}

function extensionOf(fileName: string | null | undefined): string {
  if (!fileName) return "";
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}
