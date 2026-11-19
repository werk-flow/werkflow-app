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
export const BUSY_SIGNALS = [
  { name: 'aria-busy', selector: '[aria-busy="true"]' },
  { name: 'pending dialog', selector: '[data-pending="true"]' },
  { name: 'skeleton', selector: '[data-slot="skeleton"]' },
  { name: 'spinner', selector: '[data-slot="spinner"]' },
  { name: 'unconfirmed', selector: `[${UNCONFIRMED_ATTRIBUTE}]` },
] as const;

export const BUSY_SIGNAL_SELECTOR = BUSY_SIGNALS.map((signal) => signal.selector).join(', ');

/** What the settle step reads from one busy element in the page. */
export type BusyElementFacts = {
  tag: string;
  role: string;
  /** The `BUSY_SIGNALS` names the element matches. */
  signals: string[];
  /** Its aria-label, test id or leading text; empty for a bare placeholder. */
  name: string;
  /** The nearest ancestor with an accessible name or a landmark; empty when none. */
  region: string;
};

function describeBusyElement(facts: BusyElementFacts): string {
  const role = facts.role === '' ? '' : ` role="${facts.role}"`;
  const name = facts.name === '' ? '' : ` "${facts.name}"`;
  const region = facts.region === '' ? '' : ` in ${facts.region}`;
  return `${facts.signals.join(' + ')} <${facts.tag}${role}>${name}${region}`;
}

/**
 * Describes the busy elements a failed settle reports: each names the signal
 * it matched and the region it sits in, and identical ones collapse into one
 * line with their count, so a page of bare skeletons still says which signal
 * and which region held the step.
 */
export function describeBusyElements(elements: readonly BusyElementFacts[]): string[] {
  const counts = new Map<string, number>();
  for (const element of elements) {
    const description = describeBusyElement(element);
    counts.set(description, (counts.get(description) ?? 0) + 1);
  }
  return [...counts].map(([description, count]) => (count === 1 ? description : `${count}× ${description}`));
}

/** Set on `<html>` while a route refresh is queued or in flight (lib/ui/route-refresh-signal.ts). */
export const ROUTE_REFRESH_SIGNAL = ROUTE_REFRESH_ATTRIBUTE;

/** Set on `<html>` while an optimistic list holds an entry, a removal included (lib/ui/unconfirmed.ts). */
export const UNCONFIRMED_LAYER_SIGNAL = UNCONFIRMED_LAYER_ATTRIBUTE;

/** The marker of one unconfirmed row, card or surface; `confirmed` in steps/shared.ts excludes it. */
export const UNCONFIRMED_SIGNAL = UNCONFIRMED_ATTRIBUTE;

/** The calendar's readiness kinds that are final; any other kind is still loading. */
export const SETTLED_CALENDAR_STATES: readonly string[] = ['ready', 'unavailable'];
