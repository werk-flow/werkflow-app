import { expect, type Page } from '@playwright/test';

export async function expectCalendarVacationEventOnDate(
  page: Page,
  dateIso: string,
  title: string,
  status: 'pending' | 'approved'
): Promise<void> {
  // FullCalendar has no role-based relationship between a date cell and its
  // events, so this helper keeps its markup-specific lookup out of the spec.
  const dayCell = page.locator(`.fc-daygrid-day[data-date="${dateIso}"]`);
  const eventClass = `.fc-vacation-${status}`;
  await expect(dayCell.locator(eventClass)).toHaveCount(1, { timeout: 15_000 });

  const moreLink = dayCell.locator('.fc-daygrid-more-link');
  let eventScope = dayCell;
  if (await moreLink.isVisible()) {
    await moreLink.click();
    const popover = page.locator('.fc-popover');
    await expect(popover).toBeVisible({ timeout: 15_000 });
    await expect(popover.locator(eventClass)).toHaveCount(1);
    eventScope = popover;
  }

  // FullCalendar exposes the complete, non-truncated event name as `title`;
  // the painted text itself can be ellipsized before the person's full name.
  // The event wrapper has a zero-size box in month layout, so DOM identity is
  // the stable assertion while the screenshot-visible child carries the title.
  expect(await eventScope.getByTitle(title).count()).toBeGreaterThan(0);
}
