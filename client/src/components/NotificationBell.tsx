import { useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import type { NotificationWithDetails } from "@shared/schema";
import { Link } from "wouter";

export function NotificationBell() {
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery<NotificationWithDetails[]>({
    queryKey: ["/api/notifications"],
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const unreadCount = unreadData?.count || 0;

  const handleNotificationClick = (notification: NotificationWithDetails) => {
    if (!notification.isRead) {
      markReadMutation.mutate(notification.id);
    }
    setOpen(false);
  };

  const getNotificationMessage = (notification: NotificationWithDetails) => {
    const fromName = notification.fromUser 
      ? `${notification.fromUser.firstName || ""} ${notification.fromUser.lastName || ""}`.trim() || notification.fromUser.email
      : "Someone";
    
    const projectName = notification.crmProject?.project?.name || "a project";

    switch (notification.type) {
      case "mention":
        return `${fromName} mentioned you in a note on "${projectName}"`;
      case "daily_update_reminder":
        return notification.message || "Don't forget to submit your daily update.";
      case "reminder":
        return notification.message || "You have a reminder.";
      default:
        return notification.message || "You have a new notification";
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 relative"
          data-testid="button-notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge 
              className="absolute -top-1.5 -right-1.5 h-5 min-w-[1.25rem] px-1 text-[10px] font-medium"
              variant="destructive"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        align="end" 
        className="w-80 p-0"
        data-testid="popover-notifications"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-medium">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <Link
                  key={notification.id}
                  href={
                    notification.type === "daily_update_reminder"
                      ? "/daily-update"
                      : notification.crmProjectId
                      ? `/crm/project/${notification.crmProjectId}`
                      : "#"
                  }
                  onClick={() => handleNotificationClick(notification)}
                  className={`block px-4 py-3 hover-elevate transition-colors ${
                    notification.isRead ? "opacity-60" : "bg-accent/30"
                  }`}
                  data-testid={`notification-${notification.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed">
                        {getNotificationMessage(notification)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {notification.createdAt && formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    {!notification.isRead && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          markReadMutation.mutate(notification.id);
                        }}
                        data-testid={`button-mark-read-${notification.id}`}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
