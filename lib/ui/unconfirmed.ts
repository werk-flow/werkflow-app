/**
 * The one marker for content that comes from an optimistic layer rather than
 * from an authoritative read (realtime-and-caching.md, "Checklist"). A row,
 * card or surface that shows such content carries `data-unconfirmed` and
 * `aria-busy="true"` for as long as that is true: assistive technology hears
 * that it is still being updated, and the browser settle step and the
 * confirmed-outcome locators read the same attribute
 * (lib/testing/spec-support/busy-signals.ts, `confirmed` in
 * tests/golden/support/steps/shared.ts). The registry primitives set it from
 * their `unconfirmed` prop, so no call site writes the attributes by hand.
 */
export const UNCONFIRMED_ATTRIBUTE = 'data-unconfirmed';

export type UnconfirmedMarker = { 'data-unconfirmed'?: ''; 'aria-busy'?: true };

const NO_MARKER: UnconfirmedMarker = {};
const MARKER: UnconfirmedMarker = { 'data-unconfirmed': '', 'aria-busy': true };

/** The attributes a primitive spreads after its own props, so the marker wins while it applies. */
export function unconfirmedMarker(unconfirmed: boolean | undefined): UnconfirmedMarker {
  return unconfirmed ? MARKER : NO_MARKER;
}

/** Set on `<html>` while an optimistic layer holds an entry. */
export const UNCONFIRMED_LAYER_ATTRIBUTE = 'data-unconfirmed-layer';

const holders = new Set<symbol>();

/**
 * Marks `<html data-unconfirmed-layer>` while any optimistic layer holds an entry,
 * so an optimistic removal, which leaves no row to mark, is still visible to
 * the settle step. Written outside React, so marking costs no render.
 */
export function markUnconfirmedLayer(holder: symbol, unconfirmed: boolean): void {
  if (unconfirmed) holders.add(holder);
  else holders.delete(holder);
  if (typeof document === 'undefined') return;
  if (holders.size > 0) document.documentElement.setAttribute(UNCONFIRMED_LAYER_ATTRIBUTE, '');
  else document.documentElement.removeAttribute(UNCONFIRMED_LAYER_ATTRIBUTE);
}
