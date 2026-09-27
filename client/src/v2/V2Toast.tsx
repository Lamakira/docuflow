import { Toaster } from "@/components/ui/sonner";

/** Sonner reads these on its own list, so they resolve against the v2 palette in both themes. */
const V2_TOASTER_STYLE = {
  "--normal-bg": "var(--df-card-white)",
  "--normal-text": "var(--df-case-ink)",
  "--normal-border": "var(--df-divider)",
  "--success-bg": "var(--df-positive-wash)",
  "--success-border": "var(--df-positive-line)",
  "--success-text": "var(--df-positive-ink)",
  "--info-bg": "var(--df-card-white)",
  "--info-border": "var(--df-divider)",
  "--info-text": "var(--df-case-ink)",
  "--warning-bg": "var(--df-amber-wash)",
  "--warning-border": "var(--df-active-line)",
  "--warning-text": "var(--df-active-ink)",
  "--error-bg": "var(--df-alert-wash)",
  "--error-border": "var(--df-alert-line)",
  "--error-text": "var(--df-alert-ink)",
  "--border-radius": "var(--df-radius-3)",
  fontFamily: "var(--df-font-ui)",
} as React.CSSProperties;

export function V2Toaster() {
  return (
    <div className="df-v2 df-toaster" data-testid="v2-toaster">
      <Toaster
        position="top-center"
        richColors
        offset="var(--df-space-4)"
        mobileOffset="var(--df-space-3)"
        style={V2_TOASTER_STYLE}
        toastOptions={{ className: "df-toast" }}
      />
    </div>
  );
}
