/**
 * Which visual system a Help article body renders on (#216, ADR-0003). The
 * flag-off Help Center is `v1`; the v2 chrome provides `v2` so the same copy
 * comes out on `--df-*` tokens instead of the discarded system.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { HelpSurface } from "@/v2/helpArticle";

const HelpSurfaceContext = createContext<HelpSurface>("v1");

/** Whether the reader may manage screenshots; null when the host does not say (the v1 Help Center). */
const HelpScreenshotManagementContext = createContext<boolean | null>(null);

export function HelpSurfaceProvider({
  surface,
  canManageScreenshots,
  children,
}: {
  surface: HelpSurface;
  canManageScreenshots?: boolean;
  children: ReactNode;
}) {
  return (
    <HelpSurfaceContext.Provider value={surface}>
      <HelpScreenshotManagementContext.Provider value={canManageScreenshots ?? null}>
        {children}
      </HelpScreenshotManagementContext.Provider>
    </HelpSurfaceContext.Provider>
  );
}

export function useHelpScreenshotManagement(): boolean | null {
  return useContext(HelpScreenshotManagementContext);
}

export function useHelpSurface(): HelpSurface {
  return useContext(HelpSurfaceContext);
}
