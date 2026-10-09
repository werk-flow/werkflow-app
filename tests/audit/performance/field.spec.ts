import { expect, test } from '../support/fixtures';
import {
  expectScenarioLiveWithin,
  expectUsableWithin,
  watchRealtimeSignals,
} from '../../golden/support/scenario-measurement';
import {
  clockStateTarget,
  pendingClockActionTarget,
  timeEntryTarget,
} from '../../golden/support/browser-observation';
import { berlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  getTimeCaptureState,
  getTimeEntryStatuses,
  seedPendingManualInterval,
} from '../../golden/support/db/time-tracking';
import { expectBannerAfter } from '../../golden/support/steps/shared';
import { openTimeApprovals } from '../../golden/support/steps/time-tracking';
import { ensureTypicalProfile } from '../support/performance-profile';
import {
  clockSheetAction,
  createPerformancePage,
  openClockSheet,
  pendingApprovalCard,
  settleLiveShell,
} from '../support/performance-steps';

// The field worker's clock and the office's time approval, measured against
// the typical profile in this group's own organization. Each scenario id is
// registered in lib/testing/measured-scenarios.ts.

test.describe('Performance profile field work @AUDIT-PERFORMANCE', () => {
  test('PERF-F1 the clock acknowledges a tap at once and confirms the saved state @AUDIT-PERFORMANCE-F1', async ({
    browser,
    baseURL,
    world,
  }) => {
    await ensureTypicalProfile(world);
    const employee = world.users.employee;
    const sessionsBefore = (await getTimeCaptureState(world.orgId, employee.id)).sessions.length;
    for (const sample of [1, 2, 3]) {
      const { dispose, page } = await createPerformancePage({
        browser,
        baseUrl: baseURL,
        world,
        role: 'employee',
      });
      try {
        await test.step(`Declared clock sample ${sample}`, async () => {
          await page.goto('/dashboard');
          await expect(clockStateTarget(page, 'out').locator).toBeVisible();
          await settleLiveShell(page);

          // Acknowledgement: the pressed action shows its pending state before the server answers.
          await openClockSheet(page, false);
          await expectUsableWithin('time.clock-in.visible', {
            page,
            trigger: () => clockSheetAction(page, 'Arbeit starten').click(),
            usable: pendingClockActionTarget(page, 'Arbeit starten'),
          });
          await expect(clockStateTarget(page, 'in').locator).toBeVisible();
          await openClockSheet(page, true);
          await expectUsableWithin('time.clock-out.visible', {
            page,
            trigger: () => clockSheetAction(page, 'Erfassung beenden').click(),
            usable: pendingClockActionTarget(page, 'Erfassung beenden'),
          });
          await expect(clockStateTarget(page, 'out').locator).toBeVisible();

          // Confirmation: the clock shows the state the server saved.
          await openClockSheet(page, false);
          await expectUsableWithin('time.clock-in.settled', {
            page,
            trigger: () => clockSheetAction(page, 'Arbeit starten').click(),
            usable: clockStateTarget(page, 'in'),
          });
          await openClockSheet(page, true);
          await expectUsableWithin('time.clock-out.settled', {
            page,
            trigger: () => clockSheetAction(page, 'Erfassung beenden').click(),
            usable: clockStateTarget(page, 'out'),
          });
        });
      } finally {
        await dispose();
      }
      // Each sample saved two closed sessions.
      const { sessions } = await getTimeCaptureState(world.orgId, employee.id);
      expect(sessions.length).toBe(sessionsBefore + sample * 2);
      expect(sessions.every((session) => session.ended_at !== null)).toBe(true);
    }
  });

  /* eslint-disable playwright-spec/no-copy-in-spec-locator -- measured scenario time.approval.cross-session: its locators change only in the run that recalibrates its reference (docs/technical/testing.md#deadlines-and-measured-scenarios) */
  test("PERF-F2 an approval reaches the employee's open history within the live target @AUDIT-PERFORMANCE-F2", async ({
    bueroPage,
    employeePage,
    world,
  }) => {
    await ensureTypicalProfile(world);
    const employee = world.users.employee;
    // Three own submissions on separate past days; their times name each approval card.
    const submissions = await Promise.all(
      [1, 2, 3].map(async (sample) => {
        const from = `15:1${sample}`;
        const to = `16:3${sample}`;
        const ids = await seedPendingManualInterval({
          organizationId: world.orgId,
          userId: employee.id,
          date: berlinDateAtOffset(-1 - sample),
          from,
          to,
        });
        return { ...ids, label: `${from} – ${to}` };
      }),
    );
    watchRealtimeSignals(employeePage);
    await employeePage.goto('/zeiterfassung?tab=history');
    await settleLiveShell(employeePage);
    await openTimeApprovals(bueroPage);
    await settleLiveShell(bueroPage);
    for (const submission of submissions) {
      await expect(timeEntryTarget(employeePage, submission.clockInId, 'pending').locator).toBeVisible();
      const card = pendingApprovalCard(bueroPage, employee.id, submission.label);
      await expect(card).toHaveCount(1);
      await expectScenarioLiveWithin(
        'time.approval.cross-session',
        timeEntryTarget(employeePage, submission.clockInId, 'approved'),
        {
          mutation: async (beforeSubmit) => {
            await beforeSubmit();
            await expectBannerAfter(bueroPage, 'Der Zeiteintrag wurde genehmigt.', () =>
              card.getByTitle('Genehmigen - Eintrag bleibt erhalten').click(),
            );
          },
        },
      );
      expect(await getTimeEntryStatuses(world.orgId, [submission.clockInId, submission.clockOutId])).toEqual([
        'approved',
        'approved',
      ]);
    }
  });
  /* eslint-enable playwright-spec/no-copy-in-spec-locator -- the measured test ends here */
});
