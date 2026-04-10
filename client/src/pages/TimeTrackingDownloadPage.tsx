import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Monitor, Apple, Terminal } from "lucide-react";

const AGENT_VERSION = "v0.1.6";

// GitHub Release: desktop-agent-v0.1.6
// All artifacts live under the same tag — publish them together.
const DOWNLOAD_URL_WINDOWS = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v0.1.6/DocuFlow-Agent-0.1.6-windows-setup.exe";
const DOWNLOAD_URL_MACOS   = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v0.1.6/DocuFlow-Agent-0.1.6-macos.dmg";
const DOWNLOAD_URL_LINUX   = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v0.1.6/DocuFlow-Agent-0.1.6-linux-amd64.deb";

export default function TimeTrackingDownloadPage() {
  return (
    <TimeTrackingLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">

        <div>
          <h1 className="text-2xl font-bold">Download Desktop Agent</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Install the DocuFlow Desktop Agent to track time from your computer.
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-3">
          <Monitor className="h-4 w-4 shrink-0" />
          <span>
            Once installed, sign in with your DocuFlow account. The agent runs in your system tray and syncs automatically.
          </span>
          <Badge variant="secondary" className="ml-auto shrink-0">{AGENT_VERSION}</Badge>
        </div>

        {/* OS cards — ordered by validation level: Windows > macOS > Linux */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

          {/* Windows — Stable */}
          <Card>
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
                <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-0 text-xs">
                  Stable
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full"
                onClick={() => window.open(DOWNLOAD_URL_WINDOWS, "_blank", "noopener,noreferrer")}
              >
                <Download className="h-4 w-4 mr-2" />
                Download .exe
              </Button>
              <p className="text-xs text-muted-foreground">
                SmartScreen may prompt — click <strong>More info</strong> → <strong>Run anyway</strong>.
              </p>
            </CardContent>
          </Card>

          {/* macOS — Beta (in testing) */}
          <Card>
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
                <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-0 text-xs">
                  Beta
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full"
                onClick={() => window.open(DOWNLOAD_URL_MACOS, "_blank", "noopener,noreferrer")}
              >
                <Download className="h-4 w-4 mr-2" />
                Download .dmg
              </Button>
              <p className="text-xs text-muted-foreground">
                First launch: <strong>right-click → Open</strong> to bypass Gatekeeper (unsigned build).
              </p>
            </CardContent>
          </Card>

          {/* Linux — Experimental */}
          <Card>
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
                <Badge variant="outline" className="text-xs">
                  Experimental
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full"
                onClick={() => window.open(DOWNLOAD_URL_LINUX, "_blank", "noopener,noreferrer")}
              >
                <Download className="h-4 w-4 mr-2" />
                Download .deb
              </Button>
              <p className="text-xs text-muted-foreground">
                Install: <strong>sudo dpkg -i DocuFlow-Agent-*.deb</strong>
              </p>
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
