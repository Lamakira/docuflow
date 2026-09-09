import { Redirect, Route, Switch } from "wouter";
import { TimeTrackerProvider } from "@/contexts/TimeTrackerContext";
import { V2PlaceholderPage, V2TodayPage, V2DossierPage, V2DocumentsPage } from "./V2Pages";
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
          <Route path="/projects/:id/:tab?" component={V2DossierPage} />
          <Route component={V2PlaceholderPage} />
        </Switch>
      </V2Shell>
    </TimeTrackerProvider>
  );
}
