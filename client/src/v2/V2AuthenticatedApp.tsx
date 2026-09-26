import { Redirect, Route, Switch } from "wouter";
import { TimeTrackerProvider } from "@/contexts/TimeTrackerContext";
import {
  V2PlaceholderPage,
  V2TodayPage,
  V2DossierPage,
  V2DocumentsPage,
  V2ProjectDocumentationPage,
  V2DocumentPage,
  V2TimePage,
  V2DailyUpdatePage,
  V2TeamDailyUpdatesPage,
  V2ActivityPage,
  V2PeoplePage,
  V2AdministrationPage,
  V2AnalyticsPage,
  V2DevicesPage,
  V2HelpPage,
} from "./V2Pages";
import { V2AccountPage } from "./V2Account";
import { V2ClientRecordPage, V2ClientRecordRedirect, V2ClientsPage } from "./V2Clients";
import { V2FilePage } from "./V2FileViewer";
import { V2LegacyAdminRedirect, V2PlatformPage } from "./V2Platform";
import { V2InvitationAcceptPage } from "./V2InvitationAccept";
import { V2OpportunitiesPage, V2OpportunityRecordPage } from "./V2Opportunities";
import { V2ProjectRecordRedirect, V2LegacyProjectPage, V2ProjectsPage } from "./V2Projects";
import { V2Shell } from "./V2Shell";

export function V2AuthenticatedApp() {
  return (
    <TimeTrackerProvider>
      <V2Shell>
        <Switch>
          <Route path="/auth">
            <Redirect to="/" />
          </Route>
          <Route path="/" component={V2TodayPage} />
          <Route path="/documents" component={V2DocumentsPage} />
          <Route path="/documents/new">
            <Redirect to="/documents?new=1" />
          </Route>
          <Route path="/documents/new-folder">
            <Redirect to="/documents?folder=1" />
          </Route>
          <Route path="/documents/upload">
            <Redirect to="/documents?upload=1" />
          </Route>
          <Route path="/documents/access">
            <Redirect to="/documents" />
          </Route>
          <Route path="/documents/:id" component={V2DocumentPage} />
          <Route path="/company-documents/:id/edit" component={V2DocumentPage} />
          <Route path="/company-documents/:id/view" component={V2DocumentPage} />
          <Route path="/company-documents">
            <Redirect to="/documents" />
          </Route>
          <Route path="/files" component={V2FilePage} />
          <Route path="/project-documentation" component={V2ProjectDocumentationPage} />
          <Route path="/documentation">
            <Redirect to="/project-documentation" />
          </Route>
          <Route path="/documentation/:rest">
            <Redirect to="/project-documentation" />
          </Route>
          <Route path="/document/:id" component={V2DocumentPage} />
          <Route path="/opportunities" component={V2OpportunitiesPage} />
          <Route path="/opportunities/:id" component={V2OpportunityRecordPage} />
          <Route path="/clients" component={V2ClientsPage} />
          <Route path="/clients/:id" component={V2ClientRecordPage} />
          <Route path="/crm/client/new">
            <Redirect to="/clients?new=1" />
          </Route>
          <Route path="/crm/client/:id" component={V2ClientRecordRedirect} />
          <Route path="/projects" component={V2ProjectsPage} />
          <Route path="/projects/:id/:tab?" component={V2DossierPage} />
          <Route path="/crm/project/new">
            <Redirect to="/projects?new=1" />
          </Route>
          <Route path="/crm/project/:id" component={V2ProjectRecordRedirect} />
          <Route path="/crm">
            <Redirect to="/projects?view=board" />
          </Route>
          <Route path="/project/:id" component={V2LegacyProjectPage} />
          <Route path="/time/:tab?" component={V2TimePage} />
          <Route path="/activity/:tab?" component={V2ActivityPage} />
          <Route path="/people" component={V2PeoplePage} />
          <Route path="/invitations/:token" component={V2InvitationAcceptPage} />
          <Route path="/administration/:tab?" component={V2AdministrationPage} />
          <Route path="/analytics" component={V2AnalyticsPage} />
          <Route path="/devices" component={V2DevicesPage} />
          <Route path="/account" component={V2AccountPage} />
          <Route path="/platform" component={V2PlatformPage} />
          <Route path="/help/:slug" component={V2HelpPage} />
          <Route path="/help" component={V2HelpPage} />
          <Route path="/help-center/:slug" component={V2HelpPage} />
          <Route path="/help-center">
            <Redirect to="/help" />
          </Route>
          <Route path="/admin/daily-updates">
            <Redirect to="/daily-updates" />
          </Route>
          <Route path="/admin/analytics">
            <Redirect to="/analytics" />
          </Route>
          {/* v1's User directory: the platform console for a platform admin (#266). */}
          <Route path="/admin/user/:id" component={V2LegacyAdminRedirect} />
          <Route path="/admin/:rest" component={V2LegacyAdminRedirect} />
          <Route path="/admin" component={V2LegacyAdminRedirect} />
          <Route path="/time-tracking/screencasts/:rest">
            <Redirect to="/activity" />
          </Route>
          <Route path="/time-tracking/screencasts">
            <Redirect to="/activity" />
          </Route>
          <Route path="/time-tracking/devices/:rest">
            <Redirect to="/devices" />
          </Route>
          <Route path="/time-tracking/devices">
            <Redirect to="/devices" />
          </Route>
          <Route path="/time-tracking/download/:rest">
            <Redirect to="/devices" />
          </Route>
          <Route path="/time-tracking/download">
            <Redirect to="/devices" />
          </Route>
          <Route path="/time-tracking/dashboard">
            <Redirect to="/time/stats" />
          </Route>
          <Route path="/time-tracking/projects">
            <Redirect to="/time/projects" />
          </Route>
          <Route path="/time-tracking/:rest">
            <Redirect to="/time" />
          </Route>
          <Route path="/time-tracking">
            <Redirect to="/time" />
          </Route>
          <Route path="/daily-updates" component={V2TeamDailyUpdatesPage} />
          <Route path="/daily-update/:rest">
            <Redirect to="/daily-update" />
          </Route>
          <Route path="/daily-update" component={V2DailyUpdatePage} />
          <Route component={V2PlaceholderPage} />
        </Switch>
      </V2Shell>
    </TimeTrackerProvider>
  );
}
