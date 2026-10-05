import { expect, test } from '../support/fixtures';
import { previousTestBusinessMonth } from '../../../lib/testing/runner/business-date';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { prepareOutsidePeriodCorrection } from '../support/time-correction-fixtures';
import { captureResponsiveSection } from '../support/visual-evidence';
import {
  openRemainingP123Accounts,
  prepareP123PersonnelPrerequisites,
} from '../../golden/support/db/personnel';
import {
  closeP123LegacySequence,
  confirmP123DefaultPolicy,
  getP123State,
  seedP123UnclosedLegacySequence,
} from '../../golden/support/db/time-tracking';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { FINDING_LABELS } from '../../../lib/time-accounts/presentation';
import { textInDom, visibleText } from '../../golden/support/steps/shared';
import {
  assignTimePolicy,
  closeMonthButton,
  createExceptionTimePolicy,
  monthlyResultListRow,
  monthlyResults,
  monthlyResultTerms,
  policyVersionLabel,
  preparePeriodMonth,
  rejectTimeAccountAdjustment,
  requestTimeAccountAdjustment,
  TIME_ACCOUNT_COPY,
  timeAccountSettings,
} from '../../golden/support/steps/time-tracking';

// Golden P1-23 walks the configured, closed, exported and reopened month. This
// audit keeps the employee exception, the Büro adjustment request with its
// rejection, and the close blocker of an incomplete legacy sequence. Ledger
// effects, close gates and tenant isolation are proven in
// supabase/tests/p1_23_time_accounts.sql and lib/time-accounts/*.test.ts.

async function prepareConfiguredMonth(
  world: { orgId: string; users: { admin: { id: string } } },
  periodStart: string,
): Promise<Array<{ id: string; userId: string | null }>> {
  const employees = await prepareP123PersonnelPrerequisites({
    organizationId: world.orgId,
    actorUserId: world.users.admin.id,
    validFrom: periodStart,
  });
  await confirmP123DefaultPolicy({
    organizationId: world.orgId,
    actorUserId: world.users.admin.id,
    effectiveFrom: periodStart,
  });
  await openRemainingP123Accounts({
    organizationId: world.orgId,
    actorUserId: world.users.admin.id,
    openedOn: periodStart,
  });
  return employees;
}

