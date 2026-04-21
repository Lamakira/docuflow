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
        desc="The activity bar is a compact floating widget that stays on screen while tracking. Drag the grip to reposition it anywhere on your display."
      />

      <Group label="Position">
        <Row
          label="Widget position"
          hint="Drag the grip (⠿) to move the widget. Resets to the bottom-right corner of your primary display."
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

      <Group label="Behaviour">
        <Row
          label="Click widget opens DocuFlow"
          hint="Clicking anywhere on the bar (outside the pause / close buttons) brings DocuFlow to the front."
          right={<FixedBadge label="Always on" />}
        />
        <Row
          label="Visible while tracking"
          hint="The widget appears automatically when a timer is running and hides when it stops."
          right={<FixedBadge label="Always on" />}
        />
        <Row
          label="Drag grip"
          hint="The nine-dot grip is always visible on the left side of the widget."
          right={<FixedBadge label="Always on" />}
        />
        <Row
          label="Custom widget size or theme"
          right={<SoonBadge />}
          dimmed
        />
        <Row
          label="Keep widget visible after stop"
          right={<SoonBadge />}
          dimmed
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
        desc="Tracking rules are defined by your organisation. The settings below are read-only on this device."
      />

      <PolicyBlock policy={policy} />

      <InfoNote>
        To change tracking rules, contact your administrator or visit the DocuFlow web app.
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
        desc="Control how DocuFlow behaves when your computer starts."
      />

      <Group label="Launch">
        <Row
          label="Launch at system sign-in"
          hint={
            devMode
              ? 'Not available in development mode.'
              : 'DocuFlow starts in the background when you sign in to your computer.'
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
          Launching at sign-in does not start tracking automatically — you still need to select
          a project and task.
        </Callout>
      </Group>

      <Group label="Window (coming soon)">
        <Row label="Start minimised to tray" right={<SoonBadge />} dimmed />
        <Row label="Open main window on launch" right={<SoonBadge />} dimmed />
        <Row label="Show activity bar on launch" right={<SoonBadge />} dimmed />
        <Row label="Restore last tracked context" right={<SoonBadge />} dimmed />
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
        desc="Get notified to start tracking when you have been away from DocuFlow."
      />
      <Placeholder
        icon="◎"
        title="Desktop reminders — coming in a future release"
        body='Scheduled "remind me to track" prompts and customisable quiet hours are planned. Time-based rules for your whole team can currently be configured from the DocuFlow web app by your administrator.'
      />
    </>
  );
}

// ─── Section: Time Zone ───────────────────────────────────────────────────────

function TimeZoneSection() {
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <>
      <SectionHead
        title="Time Zone"
        desc="DocuFlow stores all time entries in UTC on the server. Times are displayed in your local device time zone."
      />

      <Group label="Your device">
        <InfoRow label="Local time zone" value={localTz} />
      </Group>

      <Group label="Organisation">
        <InfoRow label="Company time zone" value="Set by your administrator (web app)" />
      </Group>

      <InfoNote>
        If your local time zone is wrong, update it in your operating system settings.
        Your tracked time entries store UTC timestamps and are not affected by this display setting.
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
        desc="Device details and account information. These values are read-only."
      />

      <Group label="Application">
        <InfoRow label="App version" value={prefs?.appVersion ?? '—'} />
        <InfoRow label="Device name" value={agentState?.deviceName ?? '—'} />
        <InfoRow label="Account" value={agentState?.userEmail ?? '—'} />
      </Group>

      <Group label="Server">
        <InfoRow label="Host" value={agentState?.apiHost ?? '—'} mono />
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

export function SettingsPage() {
  const { state, logout } = useAgent();
  const agentState = state.agentState;

  const [activeSection, setActiveSection] = useState<SettingsSection>('activity-bar');
  const [prefs, setPrefs] = useState<LocalPrefs | null>(null);
  const [policy, setPolicy] = useState<OrgPolicy | null>(null);

  useEffect(() => {
    window.agentBridge.getLocalPrefs().then(setPrefs).catch(() => {});
    window.agentBridge.getOrgPolicy().then(setPolicy).catch(() => {});
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
