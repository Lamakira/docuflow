/**
 * The File viewer (#216). A Workspace File opens from its Document route and a
 * Project File from the object path its attachment carries; both land here, so
 * a File is read under v2 chrome instead of in a bare browser tab.
 *
 * Zoom is tens/day: a control, never an animation.
 */

import { Fragment, createElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ZoomIn, ZoomOut } from "lucide-react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import {
  composeFileViewer,
  formatZoom,
  parseFileViewerQuery,
  safeLinkHref,
  wordDropsContent,
  wordTagFor,
  zoomFile,
  FILE_ZOOM_MAX,
  FILE_ZOOM_MIN,
  type FileViewerModel,
} from "./fileViewer";

// The worker ships with the app. A viewer that reaches a CDN for it stops
// working exactly where a Workspace is most likely to be: behind a firewall.
GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export function V2FileViewer({ viewer }: { viewer: FileViewerModel }) {
  return (
    <div className="df-editor-page df-file-viewer" data-testid="v2-file-viewer">
      <header className="df-editor-head df-file-head">
        <Link href={viewer.backHref} className="df-ghost-btn">
          Back to {viewer.backLabel}
        </Link>
        <div className="df-file-identity">
          <h1 className="df-title" style={{ fontSize: 22 }}>
            {viewer.title}
          </h1>
          {viewer.meta ? (
            <div className="df-file-meta" data-testid="v2-file-meta">
              {viewer.meta}
            </div>
          ) : null}
        </div>
        {viewer.downloadHref ? (
          <DownloadControl href={viewer.downloadHref} fileName={viewer.fileName ?? viewer.title} />
        ) : null}
      </header>
      <FileBody viewer={viewer} />
    </div>
  );
}

/** `/files?src=…` — a File that is an object path, not a Workspace Document row. */
export function V2FilePage() {
  const [location] = useLocation();
  const query = useMemo(() => parseFileViewerQuery(window.location.search), [location]);
  const viewer = composeFileViewer({
    source: "object",
    name: query.name || "File",
    fileName: query.name || null,
    objectPath: query.src,
    backHref: query.backHref,
  });
  return <V2FileViewer viewer={viewer} />;
}

const LOADING_COPY = "Loading this File…";
const UNREADABLE_COPY = "This File could not be read here. Download it to open it.";

/** Every preview answers with this while it reads, and when it cannot. */
function FileStatus({ copy }: { copy: string }) {
  return (
    <div className="df-file-body">
      <p className="df-empty">{copy}</p>
    </div>
  );
}

function FileBody({ viewer }: { viewer: FileViewerModel }) {
  if (viewer.missing || viewer.preview === "none" || !viewer.streamHref) {
    return <FileStatus copy={viewer.emptyCopy} />;
  }

  if (viewer.preview === "image") {
    return <ImagePreview src={viewer.streamHref} alt={viewer.title} />;
  }

  if (viewer.preview === "pdf") {
    return <PdfPreview src={viewer.streamHref} />;
  }

  if (viewer.preview === "word" && viewer.wordHtmlHref) {
    return <WordPreview href={viewer.wordHtmlHref} />;
  }

  return <TextPreview src={viewer.streamHref} />;
}

/**
 * The session is a bearer token on `/api/*`, which only `fetch` carries (see
 * `lib/identitySession`): an `<img src>` or a plain download link would reach
 * the stream route signed out and answer 401. Every File is read through
 * `fetch` and shown from an object URL, the way the Activity gallery saves an
 * Evidence capture.
 */
function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dropped = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    (async () => {
      try {
        const response = await fetch(src, { credentials: "include" });
        if (!response.ok) throw new Error("Failed to read this File");
        const blob = await response.blob();
        if (dropped) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!dropped) setFailed(true);
      }
    })();
    return () => {
      dropped = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) {
    return <FileStatus copy={UNREADABLE_COPY} />;
  }

  if (!url) {
    return <FileStatus copy={LOADING_COPY} />;
  }

  return (
    <div className="df-file-body">
      <img className="df-file-image" src={url} alt={alt} data-testid="v2-file-image" />
    </div>
  );
}

function DownloadControl({ href, fileName }: { href: string; fileName: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="df-refusal-anchor">
      <button
        type="button"
        className="df-ink-btn"
        data-testid="v2-file-download"
        onClick={async () => {
          setFailed(false);
          try {
            await saveFile(href, fileName);
          } catch {
            setFailed(true);
          }
        }}
      >
        Download
      </button>
      {failed ? <p className="df-refusal">This File could not be downloaded.</p> : null}
    </div>
  );
}

