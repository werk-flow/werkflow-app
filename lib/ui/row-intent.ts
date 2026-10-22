import type { PointerEvent } from 'react';

/** Rows warmed since the pointer last arrived on them. */
const warmedRows = new WeakSet<Element>();

export type RowIntentHandlers = {
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onFocus: () => void;
};

/**
 * Warms the destination of a row that navigates on click, on the person's
 * intent (performance.md, "Prefetch"): the first pointer movement inside
 * the row, once per arrival, and keyboard focus. A pointer enter alone is no
 * intent. A row that moved or appeared under a resting pointer, such as the
 * rows below a new job after its create dialog closed, receives an enter
 * without a movement, and its prefetch would compete with the save's route
 * render. Spread the result onto the row.
 */
export function rowIntentPrefetch(warm: () => void): RowIntentHandlers {
  return {
    onPointerMove: (event) => {
      const row = event.currentTarget;
      if (warmedRows.has(row)) return;
      warmedRows.add(row);
      warm();
    },
    onPointerLeave: (event) => {
      warmedRows.delete(event.currentTarget);
    },
    onFocus: warm,
  };
}
