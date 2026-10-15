/** The horizontal extent of a box, as `getBoundingClientRect` reports it. */
export type InlineExtent = { left: number; right: number };

/**
 * How far a sideways scrolling strip must scroll so that the target lies inside
 * its view: negative scrolls back, positive scrolls on, zero when the target is
 * already visible. A target wider than the view keeps its start visible.
 */
export function inlineScrollDelta(view: InlineExtent, target: InlineExtent): number {
  if (target.left < view.left) return target.left - view.left;
  if (target.right <= view.right) return 0;
  return Math.min(target.right - view.right, target.left - view.left);
}
