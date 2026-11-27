/**
 * The day total as a stat card: Worked Time, counted once however many Timers
 * ran, with the Simultaneous Time inside it when there is some (#400,
 * ADR-0031): "Worked time", "4h 30m", then "1h 30m simultaneous" on its own
 * line, which a card this narrow cannot hold beside the value. The wording
 * comes from lib/simultaneousTimers.ts, shared with workedTimeLabel and tested.
 */

import { simultaneousLabel, workedTimeValue } from '../../../lib/simultaneousTimers';

export function WorkedTimeStat({ label, total, simultaneous }: { label: string; total: number; simultaneous: number }) {
  const part = simultaneousLabel(simultaneous);
  return (
    <div className="v2-card v2-stat">
      <span className="v2-stat__label">{label}</span>
      <p className="v2-stat__value">{workedTimeValue(total)}</p>
      {part && <p className="v2-stat__note">{part}</p>}
    </div>
  );
}
