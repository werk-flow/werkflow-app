import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { getProblemReportByDescription } from '../../golden/support/db/problem-reports';
import {
  openOwnReportsFromReceipt,
  openProblemReport,
  ownReport,
  problemReportReceipt,
  redactScreenshotMiddle,
  sendProblemReport,
} from '../../golden/support/steps/problem-reports';
import type { TestRole, TestWorld } from '../../golden/support/world';

// Reporting a problem (docs/features/problem-reports.md, E6-F01 and E6-F02):
// from a page, with a redrawn and redacted screenshot, to the receipt and the
// report in „Meine Meldungen“. After the receipt the server writes the
// scrubbed copy (docs/technical/problem-report-scrubbing.md): the reporter's
// own name and a phone number in the description become placeholders. The
// boundary fixtures (lib/testing/fixtures/problem-report-boundaries.ts,
// problem-report-scrub-boundaries.ts) prove that no one else lists or
// extends a report and that the scrub stays inside its organization.

/** A made-up number in a phone number's shape. */
const CALLBACK_NUMBER = '0171 5550142';

async function reportFrom(
  page: Page,
  world: TestWorld,
  role: TestRole,
  { path, problem }: { path: string; problem: string },
): Promise<void> {
  const reporter = world.users[role];
  const description = `${problem}, Rückruf an ${reporter.firstName} ${reporter.lastName} unter ${CALLBACK_NUMBER}`;
  await test.step(`${role} reports a problem from ${path}`, async () => {
    await page.goto(path);
    const dialog = await openProblemReport(page);
    await redactScreenshotMiddle(dialog);
    await sendProblemReport(dialog, description);

    const stored = await getProblemReportByDescription(world.orgId, description);
    await expect(problemReportReceipt(page, stored.number)).toBeVisible();
    expect(stored.reporterId).toBe(world.users[role].id);
    expect(stored.description).toBe(description);
    expect(stored.status).toBe('eingegangen');
    expect(stored.fileKinds).toEqual(['screenshot']);
  });
  await test.step('the server scrubs the report after the receipt', async () => {
    await expect
      .poll(async () => (await getProblemReportByDescription(world.orgId, description)).scrubState)
      .toBe('bereinigt');
    const stored = await getProblemReportByDescription(world.orgId, description);
    expect(stored.description).toBe(description);
    // The test world's surnames share the run id, so the name is not always the first person of the text.
    expect(stored.scrubbedDescription).toMatch(/Rückruf an \[Person \d\] unter \[Telefon 1\]$/u);
    expect(stored.scrubbedDescription).not.toContain(reporter.firstName);
    expect(stored.scrubbedDescription).not.toContain(CALLBACK_NUMBER);
  });
  await test.step(`${role} finds the report in „Meine Meldungen“`, async () => {
    await openOwnReportsFromReceipt(page);
    await expect(ownReport(page, description)).toBeVisible();
  });
}

test.describe('Report a problem @AUDIT-SECURITY-PROBLEM-REPORT', () => {
  test('E6-F01 E6-F02 a field worker reports from a phone, redacts the screenshot and finds the report', async ({
    employeePage,
    world,
  }) => {
    await employeePage.setViewportSize({ width: 375, height: 812 });
    await reportFrom(employeePage, world, 'employee', {
      path: '/auftraege',
      problem: `Der Auftrag lädt nicht ${world.runId}-handwerker`,
    });
  });

  test('E6-F01 E6-F02 the office reports from the desktop, redacts the screenshot and finds the report', async ({
    bueroPage,
    world,
  }) => {
    await bueroPage.setViewportSize({ width: 1280, height: 900 });
    await reportFrom(bueroPage, world, 'buero', {
      path: '/kunden',
      problem: `Die Kundenliste bleibt leer ${world.runId}-buero`,
    });
  });
});
