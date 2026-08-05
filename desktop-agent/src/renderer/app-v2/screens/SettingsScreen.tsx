/**
 * Settings — six sections, one card of rows each.
 *
 * Three kinds of right-hand control, and the difference between them is the
 * point of the screen:
 *
 *   Toggle   a preference this person owns — flips and saves immediately
 *   Locked   set by the organisation for every device; shown, not hidden
 *   SOON     planned, visible, inert
 *
 * The locked rows are where someone learns what is being captured about them,
 * so they state the value rather than offering a switch that will not move.
 * There is no Save button: every change writes on the spot and toasts, which is
 * what "settings sync to the web app instantly" has to mean.
 */

import { useEffect, useState } from 'react';
import { useAgent } from '../../app/stores/AgentContext';
import { Panel, PanelHead, PanelBody, PanelRow } from '../components/Panel';
import { Stage, StageHead } from '../components/Stage';
import { useUi } from '../ui/UiContext';

type SectionId = 'activity-bar' | 'tracking' | 'startup' | 'reminders' | 'timezone' | 'advanced';

interface OrgPolicy {
  screenshotsEnabled: boolean;
  idlePromptEnabled: boolean;
  idleTimeoutMinutes: number;
  idleCountdownSeconds: number;
}

/* ── Row kinds ────────────────────────────────────────────────────────────── */

function Row({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="v2-set__row">
      <div className="v2-set__text">
        <span className="v2-set__label">{label}</span>
        {hint && <p className="v2-set__hint">{hint}</p>}
      </div>
      {children && <div className="v2-set__end">{children}</div>}
    </div>
  );
}

function Toggle({ on, onChange, label, locked }: {
  on: boolean;
  onChange?: (next: boolean) => void;
  label: string;
  locked?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked}
      className={`v2-switch${on ? ' v2-switch--on' : ''}${locked ? ' v2-switch--locked' : ''}`}
      onClick={() => onChange?.(!on)}
    >
      <span />
    </button>
  );
}

function LockedToggle({ on, label }: { on: boolean; label: string }) {
  return (
    <>
      <span className="v2-locked">Locked</span>
      <Toggle on={on} label={label} locked />
    </>
  );
}

function Soon() {
  return <span className="v2-soon">SOON</span>;
}

/* ── Screen ───────────────────────────────────────────────────────────────── */

