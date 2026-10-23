import { expect, type Locator, type Page } from '@playwright/test';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import {
  getEmployeeRecordStateByUser,
  seedEmploymentCondition,
  seedNoLoginPersonnelRecord,
  seedOrganizationInvite,
  seedPersonnelOnboardingPlan,
  seedWorkSchedule,
} from '../../../golden/support/db/personnel';
import { seedTeam } from '../../../golden/support/db/qualifications';
import { hydratedAndSettled } from '../../../golden/support/steps/interaction';
import { seedSicknessReport } from '../../../golden/support/db/sickness';
import {
  memberMenuItem,
  memberRow,
  memberRowActionsButton,
} from '../../../golden/support/steps/organization';
import {
  addConditionButton,
  addWorkScheduleButton,
  createPersonnelRecordButton,
  lifecycleDialog,
  lifecycleDialogTrigger,
  memberInviteButton,
  peopleConfirmation,
  peopleDialog,
  personnelInviteButton,
  versionActionsButton,
  versionMenuItem,
} from '../../../golden/support/steps/personnel';
import { teamDissolveButton, teamDissolveConfirmation } from '../../../golden/support/steps/qualifications';
import { inPageTab } from '../../../golden/support/steps/shared';
import {
  recordSicknessButton,
  sicknessManagerDialog,
  sicknessReportActionsButton,
  sicknessReportMenuItem,
  sicknessReportRangeText,
} from '../../../golden/support/steps/sickness';
import type { TestWorld } from '../../../golden/support/world';
import type { DialogOpener } from '../dialog-opener';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';
import { openSurface } from '../surface-routes';

// The seeded versions and reports lie years ahead of the business date, so
// they change no current target, entitlement or absence of the employee.

function yearsAhead(businessDate: string, years: number): number {
  return Number(businessDate.slice(0, 4)) + years;
}

function employeeName(world: TestWorld): string {
  return `${world.users.employee.firstName} ${world.users.employee.lastName}`;
}

function inviteEmail(world: TestWorld, state: 'pending' | 'cancelled'): string {
  return `layout-einladung-${state}-${world.runId}@example.com`.toLowerCase();
}

function teamName(world: TestWorld): string {
  return `Layout Team ${world.runId}`;
}

/** The sickness report of the employee that the manager dialogs act on. */
function sicknessDates(businessDate: string): { startDate: string; endDate: string } {
  const year = yearsAhead(businessDate, 3);
  return { startDate: `${year}-03-09`, endDate: `${year}-03-11` };
}

async function employeeRecordId(world: TestWorld): Promise<string> {
  return surfaceFixture(
    world,
    'people.employee-record',
    async () => (await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id)).id,
  );
}

/**
 * Opens a row's actions menu with one click and returns the item. A click on
 * the server HTML before hydration opens nothing, so the click waits for the
 * hydrated, settled page.
 */
async function menuItem(button: Locator, item: Locator): Promise<Locator> {
  await hydratedAndSettled(button.page());
  await button.click();
  await expect(item).toBeVisible();
  return item;
}

/** Reloads the audited page after a seed, so it renders the new row. */
async function reloadSurface({ page, route }: SurfaceContext): Promise<void> {
  await openSurface(page, { route });
}

async function seedCondition({ world, businessDate }: SurfaceContext): Promise<string> {
  return surfaceFixture(world, 'people.condition', async () => {
    const validFrom = `${yearsAhead(businessDate, 5)}-01-01`;
    await seedEmploymentCondition({
      organizationId: world.orgId,
      employeeRecordId: await employeeRecordId(world),
      actorUserId: world.users.admin.id,
      validFrom,
      employmentType: 'vollzeit',
      weeklyHours: 40,
      vacationDaysPerYear: 30,
      note: `Layout Kondition ${world.runId}`,
    });
    return validFrom;
  });
}

async function seedSchedule({ world, businessDate }: SurfaceContext): Promise<string> {
  return surfaceFixture(world, 'people.schedule', async () => {
    const validFrom = `${yearsAhead(businessDate, 5)}-01-01`;
    await seedWorkSchedule({
      organizationId: world.orgId,
      employeeRecordId: await employeeRecordId(world),
      actorUserId: world.users.admin.id,
      validFrom,
      weekdayMinutes: 480,
      note: `Layout Wochenplan ${world.runId}`,
    });
    return validFrom;
  });
}

