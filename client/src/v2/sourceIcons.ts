import { Handshake, type LucideIcon } from "lucide-react";
import type { IconType } from "react-icons";
import { SiFiverr, SiZoho } from "react-icons/si";

export type SourceIconSpec = {
  Icon: IconType | LucideIcon;
  /** The brand hue, or null for a neutral mark in the ink colour. */
  hue: string | null;
};

/** Brand marks are Simple Icons (CC0) through react-icons; Direct is lucide. */
const SOURCE_ICONS: Record<string, SourceIconSpec> = {
  fiverr: { Icon: SiFiverr, hue: "#1dbf73" },
  zoho: { Icon: SiZoho, hue: "#e42527" },
  direct: { Icon: Handshake, hue: null },
};

/** The mark for a Client Source value, or null for a Source an Administrator added. */
export function sourceIcon(value: string | null | undefined): SourceIconSpec | null {
  if (!value) return null;
  return SOURCE_ICONS[value.trim().toLowerCase()] ?? null;
}
