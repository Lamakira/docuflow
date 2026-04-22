import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { Folder, ChevronRight, MoreHorizontal, Pencil, LogOut, FileText, Sparkles, Briefcase, Building2, Shield, Clock, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChatBot } from "@/components/ChatBot";
import { NotificationBell } from "@/components/NotificationBell";
import { TimeTracker } from "@/components/TimeTracker";
import type { Project } from "@shared/schema";

export function AppSidebar() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const params = useParams();
  const currentProjectId = params?.projectId;
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const [showEditProject, setShowEditProject] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects/documentable"],
  });

  const updateProjectMutation = useMutation({
    mutationFn: async (data: { id: string; name: string }) => {
      return await apiRequest("PATCH", `/api/projects/${data.id}`, { name: data.name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects/documentable"] });
      setShowEditProject(false);
      setSelectedProject(null);
      setProjectName("");
      toast({ title: "Project updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update project", variant: "destructive" });
    },
  });

  const [, setLocation] = useLocation();

  const handleLogout = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      queryClient.cancelQueries();
      queryClient.setQueryData(["/api/auth/user"], null);
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] !== "/api/auth/user",
      });
      window.location.href = "/auth";
    } catch (error) {
      console.error("Logout failed:", error);
      window.location.href = "/auth";
    }
  }, []);

  const handleUpdateProject = () => {
    if (!selectedProject || !projectName.trim()) return;
    updateProjectMutation.mutate({ id: selectedProject.id, name: projectName.trim() });
  };

  const openEditDialog = (project: Project) => {
    setSelectedProject(project);
    setProjectName(project.name);
    setShowEditProject(true);
  };

  const getProjectIcon = (iconName: string | null) => {
    switch (iconName) {
      case "book": return "📚";
      case "code": return "💻";
      case "rocket": return "🚀";
      case "star": return "⭐";
      case "zap": return "⚡";
      case "heart": return "❤️";
      case "globe": return "🌍";
      default: return "📁";
    }
  };

  const userName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.email || "User";

  const userInitials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.email?.[0]?.toUpperCase() || "U";

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-4 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center">
          <div className={`flex items-center ${isCollapsed ? 'justify-center w-full' : 'justify-between'}`}>
            <Link href="/" className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-primary-foreground" />
              </div>
              {!isCollapsed && (
                <span className="font-semibold text-base tracking-tight" data-testid="text-sidebar-brand">DocuFlow</span>
              )}
            </Link>
          </div>
        </SidebarHeader>

        <SidebarContent className="custom-scrollbar px-3 group-data-[collapsible=icon]:px-2">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/company-documents" || location.startsWith("/company-documents/")}
                    className="h-9 rounded-md"
                  >
                    <Link
                      href="/company-documents"
                      className={`flex items-center w-full ${isCollapsed ? 'justify-center' : 'gap-3'}`}
                      data-testid="link-company-documents"
                    >
                      <Building2 className="w-4 h-4 shrink-0" />
                      {!isCollapsed && <span className="text-sm">Company Documents</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/crm" || location.startsWith("/crm/")}
                    className="h-9 rounded-md"
                  >
                    <Link
                      href="/crm"
                      className={`flex items-center w-full ${isCollapsed ? 'justify-center' : 'gap-3'}`}
                      data-testid="link-crm"
                    >
                      <Briefcase className="w-4 h-4 shrink-0" />
                      {!isCollapsed && <span className="text-sm">Project Management</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/documentation" || location.startsWith("/project/") || location.startsWith("/document/")}
                    className="h-9 rounded-md"
                  >
                    <Link
                      href="/documentation"
                      className={`flex items-center w-full ${isCollapsed ? 'justify-center' : 'gap-3'}`}
                      data-testid="link-documentation"
                    >
                      <FileText className="w-4 h-4 shrink-0" />
                      {!isCollapsed && <span className="text-sm">Documentation</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/time-tracking" || location.startsWith("/time-tracking/") || location === "/devices"}
                    className="h-9 rounded-md"
                  >
                    <Link
                      href="/time-tracking"
                      className={`flex items-center w-full ${isCollapsed ? 'justify-center' : 'gap-3'}`}
                      data-testid="link-time-tracking"
                    >
                      <Clock className="w-4 h-4 shrink-0" />
                      {!isCollapsed && <span className="text-sm">Time Tracking</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/help-center" || location.startsWith("/help-center/")}
                    className="h-9 rounded-md"
                  >
                    <Link
                      href="/help-center"
                      className={`flex items-center w-full ${isCollapsed ? 'justify-center' : 'gap-3'}`}
                      data-testid="link-help-center"
                    >
                      <CircleHelp className="w-4 h-4 shrink-0" />
                      {!isCollapsed && <span className="text-sm">Help Center</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {user?.role === "admin" && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin" || location.startsWith("/admin/")}
                      className="h-9 rounded-md"
                    >
                      <Link
                        href="/admin"
                        className={`flex items-center w-full ${isCollapsed ? 'justify-center' : 'gap-3'}`}
                        data-testid="link-admin"
                      >
                        <Shield className="w-4 h-4 shrink-0" />
                        {!isCollapsed && <span className="text-sm">Administration</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="mt-auto p-3 group-data-[collapsible=icon]:p-2">
          <div className="flex items-center justify-start gap-1 mb-3 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:mb-2 group-data-[collapsible=icon]:items-center">
            <SidebarTrigger data-testid="button-sidebar-toggle" className="h-8 w-8 shrink-0 flex items-center justify-center" />
            <NotificationBell />
            <ChatBot />
            <TimeTracker iconOnly={true} />
            <ThemeToggle />
          </div>
          
          <div className="flex flex-row items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:items-center">
            <Button
              variant="ghost"
              className="flex-1 max-w-[calc(100%-2.5rem)] justify-start gap-3 h-11 px-2 rounded-lg hover:bg-sidebar-accent group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:max-w-none group-data-[collapsible=icon]:justify-center"
              data-testid="button-user-menu"
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage src={user?.profileImageUrl || undefined} className="object-cover" />
                <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">{userInitials}</AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium truncate">{userName}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-sidebar-accent flex items-center justify-center"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <Dialog open={showEditProject} onOpenChange={setShowEditProject}>
        <DialogContent data-testid="dialog-edit-project">
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
            <DialogDescription>
              Update your project name.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project Name</label>
              <Input
                placeholder="Enter project name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUpdateProject()}
                data-testid="input-edit-project-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditProject(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateProject}
              disabled={!projectName.trim() || updateProjectMutation.isPending}
              data-testid="button-save-project"
            >
              {updateProjectMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

