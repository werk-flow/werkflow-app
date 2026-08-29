import type { Locator, Page } from '@playwright/test';

/** FullCalendar exposes holiday facts only through this class and may retain a duplicate event node. */
export function informationalCalendarEvent(page: Page, label: string): Locator {
  return page.locator('.fc-holiday-context').filter({ hasText: label }).first();
}

/** Several edits share one label; the first row is a representative attribution check. */
export function firstPersonnelHistoryEvent(page: Page, eventLabel: string): Locator {
  return page.getByRole('listitem').filter({ hasText: eventLabel }).first();
}

/**
 * Bounds the route-interception gate without coupling the spec to a fixed
 * browser sleep. The outer caller keeps the user-facing interception error.
 */
export async function waitForPersonnelSuggestionIntercept(
  intercepted: Promise<void>
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      intercepted,
      new Promise<void>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Route handler did not observe the request.'));
        }, 15_000);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
