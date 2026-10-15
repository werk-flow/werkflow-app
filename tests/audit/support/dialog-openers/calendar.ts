import { expect, type Locator, type Page } from '@playwright/test';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import { getPlanningState } from '../../../golden/support/db/calendar';
import { ensureEmployedSince, getEmployeeRecordStateByUser } from '../../../golden/support/db/personnel';
import { createAdminClient } from '../../../golden/support/db/shared';
import { seedApprovedManualInterval } from '../../../golden/support/db/time-tracking';
import { seedPendingVacationRequest } from '../../../golden/support/db/vacation';
import { seedJob } from '../../../golden/support/db/work';
import { seedPlanningVisit } from '../../../golden/support/planning-fixture';
import {
  boardRowCards,
  calendarLayerCheckbox,
  calendarWorkTimeBlock,
  cardPopoverAction,
  dayRow,
  jobPopover,
  openCalendarView,
  openPlantafel,
  parkplatzScheduleButton,
  scheduleParkedDialog,
  shiftIsoDate,
  shortcutsButton,
  shortcutsDialog,
} from '../../../golden/support/plantafel';
import {
  calendarEntryDialog,
  calendarNewEntryButton,
  occurrenceEditButton,
  occurrenceEditDialog,
  timeEntryDeleteButton,
  timeEntryDeleteConfirmation,
  timeEntryDetailsDialog,
  typeCardMoveDate,
} from '../../../golden/support/steps/calendar';
import {
  batchModeToggle,
  batchPreviewDialog,
  batchReasonField,
  checkBatchImpactButton,
  commitmentDialog,
  dispatchIssueDialog,
  dispatchOccurrenceRow,
  dispatchPanel,
  dispatchReasonDialog,
  dispatchSendButton,
  openDispatchPanel,
  openParkplatzPanel,
  parkingContextDialog,
  parkplatzCard,
  parkplatzEditContextButton,
  recordCommitmentButton,
  rowReasonAction,
} from '../../../golden/support/steps/dispatch';
import { pressKey } from '../../../golden/support/steps/interaction';
import { planningWarningDialog } from '../../../golden/support/steps/shared';
import { calendarTimeCorrectionDialog } from '../../../golden/support/steps/time-tracking';
import type { TestWorld } from '../../../golden/support/world';
import { moveCalendarBlockToMember } from '../a1-steps';
import { auditCheckpoint } from '../checkpoints';
import type { DialogOpener } from '../dialog-opener';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';

// Every calendar dialog of the inventory, opened on /kalender as the admin.
// Visits are seeded on a weekday a few days after the business date, so they
// are not started, show on the Plantafel and fall inside the dispatch panel's
// window. Recorded time sits on the previous business day.

/** The recorded work block the details, delete and correction dialogs open from. */
const TIME_BLOCK = { from: '06:20', to: '07:50' } as const;

/** The first weekday at least `minimumDays` after the date; the Plantafel may hide weekends. */
function weekdayAfter(dateIso: string, minimumDays: number): string {
  let date = shiftIsoDate(dateIso, minimumDays);
  while ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) date = shiftIsoDate(date, 1);
  return date;
}

/** The day the seeded visits are planned on. */
function visitDate(businessDate: string): string {
  return weekdayAfter(businessDate, 3);
}

/** The day the planning warning's move targets, three weeks after the visit (a weekday too). */
function warningTargetDate(businessDate: string): string {
  return shiftIsoDate(visitDate(businessDate), 21);
}

/** A planned visit for the employee at the hour on the visit day; returns its title. */
async function seedVisit(world: TestWorld, businessDate: string, hour: number): Promise<string> {
  return (await seedPlanningVisit(world, { date: visitDate(businessDate), hour })).title;
}

/** A visit without dispatch or commitment: the panel offers send, commitment and batch move. */
function plainVisit({ world, businessDate }: SurfaceContext): Promise<string> {
  return surfaceFixture(world, 'calendar.visit', () => seedVisit(world, businessDate, 10));
}

/** A visit with an active customer commitment, so its row offers the withdrawal. */
function committedVisit({ world, businessDate }: SurfaceContext): Promise<string> {
  return surfaceFixture(world, 'calendar.committed-visit', async () => {
    const date = visitDate(businessDate);
    const { jobNumber, title } = await seedPlanningVisit(world, { date, hour: 12 });
    const occurrence = (await getPlanningState(world.orgId, { jobNumber })).occurrences[0];
    if (!occurrence) throw new Error('The committed visit fixture has no occurrence.');
    await createAdminClient()
      .rpc('record_customer_commitment', {
        p_organization_id: world.orgId,
        p_actor_id: world.users.admin.id,
        p_occurrence_id: occurrence.id,
        p_committed_date: date,
        p_source: 'telefonisch',
      })
      .throwOnError();
    return title;
  });
}

/**
 * A visit whose move onto the target day draws a planning warning before
 * anything saves: the employee has a pending vacation request there, which
 * the assessment reads uncached (`pending_absence`). A closure day does not
 * work: the assessment reads closures through the cached organization
 * calendar, which a database seed never invalidates.
 */
