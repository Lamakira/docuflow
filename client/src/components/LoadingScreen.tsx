/** The app's one "not ready yet" screen: waiting on Clerk, or on who the User is. */
export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="motion-safe:animate-pulse flex flex-col items-center gap-4">
        {/* Inlined from brand/mark-tile.svg: BrandMark needs v2 tokens.css, absent before v2 loads. */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={48} height={48} aria-hidden="true" focusable="false">
          <rect width="64" height="64" rx="14" fill="#0F1524" />
          <circle cx="26" cy="37" r="10" fill="none" stroke="#FFFFFF" strokeWidth="6.5" />
          <rect x="32.75" y="14" width="6.5" height="36.25" rx="3.25" fill="#FFFFFF" />
          <circle cx="47" cy="46.25" r="4" fill="#E9A23B" />
        </svg>
        <p className="text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}
