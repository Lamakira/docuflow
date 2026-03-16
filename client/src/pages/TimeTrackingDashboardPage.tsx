import { useQuery } from "@tanstack/react-query";
import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Users, Camera, Activity } from "lucide-react";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function TimeTrackingDashboardPage() {
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/time-tracking/stats"],
  });

  const totalSeconds = stats?.totalDuration ?? 0;
  const entryCount = stats?.entryCount ?? 0;
  const avgSession = entryCount > 0 ? Math.round(totalSeconds / entryCount) : 0;

  return (
    <TimeTrackingLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of your team's time tracking activity.</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatDuration(totalSeconds)}</p>
                  <p className="text-xs text-muted-foreground">Total tracked</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <Activity className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{entryCount}</p>
                  <p className="text-xs text-muted-foreground">Sessions</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-500/10 p-2">
                  <Users className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatDuration(avgSession)}</p>
                  <p className="text-xs text-muted-foreground">Avg. session</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-500/10 p-2">
                  <Camera className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats?.screenshotCount ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">Screenshots</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity by project</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.byProject && stats.byProject.length > 0 ? (
              <div className="space-y-3">
                {stats.byProject.map((p: any) => {
                  const pct = totalSeconds > 0 ? Math.round((p.totalDuration / totalSeconds) * 100) : 0;
                  return (
                    <div key={p.crmProjectId} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{p.projectName}</span>
                        <span className="text-muted-foreground">{formatDuration(p.totalDuration)} · {pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </TimeTrackingLayout>
  );
}
