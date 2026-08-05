/**
 * Entry point for the floating activity bar window.
 *
 * Picks the v1 or v2 bar from the same `docuflow-ui` key the main window uses,
 * so both windows switch together and neither needs a rebuild.
 *
 * v1 (`./widget`) mounts itself as a side effect of being imported, which is
 * why it is imported rather than rendered here — that file stays untouched.
 * v2 exports a plain component and is mounted below.
 *
 * NOTE: localStorage is per-origin, and both windows are served from the same
 * webpack origin, so setting the key in either console affects both.
 */

import { createRoot } from 'react-dom/client';

/** Same resolution order as the main window — see index.tsx. */
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
  console.log(`[widget] booting ${useV2 ? 'v2' : 'v1'} activity bar`);

  if (!useV2) {
    await import('./widget'); // self-mounting
    return;
  }

  const root = document.getElementById('widget-root');
  if (!root) return;
  const { Widget } = await import('./app-v2/Widget');
  createRoot(root).render(<Widget />);
}

void boot();
