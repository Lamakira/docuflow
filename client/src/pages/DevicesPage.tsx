/**
 * Device Management page — Pair, view, and revoke Desktop Agent devices.
 * Phase 2 D3
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Monitor,
  Trash2,
  Smartphone,
  Clock,
  ShieldCheck,
  ShieldX,
  Download,
} from "lucide-react";
import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";

const AGENT_VERSION = "v0.1.4";
const DOWNLOAD_URL_WINDOWS = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v0.1.4/DocuFlow-Agent-0.1.4-windows-setup.exe";
const DOWNLOAD_URL_MACOS   = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v0.1.4/DocuFlow-Agent-0.1.4-macos.dmg";
const DOWNLOAD_URL_LINUX   = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v0.1.4/DocuFlow-Agent-0.1.4-linux-amd64.deb";

interface Device {
  id: string;
  userId: string;
  name: string;
  os: string | null;
  clientVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DeviceStatusBadge({ device }: { device: Device }) {
  if (device.revokedAt) {
    return <Badge variant="destructive" className="text-xs">Revoked</Badge>;
  }
  if (!device.lastSeenAt) {
    return <Badge variant="secondary" className="text-xs">Never seen</Badge>;
  }
  const minutesSinceSeen = (Date.now() - new Date(device.lastSeenAt).getTime()) / 60000;
  if (minutesSinceSeen < 5) {
    return <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">Online</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">Offline</Badge>;
}

export default function DevicesPage() {
  const { toast } = useToast();
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [revokeDeviceId, setRevokeDeviceId] = useState<string | null>(null);

  // Fetch devices
  const { data: devicesResponse, isLoading } = useQuery<{ data: Device[] }>({
    queryKey: ["/api/agent/devices"],
    refetchInterval: 15000,
  });

  const devices = devicesResponse?.data ?? [];
  const activeDevices = devices.filter(d => !d.revokedAt);
  const revokedDevices = devices.filter(d => d.revokedAt);

  // Revoke device
  const revokeMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      return apiRequest("POST", "/api/agent/device/revoke", { deviceId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/devices"] });
      toast({ title: "Device revoked successfully" });
      setRevokeDeviceId(null);
    },
    onError: () => {
      toast({ title: "Failed to revoke device", variant: "destructive" });
    },
  });

  const deviceToRevoke = devices.find(d => d.id === revokeDeviceId);

  return (
    <TimeTrackingLayout>
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Devices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage Desktop Agent connections
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowConnectDialog(true)}>
          <Download className="h-4 w-4 mr-2" />
          Get the app
        </Button>
      </div>

      {/* Help note */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-3">
        <Monitor className="h-4 w-4 shrink-0" />
        <span>
          Install the desktop app and sign in with your DocuFlow account to connect this device.
        </span>
        <Badge variant="secondary" className="text-xs ml-auto shrink-0">
          {AGENT_VERSION}
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Monitor className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{isLoading ? "-" : activeDevices.length}</p>
                <p className="text-xs text-muted-foreground">Active devices</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-500/10 p-2">
                <ShieldCheck className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {isLoading ? "-" : activeDevices.filter(d => {
                    if (!d.lastSeenAt) return false;
                    return (Date.now() - new Date(d.lastSeenAt).getTime()) < 5 * 60000;
                  }).length}
                </p>
                <p className="text-xs text-muted-foreground">Online now</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-destructive/10 p-2">
                <ShieldX className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{isLoading ? "-" : revokedDevices.length}</p>
                <p className="text-xs text-muted-foreground">Revoked</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Device List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your Devices</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-lg border">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-32 mb-2" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : devices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Smartphone className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="font-medium">No devices connected</p>
              <p className="text-sm mt-1">Install the desktop app and sign in to connect your first device</p>
            </div>
          ) : (
            <div className="space-y-2">
              {devices.map(device => (
                <div
                  key={device.id}
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                    device.revokedAt ? "opacity-50" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="rounded-lg bg-muted p-2.5">
                    <Monitor className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{device.name}</span>
                      <DeviceStatusBadge device={device} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {device.os && <span>{device.os}</span>}
                      {device.clientVersion && <span>v{device.clientVersion}</span>}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Last seen {formatRelativeTime(device.lastSeenAt)}
                      </span>
                    </div>
                  </div>
                  {!device.revokedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setRevokeDeviceId(device.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Download Agent Dialog */}
      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Download Desktop Agent</DialogTitle>
            <DialogDescription>
              Install the desktop app, then sign in with your DocuFlow email and password to connect.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Button
              className="w-full"
              onClick={() => window.open(DOWNLOAD_URL_WINDOWS, "_blank", "noopener,noreferrer")}
            >
              <Download className="h-4 w-4 mr-2" />
              Windows — Download .exe
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.open(DOWNLOAD_URL_MACOS, "_blank", "noopener,noreferrer")}
            >
              <Download className="h-4 w-4 mr-2" />
              macOS — Download .dmg
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.open(DOWNLOAD_URL_LINUX, "_blank", "noopener,noreferrer")}
            >
              <Download className="h-4 w-4 mr-2" />
              Linux — Download .deb
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Once installed, sign in with your DocuFlow account.
              The device will appear in this list automatically.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation */}
      <AlertDialog open={!!revokeDeviceId} onOpenChange={(open) => !open && setRevokeDeviceId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect "{deviceToRevoke?.name}" and prevent it from syncing data.
              The device will need to sign in again to reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeDeviceId && revokeMutation.mutate(revokeDeviceId)}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? "Revoking..." : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TimeTrackingLayout>
  );
}
