import React, { useEffect, useRef, useState } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { formatWorkedToday } from '../../types';
import { StatusBadge } from '../common/StatusBadge';

// ── helpers ──────────────────────────────────────────────────────────────────

function getPeriodBounds(tz: 'local' | 'utc'): {
  weekStart: Date; weekEnd: Date;
  monthStart: Date; monthEnd: Date;
} {
  const now = new Date();

  if (tz === 'utc') {
    const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
    const dow = now.getUTCDay(); // 0=Sun
    const mondayOffset = (dow === 0 ? -6 : 1 - dow);
    const weekStart = new Date(Date.UTC(y, m, d + mondayOffset, 0, 0, 0, 0));
    const weekEnd   = new Date(Date.UTC(y, m, d + mondayOffset + 6, 23, 59, 59, 999));
    const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
    const monthEnd   = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
    return { weekStart, weekEnd, monthStart, monthEnd };
  }

  const dow = now.getDay(); // 0=Sun
  const mondayOffset = (dow === 0 ? -6 : 1 - dow);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset, 0, 0, 0, 0);
  const weekEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset + 6, 23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { weekStart, weekEnd, monthStart, monthEnd };
}

// ── hover card ───────────────────────────────────────────────────────────────

interface CardData {
  week: number | null;
  month: number | null;
  tz: 'local' | 'utc';
  tzLabel: string;
}

function WorkedTodayCard({
  today,
  onOpenTimezone,
}: {
  today: number;
  onOpenTimezone: () => void;
}) {
  const [data, setData] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const tz = await window.agentBridge.getDisplayTimezone();
        const { weekStart, weekEnd, monthStart, monthEnd } = getPeriodBounds(tz);
        const [wRes, mRes] = await Promise.all([
          window.agentBridge.getWorkedPeriod(weekStart.toISOString(), weekEnd.toISOString()),
          window.agentBridge.getWorkedPeriod(monthStart.toISOString(), monthEnd.toISOString()),
        ]);
        if (!cancelled) {
          const tzLabel = tz === 'utc' ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone;
          setData({
            week: wRes.ok ? wRes.total : null,
            month: mRes.ok ? mRes.total : null,
            tz,
            tzLabel,
          });
        }
      } catch {
        // show whatever loaded
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="wt-card" role="tooltip" aria-label="Worked time summary">
      <div className="wt-card__row">
        <span className="wt-card__label">Today</span>
        <span className="wt-card__value">{formatWorkedToday(today)}</span>
      </div>
      {loading ? (
        <div className="wt-card__loading">Loading…</div>
      ) : (
        <>
          <div className="wt-card__row">
            <span className="wt-card__label">This week</span>
            <span className="wt-card__value">
              {data?.week != null ? formatWorkedToday(data.week) : '—'}
            </span>
          </div>
          <div className="wt-card__row">
            <span className="wt-card__label">This month</span>
            <span className="wt-card__value">
              {data?.month != null ? formatWorkedToday(data.month) : '—'}
            </span>
          </div>
        </>
      )}
      <div className="wt-card__divider" />
      <div className="wt-card__tz">
        <span className="wt-card__tz-label">Boundaries in</span>
        <span className="wt-card__tz-value">{data?.tzLabel ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
      </div>
      <button className="wt-card__settings-link" onClick={onOpenTimezone}>
        Change time zone in Settings
      </button>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function WorkedToday() {
  const { state, pauseTimer, resumeTimer, startTimer, navigateToSettings } = useAgent();
  const [pauseLoading, setPauseLoading] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const hoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const timer = state.agentState?.timer;
  const status = timer?.status ?? 'stopped';
  const isActive = status !== 'stopped' && timer?.entryId != null;
  const canRestart = status === 'stopped' && state.recentTasks.length > 0;

  const total = timer?.workedToday ?? 0;
  const thisSession = timer?.thisSession ?? 0;

  async function handlePauseResume() {
    setPauseLoading(true);
    if (status === 'running') await pauseTimer();
    else await resumeTimer();
    setPauseLoading(false);
  }

  async function handleRestart() {
    const recent = state.recentTasks[0];
    if (!recent) return;
    setRestartLoading(true);
    await startTimer({
      crmProjectId: recent.crmProjectId,
      taskId: recent.taskId ?? undefined,
      taskName: recent.taskName ?? undefined,
      projectName: recent.projectName,
      description: recent.description ?? undefined,
    });
    setRestartLoading(false);
  }

  function onMetricEnter() {
    if (leaveRef.current) { clearTimeout(leaveRef.current); leaveRef.current = null; }
    hoverRef.current = setTimeout(() => setShowCard(true), 180);
  }

  function onMetricLeave() {
    if (hoverRef.current) { clearTimeout(hoverRef.current); hoverRef.current = null; }
    leaveRef.current = setTimeout(() => setShowCard(false), 200);
  }

  function onCardEnter() {
    if (leaveRef.current) { clearTimeout(leaveRef.current); leaveRef.current = null; }
  }

  function onCardLeave() {
    leaveRef.current = setTimeout(() => setShowCard(false), 200);
  }

  function openTimezone() {
    setShowCard(false);
    navigateToSettings('timezone');
  }

  return (
    <div className={`worked-today-bar${isActive || canRestart ? ' worked-today-bar--active' : ''}`}>
      {isActive && (
        <div className="timer-pause-fab-wrap">
          <button
            className={`timer-pause-fab${status === 'paused' ? ' timer-pause-fab--resume' : ''}`}
            disabled={pauseLoading}
            onClick={handlePauseResume}
            title={status === 'running' ? 'Pause' : 'Resume'}
          >
            {pauseLoading ? '…' : status === 'running' ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="4" y="3" width="4" height="14" rx="1.5"/>
                <rect x="12" y="3" width="4" height="14" rx="1.5"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
                <polygon points="5,2 16,9 5,16"/>
              </svg>
            )}
          </button>
        </div>
      )}
      {!isActive && canRestart && (
        <div className="timer-pause-fab-wrap">
          <button
            className="timer-pause-fab timer-pause-fab--resume"
            disabled={restartLoading}
            onClick={handleRestart}
            title="Resume tracking"
          >
            {restartLoading ? '…' : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
                <polygon points="5,2 16,9 5,16"/>
              </svg>
            )}
          </button>
        </div>
      )}
      <div className="worked-today-bar__left">
        {isActive && <StatusBadge status={status} />}
      </div>
      <div className="worked-today-bar__right">
        {/* Hoverable Worked Today metric */}
        <div
          className="worked-today-bar__metric wt-metric-host"
          onMouseEnter={onMetricEnter}
          onMouseLeave={onMetricLeave}
        >
          <span className="worked-today-bar__label">Worked Today:</span>
          <span className="worked-today-bar__value">{formatWorkedToday(total)}</span>

          {showCard && (
            <div
              className="wt-card-wrap"
              onMouseEnter={onCardEnter}
              onMouseLeave={onCardLeave}
            >
              <WorkedTodayCard today={total} onOpenTimezone={openTimezone} />
            </div>
          )}
        </div>
        <div className="worked-today-bar__metric worked-today-bar__metric--session">
          <span className="worked-today-bar__label">This session:</span>
          <span className="worked-today-bar__value worked-today-bar__value--session">{formatWorkedToday(thisSession)}</span>
        </div>
      </div>
    </div>
  );
}
