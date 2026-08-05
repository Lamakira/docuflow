console.log('[renderer] index.tsx loaded');
import { createRoot } from 'react-dom/client';

/**
 * UI switch — the only edit the v2 redesign makes to existing code.
 *
 * One build carries both interfaces. Two ways to choose:
 *
 *   DOCUFLOW_UI=v2 npm run dev            — build time, for a demo or review
 *   localStorage.setItem('docuflow-ui', 'v2'); location.reload();   — runtime
 *   localStorage.removeItem('docuflow-ui');    location.reload();   — back to v1
 *
 * localStorage wins over the env var, so a machine pinned to one UI stays there
 * regardless of how the app was launched. Rolling back a bad v2 build is
 * therefore a key, not a revert. When v2 ships, delete this switch, delete
 * src/renderer/app/, and rename app-v2 -> app.
 */
const useV2 = (() => {
  try {
    const stored = localStorage.getItem('docuflow-ui');
    if (stored === 'v2') return true;
    if (stored === 'v1') return false;
  } catch {
    /* localStorage unavailable — fall through to the build-time default */
  }
  return process.env.DOCUFLOW_UI === 'v2';
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
  }

  console.log('[renderer] calling createRoot');
  createRoot(rootEl).render(<App />);
  console.log('[renderer] render() called');
}

void boot();
