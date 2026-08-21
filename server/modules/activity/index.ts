import { activityPersistence, type ActivityPersistence } from "./persistence";

export type { ActivityPersistence };
export { activityPersistence };
export {
  TRACKING_POLICY_VERSION,
  getScreenshotPolicy,
  upsertScreenshotPolicy,
} from "./policy";
export {
  createAgentActivityEvents,
  createTimeEntryScreenshot,
  getActivityEvidence,
  getTimeEntryScreenshotById,
  getTimeEntryScreenshots,
  isAgentBatchProcessed,
  markAgentBatchProcessed,
  updateTimeEntryScreenshot,
} from "./evidence";
export {
  ACTIVITY_ATTRIBUTE_JOB,
  ACTIVITY_ATTRIBUTE_JOB_TYPE,
  commitActivityScreenshot,
  createActivityJobsPort,
  handleAttributeEvidenceJob,
  ingestActivityEvents,
  ingestActivityScreenshot,
} from "./evidenceJobs";

export const ACTIVITY_TABLES = [
  "time_entry_screenshots",
  "agent_activity_events",
  "agent_processed_batches",
] as const;

export const activityModule = {
  id: "activity",
  name: "Activity",
  tables: ACTIVITY_TABLES,
  persistence: activityPersistence,
} as const;
