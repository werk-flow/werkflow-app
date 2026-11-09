import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { getProblemReportByNumber } from '../../golden/support/db/problem-reports';
import {
  openOwnReportsFromReceipt,
  openProblemReport,
  ownReport,
  redactScreenshotMiddle,
  sendProblemReport,
} from '../../golden/support/steps/problem-reports';
import type { TestRole, TestWorld } from '../../golden/support/world';

// Reporting a problem (docs/features/problem-reports.md, E6-F01 and E6-F02):
// from a page, with a redrawn and redacted screenshot, to the receipt and the
// report in „Meine Meldungen“. The boundary fixture
// (lib/testing/fixtures/problem-report-boundaries.ts) proves that no one else
// lists or extends it.

async function reportFrom(
  page: Page,
  world: TestWorld,
  role: TestRole,
  { path, description }: { path: string; description: string },
): Promise<void> {
  await test.step(`${role} reports a problem from ${path}`, async () => {
    await page.goto(path);
    const dialog = await openProblemReport(page);
    await redactScreenshotMiddle(dialog);
    const number = await sendProblemReport(dialog, description);
    expect(number).toBeGreaterThan(0);

    const stored = await getProblemReportByNumber(world.orgId, number);
    expect(stored.reporterId).toBe(world.users[role].id);
    expect(stored.description).toBe(description);
    expect(stored.status).toBe('eingegangen');
    expect(stored.scrubState).toBe('ausstehend');
    expect(stored.fileKinds).toEqual(['screenshot']);
  });
  await test.step(`${role} finds the report in „Meine Meldungen“`, async () => {
    await openOwnReportsFromReceipt(page);
    await expect(ownReport(page, description)).toBeVisible();
  });
}

test.describe('Report a problem @AUDIT-PROBLEM-REPORTS', () => {
  test('E6-F01 E6-F02 a field worker reports from a phone, redacts the screenshot and finds the report', async ({
    employeePage,
    world,
  }) => {
    const description = `Der Auftrag lädt nicht ${world.runId}-handwerker`;
    await employeePage.setViewportSize({ width: 375, height: 812 });
    await reportFrom(employeePage, world, 'employee', { path: '/auftraege', description });
  });

  test('E6-F01 E6-F02 the office reports from the desktop, redacts the screenshot and finds the report', async ({
    bueroPage,
    world,
  }) => {
    await bueroPage.setViewportSize({ width: 1280, height: 900 });
    await reportFrom(bueroPage, world, 'buero', {
      path: '/kunden',
      description: `Die Kundenliste bleibt leer ${world.runId}-buero`,
    });
  });
});
