import React from 'react';
import { ProjectTaskPicker } from '../components/timer/ProjectTaskPicker';

export function TimerPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ProjectTaskPicker />
    </div>
  );
}
