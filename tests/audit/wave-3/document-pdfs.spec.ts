import { seedRuleReadyCompanyProfile } from '../../golden/support/db/company-profile';
import {
  getFiledServiceReportCount,
  seedCompletedMaintenanceVisit,
} from '../../golden/support/db/service-reports';
import { expect, test } from '../support/fixtures';
import {
  COMPLETED_VISITS_PATH,
  completedVisitRow,
  createServiceReportButton,
  downloadServiceReportButton,
  serviceReportFiledBanner,
} from '../support/service-report-steps';

// The PDFs the server renders, in the production build. Their fonts, colour
// profile and compiled EN 16931 rules are files the server reads at run time.
// Bun's unit tests read them from the source tree, so only the built app shows
// whether the bundler kept a path the server can read and the build traced
// the files. A route handler and a Server Action are bundled differently, so
// both are driven. The layout and the rules themselves are proven below the
// browser (lib/document-rendering/, lib/invoicing/check-en16931.test.ts).

const SAMPLE_PDFS = [
  { route: '/api/musterangebot', name: 'Musterangebot' },
  { route: '/api/musterrechnung', name: 'Musterrechnung' },
] as const;

test.describe('Document PDFs in the built app @AUDIT-W3-DOCUMENT-PDFS @AUDIT-W3', () => {
  test('Admin gets the Musterangebot and the checked Musterrechnung as PDFs', async ({
    adminPage,
    world,
  }) => {
    await seedRuleReadyCompanyProfile({ orgId: world.orgId, actorId: world.users.admin.id });

    for (const sample of SAMPLE_PDFS) {
      await test.step(`${sample.name} answers a PDF`, async () => {
        const response = await adminPage.request.get(sample.route);
        expect(response.status(), `${sample.route}: ${await response.text()}`).toBe(200);
        expect(response.headers()['content-type']).toBe('application/pdf');
        expect((await response.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
      });
    }
  });

  test('Büro files the Servicebericht of a completed maintenance visit', async ({
    bueroPage,
    world,
    businessDate,
  }) => {
    const planNumber = await seedCompletedMaintenanceVisit({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      customerName: `Hausverwaltung Lindenhof GmbH ${world.runId}`,
      jobNumber: `AUF-PDF-${world.runId}`,
      businessDate,
    });

    await test.step('„Servicebericht erstellen“ renders, files and offers the report', async () => {
      await bueroPage.goto(COMPLETED_VISITS_PATH);
      const row = completedVisitRow(bueroPage, planNumber);
      await createServiceReportButton(row).click();
      await expect(serviceReportFiledBanner(bueroPage)).toBeVisible();
      await expect(downloadServiceReportButton(row)).toBeVisible();
      expect(await getFiledServiceReportCount(world.orgId)).toBe(1);
    });
  });
});
