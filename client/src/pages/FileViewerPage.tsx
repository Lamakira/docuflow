import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BlockEditor } from "@/components/editor/BlockEditor";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Download,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileSpreadsheet,
  File,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { format } from "date-fns";
import type { CompanyDocumentWithUploader } from "@shared/schema";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.449/build/pdf.worker.min.mjs';

function getFileIcon(mimeType: string | null) {
  if (!mimeType) return FileText;
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") return FileSpreadsheet;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("text")) return FileText;
  return File;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes === 0) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function FileViewerPage() {
  const [, params] = useRoute("/company-documents/:id/view");
  const [, navigate] = useLocation();
  const documentId = params?.id;

  const { data: document, isLoading, error } = useQuery<CompanyDocumentWithUploader>({
    queryKey: ["/api/company-documents", documentId],
    enabled: !!documentId,
  });

  const handleDownload = () => {
    if (!document) return;
    const link = window.document.createElement("a");
    link.href = `/api/company-documents/${document.id}/download`;
    link.download = document.fileName || document.name;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
  };

  const handleBack = () => {
    navigate("/company-documents");
  };

  const isWordDoc = document?.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                    document?.mimeType === 'application/msword';

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <File className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">File not found</h2>
        <p className="text-muted-foreground">The requested file could not be found.</p>
        <Button onClick={handleBack} data-testid="button-back-to-documents">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Documents
        </Button>
      </div>
    );
  }

  const FileIcon = getFileIcon(document.mimeType);
  const streamUrl = `/api/company-documents/${document.id}/stream`;
  const mimeType = document.mimeType || "";

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b bg-background gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 flex-shrink-0">
            <FileIcon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold truncate" data-testid="text-file-name">{document.name}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-muted-foreground">
              {document.fileName && <span className="truncate max-w-[150px] sm:max-w-none">{document.fileName}</span>}
              {document.fileSize && <span>{formatFileSize(document.fileSize)}</span>}
              {document.createdAt && (
                <span className="hidden sm:inline">Uploaded {format(new Date(document.createdAt), "MMM d, yyyy")}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
          {!isWordDoc && (
            <Button onClick={handleDownload} size="icon" variant="outline" data-testid="button-download">
              <Download className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={handleBack} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <FileContent mimeType={mimeType} streamUrl={streamUrl} document={document} />
      </div>
    </div>
  );
}

function FileContent({ mimeType, streamUrl, document }: { 
  mimeType: string; 
  streamUrl: string; 
  document: CompanyDocumentWithUploader;
}) {
  if (mimeType.startsWith("image/")) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <img 
          src={streamUrl} 
          alt={document.name} 
          className="max-w-full max-h-full object-contain rounded-lg shadow-lg" 
          data-testid="img-preview"
        />
      </div>
    );
  }

  if (mimeType.startsWith("video/")) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <video 
          controls 
          autoPlay
          className="max-w-full max-h-full rounded-lg shadow-lg"
          data-testid="video-preview"
        >
          <source src={streamUrl} type={mimeType} />
          Your browser does not support video playback.
        </video>
      </div>
    );
  }

  if (mimeType.startsWith("audio/")) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
        <div className="flex items-center justify-center w-32 h-32 rounded-full bg-primary/10">
          <FileAudio className="h-16 w-16 text-primary" />
        </div>
        <h2 className="text-xl font-medium">{document.name}</h2>
        <audio 
          controls 
          autoPlay
          className="w-full max-w-md"
          data-testid="audio-preview"
        >
          <source src={streamUrl} type={mimeType} />
          Your browser does not support audio playback.
        </audio>
      </div>
    );
  }

  if (mimeType === "application/pdf") {
    return <PdfViewer streamUrl={streamUrl} />;
  }

  const isWordDoc = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                    mimeType === 'application/msword';
  if (isWordDoc) {
    return <WordDocEditor documentId={document.id} document={document} />;
  }

  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return <TextFileViewer streamUrl={streamUrl} document={document} />;
  }

  return (
    <div className="p-6">
      <Card className="max-w-md mx-auto mt-12">
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <File className="h-16 w-16 text-muted-foreground" />
          <div className="text-center">
            <h3 className="font-medium">{document.fileName || document.name}</h3>
            {document.fileSize && (
              <p className="text-sm text-muted-foreground">{formatFileSize(document.fileSize)}</p>
            )}
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Preview not available for this file type. Use the download button to view the file.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PdfPage({ pdfDoc, pageNum, scale }: { pdfDoc: PDFDocumentProxy; pageNum: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    const renderPage = async () => {
      if (!canvasRef.current) return;

      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        renderTaskRef.current = page.render({
          canvasContext: context,
          viewport: viewport,
        } as any);

        await renderTaskRef.current.promise;
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.error("Error rendering page:", err);
        }
      }
    };

    renderPage();

    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, pageNum, scale]);

  return (
    <div className="flex justify-center">
      <canvas 
        ref={canvasRef} 
        className="shadow-lg bg-white"
        data-testid={`pdf-canvas-page-${pageNum}`}
      />
    </div>
  );
}

