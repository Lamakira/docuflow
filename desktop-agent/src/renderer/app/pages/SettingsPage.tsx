import React, { useEffect, useState } from 'react';
import { useAgent } from '../stores/AgentContext';

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
      style={{
        width: 34,
        height: 18,
        borderRadius: 9,
        border: 'none',
        background: checked ? '#6366f1' : 'rgba(255,255,255,0.1)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 0.2s',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.18s',
          display: 'block',
        }}
      />
    </button>
  );
}

function SectionLabel({ label, badge }: { label: string; badge?: string }) {
  return (
    <div className="settings-section-header">
      <span className="settings-section-header__label">{label}</span>
      {badge && <span className="settings-section-header__badge">{badge}</span>}
    </div>
  );
}

export function SettingsPage() {
  const { state, logout } = useAgent();
  const agentState = state.agentState;

  const [prefs, setPrefs] = useState<LocalPrefs | null>(null);
  const [policy, setPolicy] = useState<OrgPolicy | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    window.agentBridge.getLocalPrefs().then(setPrefs).catch(() => {});
    window.agentBridge.getOrgPolicy().then(setPolicy).catch(() => {});
  }, []);

  async function handleOpenAtLogin(value: boolean) {
    if (toggling) return;
    setToggling(true);
    try {
      await window.agentBridge.setOpenAtLogin(value);
      setPrefs((prev) => prev ? { ...prev, openAtLogin: value } : prev);
    } finally {
      setToggling(false);
    }
  }

  async function handleSignOut() {
    if (window.confirm('Sign out of this device?')) {
      await logout();
    }
  }

  return (
    <div>
      <div className="page-title">Settings</div>

      {/* ── General ───────────────────────────────────────── */}
      <SectionLabel label="GENERAL" />
      <div className="card">
        <div className="settings-row settings-row--between">
          <div>
            <div className="settings-row__label">Open at login</div>
            {!prefs?.isPackaged && (
              <div className="settings-row__hint">Not available in dev mode</div>
            )}
          </div>
          <Toggle
            checked={prefs?.openAtLogin ?? false}
            onChange={handleOpenAtLogin}
            disabled={!prefs?.isPackaged || toggling}
          />
        </div>
        <div className="settings-row settings-row--between">
          <span className="settings-row__label">Version</span>
          <span className="settings-row__value">{prefs?.appVersion ?? '—'}</span>
        </div>
      </div>

      {/* ── Tracking — org policy ─────────────────────────── */}
      <SectionLabel label="TRACKING" badge="Org policy" />
      <div className="card">
        {policy ? (
          <>
            <div className="settings-row settings-row--between">
              <span className="settings-row__label">Idle detection</span>
              <span className="settings-row__value">
                {policy.idlePromptEnabled
                  ? `On — ${policy.idleTimeoutMinutes} min`
                  : 'Off'}
              </span>
            </div>
            <div className="settings-row settings-row--between">
              <span className="settings-row__label">Auto-stop countdown</span>
              <span className="settings-row__value">{policy.idleCountdownSeconds}s</span>
            </div>
            <div className="settings-row settings-row--between">
              <span className="settings-row__label">Screenshots</span>
              <span className="settings-row__value">
                {policy.screenshotsEnabled ? 'On' : 'Off'}
              </span>
            </div>
          </>
        ) : (
          <div className="settings-row">
            <span className="settings-row__hint">
              Policy loads after first heartbeat sync.
            </span>
          </div>
        )}
        <div className="settings-policy-note">
          These values are set by your organisation administrator and cannot be changed here.
        </div>
      </div>

      {/* ── Account & Device ──────────────────────────────── */}
      <SectionLabel label="ACCOUNT" />
      <div className="card">
        <div className="settings-row settings-row--between">
          <span className="settings-row__label">Email</span>
          <span className="settings-row__value">{agentState?.userEmail ?? '—'}</span>
        </div>
        <div className="settings-row settings-row--between">
          <span className="settings-row__label">Device</span>
          <span className="settings-row__value">{agentState?.deviceName ?? '—'}</span>
        </div>
        <div className="settings-row settings-row--between">
          <span className="settings-row__label">Server</span>
          <span className="settings-row__value settings-row__value--mono">
            {agentState?.apiHost ?? '—'}
          </span>
        </div>
      </div>

      <button
        className="btn btn--danger btn--full"
        style={{ marginTop: '0.25rem' }}
        onClick={handleSignOut}
      >
        Sign out
      </button>
    </div>
  );
}
