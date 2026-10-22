console.log('[renderer] index.tsx loaded');
import { createRoot } from 'react-dom/client';

/**
 * UI switch. One build carries both interfaces, and v2 is the default: this
 * repository's agent ships with the v2 web app (0.2.0 went out with v1's screens
 * because the default was still v1). v1 stays reachable:
 *
 *   DOCUFLOW_UI=v1 npm run dev            — build time
 *   localStorage.setItem('docuflow-ui', 'v1'); location.reload();   — runtime
 *   localStorage.removeItem('docuflow-ui');    location.reload();   — back to the default
 *
 * localStorage wins over the env var, so a machine pinned to one UI stays there
 * regardless of how the app was launched. When v1 retires, delete this switch,
 * delete src/renderer/app/, and rename app-v2 -> app.
 */
const useV2 = (() => {
  try {
    const stored = localStorage.getItem('docuflow-ui');
    if (stored === 'v2') return true;
    if (stored === 'v1') return false;
  } catch {
    /* localStorage unavailable — fall through to the build-time default */
  }
  return process.env.DOCUFLOW_UI !== 'v1';
})();

async function boot() {
  const rootEl = document.getElementById('root');
  console.log('[renderer] root element:', rootEl ? 'found' : 'NOT FOUND');

  if (!rootEl) {
    document.body.innerHTML = '<div style="color:red;padding:2rem;font-family:monospace">ERROR: #root element not found</div>';
    return;
  }

  console.log(`[renderer] booting ${useV2 ? 'v2' : 'v1'} UI`);

  let App: React.ComponentType;
  if (useV2) {
    // app-v2/App pulls in app-v2/styles/app.css, which imports tokens.css
    ({ App } = await import('./app-v2/App'));
  } else {
    await import('./styles/globals.css');
    ({ App } = await import('./app/App'));
    // v1 has no title bar of its own, so it must claim the native frame. The
    // main process fixes `frame` at construction from whatever the last run
    // reported; without this, switching back to v1 would leave a frameless
    // window with nothing to drag.
    void window.agentBridge.setWindowLayout?.({
      width: 680,
      height: 780,
      minWidth: 400,
      minHeight: 500,
      chrome: 'native',
    });
  }

  console.log('[renderer] calling createRoot');
  createRoot(rootEl).render(<App />);
  console.log('[renderer] render() called');
}

void boot();