function PdfViewer({ streamUrl }: { streamUrl: string }) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(streamUrl);
        if (!response.ok) {
          throw new Error("Failed to load PDF");
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const pdf = await getDocument({ data: arrayBuffer }).promise;
        
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
      } catch (err) {
        console.error("Error loading PDF:", err);
        setError("Failed to load PDF document");
      } finally {
        setLoading(false);
      }
    };

    loadPdf();
  }, [streamUrl]);

  const zoomIn = () => {
    setScale(prev => Math.min(prev + 0.25, 3));
  };

  const zoomOut = () => {
    setScale(prev => Math.max(prev - 0.25, 0.5));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <FileText className="h-16 w-16 text-muted-foreground" />
            <p className="text-muted-foreground text-center">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-center gap-4 py-3 px-6 border-b bg-muted/30 sticky top-0 z-10">
        <span className="text-sm text-muted-foreground" data-testid="text-page-count">
          {totalPages} page{totalPages !== 1 ? 's' : ''}
        </span>
        <div className="h-6 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="icon"
            onClick={zoomOut}
            disabled={scale <= 0.5}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm min-w-[60px] text-center" data-testid="text-zoom-level">
            {Math.round(scale * 100)}%
          </span>
          <Button 
            variant="outline" 
            size="icon"
            onClick={zoomIn}
            disabled={scale >= 3}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-muted/20">
        <div className="flex flex-col items-center gap-4 p-6">
          {pdfDoc && pageNumbers.map(pageNum => (
            <PdfPage 
              key={pageNum} 
              pdfDoc={pdfDoc} 
              pageNum={pageNum} 
              scale={scale} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WordDocEditor({ documentId, document }: { 
  documentId: string; 
  document: CompanyDocumentWithUploader;
}) {
  const { toast } = useToast();
  const [content, setContent] = useState<any>(null);
  const [isConverting, setIsConverting] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const contentRef = useRef<any>(null);

  const { data: wordHtml, isLoading: isLoadingHtml } = useQuery<{ html: string; messages: any[] }>({
    queryKey: ["/api/company-documents", documentId, "word-html"],
    enabled: !document.content,
  });

  useEffect(() => {
    if (document.content) {
      setContent(document.content);
      contentRef.current = document.content;
      setIsConverting(false);
    } else if (wordHtml?.html) {
      const tiptapContent = convertHtmlToTiptap(wordHtml.html);
      setContent(tiptapContent);
      contentRef.current = tiptapContent;
      setIsConverting(false);
    }
  }, [document.content, wordHtml]);

  const saveDocument = useCallback(async (contentToSave: any) => {
    try {
      await apiRequest("PATCH", `/api/company-documents/${documentId}`, {
        content: contentToSave,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
    } catch (error: any) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    }
  }, [documentId, toast]);

  const handleContentChange = useCallback((newContent: any) => {
    setContent(newContent);
    contentRef.current = newContent;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveDocument(contentRef.current);
    }, 1000);
  }, [saveDocument]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleImageUpload = useCallback(async (): Promise<string | null> => {
    return new Promise((resolve) => {
      const input = window.document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";
      window.document.body.appendChild(input);
      
      const cleanup = () => {
        try {
          if (input.parentNode) {
            input.parentNode.removeChild(input);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      };
      
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) {
          cleanup();
          resolve(null);
          return;
        }
        try {
          const urlResponse = await apiRequest("POST", "/api/company-documents/upload-url");
          const { uploadURL, objectPath } = urlResponse;
          await fetch(uploadURL, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type },
          });
          const imageUrl = objectPath;
          cleanup();
          resolve(imageUrl);
        } catch {
          toast({ title: "Image upload failed", variant: "destructive" });
          cleanup();
          resolve(null);
        }
      };
      
      // Handle cancel (user closes file picker without selecting)
      input.addEventListener("cancel", () => {
        cleanup();
        resolve(null);
      });
      
      input.click();
    });
  }, [toast]);

  if (isLoadingHtml || isConverting) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading document...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hidden">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <BlockEditor
          content={content}
          onChange={handleContentChange}
          onImageUpload={handleImageUpload}
          editable={true}
        />
      </div>
    </div>
  );
}

function convertHtmlToTiptap(html: string): any {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const content: any[] = [];

  function processNode(node: Node): any {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text.trim()) {
        return { type: "text", text };
      }
      return null;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    const tagName = el.tagName.toLowerCase();
    const children: any[] = [];

    for (const child of Array.from(node.childNodes)) {
      const processed = processNode(child);
      if (processed) {
        if (Array.isArray(processed)) {
          children.push(...processed);
        } else {
          children.push(processed);
        }
      }
    }

    switch (tagName) {
      case "p":
        return { type: "paragraph", content: children.length > 0 ? children : undefined };
      case "h1":
        return { type: "heading", attrs: { level: 1 }, content: children };
      case "h2":
        return { type: "heading", attrs: { level: 2 }, content: children };
      case "h3":
        return { type: "heading", attrs: { level: 3 }, content: children };
      case "h4":
      case "h5":
      case "h6":
        return { type: "heading", attrs: { level: 3 }, content: children };
      case "ul":
        return { type: "bulletList", content: children };
      case "ol":
        return { type: "orderedList", content: children };
      case "li":
        return { type: "listItem", content: [{ type: "paragraph", content: children }] };
      case "blockquote":
        return { type: "blockquote", content: children };
      case "strong":
      case "b":
        return children.map(c => c.type === "text" ? { ...c, marks: [...(c.marks || []), { type: "bold" }] } : c);
      case "em":
      case "i":
        return children.map(c => c.type === "text" ? { ...c, marks: [...(c.marks || []), { type: "italic" }] } : c);
      case "u":
        return children.map(c => c.type === "text" ? { ...c, marks: [...(c.marks || []), { type: "underline" }] } : c);
      case "a":
        const href = el.getAttribute("href") || "";
        return children.map(c => c.type === "text" ? { ...c, marks: [...(c.marks || []), { type: "link", attrs: { href } }] } : c);
      case "br":
        return { type: "hardBreak" };
      case "table":
      case "thead":
      case "tbody":
      case "tr":
      case "td":
      case "th":
        return children;
      default:
        return children.length > 0 ? children : null;
    }
  }

  for (const child of Array.from(doc.body.childNodes)) {
    const processed = processNode(child);
    if (processed) {
      if (Array.isArray(processed)) {
        content.push(...processed);
      } else {
        content.push(processed);
      }
    }
  }

  if (content.length === 0) {
    content.push({ type: "paragraph" });
  }

  return { type: "doc", content };
}

function TextFileViewer({ streamUrl, document }: { streamUrl: string; document: CompanyDocumentWithUploader }) {
  const { data: content, isLoading } = useQuery<string>({
    queryKey: ["/api/company-documents", document.id, "text-content"],
    queryFn: async () => {
      const response = await fetch(streamUrl);
      if (!response.ok) throw new Error("Failed to load file");
      return response.text();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <pre 
        className="bg-muted/50 p-6 rounded-lg text-sm font-mono whitespace-pre-wrap break-words"
        data-testid="text-preview"
      >
        {content}
      </pre>
    </div>
  );
}
