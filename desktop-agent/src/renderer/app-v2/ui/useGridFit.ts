/**
 * How many cards fit in the capture grid.
 *
 * Card height is not a constant: the thumbnails are 16:10, so it follows the
 * column width, which follows the window width. Both dimensions are measured
 * together and the page size is recomputed on resize — the grid pages instead
 * of spilling past the bottom of the stage.
 */

import { useEffect, useRef, useState } from 'react';

export function useGridFit<T extends HTMLElement>({
  cols,
  aspect,
  metaHeight,
  gap,
}: { cols: number; aspect: number; metaHeight: number; gap: number }): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [perPage, setPerPage] = useState(cols);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const colWidth = (w - gap * (cols - 1)) / cols;
      const cardHeight = colWidth / aspect + metaHeight;
      const rows = Math.floor((h + gap) / (cardHeight + gap));
      setPerPage(Math.max(cols, rows * cols));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cols, aspect, metaHeight, gap]);

  return [ref, perPage];
}
