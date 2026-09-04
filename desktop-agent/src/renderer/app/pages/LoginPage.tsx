import React, { useState } from 'react';
import { useAgent } from '../stores/AgentContext';
import { ConnectionBadge } from '../components/common/ConnectionBadge';

const PAIRING_CODE_LENGTH = 6;

export function LoginPage() {
  const { state, login } = useAgent();
  const [pairingCode, setPairingCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const progress = state.loginProgress;
  const apiBaseSource = state.agentState?.apiBaseSource ?? null;
  const ready = pairingCode.length === PAIRING_CODE_LENGTH;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setLoading(true);
    const result = await login(pairingCode);
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Pairing failed');
    }
  }

  return (
    <div className="login-page">
      <div className="login-page__logo">
        <div className="login-page__logo-icon">DF</div>
        <span className="login-page__logo-text">DocuFlow Agent</span>
        <ConnectionBadge source={apiBaseSource} />
      </div>

      {state.wasRevoked && (
        <div className="revoke-banner">
          <span>⚠</span>
          <div>
            <strong>Session ended</strong><br />
            This device was disconnected. Pair it again from the web app.
          </div>
        </div>
      )}

      <div className="login-page__title">Pair this device</div>
      <div className="login-page__subtitle">
        In DocuFlow, open Devices and generate a pairing code.
      </div>

      <form className="login-page__form" onSubmit={handleSubmit} style={{ flex: 'none' }}>
        <div className="field">
          <label className="field__label" htmlFor="pairing-code">Pairing code</label>
          <input
            id="pairing-code"
            className="field__input login-page__code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={PAIRING_CODE_LENGTH}
            placeholder="XXXXXX"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          className="btn btn--primary btn--full"
          disabled={loading || !ready}
          style={{ marginTop: '0.5rem' }}
        >
          {loading ? (progress ?? 'Connecting…') : 'Pair device'}
        </button>

        {error && <div className="login-page__error">{error}</div>}
      </form>

      <div style={{ flex: 1 }} />
      <div className="login-page__footer">
        <span className="text-dim text-xs">{state.agentState?.apiHost ?? ''}</span>
      </div>
    </div>
  );
}
