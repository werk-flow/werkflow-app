/**
 * The calendar's z-index scale (P1-24a, decision D11). Sticky axes sit
 * above cells, overlays above axes, side panels above the grid, the drag
 * ghost above the panels it can be dropped on; popovers and dialogs keep
 * the primitives' z-50.
 */
export const CALENDAR_LAYER_CLASS = {
  sticky: 'z-10',
  overlay: 'z-20',
  panel: 'z-30',
  drag: 'z-40',
} as const;
