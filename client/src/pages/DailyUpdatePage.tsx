import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Calendar, Send, AlertTriangle, FileX, Briefcase } from "lucide-react";
import type { ProjectDailyUpdateWithDetails, CrmProjectWithDetails } from "@shared/schema";

const STATUS_OPTIONS = [
  { value: "on_track", label: "On Track", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "at_risk", label: "At Risk", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "blocked", label: "Blocked", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  { value: "completed", label: "Completed", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
];

export default function DailyUpdatePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const today = format(new Date(), "yyyy-MM-dd");

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [whatHappened, setWhatHappened] = useState("");
  const [whatWasDone, setWhatWasDone] = useState("");
  const [needsClientUpdate, setNeedsClientUpdate] = useState(false);
  const [needsClientSubmission, setNeedsClientSubmission] = useState(false);

  const { data: projectsData, isLoading: projectsLoading } = useQuery<{
    data: CrmProjectWithDetails[];
    total: number;
  }>({
    queryKey: ["/api/crm/projects", "all"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/projects?pageSize=1000`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });
  const projects = projectsData?.data ?? [];

  const { data: todayUpdates = [], isLoading: updatesLoading } = useQuery<ProjectDailyUpdateWithDetails[]>({
    queryKey: ["/api/daily-updates", today],
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
      setWhatHappened("");
      setWhatWasDone("");
      setNeedsClientUpdate(false);
      setNeedsClientSubmission(false);
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
    createMutation.mutate({
      crmProjectId: selectedProjectId,
      updateDate: new Date().toISOString(),
      status,
      whatHappened: whatHappened || null,
      whatWasDone: whatWasDone || null,
      needsClientUpdate,
      needsClientSubmission,
    });
  };

  const getStatusLabel = (value: string) => STATUS_OPTIONS.find((s) => s.value === value)?.label || value;
  const getStatusClass = (value: string) => STATUS_OPTIONS.find((s) => s.value === value)?.color || "";

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
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
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Project</Label>
            {projectsLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger data-testid="select-project">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
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

          <div className="space-y-2">
            <Label>What happened today?</Label>
            <Textarea
              placeholder="Describe what happened on the project today..."
              value={whatHappened}
              onChange={(e) => setWhatHappened(e.target.value)}
              rows={3}
              data-testid="textarea-what-happened"
            />
          </div>

          <div className="space-y-2">
            <Label>What was done?</Label>
            <Textarea
              placeholder="List tasks completed, decisions made, blockers encountered..."
              value={whatWasDone}
              onChange={(e) => setWhatWasDone(e.target.value)}
              rows={3}
              data-testid="textarea-what-was-done"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Switch
                id="needs-client-update"
                checked={needsClientUpdate}
                onCheckedChange={setNeedsClientUpdate}
                data-testid="switch-client-update"
              />
              <Label htmlFor="needs-client-update" className="cursor-pointer">
                Needs client update
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="needs-client-submission"
                checked={needsClientSubmission}
                onCheckedChange={setNeedsClientSubmission}
                data-testid="switch-client-submission"
              />
              <Label htmlFor="needs-client-submission" className="cursor-pointer">
                Needs client submission
              </Label>
            </div>
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{u.crmProject?.name || "Project"}</span>
                  </div>
                  <Badge className={getStatusClass(u.status)}>{getStatusLabel(u.status)}</Badge>
                </div>
                {u.whatHappened && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1">What happened</p>
                    <p className="text-sm">{u.whatHappened}</p>
                  </div>
                )}
                {u.whatWasDone && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1">What was done</p>
                    <p className="text-sm">{u.whatWasDone}</p>
                  </div>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {u.needsClientUpdate && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="w-3 h-3" />
                      Needs client update
                    </span>
                  )}
                  {u.needsClientSubmission && (
                    <span className="flex items-center gap-1 text-red-600">
                      <FileX className="w-3 h-3" />
                      Needs client submission
                    </span>
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
