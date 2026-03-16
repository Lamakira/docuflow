import React from 'react';
import { useAgent } from '../stores/AgentContext';
import { ProjectTaskPicker } from '../components/timer/ProjectTaskPicker';

export function TimerPage() {
  const { state } = useAgent();
  const timerStatus = state.agentState?.timer.status ?? 'stopped';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {timerStatus === 'stopped' ? (
        <ProjectTaskPicker />
      ) : (
        <div className="info-note">
          <span>📷</span>
          <span>Screenshots are captured automatically while the timer runs.</span>
        </div>
      )}
    </div>
  );
}
