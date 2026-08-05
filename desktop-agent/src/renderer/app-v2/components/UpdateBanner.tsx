/**
 * Thin strip announcing a newer installer. Checks once on mount; stays silent
 * when offline or unreachable. The installer can't self-apply without
 * elevation, so "Download" opens it in the browser.
 */

import { useEffect, useState } from 'react';
import { XMarkIcon } from '../icons';

export function UpdateBanner() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.agentBridge
      .checkUpdate()
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.updateAvailable && res.latestVersion && res.downloadUrl) {
          setLatestVersion(res.latestVersion);
          setDownloadUrl(res.downloadUrl);
        }
      })
      .catch(() => { /* offline — stay silent */ });
    return () => { cancelled = true; };
  }, []);

  if (dismissed || !latestVersion || !downloadUrl) return null;

  return (
    <div className="v2-update">
      <span className="v2-update__text">Update available — version {latestVersion}.</span>
      <button className="v2-update__cta" onClick={() => window.agentBridge.openExternal(downloadUrl)}>
        Download
      </button>
      <button className="v2-update__close" onClick={() => setDismissed(true)} aria-label="Dismiss">
        <XMarkIcon size={12} />
      </button>
    </div>
  );
}
