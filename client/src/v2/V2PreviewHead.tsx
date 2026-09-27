import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function V2PreviewHead({
  kicker,
  title,
  meta,
  onClose,
}: {
  kicker: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="df-panel-head">
      <div className="df-preview-heading">
        <div className="df-mono df-meta">{kicker}</div>
        <div className="df-preview-title">{title}</div>
        <div className="df-mono df-meta">{meta}</div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="df-preview-close"
        aria-label="Close preview"
        data-testid="v2-preview-close"
        onClick={onClose}
      >
        <X width={16} height={16} strokeWidth={1.6} aria-hidden />
      </Button>
    </header>
  );
}
