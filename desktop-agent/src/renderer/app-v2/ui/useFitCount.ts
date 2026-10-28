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
 * `itemHeight` is only the assumed height. With `item` (a CSS selector), the
 * first matching element in the pane is measured and its real rendered height
 * wins, so platform font metrics or DPI scaling cannot make the page size
 * disagree with what is on screen. Falls back to `itemHeight` while no such
 * element is rendered.
 *
 * Returns a ref to attach to the pane and the number of items that fit.
 */

import { useEffect, useRef, useState } from 'react';

export function useFitCount<T extends HTMLElement>(
  itemHeight: number,
  { min = 1, max = 40, gap = 0, reserve = 0, item }: {
    min?: number;
    max?: number;
    gap?: number;
    /** Chrome inside the measured pane that is not an item — a table header,
     *  a "N more" footer. Subtracted before the division. */
    reserve?: number;
    /** Selector for a rendered item to measure instead of trusting `itemHeight`. */
    item?: string;
  } = {},
): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [count, setCount] = useState(min);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let observed: Element | null = null;
    const observer = new ResizeObserver(() => measure());

    const measure = () => {
      const first = item ? el.querySelector(item) : null;
      if (first !== observed) {
        if (observed) observer.unobserve(observed);
        if (first) observer.observe(first);
        observed = first;
      }
      const measured = first ? first.getBoundingClientRect().height : 0;
      const itemH = measured > 0 ? measured : itemHeight;
      const h = el.clientHeight - reserve;
      // (n * item) + ((n - 1) * gap) <= h
      const fit = Math.floor((h + gap) / (itemH + gap));
      setCount(Math.max(min, Math.min(max, fit)));
    };

    measure();
    observer.observe(el);
    // Rows are added/removed as pages change; pick up the first item then.
    const mutations = item ? new MutationObserver(measure) : null;
    mutations?.observe(el, { childList: true });
    return () => {
      observer.disconnect();
      mutations?.disconnect();
    };
  }, [itemHeight, min, max, gap, reserve, item]);

  return [ref, count];
}
