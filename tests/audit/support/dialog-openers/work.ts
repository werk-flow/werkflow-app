import { expect, type Locator } from '@playwright/test';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import {
  workArtifactCreateButton,
  workArtifactCreateDialog,
} from '../../../golden/support/spec-helpers/work-artifact-dialog';
import { getEmployeeRecordStateByUser } from '../../../golden/support/db/personnel';
import { seedOrganizationCertification } from '../../../golden/support/db/qualifications';
import {
  seedDeclaredWorkDependency,
  seedJob,
  seedJobAssignment,
  seedJobCapabilityRequirement,
  seedJobDispatch,
  seedJobInstructionItem,
} from '../../../golden/support/db/work';
import {
  challengeDispatchButton,
  dispatchReasonDialog,
  jobDispatchSection,
} from '../../../golden/support/steps/dispatch';
import {
  detailActionsButton,
  employeeAssignmentButton,
  employeeAssignmentDialog,
  employeeAssignmentSave,
  openEmployeeAssignmentDialog,
  qualificationWarningDialog,
  testData,
} from '../../../golden/support/steps/shared';
import {
  clearPlannedDateInJobEditDialog,
  jobDeleteConfirmation,
  jobDetailMenuItem,
  jobEditDialog,
  jobEditSave,
  jobInstructionDetailsDialog,
  jobPageHeading,
  jobRelationDialog,
  jobRelationEmptyCard,
  lastJobInstructionDetailsButton,
  lifecycleAction,
  lifecycleCardAction,
  openJobEditDialog,
  plannedDateRemovalConfirmation,
  projectAddJobButton,
  projectAssignJobsButton,
  projectCreateJobDialog,
  projectDeleteConfirmation,
  projectDeleteMenuItem,
  projectEditDialog,
  projectEditMenuItem,
  projectJobAssignmentDialog,
  visibleJobSearch,
  workCreateButton,
  workCreateDialog,
  workDependencyApprovalAction,
  workDependencyRow,
  workDependencyRowAction,
  workLifecycleDialogNamed,
  workListFilterSheet,
  workListFilterToggle,
  workListRowActionsButton,
  workListRowDeleteItem,
  workListSection,
  workTransitionDialog,
} from '../../../golden/support/steps/work';
import type { TestWorld } from '../../../golden/support/world';
import type { DialogOpener } from '../dialog-opener';
import { auditCheckpoint } from '../checkpoints';
import { prepareLayoutDetails } from '../layout-fixtures';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';

/**
 * The jobs a dialog needs in a particular state, each seeded once per world
 * beside the layout job so that the layout job keeps its plain state. An
 * opener seeds its job and opens its detail page inside `trigger`.
 */
const AUDIT_JOB_TITLES = {
  clientless: 'Heizkörpertausch ohne Kundenzuordnung',
  checklist: 'Thermenwartung mit Arbeitsanweisung',
  dated: 'Geplanter Austausch des Ausdehnungsgefäßes',
  prerequisites: 'Kesseltausch mit offenen Voraussetzungen',
  dispatched: 'Einsatz zur Rohrbruchreparatur',
  qualified: 'Gasleitungsprüfung mit Qualifikationsanforderung',
} as const;

type AuditJob = keyof typeof AUDIT_JOB_TITLES;

function auditJob(world: TestWorld, job: AuditJob): { jobNumber: string; title: string } {
  return {
    jobNumber: testData`AUF-${world.runId}-${job.toUpperCase()}`,
    title: testData`${AUDIT_JOB_TITLES[job]} ${world.runId}`,
  };
}

/** The two declared prerequisites of the prerequisites job, by their descriptions. */
function prerequisiteDescriptions(world: TestWorld): { approval: string; delivery: string } {
  return {
    approval: testData`Freigabe des Betreibers ${world.runId}`,
    delivery: testData`Lieferung des neuen Kessels ${world.runId}`,
  };
}

/**
 * Seeds the job once per world (its rows through `seed`), then opens its
 * detail page and waits for its title.
 */
async function openAuditJob(
  { page, world }: SurfaceContext,
  job: AuditJob,
  seed: (jobId: string) => Promise<void>,
  plannedDate?: string,
): Promise<void> {
  const { jobNumber, title } = auditJob(world, job);
  await surfaceFixture(world, `work.${job}`, async () => {
    const jobId = await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title,
      ...(plannedDate ? { plannedDate } : {}),
    });
    await seed(jobId);
    return jobNumber;
  });
  await page.goto(`/auftraege/${encodeURIComponent(jobNumber)}`);
  await expect(jobPageHeading(page, title)).toBeVisible();
}

