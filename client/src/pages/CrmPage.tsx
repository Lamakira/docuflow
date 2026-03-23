import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { ColumnVisibilityDropdown } from "@/components/ColumnVisibilityDropdown";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Search, 
  Plus, 
  ChevronLeft, 
  ChevronRight,
  User,
  ExternalLink,
  CheckCircle,
  CalendarDays,
  Building2,
  Mail,
  FolderKanban,
  Users,
  MoreHorizontal,
  Pencil,
  LayoutGrid,
  List,
  GripVertical,
  Trash2,
  StickyNote
} from "lucide-react";
import { Link } from "wouter";
import type { 
  CrmProjectWithDetails, 
  CrmClient, 
  CrmProjectStatus,
  CrmTag,
  CrmModuleField,
  SafeUser
} from "@shared/schema";

// Helper to parse field options from database format
interface ParsedOption {
  value: string;
  label: string;
  color: string;
}

function parseFieldOptions(options: string[] | null): ParsedOption[] {
  if (!options || options.length === 0) return [];
  return options.map(opt => {
    try {
      const parsed = JSON.parse(opt);
      if (parsed && typeof parsed === 'object' && parsed.label) {
        // New JSON format with label and color
        const value = parsed.label.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
        return { value, label: parsed.label, color: parsed.color || "#64748b" };
      }
    } catch {
      // Legacy format: just a string
    }
    const value = opt.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
    return { value, label: opt, color: "#64748b" };
  });
}

// Helper to check if a status represents "in review" state
function isReviewStatus(status: string): boolean {
  return status.toLowerCase().includes('review');
}

// Helper to calculate effective due date considering active review time
function getEffectiveDueDate(project: { 
  dueDate?: Date | string | null; 
  reviewStartedAt?: Date | string | null;
  status?: string;
}): { effectiveDueDate: Date | null; pausedMs: number; isPaused: boolean } {
  if (!project.dueDate) {
    return { effectiveDueDate: null, pausedMs: 0, isPaused: false };
  }
  
  const dueDate = new Date(project.dueDate);
  const isPaused = project.status ? isReviewStatus(project.status) : false;
  
  if (isPaused && project.reviewStartedAt) {
    // Project is currently in review - calculate how much time has been paused
    const reviewStartTime = new Date(project.reviewStartedAt).getTime();
    const pausedMs = Date.now() - reviewStartTime;
    const effectiveDueDate = new Date(dueDate.getTime() + pausedMs);
    return { effectiveDueDate, pausedMs, isPaused };
  }
  
  return { effectiveDueDate: dueDate, pausedMs: 0, isPaused };
}

// Fallback static config (used if API hasn't loaded yet)
const fallbackStatusConfig: Record<string, { label: string; color: string }> = {
  lead: { label: "Lead", color: "#64748b" },
  discovering_call_completed: { label: "Discovering Call Completed", color: "#8b5cf6" },
  proposal_sent: { label: "Proposal Sent", color: "#f59e0b" },
  follow_up: { label: "Follow Up", color: "#06b6d4" },
  in_negotiation: { label: "In Negotiation", color: "#3b82f6" },
  won: { label: "Won", color: "#22c55e" },
  won_not_started: { label: "Won - Not Started", color: "#10b981" },
  won_in_progress: { label: "Won - In Progress", color: "#14b8a6" },
  won_in_review: { label: "Won - In Review", color: "#0ea5e9" },
  won_completed: { label: "Won - Completed", color: "#84cc16" },
  lost: { label: "Lost", color: "#ef4444" },
  won_cancelled: { label: "Won-Cancelled", color: "#f43f5e" },
};

// Fallback contact status configuration (used if API hasn't loaded yet)
const fallbackContactStatusConfig: Record<string, { label: string; color: string }> = {
  lead: { label: "Lead", color: "#64748b" },
  prospect: { label: "Prospect", color: "#8b5cf6" },
  client: { label: "Client", color: "#22c55e" },
  client_recurrent: { label: "Client Récurrent", color: "#14b8a6" },
};

interface CrmProjectsResponse {
  data: CrmProjectWithDetails[];
  total: number;
  page: number;
  pageSize: number;
}

