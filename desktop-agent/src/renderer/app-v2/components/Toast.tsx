/**
 * One toast, bottom-centre of the stage, 2.2s.
 *
 * Single slot by design: a second mutation replaces the first rather than
 * stacking. Two lines of feedback for two clicks is noise — the last thing you
 * did is the thing worth confirming.
 *
 * Three kinds, because a checkmark on "Could not pause" is a lie:
 *
 *   ok     ink pill, green tick     — it happened
 *   now    ink pill, amber dot      — the current state changed
 *   error  red pill, white warning  — it did not happen
 *
 * Only the failure changes the pill itself. Colouring all three would make the
 * common case shout as loudly as the rare one.
 */

import { useUi } from '../ui/UiContext';

const GLYPH = { ok: '✓', now: '', error: '!' } as const;

export function Toast() {
  const { toast } = useUi();
  if (!toast) return null;

  return (
    <div
      key={toast.id}
      className={`v2-toast v2-toast--${toast.kind}`}
      role="status"
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      <span className="v2-toast__mark" aria-hidden="true">{GLYPH[toast.kind]}</span>
      <span className="v2-toast__text">{toast.text}</span>
    </div>
  );
}
