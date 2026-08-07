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
import type { ChromeMode } from '../../lib/windowChrome';
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

/**
 * The design's window. The old portrait size does not hold three columns.
 *
 * `chrome: 'app'` tells the main process this UI draws its own title bar. How
 * far that goes is the main process's call and differs by platform — frameless
 * and transparent on Linux, frameless and opaque on Windows, a native frame
 * with inset traffic lights on macOS (see lib/windowChrome.ts). All three are
 * construction-time options, so the answer applies at the *next* launch;
 * switching UI costs one restart.
 */
const WINDOW = {
  width: 1020,
  height: 660,
  minWidth: 820,
  minHeight: 560,
  background: '#f3f5f7',
  chrome: 'app' as const,
};

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
  const { setChrome } = useUi();

  /**
   * Ask for the window this UI needs, and believe only the answer.
   *
   * The answer names the mode the window was really built with, which is what
   * decides whether the app draws window buttons and whether it may cut its own
   * corners. It comes back 'native' when the running main process built a
   * framed window — an older build, or this renderer hot-reloaded underneath
   * one — and then the frame stays in charge until a restart, with no drawn
   * title bar over it and no window IPC that is not there.
   */
  useEffect(() => {
    const apply = (mode: ChromeMode) => {
      setChrome(mode);
      document.documentElement.dataset.chrome = mode;
    };

    const ask = window.agentBridge?.setWindowLayout;
    if (!ask) {
      // The browser harness, or a preload without the handler: whatever frame
      // exists is not ours to draw.
      apply('native');
      return;
    }

    void ask(WINDOW)
      .then((result) =>
        apply(result?.chrome ?? (result?.chromeApplied ? 'app' : 'native')),
      )
      .catch(() => apply('native'));
  }, []);

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
