import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TimeTracker } from "@/components/TimeTracker";
import { TimeTrackerProvider } from "@/contexts/TimeTrackerContext";
import { FileText } from "lucide-react";
import Landing from "@/pages/Landing";
import AuthPage from "@/pages/AuthPage";
import Home from "@/pages/Home";
import ProjectPage from "@/pages/ProjectPage";
import DocumentPage from "@/pages/DocumentPage";
import CrmPage from "@/pages/CrmPage";
import CrmProjectPage from "@/pages/CrmProjectPage";
import ProjectCreatePage from "@/pages/ProjectCreatePage";
import ClientDetailPage from "@/pages/ClientDetailPage";
import ContactCreatePage from "@/pages/ContactCreatePage";
import DocumentationPage from "@/pages/DocumentationPage";
import CompanyDocumentsPage from "@/pages/CompanyDocumentsPage";
import CompanyDocumentEditorPage from "@/pages/CompanyDocumentEditorPage";
import FileViewerPage from "@/pages/FileViewerPage";
import AdminPage from "@/pages/AdminPage";
import TimeTrackingPage from "@/pages/TimeTrackingPage";
import DevicesPage from "@/pages/DevicesPage";
import TimeTrackingProjectsPage from "@/pages/TimeTrackingProjectsPage";
import TimeTrackingDownloadPage from "@/pages/TimeTrackingDownloadPage";
import TimeTrackingDashboardPage from "@/pages/TimeTrackingDashboardPage";
import ScreencastsPage from "@/pages/ScreencastsPage";
import NotFound from "@/pages/not-found";

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const style = {
    "--sidebar-width": "13rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <TimeTrackerProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full bg-background">
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0 bg-background">
            <header className="flex md:hidden items-center justify-between gap-3 px-4 py-3 border-b bg-background sticky top-0 z-50">
              <div className="flex items-center gap-3">
                <SidebarTrigger data-testid="button-mobile-sidebar-toggle" />
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-primary flex items-center justify-center w-7 h-7">
                    <FileText className="w-3.5 h-3.5 text-primary-foreground" />
                  </div>
                  <span className="font-semibold text-sm">DocuFlow</span>
                </div>
              </div>
              <TimeTracker testId="button-time-tracker-mobile" />
            </header>
            <main className="flex-1 overflow-auto bg-background scrollbar-hide">
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </TimeTrackerProvider>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-primary/20"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/auth" component={AuthPage} />
        <Route component={Landing} />
      </Switch>
    );
  }

  return (
    <AuthenticatedLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/crm" component={CrmPage} />
        <Route path="/crm/project/new" component={ProjectCreatePage} />
        <Route path="/crm/project/:id" component={CrmProjectPage} />
        <Route path="/crm/client/new" component={ContactCreatePage} />
        <Route path="/crm/client/:id" component={ClientDetailPage} />
        <Route path="/documentation" component={DocumentationPage} />
        <Route path="/company-documents" component={CompanyDocumentsPage} />
        <Route path="/company-documents/:id/edit" component={CompanyDocumentEditorPage} />
        <Route path="/company-documents/:id/view" component={FileViewerPage} />
        <Route path="/project/:projectId" component={ProjectPage} />
        <Route path="/document/:documentId" component={DocumentPage} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/admin/create" component={AdminPage} />
        <Route path="/admin/user/:id" component={AdminPage} />
        <Route path="/time-tracking" component={TimeTrackingPage} />
        <Route path="/time-tracking/projects" component={TimeTrackingProjectsPage} />
        <Route path="/time-tracking/devices" component={DevicesPage} />
        <Route path="/time-tracking/download" component={TimeTrackingDownloadPage} />
        <Route path="/time-tracking/dashboard" component={TimeTrackingDashboardPage} />
        <Route path="/time-tracking/screencasts" component={ScreencastsPage} />
        <Route path="/devices" component={DevicesPage} />
        <Route component={NotFound} />
      </Switch>
    </AuthenticatedLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="docuflow-theme">
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
