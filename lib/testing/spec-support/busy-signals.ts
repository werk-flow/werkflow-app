import { ROUTE_REFRESH_ATTRIBUTE } from '../../ui/route-refresh-signal';

/**
 * The app's busy signals, the one list the browser settle step waits on
 * (`settled` in tests/golden/support/steps/interaction.ts, which the visual
 * settle reuses). Each one is set by a registry primitive or a shared hook,
 * never by an animation class:
 * - `aria-busy="true"`: a busy region or `Button pending`;
 * - `data-pending="true"`: a dialog that refuses dismissal while it saves;
 * - `data-slot="skeleton"`: `Skeleton`, every loading placeholder;
 * - `data-slot="spinner"`: `Spinner`, every running-action indicator.
 */
export const BUSY_SIGNAL_SELECTOR =
  '[aria-busy="true"], [data-pending="true"], [data-slot="skeleton"], [data-slot="spinner"]';

/** Set on `<html>` while a route refresh is queued or in flight (lib/ui/route-refresh-signal.ts). */
export const ROUTE_REFRESH_SIGNAL = ROUTE_REFRESH_ATTRIBUTE;

/** The calendar's readiness kinds that are final; any other kind is still loading. */
export const SETTLED_CALENDAR_STATES: readonly string[] = ['ready', 'unavailable'];
