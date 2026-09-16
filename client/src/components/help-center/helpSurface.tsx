/**
 * Which visual system a Help article body renders on (#216, ADR-0003). The
 * flag-off Help Center is `v1`; the v2 chrome provides `v2` so the same copy
 * comes out on `--df-*` tokens instead of the discarded system.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { HelpSurface } from "@/v2/helpArticle";

const HelpSurfaceContext = createContext<HelpSurface>("v1");

export function HelpSurfaceProvider({
  surface,
  children,
}: {
  surface: HelpSurface;
  children: ReactNode;
}) {
  return <HelpSurfaceContext.Provider value={surface}>{children}</HelpSurfaceContext.Provider>;
}

export function useHelpSurface(): HelpSurface {
  return useContext(HelpSurfaceContext);
}
