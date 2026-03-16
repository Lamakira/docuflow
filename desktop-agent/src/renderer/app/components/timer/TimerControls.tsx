import React, { useState } from 'react';
import { useAgent } from '../../stores/AgentContext';

interface Props {
  compact?: boolean;
}

export function TimerControls({ compact }: Props) {
  const { state, pauseTimer, resumeTimer, stopTimer } = useAgent();
  const status = state.agentState?.timer.status ?? 'stopped';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setLoading(true);
    setError(null);
    const result = await fn();
    setLoading(false);
    if (!result.ok && result.error) {
      setError(result.error);
      setTimeout(() => setError(null), 3000);
    }
  }

  if (status === 'stopped') return null;

  const btnClass = compact ? 'btn btn--sm btn--icon' : 'btn btn--sm';

  return (
    <div>
      <div className="timer-header__controls">
        {status === 'running' && (
          <button
            className={compact ? btnClass : 'btn btn--sm btn--warning'}
            disabled={loading}
            onClick={() => act(pauseTimer)}
            title="Pause"
          >
            {compact ? '⏸' : 'Pause'}
          </button>
        )}
        {status === 'paused' && (
          <button
            className={compact ? btnClass : 'btn btn--sm btn--success'}
            disabled={loading}
            onClick={() => act(resumeTimer)}
            title="Resume"
          >
            {compact ? '▶' : 'Resume'}
          </button>
        )}
        <button
          className={compact ? btnClass : 'btn btn--sm btn--danger'}
          disabled={loading}
          onClick={() => act(stopTimer)}
          title="Stop"
        >
          {compact ? '■' : 'Stop'}
        </button>
      </div>
      {error && !compact && (
        <div style={{ fontSize: '0.72rem', color: 'var(--red)', marginTop: '0.25rem' }}>
          {error}
        </div>
      )}
    </div>
  );
}
