import React, { useEffect, useRef, useState } from 'react';

interface ScreenshotMeta {
  filename: string;
  timestampMs: number;
  sizeKb: number;
  projectName: string | null;
  taskName: string | null;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function ScreenshotCard({ meta }: { meta: ScreenshotMeta }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !dataUrl && !loading) {
          setLoading(true);
          window.agentBridge.readScreenshot(meta.filename).then((res) => {
            setLoading(false);
            if (res.ok && res.dataUrl) setDataUrl(res.dataUrl);
          });
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [meta.filename, dataUrl, loading]);

  return (
    <>
      <div
        ref={ref}
        onClick={() => dataUrl && setExpanded(true)}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          cursor: dataUrl ? 'zoom-in' : 'default',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Thumbnail */}
        <div
          style={{
            height: 120,
            background: 'var(--surface2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {loading && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>Loading…</span>
          )}
          {!loading && !dataUrl && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>No preview</span>
          )}
          {dataUrl && (
            <img
              src={dataUrl}
              alt={meta.filename}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </div>

        {/* Meta */}
        <div style={{ padding: '0.5rem 0.65rem', display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
          {meta.projectName && (
            <span
              title={meta.taskName ? `${meta.projectName} — ${meta.taskName}` : meta.projectName}
              style={{
                color: 'var(--accent)',
                fontSize: 10,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {meta.taskName ? `${meta.projectName} / ${meta.taskName}` : meta.projectName}
            </span>
          )}
          <span style={{ color: 'var(--text)', fontSize: 11, fontWeight: 600 }}>
            {formatDate(meta.timestampMs)}
          </span>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
              {formatTime(meta.timestampMs)}
            </span>
            <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
              {meta.sizeKb} KB
            </span>
          </div>
        </div>
      </div>

      {/* Full-size lightbox */}
      {expanded && dataUrl && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <img
            src={dataUrl}
            alt={meta.filename}
            style={{
              maxWidth: '95vw',
              maxHeight: '90vh',
              borderRadius: 'var(--radius)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 16,
              color: 'rgba(255,255,255,0.6)',
              fontSize: 10,
              textAlign: 'right',
            }}
          >
            {meta.projectName && (
              <span style={{ color: 'rgba(99,102,241,0.9)', marginRight: 6 }}>
                {meta.taskName ? `${meta.projectName} / ${meta.taskName}` : meta.projectName}
              </span>
            )}
            {formatDate(meta.timestampMs)} {formatTime(meta.timestampMs)} — {meta.sizeKb} KB — click to close
          </div>
        </div>
      )}
    </>
  );
}

export function ScreenshotsPage() {
  const [items, setItems] = useState<ScreenshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    window.agentBridge.listScreenshots().then((res) => {
      setLoading(false);
      if (res.ok) {
        setItems(res.data);
      } else {
        setError('Failed to load screenshots');
      }
    }).catch((e: any) => {
      setLoading(false);
      setError(e?.message ?? 'Unknown error');
    });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-title" style={{ flexShrink: 0 }}>Screenshots</div>

      {loading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: '1rem', textAlign: 'center' }}>
          Loading…
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--red)', fontSize: 13, marginTop: '1rem', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            color: 'var(--text-dim)',
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: 0.35 }}
          >
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-muted)' }}>No screenshots yet</div>
          <div style={{ fontSize: 12, maxWidth: 280, textAlign: 'center', lineHeight: 1.5, color: 'var(--text-dim)' }}>
            Screenshots are captured automatically every 3–5 minutes while the timer is running.
            They appear here only after being captured on <strong>this device</strong> — older captures
            and those from other devices are available in the web app.
          </div>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            marginTop: '0.75rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '0.75rem',
            alignContent: 'start',
            paddingBottom: '1rem',
          }}
        >
          {items.map((item) => (
            <ScreenshotCard key={item.filename} meta={item} />
          ))}
        </div>
      )}
    </div>
  );
}
