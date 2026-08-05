/**
 * Screens — the captures taken on this device.
 *
 * This is where someone sees what has been recorded about them, so it is
 * written as their own record rather than as a monitoring feed: plain
 * timestamps, the capture rule stated in the empty state, no framing that
 * implies review.
 *
 * The design's "Capture now" button is not built: the agent has no manual
 * capture path — the worker captures on its own schedule while a timer runs —
 * and a button that cannot do what it says is worse than no button.
 *
 * The lightbox is kept from the shipping build. A 3-up grid of 16:10
 * thumbnails is too small to check what a capture actually contains.
 */

import { useCallback, useEffect, useState } from 'react';
import { Panel, PanelHead, PanelBody, PanelRow } from '../components/Panel';
import { Stage, StageHead } from '../components/Stage';
import { useGridFit } from '../ui/useGridFit';
import { CalendarIcon, CameraIcon, ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from '../icons';

interface Capture {
  filename: string;
  timestampMs: number;
  sizeKb: number;
  projectName: string | null;
  taskName: string | null;
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const fullDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function groupLabel(dayKey: string, index: number): string {
  if (index === 0 && dayKey === new Date().toDateString()) return 'Today';
  const d = new Date(dayKey);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function Tile({ item, onOpen }: { item: Capture; onOpen: (url: string) => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);
    void window.agentBridge.readScreenshot(item.filename).then((res) => {
      if (cancelled) return;
      if (res.ok && res.dataUrl) setDataUrl(res.dataUrl);
      else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [item.filename]);

  return (
    <button className="v2-shot" onClick={() => dataUrl && onOpen(dataUrl)} disabled={!dataUrl}>
      <span className="v2-shot__thumb">
        {dataUrl
          ? <img src={dataUrl} alt="" />
          : <span className="v2-shot__placeholder">{failed ? 'no preview' : 'loading…'}</span>}
        <span className="v2-shot__time">{clock(item.timestampMs)}</span>
      </span>
      <span className="v2-shot__meta">
        <span className="v2-shot__task">{item.taskName ?? 'No task'}</span>
        <span className="v2-shot__project">{item.projectName ?? 'No project'}</span>
      </span>
    </button>
  );
}

export function ScreensScreen() {
  const [items, setItems] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [openUrl, setOpenUrl] = useState<string | null>(null);

  const [gridRef, perPage] = useGridFit<HTMLDivElement>({ cols: 3, aspect: 1.6, metaHeight: 54, gap: 14 });

  useEffect(() => {
    window.agentBridge
      .listScreenshots()
      .then((res) => {
        setLoading(false);
        if (res.ok) setItems(res.data);
        else setError('Could not read the capture folder');
      })
      .catch((e: any) => { setLoading(false); setError(e?.message ?? 'Could not read the capture folder'); });
  }, []);

  // Newest first, grouped by local day — the panel's rows.
  const days: { key: string; items: Capture[] }[] = [];
  [...items]
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .forEach((item) => {
      const key = new Date(item.timestampMs).toDateString();
      const group = days.find((d) => d.key === key);
      if (group) group.items.push(item);
      else days.push({ key, items: [item] });
    });

  const activeDay = days.find((d) => d.key === selectedDay) ?? days[0] ?? null;
  const dayItems = activeDay?.items ?? [];
  const pages = Math.max(1, Math.ceil(dayItems.length / perPage));
  const current = Math.min(page, pages - 1);
  const visible = dayItems.slice(current * perPage, current * perPage + perPage);

  useEffect(() => { setPage(0); }, [selectedDay]);

  const step = useCallback((delta: number) => {
    setOpenIndex((currentIndex) => {
      if (currentIndex == null) return currentIndex;
      const next = currentIndex + delta;
      if (next < 0 || next >= dayItems.length) return currentIndex;
      setOpenUrl(null);
      void window.agentBridge.readScreenshot(dayItems[next].filename).then((res) => {
        if (res.ok && res.dataUrl) setOpenUrl(res.dataUrl);
      });
      return next;
    });
  }, [dayItems]);

  useEffect(() => {
    if (openIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpenIndex(null); setOpenUrl(null); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, step]);

  const isToday = activeDay?.key === new Date().toDateString();

  return (
    <>
      <Panel>
        <PanelHead title="Screens" subtitle="Captured on this device" />
        <PanelBody>
          <div className="v2-panel__list">
            {days.length === 0 && !loading && <p className="v2-empty">Nothing captured yet.</p>}
            {days.map((day, i) => (
              <PanelRow
                key={day.key}
                name={groupLabel(day.key, i)}
                icon={<CalendarIcon size={15} />}
                end={day.items.length}
                selected={activeDay?.key === day.key}
                onClick={() => setSelectedDay(day.key)}
              />
            ))}
          </div>
        </PanelBody>
      </Panel>

      <Stage>
        <StageHead
          title="Screens"
          subtitle={
            dayItems.length > 0
              ? `${dayItems.length} ${dayItems.length === 1 ? 'capture' : 'captures'} ${isToday ? 'today' : 'this day'} · newest first`
              : 'Captured on this device while the timer runs'
          }
        >
          {pages > 1 && (
            <>
              <span className="v2-pager__label">{current + 1} / {pages}</span>
              <button
                className="v2-pager__btn"
                onClick={() => setPage(current - 1)}
                disabled={current === 0}
                aria-label="Previous page"
              >
                <ChevronLeftIcon size={12} />
              </button>
              <button
                className="v2-pager__btn"
                onClick={() => setPage(current + 1)}
                disabled={current >= pages - 1}
                aria-label="Next page"
              >
                <ChevronRightIcon size={12} />
              </button>
            </>
          )}
        </StageHead>

        {loading && <p className="v2-note">Loading…</p>}
        {error && <p className="v2-note">{error}</p>}

        {!loading && !error && items.length === 0 && (
          <div className="v2-blank" style={{ marginTop: 40 }}>
            <span className="v2-blank__tile" aria-hidden="true"><CameraIcon size={20} /></span>
            <h2 className="v2-blank__title" style={{ marginTop: 14, fontSize: 18 }}>No captures yet</h2>
            <p className="v2-blank__body">
              Captures are taken automatically every few minutes while a timer runs, and only on this
              device. Older captures and other devices are in the web app.
            </p>
          </div>
        )}

        <div className="v2-shots" ref={gridRef}>
          {visible.map((item, i) => (
            <Tile
              key={item.filename}
              item={item}
              onOpen={(url) => { setOpenIndex(current * perPage + i); setOpenUrl(url); }}
            />
          ))}
        </div>

        {openIndex != null && dayItems[openIndex] && (
          <div className="v2-lightbox" onClick={() => { setOpenIndex(null); setOpenUrl(null); }}>
            <div className="v2-lightbox__bar">
              <span>
                {dayItems[openIndex].taskName ?? 'No task'} · {dayItems[openIndex].projectName ?? 'No project'}
              </span>
              <span>
                {fullDate(dayItems[openIndex].timestampMs)} {clock(dayItems[openIndex].timestampMs)}
                {dayItems[openIndex].sizeKb ? ` — ${dayItems[openIndex].sizeKb} KB` : ''}
              </span>
              <span className="v2-lightbox__count">{openIndex + 1} / {dayItems.length}</span>
              <button
                className="v2-lightbox__close"
                onClick={(e) => { e.stopPropagation(); setOpenIndex(null); setOpenUrl(null); }}
                aria-label="Close"
              >
                <XMarkIcon size={14} />
              </button>
            </div>

            <button
              className="v2-lightbox__nav v2-lightbox__nav--prev"
              onClick={(e) => { e.stopPropagation(); step(-1); }}
              disabled={openIndex === 0}
              aria-label="Previous capture"
            >
              <ChevronLeftIcon size={18} />
            </button>
            <button
              className="v2-lightbox__nav v2-lightbox__nav--next"
              onClick={(e) => { e.stopPropagation(); step(1); }}
              disabled={openIndex === dayItems.length - 1}
              aria-label="Next capture"
            >
              <ChevronRightIcon size={18} />
            </button>

            {openUrl
              ? <img className="v2-lightbox__img" src={openUrl} alt="" />
              : <div className="v2-lightbox__img v2-lightbox__loading">Loading…</div>}

            <p className="v2-lightbox__hint">← → to browse · Esc or click to close</p>
          </div>
        )}
      </Stage>
    </>
  );
}
