import type { Locator, Page } from '@playwright/test';

export { waitForRouteIntercept as waitForPersonnelSuggestionIntercept } from './network';

/** FullCalendar exposes holiday facts only through this class and may retain a duplicate event node. */
export function informationalCalendarEvent(page: Page, label: string): Locator {
  return page.locator('.fc-holiday-context').filter({ hasText: label }).first();
}

/** Several edits share one label; the first row is a representative attribution check. */
export function firstPersonnelHistoryEvent(page: Page, eventLabel: string): Locator {
  return page.getByRole('listitem').filter({ hasText: eventLabel }).first();
}
