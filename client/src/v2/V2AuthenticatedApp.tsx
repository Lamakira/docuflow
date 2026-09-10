import { Redirect, Route, Switch } from "wouter";
import { TimeTrackerProvider } from "@/contexts/TimeTrackerContext";
import { V2PlaceholderPage, V2TodayPage, V2DossierPage, V2DocumentsPage } from "./V2Pages";
import { V2ClientRecordPage, V2ClientRecordRedirect, V2ClientsPage } from "./V2Clients";
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
          <Route component={V2PlaceholderPage} />
        </Switch>
      </V2Shell>
    </TimeTrackerProvider>
  );
}
