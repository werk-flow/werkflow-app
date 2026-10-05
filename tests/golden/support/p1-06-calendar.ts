import { expect, type Page } from '@playwright/test';
import { calendarAbsenceBars } from './plantafel';

/**
 * A vacation bar on the month grid for the request that starts on `dateIso`.
 * Bars span their whole range in one element, so the start date identifies
 * the request and the bar's title carries the person and the state.
 */
export async function expectCalendarVacationEventOnDate(
  page: Page,
  dateIso: string,
  title: string,
  status: 'pending' | 'approved',
): Promise<void> {
  const bar = calendarAbsenceBars(page.getByRole('main'), status, dateIso).filter({ hasText: title });
  await expect(bar).toHaveCount(1, { timeout: 15_000 });
  await expect(bar).toBeVisible();
}
