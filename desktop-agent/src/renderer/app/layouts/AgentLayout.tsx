import React from 'react';
import { useAgent } from '../stores/AgentContext';
import { AgentSidebar } from '../components/sidebar/AgentSidebar';
import { ActiveTimerHeader } from '../components/timer/ActiveTimerHeader';
import { WorkedToday } from '../components/timer/WorkedToday';
import { IdlePrompt } from '../components/timer/IdlePrompt';
import { TimerPage } from '../pages/TimerPage';
import { ActivityPage } from '../pages/ActivityPage';
import { ScreenshotsPage } from '../pages/ScreenshotsPage';
import { SettingsPage } from '../pages/SettingsPage';

export function AgentLayout() {
  const { state } = useAgent();
  const { page } = state;

  return (
    <div className="agent-layout">
      <AgentSidebar />
      <div className="agent-main">
        <ActiveTimerHeader />
        <WorkedToday />
        <div className="agent-page">
          {page === 'timer' && <TimerPage />}
          {page === 'activity' && <ActivityPage />}
          {page === 'screenshots' && <ScreenshotsPage />}
          {page === 'settings' && <SettingsPage initialSection={state.settingsDeepSection ?? undefined} />}
        </div>
      </div>
      <IdlePrompt />
    </div>
  );
}
