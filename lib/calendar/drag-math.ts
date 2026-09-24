/**
 * Pure geometry for the calendar drag engine (P1-24a). The engine keeps no
 * React state during a drag; these helpers turn pointer positions into
 * slots against maps the views compute once at drag start.
 */

/**
 * Index of the interval that contains `position` in a sorted list of
 * interval starts (`starts[i]` to `starts[i + 1]`), or null outside.
 */
export function indexAtOffset(starts: readonly number[], position: number): number | null {
  if (starts.length < 2 || position < (starts[0] ?? 0) || position >= (starts[starts.length - 1] ?? 0)) return null;
  let low = 0;
  let high = starts.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Cumulative starts for equal-width tracks, one entry more than the count. */
export function uniformTrackStarts(count: number, size: number, origin = 0): number[] {
  const starts: number[] = [];
  for (let index = 0; index <= count; index += 1) starts.push(origin + index * size);
  return starts;
}

/** Cumulative starts from measured track sizes, one entry more than the count. */
export function measuredTrackStarts(sizes: readonly number[], origin = 0): number[] {
  const starts = [origin];
  let position = origin;
  for (const size of sizes) {
    position += size;
    starts.push(position);
  }
  return starts;
}

/** Snap minutes of the day to a step (15 by default, 5 with the fine modifier). */
export function snapMinutes(minutes: number, step: number): number {
  const snapped = Math.round(minutes / step) * step;
  return Math.max(0, Math.min(24 * 60, snapped));
}

const DRAG_THRESHOLD_PX = 5;
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_PX_PER_FRAME = 24;

/**
 * Scroll velocity for a pointer inside a scroll container: negative near
 * the start edge, positive near the end edge, zero elsewhere, growing
 * linearly toward the edge.
 */
export function autoScrollVelocity(position: number, start: number, end: number): number {
  if (end - start <= AUTO_SCROLL_EDGE_PX * 2) return 0;
  if (position < start + AUTO_SCROLL_EDGE_PX) {
    const depth = Math.min(1, Math.max(0, (start + AUTO_SCROLL_EDGE_PX - position) / AUTO_SCROLL_EDGE_PX));
    return -Math.round(depth * AUTO_SCROLL_MAX_PX_PER_FRAME);
  }
  if (position > end - AUTO_SCROLL_EDGE_PX) {
    const depth = Math.min(1, Math.max(0, (position - (end - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX));
    return Math.round(depth * AUTO_SCROLL_MAX_PX_PER_FRAME);
  }
  return 0;
}

/** True once the pointer left the threshold circle around its start. */
export function exceedsDragThreshold(start: { x: number; y: number }, current: { x: number; y: number }): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
}

/** Minutes of the day for a pixel offset on an hour axis. */
export function pixelsToMinutes(pixels: number, hourWidth: number): number {
  return Math.max(0, Math.min(24 * 60, (pixels / hourWidth) * 60));
}

export function minutesToPixels(minutes: number, hourWidth: number): number {
  return (minutes / 60) * hourWidth;
}

export function formatMinutesOfDay(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  return `${String(hours).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}
