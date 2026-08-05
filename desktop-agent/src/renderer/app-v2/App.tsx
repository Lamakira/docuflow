/**
 * v2 app root — rail layout.
 *
 * Deliberately thin. All state and IPC still come from the existing
 * AgentContext: the main process, the four workers, the timer reducer and every
 * IPC handler are untouched, so there is nothing to keep in sync. UiContext
 * adds view-only state (drill-down, search, toast) on top.
 *
 * The layout is three columns — icon rail 78 → context panel 292 → stage — and
 * each screen owns both its panel and its stage, because the two halves read
 * the same data.
 */

import { useEffect } from 'react';
import { AgentProvider, useAgent } from '../app/stores/AgentContext';
import { ErrorBoundary } from '../app/components/common/ErrorBoundary';
import { UiProvider, useUi } from './ui/UiContext';
import { Rail } from './components/Rail';
import { TimerScreen } from './screens/TimerScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { ScreensScreen } from './screens/ScreensScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LoginPage } from './pages/LoginPage';
import { IdlePrompt } from './components/IdlePrompt';
import './styles/app.css';

/** The design's window. The old portrait size does not hold three columns. */
const WINDOW = { width: 1020, height: 660, minWidth: 820, minHeight: 560 };

function Shell() {
  const { state } = useAgent();
  const { clearCompleted } = useUi();
  const status = state.agentState?.timer.status;

  // A task marked complete stays hidden until something starts again — which
  // includes starting the same task a second time.
  useEffect(() => {
    if (status === 'running') clearCompleted();
  }, [status]);

  return (
    <div className="v2-shell">
      <Rail />
      {state.page === 'timer' && <TimerScreen />}
      {state.page === 'activity' && <ActivityScreen />}
      {state.page === 'screenshots' && <ScreensScreen />}
      {state.page === 'settings' && <SettingsScreen />}
      {/* Overlay: dims the app and nothing outside it. */}
      <IdlePrompt />
    </div>
  );
}

function AppInner() {
  const { state } = useAgent();

  // v1 is portrait and stays that way; only this UI asks for the wide window.
  useEffect(() => { void window.agentBridge.setWindowLayout?.(WINDOW); }, []);

  if (state.loading) return <div className="v2-loading">Loading…</div>;
  if (!state.agentState?.isPaired) return <LoginPage />;
  return <Shell />;
}

export function App() {
  return (
    <ErrorBoundary>
      <AgentProvider>
        <UiProvider>
          <ErrorBoundary>
            <AppInner />
          </ErrorBoundary>
        </UiProvider>
      </AgentProvider>
    </ErrorBoundary>
  );
}
