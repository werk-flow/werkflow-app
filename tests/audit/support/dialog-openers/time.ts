import { expect, type Locator, type Page } from '@playwright/test';
import { addLocalDays } from '../../../../lib/date-time/berlin';
import { formatSicknessRange } from '../../../../lib/sickness/types';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import {
  getEmployeeRecordStateByUser,
  seedOpenOnboardingRequirement,
} from '../../../golden/support/db/personnel';
import { seedSicknessReport } from '../../../golden/support/db/sickness';
import { seedPendingManualInterval } from '../../../golden/support/db/time-tracking';
import { seedPendingVacationRequest } from '../../../golden/support/db/vacation';
import {
  newWorkArtifactButton,
  workArtifactCreateDialog,
} from '../../../golden/support/spec-helpers/work-artifact-dialog';
import { hydratedAndSettled } from '../../../golden/support/steps/interaction';
import { ownEvidenceUploadButton, ownEvidenceUploadDialog } from '../../../golden/support/steps/personnel';
import {
  ownSicknessCancelButton,
  ownSicknessDialog,
  ownSicknessEndButton,
  reportSicknessButton,
} from '../../../golden/support/steps/sickness';
import {
  addMissedTimeButton,
  approveAllTimeEntriesButton,
  approveAllTimeEntriesConfirmation,
  chooseActivityDialog,
  clockInJobPicker,
  clockInLauncher,
  clockSheetJobAction,
  clockSheetMoreActivities,
  clockStartSheet,
  manualEntryDialog,
  manualEntryHeaderButton,
  openTimeApprovals,
  timeCorrectionDialog,
  timeHistoryTab,
} from '../../../golden/support/steps/time-tracking';
import {
  rejectVacationButton,
  requestVacationButton,
  vacationRejectDialog,
  vacationRequestDialog,
} from '../../../golden/support/steps/vacation';
import type { TestWorld } from '../../../golden/support/world';
import type { DialogOpener } from '../dialog-opener';
import { prepareLayoutDetails } from '../layout-fixtures';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';
import { worldName } from '../../../../lib/testing/seed-world-plan';

// Zeiterfassung for the office and the field worker's own dialogs. Every row
// these dialogs need belongs to the world's employee and lies away from the
// business date, so no other audited page changes its default view.

async function employeeRecordId(world: TestWorld): Promise<string> {
  return (await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id)).id;
}

function employeeName(world: TestWorld): string {
  return `${world.users.employee.firstName} ${world.users.employee.lastName}`;
}

/** Returns a control once it is enabled: the page enables it after hydration or its read. */
async function enabled(control: Locator): Promise<Locator> {
  await expect(control).toBeEnabled();
  return control;
}

