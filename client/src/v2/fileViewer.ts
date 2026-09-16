/**
 * File viewer (#216). A File is Knowledge: opening one previews it under v2
 * chrome with the depth v1 had — image, PDF, Word — over the
 * `/api/company-documents/:id/{stream,download,word-html}` routes that already
 * exist, or over the object path a Project note attachment carries. A type
 * nothing here can render says so and offers the download instead of pretending.
 *
 * Novelty: none. Zoom is tens/day — a control, not an animation.
 */

import { isVisibleDocumentAccess } from "@shared/documentAccess";

export type FilePreviewKind = "image" | "pdf" | "word" | "text" | "none";

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
  const readable = isVisibleDocumentAccess(input.access);
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
      backHref,
      backLabel,
      zoomable: false,
    };
  }

  const kind = previewKindFor(input);
  // Only a Workspace Document has a conversion route; converting nothing would
  // render an empty page where the File was.
  const wordHtmlHref =
    kind === "word" && workspace && input.documentId
      ? companyDocumentWordHtmlHref(input.documentId)
      : null;
  const preview: FilePreviewKind = kind === "word" && !wordHtmlHref ? "none" : kind;
  const downloadHref =
    workspace && input.documentId ? companyDocumentDownloadHref(input.documentId) : origin;

  return {
    missing: false,
    title: input.name,
    fileName: input.fileName ?? null,
    meta: fileMeta(input, kind),
    preview,
    streamHref: origin,
    downloadHref,
    wordHtmlHref,
    emptyCopy: preview === "none" ? NO_PREVIEW_COPY : "",
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

/** A File the backend serves as an object, not a route wouter can resolve. */
export function isObjectPath(href: string | null | undefined): boolean {
  if (!href) return false;
  return href.startsWith("/objects/") || href.startsWith("/public-objects/");
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
function fileMeta(input: FileViewerInput, kind: FilePreviewKind): string {
  return [input.fileName ?? "", formatFileSize(input.fileSize), typeLabel(kind)]
    .filter(Boolean)
    .join(" · ");
}

function typeLabel(kind: FilePreviewKind): string {
  if (kind === "pdf") return "PDF";
  if (kind === "image") return "IMAGE";
  if (kind === "word") return "WORD";
  if (kind === "text") return "TEXT";
  return "FILE";
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
