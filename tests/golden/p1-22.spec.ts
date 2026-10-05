import { createAdminClient } from './support/db/shared';
import {
  calendarLayerCheckbox,
  calendarViewTab,
  calendarWorkTimeBlock,
  dayRow,
  dayTimeline,
  trailingResizeHandle,
} from './support/plantafel';
import { resolveBerlinWallTime } from '../../lib/planning/date-time';
import { TIME_CORRECTION_STATUS_LABELS } from '../../lib/time-corrections/types';
import { expectDefined } from '../../lib/testing/spec-support/expect-defined';
import { expect, test } from './support/fixtures';
import { getTimeCorrectionState } from './support/db/time-tracking';
import { berlinDateAtOffset } from './support/date-ownership';
import { dismissDialog } from './support/steps/interaction';
import { confirmResponsibilityPreview, previewResponsibilityChange } from './support/steps/personnel';
import { retryDialogTransaction, textInDom, visibleText } from './support/steps/shared';
import {
  calendarEntryDialog,
  calendarNewEntryButton,
  entryDialogTab,
  planningEmployeePicker,
} from './support/steps/calendar';
import {
  approveCorrectionButton,
  calendarTimeCorrectionDialog,
  fillMissedTime,
  openMissedTimeDialog,
  submitCalendarTimeCorrection,
  TIME_CORRECTION_COPY,
  timeCorrectionCard,
  timeCorrectionDialog,
  timeCorrectionSaveButton,
  timeCorrectionStatus,
  timeHistoryTab,
} from './support/steps/time-tracking';

// The browser walks the correction as a user does. Applications, revisions,
// events, source preservation, batch atomicity and tenant isolation are proven
// in supabase/tests/p1_22_time_corrections.sql.