function warningVisit({ world, businessDate }: SurfaceContext): Promise<string> {
  return surfaceFixture(world, 'calendar.pending-absence-visit', async () => {
    const employee = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await seedPendingVacationRequest({
      organizationId: world.orgId,
      employeeRecordId: employee.id,
      requestedBy: world.users.employee.id,
      startDate: warningTargetDate(businessDate),
      endDate: warningTargetDate(businessDate),
    });
    return seedVisit(world, businessDate, 14);
  });
}

/** A parked job with its context (reason, responsible admin, review date); returns its title. */
function parkedJob({ world, businessDate }: SurfaceContext): Promise<string> {
  return surfaceFixture(world, 'calendar.parked-job', async () => {
    const title = `Geparkter Kalenderauftrag ${world.runId}`;
    const jobId = await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber: `AUF-${world.runId}-KAL-PARK`,
      title,
    });
    const admin = createAdminClient();
    const { data: job } = await admin
      .from('jobs')
      .select('execution_version')
      .eq('id', jobId)
      .single()
      .throwOnError();
    const responsible = await getEmployeeRecordStateByUser(world.orgId, world.users.admin.id);
    await admin
      .rpc('park_work_target', {
        p_organization_id: world.orgId,
        p_actor_id: world.users.admin.id,
        p_target_type: 'job',
        p_target_id: jobId,
        p_expected_execution_version: job.execution_version,
        p_reason: 'material',
        p_details: 'Das Material ist bestellt.',
        p_responsible_employee_record_id: responsible.id,
        p_next_review_date: visitDate(businessDate),
      })
      .throwOnError();
    return title;
  });
}

/** An approved work block of the employee on the previous business day; returns its date. */
function recordedTime({ world, businessDate }: SurfaceContext): Promise<string> {
  return surfaceFixture(world, 'calendar.time-block', async () => {
    const date = shiftIsoDate(businessDate, -1);
    await ensureEmployedSince({
      organizationId: world.orgId,
      userIds: [world.users.employee.id, world.users.buero.id],
      date,
    });
    await seedApprovedManualInterval({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      date,
      from: TIME_BLOCK.from,
      to: TIME_BLOCK.to,
    });
    return date;
  });
}

function workBlock(page: Page, world: TestWorld): Locator {
  return calendarWorkTimeBlock(dayRow(page, world.users.employee.id), TIME_BLOCK.from, TIME_BLOCK.to);
}

/** The day view of the recorded block with the „Arbeitszeiten“ layer on; returns the block. */
async function showWorkBlock(context: SurfaceContext): Promise<Locator> {
  const { page, world } = context;
  await openCalendarView(page, await recordedTime(context), 'day');
  await calendarLayerCheckbox(page, 'work').check();
  const block = workBlock(page, world);
  await expect(block).toBeVisible();
  return block;
}

/** Opens the entry details of the recorded block with its keyboard path (Tab target, Enter). */
async function openWorkBlockDetails(context: SurfaceContext): Promise<Locator> {
  const block = await showWorkBlock(context);
  await block.focus();
  await pressKey(context.page, 'Enter');
  const details = timeEntryDetailsDialog(context.page);
  await expect(details).toBeVisible();
  return details;
}

/** A fixture value the trigger already seeded, for the synchronous focus target. */
function seededValue(name: `calendar.${string}`): string {
  const value = auditCheckpoint('surface.fixtures')?.[name];
  if (!value) throw new Error(`The surface fixture ${name} was not seeded.`);
  return value;
}

function visitCard(page: Page, title: string): Locator {
  return boardRowCards(page, title);
}

/** The Plantafel of the visit day; returns the visit's card. */
async function showVisitCard(context: SurfaceContext, title: string): Promise<Locator> {
  await openPlantafel(context.page, visitDate(context.businessDate));
  const card = visitCard(context.page, title);
  await expect(card).toBeVisible();
  return card;
}

/** Opens the card popover with the card's keyboard path (focus, Enter); returns the popover. */
async function openCardPopover(context: SurfaceContext, title: string): Promise<Locator> {
  const card = await showVisitCard(context, title);
  await card.focus();
  await pressKey(context.page, 'Enter');
  const popover = jobPopover(context.page);
  await expect(popover).toBeVisible();
  return popover;
}

/** The dispatch panel on the visit day; returns the visit's row. */
async function showDispatchRow(context: SurfaceContext, title: string): Promise<Locator> {
  await openDispatchPanel(context.page, visitDate(context.businessDate));
  const row = dispatchOccurrenceRow(context.page, title);
  await expect(row).toBeVisible();
  return row;
}

/** The Parkplatz panel; returns the parked job's card and title. */
async function showParkedCard(context: SurfaceContext): Promise<{ card: Locator; title: string }> {
  const title = await parkedJob(context);
  await openParkplatzPanel(context.page);
  const card = parkplatzCard(context.page, title);
  await expect(card).toBeVisible();
  return { card, title };
}