export function SettingsScreen() {
  const { state, logout, dispatch } = useAgent();
  const { settingsSection, setSettingsSection, showToast } = useUi();

  const [policy, setPolicy] = useState<OrgPolicy | null>(null);
  const [prefs, setPrefs] = useState<{ openAtLogin: boolean; isPackaged: boolean; appVersion: string } | null>(null);
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [tz, setTz] = useState<'local' | 'utc'>('local');

  useEffect(() => {
    void window.agentBridge.getOrgPolicy().then(setPolicy);
    void window.agentBridge.getLocalPrefs().then((p) => { setPrefs(p); setOpenAtLogin(p.openAtLogin); });
    void window.agentBridge.getDisplayTimezone().then(setTz);
  }, []);

  // A tray deep-link lands on a section; consume it so a later tab switch does
  // not snap back to it.
  useEffect(() => {
    if (!state.settingsDeepSection) return;
    setSettingsSection(state.settingsDeepSection);
    dispatch({ type: 'CLEAR_SETTINGS_DEEP' });
  }, [state.settingsDeepSection]);

  const agent = state.agentState;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const section = settingsSection as SectionId;

  const SECTIONS: { id: SectionId; label: string; meta: string }[] = [
    { id: 'activity-bar', label: 'Activity Bar', meta: 'Floating widget & window' },
    { id: 'tracking', label: 'Tracking', meta: 'Idle detection, captures' },
    { id: 'startup', label: 'Startup', meta: 'Launch at login' },
    { id: 'reminders', label: 'Reminders', meta: 'Nudges when idle' },
    { id: 'timezone', label: 'Time Zone', meta: zone },
    { id: 'advanced', label: 'Advanced', meta: 'Device, account, updates' },
  ];

  async function saveOpenAtLogin(next: boolean) {
    setOpenAtLogin(next);
    const result = await window.agentBridge.setOpenAtLogin(next);
    if (!result.ok) {
      setOpenAtLogin(!next);
      showToast('Could not change the launch setting');
      return;
    }
    setPrefs((p) => (p ? { ...p, openAtLogin: next } : p));
    showToast(next ? 'DocuFlow will launch at sign-in' : 'DocuFlow will not launch at sign-in');
  }

  async function saveTimezone(next: 'local' | 'utc') {
    setTz(next);
    await window.agentBridge.setDisplayTimezone(next);
    showToast(next === 'utc' ? 'Day boundaries follow UTC' : 'Day boundaries follow this computer');
  }

  async function copy(value: string, what: string) {
    await window.agentBridge.copyToClipboard(value);
    showToast(`${what} copied`);
  }

  return (
    <>
      <Panel>
        <PanelHead title="Settings" subtitle={`Agent v${prefs?.appVersion ?? '—'} · synced`} />
        <PanelBody>
          <div className="v2-panel__list">
            {SECTIONS.map((s) => (
              <PanelRow
                key={s.id}
                name={s.label}
                meta={s.meta}
                selected={section === s.id}
                onClick={() => setSettingsSection(s.id)}
              />
            ))}
          </div>
        </PanelBody>
      </Panel>

      <Stage>
        {section === 'activity-bar' && (
          <>
            <StageHead title="Activity Bar" />
            <p className="v2-set__desc">
              A compact floating bar that stays on screen while the timer runs. When tracking pauses,
              the main window keeps the last task and a resume control visible.
            </p>
            <div className="v2-card v2-set__card">
              <Row
                label="Widget position"
                hint="Drag the nine-dot grip on the left of the bar. It stays inside the screen and is remembered between sessions."
              >
                <button
                  className="v2-btn v2-btn--secondary"
                  onClick={async () => {
                    await window.agentBridge.resetWidgetPosition();
                    showToast('Activity bar moved back to its default corner');
                  }}
                >
                  Reset position
                </button>
              </Row>
              <Row label="Visible while tracking" hint="Appears when a timer starts, hides when it stops.">
                <LockedToggle on label="Visible while tracking" />
              </Row>
              <Row label="Click the bar to open DocuFlow" hint="Everywhere except the pause and close buttons raises the window.">
                <LockedToggle on label="Click the bar to open DocuFlow" />
              </Row>
              <Row label="Keep the bar visible after stop"><Soon /></Row>
              <Row label="Custom bar size or theme"><Soon /></Row>
            </div>
            <p className="v2-set__foot">Agent v{prefs?.appVersion ?? '—'} · settings sync to the web app instantly.</p>
          </>
        )}

        {section === 'tracking' && (
          <>
            <StageHead title="Tracking" />
            <p className="v2-set__desc">
              How time is recorded, when idle time is dropped, and how often screens are captured.
              These are set by your organisation and apply to every device on your account.
            </p>
            <div className="v2-card v2-set__card">
              <Row
                label="Capture screens automatically"
                hint={policy
                  ? policy.screenshotsEnabled
                    ? 'One capture every few minutes while a timer runs.'
                    : 'Screen capture is switched off for your organisation.'
                  : 'Loads after the first sync with the server.'}
              >
                <LockedToggle on={!!policy?.screenshotsEnabled} label="Capture screens automatically" />
              </Row>
              <Row
                label="Drop idle time"
                hint={policy
                  ? policy.idlePromptEnabled
                    ? `Asks what to do when the machine is idle over ${policy.idleTimeoutMinutes} minutes.`
                    : 'Idle detection is switched off for your organisation.'
                  : 'Loads after the first sync with the server.'}
              >
                <LockedToggle on={!!policy?.idlePromptEnabled} label="Drop idle time" />
              </Row>
              <Row label="Per-app breakdown" hint="Attribute tracked time to the app in focus."><Soon /></Row>
            </div>
            <p className="v2-set__foot">To change these, contact your administrator or open the web app.</p>
          </>
        )}

        {section === 'startup' && (
          <>
            <StageHead title="Startup" />
            <p className="v2-set__desc">
              How DocuFlow launches when your computer starts. Tracking always needs an explicit
              action — it never starts on its own.
            </p>
            <div className="v2-card v2-set__card">
              <Row
                label="Launch at system sign-in"
                hint={prefs && !prefs.isPackaged
                  ? 'Only applies to packaged builds — unavailable in development.'
                  : 'Starts in the background. The window appears when you open it.'}
              >
                <Toggle
                  on={openAtLogin}
                  locked={prefs ? !prefs.isPackaged : true}
                  label="Launch at system sign-in"
                  onChange={(next) => void saveOpenAtLogin(next)}
                />
              </Row>
              <Row label="Minimise to tray on startup"><Soon /></Row>
              <Row label="Restore the last task on startup"><Soon /></Row>
            </div>
            <p className="v2-set__foot">Launching in the background does not start tracking.</p>
          </>
        )}

        {section === 'reminders' && (
          <>
            <StageHead title="Reminders" />
            <p className="v2-set__desc">
              Reminders nudge you to start tracking when you have been idle or away from DocuFlow.
              Administrators can configure time-based rules in the web app today.
            </p>
            <div className="v2-card v2-set__card">
              <Row label="Nudge when idle without a timer"><Soon /></Row>
              <Row label="Daily summary at end of day"><Soon /></Row>
              <Row label="Quiet hours"><Soon /></Row>
            </div>
            <p className="v2-set__foot">Desktop reminders arrive in a future release.</p>
          </>
        )}

        {section === 'timezone' && (
          <>
            <StageHead title="Time Zone" />
            <p className="v2-set__desc">
              Entries are always stored in UTC on the server. This only decides which timezone draws
              the day, week and month boundaries in your totals — historical data is never altered.
            </p>
            <div className="v2-card v2-set__card">
              <Row label="Use UTC for day boundaries" hint={`This computer is on ${zone}.`}>
                <Toggle on={tz === 'utc'} label="Use UTC for day boundaries" onChange={(next) => void saveTimezone(next ? 'utc' : 'local')} />
              </Row>
              <Row label="Company time zone" hint="Set by your administrator in the web app.">
                <span className="v2-set__value">Web app</span>
              </Row>
            </div>
            <p className="v2-set__foot">
              Local time is {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.
            </p>
          </>
        )}

        {section === 'advanced' && (
          <>
            <StageHead title="Advanced" />
            <p className="v2-set__desc">Device and account details. Copy any value when contacting support.</p>
            <div className="v2-card v2-set__card">
              <Row label="App version">
                <span className="v2-set__value">{prefs?.appVersion ?? '—'}</span>
                <button className="v2-btn v2-btn--secondary" onClick={() => void window.agentBridge.checkUpdate()}>
                  Check for updates
                </button>
              </Row>
              <Row label="Device name">
                <span className="v2-set__value">{agent?.deviceName ?? '—'}</span>
                <button className="v2-link" onClick={() => void copy(agent?.deviceName ?? '', 'Device name')}>Copy</button>
              </Row>
              <Row label="Account">
                <span className="v2-set__value">{agent?.userEmail ?? '—'}</span>
                <button className="v2-link" onClick={() => void copy(agent?.userEmail ?? '', 'Account')}>Copy</button>
              </Row>
              <Row label="Server" hint={agent?.apiBaseSource === 'default' ? 'Built-in default URL.' : 'Overridden by ~/.docuflow-url.'}>
                <span className="v2-set__value">{agent?.apiHost ?? '—'}</span>
                <button className="v2-link" onClick={() => void copy(agent?.apiHost ?? '', 'Host')}>Copy</button>
              </Row>
              <Row label="Sign out of this device" hint="Tracked time is saved on the server and will not be lost.">
                <button className="v2-btn v2-btn--danger" onClick={() => void logout()}>Sign out</button>
              </Row>
            </div>
            <p className="v2-set__foot">Agent v{prefs?.appVersion ?? '—'} · settings sync to the web app instantly.</p>
          </>
        )}
      </Stage>
    </>
  );
}
