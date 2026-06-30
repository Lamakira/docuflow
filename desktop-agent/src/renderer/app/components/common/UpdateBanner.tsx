import React, { useEffect, useState } from 'react';

/**
 * Thin banner shown at the top of the app when a newer installer is available
 * on the server. Checks once on mount. The "Download" button opens the
 * platform installer in the default browser (.deb/.dmg/.exe can't self-apply
 * without elevation), then the user re-runs the installer to update.
 */
export function UpdateBanner() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.agentBridge.checkUpdate().then((res) => {
      if (cancelled) return;
      if (res.ok && res.updateAvailable && res.latestVersion && res.downloadUrl) {
        setLatestVersion(res.latestVersion);
        setDownloadUrl(res.downloadUrl);
      }
    }).catch(() => { /* offline / endpoint unreachable — stay silent */ });
    return () => { cancelled = true; };
  }, []);

  if (dismissed || !latestVersion || !downloadUrl) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.45rem 0.75rem',
        background: 'var(--accent)',
        color: '#fff',
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <span style={{ flex: 1 }}>
        Update available — version {latestVersion}.
      </span>
      <button
        onClick={() => downloadUrl && window.agentBridge.openExternal(downloadUrl)}
        style={{
          background: '#fff',
          color: 'var(--accent)',
          border: 'none',
          borderRadius: 'var(--radius, 6px)',
          padding: '0.25rem 0.6rem',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Download
      </button>
      <button
        onClick={() => setDismissed(true)}
        title="Dismiss"
        style={{
          background: 'transparent',
          color: 'rgba(255,255,255,0.85)',
          border: 'none',
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
          padding: '0 0.2rem',
        }}
      >
        ×
      </button>
    </div>
  );
}
