import { ROUTE_REFRESH_ATTRIBUTE } from '../../ui/route-refresh-signal';
import { UNCONFIRMED_ATTRIBUTE, UNCONFIRMED_LAYER_ATTRIBUTE } from '../../ui/unconfirmed';

/**
 * The app's busy signals, the one list the browser settle step waits on
 * (`settled` in tests/golden/support/steps/interaction.ts, which the visual
 * settle reuses). Each one is set by a registry primitive or a shared hook,
 * never by an animation class:
 * - `aria-busy="true"`: a busy region or `Button pending`;
 * - `data-pending="true"`: a dialog that refuses dismissal while it saves;
 * - `data-slot="skeleton"`: `Skeleton`, every loading placeholder;
 * - `data-slot="spinner"`: `Spinner`, every running-action indicator;
 * - `data-unconfirmed`: a row, card or surface that shows an optimistic
 *   layer's content (lib/ui/unconfirmed.ts).
 */
export const BUSY_SIGNAL_SELECTOR = `[aria-busy="true"], [data-pending="true"], [data-slot="skeleton"], [data-slot="spinner"], [${UNCONFIRMED_ATTRIBUTE}]`;

/** Set on `<html>` while a route refresh is queued or in flight (lib/ui/route-refresh-signal.ts). */
export const ROUTE_REFRESH_SIGNAL = ROUTE_REFRESH_ATTRIBUTE;

/** Set on `<html>` while an optimistic list holds an entry, a removal included (lib/ui/unconfirmed.ts). */
export const UNCONFIRMED_LAYER_SIGNAL = UNCONFIRMED_LAYER_ATTRIBUTE;

/** The marker of one unconfirmed row, card or surface; `confirmed` in steps/shared.ts excludes it. */
export const UNCONFIRMED_SIGNAL = UNCONFIRMED_ATTRIBUTE;

/** The calendar's readiness kinds that are final; any other kind is still loading. */
export const SETTLED_CALENDAR_STATES: readonly string[] = ['ready', 'unavailable'];
