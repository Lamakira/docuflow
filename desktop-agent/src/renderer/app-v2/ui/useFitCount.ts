/**
 * How many fixed-height items fit in a pane, measured rather than assumed.
 *
 * The design pages every list (7 project rows, 6 captures, 4 activity rows) so
 * that no pane ever scrolls. Those counts are correct at the design's 1020×660,
 * but the window is resizable and the panel also gives space to an active-task
 * card or an open create form. Hard-coding the numbers means clipping at any
 * other height; measuring the container means the page size follows whatever
 * space is actually left.
 *
 * Returns a ref to attach to the pane and the number of items that fit.
 */

import { useEffect, useRef, useState } from 'react';

export function useFitCount<T extends HTMLElement>(
  itemHeight: number,
  { min = 1, max = 40, gap = 0, reserve = 0 }: {
    min?: number;
    max?: number;
    gap?: number;
    /** Chrome inside the measured pane that is not an item — a table header,
     *  a "N more" footer. Subtracted before the division. */
    reserve?: number;
  } = {},
): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [count, setCount] = useState(min);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const h = el.clientHeight - reserve;
      // (n * item) + ((n - 1) * gap) <= h
      const fit = Math.floor((h + gap) / (itemHeight + gap));
      setCount(Math.max(min, Math.min(max, fit)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [itemHeight, min, max, gap, reserve]);

  return [ref, count];
}