async function saveFile(href: string, fileName: string): Promise<void> {
  const response = await fetch(href, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to download this File");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function PdfPreview({ src }: { src: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setPdf(null);
    (async () => {
      try {
        const response = await fetch(src, { credentials: "include" });
        if (!response.ok) throw new Error("Failed to read this File");
        const bytes = await response.arrayBuffer();
        const loaded = await getDocument({ data: bytes }).promise;
        if (cancelled) {
          loaded.destroy();
          return;
        }
        setPdf(loaded);
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (state === "loading") {
    return <FileStatus copy={LOADING_COPY} />;
  }

  if (state === "failed" || !pdf) {
    return <FileStatus copy={UNREADABLE_COPY} />;
  }

  const pages = Array.from({ length: pdf.numPages }, (_, index) => index + 1);

  return (
    <>
      <div className="df-file-head" data-testid="v2-file-zoom">
        <span className="df-file-meta">
          {pdf.numPages} {pdf.numPages === 1 ? "PAGE" : "PAGES"}
        </span>
        <div className="df-file-zoom">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="df-file-zoom-btn"
            aria-label="Zoom out"
            disabled={scale <= FILE_ZOOM_MIN}
            onClick={() => setScale((current) => zoomFile(current, "out"))}
          >
            <ZoomOut className="h-4 w-4" aria-hidden />
          </Button>
          <span className="df-file-zoom-level" data-testid="v2-file-zoom-level">
            {formatZoom(scale)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="df-file-zoom-btn"
            aria-label="Zoom in"
            disabled={scale >= FILE_ZOOM_MAX}
            onClick={() => setScale((current) => zoomFile(current, "in"))}
          >
            <ZoomIn className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="df-file-body">
        {pages.map((page) => (
          <PdfPage key={page} pdf={pdf} page={page} scale={scale} />
        ))}
      </div>
    </>
  );
}

function PdfPage({ pdf, page, scale }: { pdf: PDFDocumentProxy; page: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let render: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const rendered = await pdf.getPage(page);
      const viewport = rendered.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      render = rendered.render({ canvasContext: context, viewport } as never);
      try {
        await render.promise;
      } catch {
        // A cancelled render is the zoom that replaced it, not a failure.
      }
    })();
    return () => {
      render?.cancel();
    };
  }, [pdf, page, scale]);

  return <canvas ref={canvasRef} className="df-file-page" data-testid={`v2-file-page-${page}`} />;
}

function WordPreview({ href }: { href: string }) {
  const { data, isLoading, isError } = useQuery<{ html: string }>({
    queryKey: [href],
    queryFn: async () => {
      const response = await fetch(href, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to convert this File");
      return response.json();
    },
  });

  const body = useMemo(() => (data?.html ? wordElements(data.html) : []), [data?.html]);

  if (isLoading) {
    return <FileStatus copy={LOADING_COPY} />;
  }

  if (isError || body.length === 0) {
    return <FileStatus copy={UNREADABLE_COPY} />;
  }

  return (
    <div className="df-file-body">
      <div className="df-file-word" data-testid="v2-file-word">
        {body}
      </div>
    </div>
  );
}

function TextPreview({ src }: { src: string }) {
  const { data, isLoading, isError } = useQuery<string>({
    queryKey: [src, "text"],
    queryFn: async () => {
      const response = await fetch(src, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to read this File");
      return response.text();
    },
  });

  if (isLoading) {
    return <FileStatus copy={LOADING_COPY} />;
  }

  if (isError) {
    return <FileStatus copy={UNREADABLE_COPY} />;
  }

  return (
    <div className="df-file-body">
      <pre className="df-file-text" data-testid="v2-file-text">
        {data}
      </pre>
    </div>
  );
}

/**
 * The converted HTML came out of a File someone uploaded, so the preview is
 * built as elements from the allowlist rather than written into the page.
 */
function wordElements(html: string): ReactNode[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return wordChildren(parsed.body, "w");
}

function wordChildren(node: Node, key: string): ReactNode[] {
  const children: ReactNode[] = [];
  node.childNodes.forEach((child, index) => {
    const rendered = wordNode(child, `${key}-${index}`);
    if (rendered !== null) children.push(rendered);
  });
  return children;
}

function wordNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || null;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as Element;
  const name = element.tagName.toLowerCase();
  if (wordDropsContent(name)) return null;

  const children = wordChildren(element, key);
  const tag = wordTagFor(name);
  if (!tag) return children.length > 0 ? <Fragment key={key}>{children}</Fragment> : null;
  if (tag === "br") return <br key={key} />;
  if (tag === "a") {
    const href = safeLinkHref(element.getAttribute("href"));
    if (!href) return children.length > 0 ? <Fragment key={key}>{children}</Fragment> : null;
    return (
      <a key={key} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return createElement(tag, { key }, children.length > 0 ? children : undefined);
}
