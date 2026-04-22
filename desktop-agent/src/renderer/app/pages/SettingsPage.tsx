import React, { useEffect, useRef, useState } from 'react';
import { useAgent } from '../stores/AgentContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type SettingsSection = 'activity-bar' | 'tracking' | 'startup' | 'reminders' | 'timezone' | 'advanced';

interface LocalPrefs {
  openAtLogin: boolean;
  isPackaged: boolean;
  appVersion: string;
}

interface OrgPolicy {
  screenshotsEnabled: boolean;
  idlePromptEnabled: boolean;
  idleTimeoutMinutes: number;
  idleCountdownSeconds: number;
}

// ─── Atoms ────────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={`sp-toggle${checked ? ' sp-toggle--on' : ''}${disabled ? ' sp-toggle--disabled' : ''}`}
    >
      <span className="sp-toggle__thumb" />
    </button>
  );
}

function PolicyBadge() {
  return <span className="sp-badge sp-badge--policy">Org policy</span>;
}

function SoonBadge() {
  return <span className="sp-badge sp-badge--soon">Coming soon</span>;
}

function FixedBadge({ label }: { label: string }) {
  return <span className="sp-badge sp-badge--fixed">{label}</span>;
}

// ─── Layout primitives ────────────────────────────────────────────────────────

function SectionHead({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="sp-section-head">
      <h2 className="sp-section-head__title">{title}</h2>
      {desc && <p className="sp-section-head__desc">{desc}</p>}
    </div>
  );
}

function Group({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="sp-group">
      {label && <div className="sp-group__label">{label}</div>}
      {children}
    </div>
  );
}

function Row({
  label,
  hint,
  right,
  dimmed,
}: {
  label: string;
  hint?: string;
  right: React.ReactNode;
  dimmed?: boolean;
}) {
  return (
    <div className={`sp-row${dimmed ? ' sp-row--dimmed' : ''}`}>
      <div className="sp-row__text">
        <span className="sp-row__label">{label}</span>
        {hint && <span className="sp-row__hint">{hint}</span>}
      </div>
      <div className="sp-row__right">{right}</div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="sp-row sp-row--info">
      <span className="sp-row__label">{label}</span>
      <span className={`sp-row__value${mono ? ' sp-row__value--mono' : ''}`}>{value}</span>
    </div>
  );
}

function CopyableInfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCopy() {
    if (!value || value === '—') return;
    window.agentBridge.copyToClipboard(value);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="sp-row sp-row--info">
      <span className="sp-row__label">{label}</span>
      <div className="sp-row__right--gap">
        <span className={`sp-row__value${mono ? ' sp-row__value--mono' : ''}`}>{value}</span>
        {value && value !== '—' && (
          <button className="sp-copy-btn" onClick={handleCopy} title="Copy to clipboard">
            {copied ? '✓' : '⎘'}
          </button>
        )}
      </div>
    </div>
  );
}