test.describe('P1-23 time-account audit @AUDIT-W2-P1-23 @AUDIT-W2', () => {
  test('assigns an employee exception and rejects a Büro adjustment request', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const period = previousTestBusinessMonth();
    await prepareConfiguredMonth(world, period.start);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const exceptionPolicyName = `Sonderregel ${world.runId}`;
    await adminPage.goto('/zeiterfassung/einstellungen');
    const settings = timeAccountSettings(adminPage);

    await test.step('The admin creates an exception policy and assigns it to the employee', async () => {
      await createExceptionTimePolicy(settings, { name: exceptionPolicyName, validFrom: period.start });
      const exceptionPolicy = policyVersionLabel(exceptionPolicyName, 1);
      await expect(visibleText(settings, exceptionPolicy)).toBeVisible();
      await assignTimePolicy(settings, employeeName, {
        policyLabel: exceptionPolicy,
        validFrom: period.start,
      });
      await expect
        .poll(async () => (await getP123State(world.orgId)).policyAssignments.length, { timeout: 20_000 })
        .toBe(1);
    });

    await test.step('Büro requests an adjustment and the admin rejects it', async () => {
      await bueroPage.goto('/zeiterfassung/einstellungen');
      const bueroSettings = timeAccountSettings(bueroPage);
      await expect(visibleText(bueroSettings, TIME_ACCOUNT_COPY.bueroMayRequest)).toBeVisible();
      await requestTimeAccountAdjustment(bueroSettings, employeeName, {
        minutes: 45,
        reason: 'Audit: nicht übernehmen',
        effectiveDate: ownedBerlinDateAtOffset('p1-23', 120),
      });
      await expect
        .poll(async () => (await getP123State(world.orgId)).adjustmentRequests.length, { timeout: 20_000 })
        .toBe(1);

      await adminPage.reload();
      await rejectTimeAccountAdjustment(settings, employeeName, 'Audit-Ablehnung');
      await expect
        .poll(async () => (await getP123State(world.orgId)).adjustmentRequests[0]?.status, {
          timeout: 20_000,
        })
        .toBe('rejected');
    });
  });

  test('blocks close for an incomplete historical sequence and clears the finding after recalculation', async ({
    adminPage,
    world,
  }, testInfo) => {
    const period = previousTestBusinessMonth();
    await prepareConfiguredMonth(world, period.start);
    // An approved correction outside the period must not close the in-period sequence.
    const correctionReason = `P123 outside-period correction ${world.runId}`;
    await prepareOutsidePeriodCorrection(world, {
      date: ownedBerlinDateAtOffset('p1-23', 121),
      reason: correctionReason,
    });
    await seedP123UnclosedLegacySequence({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      startedAt: `${period.start}T06:00:00.000Z`,
    });

    const periodId =
      await test.step('Preparing the month shows the missing clock and blocks the close', async () => {
        const calculationsBefore = (await getP123State(world.orgId)).calculations.length;
        await preparePeriodMonth(adminPage, period.month);
        await expect
          .poll(async () => (await getP123State(world.orgId)).calculations.length, { timeout: 20_000 })
          .toBeGreaterThan(calculationsBefore);
        const preparedState = await getP123State(world.orgId);
        const preparedPeriod = expectDefined(
          preparedState.periods.find((candidate) => candidate.period_start_date === period.start),
          'the prepared period',
        );
        expect(
          preparedState.findings.some(
            (finding) =>
              finding.calculation_id === preparedPeriod.current_calculation_id &&
              finding.finding_kind === 'missing_clock',
          ),
        ).toBe(true);
        await adminPage.goto(`/zeiterfassung/perioden/${preparedPeriod.id}`);
        await expect(visibleText(adminPage, FINDING_LABELS.missing_clock)).toBeVisible();
        await expect(closeMonthButton(adminPage)).toBeDisabled();
        return preparedPeriod.id;
      });

    await test.step('The repaired source clears the finding on recalculation', async () => {
      await closeP123LegacySequence({
        organizationId: world.orgId,
        userId: world.users.employee.id,
        endedAt: `${period.start}T08:00:00.000Z`,
      });
      const calculationsBefore = (await getP123State(world.orgId)).calculations.length;
      await preparePeriodMonth(adminPage, period.month);
      await expect
        .poll(async () => (await getP123State(world.orgId)).calculations.length, { timeout: 20_000 })
        .toBeGreaterThan(calculationsBefore);
      await adminPage.goto(`/zeiterfassung/perioden/${periodId}`);
      await expect(textInDom(adminPage, FINDING_LABELS.missing_clock)).toHaveCount(0);
      const state = await getP123State(world.orgId);
      const recalculatedPeriod = expectDefined(
        state.periods.find((candidate) => candidate.id === periodId),
        'the recalculated period',
      );
      expect(
        state.findings.filter(
          (finding) =>
            finding.calculation_id === recalculatedPeriod.current_calculation_id &&
            finding.finding_kind === 'missing_clock',
        ),
      ).toHaveLength(0);
    });

    await test.step('The monthly results fit every width', async () => {
      const results = monthlyResults(adminPage);
      const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
      await captureResponsiveSection(
        adminPage,
        testInfo,
        results,
        'p123-monthly-results-populated',
        async (width) => {
          if (width >= 768) {
            await expect(results.locator('table:visible')).toBeVisible();
            await expect(results.getByRole('row').filter({ hasText: employeeName })).toBeVisible();
            return;
          }
          await expect(results.locator('table:visible')).toHaveCount(0);
          const mobileResult = monthlyResultListRow(results, employeeName);
          await expect(mobileResult).toBeVisible();
          for (const term of monthlyResultTerms(mobileResult)) {
            await expect(term).toBeVisible();
          }
          expect(
            await results.evaluate(
              (section) =>
                [section, ...section.querySelectorAll<HTMLElement>('*')].filter(
                  (element) =>
                    element.getClientRects().length > 0 && element.scrollWidth > element.clientWidth + 1,
                ).length,
            ),
          ).toBe(0);
          return mobileResult;
        },
      );
    });
  });
});
