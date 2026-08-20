import type { HelpCenterScreenshotsMap } from "@shared/schema";

export interface WorkspacePersistence {
  getHelpCenterScreenshots(): Promise<HelpCenterScreenshotsMap>;
  mergeHelpCenterScreenshots(partial: Record<string, string | null>): Promise<void>;
}
