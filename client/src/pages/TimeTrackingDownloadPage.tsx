import { useQuery } from "@tanstack/react-query";
import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Download, Monitor, Apple, Terminal } from "lucide-react";

const AGENT_VERSION = "v0.1.6";

interface Availability { windows: boolean; macos: boolean; linux: boolean; }

export default function TimeTrackingDownloadPage() {
  const { data: avail } = useQuery<Availability>({
    queryKey: ["/downloads/availability"],
    staleTime: 60_000,
  });

  // Only true once the server confirms the file exists — defaults to false
  // while loading so cards never flash active then immediately go unavailable.
  const ready = (platform: keyof Availability) => avail?.[platform] === true;

  function DownloadButton({ platform, label, url }: { platform: keyof Availability; label: string; url: string }) {
    if (ready(platform)) {
      return (
        <Button className="w-full" onClick={() => window.open(url, "_self")}>
          <Download className="h-4 w-4 mr-2" />
          {label}
        </Button>
      );
    }
    return (
      <Button className="w-full" variant="outline" disabled>
        <Clock className="h-4 w-4 mr-2" />
        Coming soon
      </Button>
    );
  }

  function PlatformBadge({ platform, readyLabel, readyClass }: {
    platform: keyof Availability;
    readyLabel: string;
    readyClass: string;
  }) {
    if (!ready(platform)) {
      return <Badge variant="secondary" className="text-xs">Not yet available</Badge>;
    }
    return <Badge className={`${readyClass} border-0 text-xs`}>{readyLabel}</Badge>;
  }

  return (
    <TimeTrackingLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">

        <div>
          <h1 className="text-2xl font-bold">Download Desktop Agent</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Install the DocuFlow Desktop Agent to track time from your computer.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Installers are published per platform as they become available.
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-3">
          <Monitor className="h-4 w-4 shrink-0" />
          <span>
            Once installed, sign in with your DocuFlow account. The agent runs in your system tray and syncs automatically.
          </span>
        </div>

        {/* OS cards — ordered by validation level: Windows > macOS > Linux */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

          {/* Windows */}
          <Card className={!ready("windows") ? "opacity-60" : undefined}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Monitor className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Windows</CardTitle>
                    <CardDescription className="text-xs">Windows 10 / 11 (x64)</CardDescription>
                  </div>
                </div>
                <PlatformBadge
                  platform="windows"
                  readyLabel="Stable"
                  readyClass="bg-green-500/15 text-green-700 dark:text-green-400"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <DownloadButton platform="windows" label="Download .exe" url="/downloads/windows" />
              {ready("windows") && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    SmartScreen may prompt — click <strong>More info</strong> → <strong>Run anyway</strong>.
                  </p>
                  <p className="text-xs text-muted-foreground">{AGENT_VERSION}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* macOS */}
          <Card className={!ready("macos") ? "opacity-60" : undefined}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Apple className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">macOS</CardTitle>
                    <CardDescription className="text-xs">macOS 12+ (Apple Silicon / Intel)</CardDescription>
                  </div>
                </div>
                <PlatformBadge
                  platform="macos"
                  readyLabel="Beta"
                  readyClass="bg-orange-500/15 text-orange-700 dark:text-orange-400"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <DownloadButton platform="macos" label="Download .dmg" url="/downloads/macos" />
              {ready("macos") && (
                <p className="text-xs text-muted-foreground">
                  First launch: <strong>right-click → Open</strong> to bypass Gatekeeper (unsigned build).
                </p>
              )}
            </CardContent>
          </Card>

          {/* Linux */}
          <Card className={!ready("linux") ? "opacity-60" : undefined}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Terminal className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Linux</CardTitle>
                    <CardDescription className="text-xs">Ubuntu 20.04+ (x64)</CardDescription>
                  </div>
                </div>
                <PlatformBadge
                  platform="linux"
                  readyLabel="Experimental"
                  readyClass="bg-muted text-muted-foreground"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <DownloadButton platform="linux" label="Download .deb" url="/downloads/linux" />
              {ready("linux") && (
                <p className="text-xs text-muted-foreground">
                  Install: <strong>sudo dpkg -i DocuFlow-Agent-*.deb</strong>
                </p>
              )}
            </CardContent>
          </Card>

        </div>

        {/* Setup instructions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Setup instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Download the installer for your platform.</li>
              <li>
                <strong>Windows:</strong> run the .exe and follow the wizard.{" "}
                <strong>macOS:</strong> open the .dmg, drag the app to Applications, then double-click to launch.{" "}
                <strong>Linux:</strong> run <code className="bg-muted px-1 rounded">sudo dpkg -i DocuFlow-Agent-*.deb</code>.
              </li>
              <li>Open the DocuFlow Agent from your system tray or app menu.</li>
              <li>Sign in with your DocuFlow email and password.</li>
              <li>Select a project and task, then click <strong>Start</strong> to begin tracking.</li>
            </ol>
          </CardContent>
        </Card>

      </div>
    </TimeTrackingLayout>
  );
}
