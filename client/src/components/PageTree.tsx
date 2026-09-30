import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  X,
  Check,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Document, DocumentWithChildren } from "@shared/schema";
import { cn } from "@/lib/utils";
import { pageTemplates, type PageTemplate } from "@/lib/pageTemplates";
import { buildPageTree, pageAncestorIds } from "@/lib/pageTree";

/** How the tree reports what happened: v1's toast unless the host passes its own. */
export type PageTreeReport = { success: (message: string) => void; failure: (message: string) => void };

interface PageTreeProps {
  projectId: string;
  currentDocumentId?: string;
  /** Where a page opens. v1 opens `/document/:id`; v2 opens it in the Project Dossier (#307). */
  pageHref?: (documentId: string) => string;
  /** Where deleting the open page leaves the reader. */
  afterDeleteHref?: string;
  report?: PageTreeReport;
}

export function PageTree({
  projectId,
  currentDocumentId,
  pageHref = (documentId) => `/document/${documentId}`,
  afterDeleteHref = `/project/${projectId}`,
  report,
}: PageTreeProps) {
  const { toast } = useToast();
  const notify: PageTreeReport = report ?? {
    success: (message) => toast({ title: message }),
    failure: (message) => toast({ title: message, variant: "destructive" }),
  };
  const [, setLocation] = useLocation();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showEditPage, setShowEditPage] = useState(false);
  const [showDeletePage, setShowDeletePage] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [pageName, setPageName] = useState("");
  
  // Inline creation state with template support
  const [inlineCreateParentId, setInlineCreateParentId] = useState<string | null | undefined>(undefined);
  const [inlinePageName, setInlinePageName] = useState("");
  const [inlineTemplate, setInlineTemplate] = useState<PageTemplate>(pageTemplates[0]);
  // Track which popover is open: "header", "empty", or a node id for subpages
  const [activePopover, setActivePopover] = useState<string | null>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  
  // Focus the inline input when it appears
  useEffect(() => {
    if (inlineCreateParentId !== undefined && inlineInputRef.current) {
      inlineInputRef.current.focus();
    }
  }, [inlineCreateParentId]);

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ["/api/projects", projectId, "documents"],
  });

  // The open page shows in the tree: every page above it opens.
  useEffect(() => {
    if (!currentDocumentId) return;
    const above = pageAncestorIds(documents, currentDocumentId);
    if (above.length === 0) return;
    setExpandedIds((prev) => (above.every((id) => prev.has(id)) ? prev : new Set([...Array.from(prev), ...above])));
  }, [documents, currentDocumentId]);

  const createDocumentMutation = useMutation({
    mutationFn: async (data: { title: string; parentId: string | null; content?: any; icon?: string }) => {
      return await apiRequest("POST", `/api/projects/${projectId}/documents`, data);
    },
    onSuccess: (newDoc: Document) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
      cancelInlineCreate();
      notify.success("Page created successfully");
      setLocation(pageHref(newDoc.id));
    },
    onError: () => {
      notify.failure("Failed to create page");
    },
  });

  const updateDocumentMutation = useMutation({
    mutationFn: async (data: { id: string; title: string }) => {
      return await apiRequest("PATCH", `/api/documents/${data.id}`, { title: data.title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setShowEditPage(false);
      setSelectedDocument(null);
      setPageName("");
      notify.success("Page renamed successfully");
    },
    onError: () => {
      notify.failure("Failed to rename page");
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
      setShowDeletePage(false);
      setSelectedDocument(null);
      notify.success("Page deleted successfully");
      if (currentDocumentId === selectedDocument?.id) {
        setLocation(afterDeleteHref);
      }
    },
    onError: () => {
      notify.failure("Failed to delete page");
    },
  });

  const duplicateDocumentMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/documents/${id}/duplicate`);
    },
    onSuccess: (newDoc: Document) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
      notify.success("Page duplicated successfully");
      setLocation(pageHref(newDoc.id));
    },
    onError: () => {
      notify.failure("Failed to duplicate page");
    },
  });

  const reorderDocumentMutation = useMutation({
    mutationFn: async (data: { documentId: string; newParentId: string | null; newPosition: number }) => {
      return await apiRequest("POST", `/api/projects/${projectId}/documents/reorder`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
    },
    onError: () => {
      notify.failure("Failed to reorder page");
    },
  });

  // Flatten tree to get all nodes with their parent info for drag and drop
  const flattenTree = useCallback((nodes: DocumentWithChildren[], parentId: string | null = null): Array<{ node: DocumentWithChildren; parentId: string | null; index: number }> => {
    const result: Array<{ node: DocumentWithChildren; parentId: string | null; index: number }> = [];
    nodes.forEach((node, index) => {
      result.push({ node, parentId, index });
      if (node.children && node.children.length > 0 && expandedIds.has(node.id)) {
        result.push(...flattenTree(node.children, node.id));
      }
    });
    return result;
  }, [expandedIds]);

  const handleDragEnd = useCallback((result: DropResult) => {
    const { source, destination, draggableId } = result;
    
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Parse the droppable IDs - format is "parent-{parentId}" or "parent-root" for root level
    const sourceParentId = source.droppableId === "parent-root" ? null : source.droppableId.replace("parent-", "");
    const destParentId = destination.droppableId === "parent-root" ? null : destination.droppableId.replace("parent-", "");

    reorderDocumentMutation.mutate({
      documentId: draggableId,
      newParentId: destParentId,
      newPosition: destination.index,
    });

    // Expand destination parent if moving to a new parent
    if (destParentId && destParentId !== sourceParentId) {
      setExpandedIds((prev) => new Set(Array.from(prev).concat(destParentId)));
    }
  }, [reorderDocumentMutation]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openPopover = (popoverId: string) => {
    setActivePopover(popoverId);
  };

  const closePopover = () => {
    setActivePopover(null);
  };

  const selectTemplateAndStartInline = (template: PageTemplate, parentId: string | null) => {
    setInlineTemplate(template);
    setInlineCreateParentId(parentId);
    setInlinePageName("");
    setActivePopover(null);
    // If creating under a parent, expand it
    if (parentId) {
      setExpandedIds((prev) => new Set(Array.from(prev).concat(parentId)));
    }
  };

  const cancelInlineCreate = () => {
    setInlineCreateParentId(undefined);
    setInlinePageName("");
    setInlineTemplate(pageTemplates[0]);
  };

  const handleInlineCreate = () => {
    if (!inlinePageName.trim() || createDocumentMutation.isPending) return;
    createDocumentMutation.mutate({ 
      title: inlinePageName.trim(), 
      parentId: inlineCreateParentId ?? null,
      content: inlineTemplate.content,
      icon: inlineTemplate.icon,
    });
  };

  const handleInlineKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInlineCreate();
    } else if (e.key === "Escape") {
      cancelInlineCreate();
    }
  };

  const openEditDialog = (doc: Document) => {
    setSelectedDocument(doc);
    setPageName(doc.title);
    setShowEditPage(true);
  };

  const openDeleteDialog = (doc: Document) => {
    setSelectedDocument(doc);
    setShowDeletePage(true);
  };

  const handleUpdatePage = () => {
    if (!selectedDocument || !pageName.trim()) return;
    updateDocumentMutation.mutate({ id: selectedDocument.id, title: pageName.trim() });
  };

  const handleDeletePage = () => {
    if (!selectedDocument) return;
    deleteDocumentMutation.mutate(selectedDocument.id);
  };

  const handleDuplicate = (doc: Document) => {
    duplicateDocumentMutation.mutate(doc.id);
  };

  const tree = buildPageTree(documents);

  // Inline creation row component
  const renderInlineCreateRow = (depth: number = 0) => {
    return (
      <div
        className="flex items-center gap-1 py-1 px-2 rounded-md bg-accent/50"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-base">
          {inlineTemplate.icon}
        </span>
        <Input
          ref={inlineInputRef}
          value={inlinePageName}
          onChange={(e) => setInlinePageName(e.target.value)}
          onKeyDown={handleInlineKeyDown}
          onBlur={() => {
            // Only cancel if empty, otherwise keep it open
            if (!inlinePageName.trim()) {
              cancelInlineCreate();
            }
          }}
          placeholder="Page title..."
          className="h-7 text-sm flex-1 bg-background"
          data-testid="input-inline-page-title"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={handleInlineCreate}
          disabled={!inlinePageName.trim() || createDocumentMutation.isPending}
          data-testid="button-confirm-inline-create"
        >
          <Check className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={cancelInlineCreate}
          data-testid="button-cancel-inline-create"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  };

  const renderDraggableNode = (node: DocumentWithChildren, depth: number = 0, index: number) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isActive = currentDocumentId === node.id;

    return (
      <Draggable key={node.id} draggableId={node.id} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
          >
            <div
              className={cn(
                "page-tree-item group flex items-center gap-1 py-1 px-2 rounded-md hover-elevate",
                isActive && "bg-accent",
                snapshot.isDragging && "shadow-lg bg-background border"
              )}
              style={{ paddingLeft: `${depth * 20 + 8}px` }}
            >
              <div
                {...provided.dragHandleProps}
                className="cursor-grab active:cursor-grabbing"
              >
                <GripVertical className="w-3 h-3 text-muted-foreground" />
              </div>
              {hasChildren ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 flex-shrink-0 text-muted-foreground"
                  onClick={() => toggleExpand(node.id)}
                  aria-label={isExpanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
                  aria-expanded={isExpanded}
                  data-testid={`button-toggle-page-${node.id}`}
                >
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </Button>
              ) : (
                <span className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
              )}
              <Link
                href={pageHref(node.id)}
                className="flex items-center gap-2 flex-1 min-w-0 py-1"
                data-testid={`link-page-${node.id}`}
              >
                <span className="text-base flex-shrink-0">
                  {node.icon || "📄"}
                </span>
                <span className="text-sm break-words">{node.title}</span>
              </Link>

              <div className="actions flex items-center gap-0.5">
                <Popover 
                  open={activePopover === `subpage-${node.id}`} 
                  onOpenChange={(open) => {
                    if (open) openPopover(`subpage-${node.id}`);
                    else closePopover();
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => e.stopPropagation()}
                      data-testid={`button-add-subpage-${node.id}`}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-1" sideOffset={4}>
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      Choose a template
                    </div>
                    {pageTemplates.map((template) => (
                      <button
                        key={template.id}
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover-elevate text-left"
                        onClick={() => selectTemplateAndStartInline(template, node.id)}
                        data-testid={`button-template-${template.id}`}
                      >
                        <span className="text-base">{template.icon}</span>
                        <span>{template.name}</span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      data-testid={`button-page-menu-${node.id}`}
                    >
                      <MoreHorizontal className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEditDialog(node)}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDuplicate(node)}>
                      <Copy className="w-4 h-4 mr-2" />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => openDeleteDialog(node)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Children */}
            {hasChildren && isExpanded && (
              <Droppable droppableId={`parent-${node.id}`}>
                {(childProvided) => (
                  <div ref={childProvided.innerRef} {...childProvided.droppableProps}>
                    {node.children!.map((child, childIndex) => renderDraggableNode(child, depth + 1, childIndex))}
                    {childProvided.placeholder}
                  </div>
                )}
              </Droppable>
            )}
            {/* Show inline create row for this parent */}
            {inlineCreateParentId === node.id && renderInlineCreateRow(depth + 1)}
          </div>
        )}
      </Draggable>
    );
  };

  const renderNode = (node: DocumentWithChildren, depth: number = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isActive = currentDocumentId === node.id;

    return (
      <div key={node.id}>
        <div
          className={cn(
            "page-tree-item group flex items-center gap-1 py-1 px-2 rounded-md hover-elevate",
            isActive && "bg-accent"
          )}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          <Link
            href={pageHref(node.id)}
            className="flex items-center gap-2 flex-1 min-w-0 py-1"
            data-testid={`link-page-${node.id}`}
          >
            <span className="text-base flex-shrink-0">
              {node.icon || "📄"}
            </span>
            <span className="text-sm break-words">{node.title}</span>
          </Link>

          <div className="actions flex items-center gap-0.5">
            <Popover 
              open={activePopover === `subpage-${node.id}`} 
              onOpenChange={(open) => {
                if (open) openPopover(`subpage-${node.id}`);
                else closePopover();
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`button-add-subpage-${node.id}`}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-1" sideOffset={4}>
                <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                  Choose a template
                </div>
                {pageTemplates.map((template) => (
                  <button
                    key={template.id}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover-elevate text-left"
                    onClick={() => selectTemplateAndStartInline(template, node.id)}
                    data-testid={`button-template-${template.id}`}
                  >
                    <span className="text-base">{template.icon}</span>
                    <span>{template.name}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  data-testid={`button-page-menu-${node.id}`}
                >
                  <MoreHorizontal className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEditDialog(node)}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDuplicate(node)}>
                  <Copy className="w-4 h-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => openDeleteDialog(node)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Show children if expanded */}
        {isExpanded && (
          <div>
            {hasChildren && node.children!.map((child) => renderNode(child, depth + 1))}
            {/* Show inline create row under this parent */}
            {inlineCreateParentId === node.id && renderInlineCreateRow(depth + 1)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-sidebar">
      <div className="p-3 border-b border-sidebar-border flex items-center justify-between">
        <h3 className="font-medium text-sm">Pages</h3>
        <Popover 
          open={activePopover === "header"} 
          onOpenChange={(open) => {
            if (open) openPopover("header");
            else closePopover();
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              data-testid="button-new-page"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1" sideOffset={4}>
            <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
              Choose a template
            </div>
            {pageTemplates.map((template) => (
              <button
                key={template.id}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover-elevate text-left"
                onClick={() => selectTemplateAndStartInline(template, null)}
                data-testid={`button-template-root-${template.id}`}
              >
                <span className="text-base">{template.icon}</span>
                <span>{template.name}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Loading pages...
          </div>
        ) : tree.length === 0 && inlineCreateParentId === undefined ? (
          <div className="text-center py-8">
            <FileText className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-3">No pages yet</p>
            <Popover 
              open={activePopover === "empty"} 
              onOpenChange={(open) => {
                if (open) openPopover("empty");
                else closePopover();
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-create-first-page"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  New Page
                </Button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-56 p-1" sideOffset={4}>
                <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                  Choose a template
                </div>
                {pageTemplates.map((template) => (
                  <button
                    key={template.id}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm hover-elevate text-left"
                    onClick={() => selectTemplateAndStartInline(template, null)}
                    data-testid={`button-template-empty-${template.id}`}
                  >
                    <span className="text-base">{template.icon}</span>
                    <span>{template.name}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="parent-root">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {tree.map((node, index) => renderDraggableNode(node, 0, index))}
                  {provided.placeholder}
                  {inlineCreateParentId === null && renderInlineCreateRow(0)}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>

      <Dialog open={showEditPage} onOpenChange={setShowEditPage}>
        <DialogContent data-testid="dialog-edit-page">
          <DialogHeader>
            <DialogTitle>Rename Page</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Page title"
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUpdatePage()}
              autoFocus
              data-testid="input-edit-page-title"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditPage(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdatePage}
              disabled={!pageName.trim() || updateDocumentMutation.isPending}
              data-testid="button-save-page"
            >
              {updateDocumentMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeletePage} onOpenChange={setShowDeletePage}>
        <AlertDialogContent data-testid="dialog-delete-page">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Page</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedDocument?.title}"? This action cannot be undone.
              All subpages will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-page"
            >
              {deleteDocumentMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
