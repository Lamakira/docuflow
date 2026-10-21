import "./tokens.css";
import { useV2Fonts } from "./useV2Fonts";

/**
 * The DocuFlow mark, "the d and the dot": a lowercase d and an amber full stop.
 *
 * The geometry mirrors brand/mark-light.svg and brand/mark-dark.svg, which are
 * the source of truth; a characterization test compares the two so they cannot
 * drift. Fills come from CSS (`.df-brand-mark-d`, `.df-brand-mark-dot` in
 * tokens.css), keyed on `.dark` on <html>, so one component serves both themes
 * and works outside `.df-v2` too (sign-in renders before any v2 surface).
 */
export function BrandMark({
  className,
  label,
}: {
  className?: string;
  /** Names the mark when it stands alone; omit when the wordmark sits beside it. */
  label?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="10 10 44 44"
      className={className ? `df-brand-mark ${className}` : "df-brand-mark"}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      <circle cx="26" cy="37" r="10" fill="none" strokeWidth="6.5" className="df-brand-mark-d df-brand-mark-stroke" />
      <rect x="32.75" y="14" width="6.5" height="36.25" rx="3.25" className="df-brand-mark-d" />
      <circle cx="47" cy="46.25" r="4" className="df-brand-mark-dot" />
    </svg>
  );
}

/** Mark plus the wordmark as live text, so it follows the loaded display font. */
export function BrandLockup({ fontSize }: { fontSize?: string }) {
  useV2Fonts();
  return (
    <span className="df-lockup" style={fontSize ? { fontSize } : undefined}>
      <BrandMark />
      <span className="df-lockup-word">DocuFlow</span>
    </span>
  );
}
