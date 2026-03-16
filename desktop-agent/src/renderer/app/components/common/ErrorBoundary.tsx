import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, error.stack, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <div style={{
          padding: '2rem',
          fontFamily: 'monospace',
          background: '#0f172a',
          color: '#f87171',
          height: '100vh',
          overflow: 'auto',
          fontSize: '0.8rem',
          lineHeight: '1.6',
        }}>
          <div style={{ color: '#fca5a5', fontWeight: 700, fontSize: '1rem', marginBottom: '1rem' }}>
            ⚠ Renderer Error
          </div>
          <div style={{ color: '#fbbf24', marginBottom: '0.5rem' }}>{err.message}</div>
          <pre style={{ color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {err.stack}
          </pre>
          <div style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.72rem' }}>
            Open DevTools (Ctrl+Shift+I) or check debug.log in %APPDATA%\docuflow-desktop-agent\
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
