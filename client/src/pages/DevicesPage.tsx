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
  Link2,
} from "lucide-react";
import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";

interface Availability { windows: boolean; macos: boolean; linux: boolean; }

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

interface MachineGroup {
  key: string;
  name: string;
  os: string | null;
  /** Most recently active non-revoked device, or most recent overall */
  representative: Device;
  isFullyRevoked: boolean;
}

/** Group raw device rows by (name, os). One row per logical machine. */
function groupByMachine(rawDevices: Device[]): MachineGroup[] {
  const map = new Map<string, Device[]>();
  for (const d of rawDevices) {
    const key = `${d.name}||${d.os ?? ""}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  const groups: MachineGroup[] = [];
  for (const [key, members] of map) {
    const active = members.filter(d => !d.revokedAt);
    // Representative: most-recently-seen non-revoked, else most-recently-seen overall
    const pool = active.length > 0 ? active : members;
    const representative = pool.reduce((best, d) => {
      const ts = (x: Device) => x.lastSeenAt ? new Date(x.lastSeenAt).getTime() : 0;
      return ts(d) > ts(best) ? d : best;
    });
    groups.push({
      key,
      name: representative.name,
      os: representative.os,
      representative,
      isFullyRevoked: active.length === 0,
    });
  }
  // Sort: active first, then by lastSeenAt desc
  return groups.sort((a, b) => {
    if (a.isFullyRevoked !== b.isFullyRevoked) return a.isFullyRevoked ? 1 : -1;
    const ts = (g: MachineGroup) => g.representative.lastSeenAt ? new Date(g.representative.lastSeenAt).getTime() : 0;
    return ts(b) - ts(a);
  });
}

export default function DevicesPage() {
  const { toast } = useToast();
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [revokeMachineKey, setRevokeMachineKey] = useState<string | null>(null);

  // Fetch devices
  const { data: devicesResponse, isLoading } = useQuery<{ data: Device[] }>({
    queryKey: ["/api/agent/devices"],
    refetchInterval: 15000,
  });

  // Which platforms have an installer file uploaded
  const { data: avail } = useQuery<Availability>({
    queryKey: ["/downloads/availability"],
    staleTime: 60_000,
  });
  const platformReady = (p: keyof Availability) => avail?.[p] === true;

  const rawDevices = devicesResponse?.data ?? [];
  const machineGroups = groupByMachine(rawDevices);
  const activeGroups = machineGroups.filter(g => !g.isFullyRevoked);
  const revokedGroups = machineGroups.filter(g => g.isFullyRevoked);

  // Revoke all tokens for a machine
  const revokeMutation = useMutation({
    mutationFn: async ({ name, os }: { name: string; os: string | null }) => {
      return apiRequest("POST", "/api/agent/devices/revoke-machine", { name, os });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/devices"] });
      toast({ title: "Device revoked successfully" });
      setRevokeMachineKey(null);
    },
    onError: () => {
      toast({ title: "Failed to revoke device", variant: "destructive" });
    },
  });

  const pairMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/agent/pairing/start", {}) as Promise<{
        pairingCode: string;
        expiresAt: string;
      }>;
    },
    onSuccess: (data) => {
      setPairingCode(data.pairingCode);
      setPairingExpiresAt(data.expiresAt);
    },
    onError: () => {
      toast({ title: "Could not generate a pairing code", variant: "destructive" });
    },
  });

  const openPairDialog = () => {
    setPairingCode(null);
    setPairingExpiresAt(null);
    setShowPairDialog(true);
    pairMutation.mutate();
  };

  const groupToRevoke = machineGroups.find(g => g.key === revokeMachineKey);

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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openPairDialog}>
            <Link2 className="h-4 w-4 mr-2" />
            Pair a device
          </Button>
          <Button variant="outline" onClick={() => setShowConnectDialog(true)}>
            <Download className="h-4 w-4 mr-2" />
            Get the app
          </Button>
        </div>
      </div>

      {/* Help note */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-3">
        <Monitor className="h-4 w-4 shrink-0" />
        <span>
          Install the desktop app, then pair it with a code from this page.
        </span>
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
                <p className="text-2xl font-bold">{isLoading ? "-" : activeGroups.length}</p>
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
                  {isLoading ? "-" : activeGroups.filter(g => {
                    if (!g.representative.lastSeenAt) return false;
                    return (Date.now() - new Date(g.representative.lastSeenAt).getTime()) < 5 * 60000;
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
                <p className="text-2xl font-bold">{isLoading ? "-" : revokedGroups.length}</p>
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
          ) : machineGroups.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Smartphone className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="font-medium">No devices connected</p>
              <p className="text-sm mt-1">Install the desktop app and pair it with a code from this page</p>
            </div>
          ) : (
            <div className="space-y-2">
              {machineGroups.map(group => (
                <div
                  key={group.key}
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                    group.isFullyRevoked ? "opacity-50" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="rounded-lg bg-muted p-2.5">
                    <Monitor className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{group.name}</span>
                      <DeviceStatusBadge device={group.representative} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {group.os && <span>{group.os}</span>}
                      {group.representative.clientVersion && <span>v{group.representative.clientVersion}</span>}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Last seen {formatRelativeTime(group.representative.lastSeenAt)}
                      </span>
                    </div>
                  </div>
                  {!group.isFullyRevoked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setRevokeMachineKey(group.key)}
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
              Install the desktop app, then come back here and generate a pairing code.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {platformReady("windows") ? (
              <Button className="w-full" onClick={() => window.open("/downloads/windows", "_self")}>
                <Download className="h-4 w-4 mr-2" />
                Windows — Download .exe
              </Button>
            ) : (
              <Button variant="outline" className="w-full opacity-60" disabled>
                <Clock className="h-4 w-4 mr-2" />
                Windows — Coming soon
              </Button>
            )}
            {platformReady("macos") ? (
              <Button variant="outline" className="w-full" onClick={() => window.open("/downloads/macos", "_self")}>
                <Download className="h-4 w-4 mr-2" />
                macOS — Download .dmg
              </Button>
            ) : (
              <Button variant="outline" className="w-full opacity-60" disabled>
                <Clock className="h-4 w-4 mr-2" />
                macOS — Coming soon
              </Button>
            )}
            {platformReady("linux") ? (
              <Button variant="outline" className="w-full" onClick={() => window.open("/downloads/linux", "_self")}>
                <Download className="h-4 w-4 mr-2" />
                Linux — Download .deb
              </Button>
            ) : (
              <Button variant="outline" className="w-full opacity-60" disabled>
                <Clock className="h-4 w-4 mr-2" />
                Linux — Coming soon
              </Button>
            )}
            <p className="text-xs text-muted-foreground text-center">
              Once installed, generate a pairing code on this page and enter it in the agent.
              The device will appear in this list automatically.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPairDialog} onOpenChange={setShowPairDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pair a device</DialogTitle>
            <DialogDescription>
              Enter this code in the desktop agent. It expires in 10 minutes and can be used once.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center">
            {pairMutation.isPending && !pairingCode ? (
              <p className="text-sm text-muted-foreground">Generating a code…</p>
            ) : pairingCode ? (
              <>
                <p className="text-3xl font-mono tracking-[0.35em] font-semibold pl-[0.35em]">
                  {pairingCode}
                </p>
                {pairingExpiresAt && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Expires {new Date(pairingExpiresAt).toLocaleTimeString()}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Could not generate a code.</p>
            )}
          </div>
          <DialogFooter className="sm:justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => pairMutation.mutate()}
              disabled={pairMutation.isPending}
            >
              New code
            </Button>
            <Button
              onClick={() => pairingCode && navigator.clipboard.writeText(pairingCode)}
              disabled={!pairingCode}
            >
              Copy code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation */}
      <AlertDialog open={!!revokeMachineKey} onOpenChange={(open) => !open && setRevokeMachineKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect "{groupToRevoke?.name}" and prevent it from syncing data.
              The device will need to pair again to reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => groupToRevoke && revokeMutation.mutate({ name: groupToRevoke.name, os: groupToRevoke.os })}
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
