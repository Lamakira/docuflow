import { useEffect, useState } from 'react';
import { countdownRemainingSeconds } from '../../../../lib/idleFlow';

/** Seconds left on the idle prompt's countdown, ticking; null when there is none. */
export function useIdleCountdown(pausesAt: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(() =>
    pausesAt == null ? null : countdownRemainingSeconds(pausesAt, Date.now()),
  );

  useEffect(() => {
    if (pausesAt == null) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(countdownRemainingSeconds(pausesAt, Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [pausesAt]);

  return remaining;
}
