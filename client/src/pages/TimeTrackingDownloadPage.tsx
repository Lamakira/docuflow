import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Monitor, Apple, Terminal } from "lucide-react";

const DOWNLOAD_URL_WINDOWS = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v0.1.1/DocuFlowAgentSetup.exe";
const AGENT_VERSION = "v0.1.3";

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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Monitor className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Windows</CardTitle>
                  <CardDescription className="text-xs">Windows 10 / 11 (x64)</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full"
                onClick={() => window.open(DOWNLOAD_URL_WINDOWS, "_blank", "noopener,noreferrer")}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Installer
              </Button>
              <p className="text-xs text-muted-foreground">
                Windows SmartScreen may prompt — click <strong>More info</strong> → <strong>Run anyway</strong>.
              </p>
            </CardContent>
          </Card>

          <Card className="opacity-60">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-muted p-2">
                  <Terminal className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base">Linux</CardTitle>
                  <CardDescription className="text-xs">Ubuntu, Debian, Fedora</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" disabled>
                Coming soon
              </Button>
            </CardContent>
          </Card>

          <Card className="opacity-60">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-muted p-2">
                  <Apple className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base">macOS</CardTitle>
                  <CardDescription className="text-xs">macOS 12+</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" disabled>
                Coming soon
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Setup instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Download and run the installer for your platform.</li>
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
