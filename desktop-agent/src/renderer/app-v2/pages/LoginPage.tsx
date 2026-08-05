/**
 * Sign in.
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

export function LoginPage() {
  const { state, login } = useAgent();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const source = state.agentState?.apiBaseSource;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError(null);
    setLoading(true);
    const result = await login(email.trim(), password);
    setLoading(false);
    if (!result.ok) setError(result.error ?? 'Sign in failed');
  }

  return (
    <div className="v2-login">
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
            This device was disconnected. Please sign in again — the time you already tracked
            is saved on the server.
          </p>
        </div>
      )}

      <h1>Sign in</h1>
      <p className="v2-note">Connect to your DocuFlow workspace</p>

      <form className="v2-login__form" onSubmit={handleSubmit}>
        <label className="v2-field">
          <span className="v2-field__label">Email</span>
          <input
            className="v2-input"
            type="email"
            placeholder="you@example.com"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </label>

        <label className="v2-field">
          <span className="v2-field__label">Password</span>
          <input
            className="v2-input"
            type="password"
            placeholder="Enter your password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </label>

        <button className="v2-btn v2-btn--primary v2-btn--block" type="submit" disabled={loading || !email || !password}>
          {loading ? (state.loginProgress ?? 'Connecting…') : 'Sign in'}
        </button>

        {error ? (
          <p className="v2-login__error"><span className="v2-login__errdot" />{error}</p>
        ) : (
          <p className="v2-note v2-note--quiet">The button stays disabled until both fields have a value.</p>
        )}
      </form>

      <footer className="v2-login__foot">{state.agentState?.apiHost ?? ''}</footer>
    </div>
  );
}
