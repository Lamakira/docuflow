/**
 * Minimise / maximise / close, drawn by the app.
 *
 * The window is frameless so its corners can be transparent — a native frame
 * paints square ones underneath whatever the page rounds. That trade means the
 * app owes the user the three controls the frame used to provide.
 *
 * Close hides the window rather than quitting, which is what the native close
 * button already did: the agent keeps tracking from the tray.
 *
 * Renders nothing when the preload does not expose the controls, so v1 builds
 * and the browser harness are unaffected.
 */

import { useEffect, useState } from 'react';

export function WindowControls() {
  const bridge = window.agentBridge;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void bridge.windowIsMaximized?.().then((r) => setMaximized(r.maximized));
    return bridge.onWindowMaximizedChange?.(setMaximized);
  }, []);

  if (!bridge.windowMinimize) return null;

  return (
    <div className="v2-winctl">
      <button
        className="v2-winctl__btn"
        onClick={() => void bridge.windowMinimize?.()}
        aria-label="Minimise"
        title="Minimise"
      >
        <span className="v2-winctl__min" />
      </button>
      <button
        className="v2-winctl__btn"
        onClick={() => void bridge.windowToggleMaximize?.().then((r) => setMaximized(r.maximized))}
        aria-label={maximized ? 'Restore' : 'Maximise'}
        title={maximized ? 'Restore' : 'Maximise'}
      >
        <span className={`v2-winctl__max${maximized ? ' v2-winctl__max--restore' : ''}`} />
      </button>
      <button
        className="v2-winctl__btn v2-winctl__btn--close"
        onClick={() => void bridge.windowHide?.()}
        aria-label="Close"
        title="Close — tracking continues in the tray"
      >
        <span className="v2-winctl__close" />
      </button>
    </div>
  );
}
