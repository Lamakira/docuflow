/**
 * Account menu — the avatar at the foot of the rail.
 *
 * The avatar used to be decoration: it showed an initial and a presence dot and
 * did nothing. It is the only place in the shell that stands for "you", so it
 * is where the account actions belong — the ones you reach for without wanting
 * to walk through Settings first.
 *
 * Sign out is separated and coloured because it is the one item here that ends
 * the session; the rest are navigation.
 */

import { useEffect, useRef, useState } from 'react';
import { useAgent } from '../../app/stores/AgentContext';
import { useUi } from '../ui/UiContext';
import { CogIcon, ExternalLinkIcon, RefreshIcon, SignOutIcon } from '../icons';

export function AvatarMenu() {
  const { state, dispatch, logout } = useAgent();
  const { showToast, setSettingsSection } = useUi();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const email = state.agentState?.userEmail ?? '';
  const device = state.agentState?.deviceName ?? '';
  const paired = !!state.agentState?.isPaired;
  const apiBase = state.agentState?.apiBase ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function checkUpdate() {
    if (checking) return;
    setChecking(true);
    const result = await window.agentBridge.checkUpdate();
    setChecking(false);
    setOpen(false);
    if (!result.ok) { showToast(result.error ?? 'Could not reach the update server'); return; }
    showToast(
      result.updateAvailable
        ? `Version ${result.latestVersion} is available — Settings › Advanced to download`
        : `You are on the latest version (${result.currentVersion})`,
    );
  }

  return (
    <div className="v2-account" ref={rootRef}>
      <button
        className="v2-rail__avatar"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email || 'Account'}
      >
        {email ? email[0].toUpperCase() : '?'}
        <span className={`v2-rail__presence${paired ? '' : ' v2-rail__presence--off'}`} />
      </button>

      {open && (
        <div className="v2-menu" role="menu">
          <div className="v2-menu__head">
            <span className="v2-menu__email">{email || 'Not signed in'}</span>
            {device && <span className="v2-menu__device">{device}</span>}
          </div>

          <button
            className="v2-menu__item"
            role="menuitem"
            onClick={() => {
              setSettingsSection('activity-bar');
              dispatch({ type: 'SET_PAGE', page: 'settings' });
              setOpen(false);
            }}
          >
            <CogIcon size={13} />
            Settings
          </button>

          <button
            className="v2-menu__item"
            role="menuitem"
            disabled={!apiBase}
            onClick={() => { if (apiBase) window.agentBridge.openExternal(apiBase); setOpen(false); }}
          >
            <ExternalLinkIcon size={13} />
            Open the web app
          </button>

          <button className="v2-menu__item" role="menuitem" disabled={checking} onClick={() => void checkUpdate()}>
            <RefreshIcon size={13} />
            {checking ? 'Checking…' : 'Check for updates'}
          </button>

          <button
            className="v2-menu__item v2-menu__item--danger"
            role="menuitem"
            onClick={() => { setOpen(false); void logout(); }}
          >
            <SignOutIcon size={13} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
