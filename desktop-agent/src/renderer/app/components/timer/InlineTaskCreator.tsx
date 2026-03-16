import React, { useState } from 'react';
import { useAgent } from '../../stores/AgentContext';

interface Props {
  crmProjectId: string;
  projectName: string;
}

export function InlineTaskCreator({ crmProjectId, projectName }: Props) {
  const { startTimer } = useAgent();
  const [taskName, setTaskName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    const name = taskName.trim();
    if (!name) return;
    setLoading(true);
    await startTimer({ crmProjectId, projectName, taskName: name });
    setLoading(false);
    setTaskName('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleStart();
  }

  return (
    <div className="inline-creator">
      <input
        className="inline-creator__input"
        placeholder="New task name…"
        value={taskName}
        onChange={(e) => setTaskName(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={loading}
      />
      <button
        className="btn btn--sm btn--success"
        onClick={handleStart}
        disabled={loading || !taskName.trim()}
      >
        {loading ? '…' : 'Start'}
      </button>
    </div>
  );
}
