/**
 * Hours tracked, bucketed by hour, day or week.
 *
 * The bars are measured, not modelled. Each bucket is the difference between two
 * cumulative `getWorkedPeriod` windows that share the range's start, which makes
 * the rule "time counts in the bucket its entry started in" — the API attributes
 * an entry to the window it starts in, and differencing cumulative windows keeps
 * that attribution without double-counting a session that runs past a boundary.
 * The consequence to know: a session from 09:10 to 11:30 stands entirely in the
 * 09 bar. The tradeoff is deliberate — the agent has no per-entry timestamps to
 * split a session across hours, and inventing a spread would put work in hours
 * nobody worked.
 *
 * The bars therefore always sum to the range total, and the range that contains
 * today always sums to WORKED TODAY: the running timer's seconds are whatever
 * the stat card knows that the server's stopped total does not, added to the
 * bucket the clock is in. That bucket is amber, because it is still moving;
 * every closed bucket is green, a logged result. Nothing here is a fixed string:
 * the caption's peak and average come from the same array the bars draw from.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatHM } from '../format';

export type ChartRange = 'day' | 'week' | 'month';

const RANGES: { id: ChartRange; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

/**
 * The day view's window: 08:00 → 20:00, twelve columns.
 *
 * Fixed rather than sliding with the clock, because a window that ends at the
 * current hour spends the morning drawing hours nobody works — at noon it opens
 * at 01:00 and seven columns are dead. Work outside the window is not dropped:
 * the first bucket's query starts at midnight and the last one's ends at the
 * next, so early and late hours fold into the end bars, which say so on hover.
 */
const DAY_FIRST_HOUR = 8;
const DAY_BUCKETS = 12;

/** Past buckets only change when an entry stops, which refreshes this anyway. */
const REFRESH_MS = 5 * 60_000;

interface Plan {
  /** Window start every cumulative query shares. */
  start: Date;
  /** Exclusive end of each bucket, in order. */
  ends: Date[];
  /** Tick under each bar. */
  labels: string[];
  /** Bucket name for tooltips and the peak caption. */
  names: string[];
  /** Bucket the clock is in, or -1 when the range has no today in it. */
  liveIndex: number;
  /** Axis caption above the total. */
  caption: string;
  averageWord: string;
}

const HOUR_MS = 3600_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-based, matching the week the design's Mon–Sun row shows. */
function startOfWeek(d: Date): Date {
  const start = startOfDay(d);
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  return start;
}

