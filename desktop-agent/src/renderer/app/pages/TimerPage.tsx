import React from 'react';
import { useAgent } from '../stores/AgentContext';
import { ProjectTaskPicker } from '../components/timer/ProjectTaskPicker';

export function TimerPage() {
  const { state } = useAgent();
  const timerStatus = state.agentState?.timer.status ?? 'stopped';

  return (
    <div>
      {timerStatus === 'stopped' ? (
        <ProjectTaskPicker />
      ) : (
        <div>
          <div className="info-note">
            <span>📷</span>
            <span>Screenshots are captured automatically while the timer runs.</span>
          </div>
        </div>
      )}
    </div>
  );
}
