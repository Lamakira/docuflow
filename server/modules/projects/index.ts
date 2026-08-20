import type { ProjectsPersistence } from "./persistence";

export type { ProjectsPersistence };

export const PROJECTS_TABLES = [
  "projects",
  "crm_projects",
  "tasks",
  "project_members",
  "reminders",
  "project_daily_updates",
] as const;

export const projectsModule = {
  id: "projects",
  name: "Projects",
  tables: PROJECTS_TABLES,
  persistence: {} as ProjectsPersistence,
} as const;
