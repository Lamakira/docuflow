/**
 * Activity — what was logged today.
 *
 * Panel and stage live in one file because they read the same data: the day
 * list needs today's entry count, the table needs the rows behind it, and
 * splitting them means fetching the breakdown twice.
 *
 * Past days show a total only. The agent's API exposes per-entry detail for
 * today (`getTodayBreakdown`) and totals for any period (`getWorkedPeriod`);
 * rather than pretend a past day has no entries, the stage says where the
 * detail actually lives.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgent } from '../../app/stores/AgentContext';
import type { BreakdownRow } from '../../app/types';
import { Panel, PanelHead, PanelBody, PanelRow } from '../components/Panel';
import { Stage, StageHead } from '../components/Stage';
import { useUi } from '../ui/UiContext';
import { useFitCount } from '../ui/useFitCount';
import { formatElapsed, formatHM } from '../format';

const PAST_DAYS = 4;
const ROW_H = 39;
const REFRESH_MS = 60_000;
const SPINNER_MS = 800;

interface DayTotal { key: string; label: string; total: number }

function dayBounds(daysAgo: number): [Date, Date] {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start, end];
}

function dayLabel(d: Date, daysAgo: number): string {
  if (daysAgo === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function ActivityScreen() {
  const { state } = useAgent();
  const { showToast } = useUi();
  const timer = state.agentState?.timer;

  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [past, setPast] = useState<DayTotal[]>([]);
  const [captures, setCaptures] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string>('today');

  // 70px of reserve = the header row plus the "N more entries" footer.
  const [tableRef, maxRows] = useFitCount<HTMLDivElement>(ROW_H, { min: 2, max: 12, reserve: 70 });

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await window.agentBridge.getTodayBreakdown();
      if (result.ok) setRows(result.rows);
      else setError(result.error ?? 'Could not load today’s activity');
    } catch (e: any) {
      setError(e?.message ?? 'Could not load today’s activity');
    } finally {
      setLoading(false);
      setUpdatedAt(new Date());
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // A stopped timer means an entry just closed — show it without waiting a minute.
  useEffect(() => {
    if (timer?.status === 'stopped') void load();
  }, [timer?.status]);

  useEffect(() => {
    void Promise.all(
      Array.from({ length: PAST_DAYS }, async (_unused, i) => {
        const daysAgo = i + 1;
        const [start, end] = dayBounds(daysAgo);
        const result = await window.agentBridge.getWorkedPeriod(start.toISOString(), end.toISOString());
        return {
          key: start.toISOString().slice(0, 10),
          label: dayLabel(start, daysAgo),
          total: result.ok ? result.total : 0,
        };
      }),
    ).then(setPast);
  }, []);

  useEffect(() => {
    void window.agentBridge.listScreenshots().then((r) => {
      if (!r.ok) return;
      const today = new Date().toDateString();
      setCaptures(r.data.filter((s) => new Date(s.timestampMs).toDateString() === today).length);
    });
  }, [timer?.entryId]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    await Promise.all([load(), new Promise((r) => setTimeout(r, SPINNER_MS))]);
    setRefreshing(false);
    showToast('Activity up to date');
  }

  const workedToday = timer?.workedToday ?? 0;
  const visibleRows = rows.slice(0, maxRows);
  const hiddenCount = rows.length - visibleRows.length;
  const pastDay = past.find((d) => d.key === selectedDay) ?? null;

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return 'loading…';
    return updatedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }, [updatedAt]);

  return (
    <>
      <Panel>
        <PanelHead title="Activity" subtitle="All devices · local time" />
        <PanelBody>
          <div className="v2-panel__list">
            <PanelRow
              name="Today"
              meta={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} logged`}
              end={formatHM(workedToday)}
              selected={selectedDay === 'today'}
              onClick={() => setSelectedDay('today')}
            />
            {past.map((day) => (
              <PanelRow
                key={day.key}
                name={day.label}
                end={formatHM(day.total)}
                selected={selectedDay === day.key}
                onClick={() => setSelectedDay(day.key)}
              />
            ))}
          </div>
        </PanelBody>
      </Panel>

      <Stage>
        {pastDay ? (
          <>
            <StageHead title={pastDay.label} subtitle="Totals for this day, all devices" />
            <div className="v2-statgrid">
              <div className="v2-card v2-stat">
                <span className="v2-stat__label">Worked</span>
                <p className="v2-stat__value">{formatHM(pastDay.total)}</p>
              </div>
            </div>
            <p className="v2-note">
              Per-entry detail for past days is in the web app — the agent keeps the full breakdown for today only.
            </p>
          </>
        ) : (
          <>
            <StageHead
              title="Today’s activity"
              subtitle={`Auto-refreshes every 60s · updated ${updatedLabel}`}
            >
              <button className="v2-refresh" onClick={() => void refresh()} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </StageHead>

            <div className="v2-statgrid">
              <div className="v2-card v2-stat">
                <span className="v2-stat__label">WORKED TODAY</span>
                <p className="v2-stat__value">{formatHM(workedToday)}</p>
              </div>
              <div className="v2-card v2-stat">
                <span className="v2-stat__label">CURRENT SESSION</span>
                <p className="v2-stat__value">{formatElapsed(timer?.elapsedToday ?? 0)}</p>
              </div>
              <div className="v2-card v2-stat">
                <span className="v2-stat__label">CAPTURES</span>
                <p className="v2-stat__value">{captures}</p>
              </div>
            </div>

            <div className="v2-fit" ref={tableRef}>
             <div className="v2-card v2-table">
              <div className="v2-table__row v2-table__head">
                <span>Project</span>
                <span>Task</span>
                <span>Stopped</span>
                <span>Total</span>
              </div>

              <div className="v2-table__body">
                {loading && <p className="v2-empty">Loading…</p>}
                {!loading && error && <p className="v2-empty">{error}</p>}
                {!loading && !error && rows.length === 0 && (
                  <p className="v2-empty">No logged entries yet today. Stop a timer and it lands here.</p>
                )}

                {visibleRows.map((row, i) => {
                  const live = row.activeSeconds != null;
                  const total = row.stoppedSeconds + (row.activeSeconds ?? 0);
                  return (
                    <div key={`${row.projectName}-${row.taskId ?? i}`} className={`v2-table__row${live ? ' v2-table__row--live' : ''}`}>
                      <span className="v2-table__project">{row.projectName}</span>
                      <span className="v2-table__task">{row.taskName ?? 'No task'}</span>
                      <span className={live ? 'v2-badge-live' : 'v2-table__num'}>
                        {live
                          ? timer?.status === 'running' ? 'LIVE' : 'PAUSED'
                          : formatHM(row.stoppedSeconds)}
                      </span>
                      <span className="v2-table__total">{formatHM(total)}</span>
                    </div>
                  );
                })}
              </div>

              {hiddenCount > 0 && (
                <p className="v2-table__more">
                  {hiddenCount} more {hiddenCount === 1 ? 'entry' : 'entries'} today · open the web app for the full log
                </p>
              )}
             </div>
            </div>
          </>
        )}
      </Stage>
    </>
  );
}
