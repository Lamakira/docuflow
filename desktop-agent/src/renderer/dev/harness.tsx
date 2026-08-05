/**
 * Browser harness for the v2 desktop-agent UI.
 *
 * Runs the renderer outside Electron against mockBridge, framed at the real
 * window sizes. Nothing here ships — it exists so a screen can be reviewed
 * without a build, a login and a running timer.
 *
 *   npm run harness   ->   http://localhost:5180
 */

import './installMock'; // must stay first — see installMock.ts
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMockBridge, createMockWidgetBridge, type Scenario } from './mockBridge';
import { App } from '../app-v2/App';
import { Widget } from '../app-v2/Widget';

const SCENARIOS: Scenario[] = [
  'running', 'paused', 'stopped', 'fresh', 'signed-out', 'revoked', 'error', 'rollover',
];

const SIZES = [
  { label: 'Default · 1020 × 660', w: 1020, h: 660, surface: 'app' as const },
  { label: 'Minimum · 820 × 560', w: 820, h: 560, surface: 'app' as const },
  { label: 'Activity bar · 380 × 44', w: 380, h: 44, surface: 'widget' as const },
  { label: 'Activity bar over dark', w: 380, h: 44, surface: 'widget-dark' as const },
];

const railButton = (active: boolean): React.CSSProperties => ({
  textAlign: 'left',
  padding: '6px 10px',
  borderRadius: 8,
  cursor: 'pointer',
  border: 'none',
  font: 'inherit',
  background: active ? '#e6f3fe' : 'transparent',
  color: active ? '#0075de' : '#615d59',
});

const railHeading: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  marginBottom: 8,
};

function Harness() {
  const [scenario, setScenario] = useState<Scenario>(
    (new URLSearchParams(location.search).get('scenario') as Scenario) ?? 'running',
  );
  const [size, setSize] = useState(SIZES[0]);
  const [mountKey, setMountKey] = useState(0);

  function pick(next: Scenario) {
    const w = window as unknown as { agentBridge: unknown; widgetBridge: unknown };
    w.agentBridge = createMockBridge(next);
    w.widgetBridge = createMockWidgetBridge(next);
    setScenario(next);
    setMountKey((k) => k + 1); // remount so context re-reads the new bridge
  }

  const isWidget = size.surface !== 'app';
  const onDark = size.surface === 'widget-dark';

  return (
    <div
      style={{
        display: 'flex',
        gap: 24,
        padding: 24,
        minHeight: '100vh',
        background: '#eceae8',
        font: '13px/1.4 ui-sans-serif, system-ui, sans-serif',
        color: '#615d59',
      }}
    >
      <aside style={{ width: 190, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div style={railHeading}>Scenario</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SCENARIOS.map((s) => (
              <button key={s} onClick={() => pick(s)} style={railButton(s === scenario)}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={railHeading}>Window</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SIZES.map((s) => (
              <button key={s.label} onClick={() => setSize(s)} style={railButton(s.label === size.label)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <p style={{ fontSize: 11, lineHeight: 1.5, color: '#757575' }}>
          Fire the idle prompt from the console:
          <br />
          <code>__mockIdle(720)</code>
        </p>
      </aside>

      <main>
        {/* The bar is framed on a backdrop rather than in a window chrome —
            it has none, and it has to survive whatever is behind it. */}
        <div
          style={
            isWidget
              ? { padding: 28, borderRadius: 12, background: onDark ? '#0f1524' : '#ffffff',
                  backgroundImage: onDark ? 'none' : 'repeating-linear-gradient(0deg,#f2f1f0 0 1px,transparent 1px 22px)' }
              : undefined
          }
        >
          <div
            key={mountKey}
            style={{
              width: size.w,
              height: size.h,
              overflow: isWidget ? 'visible' : 'hidden',
              background: isWidget ? 'transparent' : '#f3f5f7',
              // Square at the top like a native title bar, curved at the bottom
              // where the app itself rounds — the same shape Electron produces.
              borderRadius: isWidget ? 0 : '10px 10px 16px 16px',
              border: isWidget ? 'none' : '1px solid rgba(0,0,0,.08)',
              boxShadow: isWidget ? 'none' : '0 8px 32px rgba(0,0,0,.10)',
            }}
          >
            {isWidget ? <Widget /> : <App />}
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#757575' }}>
          {size.label} · {scenario}
        </div>
      </main>
    </div>
  );
}

const root = document.getElementById('harness-root');
if (root) createRoot(root).render(<Harness />);
