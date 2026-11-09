import { problemReportButton, problemReportDialog } from '../../../golden/support/steps/problem-reports';
import type { DialogOpener } from '../dialog-opener';

// The report dialog opens from the app shell on every page: the phone
// header's icon, the desktop sidebar's row.
const problemReport: DialogOpener = {
  trigger: async ({ page }) => problemReportButton(page),
  layer: problemReportDialog,
};

export const PROBLEM_REPORT_OPENERS = {
  'field.problem-report': problemReport,
  'shell.problem-report': problemReport,
} satisfies Record<string, DialogOpener>;