const noRows = async (): Promise<void> => {};

type LayoutRecord = 'job' | 'project';

/** Opens the list row menu of a layout record, found through the list's search. */
async function openListRowMenu(context: SurfaceContext, record: LayoutRecord): Promise<void> {
  const { page, world } = context;
  const details = await prepareLayoutDetails(world);
  await page.reload();
  const number = record === 'job' ? details.jobNumber : details.projectNumber;
  await visibleJobSearch(page).fill(number);
  await workListRowActionsButton(page, number).click();
}

/** The row menu button that `openListRowMenu` opened; the trigger saved the layout details before. */
function listRowMenuButton({ page }: SurfaceContext, record: LayoutRecord): Locator {
  const details = auditCheckpoint('layout.details');
  if (!details) throw new Error('The list row menu opener runs after the layout details were prepared.');
  return workListRowActionsButton(page, record === 'job' ? details.jobNumber : details.projectNumber);
}

export const WORK_OPENERS = {
  'work.artifact': {
    trigger: async ({ page }) => workArtifactCreateButton(page),
    layer: workArtifactCreateDialog,
  },
  'work.assign-client': {
    trigger: async (context) => {
      await openAuditJob(context, 'clientless', noRows);
      return jobRelationEmptyCard(context.page, 'customer');
    },
    layer: (page) => jobRelationDialog(page, 'customer'),
  },
  'work.assign-employees': {
    trigger: async ({ page }) => employeeAssignmentButton(page),
    layer: employeeAssignmentDialog,
  },
  'work.assign-project': {
    // The layout job has a customer and no project.
    trigger: async ({ page }) => jobRelationEmptyCard(page, 'project'),
    layer: (page) => jobRelationDialog(page, 'project'),
  },
  'work.create': {
    trigger: async ({ page }) => workCreateButton(page),
    layer: workCreateDialog,
  },
  'work.create-job-in-project': {
    trigger: async ({ page }) => projectAddJobButton(page),
    layer: projectCreateJobDialog,
  },
  'work.delete-job': {
    trigger: async ({ page }) => {
      await detailActionsButton(page).click();
      return jobDetailMenuItem(page, 'delete');
    },
    layer: jobDeleteConfirmation,
    returnFocus: ({ page }) => detailActionsButton(page),
  },
  'work.delete-project': {
    trigger: async ({ page }) => {
      await detailActionsButton(page).click();
      return projectDeleteMenuItem(page);
    },
    layer: projectDeleteConfirmation,
    returnFocus: ({ page }) => detailActionsButton(page),
  },
  'work.dispatch-challenge': {
    // The card lists the viewer's own dispatches, so the admin is the recipient.
    trigger: async (context) => {
      const { world } = context;
      await openAuditJob(context, 'dispatched', async (jobId) => {
        const record = await getEmployeeRecordStateByUser(world.orgId, world.users.admin.id);
        await seedJobDispatch({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          jobId,
          recipientEmployeeRecordIds: [record.id],
        });
      });
      return challengeDispatchButton(jobDispatchSection(context.page));
    },
    layer: (page) => dispatchReasonDialog(page, 'challenge'),
  },
  'work.edit-job': {
    trigger: async ({ page }) => {
      await detailActionsButton(page).click();
      return jobDetailMenuItem(page, 'edit');
    },
    layer: jobEditDialog,
    returnFocus: ({ page }) => detailActionsButton(page),
  },
  'work.edit-project': {
    trigger: async ({ page }) => {
      await detailActionsButton(page).click();
      return projectEditMenuItem(page);
    },
    layer: projectEditDialog,
    returnFocus: ({ page }) => detailActionsButton(page),
  },
  'work.filter-sheet': {
    // Below 768 px the section's filter button opens a sheet instead of the panel.
    trigger: async ({ page }) => workListFilterToggle(workListSection(page)),
    layer: workListFilterSheet,
    viewport: { width: 375, height: 812 },
  },
  'work.instruction-details': {
    trigger: async (context) => {
      const { world } = context;
      await openAuditJob(context, 'checklist', (jobId) =>
        seedJobInstructionItem({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          jobId,
          content: testData`Druck des Heizkreises prüfen ${world.runId}`,
        }),
      );
      return lastJobInstructionDetailsButton(context.page);
    },
    layer: jobInstructionDetailsDialog,
  },
  'work.lifecycle-approval': {
    trigger: async (context) => {
      await openPrerequisitesJob(context);
      const row = workDependencyRow(context.page, prerequisiteDescriptions(context.world).approval);
      return workDependencyApprovalAction(row);
    },
    layer: (page) => workLifecycleDialogNamed(page, 'linkApproval'),
  },
  'work.lifecycle-blocker': {
    trigger: async ({ page }) => lifecycleCardAction(page, 'addBlocker'),
    layer: (page) => workLifecycleDialogNamed(page, 'addBlocker'),
  },
  'work.lifecycle-dependency': {
    trigger: async ({ page }) => lifecycleCardAction(page, 'addDependency'),
    layer: (page) => workLifecycleDialogNamed(page, 'addDependency'),
  },
  'work.lifecycle-reason': {
    trigger: async (context) => {
      await openPrerequisitesJob(context);
      const row = workDependencyRow(context.page, prerequisiteDescriptions(context.world).delivery);
      return workDependencyRowAction(row, 'fulfil');
    },
    layer: (page) => workLifecycleDialogNamed(page, 'fulfilDependency'),
  },
  'work.lifecycle-transition': {
    // The layout job has not started; nothing in the audit moves it.
    trigger: async ({ page }) => lifecycleAction(page, 'not_started', 'in_progress'),
    layer: (page) => workTransitionDialog(page, 'not_started', 'in_progress'),
  },
  'work.list-delete-job': {
    // The trigger lives in the desktop layout (a table row, the board or the day timeline).
    opensOn: 'desktop',
    trigger: async (context) => {
      await openListRowMenu(context, 'job');
      return workListRowDeleteItem(context.page);
    },
    layer: jobDeleteConfirmation,
    returnFocus: (context) => listRowMenuButton(context, 'job'),
  },
  'work.list-delete-project': {
    // The trigger lives in the desktop layout (a table row, the board or the day timeline).
    opensOn: 'desktop',
    trigger: async (context) => {
      await openListRowMenu(context, 'project');
      return workListRowDeleteItem(context.page);
    },
    layer: projectDeleteConfirmation,
    returnFocus: (context) => listRowMenuButton(context, 'project'),
  },
  'work.park-confirm': {
    // The trigger lives in the desktop layout (a table row, the board or the day timeline).
    opensOn: 'desktop',
    // Saving the edit dialog with an emptied planned date asks first; the
    // confirmation opens before any write.
    trigger: async (context) => {
      await openAuditJob(context, 'dated', noRows, context.businessDate);
      const dialog = await openJobEditDialog(context.page);
      await clearPlannedDateInJobEditDialog(dialog);
      const save = jobEditSave(dialog);
      await expect(save).toBeEnabled();
      return save;
    },
    layer: plannedDateRemovalConfirmation,
    parents: (page) => [jobEditDialog(page)],
  },
  'work.project-jobs': {
    trigger: async ({ page }) => projectAssignJobsButton(page),
    layer: projectJobAssignmentDialog,
  },
  'work.qualification-warning': {
    // The assigned employee lacks the required certification, so saving the
    // unchanged crew is refused with the warning before anything is written.
    trigger: async (context) => {
      const { world } = context;
      await openAuditJob(context, 'qualified', async (jobId) => {
        const actorId = world.users.admin.id;
        const capabilityId = await seedOrganizationCertification(
          world.orgId,
          actorId,
          testData`Gasinstallation nach TRGI ${world.runId}`,
        );
        await seedJobCapabilityRequirement({ orgId: world.orgId, actorId, jobId, capabilityId });
        await seedJobAssignment({ orgId: world.orgId, actorId, jobId, userId: world.users.employee.id });
      });
      const dialog = await openEmployeeAssignmentDialog(context.page);
      return employeeAssignmentSave(dialog);
    },
    layer: qualificationWarningDialog,
    parents: (page) => [employeeAssignmentDialog(page)],
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;

/** Seeds the job with an open approval prerequisite and an open delivery prerequisite, then opens it. */
async function openPrerequisitesJob(context: SurfaceContext): Promise<void> {
  const { world } = context;
  const descriptions = prerequisiteDescriptions(world);
  await openAuditJob(context, 'prerequisites', async (jobId) => {
    const actorId = world.users.admin.id;
    await seedDeclaredWorkDependency({
      orgId: world.orgId,
      actorId,
      jobId,
      kind: 'approval',
      description: descriptions.approval,
      effect: 'blocks_completion',
    });
    await seedDeclaredWorkDependency({
      orgId: world.orgId,
      actorId,
      jobId,
      kind: 'delivery',
      description: descriptions.delivery,
      effect: 'blocks_start',
    });
  });
}
