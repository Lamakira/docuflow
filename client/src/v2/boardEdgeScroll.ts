import { useEffect, useRef, type RefObject } from "react";

/**
 * Scrolls a board sideways while a card is dragged near one of its edges.
 *
 * The drag library scrolls the board itself only while the dragged card's
 * centre is inside it. A card held by its left side and pushed to the right
 * edge has its centre past the edge, and the board stopped short of Won and
 * Lost. This follows the pointer instead. The board is the library's scroll
 * container, so the library sees each scroll and its drop targets stay right.
 */

/** How far into the edge band the pointer starts scrolling, in px. */
export const EDGE_SCROLL_ZONE = 96;
/** The fastest scroll, at the edge or past it, in px per frame. */
export const EDGE_SCROLL_MAX = 24;

/**
 * Pixels to scroll this frame for a pointer at `x`: negative towards the left,
 * positive towards the right, 0 outside both edge bands. Faster the deeper the
 * pointer is in the band, and at full speed past the edge.
 */
export function edgeScrollStep(
  x: number,
  left: number,
  right: number,
  zone: number = EDGE_SCROLL_ZONE,
  max: number = EDGE_SCROLL_MAX,
): number {
  const band = Math.min(zone, (right - left) / 4);
  if (band <= 0) return 0;
  const depth = (into: number) => Math.min(1, Math.max(0, into / band));
  const rightDepth = depth(x - (right - band));
  if (rightDepth > 0) return Math.max(1, Math.round(max * rightDepth));
  const leftDepth = depth(left + band - x);
  if (leftDepth > 0) return -Math.max(1, Math.round(max * leftDepth));
  return 0;
}

/** Which edges may scroll: each one only once the pointer has been away from it. */
export type EdgeArming = { left: boolean; right: boolean };

/**
 * One frame: the scroll for a pointer at `x`, and the arming it leaves. A card
 * lifted near an edge does not set the board moving; that edge scrolls once
 * the pointer has left its band and come back.
 */
export function armedEdgeScroll(
  arming: EdgeArming,
  x: number,
  left: number,
  right: number,
): { step: number; arming: EdgeArming } {
  const step = edgeScrollStep(x, left, right);
  const next = { left: arming.left || step >= 0, right: arming.right || step <= 0 };
  if (step > 0 && !next.right) return { step: 0, arming: next };
  if (step < 0 && !next.left) return { step: 0, arming: next };
  return { step, arming: next };
}

/** Starts following the pointer over `board`; the returned function stops it. */
export function startBoardEdgeScroll(board: HTMLElement): () => void {
  let pointerX: number | null = null;
  let arming: EdgeArming = { left: false, right: false };
  let frame = 0;

  const onMouse = (event: MouseEvent) => {
    pointerX = event.clientX;
  };
  const onTouch = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch) pointerX = touch.clientX;
  };

  const tick = () => {
    if (pointerX !== null) {
      const rect = board.getBoundingClientRect();
      const next = armedEdgeScroll(arming, pointerX, rect.left, rect.right);
      arming = next.arming;
      if (next.step !== 0) board.scrollLeft += next.step;
    }
    frame = window.requestAnimationFrame(tick);
  };

  window.addEventListener("mousemove", onMouse, { capture: true, passive: true });
  window.addEventListener("touchmove", onTouch, { capture: true, passive: true });
  frame = window.requestAnimationFrame(tick);

  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("mousemove", onMouse, { capture: true });
    window.removeEventListener("touchmove", onTouch, { capture: true });
  };
}

/**
 * A board's drag handlers (the Opportunities and Projects boards). Before the
 * library measures, the board is marked as dragging, which stops its columns
 * scrolling on their own (tokens.css) so the board is the one scroll container
 * the library follows; outside the stacked layout, the edge scroll starts too.
 * `end` undoes both, on every drop or cancel.
 */
export function useBoardDragScroll(boardRef: RefObject<HTMLElement | null>, stacked: boolean) {
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return {
    beforeCapture() {
      const board = boardRef.current;
      if (!board) return;
      board.setAttribute("data-dragging", "true");
      if (!stacked) stop.current = startBoardEdgeScroll(board);
    },
    end() {
      stop.current?.();
      stop.current = null;
      boardRef.current?.setAttribute("data-dragging", "false");
    },
  };
}
