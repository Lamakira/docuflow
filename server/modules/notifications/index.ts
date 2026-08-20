export type { NotificationsPersistence } from "./persistence";

export const NOTIFICATIONS_TABLES = ["notifications"] as const;

export const notificationsModule = {
  id: "notifications",
  name: "Notifications",
  tables: NOTIFICATIONS_TABLES,
  persistence: "NotificationsPersistence",
} as const;
