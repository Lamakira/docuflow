import type { Notification, InsertNotification, NotificationWithDetails } from "@shared/schema";

export interface NotificationsPersistence {
  getUserNotifications(userId: string): Promise<NotificationWithDetails[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  hasRecentNotification(userId: string, type: string, since: Date): Promise<boolean>;
  markNotificationRead(id: string, userId: string): Promise<void>;
  markAllNotificationsRead(userId: string): Promise<void>;
}
