import type { Locator, Page } from '@playwright/test';
import { calendarHolidayLabel } from '../../golden/support/plantafel';

/** Holiday and closure labels in the month grid; informational only. */
export function informationalCalendarEvent(page: Page, label: string): Locator {
  return calendarHolidayLabel(page, label).first();
}

/** Several edits share one label; the first row is a representative attribution check. */
export function firstPersonnelHistoryEvent(page: Page, eventLabel: string): Locator {
  return page.getByRole('listitem').filter({ hasText: eventLabel }).first();
}

/** The time overview's „Überstunden heute“ figure. */
export function todayOvertime(page: Page): Locator {
  return page.getByRole('main').getByTestId('today-overtime').filter({ visible: true }).first();
}

/** The overtime figure when no overtime was worked today. */
export const ZERO_OVERTIME_TODAY = /Überstunden heute\s*0 Min\.\s*$/;
