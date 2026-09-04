/**
 * Pair this device.
 *
 * Four states: default, connecting (progress streams into the button label),
 * error, and session-ended after an admin revoked this device.
 *
 * The revoke notice is a plain card in the serif voice, not a red alert. The
 * person did nothing wrong and their tracked time is intact — saying so is the
 * whole job of that block.
 */

import { useState } from 'react';
import { useAgent } from '../../app/stores/AgentContext';
import { WindowControls } from '../components/WindowControls';

const PAIRING_CODE_LENGTH = 6;

export function LoginPage() {
  const { state, login } = useAgent();
  const [pairingCode, setPairingCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const source = state.agentState?.apiBaseSource;
  const ready = pairingCode.length === PAIRING_CODE_LENGTH;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setLoading(true);
    const result = await login(pairingCode);
    setLoading(false);
    if (!result.ok) setError(result.error ?? 'Pairing failed');
  }

  return (
    <div className="v2-login">
      {/* Sign-in has no title bar of its own, and a window you cannot close is
          a trap — the controls come along. */}
      <div className="v2-login__chrome"><WindowControls /></div>

      <header className="v2-login__brand">
        <span className="v2-login__mark">DF</span>
        <span className="v2-login__name">DocuFlow Agent</span>
        {/* DEV only — see the note in App.tsx. The server host is printed at
            the foot of this screen either way. */}
        {source && source !== 'default' && <span className="v2-stage__badge">DEV</span>}
      </header>

      {state.wasRevoked && (
        <div className="v2-card v2-login__revoked">
          <strong className="v2-set__label">Session ended</strong>
          <p className="prose">
            This device was disconnected. Pair it again from Devices in the web app —
            the time you already tracked is saved on the server.
          </p>
        </div>
      )}

      <h1>Pair this device</h1>
      <p className="v2-note">In DocuFlow, open Devices and generate a pairing code.</p>

      <form className="v2-login__form" onSubmit={handleSubmit}>
        <label className="v2-field">
          <span className="v2-field__label">Pairing code</span>
          <input
            className="v2-input v2-login__code"
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
        </label>

        <button className="v2-btn v2-btn--primary v2-btn--block" type="submit" disabled={loading || !ready}>
          {loading ? (state.loginProgress ?? 'Connecting…') : 'Pair device'}
        </button>

        {error ? (
          <p className="v2-login__error"><span className="v2-login__errdot" />{error}</p>
        ) : (
          <p className="v2-note v2-note--quiet">The button stays disabled until the code is 6 characters.</p>
        )}
      </form>

      <footer className="v2-login__foot">{state.agentState?.apiHost ?? ''}</footer>
    </div>
  );
}