function PolicyBlock({ policy }: { policy: OrgPolicy | null }) {
  return (
    <div className="sp-policy-block">
      <div className="sp-policy-block__header">
        <span className="sp-policy-block__title">Organisation policy</span>
        <PolicyBadge />
      </div>
      <p className="sp-policy-block__note">
        These rules are configured by your administrator and apply to all devices on your account.
        They cannot be changed here.
      </p>
      {policy ? (
        <div className="sp-policy-block__rows">
          <InfoRow
            label="Idle detection"
            value={
              policy.idlePromptEnabled
                ? `Enabled — ${policy.idleTimeoutMinutes} min timeout`
                : 'Disabled'
            }
          />
          <InfoRow
            label="Auto-stop countdown"
            value={`${policy.idleCountdownSeconds} s warning before stopping`}
          />
          <InfoRow
            label="Screenshots"
            value={policy.screenshotsEnabled ? 'Enabled' : 'Disabled'}
          />
        </div>
      ) : (
        <div className="sp-policy-block__loading">
          Policy loads after the first heartbeat sync with the server.
        </div>
      )}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return <div className="sp-callout">{children}</div>;
}

function Placeholder({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="sp-placeholder">
      <div className="sp-placeholder__icon" aria-hidden="true">{icon}</div>
      <div className="sp-placeholder__title">{title}</div>
      <p className="sp-placeholder__body">{body}</p>
    </div>
  );
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return <div className="sp-info-note">{children}</div>;
}

function SaveFooter({
  onSave,
  onCancel,
  saving,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="sp-save-footer">
      <button className="btn btn--ghost btn--sm" onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button className="btn btn--primary btn--sm" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

// ─── Section: Activity Bar ────────────────────────────────────────────────────

function ActivityBarSection() {
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleReset() {
    if (resetting) return;
    setResetting(true);
    setResetDone(false);
    await window.agentBridge.resetWidgetPosition();
    setResetting(false);
    setResetDone(true);
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    doneTimerRef.current = setTimeout(() => setResetDone(false), 2500);
  }

  return (
    <>
      <SectionHead
        title="Activity Bar"
        desc="The activity bar is a compact floating widget that stays on screen while the timer is running. When tracking pauses, the main DocuFlow window keeps your last task and a resume control visible."
      />

      <Group label="Position">
        <Row
          label="Widget position"
          hint="Drag the nine-dot grip (⠿) on the left of the widget to reposition it anywhere. It snaps inside the screen boundary and is saved between sessions."
          right={
            <button
              className="btn btn--ghost btn--sm"
              onClick={handleReset}
              disabled={resetting}
            >
              {resetDone ? 'Reset ✓' : resetting ? 'Resetting…' : 'Reset to default'}
            </button>
          }
        />
      </Group>

      <Group label="Floating widget">
        <Row
          label="Click widget opens DocuFlow"
          hint="Clicking anywhere on the bar (outside the pause and close buttons) brings the DocuFlow window to the front."
          right={<FixedBadge label="Always on" />}
        />
        <Row
          label="Visible while tracking"
          hint="The widget appears automatically when a timer starts and hides when it stops."
          right={<FixedBadge label="Always on" />}
        />
        <Row
          label="Nine-dot drag grip"
          hint="The grip is always visible on the left edge of the widget. Only the grip initiates a drag — the rest of the bar opens DocuFlow on click."
          right={<FixedBadge label="Always on" />}
        />
        <Row
          label="Keep floating bar visible after stop"
          hint="Show the floating activity bar in a paused state after the timer ends, so you can resume without opening DocuFlow."
          right={<SoonBadge />}
          dimmed
        />
        <Row
          label="Custom widget size or theme"
          right={<SoonBadge />}
          dimmed
        />
      </Group>

      <Group label="Main window">
        <Row
          label="Persistent header after tracking pauses"
          hint="The DocuFlow window keeps your last project and task visible with a warm header and a one-click resume control — even when the floating widget is hidden."
          right={<FixedBadge label="Always on" />}
        />
        <Row
          label="Window raised during idle prompt"
          hint="When the 'Are you still working?' prompt appears, DocuFlow is raised above other windows without stealing keyboard focus."
          right={<FixedBadge label="Always on" />}
        />
      </Group>
    </>
  );
}

// ─── Section: Tracking ────────────────────────────────────────────────────────

function TrackingSection({ policy }: { policy: OrgPolicy | null }) {
  return (
    <>
      <SectionHead
        title="Tracking"
        desc="Idle detection, auto-stop, and screenshot capture are configured by your organisation and applied to all devices on your account. They cannot be changed on this device."
      />

      <PolicyBlock policy={policy} />

      <InfoNote>
        When you are idle for the configured period, DocuFlow shows an "Are you still working?" prompt.
        If you do not respond before the countdown ends, the timer stops automatically and idle time is excluded from your totals.
        To change these thresholds, contact your administrator or visit the DocuFlow web app.
      </InfoNote>
    </>
  );
}

// ─── Section: Startup ────────────────────────────────────────────────────────

interface StartupDraft {
  openAtLogin: boolean;
}

function StartupSection({ prefs }: { prefs: LocalPrefs | null }) {
  const [draft, setDraft] = useState<StartupDraft>({ openAtLogin: false });
  const [saved, setSaved] = useState<StartupDraft>({ openAtLogin: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (prefs) {
      const p = { openAtLogin: prefs.openAtLogin };
      setDraft(p);
      setSaved(p);
    }
  }, [prefs?.openAtLogin, prefs?.isPackaged]);

  const isDirty = draft.openAtLogin !== saved.openAtLogin;
  const devMode = prefs != null && !prefs.isPackaged;

  async function handleSave() {
    setSaving(true);
    try {
      await window.agentBridge.setOpenAtLogin(draft.openAtLogin);
      setSaved({ ...draft });
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft({ ...saved });
  }

  return (
    <>
      <SectionHead
        title="Startup"
        desc="Control how DocuFlow launches when your computer starts. Tracking always requires an explicit action — it never starts automatically."
      />

      <Group label="Launch">
        <Row
          label="Launch at system sign-in"
          hint={
            devMode
              ? 'Not available in development mode — only applies to packaged builds.'
              : 'DocuFlow starts silently in the background when you sign in. The main window appears when you open it from the taskbar or interact with the activity bar.'
          }
          right={
            <Toggle
              checked={draft.openAtLogin}
              onChange={(v) => setDraft((d) => ({ ...d, openAtLogin: v }))}
              disabled={devMode || saving}
            />
          }
        />
        <Callout>
          Background launch does not start tracking — you still need to select a project and task.
        </Callout>
      </Group>

      <Group label="Window behaviour (coming soon)">
        <Row
          label="Minimise to tray on startup"
          hint="Keep DocuFlow hidden in the system tray on launch instead of showing the main window."
          right={<SoonBadge />}
          dimmed
        />
        <Row
          label="Open main window on startup"
          hint="Bring the DocuFlow window to the front automatically after launch."
          right={<SoonBadge />}
          dimmed
        />
        <Row
          label="Show activity bar on startup"
          hint="Display the floating widget when DocuFlow launches, even if no timer is running."
          right={<SoonBadge />}
          dimmed
        />
        <Row
          label="Restore last active context"
          hint="Pre-select the last project and task so you can resume tracking in one click."
          right={<SoonBadge />}
          dimmed
        />
      </Group>

      {isDirty && (
        <SaveFooter onSave={handleSave} onCancel={handleCancel} saving={saving} />
      )}
    </>
  );
}

// ─── Section: Reminders ───────────────────────────────────────────────────────

function RemindersSection() {
  return (
    <>
      <SectionHead
        title="Reminders"
        desc="Reminders nudge you to start tracking when you have been idle or away from DocuFlow."
      />
      <Placeholder
        icon="◎"
        title="Desktop reminders — coming in a future release"
        body="Quiet-hour rules, recurring nudges, and team-wide reminder policies are planned. Administrators can configure time-based notification rules now from the DocuFlow web app."
      />
    </>
  );
}

// ─── Section: Time Zone ───────────────────────────────────────────────────────

function TimeZoneSection() {
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [localTime, setLocalTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  const [displayTz, setDisplayTz] = useState<'local' | 'utc'>('local');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setLocalTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    window.agentBridge.getDisplayTimezone().then(setDisplayTz).catch(() => {});
  }, []);

  async function handleTzChange(next: 'local' | 'utc') {
    setSaving(true);
    setDisplayTz(next);
    await window.agentBridge.setDisplayTimezone(next).catch(() => {});
    setSaving(false);
  }

  const previewDate = new Date();
  const utcTime = previewDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

  return (
    <>
      <SectionHead
        title="Time Zone"
        desc="All time entries are stored in UTC on the server. Choose which timezone defines day/week/month boundaries for the Worked Today summary card."
      />

      <Group label="Display preference">
        <div className="sp-tz-options">
          <label className={`sp-tz-option${displayTz === 'local' ? ' sp-tz-option--active' : ''}`}>
            <input
              type="radio"
              name="displayTz"
              value="local"
              checked={displayTz === 'local'}
              onChange={() => handleTzChange('local')}
              disabled={saving}
            />
            <span className="sp-tz-option__title">Local (OS timezone)</span>
            <span className="sp-tz-option__sub">{localTz} — {localTime}</span>
          </label>
          <label className={`sp-tz-option${displayTz === 'utc' ? ' sp-tz-option--active' : ''}`}>
            <input
              type="radio"
              name="displayTz"
              value="utc"
              checked={displayTz === 'utc'}
              onChange={() => handleTzChange('utc')}
              disabled={saving}
            />
            <span className="sp-tz-option__title">UTC</span>
            <span className="sp-tz-option__sub">Universal Coordinated Time — {utcTime} UTC</span>
          </label>
        </div>
      </Group>

      <Group label="Organisation">
        <InfoRow label="Company time zone" value="Set by your administrator (web app)" />
      </Group>

      <InfoNote>
        This preference only affects week/month boundaries in the Worked Today hover card.
        Individual time entries always store UTC timestamps — historical data is never altered.
      </InfoNote>
    </>
  );
}

// ─── Section: Advanced ───────────────────────────────────────────────────────

function AdvancedSection({
  prefs,
  agentState,
  onSignOut,
}: {
  prefs: LocalPrefs | null;
  agentState: any;
  onSignOut: () => void;
}) {
  const apiSource =
    agentState?.apiBaseSource === 'file'
      ? '~/.docuflow-url'
      : agentState?.apiBaseSource === 'env'
      ? 'environment variable'
      : agentState?.apiBaseSource ?? '—';

  return (
    <>
      <SectionHead
        title="Advanced"
        desc="Device and account details. Click ⎘ to copy a value — useful when contacting support."
      />

      <Group label="Application">
        <CopyableInfoRow label="App version" value={prefs?.appVersion ?? '—'} />
        <CopyableInfoRow label="Device name" value={agentState?.deviceName ?? '—'} />
        <CopyableInfoRow label="Account" value={agentState?.userEmail ?? '—'} />
      </Group>

      <Group label="Server">
        <CopyableInfoRow label="Host" value={agentState?.apiHost ?? '—'} mono />
        <InfoRow label="URL source" value={apiSource} mono />
      </Group>

      <Group label="Account">
        <div className="sp-row sp-row--danger-zone">
          <div className="sp-row__text">
            <span className="sp-row__label">Sign out of this device</span>
            <span className="sp-row__hint">
              Your tracked time is saved on the server and will not be lost.
            </span>
          </div>
          <button className="btn btn--danger btn--sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </Group>
    </>
  );
}

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: SettingsSection; label: string }[] = [
  { id: 'activity-bar', label: 'Activity Bar' },
  { id: 'tracking',     label: 'Tracking'     },
  { id: 'startup',      label: 'Startup'      },
  { id: 'reminders',    label: 'Reminders'    },
  { id: 'timezone',     label: 'Time Zone'    },
  { id: 'advanced',     label: 'Advanced'     },
];

// ─── Root ─────────────────────────────────────────────────────────────────────

export function SettingsPage({ initialSection }: { initialSection?: string }) {
  const { state, logout, dispatch } = useAgent();
  const agentState = state.agentState;

  const [activeSection, setActiveSection] = useState<SettingsSection>(
    (initialSection as SettingsSection) ?? 'activity-bar'
  );
  const [prefs, setPrefs] = useState<LocalPrefs | null>(null);
  const [policy, setPolicy] = useState<OrgPolicy | null>(null);

  useEffect(() => {
    window.agentBridge.getLocalPrefs().then(setPrefs).catch(() => {});
    window.agentBridge.getOrgPolicy().then(setPolicy).catch(() => {});
    // Clear deep-link so navigating away and back resets to default
    dispatch({ type: 'CLEAR_SETTINGS_DEEP' });
  }, []);

  async function handleSignOut() {
    if (window.confirm('Sign out of this device?')) {
      await logout();
    }
  }

  return (
    <div className="sp-layout">
      {/* ── Left nav ── */}
      <nav className="sp-nav" aria-label="Settings sections">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sp-nav__item${activeSection === item.id ? ' sp-nav__item--active' : ''}`}
            onClick={() => setActiveSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* ── Right content ── */}
      <div className="sp-content">
        {activeSection === 'activity-bar' && <ActivityBarSection />}
        {activeSection === 'tracking'     && <TrackingSection policy={policy} />}
        {activeSection === 'startup'      && <StartupSection prefs={prefs} />}
        {activeSection === 'reminders'    && <RemindersSection />}
        {activeSection === 'timezone'     && <TimeZoneSection />}
        {activeSection === 'advanced'     && (
          <AdvancedSection
            prefs={prefs}
            agentState={agentState}
            onSignOut={handleSignOut}
          />
        )}
      </div>
    </div>
  );
}