function dayName(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function planDay(now: Date): Plan {
  const midnight = startOfDay(now);
  const hours = Array.from({ length: DAY_BUCKETS }, (_unused, i) => DAY_FIRST_HOUR + i);
  const lastHour = hours[hours.length - 1];
  const pad = (h: number) => String(h).padStart(2, '0');

  return {
    start: midnight,
    // The last bucket runs to the next midnight so the evening lands somewhere.
    ends: hours.map((h) =>
      new Date(midnight.getTime() + (h === lastHour ? 24 : h + 1) * HOUR_MS),
    ),
    labels: hours.map(pad),
    names: hours.map((h) => {
      if (h === DAY_FIRST_HOUR) return `before ${pad(h + 1)}:00`;
      if (h === lastHour) return `${pad(h)}:00 and later`;
      return `${pad(h)}:00`;
    }),
    // Before the window opens or after it closes, the clock belongs to the bar
    // that holds those hours — the same one its time was folded into.
    liveIndex: Math.min(Math.max(now.getHours() - DAY_FIRST_HOUR, 0), DAY_BUCKETS - 1),
    caption: `${pad(DAY_FIRST_HOUR)}:00 – ${pad(lastHour + 1)}:00 · hours tracked today`,
    averageWord: 'hourly',
  };
}

function planWeek(now: Date): Plan {
  const monday = startOfWeek(now);
  const days = Array.from({ length: 7 }, (_unused, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const sunday = days[6];
  const short = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return {
    start: monday,
    ends: days.map((d) => {
      const end = new Date(d);
      end.setDate(d.getDate() + 1);
      return end;
    }),
    labels: days.map(dayName),
    names: days.map(dayName),
    liveIndex: (now.getDay() + 6) % 7,
    caption: `${short(monday)} – ${short(sunday)} · hours per day`,
    averageWord: 'daily',
  };
}

function planMonth(now: Date): Plan {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const today = startOfDay(now);

  // Calendar weeks clipped to the month, so W1 is however many days the month
  // starts with and the last week ends on the last of the month.
  const ends: Date[] = [];
  let liveIndex = -1;
  let cursor = startOfWeek(monthStart);
  while (cursor < monthEnd) {
    const weekEnd = new Date(cursor);
    weekEnd.setDate(cursor.getDate() + 7);
    if (cursor <= today && today < weekEnd) liveIndex = ends.length;
    ends.push(new Date(Math.min(weekEnd.getTime(), monthEnd.getTime())));
    cursor = weekEnd;
  }

  return {
    start: monthStart,
    ends,
    labels: ends.map((_unused, i) => `W${i + 1}`),
    names: ends.map((_unused, i) => `week ${i + 1}`),
    liveIndex,
    caption: `${now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · hours per week`,
    averageWord: 'weekly',
  };
}

function planFor(range: ChartRange, now: Date): Plan {
  if (range === 'week') return planWeek(now);
  if (range === 'month') return planMonth(now);
  return planDay(now);
}

interface Measured {
  /** Stopped seconds per bucket, in plan order. */
  buckets: number[];
  /** Today's stopped seconds, for working out what the running timer holds. */
  todayStopped: number;
}

export function ActivityChart({
  workedToday,
  refreshKey = 0,
}: {
  /** WORKED TODAY, live. The chart reconciles itself against it. */
  workedToday: number;
  /** Bump to re-measure — a manual refresh, or an entry that just stopped. */
  refreshKey?: number;
}) {
  const [range, setRange] = useState<ChartRange>('day');
  const [tick, setTick] = useState(0);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `tick` and `refreshKey` also re-anchor the plan, so an hour or a day that
  // rolls over while the window is open moves the buckets with it.
  const plan = useMemo(() => planFor(range, new Date()), [range, refreshKey, tick]);

  const measure = useCallback(async (p: Plan) => {
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    try {
      const [cumulative, today] = await Promise.all([
        Promise.all(
          p.ends.map((end) =>
            window.agentBridge
              .getWorkedPeriod(p.start.toISOString(), end.toISOString())
              .then((r) => (r.ok ? r.total : 0)),
          ),
        ),
        window.agentBridge
          .getWorkedPeriod(dayStart.toISOString(), dayEnd.toISOString())
          .then((r) => (r.ok ? r.total : 0)),
      ]);

      // Differences, floored at zero: a cumulative total that came back smaller
      // than its predecessor is a wobble between requests, not negative work.
      const buckets = cumulative.map((total, i) => Math.max(0, total - (i === 0 ? 0 : cumulative[i - 1])));
      setMeasured({ buckets, todayStopped: today });
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load tracked hours');
    }
  }, []);

  useEffect(() => { void measure(plan); }, [measure, plan]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const bars = useMemo(() => {
    const base = measured?.buckets ?? plan.ends.map(() => 0);
    if (!measured || plan.liveIndex < 0) return base;
    // Whatever WORKED TODAY holds that the server's stopped total does not is
    // the timer still running. It belongs to the bucket the clock is in.
    const running = Math.max(0, workedToday - measured.todayStopped);
    return base.map((v, i) => (i === plan.liveIndex ? v + running : v));
  }, [measured, plan, workedToday]);

  const total = bars.reduce((sum, v) => sum + v, 0);
  const max = Math.max(...bars, 1);
  const worked = bars.filter((v) => v > 0);
  const peakIndex = bars.reduce((best, v, i) => (v > bars[best] ? i : best), 0);
  const average = worked.length > 0 ? Math.round(total / worked.length) : 0;

  const summary = error
    ? error
    : worked.length === 0
      ? 'Nothing tracked in this range yet'
      : `Peak ${formatHM(bars[peakIndex])} at ${plan.names[peakIndex]} · ${plan.averageWord} average ${formatHM(average)}`;

  return (
    <div className="v2-card v2-chart">
      <div className="v2-chart__head">
        <div className="v2-chart__headings">
          <p className="v2-chart__axis">{plan.caption}</p>
          <p className="v2-chart__total">
            {formatHM(total)}
            <span className="v2-chart__summary">{summary}</span>
          </p>
        </div>

        <div className="v2-seg" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={`v2-seg__btn${r.id === range ? ' v2-seg__btn--on' : ''}`}
              onClick={() => setRange(r.id)}
              aria-pressed={r.id === range}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="v2-chart__plot">
        {bars.map((seconds, i) => {
          const live = i === plan.liveIndex && seconds > 0;
          const empty = seconds === 0;
          return (
            <div
              key={plan.labels[i]}
              className={`v2-chart__bar${empty ? ' v2-chart__bar--empty' : ''}${live ? ' v2-chart__bar--live' : ''}`}
              style={{ height: `${Math.max(2, (seconds / max) * 100)}%` }}
              title={`${plan.names[i]} · ${formatHM(seconds)}${live ? ' · running now' : ''}`}
            />
          );
        })}
      </div>

      <div className="v2-chart__ticks">
        {plan.labels.map((label) => (
          <span key={label} className="v2-chart__tick">{label}</span>
        ))}
      </div>
    </div>
  );
}
