export type { ProjectsPersistence } from "./persistence";

export const PROJECTS_TABLES = [
  "projects",
  "tasks",
  "project_members",
  "reminders",
  "project_daily_updates",
] as const;

export const projectsModule = {
  id: "projects",
  name: "Projects",
  tables: PROJECTS_TABLES,
  persistence: "ProjectsPersistence",
} as const;
