import type { Notification, InsertNotification, NotificationWithDetails } from "@shared/schema";

export interface NotificationsPersistence {
  getUserNotifications(userId: string): Promise<NotificationWithDetails[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  /** With `fromUserId`, only notifications that User caused count (#341). */
  hasRecentNotification(userId: string, type: string, since: Date, fromUserId?: string): Promise<boolean>;
  markNotificationRead(id: string, userId: string): Promise<void>;
  markAllNotificationsRead(userId: string): Promise<void>;
}
