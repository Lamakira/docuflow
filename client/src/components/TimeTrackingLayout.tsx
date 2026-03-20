import { Link, useLocation } from "wouter";
import { Clock, BarChart2, FolderKanban, Monitor, Download, Camera } from "lucide-react";

const tabs = [
  { label: "Dashboard", href: "/time-tracking/dashboard", icon: BarChart2, match: "/time-tracking/dashboard" },
  { label: "Entries", href: "/time-tracking", icon: Clock, match: "/time-tracking" },
  { label: "Projects & Tasks", href: "/time-tracking/projects", icon: FolderKanban, match: "/time-tracking/projects" },
  { label: "Screencasts", href: "/time-tracking/screencasts", icon: Camera, match: "/time-tracking/screencasts" },
  { label: "Devices", href: "/time-tracking/devices", icon: Monitor, match: "/time-tracking/devices" },
  { label: "Download", href: "/time-tracking/download", icon: Download, match: "/time-tracking/download" },
];

export function TimeTrackingLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="flex items-center gap-1 px-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive =
              tab.href === "/time-tracking"
                ? location === "/time-tracking"
                : location === tab.match || location.startsWith(tab.match + "/");
            return (
              <Link key={tab.href} href={tab.href}>
                <button
                  className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
