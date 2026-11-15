import type { Locator, Page } from '@playwright/test';
import {
  BUSY_SIGNAL_SELECTOR,
  BUSY_SIGNALS,
  type BusyElementFacts,
  describeBusyElements,
  ROUTE_REFRESH_SIGNAL,
  SETTLED_CALENDAR_STATES,
  UNCONFIRMED_LAYER_SIGNAL,
} from '../../../lib/testing/spec-support/busy-signals';

/** What a settle step reads: a whole page, or a region of it. */
export type Scope = Page | Locator;

export function isPage(scope: Scope): scope is Page {
  return 'goto' in scope;
}

/**
 * Describes the busy elements inside a scope, the scope itself included, and
 * the page-wide busy markers; empty when settled. `settled` in
 * steps/interaction.ts polls it, and its failure prints these lines.
 */
export async function busyElements(scope: Scope): Promise<string[]> {
  const root = isPage(scope) ? scope.locator('body') : scope;
  const { markers, elements } = await root.evaluateAll(
    (roots, { selector, signals, routeRefresh, unconfirmedLayer, settledCalendarStates }) => {
      const LANDMARKS = new Set(['main', 'nav', 'aside', 'header', 'footer', 'dialog', 'form']);
      const nameOf = (element: Element): string =>
        element.getAttribute('aria-label') ??
        element.getAttribute('data-testid') ??
        element.textContent?.trim().slice(0, 60) ??
        '';
      const labelledBy = (element: Element): string =>
        (element.getAttribute('aria-labelledby') ?? '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter((text) => text !== '')
          .join(' ')
          .slice(0, 60);
      // The nearest ancestor a reader can name: one with an accessible name, else a landmark.
      const regionOf = (element: Element): string => {
        for (let ancestor = element.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
          const kind = ancestor.getAttribute('role') ?? ancestor.tagName.toLowerCase();
          const label = ancestor.getAttribute('aria-label') ?? labelledBy(ancestor);
          if (label !== '') return `${kind} "${label}"`;
          if (LANDMARKS.has(kind)) return kind;
        }
        return '';
      };
      // A scan of a scope reads the scope root as well as its descendants.
      const matchesIn = (scopeRoot: Element, query: string): Element[] =>
        [scopeRoot, ...scopeRoot.querySelectorAll(query)].filter((element) => element.matches(query));
      const markers: string[] = [];
      const elements: BusyElementFacts[] = [];
      if (document.documentElement.hasAttribute(routeRefresh))
        markers.push('route refresh queued or running');
      if (document.documentElement.hasAttribute(unconfirmedLayer))
        markers.push('an optimistic list holds an unconfirmed entry');
      for (const scopeRoot of roots) {
        for (const candidate of matchesIn(scopeRoot, selector)) {
          const box = candidate.getBoundingClientRect();
          // A hidden responsive copy is not what the user waits on.
          if (box.width === 0 && box.height === 0) continue;
          elements.push({
            tag: candidate.tagName.toLowerCase(),
            role: candidate.getAttribute('role') ?? '',
            signals: signals
              .filter((signal) => candidate.matches(signal.selector))
              .map((signal) => signal.name),
            name: nameOf(candidate),
            region: regionOf(candidate),
          });
        }
        for (const calendar of matchesIn(scopeRoot, '[data-calendar-state]')) {
          const state = calendar.getAttribute('data-calendar-state') ?? '';
          if (!settledCalendarStates.includes(state)) markers.push(`calendar in state ${state}`);
        }
      }
      return { markers, elements };
    },
    {
      selector: BUSY_SIGNAL_SELECTOR,
      signals: BUSY_SIGNALS.map((signal) => ({ name: signal.name, selector: signal.selector })),
      routeRefresh: ROUTE_REFRESH_SIGNAL,
      unconfirmedLayer: UNCONFIRMED_LAYER_SIGNAL,
      settledCalendarStates: [...SETTLED_CALENDAR_STATES],
    },
  );
  return [...markers, ...describeBusyElements(elements)];
}
