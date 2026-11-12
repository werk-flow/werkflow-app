import type { Page } from '@playwright/test';
import { expect, test as auditTest } from '../support/fixtures';
import {
  getCallerReportByDescription,
  getProblemReportByDescription,
  getProblemReportTriage,
  seedProblemReport,
} from '../../golden/support/db/problem-reports';
import { expectLiveWithin } from '../../golden/support/live';
import {
  fileReportForCaller,
  fillSupportTriage,
  openSupportOriginal,
  openSupportQueue,
  openSupportReport,
  ownReport,
  ownReportStatus,
  supportAreaNotFound,
  supportPendingScrubNotice,
  supportReportText,
  supportTriageSaveButton,
  supportTriageSavedBanner,
} from '../../golden/support/steps/problem-reports';
import { textInDom } from '../../golden/support/steps/shared';
import { createSupportPage } from '../../golden/support/support-session';
import { TEST_SUPPORT_COLLEAGUE, TEST_SUPPORT_USER } from '../../../lib/testing/support-user';

// WerkFlow support's queue (docs/features/problem-reports.md, E6-F03 and
// E6-F04). The support persons are the two synthetic users the test server's
// allowlist names, members of no organization. The boundary fixture
// (lib/testing/fixtures/problem-report-support-boundaries.ts) proves each
// refusal on the real actions; this journey proves the screens, the live
// answer for the reporter and the not-found page for everyone else.

/** A support session in a browser context of its own, closed after the test. */
async function supportSession(
  open: () => ReturnType<typeof createSupportPage>,
  provide: (page: Page) => Promise<void>,
): Promise<void> {
  const { context, page } = await open();
  try {
    await provide(page);
  } finally {
    await context.close();
  }
}

const test = auditTest.extend<{ supportPage: Page; colleaguePage: Page }>({
  supportPage: async ({ browser, baseURL }, provide) =>
    supportSession(() => createSupportPage({ browser, baseUrl: baseURL }), provide),
  colleaguePage: async ({ browser, baseURL }, provide) =>
    supportSession(
      () => createSupportPage({ browser, baseUrl: baseURL, user: TEST_SUPPORT_COLLEAGUE }),
      provide,
    ),
});

const SUPPORT_NAME = `${TEST_SUPPORT_USER.firstName} ${TEST_SUPPORT_USER.lastName}`;
// A one-pixel PNG: the upload checks type and size, not the picture.
const ATTACHMENT = {
  name: 'zaehler.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ),
};

