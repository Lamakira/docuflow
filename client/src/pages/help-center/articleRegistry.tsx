import type { ComponentType } from "react";
import type { HelpSlug } from "@/content/help-center/helpCenterConfig";
import { GettingStartedDoc } from "./articles/GettingStartedDoc";
import { TimeTrackingDoc } from "./articles/TimeTrackingDoc";
import { CrmProjectsDoc } from "./articles/CrmProjectsDoc";
import { DesktopAppDoc } from "./articles/DesktopAppDoc";
import { DevicesEntriesDoc } from "./articles/DevicesEntriesDoc";
import { AdministrationDoc } from "./articles/AdministrationDoc";
import { FaqTroubleshootingDoc } from "./articles/FaqTroubleshootingDoc";
import { ReleaseNotesDoc } from "./articles/ReleaseNotesDoc";

export const HELP_ARTICLE_COMPONENTS: Record<HelpSlug, ComponentType> = {
  "getting-started": GettingStartedDoc,
  "time-tracking": TimeTrackingDoc,
  "crm-projects-tasks": CrmProjectsDoc,
  "desktop-app": DesktopAppDoc,
  "devices-entries-screencasts": DevicesEntriesDoc,
  administration: AdministrationDoc,
  "faq-troubleshooting": FaqTroubleshootingDoc,
  "release-notes": ReleaseNotesDoc,
};
