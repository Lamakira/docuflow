/**
 * Update required (#398).
 *
 * The server refused this agent's protocol version. Nothing in the app works
 * past this point except what the main process keeps doing on its own: capture
 * is stopped, and the queue keeps draining, so what was already recorded still
 * reaches the server. The screen says what happened, the one thing to do, and
 * where the Timer stands, because the Member can no longer stop it from here.
 *
 * Built on the sign-in page's layout: like it, the window has no rail and no
 * title bar of its own, and like every pane it fits the minimum window without
 * scrolling (README rule 1).
 */

import { useAgent } from '../../app/stores/AgentContext';
import type { TimerState } from '../../app/types';
import { WindowControls } from '../components/WindowControls';
import { BrandMark } from '../components/BrandMark';

/** What the Timer is on, in the words the rest of the app uses. */
function trackedName(timer: TimerState): string {
  if (timer.taskName && timer.projectName) return `${timer.taskName} (${timer.projectName})`;
  return timer.taskName || timer.projectName || 'The Timer';
}

const TIMER_ON_SERVER = {
  running: {
    title: 'Your Timer is still running',
    body: (name: string) => `${name} keeps counting on the server. You can stop it from the DocuFlow web app.`,
  },
  paused: {
    title: 'Your Timer is paused',
    body: (name: string) => `${name} stays paused on the server. You can resume or stop it from the DocuFlow web app.`,
  },
} as const;

export function UpdateRequiredPage() {
  const { state } = useAgent();
  const agent = state.agentState;
  const required = agent?.updateRequired;
  if (!agent || !required) return null;

  const { downloadUrl, minProtocolVersion } = required;
  // No installer for this system: the web app's Downloads page still has one.
  const action = downloadUrl
    ? { url: downloadUrl, label: 'Download update' }
    : agent.apiBase
      ? { url: agent.apiBase, label: 'Open web app' }
      : null;
  const timer = agent.timer;
  const onServer = timer.entryId && (timer.status === 'running' || timer.status === 'paused')
    ? TIMER_ON_SERVER[timer.status]
    : null;

  return (
    <div className="v2-login v2-update-required">
      <div className="v2-login__chrome"><WindowControls /></div>

      <header className="v2-login__brand">
        <span className="v2-login__mark"><BrandMark variant="tile" size={38} /></span>
        <span className="v2-login__name">DocuFlow Agent</span>
      </header>

      <h1>Update required</h1>
      <p className="v2-update-required__lead">
        This version of DocuFlow Agent is no longer supported. Download and install the new
        version to keep tracking.
      </p>

      <div className="v2-update-required__actions">
        {action && (
          <button
            className="v2-btn v2-btn--primary v2-btn--block"
            type="button"
            autoFocus
            onClick={() => window.agentBridge.openExternal(action.url)}
          >
            {action.label}
          </button>
        )}
        {minProtocolVersion !== null && (
          <p className="v2-note v2-note--quiet">Needs agent protocol {minProtocolVersion} or later</p>
        )}
      </div>

      <div className="v2-card v2-update-required__card">
        {onServer && (
          <section>
            <strong className="v2-set__label">{onServer.title}</strong>
            <p>{onServer.body(trackedName(timer))}</p>
          </section>
        )}
        <section>
          <strong className="v2-set__label">Tracking is stopped</strong>
          <p>
            Screenshots and activity are not recorded until you update. What this device already
            recorded is still being sent.
          </p>
        </section>
      </div>

      <footer className="v2-login__foot">{agent.apiHost ?? ''}</footer>
    </div>
  );
}