test.describe('Support queue @AUDIT-SECURITY-PROBLEM-REPORT', () => {
  test('E6-F03 support triages a report and answers, and the reporter and a colleague see it live', async ({
    supportPage,
    colleaguePage,
    employeePage,
    adminPage,
    world,
  }) => {
    const description = `Bei Familie Beispiel speichert der Auftrag nicht ${world.runId}`;
    const response = `Behoben, ab morgen live ${world.runId}`;
    const reportId = await seedProblemReport({
      orgId: world.orgId,
      reporterId: world.users.employee.id,
      description,
      createdAt: new Date().toISOString(),
    });

    await test.step('the reporter sees the report without an answer', async () => {
      await employeePage.goto('/meldungen');
      await expect(ownReport(employeePage, description)).toBeVisible();
    });

    await test.step('support reads the scrub state of an unscrubbed report, never its original', async () => {
      await openSupportQueue(supportPage);
      await openSupportReport(supportPage, reportId);
      await expect(supportPendingScrubNotice(supportPage)).toBeVisible();
      await expect(textInDom(supportPage, description)).toHaveCount(0);
      // A second support person has the same report open.
      await openSupportReport(colleaguePage, reportId);
    });

    await test.step('support triages and answers; the reporter and the colleague see it live', async () => {
      await fillSupportTriage(supportPage, {
        status: 'Erledigt',
        bucket: 'Fehler',
        assignee: SUPPORT_NAME,
        response,
      });
      await expectLiveWithin(ownReport(employeePage, response), {
        label: 'support answer reaches „Meine Meldungen“',
        actingPage: supportPage,
        mutation: async (beforeSubmit) => {
          await beforeSubmit();
          await supportTriageSaveButton(supportPage).click();
        },
      });
      await expect(ownReportStatus(employeePage, description, 'Erledigt')).toBeVisible();
      await expect(supportTriageSavedBanner(supportPage)).toBeVisible();
      // No reload: the colleague's page read again on its own signal.
      await expect(supportReportText(colleaguePage, 'Status auf „Erledigt“ gesetzt')).toBeVisible();
      const triage = await getProblemReportTriage(world.orgId, reportId);
      expect(triage.status).toBe('erledigt');
      expect(triage.bucket).toBe('fehler');
      expect(triage.assigneeId).toBe(TEST_SUPPORT_USER.id);
      expect(triage.response).toBe(response);
      expect(triage.history.toSorted()).toEqual(
        ['assignee_changed', 'bucket_changed', 'response_changed', 'status_changed'].map(
          (type) => `${type} by ${TEST_SUPPORT_USER.id}`,
        ),
      );
    });

    await test.step('opening the original is a history entry the colleague sees live', async () => {
      await expectLiveWithin(supportReportText(colleaguePage, 'Original geöffnet'), {
        label: 'an opening of the original reaches another support session',
        actingPage: supportPage,
        mutation: async (beforeSubmit) => {
          await beforeSubmit();
          await openSupportOriginal(supportPage, description);
        },
      });
      await expect
        .poll(async () => (await getProblemReportTriage(world.orgId, reportId)).history)
        .toContain(`original_opened by ${TEST_SUPPORT_USER.id}`);
      await expect(supportReportText(supportPage, 'Original geöffnet')).toBeVisible();
    });

    await test.step('an admin of the reporting organization gets the not-found page', async () => {
      for (const path of ['/support', `/support/meldungen/${reportId}`, '/support/aufnehmen']) {
        await adminPage.goto(path);
        await expect(supportAreaNotFound(adminPage), path).toBeVisible();
        await expect(textInDom(adminPage, description), path).toHaveCount(0);
      }
    });
  });

  test('E6-F04 support files a report for a caller, who finds it in „Meine Meldungen“', async ({
    supportPage,
    employeePage,
    world,
  }) => {
    const description = `Am Telefon: Die Zeiterfassung startet nicht ${world.runId}`;
    const member = world.users.employee;

    await fileReportForCaller(supportPage, {
      organization: world.orgName,
      member: `${member.firstName} ${member.lastName}`,
      description,
      attachment: ATTACHMENT,
    });

    const filed = await getCallerReportByDescription(world.orgId, description);
    expect(filed.reporterId).toBe(member.id);
    expect(filed.filedById).toBe(TEST_SUPPORT_USER.id);
    expect((await getProblemReportByDescription(world.orgId, description)).fileKinds).toEqual(['anhang']);

    await test.step('the server scrubs the new report after the answer, and its page shows the scrubbed copy', async () => {
      await expect(supportPage).toHaveURL(new RegExp(`/support/meldungen/${filed.id}$`));
      await expect
        .poll(async () => (await getProblemReportByDescription(world.orgId, description)).scrubState)
        .toBe('bereinigt');
      const { scrubbedDescription } = await getProblemReportByDescription(world.orgId, description);
      expect(scrubbedDescription).toEqual(expect.any(String));
      await openSupportReport(supportPage, filed.id);
      await expect(supportReportText(supportPage, scrubbedDescription ?? '')).toBeVisible();
      await expect(supportPendingScrubNotice(supportPage)).toHaveCount(0);
    });

    await test.step('the caller finds the report in „Meine Meldungen“', async () => {
      await employeePage.goto('/meldungen');
      await expect(ownReport(employeePage, description)).toBeVisible();
    });
  });
});
