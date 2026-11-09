import { expect, test, type Page } from '@playwright/test';
import type { PlannedVisitsAnswer } from './correction-timeline-boundaries';
import { openContractFixture } from './open-fixture';

// A forgotten day's timeline starts from the planned visits of its person and
// day. While the visits of a newly chosen person load, the rows of the
// previous person never stand for the new one: nothing a save would send.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'correction-timeline');
});

async function answerPlannedVisits(page: Page, answer: PlannedVisitsAnswer): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.uiContractPlannedVisits.answers.length))
    .toBeGreaterThan(0);
  await page.evaluate((value) => {
    const resolve = window.uiContractPlannedVisits.answers.shift();
    if (!resolve) throw new Error('No planned-visit read is held open.');
    resolve(value);
  }, answer);
}

const visitOfPersonA: PlannedVisitsAnswer = {
  success: true,
  visits: [
    {
      jobId: '00000000-0000-4000-8000-000000000153',
      startAt: '2026-10-26T06:00:00.000Z',
      endAt: '2026-10-26T14:30:00.000Z',
    },
  ],
};

test('the planned visit prefills the timeline, and another person never inherits it while their visits load', async ({
  page,
}) => {
  const timeline = page.getByRole('region', { name: 'Ablauf des Tages' });
  const check = page.getByRole('button', { name: 'Prüfen', exact: true });
  const result = page.getByRole('status', { name: 'Prüfergebnis' });
  await answerPlannedVisits(page, visitOfPersonA);
  await expect(timeline).toHaveAttribute('aria-busy', 'false');
  await expect(timeline.getByText('Tätigkeit 1')).toBeVisible();
  await check.click();
  await expect(result).toHaveText('1 Tätigkeiten');

  await page.getByRole('button', { name: 'Andere Person', exact: true }).click();
  await expect(timeline).toHaveAttribute('aria-busy', 'true');
  await check.click();
  await expect(result).toHaveText('unvollständig');

  await answerPlannedVisits(page, { success: false, error: 'load_failed' });
  await expect(timeline).toHaveAttribute('aria-busy', 'false');
  await expect(timeline.getByText('Die geplanten Einsätze konnten nicht geladen werden.')).toBeVisible();
  await check.click();
  await expect(result).toHaveText('unvollständig');
  expect(await page.evaluate(() => window.uiContractPlannedVisits.calls)).toEqual([
    {
      organizationId: 'contract-organization',
      localDate: '2026-10-26',
      employeeRecordId: 'contract-person-a',
    },
    {
      organizationId: 'contract-organization',
      localDate: '2026-10-26',
      employeeRecordId: 'contract-person-b',
    },
  ]);
});
