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
  // Person A's visit, 07:00 to 15:30 Berlin, stands in the first row.
  const from = timeline.getByRole('group', { name: 'Von' });
  const to = timeline.getByRole('group', { name: 'Bis' });
  await expect(from).toHaveText(/^\s*07\s*:\s*00\s*$/);
  await expect(to).toHaveText(/^\s*15\s*:\s*30\s*$/);
  // The host offers no job names, so the selected job shows its id.
  const job = timeline.getByRole('combobox', { name: 'Auftrag der Tätigkeit 1' });
  await expect(job).toContainText('000000000153');
  await check.click();
  await expect(result).toHaveText('1 Tätigkeiten');

  await page.getByRole('button', { name: 'Andere Person', exact: true }).click();
  await expect(timeline).toHaveAttribute('aria-busy', 'true');
  // The read shows at the timeline, not only to assistive tech.
  const loading = timeline.getByText('Geplante Einsätze werden geladen …');
  await expect(loading).toBeVisible();
  // Person B never sees person A's job or times while B's visits load.
  await expect(from).not.toContainText('07');
  await expect(to).not.toContainText('15');
  await expect(job).not.toContainText('000000000153');
  await check.click();
  await expect(result).toHaveText('unvollständig');

  await answerPlannedVisits(page, { success: false, error: 'load_failed' });
  await expect(timeline).toHaveAttribute('aria-busy', 'false');
  await expect(loading).toHaveCount(0);
  // Nor after B's read failed.
  await expect(from).not.toContainText('07');
  await expect(to).not.toContainText('15');
  await expect(job).not.toContainText('000000000153');
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

test("an edited timeline keeps its edits for another person but drops the previous person's untouched visits", async ({
  page,
}) => {
  const timeline = page.getByRole('region', { name: 'Ablauf des Tages' });
  await answerPlannedVisits(page, {
    success: true,
    visits: [
      {
        jobId: '00000000-0000-4000-8000-000000000153',
        startAt: '2026-10-26T06:00:00.000Z',
        endAt: '2026-10-26T10:00:00.000Z',
      },
      {
        jobId: '00000000-0000-4000-8000-000000000154',
        startAt: '2026-10-26T11:00:00.000Z',
        endAt: '2026-10-26T14:30:00.000Z',
      },
    ],
  });
  await expect(timeline.getByText('Tätigkeit 2')).toBeVisible();
  // Splitting the first visit around a break edits it; the second stays as prefilled.
  await timeline
    .getByRole('listitem')
    .filter({ hasText: 'Tätigkeit 1' })
    .getByRole('button', { name: 'Pause einfügen' })
    .click();
  await expect(timeline.getByText('Tätigkeit 4')).toBeVisible();

  await page.getByRole('button', { name: 'Andere Person', exact: true }).click();

  // The edited visit and its break stay; person A's untouched second visit leaves.
  await expect(timeline.getByText('Tätigkeit 3')).toBeVisible();
  await expect(timeline.getByText('Tätigkeit 4')).toHaveCount(0);
  await expect(timeline).not.toContainText('000000000154');
  await expect(timeline).toContainText('000000000153');
});
