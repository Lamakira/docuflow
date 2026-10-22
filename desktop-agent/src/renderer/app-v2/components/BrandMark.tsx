/**
 * The DocuFlow mark, the "d and dot" (#326), drawn inline: the agent's
 * renderer cannot import the web app's BrandMark. Geometry from brand/*.svg.
 *
 *   tile    the mark on its Case Ink tile (brand/mark-tile.svg), for light ground
 *   onDark  the bare mark with a white d (brand/mark-dark.svg), for the dark rail
 */
export function BrandMark({ variant, size }: { variant: 'tile' | 'onDark'; size: number }) {
  if (variant === 'tile') {
    return (
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
        <rect width="64" height="64" rx="14" fill="#0F1524" />
        <circle cx="26" cy="37" r="10" fill="none" stroke="#FFFFFF" strokeWidth="6.5" />
        <rect x="32.75" y="14" width="6.5" height="36.25" rx="3.25" fill="#FFFFFF" />
        <circle cx="47" cy="46.25" r="4" fill="#E9A23B" />
      </svg>
    );
  }
  return (
    <svg viewBox="10 10 44 44" width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx="26" cy="37" r="10" fill="none" stroke="#FFFFFF" strokeWidth="6.5" />
      <rect x="32.75" y="14" width="6.5" height="36.25" rx="3.25" fill="#FFFFFF" />
      <circle cx="47" cy="46.25" r="4" fill="#E9A23B" />
    </svg>
  );
}
