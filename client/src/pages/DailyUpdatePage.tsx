import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Calendar, Send, Clock, Briefcase, Check, ChevronsUpDown } from "lucide-react";
import DailyUpdatesAdminPage from "@/pages/DailyUpdatesAdminPage";
import {
  dailyUpdateStatusOptions,
  dailyUpdateBlockedStatuses,
  dailyUpdateBlockageTypeOptions,
} from "@shared/schema";
import type { ProjectDailyUpdateWithDetails, CrmProjectWithDetails } from "@shared/schema";

const STATUS_OPTIONS = dailyUpdateStatusOptions;
const BLOCKED_STATUSES = dailyUpdateBlockedStatuses as readonly string[];

export default function DailyUpdatePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const today = format(new Date(), "yyyy-MM-dd");

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [progressToday, setProgressToday] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [blockageType, setBlockageType] = useState("");
  const [waitingOnClient, setWaitingOnClient] = useState(false);

  const isAdmin = user?.role === "admin";
  // Admins, plus non-admin managers granted the daily-update view permission,
  // go straight to the review dashboard instead of the submission form.
  const canViewDashboard = isAdmin || user?.canViewDailyUpdates === 1;
  const isBlocked = BLOCKED_STATUSES.includes(status);

  const { data: projectsData, isLoading: projectsLoading } = useQuery<{
    data: CrmProjectWithDetails[];
    total: number;
  }>({
    queryKey: ["/api/crm/projects", "all"],
    enabled: !canViewDashboard,
    queryFn: async () => {
      const res = await fetch(`/api/crm/projects?pageSize=1000`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });
  const projects = projectsData?.data ?? [];

  const { data: todayUpdates = [] } = useQuery<ProjectDailyUpdateWithDetails[]>({
    queryKey: ["/api/daily-updates", today],
    enabled: !canViewDashboard,
    queryFn: async () => {
      const res = await fetch(`/api/daily-updates?date=${today}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch daily updates");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: unknown) => apiRequest("POST", "/api/daily-updates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-updates"] });
      toast({ title: "Daily update submitted", description: "Your progress has been recorded." });
      setSelectedProjectId("");
      setStatus("");
      setProgressToday("");
      setNextSteps("");
      setBlockageType("");
      setWaitingOnClient(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to submit daily update. Try again.", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!selectedProjectId || !status) {
      toast({ title: "Missing fields", description: "Please select a project and status.", variant: "destructive" });
      return;
    }
    if (isBlocked && !blockageType) {
      toast({ title: "Blockage cause required", description: "Please specify if the blockage is internal or external.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      crmProjectId: selectedProjectId,
      updateDate: new Date().toISOString(),
      status,
      whatHappened: progressToday || null,
      nextSteps: nextSteps || null,
      blockageType: isBlocked ? blockageType : null,
      waitingOnClient,
    });
  };

  const getStatusLabel = (value: string) => STATUS_OPTIONS.find((s) => s.value === value)?.label || value;
  const getStatusClass = (value: string) => STATUS_OPTIONS.find((s) => s.value === value)?.color || "";

  // Admins (and permitted managers) don't fill out the form — they go straight
  // to the review dashboard.
  if (canViewDashboard) {
    return <DailyUpdatesAdminPage />;
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Calendar className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Daily Update</h1>
          <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submit Today's Update</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Project</Label>
              {projectsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={projectPickerOpen}
                      className="w-full justify-between font-normal"
                      data-testid="select-project"
                    >
                      <span className="truncate">
                        {selectedProjectId
                          ? projects.find((p) => p.id === selectedProjectId)?.project?.name || "Untitled project"
                          : "Select a project"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command
                      filter={(value, search) => {
                        const p = projects.find((pr) => pr.id === value);
                        const name = (p?.project?.name || "").toLowerCase();
                        return name.includes(search.toLowerCase()) ? 1 : 0;
                      }}
                    >
                      <CommandInput placeholder="Search projects..." data-testid="input-project-search" />
                      <CommandList>
                        <CommandEmpty>No projects found.</CommandEmpty>
                        <CommandGroup>
                          {projects.map((p) => (
                            <CommandItem
                              key={p.id}
                              value={p.id}
                              onSelect={(currentValue) => {
                                setSelectedProjectId(currentValue === selectedProjectId ? "" : currentValue);
                                setProjectPickerOpen(false);
                              }}
                              data-testid={`option-project-${p.id}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedProjectId === p.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span className="truncate">{p.project?.name || "Untitled project"}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => {
                setStatus(v);
                if (!BLOCKED_STATUSES.includes(v)) {
                  setBlockageType("");
                } else {
                  setBlockageType(v === "blocked_client" ? "external" : "internal");
                }
              }}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isBlocked && (
            <div className="space-y-2">
              <Label>Blockage cause</Label>
              <Select value={blockageType} onValueChange={setBlockageType}>
                <SelectTrigger data-testid="select-blockage-type">
                  <SelectValue placeholder="Is the blockage internal or external?" />
                </SelectTrigger>
                <SelectContent>
                  {dailyUpdateBlockageTypeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Progress today</Label>
            <Textarea
              placeholder="What did you accomplish on this project today?"
              value={progressToday}
              onChange={(e) => setProgressToday(e.target.value)}
              rows={3}
              data-testid="textarea-progress-today"
            />
          </div>

          <div className="space-y-2">
            <Label>Next steps {waitingOnClient ? "(after the client responds)" : "(tomorrow)"}</Label>
            <Textarea
              placeholder={waitingOnClient ? "What will you do once the client responds?" : "What will you do next / tomorrow?"}
              value={nextSteps}
              onChange={(e) => setNextSteps(e.target.value)}
              rows={2}
              data-testid="textarea-next-steps"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="waiting-on-client" className="cursor-pointer">Waiting on client</Label>
              <p className="text-xs text-muted-foreground">Are you blocked waiting for a client response?</p>
            </div>
            <Switch
              id="waiting-on-client"
              checked={waitingOnClient}
              onCheckedChange={setWaitingOnClient}
              data-testid="switch-waiting-on-client"
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !selectedProjectId || !status}
            className="w-full"
            data-testid="button-submit-daily-update"
          >
            {createMutation.isPending ? "Submitting..." : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Submit Daily Update
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {todayUpdates.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Today's Submissions</h2>
          {todayUpdates.map((u) => (
            <Card key={u.id} data-testid={`card-daily-update-${u.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{u.crmProject?.project?.name || "Project"}</span>
                  </div>
                  <Badge className={getStatusClass(u.status)}>{getStatusLabel(u.status)}</Badge>
                </div>
                {u.whatHappened && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1">Progress today</p>
                    <p className="text-sm">{u.whatHappened}</p>
                  </div>
                )}
                {u.nextSteps && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1">Next steps</p>
                    <p className="text-sm">{u.nextSteps}</p>
                  </div>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  {u.waitingOnClient && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <Clock className="w-3 h-3" />
                      Waiting on client
                    </span>
                  )}
                  {u.blockageType && (
                    <span className="capitalize">Blockage: {u.blockageType}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
