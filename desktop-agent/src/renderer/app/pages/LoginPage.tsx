import React, { useState } from 'react';
import { useAgent } from '../stores/AgentContext';
import { ConnectionBadge } from '../components/common/ConnectionBadge';

export function LoginPage() {
  const { state, login } = useAgent();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const progress = state.loginProgress;
  const apiBaseSource = state.agentState?.apiBaseSource ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError(null);
    setLoading(true);
    const result = await login(email.trim(), password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Sign in failed');
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
            This device was disconnected. Please sign in again.
          </div>
        </div>
      )}

      <div className="login-page__title">Sign in</div>
      <div className="login-page__subtitle">Connect to your DocuFlow workspace</div>

      <form className="login-page__form" onSubmit={handleSubmit} style={{ flex: 'none' }}>
        <div className="field">
          <label className="field__label" htmlFor="email">Email</label>
          <input
            id="email"
            className="field__input"
            type="email"
            placeholder="you@example.com"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="password">Password</label>
          <input
            id="password"
            className="field__input"
            type="password"
            placeholder="Enter your password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          className="btn btn--primary btn--full"
          disabled={loading || !email || !password}
          style={{ marginTop: '0.5rem' }}
        >
          {loading ? (progress ?? 'Connecting…') : 'Sign in'}
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
