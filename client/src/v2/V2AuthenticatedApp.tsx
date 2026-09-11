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
  V2ActivityPage,
} from "./V2Pages";
import { V2ClientRecordPage, V2ClientRecordRedirect, V2ClientsPage } from "./V2Clients";
import { V2OpportunitiesPage } from "./V2Opportunities";
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
          <Route path="/project-documentation" component={V2ProjectDocumentationPage} />
          <Route path="/documentation">
            <Redirect to="/project-documentation" />
          </Route>
          <Route path="/documentation/:rest">
            <Redirect to="/project-documentation" />
          </Route>
          <Route path="/document/:id" component={V2DocumentPage} />
          <Route path="/opportunities" component={V2OpportunitiesPage} />
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
            <Redirect to="/projects" />
          </Route>
          <Route path="/project/:id" component={V2LegacyProjectPage} />
          <Route path="/time" component={V2TimePage} />
          <Route path="/activity" component={V2ActivityPage} />
          <Route path="/time-tracking/screencasts/:rest">
            <Redirect to="/activity" />
          </Route>
          <Route path="/time-tracking/screencasts">
            <Redirect to="/activity" />
          </Route>
          <Route path="/time-tracking/devices/:rest">
            <V2PlaceholderPage />
          </Route>
          <Route path="/time-tracking/devices">
            <V2PlaceholderPage />
          </Route>
          <Route path="/time-tracking/:rest">
            <Redirect to="/time" />
          </Route>
          <Route path="/time-tracking">
            <Redirect to="/time" />
          </Route>
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
