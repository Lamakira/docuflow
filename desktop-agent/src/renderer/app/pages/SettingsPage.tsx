import React from 'react';
import { useAgent } from '../stores/AgentContext';

export function SettingsPage() {
  const { state, logout } = useAgent();
  const agentState = state.agentState;

  async function handleSignOut() {
    if (window.confirm('Sign out of this device?')) {
      await logout();
    }
  }

  return (
    <div>
      <div className="page-title">Settings</div>

      <div className="card">
        <div className="card__title">Account</div>
        <div className="settings-row">
          <span className="settings-row__label">Email</span>
          <span className="settings-row__value">{agentState?.userEmail ?? '—'}</span>
        </div>
      </div>

      <div className="card">
        <div className="card__title">Connection</div>
        <div className="settings-row">
          <span className="settings-row__label">Server</span>
          <span className="settings-row__value">{agentState?.apiHost ?? '—'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Source</span>
          <span className="settings-row__value">{agentState?.apiBaseSource ?? '—'}</span>
        </div>
      </div>

      <div className="card">
        <div className="card__title">Device</div>
        <div className="settings-row">
          <span className="settings-row__label">Name</span>
          <span className="settings-row__value">{agentState?.deviceName ?? '—'}</span>
        </div>
      </div>

      <button
        className="btn btn--danger btn--full"
        style={{ marginTop: '0.5rem' }}
        onClick={handleSignOut}
      >
        Sign out
      </button>
    </div>
  );
}
