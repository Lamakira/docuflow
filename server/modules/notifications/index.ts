import type { NotificationsPersistence } from "./persistence";

export type { NotificationsPersistence };

export const NOTIFICATIONS_TABLES = ["notifications"] as const;

export const notificationsModule = {
  id: "notifications",
  name: "Notifications",
  tables: NOTIFICATIONS_TABLES,
  persistence: {} as NotificationsPersistence,
} as const;
