import { snapMinutes } from './drag-math';

/**
 * Pure geometry of the day view's drag surface: the minute under the pointer
 * on the hour axis, and the span an edge drag leaves behind.
 */

/**
 * The minute of the day at a horizontal position: the position plus the
 * scroll since the map was measured, relative to the timeline's left edge,
 * snapped to 15 minutes (5 with the fine modifier) and kept inside the day.
 */
export function dayMinutesAtPoint({
  x,
  scrollDelta,
  timelineLeft,
  hourWidth,
  fine,
}: {
  x: number;
  scrollDelta: number;
  timelineLeft: number;
  hourWidth: number;
  fine: boolean;
}): number {
  const rawMinutes = ((x + scrollDelta - timelineLeft) / hourWidth) * 60;
  const minutes = snapMinutes(rawMinutes, fine ? 5 : 15);
  return Math.max(0, Math.min(24 * 60, minutes));
}

/**
 * The span after dragging one edge to `edgeAt`: the dragged edge follows the
 * pointer but never closes the span below `minimumLength`; the other edge
 * stays. Works in any unit, minutes or milliseconds.
 */
export function edgeResizedSpan({
  start,
  end,
  edge,
  edgeAt,
  minimumLength,
}: {
  start: number;
  end: number;
  edge: 'start' | 'end';
  edgeAt: number;
  minimumLength: number;
}): { start: number; end: number } {
  return {
    start: edge === 'start' ? Math.min(edgeAt, end - minimumLength) : start,
    end: edge === 'end' ? Math.max(edgeAt, start + minimumLength) : end,
  };
}
