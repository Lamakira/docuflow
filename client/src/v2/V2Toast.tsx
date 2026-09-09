import { useEffect, useRef } from "react";
import { motionForSurface } from "./motion";
import { toastModel } from "./chrome";
import { CheckIcon } from "./icons";

export type V2Toast = {
  id: number;
  message: string;
  undo?: () => void;
  state: "in" | "leaving";
};

const TOAST_MS = 3200;

export function V2ToastHost({
  toast,
  onDismiss,
  onGone,
}: {
  toast: V2Toast | null;
  onDismiss: () => void;
  onGone: () => void;
}) {
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const motion = motionForSurface("toast").enterExit;
  const model = toast ? toastModel({ message: toast.message, undo: Boolean(toast.undo) }) : null;

  useEffect(() => {
    if (!toast || toast.state === "leaving") return;
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast?.id, toast?.state, onDismiss]);

  if (!toast || !model) return null;

  return (
    <div
      className="df-toast"
      data-testid="v2-toast"
      data-edge={model.edge}
      data-state={toast.state}
      data-motion={motion}
      role="status"
      aria-live="polite"
      onTransitionEnd={(event) => {
        if (event.propertyName !== "opacity" && event.propertyName !== "transform") return;
        if (toastRef.current?.state === "leaving") onGone();
      }}
    >
      <CheckIcon />
      <span className="df-toast-message">{model.message}</span>
      {model.undoLabel && toast.undo ? (
        <button type="button" className="df-toast-undo" onClick={toast.undo}>
          {model.undoLabel}
        </button>
      ) : null}
    </div>
  );
}
