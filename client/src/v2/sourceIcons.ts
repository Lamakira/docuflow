import { Handshake, type LucideIcon } from "lucide-react";
import type { IconType } from "react-icons";
import { SiZoho } from "react-icons/si";
import { TbBrandFiverr } from "react-icons/tb";

export type SourceIconSpec = {
  Icon: IconType | LucideIcon;
  /** The brand hue, or null for a neutral mark in the ink colour. */
  hue: string | null;
  /** A square mark, or a wordmark that is sized by its width. */
  shape: "square" | "wide";
  /** Crops a wordmark to its own bounds, so it fills the width it is given. */
  viewBox?: string;
};

/**
 * Fiverr is Tabler's square "fi" mark and Zoho the Simple Icons (CC0) mark,
 * both through react-icons; Direct is lucide. react-icons has no square Zoho
 * mark, so its four-square wordmark is cropped to the glyph (24 × 10.2 of the
 * 24 × 24 box) and drawn wide.
 */
const SOURCE_ICONS: Record<string, SourceIconSpec> = {
  fiverr: { Icon: TbBrandFiverr, hue: "#1dbf73", shape: "square" },
  zoho: { Icon: SiZoho, hue: "#e42527", shape: "wide", viewBox: "0 6.9 24 10.2" },
  direct: { Icon: Handshake, hue: null, shape: "square" },
};

/** The mark for a Client Source value, or null for a Source an Administrator added. */
export function sourceIcon(value: string | null | undefined): SourceIconSpec | null {
  if (!value) return null;
  return SOURCE_ICONS[value.trim().toLowerCase()] ?? null;
}
