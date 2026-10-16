/** The segment of a segmented field (date, time) under a click, read from its `data-segment`. */
export function clickedSegment<Segment extends string>(
  target: EventTarget,
  segments: readonly Segment[],
): Segment | undefined {
  const name =
    target instanceof Element ? target.closest<HTMLElement>('[data-segment]')?.dataset.segment : undefined;
  return segments.find((segment) => segment === name);
}