test.describe('P1-22 consistent time corrections @P1-22', () => {
  test('keeps a correction provisional, then applies one attributable second-person decision @P1-22-stage-submit @P1-22-stage-approve @READINESS', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const reason = `Vergessene Arbeitszeit ${world.runId}`;
    const date = berlinDateAtOffset(1);
    const requestId = await test.step('The employee submits a correction for review', async () => {
      await previewResponsibilityChange(adminPage, {
        responsibility: 'time_approval',
        selectedNames: [
          `${world.users.admin.firstName} ${world.users.admin.lastName}`,
          `${world.users.employee.firstName} ${world.users.employee.lastName}`,
        ],
      });
      await confirmResponsibilityPreview(adminPage);
      await employeePage.goto('/zeiterfassung?tab=history');
      await expect(timeHistoryTab(employeePage)).toHaveAttribute('data-state', 'active');
      const dialog = timeCorrectionDialog(employeePage);
      await retryDialogTransaction({
        dialog,
        open: async () => {
          await openMissedTimeDialog(employeePage, 'P1-22 time correction form options');
        },
        prepare: () => fillMissedTime(employeePage, dialog, { date, from: '08:00', to: '10:00', reason }),
        submit: () => timeCorrectionSaveButton(dialog).click({ timeout: 5_000 }),
      });
      await expect(visibleText(employeePage, TIME_CORRECTION_COPY.submittedForReview)).toBeVisible();
      await expect(visibleText(employeePage, reason)).toBeVisible();

      const state = await getTimeCorrectionState(world.orgId);
      const request = expectDefined(
        state.requests.find(
          (row) =>
            row.requested_by === world.users.employee.id &&
            state.revisions.some((revision) => revision.request_id === row.id && revision.reason === reason),
        ),
        'the submitted correction',
      );
      expect(request).toMatchObject({ status: 'submitted', current_revision: 1 });
      await expect(
        timeCorrectionStatus(timeCorrectionCard(employeePage, request.id), 'submitted'),
      ).toBeVisible();
      return request.id;
    });

    await test.step('A second person reviews before and after and approves', async () => {
      await adminPage.goto('/zeiterfassung?tab=approvals');
      const card = timeCorrectionCard(adminPage, requestId);
      await expect(card.getByText(TIME_CORRECTION_COPY.before)).toBeVisible({ timeout: 30_000 });
      await expect(card.getByText(TIME_CORRECTION_COPY.proposed)).toBeVisible();
      await approveCorrectionButton(card).click();
      // The card leaves with the click; the banner confirms the decision before the persisted row is read.
      await expect(visibleText(adminPage, TIME_CORRECTION_COPY.decisionSaved)).toBeVisible({
        timeout: 20_000,
      });
      await expect(adminPage.getByTestId(`time-correction-${requestId}`)).toHaveCount(0);
      expect(
        (await getTimeCorrectionState(world.orgId)).requests.find((row) => row.id === requestId)?.status,
      ).toBe('approved');
    });

    await test.step('The employee sees the decision in the history', async () => {
      await employeePage.goto('/zeiterfassung?tab=history');
      const historyCard = timeCorrectionCard(employeePage, requestId);
      await expect(timeCorrectionStatus(historyCard, 'approved')).toBeVisible();
      await expect(textInDom(employeePage, TIME_CORRECTION_STATUS_LABELS.submitted)).toHaveCount(0);
    });
  });

  test('calendar resize submits one audited correction and survives reload @P1-22-calendar-correction', async ({
    adminPage,
    world,
  }) => {
    const date = berlinDateAtOffset(-2);
    const start = expectDefined(resolveBerlinWallTime(`${date}T08:00`), 'the Berlin start of the fixture');
    const end = expectDefined(resolveBerlinWallTime(`${date}T09:00`), 'the Berlin end of the fixture');
    const { error } = await createAdminClient()
      .from('time_entries')
      .insert(
        [start, end].map((boundary, index) => ({
          organization_id: world.orgId,
          user_id: world.users.employee.id,
          entry_type: index === 0 ? ('clock_in' as const) : ('clock_out' as const),
          timestamp: boundary.instant.toISOString(),
          status: 'approved' as const,
          is_manual: true,
        })),
      );
    if (error) throw new Error(`Correction fixture failed: ${error.message}`);
    await adminPage.goto(`/kalender?date=${date}`);
    await calendarNewEntryButton(adminPage).click();
    const creation = calendarEntryDialog(adminPage);
    await expect(entryDialogTab(creation, 'plan')).toBeVisible();
    await expect(planningEmployeePicker(creation)).toBeEnabled();
    await dismissDialog(creation);
    await expect(creation).toHaveCount(0);
    await calendarViewTab(adminPage, 'day').click();
    await calendarLayerCheckbox(adminPage, 'work').check();
    const row = dayRow(adminPage, world.users.employee.id);
    const block = calendarWorkTimeBlock(row, '08:00', '09:00');
    await expect(block).toBeVisible();
    const handle = trailingResizeHandle(block);
    const bounds = expectDefined(await handle.boundingBox(), 'the resize handle geometry');
    const timeline = expectDefined(await dayTimeline(row).boundingBox(), 'the day timeline geometry');
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await adminPage.mouse.move(x, y);
    await adminPage.mouse.down();
    await adminPage.mouse.move(x + 8, y, { steps: 2 });
    await adminPage.mouse.move(x + timeline.width / 48, y, { steps: 6 });
    await adminPage.mouse.up();
    const dialog = calendarTimeCorrectionDialog(adminPage);
    await expect(dialog).toBeVisible();
    const reason = `Kalenderkorrektur ${world.runId}`;
    await submitCalendarTimeCorrection(dialog, reason);
    await expect(dialog).toHaveCount(0);
    const state = await getTimeCorrectionState(world.orgId);
    const revision = expectDefined(
      state.revisions.find((item) => item.reason === reason),
      'the calendar correction revision',
    );
    expect(state.applications.filter((item) => item.request_id === revision.request_id)).toHaveLength(1);
    await adminPage.reload();
    await calendarLayerCheckbox(adminPage, 'work').check();
    await expect(calendarWorkTimeBlock(row, '08:00', '09:30')).toBeVisible();
  });
});
