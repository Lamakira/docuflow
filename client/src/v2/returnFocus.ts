/**
 * Focus back to whatever opened an overlay, once it closes.
 *
 * Radix's Dialog (and AlertDialog and Sheet, built on it) cancels its focus
 * scope's own return on close and focuses only the element its `<…Trigger>`
 * registered. v2 opens most overlays from its own buttons through `open`, so
 * there is no Trigger and focus fell on `<body>`. These handlers remember what
 * had focus when the overlay opened and give it back.
 */

import { useRef } from "react";

type Focusable = { isConnected: boolean; focus: (options?: FocusOptions) => void };

function isFocusable(value: unknown): value is Focusable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Focusable).focus === "function" &&
    typeof (value as Focusable).isConnected === "boolean"
  );
}

export type ReturnFocus = {
  /** Note what has focus now: call it as the overlay opens, before focus moves inside. */
  remember: () => void;
  /** The content's `onCloseAutoFocus`. */
  onCloseAutoFocus: (event: Event) => void;
};

/**
 * `activeElement` reads what has focus now. A caller's own `onCloseAutoFocus`
 * runs first; when it prevents the default, it has placed focus itself.
 */
export function createReturnFocus(
  activeElement: () => unknown,
  onCloseAutoFocus?: (event: Event) => void,
): ReturnFocus {
  let opener: Focusable | null = null;
  return {
    remember() {
      const active = activeElement();
      opener = isFocusable(active) && active !== globalThis.document?.body ? active : null;
    },
    onCloseAutoFocus(event) {
      onCloseAutoFocus?.(event);
      const target = opener;
      opener = null;
      if (event.defaultPrevented || !target?.isConnected) return;
      event.preventDefault();
      target.focus({ preventScroll: true });
    },
  };
}

/**
 * Pass the overlay's `open` and put `onCloseAutoFocus` on its content.
 *
 * The opener is noted while rendering the switch to open: a field inside with
 * `autoFocus` takes focus during the commit, before any effect or Radix's
 * `onOpenAutoFocus` (which Radix then skips, focus being inside already).
 */
export function useReturnFocus(open: boolean, onCloseAutoFocus?: (event: Event) => void): ReturnFocus {
  const latest = useRef(onCloseAutoFocus);
  latest.current = onCloseAutoFocus;
  const handlers = useRef<ReturnFocus | null>(null);
  if (!handlers.current) {
    handlers.current = createReturnFocus(
      () => (typeof document === "undefined" ? null : document.activeElement),
      (event) => latest.current?.(event),
    );
  }
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) handlers.current.remember();
  wasOpen.current = open;
  return handlers.current;
}
