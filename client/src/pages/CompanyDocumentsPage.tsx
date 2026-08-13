import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Upload,
  Trash2,
  File,
  FileImage,
  FileVideo,
  FileAudio,
  FileSpreadsheet,
  Loader2,
  Plus,
  Building2,
  Folder,
  FolderOpen,
  Grid3X3,
  List,
  Search,
  ChevronRight,
  MoreVertical,
  Pencil,
  FilePlus,
  Home,
  ArrowLeft,
  X,
} from "lucide-react";
import { format } from "date-fns";
import type { CompanyDocumentWithUploader, CompanyDocumentFolderWithCreator } from "@shared/schema";

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

export default function CompanyDocumentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearch();
  
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => {
    // Initialize from URL query parameter
    const params = new URLSearchParams(searchParams);
    return params.get("folder");
  });
  
  // Sync currentFolderId with URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const folderFromUrl = params.get("folder");
    if (folderFromUrl !== currentFolderId) {
      setCurrentFolderId(folderFromUrl);
    }
  }, [searchParams]);
  
  // Navigate to folder using URL (enables browser back/forward navigation)
  const navigateToFolder = (folderId: string | null) => {
    if (folderId) {
      navigate(`/company-documents?folder=${folderId}`);
    } else {
      navigate("/company-documents");
    }
  };
  
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showCreateDocDialog, setShowCreateDocDialog] = useState(false);
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [editingFolder, setEditingFolder] = useState<CompanyDocumentFolderWithCreator | null>(null);
  
  const [documentName, setDocumentName] = useState("");
  const [documentDescription, setDocumentDescription] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteType, setDeleteType] = useState<"document" | "folder">("document");
  
  const [editingDocument, setEditingDocument] = useState<CompanyDocumentWithUploader | null>(null);
  const [newDocumentName, setNewDocumentName] = useState("");

  const [, navigate] = useLocation();
  const isAdmin = user?.role === "admin";

  // Fetch folders
  const { data: folders = [], isLoading: foldersLoading } = useQuery<CompanyDocumentFolderWithCreator[]>({
    queryKey: ["/api/company-document-folders"],
  });

  // Fetch current folder details
  const { data: currentFolder } = useQuery<CompanyDocumentFolderWithCreator>({
    queryKey: ["/api/company-document-folders", currentFolderId],
    enabled: !!currentFolderId,
  });

  // Search results state
  const [searchResults, setSearchResults] = useState<{
    documents: CompanyDocumentWithUploader[];
    folders: CompanyDocumentFolderWithCreator[];
  }>({ documents: [], folders: [] });

  // Fetch documents based on current folder or search
  const { data: documents = [], isLoading: documentsLoading } = useQuery<CompanyDocumentWithUploader[]>({
    queryKey: searchQuery 
      ? ["/api/company-documents/search", { q: searchQuery }]
      : ["/api/company-documents", { folderId: currentFolderId }],
    queryFn: async () => {
      if (searchQuery) {
        const res = await fetch(`/api/company-documents/search?q=${encodeURIComponent(searchQuery)}`);
        if (!res.ok) throw new Error("Failed to search");
        const data = await res.json();
        setSearchResults(data);
        return data.documents || [];
      }
      const url = currentFolderId 
        ? `/api/company-documents?folderId=${currentFolderId}`
        : "/api/company-documents";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      setSearchResults({ documents: [], folders: [] });
      return res.json();
    },
  });

  const isLoading = foldersLoading || documentsLoading;

  // Folder mutations
  const createFolderMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string }) => {
      return apiRequest("POST", "/api/company-document-folders", { name, description });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      setShowFolderDialog(false);
      setFolderName("");
      setFolderDescription("");
      toast({ title: "Folder created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create folder", description: error.message, variant: "destructive" });
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      return apiRequest("PATCH", `/api/company-document-folders/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      setEditingFolder(null);
      setFolderName("");
      toast({ title: "Folder renamed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to rename folder", description: error.message, variant: "destructive" });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/company-document-folders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      setDeleteConfirmId(null);
      if (currentFolderId === deleteConfirmId) {
        navigateToFolder(null);
      }
      toast({ title: "Folder deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete folder", description: error.message, variant: "destructive" });
    },
  });

  // Document mutations
  const uploadMutation = useMutation({
    mutationFn: async (data: { files: File[]; description: string }) => {
      setUploading(true);
      setUploadProgress(0);
      
      const totalFiles = data.files.length;
      let completed = 0;
      
      for (const file of data.files) {
        const urlResponse = await apiRequest("POST", "/api/company-documents/upload-url");
        const { uploadURL, objectPath } = urlResponse;
        
        const uploadResponse = await fetch(uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        
        if (!uploadResponse.ok) throw new Error(`Failed to upload ${file.name}`);
        
        const storagePath = objectPath;
        const documentName = file.name.replace(/\.[^/.]+$/, "");
        
        await apiRequest("POST", "/api/company-documents", {
          name: documentName,
          description: data.description || undefined,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          storagePath,
          folderId: currentFolderId,
        });
        
        completed++;
        setUploadProgress(Math.round((completed / totalFiles) * 100));
      }
      
      return { count: totalFiles };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      setShowUploadDialog(false);
      setDocumentDescription("");
      setSelectedFiles([]);
      setUploading(false);
      setUploadProgress(0);
      toast({ title: result.count > 1 ? `${result.count} documents uploaded` : "Document uploaded" });
    },
    onError: (error: Error) => {
      setUploading(false);
      setUploadProgress(0);
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const createDocMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      return apiRequest("POST", "/api/company-documents", {
        name: data.name,
        description: data.description || undefined,
        content: { type: "doc", content: [{ type: "paragraph" }] },
        folderId: currentFolderId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      setShowCreateDocDialog(false);
      setDocumentName("");
      setDocumentDescription("");
      toast({ title: "Document created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create document", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/company-documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      setDeleteConfirmId(null);
      toast({ title: "Document deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const renameDocumentMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      return apiRequest("PATCH", `/api/company-documents/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      setEditingDocument(null);
      setNewDocumentName("");
      toast({ title: "Document renamed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to rename document", description: error.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setSelectedFiles(Array.from(files));
    }
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = () => {
    if (selectedFiles.length === 0) {
      toast({ title: "Missing information", description: "Please select at least one file.", variant: "destructive" });
      return;
    }
    uploadMutation.mutate({ files: selectedFiles, description: documentDescription.trim() });
  };

  const handleCreateDoc = () => {
    if (!documentName.trim()) {
      toast({ title: "Missing information", description: "Please enter a document name.", variant: "destructive" });
      return;
    }
    createDocMutation.mutate({ name: documentName.trim(), description: documentDescription.trim() });
  };

  const handleFolderSubmit = () => {
    if (!folderName.trim()) return;
    if (editingFolder) {
      renameFolderMutation.mutate({ id: editingFolder.id, name: folderName.trim() });
    } else {
      createFolderMutation.mutate({ name: folderName.trim(), description: folderDescription.trim() || undefined });
    }
  };

  const openRenameFolder = (folder: CompanyDocumentFolderWithCreator) => {
    setEditingFolder(folder);
    setFolderName(folder.name);
    setFolderDescription("");
  };

  const openRenameDocument = (doc: CompanyDocumentWithUploader) => {
    setEditingDocument(doc);
    setNewDocumentName(doc.name);
  };

  const handleRenameDocument = () => {
    if (!editingDocument || !newDocumentName.trim()) return;
    renameDocumentMutation.mutate({ id: editingDocument.id, name: newDocumentName.trim() });
  };

  const handleDocumentClick = (doc: CompanyDocumentWithUploader) => {
    if (doc.content) {
      navigate(`/company-documents/${doc.id}/edit`);
    } else if (doc.storagePath) {
      navigate(`/company-documents/${doc.id}/view`);
    }
  };

  const confirmDelete = (id: string, type: "document" | "folder") => {
    setDeleteConfirmId(id);
    setDeleteType(type);
  };

  const handleDelete = () => {
    if (!deleteConfirmId) return;
    if (deleteType === "folder") {
      deleteFolderMutation.mutate(deleteConfirmId);
    } else {
      deleteMutation.mutate(deleteConfirmId);
    }
  };

  const documentToDelete = documents.find(d => d.id === deleteConfirmId);
  const folderToDelete = folders.find(f => f.id === deleteConfirmId);

  return (
    <div className="h-full py-4 px-4 sm:py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2 sm:gap-3" data-testid="text-page-title">
              <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
              <span className="truncate">{currentFolder ? currentFolder.name : "Company Documents"}</span>
              {currentFolderId && (
                <Button variant="ghost" size="icon" onClick={() => navigateToFolder(null)} className="shrink-0 sm:hidden" data-testid="button-back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
            </h1>
            {!currentFolderId && (
              <p className="text-sm text-muted-foreground mt-1 hidden sm:block">Company terms, policies, and important documents</p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1 sm:flex-initial sm:w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-full"
                data-testid="input-search"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="icon" onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")} data-testid="button-view-toggle">
                {viewMode === "grid" ? <List className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
              </Button>
              {!currentFolderId && !searchQuery && (
                <Button variant="outline" onClick={() => { setFolderName(""); setEditingFolder(null); setShowFolderDialog(true); }} data-testid="button-new-folder">
                  <Folder className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">New Folder</span>
                </Button>
              )}
              {currentFolderId && (
                <>
                  <Button variant="outline" onClick={() => { setDocumentName(""); setDocumentDescription(""); setShowCreateDocDialog(true); }} data-testid="button-create-document">
                    <FilePlus className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Create Document</span>
                  </Button>
                  <Button size="icon" onClick={() => { setDocumentDescription(""); setSelectedFiles([]); setShowUploadDialog(true); }} data-testid="button-upload-document">
                    <Upload className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
        {currentFolderId && (
          <nav className="flex items-center gap-1 text-sm flex-wrap" aria-label="Breadcrumb" data-testid="nav-breadcrumb">
            <Button 
              variant="ghost"
              size="sm"
              onClick={() => navigateToFolder(null)} 
              className="gap-1.5 text-muted-foreground"
              data-testid="link-root"
            >
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">Company Documents</span>
            </Button>
            <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
            <span className="text-sm font-medium text-foreground truncate max-w-[150px] sm:max-w-none">{currentFolder?.name}</span>
          </nav>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : searchQuery ? (
        // Search results - show both folders and documents
        documents.length === 0 && searchResults.folders.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Search className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No results found</h3>
              <p className="text-muted-foreground text-center max-w-md">
                No documents or folders match "{searchQuery}"
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Matching Folders */}
            {searchResults.folders.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Folders ({searchResults.folders.length})</h3>
                <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" : "space-y-2"}>
                  {searchResults.folders.map((folder) => (
                    <FolderCard key={folder.id} folder={folder} viewMode={viewMode} onOpen={() => { setSearchQuery(""); navigateToFolder(folder.id); }} onRename={() => openRenameFolder(folder)} onDelete={() => confirmDelete(folder.id, "folder")} />
                  ))}
                </div>
              </div>
            )}
            {/* Matching Documents */}
            {documents.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Documents ({documents.length})</h3>
                <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" : "space-y-2"}>
                  {documents.map((doc) => (
                    <DocumentCard key={doc.id} doc={doc} viewMode={viewMode} onDelete={(id) => confirmDelete(id, "document")} onRename={openRenameDocument} onClick={handleDocumentClick} showFolder />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      ) : !currentFolderId ? (
        // Root view - show folders
        folders.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Folder className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No folders yet</h3>
              <p className="text-muted-foreground text-center max-w-md mb-4">
                Create folders to organize your company documents.
              </p>
              <Button onClick={() => { setFolderName(""); setEditingFolder(null); setShowFolderDialog(true); }} data-testid="button-create-first-folder">
                <Plus className="h-4 w-4 mr-2" />
                Create First Folder
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" : "space-y-2"}>
            {folders.map((folder) => (
              <FolderCard key={folder.id} folder={folder} viewMode={viewMode} onOpen={() => navigateToFolder(folder.id)} onRename={() => openRenameFolder(folder)} onDelete={() => confirmDelete(folder.id, "folder")} />
            ))}
          </div>
        )
      ) : (
        // Inside folder - show documents
        documents.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No documents yet</h3>
              <p className="text-muted-foreground text-center max-w-md mb-4">
                Upload or create documents in this folder.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setDocumentName(""); setDocumentDescription(""); setShowCreateDocDialog(true); }} data-testid="button-create-first-doc">
                  <FilePlus className="h-4 w-4 mr-2" />
                  Create Document
                </Button>
                <Button onClick={() => { setDocumentDescription(""); setSelectedFiles([]); setShowUploadDialog(true); }} data-testid="button-upload-first">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Files
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" : "space-y-2"}>
            {documents.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} viewMode={viewMode} onDelete={(id) => confirmDelete(id, "document")} onRename={openRenameDocument} onClick={handleDocumentClick} />
            ))}
          </div>
        )
      )}

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-lg sm:w-full">
          <DialogHeader>
            <DialogTitle>Upload Files</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="file">Select Files</Label>
              <Input ref={fileInputRef} id="file" type="file" multiple onChange={handleFileSelect} data-testid="input-file" />
            </div>
            {selectedFiles.length > 0 && (
              <div className="space-y-2">
                <Label>Selected Files ({selectedFiles.length})</Label>
                <div className="max-h-40 overflow-y-auto space-y-1 rounded-md border p-2">
                  {selectedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover-elevate" data-testid={`file-item-${index}`}>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">({formatFileSize(file.size)})</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeSelectedFile(index)} disabled={uploading} data-testid={`button-remove-file-${index}`}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {uploading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="description">Description for all files (optional)</Label>
              <Textarea id="description" value={documentDescription} onChange={(e) => setDocumentDescription(e.target.value)} placeholder="Brief description..." rows={2} data-testid="input-document-description" />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowUploadDialog(false)} disabled={uploading} className="w-full sm:w-auto" data-testid="button-cancel-upload">Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading || selectedFiles.length === 0} className="w-full sm:w-auto" data-testid="button-confirm-upload">
              {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</> : <><Upload className="h-4 w-4 mr-2" />Upload {selectedFiles.length > 0 && `(${selectedFiles.length})`}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Document Dialog */}
      <Dialog open={showCreateDocDialog} onOpenChange={setShowCreateDocDialog}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>Create Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="doc-name">Document Name</Label>
              <Input id="doc-name" value={documentName} onChange={(e) => setDocumentName(e.target.value)} placeholder="e.g., Meeting Notes" data-testid="input-create-doc-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-description">Description (optional)</Label>
              <Textarea id="doc-description" value={documentDescription} onChange={(e) => setDocumentDescription(e.target.value)} placeholder="Brief description..." rows={3} data-testid="input-create-doc-description" />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowCreateDocDialog(false)} className="w-full sm:w-auto" data-testid="button-cancel-create-doc">Cancel</Button>
            <Button onClick={handleCreateDoc} disabled={!documentName.trim() || createDocMutation.isPending} className="w-full sm:w-auto" data-testid="button-confirm-create-doc">
              {createDocMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : <><FilePlus className="h-4 w-4 mr-2" />Create</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Dialog */}
      <Dialog open={showFolderDialog || !!editingFolder} onOpenChange={(open) => { if (!open) { setShowFolderDialog(false); setEditingFolder(null); setFolderDescription(""); } }}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>{editingFolder ? "Rename Folder" : "Create Folder"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Folder Name</Label>
              <Input id="folder-name" value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="e.g., Policies" data-testid="input-folder-name" />
            </div>
            {!editingFolder && (
              <div className="space-y-2">
                <Label htmlFor="folder-description">Description (optional)</Label>
                <Textarea id="folder-description" value={folderDescription} onChange={(e) => setFolderDescription(e.target.value)} placeholder="Brief description of the folder contents..." rows={3} data-testid="input-folder-description" />
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => { setShowFolderDialog(false); setEditingFolder(null); setFolderDescription(""); }} className="w-full sm:w-auto" data-testid="button-cancel-folder">Cancel</Button>
            <Button onClick={handleFolderSubmit} disabled={!folderName.trim() || createFolderMutation.isPending || renameFolderMutation.isPending} className="w-full sm:w-auto" data-testid="button-confirm-folder">
              {(createFolderMutation.isPending || renameFolderMutation.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editingFolder ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteType === "folder" ? "Folder" : "Document"}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteType === "folder" ? folderToDelete?.name : documentToDelete?.name}"?
              {deleteType === "folder" && " All documents in this folder will also be deleted."}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Document Dialog */}
      <Dialog open={!!editingDocument} onOpenChange={(open) => { if (!open) { setEditingDocument(null); setNewDocumentName(""); } }}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>Rename Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rename-doc-name">Document Name</Label>
              <Input id="rename-doc-name" value={newDocumentName} onChange={(e) => setNewDocumentName(e.target.value)} placeholder="Document name" data-testid="input-rename-document" />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => { setEditingDocument(null); setNewDocumentName(""); }} className="w-full sm:w-auto" data-testid="button-cancel-rename-doc">Cancel</Button>
            <Button onClick={handleRenameDocument} disabled={!newDocumentName.trim() || renameDocumentMutation.isPending} className="w-full sm:w-auto" data-testid="button-confirm-rename-doc">
              {renameDocumentMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function FolderCard({ folder, viewMode, onOpen, onRename, onDelete }: {
  folder: CompanyDocumentFolderWithCreator;
  viewMode: "grid" | "list";
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  if (viewMode === "list") {
    return (
      <Card className="hover-elevate cursor-pointer" data-testid={`card-folder-${folder.id}`}>
        <CardContent className="flex items-center gap-4 py-3 px-4" onClick={onOpen}>
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium truncate" data-testid={`text-folder-name-${folder.id}`}>{folder.name}</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {folder.description && <span className="truncate" data-testid={`text-folder-description-${folder.id}`}>{folder.description}</span>}
              {folder.createdAt && <span>Created {format(new Date(folder.createdAt), "MMM d, yyyy")}</span>}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" data-testid={`button-folder-menu-${folder.id}`}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(); }} data-testid={`button-rename-folder-${folder.id}`}>
                <Pencil className="h-4 w-4 mr-2" />Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-destructive" data-testid={`button-delete-folder-${folder.id}`}>
                <Trash2 className="h-4 w-4 mr-2" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover-elevate cursor-pointer" onClick={onOpen} data-testid={`card-folder-${folder.id}`}>
      <CardContent className="flex flex-col items-center justify-center py-4 px-3 text-center relative">
        <div className="absolute top-1 right-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-folder-menu-${folder.id}`}>
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(); }} data-testid={`button-rename-folder-${folder.id}`}>
                <Pencil className="h-4 w-4 mr-2" />Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-destructive" data-testid={`button-delete-folder-${folder.id}`}>
                <Trash2 className="h-4 w-4 mr-2" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 mb-2">
          <FolderOpen className="h-4 w-4 text-primary" />
        </div>
        <h3 className="font-medium text-sm truncate w-full" data-testid={`text-folder-name-${folder.id}`}>{folder.name}</h3>
        {folder.description && (
          <p className="text-xs text-muted-foreground truncate w-full mt-0.5" data-testid={`text-folder-description-${folder.id}`}>{folder.description}</p>
        )}
        {folder.createdAt && (
          <p className="text-xs text-muted-foreground mt-0.5">Created {format(new Date(folder.createdAt), "MMM d, yyyy")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentCard({ doc, viewMode, onDelete, onRename, onClick, showFolder }: {
  doc: CompanyDocumentWithUploader;
  viewMode: "grid" | "list";
  onDelete: (id: string) => void;
  onRename: (doc: CompanyDocumentWithUploader) => void;
  onClick: (doc: CompanyDocumentWithUploader) => void;
  showFolder?: boolean;
}) {
  const FileIcon = getFileIcon(doc.mimeType);
  const isEditableDoc = !!doc.content;

  if (viewMode === "list") {
    return (
      <Card className="hover-elevate cursor-pointer" data-testid={`card-document-${doc.id}`}>
        <CardContent className="flex items-center gap-4 py-3 px-4" onClick={() => onClick(doc)}>
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
            <FileIcon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium truncate" data-testid={`text-document-name-${doc.id}`}>
              {doc.name}
              {isEditableDoc && <span className="ml-2 text-xs text-muted-foreground">(editable)</span>}
            </h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {doc.fileName && <span>{doc.fileName}</span>}
              {doc.fileSize && <span>{formatFileSize(doc.fileSize)}</span>}
              {showFolder && doc.folder && (
                <span className="flex items-center gap-1"><Folder className="h-3 w-3" />{doc.folder.name}</span>
              )}
              {doc.createdAt && <span>{format(new Date(doc.createdAt), "MMM d, yyyy")}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" data-testid={`button-doc-menu-${doc.id}`}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(doc); }} data-testid={`button-rename-doc-${doc.id}`}>
                  <Pencil className="h-4 w-4 mr-2" />Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }} className="text-destructive" data-testid={`button-delete-${doc.id}`}>
                  <Trash2 className="h-4 w-4 mr-2" />Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover-elevate cursor-pointer" onClick={() => onClick(doc)} data-testid={`card-document-${doc.id}`}>
      <CardContent className="flex flex-col items-center justify-center py-4 px-3 text-center relative">
        <div className="absolute top-1 right-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-doc-menu-${doc.id}`}>
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(doc); }} data-testid={`button-rename-doc-${doc.id}`}>
                <Pencil className="h-4 w-4 mr-2" />Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }} className="text-destructive" data-testid={`button-delete-${doc.id}`}>
                <Trash2 className="h-4 w-4 mr-2" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 mb-2">
          <FileIcon className="h-4 w-4 text-primary" />
        </div>
        <h3 className="font-medium text-sm truncate w-full" data-testid={`text-document-name-${doc.id}`}>{doc.name}</h3>
        {doc.description && <p className="text-xs text-muted-foreground truncate w-full mt-0.5">{doc.description}</p>}
        {showFolder && doc.folder && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Folder className="h-3 w-3" />{doc.folder.name}</p>
        )}
      </CardContent>
    </Card>
  );
}
