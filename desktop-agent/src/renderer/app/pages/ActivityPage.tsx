import React, { useEffect, useState, useCallback } from 'react';
import { useAgent } from '../stores/AgentContext';
import { BreakdownRow, formatWorkedToday } from '../types';

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

export function ActivityPage() {
  const { state } = useAgent();
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.agentBridge.getTodayBreakdown();
      if (result.ok) {
        setRows(result.rows);
        setLastRefresh(new Date());
      } else {
        setError(result.error ?? 'Failed to load');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount and when timer stops (to reflect newly stopped entries)
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (state.agentState?.timer.status === 'stopped') load();
  }, [state.agentState?.timer.status]);

  // Auto-refresh every 60s — matches the workedTodayServerBase refresh cadence
  // so the breakdown total stays in sync with the widget.
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const workedToday = state.agentState?.timer.workedToday ?? 0;

  // Compute totals from rows
  const totalStopped = rows.reduce((s, r) => s + r.stoppedSeconds, 0);
  const totalActive = rows.reduce((s, r) => s + (r.activeSeconds ?? 0), 0);
  const totalFromRows = totalStopped + totalActive;
  const delta = Math.abs(totalFromRows - workedToday);
  const matches = delta <= 2; // allow 2s drift from live tick
  const hasLegacyRows = rows.some((r) => r.taskId === null);

  return (
    <div>
      <div className="page-title">Today's Activity</div>

      {loading && <div className="activity-loading">Loading…</div>}
      {error && <div className="activity-error">{error}</div>}

      {!loading && !error && (
        <>
          <table className="breakdown-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Task</th>
                <th>Stopped</th>
                <th>Active</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="breakdown-empty">No entries today</td>
                </tr>
              )}
              {rows.map((row, i) => {
                const rowTotal = row.stoppedSeconds + (row.activeSeconds ?? 0);
                return (
                  <tr key={i} className={row.activeSeconds != null ? 'breakdown-row--active' : ''}>
                    <td>{row.projectName}</td>
                    <td>
                      {row.taskName
                        ? row.taskName
                        : <span className="breakdown-legacy-task">⚠ No task (legacy)</span>}
                    </td>
                    <td>{row.stoppedSeconds > 0 ? fmt(row.stoppedSeconds) : '—'}</td>
                    <td>
                      {row.activeSeconds != null
                        ? <span className="breakdown-active-badge">{fmt(row.activeSeconds)} ▶</span>
                        : '—'}
                    </td>
                    <td className="breakdown-total">{fmt(rowTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="breakdown-footer">
                <td colSpan={2}>Total</td>
                <td>{totalStopped > 0 ? fmt(totalStopped) : '—'}</td>
                <td>{totalActive > 0 ? fmt(totalActive) : '—'}</td>
                <td className="breakdown-total">{fmt(totalFromRows)}</td>
              </tr>
            </tfoot>
          </table>

          <div className={`breakdown-check ${matches ? 'breakdown-check--ok' : 'breakdown-check--warn'}`}>
            <span>Worked Today (widget):</span>
            <strong>{formatWorkedToday(workedToday)}</strong>
            <span>{matches ? '✓ matches' : `⚠ delta ${fmt(delta)}`}</span>
          </div>

          {hasLegacyRows && (
            <div className="breakdown-legacy-warning">
              ⚠ Some entries above have no task (created before task enforcement).
              They count toward Worked Today but will not recur.
            </div>
          )}

          <div className="breakdown-meta">
            <span className="breakdown-definition">
              Worked Today = all entries since local midnight, all devices
            </span>
            {lastRefresh && (
              <button className="breakdown-refresh" onClick={load}>
                Refresh
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
