import {
  Activity,
  ArrowLeftRight,
  Bell,
  Calendar,
  Clock,
  FileText,
  Folder,
  Grid2x2,
  HelpCircle,
  Menu,
  Monitor,
  MoreVertical,
  PanelLeft,
  Check,
  Pause,
  Play,
  Search,
  Send,
  Square,
  Settings,
  Sparkles,
  Target,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { V2NavId } from "./presentation";

const stroke = { width: 15, height: 15, strokeWidth: 1.4 };

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
  administration: Settings,
  help: HelpCircle,
  devices: Monitor,
};

export function RailIcon({ id, color }: { id: V2NavId; color: string }) {
  const Icon = NAV_ICONS[id];
  return <Icon {...stroke} color={color} />;
}

export function CollapseIcon() {
  return <PanelLeft {...stroke} color="#59657A" />;
}

export function SwapIcon() {
  return <ArrowLeftRight width={14} height={14} strokeWidth={1.4} color="#59657A" />;
}

export function SearchIcon() {
  return <Search width={14} height={14} strokeWidth={1.4} color="#59657A" />;
}

export function MenuIcon() {
  return <Menu width={18} height={18} strokeWidth={1.5} color="#0F1524" />;
}

export function SparkleIcon() {
  return <Sparkles width={13} height={13} strokeWidth={1.4} color="#0F1524" />;
}

export function BellIcon() {
  return <Bell width={15} height={15} strokeWidth={1.4} color="#0F1524" />;
}

export function PauseIcon() {
  return <Pause width={13} height={13} strokeWidth={1.6} color="#0F1524" fill="#0F1524" />;
}

export function PlayIcon() {
  return <Play width={13} height={13} strokeWidth={1.6} color="#0F1524" fill="#0F1524" />;
}

export function KebabIcon() {
  return <MoreVertical width={12} height={12} strokeWidth={1.4} color="#59657A" />;
}

export function CloseIcon() {
  return <X width={14} height={14} strokeWidth={1.4} color="#59657A" />;
}

export function CheckIcon() {
  return <Check width={12} height={12} strokeWidth={1.8} color="#1F9D6B" />;
}

export function StopIcon() {
  return <Square width={11} height={11} strokeWidth={1.6} color="#0F1524" fill="#0F1524" />;
}

export function SendIcon() {
  return <Send width={14} height={14} strokeWidth={1.6} color="#fff" />;
}
