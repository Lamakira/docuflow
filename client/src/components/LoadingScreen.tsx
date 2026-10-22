/**
 * The app's one "not ready yet" screen: waiting on Clerk, or on who the User is.
 *
 * The mark's d draws itself, holds, and wipes away, in a loop. Each stroke has
 * `pathLength` 1, so one dash pattern fits both. With reduced motion the d
 * stands still, whole. The words are for screen readers; the motion says it.
 */
const DRAW_CSS = `
@keyframes df-loading-draw {
  0% { stroke-dashoffset: 1; }
  50%, 70% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -1; }
}
.df-loading-stroke { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
@media (prefers-reduced-motion: no-preference) {
  .df-loading-stroke { animation: df-loading-draw 2.2s ease-in-out infinite; }
  .df-loading-stem { animation-delay: 0.15s; }
}
`;

export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <style>{DRAW_CSS}</style>
      <div role="status">
        {/* Inlined from brand/mark-tile.svg, the d as strokes: BrandMark needs v2 tokens.css, absent before v2 loads. */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={64} height={64} aria-hidden="true" focusable="false">
          <rect width="64" height="64" rx="14" fill="#0F1524" />
          <circle className="df-loading-stroke" cx="26" cy="37" r="10" fill="none" stroke="#FFFFFF" strokeWidth="6.5" strokeLinecap="round" pathLength={1} transform="rotate(-90 26 37)" />
          <path className="df-loading-stroke df-loading-stem" d="M36 17.25 V47" fill="none" stroke="#FFFFFF" strokeWidth="6.5" strokeLinecap="round" pathLength={1} />
          <circle cx="47" cy="46.25" r="4" fill="#E9A23B" />
        </svg>
        <span className="sr-only">Loading…</span>
      </div>
    </div>
  );
}
