import type { ActivityPersistence } from "./persistence";

export type { ActivityPersistence };

export const ACTIVITY_TABLES = [
  "time_entry_screenshots",
  "agent_activity_events",
  "agent_processed_batches",
] as const;

export const activityModule = {
  id: "activity",
  name: "Activity",
  tables: ACTIVITY_TABLES,
  persistence: {} as ActivityPersistence,
} as const;
