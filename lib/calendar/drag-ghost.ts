/**
 * Pure parts of the calendar drag engine's per-frame step: what the ghost
 * says, how wide it is and where it stays on screen, and which registered
 * drop zone the pointer is over. The engine writes the results to the DOM.
 */

type GhostVerdict = { ok: true; label?: string } | { ok: false; message: string };

/** The ghost's state and message: idle without a target, the refusal or the valid label otherwise. */
export function ghostPaint(
  hasTarget: boolean,
  verdict: GhostVerdict | null,
): { state: 'idle' | 'valid' | 'refused'; text: string } {
  const state = !hasTarget ? 'idle' : verdict?.ok ? 'valid' : 'refused';
  const text = hasTarget && verdict && !verdict.ok ? verdict.message : (verdict?.ok && verdict.label) || '';
  return { state, text };
}

/** A message widens the ghost to a readable width, never beyond the viewport's 8-pixel margins. */
export function ghostWidth(sourceWidth: number, hasText: boolean, viewportWidth: number): number {
  return Math.min(viewportWidth - 16, Math.max(sourceWidth, hasText ? 224 : 0));
}

/**
 * The ghost's on-screen corner: the pointer position kept 8 pixels inside the
 * viewport, so a tall refusal stays readable. Only the paint moves; the drop
 * still resolves at the pointer.
 */
export function visibleGhostOrigin(
  origin: { x: number; y: number },
  ghost: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(origin.x, viewport.width - ghost.width - 8)),
    y: Math.max(8, Math.min(origin.y, viewport.height - ghost.height - 8)),
  };
}

/** The first zone whose rectangle contains the point, edges included. */
export function zoneAtPoint<
  Zone extends { rect: { left: number; right: number; top: number; bottom: number } },
>(zones: readonly Zone[], point: { x: number; y: number }): Zone | undefined {
  return zones.find(
    (entry) =>
      point.x >= entry.rect.left &&
      point.x <= entry.rect.right &&
      point.y >= entry.rect.top &&
      point.y <= entry.rect.bottom,
  );
}
