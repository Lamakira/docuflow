import React from 'react';
import { AgentProvider, useAgent } from './stores/AgentContext';
import { AgentLayout } from './layouts/AgentLayout';
import { LoginPage } from './pages/LoginPage';
import { ErrorBoundary } from './components/common/ErrorBoundary';

function AppInner() {
  const { state } = useAgent();

  if (state.loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
        Loading…
      </div>
    );
  }

  if (!state.agentState?.isPaired) {
    return <LoginPage />;
  }

  return <AgentLayout />;
}

export function App() {
  return (
    <ErrorBoundary>
      <AgentProvider>
        <ErrorBoundary>
          <AppInner />
        </ErrorBoundary>
      </AgentProvider>
    </ErrorBoundary>
  );
}