export const CALENDAR_OPENERS = {
  'calendar.entry-create': {
    trigger: async ({ page }) => {
      const button = calendarNewEntryButton(page);
      // The header action waits for hydration.
      await expect(button).toBeEnabled();
      return button;
    },
    layer: calendarEntryDialog,
  },
  'calendar.shortcuts': {
    trigger: async ({ page, businessDate }) => {
      // The help button lives in the Plantafel toolbar; the saved view may be another one.
      await openPlantafel(page, businessDate);
      return shortcutsButton(page);
    },
    layer: shortcutsDialog,
  },
  'calendar.entry-details': {
    // The trigger lives in the desktop layout (a table row, the board or the day timeline).
    opensOn: 'desktop',
    trigger: showWorkBlock,
    layer: timeEntryDetailsDialog,
  },
  'calendar.entry-delete': {
    // The trigger lives in the desktop layout (a table row, the board or the day timeline).
    opensOn: 'desktop',
    trigger: async (context) => timeEntryDeleteButton(await openWorkBlockDetails(context)),
    layer: timeEntryDeleteConfirmation,
    parents: (page) => [timeEntryDetailsDialog(page)],
  },
  'calendar.time-correction': {
    // The trigger lives in the desktop layout (a table row, the board or the day timeline).
    opensOn: 'desktop',
    // No keyboard path: only a pointer drag or resize of a recorded block opens
    // the correction (day-surface-drop.ts, use-month-surface.ts). The opener
    // performs the drag, which only drafts the correction, and hands the open
    // dialog to the audit, so Enter on it changes nothing.
    trigger: async (context) => {
      const { page, world } = context;
      const block = await showWorkBlock(context);
      await block.scrollIntoViewIfNeeded();
      await moveCalendarBlockToMember(
        page,
        block,
        `${world.users.buero.firstName} ${world.users.buero.lastName}`,
      );
      const dialog = calendarTimeCorrectionDialog(page);
      await expect(dialog).toBeVisible();
      return dialog;
    },
    layer: calendarTimeCorrectionDialog,
    returnFocus: ({ page, world }) => workBlock(page, world),
  },
  'calendar.occurrence-edit': {
    // The trigger lives in the desktop layout (a table row, the board or the day timeline).
    opensOn: 'desktop',
    trigger: async (context) =>
      occurrenceEditButton(await openCardPopover(context, await plainVisit(context))),
    layer: occurrenceEditDialog,
    parents: (page) => [jobPopover(page)],
  },
  'calendar.planning-warning': {
    // The trigger lives in the desktop layout (a table row, the board or the day timeline).
    opensOn: 'desktop',
    // The move form is the drag's keyboard path. The server refuses the move
    // onto the day of the pending absence with the warning before it writes;
    // Escape on the warning takes the move back.
    trigger: async (context) => {
      const popover = await openCardPopover(context, await warningVisit(context));
      await cardPopoverAction(popover, 'openMoveForm').click();
      await typeCardMoveDate(popover, warningTargetDate(context.businessDate));
      return cardPopoverAction(popover, 'move');
    },
    layer: planningWarningDialog,
    // The submit closes the popover with its form, so focus belongs on the card
    // again (werkflow-design, "Keyboard paths").
    returnFocus: ({ page }) => visitCard(page, seededValue('calendar.pending-absence-visit')),
  },
  'calendar.dispatch-issue': {
    trigger: async (context) => dispatchSendButton(await showDispatchRow(context, await plainVisit(context))),
    layer: dispatchIssueDialog,
  },
  'calendar.dispatch-commitment': {
    trigger: async (context) =>
      recordCommitmentButton(await showDispatchRow(context, await plainVisit(context))),
    layer: commitmentDialog,
  },
  'calendar.dispatch-reason': {
    trigger: async (context) =>
      rowReasonAction(await showDispatchRow(context, await committedVisit(context)), 'withdrawCommitment'),
    layer: (page) => dispatchReasonDialog(page, 'withdrawCommitment'),
  },
  'calendar.dispatch-review': {
    // The preview is read-only; „Jetzt verschieben“ inside it is never pressed.
    trigger: async (context) => {
      const { page, world } = context;
      const row = await showDispatchRow(context, await plainVisit(context));
      const panel = dispatchPanel(page);
      await batchModeToggle(panel).click();
      await row.getByRole('checkbox').check();
      await batchReasonField(panel).fill(`Umplanung der Woche ${world.runId}`);
      return checkBatchImpactButton(panel);
    },
    layer: batchPreviewDialog,
  },
  'calendar.parking-context': {
    trigger: async (context) => {
      const { card, title } = await showParkedCard(context);
      return parkplatzEditContextButton(card, title);
    },
    layer: parkingContextDialog,
  },
  'calendar.schedule-parked': {
    trigger: async (context) => {
      const { card, title } = await showParkedCard(context);
      return parkplatzScheduleButton(card, title);
    },
    layer: scheduleParkedDialog,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
