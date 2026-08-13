import { useState, useCallback, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BlockEditor } from "@/components/editor/BlockEditor";
import { ArrowLeft, Save, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import type { CompanyDocumentWithUploader, CompanyDocument } from "@shared/schema";

export default function CompanyDocumentEditorPage() {
  const [, params] = useRoute("/company-documents/:id/edit");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const documentId = params?.id;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState<any>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const { data: companyDoc, isLoading } = useQuery<CompanyDocumentWithUploader>({
    queryKey: ["/api/company-documents", documentId],
    enabled: !!documentId,
  });

  // Fetch documents in the same folder for navigation
  const { data: folderDocs = [] } = useQuery<CompanyDocument[]>({
    queryKey: ["/api/company-documents", { folderId: companyDoc?.folderId }],
    queryFn: async () => {
      if (!companyDoc?.folderId) return [];
      const res = await fetch(`/api/company-documents?folderId=${companyDoc.folderId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!companyDoc?.folderId,
  });

  // Calculate prev/next document IDs for navigation within the same folder
  const { prevDocId, nextDocId } = useMemo(() => {
    if (!documentId || folderDocs.length === 0) {
      return { prevDocId: null, nextDocId: null };
    }
    const currentIndex = folderDocs.findIndex(d => String(d.id) === String(documentId));
    if (currentIndex === -1) {
      return { prevDocId: null, nextDocId: null };
    }
    return {
      prevDocId: currentIndex > 0 ? folderDocs[currentIndex - 1].id : null,
      nextDocId: currentIndex < folderDocs.length - 1 ? folderDocs[currentIndex + 1].id : null,
    };
  }, [documentId, folderDocs]);

  useEffect(() => {
    if (companyDoc) {
      setTitle(companyDoc.name);
      setDescription(companyDoc.description || "");
      setContent(companyDoc.content || { type: "doc", content: [{ type: "paragraph" }] });
    }
  }, [companyDoc]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/company-documents/${documentId}`, {
        name: title,
        description: description || undefined,
        content,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents", documentId] });
      setHasUnsavedChanges(false);
      toast({ title: "Document saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const handleContentChange = useCallback((newContent: any) => {
    setContent(newContent);
    setHasUnsavedChanges(true);
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    setHasUnsavedChanges(true);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value);
    setHasUnsavedChanges(true);
  };

  const handleBack = () => {
    if (companyDoc?.folderId) {
      navigate(`/company-documents?folder=${companyDoc.folderId}`);
    } else {
      navigate("/company-documents");
    }
  };

  const handleImageUpload = useCallback(async (): Promise<string | null> => {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";
      document.body.appendChild(input);
      
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!companyDoc) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Document not found</p>
        <Button variant="outline" onClick={() => navigate("/company-documents")}>
          Back to Documents
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="company-document-page">
      <div className="sticky top-0 z-20 bg-background border-b no-print" data-testid="company-document-header">
        <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-muted-foreground truncate">
              {companyDoc?.name || "Document"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleBack} data-testid="button-back-to-docs">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="hidden sm:inline text-sm text-muted-foreground">
              {saveMutation.isPending ? "Saving..." : hasUnsavedChanges ? "Unsaved" : ""}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !hasUnsavedChanges}
              data-testid="button-save-document"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 md:mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 md:mr-1" />
              )}
              <span className="hidden md:inline">Save</span>
            </Button>
            <div className="flex items-center border-l pl-2 ml-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!prevDocId}
                onClick={() => prevDocId && navigate(`/company-documents/${prevDocId}/edit`)}
                data-testid="button-prev-company-doc"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!nextDocId}
                onClick={() => nextDocId && navigate(`/company-documents/${nextDocId}/edit`)}
                data-testid="button-next-company-doc"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hidden print-content">
        <div className="px-4 md:px-6 w-full">
          <div className="py-6">
            <Input
              value={title}
              onChange={handleTitleChange}
              className="text-2xl md:text-3xl font-bold border-none shadow-none focus-visible:ring-0 px-0 h-auto"
              placeholder="Untitled"
              data-testid="input-document-title"
            />
            <Textarea
              value={description}
              onChange={handleDescriptionChange}
              className="text-sm text-muted-foreground border-none shadow-none focus-visible:ring-0 px-0 resize-y min-h-[24px] mt-2"
              placeholder="Add a description..."
              rows={1}
              data-testid="input-document-description"
            />
          </div>
          <BlockEditor
            content={content}
            onChange={handleContentChange}
            onImageUpload={handleImageUpload}
            editable={true}
          />
          <div className="pb-8" />
        </div>
      </div>
    </div>
  );
}
