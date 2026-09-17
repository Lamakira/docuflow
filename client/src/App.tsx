import { Switch, Route, Redirect, useLocation } from "wouter";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { flags } from "@/lib/featureFlags";
import { authenticatedPresentation } from "@/v2/presentation";
import { V2AuthenticatedApp } from "@/v2/V2AuthenticatedApp";
import { V2InvitationAcceptPage } from "@/v2/V2InvitationAccept";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { IdentityProviderSession } from "@/components/IdentityProviderSession";
import { useWebAuthConfig, WebAuthConfigProvider } from "@/lib/webAuthConfig";
import { SIGN_UP_PATH } from "@/lib/registration";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TimeTracker } from "@/components/TimeTracker";
import { TimeTrackerProvider } from "@/contexts/TimeTrackerContext";
import { FileText } from "lucide-react";
import AuthPage, { SignUpPage } from "@/pages/AuthPage";
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
import AdminAnalyticsPage from "@/pages/AdminAnalyticsPage";
import DailyUpdatePage from "@/pages/DailyUpdatePage";
import DailyUpdatesAdminPage from "@/pages/DailyUpdatesAdminPage";
import TimeTrackingPage from "@/pages/TimeTrackingPage";
import DevicesPage from "@/pages/DevicesPage";
import TimeTrackingProjectsPage from "@/pages/TimeTrackingProjectsPage";
import TimeTrackingDownloadPage from "@/pages/TimeTrackingDownloadPage";
import TimeTrackingDashboardPage from "@/pages/TimeTrackingDashboardPage";
import ScreencastsPage from "@/pages/ScreencastsPage";
import HelpCenterHubPage from "@/pages/help-center/HelpCenterHubPage";
import HelpCenterArticlePage from "@/pages/help-center/HelpCenterArticlePage";
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

function isInvitationPath(path: string): boolean {
  return path.startsWith("/invitations/");
}

/**
 * Signed out, the app presents authentication (#217). The in-app Notion
 * marketing Landing is retired: marketing lives in its own site, and a visitor
 * who reaches the app is here to sign in, to sign up (#230), or to accept an
 * Invitation.
 */
function SignedOutSwitch() {
  return (
    <Switch>
      <Route path="/" component={AuthPage} />
      <Route path="/auth" component={AuthPage} />
      <Route path={SIGN_UP_PATH} component={SignUpPage} />
      {/* The spelling the marketing site's call-to-action uses (#231): a
          visitor who follows it lands on sign-up, not on a fall-through. */}
      <Route path="/signup" component={SignUpPage} />
      <Route path="/invitations/:token" component={V2InvitationAcceptPage} />
      <Route component={AuthPage} />
    </Switch>
  );
}

function ProviderSessionRouter() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { isAuthenticated, isLoading, isFetching } = useAuth();
  const [location] = useLocation();

  if (!isLoaded || isLoading) {
    return <LoadingScreen />;
  }

  // A Clerk session with a null `/api/auth/user` is where Flow 1 step 2 runs:
  // AuthPage creates the DocuFlow User behind it and the app takes over (#230).
  // It is also where the browser lands after Clerk Organization selection, and
  // where a registration that could not complete says so — sending either back
  // through sign-in would look like a failed attempt.
  // Invitation acceptance is the exception, and takes precedence: the invitee
  // may have a Clerk session and no User until they accept (Flow 6, step 4).
  if (isSignedIn && !isAuthenticated) {
    if (isFetching) return <LoadingScreen />;
    if (isInvitationPath(location)) return <V2InvitationAcceptPage />;
    return <AuthPage />;
  }

  if (!isAuthenticated) {
    return <SignedOutSwitch />;
  }

  if (authenticatedPresentation(flags.webAppV2).chrome === "v2") {
    return <V2AuthenticatedApp />;
  }

  return (
    <AuthenticatedLayout>
      <Switch>
        <Route path="/" component={Home} />
        {/* Where Clerk leaves a User standing after sign-in (#110); without this
            the sign-in page falls through to NotFound the moment it succeeds. */}
        <Route path="/auth">
          <Redirect to="/" />
        </Route>
        <Route path="/invitations/:token" component={V2InvitationAcceptPage} />
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
        <Route path="/daily-update" component={DailyUpdatePage} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/admin/create" component={AdminPage} />
        <Route path="/admin/user/:id" component={AdminPage} />
        <Route path="/admin/analytics" component={AdminAnalyticsPage} />
        <Route path="/admin/daily-updates" component={DailyUpdatesAdminPage} />
        <Route path="/time-tracking" component={TimeTrackingPage} />
        <Route path="/time-tracking/projects" component={TimeTrackingProjectsPage} />
        <Route path="/time-tracking/devices" component={DevicesPage} />
        <Route path="/time-tracking/download" component={TimeTrackingDownloadPage} />
        <Route path="/time-tracking/dashboard" component={TimeTrackingDashboardPage} />
        <Route path="/time-tracking/screencasts" component={ScreencastsPage} />
        <Route path="/devices" component={DevicesPage} />
        <Route path="/help-center" component={HelpCenterHubPage} />
        <Route path="/help-center/:slug" component={HelpCenterArticlePage} />
        <Route component={NotFound} />
      </Switch>
    </AuthenticatedLayout>
  );
}

function Router() {
  const webAuth = useWebAuthConfig();
  if (!webAuth) return <LoadingScreen />;
  if (!webAuth.publishableKey) return <SignedOutSwitch />;
  return <ProviderSessionRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="docuflow-theme">
        <TooltipProvider>
          {/* Clerk owns the web session since #110; everything below reaches the
              API with the token it issues. */}
          <WebAuthConfigProvider>
            <IdentityProviderSession>
              <Router />
            </IdentityProviderSession>
          </WebAuthConfigProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
