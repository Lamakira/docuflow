import { matchV2Route } from "./presentation";
import { useLocation } from "wouter";

export { V2TodayPage } from "./V2Today";
export { V2DossierPage } from "./V2Dossier";
export { V2DocumentsPage } from "./V2Documents";
export { V2ProjectDocumentationPage } from "./V2ProjectDocumentation";
export { V2DocumentPage } from "./V2Document";
export { V2TimePage } from "./V2Time";
export { V2DailyUpdatePage } from "./V2DailyUpdate";
export { V2TeamDailyUpdatesPage } from "./V2DailyUpdates";
export { V2ActivityPage } from "./V2Activity";
export { V2PeoplePage } from "./V2People";
export { V2AdministrationPage } from "./V2Administration";
export { V2DevicesPage } from "./V2Devices";
export { V2HelpPage } from "./V2Help";

export function V2PlaceholderPage() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  const title = match.kind === "placeholder" ? match.title : "Today";

  return (
    <div className="df-page" data-testid="v2-placeholder">
      <h1 className="df-title">{title}</h1>
      <p style={{ color: "var(--df-archive-slate)", fontSize: 13.5, maxWidth: "62ch", lineHeight: 1.55 }}>
        This destination is not in the current batch. It stays on v2 tokens rather than the previous screens.
      </p>
    </div>
  );
}
