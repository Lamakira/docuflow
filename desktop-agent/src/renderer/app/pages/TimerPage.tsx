import React from 'react';
import { ProjectTaskPicker } from '../components/timer/ProjectTaskPicker';

export function TimerPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ProjectTaskPicker />
    </div>
  );
}