/** Opens the stopped clock's sheet from the clock button; the sheet is the parent of nested dialogs. */
async function openClockSheet(page: Page): Promise<Locator> {
  await (await enabled(clockInLauncher(page))).click();
  const sheet = clockStartSheet(page);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The history tab's „Zeit nachtragen“, which opens an empty correction. */
async function historyAddTime({ page }: SurfaceContext): Promise<Locator> {
  await timeHistoryTab(page).click();
  await expect(timeHistoryTab(page)).toHaveAttribute('aria-selected', 'true');
  return enabled(addMissedTimeButton(page));
}

/** Two pending manual submissions and one pending vacation request of the employee. */
async function seedEmployeeApprovals({ world, businessDate }: SurfaceContext): Promise<void> {
  await surfaceFixture(world, 'time.pending-submissions', async () => {
    const first = await seedPendingManualInterval({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      date: addLocalDays(businessDate, -4),
      from: '07:00',
      to: '08:30',
    });
    await seedPendingManualInterval({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      date: addLocalDays(businessDate, -3),
      from: '07:00',
      to: '08:30',
    });
    return first.clockInId;
  });
  await surfaceFixture(world, 'time.pending-vacation', async () =>
    seedPendingVacationRequest({
      organizationId: world.orgId,
      employeeRecordId: await employeeRecordId(world),
      requestedBy: world.users.employee.id,
      startDate: addLocalDays(businessDate, 60),
      endDate: addLocalDays(businessDate, 61),
    }),
  );
}

/** The employee's own active sickness report, ahead of the business date; returns its range text. */
async function ownSicknessRange({ page, world, businessDate }: SurfaceContext): Promise<string> {
  const report = { startDate: addLocalDays(businessDate, 40), endDate: addLocalDays(businessDate, 41) };
  await surfaceFixture(world, 'time.own-sickness', async () => {
    await seedSicknessReport({
      organizationId: world.orgId,
      employeeRecordId: await employeeRecordId(world),
      reportedBy: world.users.employee.id,
      ...report,
    });
    return report.startDate;
  });
  await page.reload();
  // Enter on server-rendered HTML before hydration opens nothing.
  await hydratedAndSettled(page);
  return formatSicknessRange(report);
}

export const TIME_OPENERS = {
  'time.manual-entry': {
    trigger: async ({ page }) => manualEntryHeaderButton(page),
    layer: manualEntryDialog,
  },
  'field.manual-entry': {
    trigger: async ({ page }) => manualEntryHeaderButton(page),
    layer: manualEntryDialog,
  },
  'time.correction': {
    trigger: historyAddTime,
    layer: timeCorrectionDialog,
  },
  'field.time-correction': {
    trigger: historyAddTime,
    layer: timeCorrectionDialog,
  },
  'time.approve-all': {
    trigger: async (context) => {
      await seedEmployeeApprovals(context);
      await openTimeApprovals(context.page);
      return approveAllTimeEntriesButton(context.page);
    },
    layer: approveAllTimeEntriesConfirmation,
  },
  'time.vacation-reason': {
    trigger: async (context) => {
      await seedEmployeeApprovals(context);
      await openTimeApprovals(context.page);
      // The world can hold more than one pending request of the employee; any of them opens the same dialog.
      return enabled(rejectVacationButton(context.page, employeeName(context.world)).first());
    },
    layer: vacationRejectDialog,
  },
  'field.clock': {
    trigger: async ({ page }) => enabled(clockInLauncher(page)),
    layer: clockStartSheet,
  },
  'field.job-picker': {
    trigger: async ({ page, world }) => {
      // The layout job is assigned to the employee, so the picker lists a row.
      await prepareLayoutDetails(world);
      return enabled(clockSheetJobAction(await openClockSheet(page)));
    },
    layer: clockInJobPicker,
    parents: (page) => [clockStartSheet(page)],
  },
  'field.time-activity': {
    trigger: async ({ page }) => enabled(clockSheetMoreActivities(await openClockSheet(page))),
    layer: chooseActivityDialog,
    parents: (page) => [clockStartSheet(page)],
  },
  'field.vacation-request': {
    trigger: async ({ page }) => enabled(requestVacationButton(page)),
    layer: vacationRequestDialog,
  },
  'field.sickness-report': {
    trigger: async ({ page }) => enabled(reportSicknessButton(page)),
    layer: (page) => ownSicknessDialog(page, 'report'),
  },
  'field.sickness-end': {
    trigger: async (context) => enabled(ownSicknessEndButton(context.page, await ownSicknessRange(context))),
    layer: (page) => ownSicknessDialog(page, 'end'),
  },
  'field.sickness-cancel': {
    trigger: async (context) =>
      enabled(ownSicknessCancelButton(context.page, await ownSicknessRange(context))),
    layer: (page) => ownSicknessDialog(page, 'cancel'),
  },
  'field.evidence-upload': {
    trigger: async ({ page, world }) => {
      await surfaceFixture(world, 'time.own-requirement', async () =>
        seedOpenOnboardingRequirement({
          organizationId: world.orgId,
          employeeRecordId: await employeeRecordId(world),
          actorUserId: world.users.admin.id,
          planName: worldName('Einarbeitung', world.runId),
          requirementTitle: worldName('Gesundheitsnachweis vorlegen', world.runId),
        }),
      );
      await page.reload();
      await hydratedAndSettled(page);
      return ownEvidenceUploadButton(page);
    },
    layer: ownEvidenceUploadDialog,
  },
  'field.artifact': {
    trigger: async ({ page }) => newWorkArtifactButton(page, { exact: true }),
    layer: workArtifactCreateDialog,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