async function seedSickness({ world, businessDate }: SurfaceContext): Promise<string> {
  const { startDate, endDate } = sicknessDates(businessDate);
  await surfaceFixture(world, 'people.sickness-report', async () => {
    await seedSicknessReport({
      organizationId: world.orgId,
      employeeRecordId: await employeeRecordId(world),
      reportedBy: world.users.admin.id,
      startDate,
      endDate,
    });
    return startDate;
  });
  return sicknessReportRangeText(startDate, endDate);
}

/** A personnel record without a login, opened on its own detail page. */
async function openNoLoginRecord(
  context: SurfaceContext,
  name: `${string}.${string}`,
  lastName: string,
  prepare?: (recordId: string) => Promise<void>,
): Promise<void> {
  const { page, world, businessDate } = context;
  const recordId = await surfaceFixture(world, name, async () => {
    const id = await seedNoLoginPersonnelRecord({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      firstName: 'Layout',
      lastName: `${lastName} ${world.runId}`,
      entryDate: businessDate,
    });
    await prepare?.(id);
    return id;
  });
  await openSurface(page, { route: `/mitarbeiter/${recordId}` });
}

async function sicknessMenuItem(
  context: SurfaceContext,
  item: Parameters<typeof sicknessReportMenuItem>[1],
): Promise<Locator> {
  const range = await seedSickness(context);
  await reloadSurface(context);
  return menuItem(
    sicknessReportActionsButton(context.page, range),
    sicknessReportMenuItem(context.page, item),
  );
}

function sicknessMenuButton({ page, businessDate }: SurfaceContext): Locator {
  const { startDate, endDate } = sicknessDates(businessDate);
  return sicknessReportActionsButton(page, sicknessReportRangeText(startDate, endDate));
}

function sicknessOpener(
  item: Parameters<typeof sicknessReportMenuItem>[1],
  dialog: Parameters<typeof sicknessManagerDialog>[1],
): DialogOpener {
  return {
    trigger: (context) => sicknessMenuItem(context, item),
    layer: (page: Page) => sicknessManagerDialog(page, dialog),
    returnFocus: sicknessMenuButton,
  };
}

