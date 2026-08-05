/**
 * One toast, bottom-centre of the stage, 2.2s.
 *
 * Single slot by design: a second mutation replaces the first rather than
 * stacking. Two lines of feedback for two clicks is noise — the last thing you
 * did is the thing worth confirming.
 */

import { useUi } from '../ui/UiContext';

export function Toast() {
  const { toast } = useUi();
  if (!toast) return null;
  return (
    <div className="v2-toast" role="status" aria-live="polite" key={toast}>
      <span className="v2-toast__check" aria-hidden="true">✓</span>
      <span className="v2-toast__text">{toast}</span>
    </div>
  );
}