export default function CrmPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [activeTab, setActiveTab] = useState<string>("projects");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectViewFilter, setProjectViewFilter] = useState<string>("all");
  const [contactStatusFilter, setContactStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [, navigate] = useLocation();
  const [projectViewMode, setProjectViewMode] = useState<"table" | "kanban">("kanban");
  const [contactViewMode, setContactViewMode] = useState<"cards" | "table">("cards");
  const [hideInternalProjects, setHideInternalProjects] = useState(false);
  const [userFilter, setUserFilter] = useState<string>("all");
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const pageSize = 10;

  // Column visibility for projects table
  const projectColumnVisibility = useColumnVisibility({
    storageKey: "crm-projects-table",
    columns: [
      { id: "project", label: "Project", defaultVisible: true },
      { id: "client", label: "Client", defaultVisible: true },
      { id: "status", label: "Status", defaultVisible: true },
      { id: "tags", label: "Tags", defaultVisible: true },
      { id: "assigned", label: "Assigned", defaultVisible: true },
      { id: "start", label: "Start Date", defaultVisible: true },
      { id: "due", label: "Due Date", defaultVisible: true },
      { id: "finished", label: "Finished", defaultVisible: true },
      { id: "days", label: "Days", defaultVisible: true },
      { id: "lastNote", label: "Last Note", defaultVisible: true },
    ],
  });

  // Column visibility for contacts table
  const contactColumnVisibility = useColumnVisibility({
    storageKey: "crm-contacts-table",
    columns: [
      { id: "name", label: "Name", defaultVisible: true },
      { id: "company", label: "Company", defaultVisible: true },
      { id: "email", label: "Email", defaultVisible: true },
      { id: "status", label: "Status", defaultVisible: true },
      { id: "created", label: "Created", defaultVisible: true },
    ],
  });

  // Handle URL tab parameter
  useEffect(() => {
    if (!searchString) return;
    const params = new URLSearchParams(searchString);
    const tab = params.get("tab");
    if (tab === "projects" || tab === "contacts" || tab === "clients") {
      setActiveTab(tab === "contacts" ? "clients" : tab);
    }
  }, [searchString]);

  const { data: crmProjectsData, isLoading } = useQuery<CrmProjectsResponse>({
    queryKey: ["/api/crm/projects", page, pageSize, statusFilter !== "all" ? statusFilter : undefined, search || undefined],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("pageSize", pageSize.toString());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/crm/projects?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: clients = [], isLoading: clientsLoading } = useQuery<CrmClient[]>({
    queryKey: ["/api/crm/clients"],
  });

  // Fetch users for the user filter
  const { data: users = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch("/api/users", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch project module fields for dynamic status options
  const { data: projectFields = [], isLoading: projectFieldsLoading } = useQuery<CrmModuleField[]>({
    queryKey: ["/api/modules/projects/fields"],
  });

  // Fetch contacts module fields for dynamic status options
  const { data: contactFields = [], isLoading: contactFieldsLoading } = useQuery<CrmModuleField[]>({
    queryKey: ["/api/modules/contacts/fields"],
  });

  // Track if field configs are ready (prevents flash of old values)
  const fieldsReady = !projectFieldsLoading && !contactFieldsLoading;

  // Parse project status options from database
  const { statusOptions, statusConfig } = useMemo(() => {
    const statusField = projectFields.find(f => f.slug === "status");
    if (statusField && statusField.options && statusField.options.length > 0) {
      const parsed = parseFieldOptions(statusField.options);
      const config: Record<string, { label: string; color: string }> = {};
      const options: string[] = [];
      parsed.forEach(opt => {
        config[opt.value] = { label: opt.label, color: opt.color };
        options.push(opt.value);
      });
      return { statusOptions: options, statusConfig: config };
    }
    // Fallback to static config
    return { 
      statusOptions: Object.keys(fallbackStatusConfig), 
      statusConfig: fallbackStatusConfig 
    };
  }, [projectFields]);

  // Parse contact status options from database
  const { contactStatusOptions, contactStatusConfig } = useMemo(() => {
    const statusField = contactFields.find(f => f.slug === "status");
    if (statusField && statusField.options && statusField.options.length > 0) {
      const parsed = parseFieldOptions(statusField.options);
      const config: Record<string, { label: string; color: string }> = {};
      const options: string[] = [];
      parsed.forEach(opt => {
        config[opt.value] = { label: opt.label, color: opt.color };
        options.push(opt.value);
      });
      return { contactStatusOptions: options, contactStatusConfig: config };
    }
    // Fallback to static config
    return { 
      contactStatusOptions: Object.keys(fallbackContactStatusConfig), 
      contactStatusConfig: fallbackContactStatusConfig 
    };
  }, [contactFields]);

  // Parse project type options from database (for filtering)
  const projectTypeConfig = useMemo(() => {
    const typeField = projectFields.find(f => f.slug === "project_type");
    if (typeField && typeField.options && typeField.options.length > 0) {
      const parsed = parseFieldOptions(typeField.options);
      const config: Record<string, { label: string; color: string }> = {};
      parsed.forEach(opt => {
        config[opt.value] = { label: opt.label, color: opt.color };
      });
      return config;
    }
    // Fallback
    return {
      one_time: { label: "One-Time Project", color: "#3b82f6" },
      monthly: { label: "Monthly Retainer", color: "#8b5cf6" },
      hourly_budget: { label: "Hourly Budget", color: "#f59e0b" },
      internal: { label: "Internal", color: "#64748b" },
    };
  }, [projectFields]);

  // Fetch all projects for Kanban view
  const { data: allProjectsData } = useQuery<CrmProjectsResponse>({
    queryKey: ["/api/crm/projects/all-kanban"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/projects?pageSize=1000`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const updateProjectStatusMutation = useMutation({
    mutationFn: async ({ projectId, status }: { projectId: string; status: string }) => {
      await apiRequest("PATCH", `/api/crm/projects/${projectId}`, { status });
      return { projectId };
    },
    onMutate: async ({ projectId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/crm/projects/all-kanban"] });
      
      const previousData = queryClient.getQueryData<CrmProjectsResponse>(["/api/crm/projects/all-kanban"]);
      
      if (previousData) {
        queryClient.setQueryData<CrmProjectsResponse>(["/api/crm/projects/all-kanban"], {
          ...previousData,
          data: previousData.data.map(project => 
            project.id === projectId 
              ? { ...project, status: status as CrmProjectStatus }
              : project
          ),
        });
      }
      
      return { previousData, projectId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["/api/crm/projects/all-kanban"], context.previousData);
      }
      toast({ title: "Failed to update project status", variant: "destructive" });
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all-kanban"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", variables.projectId] });
    },
  });

  const filteredClients = clients.filter(client => {
    const matchesSearch = clientSearch === "" || 
      client.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
      client.company?.toLowerCase().includes(clientSearch.toLowerCase()) ||
      client.email?.toLowerCase().includes(clientSearch.toLowerCase());
    const matchesStatus = contactStatusFilter === "all" || client.status === contactStatusFilter;
    return matchesSearch && matchesStatus;
  });

  // Filter projects based on view filter (for Kanban and table view)
  const filterProjects = (projects: CrmProjectWithDetails[]) => {
    return projects.filter(project => {
      // Apply hide internal projects toggle
      if (hideInternalProjects && project.projectType === "internal") return false;
      
      // Apply status filter
      if (statusFilter !== "all" && project.status !== statusFilter) return false;
      
      // Apply user filter
      if (userFilter !== "all" && project.assigneeId !== userFilter) return false;
      
      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch = 
          project.project?.name?.toLowerCase().includes(searchLower) ||
          project.client?.name?.toLowerCase().includes(searchLower) ||
          project.client?.company?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }
      
      // Apply project view filter
      switch (projectViewFilter) {
        case "my_projects":
          return project.assigneeId === user?.id;
        case "internal":
          return project.projectType === "internal";
        case "client":
          return project.projectType !== "internal";
        case "all":
        default:
          return true;
      }
    });
  };

  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      await apiRequest("DELETE", `/api/crm/clients/${contactId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/clients"] });
      setDeleteContactId(null);
      toast({ title: "Contact deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete contact", variant: "destructive" });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest("DELETE", `/api/crm/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all-kanban"] });
      setDeleteProjectId(null);
      toast({ title: "Project deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete project", variant: "destructive" });
    },
  });

  const handleDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    
    const newStatus = destination.droppableId as CrmProjectStatus;
    
    updateProjectStatusMutation.mutate({ projectId: draggableId, status: newStatus });
  };

  // Kanban auto-scroll refs and handlers
  const kanbanScrollRef = useRef<HTMLDivElement>(null);
  const scrollAnimationRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const mousePositionRef = useRef({ x: 0, y: 0 });

  // Track mouse position globally during drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Auto-scroll animation loop
  useEffect(() => {
    const performScroll = () => {
      if (!isDraggingRef.current || !kanbanScrollRef.current) {
        scrollAnimationRef.current = requestAnimationFrame(performScroll);
        return;
      }

      const container = kanbanScrollRef.current;
      const rect = container.getBoundingClientRect();
      const { x, y } = mousePositionRef.current;
      
      const scrollZone = 100; // pixels from edge to trigger scroll
      const maxScrollSpeed = 15; // max pixels per frame
      
      // Horizontal scrolling
      if (x < rect.left + scrollZone && x > rect.left) {
        const intensity = 1 - (x - rect.left) / scrollZone;
        container.scrollLeft -= maxScrollSpeed * intensity;
      } else if (x > rect.right - scrollZone && x < rect.right) {
        const intensity = 1 - (rect.right - x) / scrollZone;
        container.scrollLeft += maxScrollSpeed * intensity;
      }
      
      // Vertical scrolling - query all columns and check which one the mouse is in
      const columnElements = container.querySelectorAll('[data-scroll-column]');
      columnElements.forEach((el) => {
        const columnElement = el as HTMLElement;
        const colRect = columnElement.getBoundingClientRect();
        
        // Check if mouse X is within this column's bounds (with some tolerance)
        if (x >= colRect.left - 20 && x <= colRect.right + 20) {
          // Check if column has scrollable content
          const hasScrollableContent = columnElement.scrollHeight > columnElement.clientHeight;
          
          if (hasScrollableContent) {
            // Scroll up when near top (include when mouse is above the column)
            if (y >= colRect.top - scrollZone && y <= colRect.top + scrollZone) {
              const distanceFromTop = Math.max(0, y - colRect.top);
              const intensity = distanceFromTop < 0 ? 1 : 1 - distanceFromTop / scrollZone;
              columnElement.scrollTop -= maxScrollSpeed * Math.max(0.3, intensity);
            } 
            // Scroll down when near bottom (include when mouse is below the column)
            else if (y >= colRect.bottom - scrollZone && y <= colRect.bottom + scrollZone) {
              const distanceFromBottom = Math.max(0, colRect.bottom - y);
              const intensity = distanceFromBottom < 0 ? 1 : 1 - distanceFromBottom / scrollZone;
              columnElement.scrollTop += maxScrollSpeed * Math.max(0.3, intensity);
            }
          }
        }
      });
      
      scrollAnimationRef.current = requestAnimationFrame(performScroll);
    };
    
    scrollAnimationRef.current = requestAnimationFrame(performScroll);
    
    return () => {
      if (scrollAnimationRef.current) {
        cancelAnimationFrame(scrollAnimationRef.current);
      }
    };
  }, []);

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const cleanupScroll = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const totalPages = crmProjectsData ? Math.ceil(crmProjectsData.total / pageSize) : 0;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Project Management</h1>
          <p className="text-sm text-muted-foreground hidden sm:block">Manage your projects and contact relationships</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full sm:w-auto">
          {activeTab === "clients" && (
            <>
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search contacts..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-client-search"
                />
              </div>
              {contactViewMode === "table" && (
                <Select value={contactStatusFilter} onValueChange={(v) => setContactStatusFilter(v)}>
                  <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-contact-status-filter">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {contactStatusOptions.map(status => (
                      <SelectItem key={status} value={status}>
                        <div className="flex items-center gap-2">
                          <Badge 
                            className="text-xs"
                            style={{ backgroundColor: contactStatusConfig[status]?.color || "#64748b", color: "white" }}
                          >
                            {contactStatusConfig[status]?.label || status}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-2">
                <div className="flex border rounded-md">
                  <Button
                    variant={contactViewMode === "cards" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setContactViewMode("cards")}
                    className="rounded-r-none"
                    data-testid="button-contact-cards-view"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={contactViewMode === "table" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setContactViewMode("table")}
                    className="rounded-l-none"
                    data-testid="button-contact-table-view"
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>
                <Button onClick={() => navigate("/crm/client/new")} size="icon" data-testid="button-add-contact">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
          {activeTab === "projects" && (
            <>
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search projects..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
              <Select value={projectViewFilter} onValueChange={(v) => { setProjectViewFilter(v); setPage(1); }}>
                <SelectTrigger className="w-full sm:w-[160px]" data-testid="select-project-view-filter">
                  <SelectValue placeholder="Project view" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  <SelectItem value="my_projects">My Projects</SelectItem>
                  <SelectItem value="internal">Internal Projects</SelectItem>
                  <SelectItem value="client">Client Projects</SelectItem>
                </SelectContent>
              </Select>
              {projectViewMode === "table" && (
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-status-filter">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {statusOptions.map(status => (
                      <SelectItem key={status} value={status}>
                        {statusConfig[status]?.label || status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-2">
                <div className="flex border rounded-md">
                  <Button
                    variant={projectViewMode === "kanban" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setProjectViewMode("kanban")}
                    className="rounded-r-none"
                    data-testid="button-kanban-view"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={projectViewMode === "table" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setProjectViewMode("table")}
                    className="rounded-l-none"
                    data-testid="button-table-view"
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>
                <Link href="/crm/project/new">
                  <Button size="icon" data-testid="button-new-project">
                    <Plus className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList className="bg-muted/80 p-1 h-auto">
            <TabsTrigger value="projects" className="gap-2 px-4 py-2 data-[state=active]:border data-[state=active]:border-border" data-testid="tab-projects">
              <FolderKanban className="w-4 h-4" />
              Projects
              {(allProjectsData?.total ?? crmProjectsData?.total ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1">{allProjectsData?.total ?? crmProjectsData?.total}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="clients" className="gap-2 px-4 py-2 data-[state=active]:border data-[state=active]:border-border" data-testid="tab-clients">
              <Users className="w-4 h-4" />
              Contacts
              {clients.length > 0 && (
                <Badge variant="secondary" className="ml-1">{clients.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {activeTab === "projects" && (
            <div className="flex items-center gap-3">
              {user?.role === "admin" && (
                <Select value={userFilter} onValueChange={setUserFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="select-user-filter">
                    <User className="w-4 h-4 mr-1" />
                    <SelectValue placeholder="Filter by user" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {users.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-5 h-5">
                            <AvatarImage src={u.profileImageUrl || undefined} />
                            <AvatarFallback className="text-xs">
                              {(u.firstName?.[0] || "") + (u.lastName?.[0] || "")}
                            </AvatarFallback>
                          </Avatar>
                          <span>{u.firstName} {u.lastName}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-2 px-2 py-1 border rounded-md bg-muted/30">
                <Switch
                  id="hide-internal"
                  checked={hideInternalProjects}
                  onCheckedChange={setHideInternalProjects}
                  data-testid="switch-hide-internal"
                />
                <Label htmlFor="hide-internal" className="text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                  Hide internal
                </Label>
              </div>
              {projectViewMode === "table" && (
                <ColumnVisibilityDropdown
                  columns={projectColumnVisibility.columns}
                  visibleColumns={projectColumnVisibility.visibleColumns}
                  toggleColumn={projectColumnVisibility.toggleColumn}
                  resetToDefaults={projectColumnVisibility.resetToDefaults}
                />
              )}
            </div>
          )}

          {activeTab === "clients" && contactViewMode === "table" && (
            <div className="flex items-center gap-3">
              <ColumnVisibilityDropdown
                columns={contactColumnVisibility.columns}
                visibleColumns={contactColumnVisibility.visibleColumns}
                toggleColumn={contactColumnVisibility.toggleColumn}
                resetToDefaults={contactColumnVisibility.resetToDefaults}
              />
            </div>
          )}
        </div>

        <TabsContent value="projects" className="space-y-4 mt-0">
          {projectViewMode === "kanban" ? (
            !fieldsReady ? (
              <div className="flex gap-4 min-w-max items-stretch">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-72 flex-shrink-0">
                    <div className="bg-muted rounded-lg p-3 min-h-[400px] h-[calc(100vh-280px)]">
                      <div className="flex items-center gap-2 mb-3">
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="h-4 w-6" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-32 w-full" />
                        <Skeleton className="h-32 w-full" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
            <DragDropContext onDragEnd={(result) => { cleanupScroll(); handleDragEnd(result); }} onDragStart={handleDragStart}>
              <div ref={kanbanScrollRef} className="overflow-x-auto pb-4 custom-scrollbar-x">
                <div className="flex gap-4 min-w-max items-stretch">
                  {statusOptions.map((status) => {
                    const filteredProjects = filterProjects(allProjectsData?.data || []);
                    const projectsInColumn = filteredProjects.filter(p => p.status === status);
                    return (
                      <div
                        key={status}
                        className="w-72 flex-shrink-0 flex flex-col bg-muted rounded-lg overflow-hidden h-[calc(100vh-280px)]"
                        data-testid={`kanban-column-${status}`}
                      >
                        {/* Sticky Header - outside scrollable area */}
                        <div className="flex items-center justify-between p-3 pb-2 bg-muted z-20 relative">
                          <div className="flex items-center gap-2">
                            <Badge 
                              style={{ backgroundColor: statusConfig[status]?.color || "#64748b", color: "white" }}
                            >
                              {statusConfig[status]?.label || status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {projectsInColumn.length}
                            </span>
                          </div>
                        </div>
                        {/* Scrollable Content Area */}
                        <Droppable droppableId={status}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.droppableProps}
                              data-scroll-column={status}
                              className={`flex-1 overflow-y-auto overflow-x-hidden scrollbar-hidden px-3 pb-3 transition-colors ${snapshot.isDraggingOver ? "bg-muted/60" : ""}`}
                            >
                              <div className="space-y-2 relative z-[1]">
                                {projectsInColumn.map((project, index) => (
                                  <Draggable key={project.id} draggableId={project.id} index={index}>
                                    {(provided, snapshot) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                      >
                                        <Card
                                          className={`hover-elevate cursor-grab group ${snapshot.isDragging ? "shadow-lg rotate-2" : ""}`}
                                          onClick={() => {
                                            if (!snapshot.isDragging) {
                                              window.open(`/crm/project/${project.id}`, '_blank');
                                            }
                                          }}
                                          data-testid={`kanban-card-${project.id}`}
                                        >
                                          <CardContent className="p-3">
                                            <div className="flex items-start gap-2">
                                              <GripVertical className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                                              <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm break-words">
                                                  {project.project?.name || "Unknown"}
                                                </p>
                                                {project.client && (
                                                  <p className="text-xs text-muted-foreground truncate mt-1">
                                                    {project.client.name}
                                                  </p>
                                                )}
                                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                                                  {project.startDate && (
                                                    <span>Start: {format(new Date(project.startDate), "MMM d, yyyy")}</span>
                                                  )}
                                                  {project.budgetedHours ? (
                                                    <span>{project.budgetedHours}h budgeted</span>
                                                  ) : null}
                                                </div>
                                                {project.dueDate && (() => {
                                                  const { effectiveDueDate, isPaused } = getEffectiveDueDate(project);
                                                  if (!effectiveDueDate) return null;
                                                  const isOverdue = effectiveDueDate < new Date() && project.status !== "finished";
                                                  return (
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                      <p className={`text-xs ${isOverdue ? "text-destructive" : "text-muted-foreground"}`}>
                                                        Due: {format(effectiveDueDate, "MMM d, yyyy")}
                                                      </p>
                                                      {isPaused && (
                                                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500 text-amber-600 dark:text-amber-400">
                                                          Paused
                                                        </Badge>
                                                      )}
                                                    </div>
                                                  );
                                                })()}
                                                {project.assignee && (
                                                  <div className="flex items-center gap-1.5 mt-2">
                                                    <Avatar className="w-5 h-5">
                                                      <AvatarImage src={project.assignee.profileImageUrl || undefined} />
                                                      <AvatarFallback className="text-[10px]">
                                                        {project.assignee.firstName?.[0]}{project.assignee.lastName?.[0]}
                                                      </AvatarFallback>
                                                    </Avatar>
                                                    <span className="text-xs text-muted-foreground truncate">
                                                      {project.assignee.firstName}
                                                    </span>
                                                  </div>
                                                )}
                                                {project.tags && project.tags.length > 0 && (
                                                  <div className="flex flex-wrap gap-1 mt-2">
                                                    {project.tags.slice(0, 3).map((tag) => (
                                                      <Badge 
                                                        key={tag.id}
                                                        className="text-[10px] px-1.5 py-0"
                                                        style={{ backgroundColor: tag.color, color: "white" }}
                                                        data-testid={`kanban-tag-${tag.id}`}
                                                      >
                                                        {tag.name}
                                                      </Badge>
                                                    ))}
                                                    {project.tags.length > 3 && (
                                                      <span className="text-[10px] text-muted-foreground">
                                                        +{project.tags.length - 3}
                                                      </span>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setDeleteProjectId(project.id);
                                                }}
                                                data-testid={`button-delete-kanban-${project.id}`}
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </Button>
                                            </div>
                                          </CardContent>
                                        </Card>
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {provided.placeholder}
                                {projectsInColumn.length === 0 && !snapshot.isDraggingOver && (
                                  <div className="text-center py-4 text-xs text-muted-foreground">
                                    No projects
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </Droppable>
                      </div>
                    );
                  })}
                </div>
              </div>
            </DragDropContext>
            )
          ) : (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto custom-scrollbar-x">
                  <table className="w-full min-w-[900px]">
                    <thead>
                      <tr className="bg-muted whitespace-nowrap">
                        {projectColumnVisibility.isColumnVisible("project") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Project</th>}
                        {projectColumnVisibility.isColumnVisible("client") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Client</th>}
                        {projectColumnVisibility.isColumnVisible("status") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Status</th>}
                        {projectColumnVisibility.isColumnVisible("tags") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Tags</th>}
                        {projectColumnVisibility.isColumnVisible("assigned") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Assigned</th>}
                        {projectColumnVisibility.isColumnVisible("start") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Start</th>}
                        {projectColumnVisibility.isColumnVisible("due") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Due</th>}
                        {projectColumnVisibility.isColumnVisible("finished") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Finished</th>}
                        {projectColumnVisibility.isColumnVisible("days") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Days</th>}
                        {projectColumnVisibility.isColumnVisible("lastNote") && <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Last Note</th>}
                        <th className="text-right px-4 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {isLoading ? (
                        <tr>
                          <td colSpan={11} className="p-8 text-center text-muted-foreground">
                            Loading projects...
                          </td>
                        </tr>
                      ) : (() => {
                          const tableProjects = filterProjects(crmProjectsData?.data || []);
                          return tableProjects.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="p-8 text-center text-muted-foreground">
                            No projects found. Add your first project to get started.
                          </td>
                        </tr>
                      ) : (
                        tableProjects.map((crmProject) => (
                          <tr 
                            key={crmProject.id} 
                            className="hover:bg-muted/50 cursor-pointer whitespace-nowrap transition-colors"
                            onClick={() => window.open(`/crm/project/${crmProject.id}`, '_blank')}
                            data-testid={`row-crm-project-${crmProject.id}`}
                          >
                            {projectColumnVisibility.isColumnVisible("project") && (
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                                    <FolderKanban className="w-4 h-4 text-primary" />
                                  </div>
                                  <div>
                                    <span className="font-medium text-sm">{crmProject.project?.name || "Unknown"}</span>
                                    {crmProject.documentationEnabled === 1 && (
                                      <Link 
                                        href={`/project/${crmProject.projectId}`} 
                                        onClick={(e) => e.stopPropagation()}
                                        className="ml-1.5"
                                      >
                                        <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-foreground inline" />
                                      </Link>
                                    )}
                                  </div>
                                </div>
                              </td>
                            )}
                            {projectColumnVisibility.isColumnVisible("client") && (
                              <td className="px-4 py-3">
                                {crmProject.client ? (
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                                      <User className="w-3 h-3 text-muted-foreground" />
                                    </div>
                                    <span className="text-sm">{crmProject.client.name}</span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </td>
                            )}
                            {projectColumnVisibility.isColumnVisible("status") && (
                              <td className="px-4 py-3">
                                <Badge 
                                  className="text-xs"
                                  style={{ backgroundColor: statusConfig[crmProject.status]?.color || "#64748b", color: "white" }}
                                >
                                  {statusConfig[crmProject.status]?.label || crmProject.status}
                                </Badge>
                              </td>
                            )}
                            {projectColumnVisibility.isColumnVisible("tags") && (
                              <td className="px-4 py-3">
                                {crmProject.tags && crmProject.tags.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {crmProject.tags.slice(0, 2).map((tag) => (
                                      <Badge 
                                        key={tag.id}
                                        className="text-[10px] px-1.5 py-0"
                                        style={{ backgroundColor: tag.color, color: "white" }}
                                        data-testid={`table-tag-${tag.id}`}
                                      >
                                        {tag.name}
                                      </Badge>
                                    ))}
                                    {crmProject.tags.length > 2 && (
                                      <span className="text-[10px] text-muted-foreground">
                                        +{crmProject.tags.length - 2}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </td>
                            )}
                            {projectColumnVisibility.isColumnVisible("assigned") && (
                              <td className="px-4 py-3">
                                {crmProject.assignee ? (
                                  <div className="flex items-center gap-2">
                                    <Avatar className="w-6 h-6">
                                      <AvatarImage src={crmProject.assignee.profileImageUrl || undefined} />
                                      <AvatarFallback className="text-[10px]">
                                        {crmProject.assignee.firstName?.[0]}{crmProject.assignee.lastName?.[0]}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span className="text-sm">{crmProject.assignee.firstName}</span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </td>
                            )}
                            {projectColumnVisibility.isColumnVisible("start") && (
                              <td className="px-4 py-3">
                                {crmProject.startDate ? (
                                  <span className="text-sm text-muted-foreground">
                                    {format(new Date(crmProject.startDate), "MMM d, yyyy")}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </td>
                            )}
                            {projectColumnVisibility.isColumnVisible("due") && (
                              <td className="px-4 py-3">
                                {crmProject.dueDate ? (() => {
                                  const { effectiveDueDate, isPaused } = getEffectiveDueDate(crmProject);
                                  if (!effectiveDueDate) return <span className="text-muted-foreground text-sm">—</span>;
                                  const isOverdue = effectiveDueDate < new Date() && crmProject.status !== "finished";
                                  return (
                                    <div className="flex items-center gap-1.5">
                                      <span className={isOverdue ? "text-destructive text-sm font-medium" : "text-sm"}>
                                        {format(effectiveDueDate, "MMM d, yyyy")}
                                      </span>
                                      {isPaused && (
                                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500 text-amber-600 dark:text-amber-400">
                                          Paused
                                        </Badge>
                                      )}
                                    </div>
                                  );
                                })() : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </td>
                            )}
                            {projectColumnVisibility.isColumnVisible("finished") && (
                              <td className="px-4 py-3">
                                {crmProject.actualFinishDate ? (
                                  <div className="flex items-center gap-1.5">
                                    <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                                    <span className="text-sm text-green-600 dark:text-green-400">
                                      {format(new Date(crmProject.actualFinishDate), "MMM d, yyyy")}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </td>
                            )}
                            {projectColumnVisibility.isColumnVisible("days") && (
                              <td className="px-4 py-3">
                                {crmProject.dueDate && crmProject.actualFinishDate ? (() => {
                                  const { effectiveDueDate } = getEffectiveDueDate(crmProject);
                                  if (!effectiveDueDate) return <span className="text-muted-foreground text-sm">—</span>;
                                  const actualDate = new Date(crmProject.actualFinishDate);
                                  const diffTime = effectiveDueDate.getTime() - actualDate.getTime();
                                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                  if (diffDays > 0) {
                                    return (
                                      <Badge variant="default" className="text-xs">
                                        {diffDays}d early
                                      </Badge>
                                    );
                                  } else if (diffDays < 0) {
                                    return (
                                      <Badge variant="destructive" className="text-xs">
                                        {Math.abs(diffDays)}d late
                                      </Badge>
                                    );
                                  } else {
                                    return (
                                      <Badge variant="secondary" className="text-xs">
                                        On time
                                      </Badge>
                                    );
                                  }
                                })() : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </td>
                            )}
                            {projectColumnVisibility.isColumnVisible("lastNote") && (
                              <td className="px-4 py-3 max-w-[200px]">
                                {crmProject.latestNote ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex items-center gap-1.5 cursor-default">
                                        <StickyNote className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        <span className="text-sm text-muted-foreground truncate">
                                          {crmProject.latestNote.content.substring(0, 40)}{crmProject.latestNote.content.length > 40 ? "..." : ""}
                                        </span>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-[300px]">
                                      <p className="text-sm whitespace-pre-wrap">{crmProject.latestNote.content}</p>
                                      <p className="text-xs text-muted-foreground mt-1">
                                        — {crmProject.latestNote.createdBy?.firstName} {crmProject.latestNote.createdBy?.lastName}{crmProject.latestNote.createdAt ? `, ${format(new Date(crmProject.latestNote.createdAt), "MMM d, yyyy")}` : ""}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </td>
                            )}
                            <td className="px-4 py-3 text-right">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="w-7 h-7"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteProjectId(crmProject.id);
                                }}
                                data-testid={`button-delete-project-${crmProject.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )
                        })()}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="p-4 border-t">
                    <div className="flex items-center justify-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm">
                        Page {page} of {totalPages}
                      </span>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        data-testid="button-next-page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="clients" className="space-y-4 mt-0">
          {contactViewMode === "cards" ? (
            <div className="space-y-2">
              {clientsLoading ? (
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    Loading contacts...
                  </CardContent>
                </Card>
              ) : filteredClients.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    <User className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>{clients.length === 0 
                      ? "No contacts yet. Add your first contact to get started."
                      : "No contacts match your search."}</p>
                  </CardContent>
                </Card>
              ) : (
                filteredClients.map((client) => (
                  <Card
                    key={client.id}
                    className="hover-elevate cursor-pointer transition-colors"
                    onClick={() => setLocation(`/crm/client/${client.id}`)}
                    data-testid={`row-client-${client.id}`}
                  >
                    <CardContent className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="w-3 h-3 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate" data-testid={`text-client-name-${client.id}`}>
                                {client.name}
                              </p>
                              {client.status && (
                                <Badge 
                                  className="text-xs py-0"
                                  style={{ backgroundColor: contactStatusConfig[client.status]?.color || "#64748b", color: "white" }}
                                  data-testid={`badge-client-status-${client.id}`}
                                >
                                  {contactStatusConfig[client.status]?.label || client.status}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {client.company && (
                                <span className="flex items-center gap-1 truncate">
                                  <Building2 className="w-3 h-3 shrink-0" />
                                  {client.company}
                                </span>
                              )}
                              {client.email && (
                                <span className="flex items-center gap-1 truncate">
                                  <Mail className="w-3 h-3 shrink-0" />
                                  {client.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-xs text-muted-foreground hidden sm:block">
                            {client.createdAt ? format(new Date(client.createdAt), "MMM d, yyyy") : ""}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="w-7 h-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteContactId(client.id);
                            }}
                            data-testid={`button-delete-contact-${client.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="w-7 h-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLocation(`/crm/client/${client.id}`);
                            }}
                            data-testid={`button-view-contact-${client.id}`}
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto custom-scrollbar-x">
                  <table className="w-full min-w-[700px]">
                    <thead>
                      <tr className="border-b bg-muted/50 whitespace-nowrap">
                        {contactColumnVisibility.isColumnVisible("name") && <th className="text-left px-3 py-2 font-medium text-sm">Name</th>}
                        {contactColumnVisibility.isColumnVisible("company") && <th className="text-left px-3 py-2 font-medium text-sm">Company</th>}
                        {contactColumnVisibility.isColumnVisible("email") && <th className="text-left px-3 py-2 font-medium text-sm">Email</th>}
                        {contactColumnVisibility.isColumnVisible("status") && <th className="text-left px-3 py-2 font-medium text-sm">Status</th>}
                        {contactColumnVisibility.isColumnVisible("created") && <th className="text-left px-3 py-2 font-medium text-sm">Created</th>}
                        <th className="text-right px-3 py-2 font-medium w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientsLoading ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-muted-foreground">
                            Loading contacts...
                          </td>
                        </tr>
                      ) : filteredClients.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-muted-foreground">
                            {clients.length === 0 
                              ? "No contacts yet. Add your first contact to get started."
                              : "No contacts match your search."}
                          </td>
                        </tr>
                      ) : (
                        filteredClients.map((client) => (
                          <tr 
                            key={client.id} 
                            className="border-b hover-elevate cursor-pointer whitespace-nowrap"
                            onClick={() => setLocation(`/crm/client/${client.id}`)}
                            data-testid={`row-client-table-${client.id}`}
                          >
                            {contactColumnVisibility.isColumnVisible("name") && (
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                                    <User className="w-2.5 h-2.5 text-primary" />
                                  </div>
                                  <span className="font-medium text-sm">{client.name}</span>
                                </div>
                              </td>
                            )}
                            {contactColumnVisibility.isColumnVisible("company") && (
                              <td className="px-3 py-2 text-muted-foreground text-sm">{client.company || "-"}</td>
                            )}
                            {contactColumnVisibility.isColumnVisible("email") && (
                              <td className="px-3 py-2 text-muted-foreground text-sm">{client.email || "-"}</td>
                            )}
                            {contactColumnVisibility.isColumnVisible("status") && (
                              <td className="px-3 py-2">
                                {client.status ? (
                                  <Badge 
                                    className="text-xs"
                                    style={{ backgroundColor: contactStatusConfig[client.status]?.color || "#64748b", color: "white" }}
                                    data-testid={`badge-client-table-status-${client.id}`}
                                  >
                                    {contactStatusConfig[client.status]?.label || client.status}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </td>
                            )}
                            {contactColumnVisibility.isColumnVisible("created") && (
                              <td className="px-3 py-2 text-muted-foreground text-sm">
                                {client.createdAt ? format(new Date(client.createdAt), "MMM d, yyyy") : "-"}
                              </td>
                            )}
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-0.5">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="w-7 h-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteContactId(client.id);
                                  }}
                                  data-testid={`button-delete-contact-table-${client.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="w-7 h-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLocation(`/crm/client/${client.id}`);
                                  }}
                                  data-testid={`button-view-contact-table-${client.id}`}
                                >
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete Contact Confirmation */}
      <AlertDialog open={!!deleteContactId} onOpenChange={(open) => !open && setDeleteContactId(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this contact? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:gap-0">
            <AlertDialogCancel className="w-full sm:w-auto">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteContactId && deleteContactMutation.mutate(deleteContactId)}
              className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Project Confirmation */}
      <AlertDialog open={!!deleteProjectId} onOpenChange={(open) => !open && setDeleteProjectId(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this project? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:gap-0">
            <AlertDialogCancel className="w-full sm:w-auto">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteProjectId && deleteProjectMutation.mutate(deleteProjectId)}
              className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