export const PEOPLE_OPENERS = {
  'people.create-personnel': {
    trigger: async ({ page }) => createPersonnelRecordButton(page),
    layer: (page) => peopleDialog(page, 'createRecord'),
  },
  'people.invite': {
    trigger: async ({ page }) => memberInviteButton(page),
    layer: (page) => peopleDialog(page, 'invite'),
  },
  'people.invite-cancel': {
    opensOn: 'desktop',
    phonePath:
      'The phone card of the invitation list holds the same InviteActionsMenu (components/mitarbeiter/invitations-table.tsx).',
    trigger: async (context) => {
      const { page, world } = context;
      await surfaceFixture(world, 'people.pending-invite', () =>
        seedOrganizationInvite({
          organizationId: world.orgId,
          email: inviteEmail(world, 'pending'),
          status: 'pending',
        }),
      );
      await reloadSurface(context);
      await inPageTab(page, 'invitations').click();
      const row = memberRow(page, inviteEmail(world, 'pending'));
      return menuItem(memberRowActionsButton(row), memberMenuItem(page, 'cancelInvitation'));
    },
    layer: (page) => peopleConfirmation(page, 'inviteCancel'),
    returnFocus: ({ page, world }) => memberRowActionsButton(memberRow(page, inviteEmail(world, 'pending'))),
  },
  'people.invite-delete': {
    opensOn: 'desktop',
    phonePath:
      'The phone card of the invitation list holds the same InviteActionsMenu (components/mitarbeiter/invitations-table.tsx).',
    trigger: async (context) => {
      const { page, world } = context;
      await surfaceFixture(world, 'people.cancelled-invite', () =>
        seedOrganizationInvite({
          organizationId: world.orgId,
          email: inviteEmail(world, 'cancelled'),
          status: 'cancelled',
        }),
      );
      await reloadSurface(context);
      await inPageTab(page, 'invitations').click();
      const row = memberRow(page, inviteEmail(world, 'cancelled'));
      return menuItem(memberRowActionsButton(row), versionMenuItem(page, 'delete'));
    },
    layer: (page) => peopleConfirmation(page, 'inviteDelete'),
    returnFocus: ({ page, world }) =>
      memberRowActionsButton(memberRow(page, inviteEmail(world, 'cancelled'))),
  },
  'people.member-remove': {
    opensOn: 'desktop',
    phonePath:
      'The phone card of the member list holds the same MemberActionsMenu (components/mitarbeiter/members-table.tsx).',
    trigger: async ({ page, world }) =>
      menuItem(memberRowActionsButton(memberRow(page, employeeName(world))), memberMenuItem(page, 'remove')),
    layer: (page) => peopleConfirmation(page, 'memberRemove'),
    returnFocus: ({ page, world }) => memberRowActionsButton(memberRow(page, employeeName(world))),
  },
  'people.team-dissolve': {
    trigger: async (context) => {
      const { page, world } = context;
      await surfaceFixture(world, 'people.team', () =>
        seedTeam({
          organizationId: world.orgId,
          actorUserId: world.users.admin.id,
          name: teamName(world),
          description: 'Team für den Layout-Audit',
        }),
      );
      await reloadSurface(context);
      await inPageTab(page, 'teams').click();
      return teamDissolveButton(page, teamName(world));
    },
    layer: teamDissolveConfirmation,
  },
  'people.personnel-invite': {
    trigger: async (context) => {
      await openNoLoginRecord(context, 'people.no-login-record', 'Zugang');
      return personnelInviteButton(context.page);
    },
    layer: (page) => peopleDialog(page, 'personnelInvite'),
  },
  'people.condition': {
    trigger: async ({ page }) => addConditionButton(page),
    layer: (page) => peopleDialog(page, 'addCondition'),
  },
  'people.condition-delete': {
    trigger: async (context) => {
      const validFrom = await seedCondition(context);
      await reloadSurface(context);
      return menuItem(
        versionActionsButton(context.page, 'condition', validFrom),
        versionMenuItem(context.page, 'delete'),
      );
    },
    layer: (page) => peopleConfirmation(page, 'conditionDelete'),
    returnFocus: ({ page, businessDate }) =>
      versionActionsButton(page, 'condition', `${yearsAhead(businessDate, 5)}-01-01`),
  },
  'people.schedule': {
    trigger: async ({ page }) => addWorkScheduleButton(page),
    layer: (page) => peopleDialog(page, 'addSchedule'),
  },
  'people.schedule-delete': {
    trigger: async (context) => {
      const validFrom = await seedSchedule(context);
      await reloadSurface(context);
      return menuItem(
        versionActionsButton(context.page, 'schedule', validFrom),
        versionMenuItem(context.page, 'delete'),
      );
    },
    layer: (page) => peopleConfirmation(page, 'scheduleDelete'),
    returnFocus: ({ page, businessDate }) =>
      versionActionsButton(page, 'schedule', `${yearsAhead(businessDate, 5)}-01-01`),
  },
  'people.sickness-record': {
    trigger: async ({ page }) => recordSicknessButton(page),
    layer: (page) => sicknessManagerDialog(page, 'record'),
  },
  'people.sickness-end': sicknessOpener('changeEnd', 'end'),
  'people.sickness-correct': sicknessOpener('correct', 'correct'),
  'people.sickness-evidence': sicknessOpener('evidence', 'evidence'),
  'people.sickness-cancel': sicknessOpener('cancel', 'cancel'),
  'people.lifecycle-access': {
    trigger: async ({ page }) => lifecycleDialogTrigger(page, 'access'),
    layer: (page) => lifecycleDialog(page, 'access'),
  },
  'people.lifecycle-transition': {
    trigger: async ({ page }) => lifecycleDialogTrigger(page, 'transition'),
    layer: (page) => lifecycleDialog(page, 'transition'),
  },
  'people.lifecycle-document': {
    trigger: async ({ page }) => lifecycleDialogTrigger(page, 'document'),
    layer: (page) => lifecycleDialog(page, 'document'),
  },
  'people.onboarding-plan': {
    trigger: async ({ page }) => lifecycleDialogTrigger(page, 'plan'),
    layer: (page) => lifecycleDialog(page, 'plan'),
  },
  'people.onboarding-requirement': {
    // The employee keeps no plan for people.onboarding-plan, so the plan
    // lives on its own record without a login.
    trigger: async (context) => {
      const { world } = context;
      await openNoLoginRecord(context, 'people.onboarding-record', 'Onboarding', async (recordId) => {
        await seedPersonnelOnboardingPlan({
          organizationId: world.orgId,
          employeeRecordId: recordId,
          actorUserId: world.users.admin.id,
          name: `Layout Onboarding ${world.runId}`,
          templateVersionId: null,
          targetStartDate: null,
        });
      });
      return lifecycleDialogTrigger(context.page, 'requirement');
    },
    layer: (page) => lifecycleDialog(page, 'requirement'),
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
