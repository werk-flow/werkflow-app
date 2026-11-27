import type { Locator, Page } from '@playwright/test';

import { confirmed } from '../../golden/support/steps/shared';

// Copy and structure of „Abgeschlossene Wartungsbesuche“ on the Wartung page
// (components/service/service-report-list.tsx) and its „Servicebericht
// versenden“ dialog, for the document PDF and the dialog audits.

const COMPLETED_VISITS = 'Abgeschlossene Wartungsbesuche';
const CREATE_REPORT = 'Servicebericht erstellen';
const DOWNLOAD_REPORT = 'Herunterladen';
const DELIVER_REPORT = 'Versenden';
const DELIVERY_DIALOG = 'Servicebericht versenden';
const SEND_BY_EMAIL = 'Per E-Mail senden';
const REPORT_FILED = 'Servicebericht erstellt und beim Auftrag abgelegt.';

/** The Wartung page, which lists every completed visit below its workspace. */
export const COMPLETED_VISITS_PATH = '/service/wartung';

/** The completed visit row of a plan, inside its section. */
export function completedVisitRow(page: Page, planNumber: string): Locator {
  return confirmed(
    page
      .getByRole('region', { name: COMPLETED_VISITS, exact: true })
      .getByTestId('service-report-row')
      .filter({ hasText: planNumber }),
  );
}

/** „Servicebericht erstellen“ of a row without a report. */
export function createServiceReportButton(row: Locator): Locator {
  return row.getByRole('button', { name: CREATE_REPORT, exact: true });
}

/** „Herunterladen“, shown once the row's report is filed. */
export function downloadServiceReportButton(row: Locator): Locator {
  return row.getByRole('button', { name: DOWNLOAD_REPORT, exact: true });
}

/** The banner that answers a filed report. */
export function serviceReportFiledBanner(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: REPORT_FILED });
}

/** „Versenden“, shown once the row's report is filed. */
export function deliverServiceReportButton(row: Locator): Locator {
  return row.getByRole('button', { name: DELIVER_REPORT, exact: true });
}

/** The open „Servicebericht versenden“ dialog. */
export function serviceReportDeliveryDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: DELIVERY_DIALOG, exact: true });
}

/** „Per E-Mail senden“ in the dialog, enabled once its sends are read. */
export function serviceReportEmailStepButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: SEND_BY_EMAIL, exact: true });
}
