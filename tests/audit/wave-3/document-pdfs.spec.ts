import { buffer } from 'node:stream/consumers';

import { seedRuleReadyCompanyProfile } from '../../golden/support/db/company-profile';
import {
  getServiceReportDocuments,
  seedCompletedMaintenanceVisit,
} from '../../golden/support/db/maintenance-visits';
import { expect, test } from '../support/fixtures';
import {
  openCompletedVisits,
  completedVisitRow,
  createServiceReportButton,
  downloadServiceReportButton,
  serviceReportFiledBanner,
} from '../support/service-report-steps';

// The PDFs the server renders, run in the production bundle. Their fonts,
// colour profile and compiled EN 16931 rules are files the server reads at run
// time; Bun's unit tests read them unbundled, so only the bundled app shows
// whether the bundler kept a path the server can read. A route handler and a
// Server Action are bundled differently, so both are driven. The local server
// runs beside the source tree, so whether a deployment carries the files is
// the build trace's question (the routes' and /service/wartung's .nft.json).
// The layout and the rules themselves are proven below the browser
// (lib/document-rendering/, lib/invoicing/check-en16931.test.ts).

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
    const visit = await seedCompletedMaintenanceVisit({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      customerName: `Hausverwaltung Lindenhof GmbH ${world.runId}`,
      jobNumber: `AUF-PDF-${world.runId}`,
      businessDate,
    });

    await test.step('„Servicebericht erstellen“ renders, files and offers the report', async () => {
      await openCompletedVisits(bueroPage);
      const row = completedVisitRow(bueroPage, visit.planNumber);
      await createServiceReportButton(row).click();
      await expect(serviceReportFiledBanner(bueroPage)).toBeVisible();
      await expect(downloadServiceReportButton(row)).toBeVisible();
      const [report, ...others] = await getServiceReportDocuments(world.orgId, visit.dueWorkId);
      expect(others, 'one Servicebericht for the visit').toHaveLength(0);
      expect(report?.mimeType).toBe('application/pdf');
      expect(report?.filedAt, 'the Servicebericht is filed').not.toBeNull();
    });

    await test.step('The Servicebericht download contains a complete PDF', async () => {
      const downloadEvent = bueroPage.waitForEvent('download');
      await downloadServiceReportButton(completedVisitRow(bueroPage, visit.planNumber)).click();
      const download = await downloadEvent;
      const bytes = await buffer(await download.createReadStream());
      expect(bytes.subarray(0, 5).toString('latin1'), 'the Servicebericht download is a PDF').toBe('%PDF-');
      expect(
        bytes.subarray(-8).toString('latin1'),
        'the Servicebericht download ends with the PDF EOF marker',
      ).toMatch(/%%EOF(?:\r?\n)?$/);
      expect(bytes.length, 'the Servicebericht download is larger than 1 KB').toBeGreaterThan(1024);
    });
  });
});
