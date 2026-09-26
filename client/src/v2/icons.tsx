import {
  Activity,
  ArrowLeftRight,
  Bell,
  Calendar,
  ChartColumn,
  Clock,
  FileText,
  Folder,
  Grid2x2,
  HelpCircle,
  ListChecks,
  Menu,
  Monitor,
  MoreVertical,
  PanelLeft,
  Paperclip,
  Check,
  Pause,
  Play,
  Search,
  Send,
  Square,
  Settings,
  Sparkles,
  StickyNote,
  Target,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { V2NavId } from "./presentation";

const stroke = { width: 15, height: 15, strokeWidth: 1.4 };

/* Lucide strokes and fills in currentColor, and an SVG presentation attribute
   cannot be trusted to resolve var(), so the token rides on the CSS colour. */
function tone(token: string) {
  return { style: { color: `var(${token})` } };
}

export const NAV_ICONS: Record<V2NavId, LucideIcon> = {
  today: Calendar,
  opportunities: Target,
  clients: Users,
  projects: Grid2x2,
  documents: Folder,
  "project-documentation": FileText,
  time: Clock,
  activity: Activity,
  people: Users,
  analytics: ChartColumn,
  administration: Settings,
  help: HelpCircle,
  devices: Monitor,
};

export function RailIcon({ id, active }: { id: V2NavId; active: boolean }) {
  const Icon = NAV_ICONS[id];
  return <Icon {...stroke} {...tone(active ? "--df-case-ink" : "--df-archive-slate")} />;
}

export function CollapseIcon() {
  return <PanelLeft {...stroke} {...tone("--df-archive-slate")} />;
}

export function SwapIcon() {
  return <ArrowLeftRight width={14} height={14} strokeWidth={1.4} {...tone("--df-archive-slate")} />;
}

export function SearchIcon() {
  return <Search width={14} height={14} strokeWidth={1.4} {...tone("--df-archive-slate")} />;
}

export function MenuIcon() {
  return <Menu width={18} height={18} strokeWidth={1.5} {...tone("--df-case-ink")} />;
}

export function SparkleIcon() {
  return <Sparkles width={13} height={13} strokeWidth={1.4} {...tone("--df-case-ink")} />;
}

export function BellIcon() {
  return <Bell width={15} height={15} strokeWidth={1.4} {...tone("--df-case-ink")} />;
}

export function PauseIcon() {
  return <Pause width={13} height={13} strokeWidth={1.6} fill="currentColor" {...tone("--df-case-ink")} />;
}

export function PlayIcon() {
  return <Play width={13} height={13} strokeWidth={1.6} fill="currentColor" {...tone("--df-case-ink")} />;
}

export function KebabIcon() {
  return <MoreVertical width={12} height={12} strokeWidth={1.4} {...tone("--df-archive-slate")} />;
}

export function CloseIcon() {
  return <X width={14} height={14} strokeWidth={1.4} {...tone("--df-archive-slate")} />;
}

export function CheckIcon() {
  return <Check width={12} height={12} strokeWidth={1.8} {...tone("--df-signed-off")} />;
}

/** The tick inside a done Task's green badge: paper on the fill, in both palettes. */
export function TaskCheckIcon() {
  return <Check width={11} height={11} strokeWidth={3} aria-hidden {...tone("--df-fill-paper")} />;
}

export type EmptyStateIconId =
  | "tasks"
  | "time"
  | "activity"
  | "updates"
  | "notes"
  | "reminders"
  | "documents"
  | "files";

const EMPTY_STATE_ICONS: Record<EmptyStateIconId, LucideIcon> = {
  tasks: ListChecks,
  time: Clock,
  activity: Activity,
  updates: Send,
  notes: StickyNote,
  reminders: Bell,
  documents: FileText,
  files: Paperclip,
};

export function EmptyStateIcon({ id }: { id: EmptyStateIconId }) {
  const Icon = EMPTY_STATE_ICONS[id];
  return <Icon width={18} height={18} strokeWidth={1.5} aria-hidden {...tone("--df-archive-slate")} />;
}

export function StopIcon() {
  return <Square width={11} height={11} strokeWidth={1.6} fill="currentColor" {...tone("--df-case-ink")} />;
}

export function SendIcon() {
  return <Send width={14} height={14} strokeWidth={1.6} {...tone("--df-card-white")} />;
}
