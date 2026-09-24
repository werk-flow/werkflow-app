import type { Locator, Page } from '@playwright/test';

export { waitForRouteIntercept as waitForPersonnelSuggestionIntercept } from './network';

/** Holiday and closure labels in the month grid; informational only. */
export function informationalCalendarEvent(page: Page, label: string): Locator {
  return page.locator('[data-calendar-holiday]').filter({ hasText: label }).first();
}

/** Several edits share one label; the first row is a representative attribution check. */
export function firstPersonnelHistoryEvent(page: Page, eventLabel: string): Locator {
  return page.getByRole('listitem').filter({ hasText: eventLabel }).first();
}
