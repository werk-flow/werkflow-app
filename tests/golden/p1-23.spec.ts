import { expect, test } from './support/fixtures';
import { previousTestBusinessMonth, testBusinessDate } from '../../lib/testing/runner/business-date';
import { expectDefined } from '../../lib/testing/spec-support/expect-defined';
import { PERIOD_STATE_LABELS } from '../../lib/time-accounts/presentation';
import {
  getEmployeeRecordStateByUser,
  getLatestResponsibilityConfigurationState,
  openRemainingP123Accounts,
  prepareP123PersonnelPrerequisites,
} from './support/db/personnel';
import { getP123State } from './support/db/time-tracking';
import { visibleText } from './support/steps/shared';
import {
  approveFindingButton,
  closeMonthButton,
  confirmDefaultMappingButton,
  confirmDefaultTimePolicy,
  correctOpeningDate,
  createPayrollExportButton,
  currentMappingText,
  expectNoApproveFindingButton,
  fillOpeningBalance,
  openAccountButton,
  openingDateCorrectionText,
  payrollExportText,
  periodFindingsHeading,
  preparePeriodMonth,
  reopenPeriod,
  TIME_ACCOUNT_COPY,
  timeAccountHeadings,
  timeAccountNavigation,
  timeAccountSettings,
  timeAccountVersionText,
} from './support/steps/time-tracking';

// One connected payroll month: configure (with an account opened on the wrong
// day and corrected), close and export, read as the employee, reopen. Ledger arithmetic, the complete-workforce rule, immutable
// close versions, retained history on reopen and tenant isolation are proven in
// supabase/tests/p1_23_time_accounts.sql and lib/time-accounts/*.test.ts.

test.describe('P1-23 time accounts and payroll handoff @P1-23 @GG-07', () => {
  test('configures, closes and exports a month, shows the employee account and reopens with history @P1-23-stage-configure @P1-23-stage-close @P1-23-stage-visibility @P1-23-stage-reopen', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const period = previousTestBusinessMonth();

    await test.step('Configure a dated policy, explicit opening balances and the payroll mapping', async () => {
      const employees = await prepareP123PersonnelPrerequisites({
        organizationId: world.orgId,
        actorUserId: world.users.admin.id,
        validFrom: period.start,
      });
      await adminPage.goto('/zeiterfassung/einstellungen');
      const settings = timeAccountSettings(adminPage);
      await expect(settings).toBeVisible();

      await confirmDefaultTimePolicy(settings, period.start);
      await expect(visibleText(settings, timeAccountVersionText(1))).toBeVisible();

      // Opened with today's date, the account would block the month to close
      // with „Zeitkonto fehlt“; the correction moves it to the month's start.
      const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
      const wrongOpeningDate = testBusinessDate();
      await fillOpeningBalance(settings, adminName, { openedOn: wrongOpeningDate, minutes: 15 });
      const openAccount = openAccountButton(settings, adminName);
      await openAccount.click();
      // The form disappears only after the Server Action commits and its
      // authoritative settings read no longer lists this account as missing.
      await expect(openAccount).toHaveCount(0);
      const correctionReason = 'Konto ab dem abzuschließenden Monat führen';
      await correctOpeningDate(settings, adminName, { openedOn: period.start, reason: correctionReason });
      await expect(
        visibleText(settings, openingDateCorrectionText(wrongOpeningDate, period.start, correctionReason)),
      ).toBeVisible();
      await openRemainingP123Accounts({
        organizationId: world.orgId,
        actorUserId: world.users.admin.id,
        openedOn: period.start,
      });
      await adminPage.reload();
      await expect(settings.getByText(TIME_ACCOUNT_COPY.allAccountsOpen)).toBeVisible();

      await confirmDefaultMappingButton(settings).click();
      await expect(settings.getByText(currentMappingText(1))).toBeVisible();

      const state = await getP123State(world.orgId);
      expect(state.accounts).toHaveLength(employees.length);
      expect(state.accounts.map((account) => account.opened_on)).toEqual(employees.map(() => period.start));
      expect(state.mappings).toHaveLength(1);
    });

    const periodId = await test.step('Prepare, approve the findings, close and create the ZIP', async () => {
      await preparePeriodMonth(adminPage, period.month);
      await adminPage.waitForURL(/\/zeiterfassung\/perioden\/[0-9a-f-]{36}$/);
      await expect(periodFindingsHeading(adminPage)).toBeVisible();
      const preparedState = await getP123State(world.orgId);
      const preparedPeriod = expectDefined(
        preparedState.periods.find((candidate) => candidate.period_start_date === period.start),
        'the prepared period',
      );
      const approvalFindingIds = preparedState.findings
        .filter(
          (finding) =>
            finding.calculation_id === preparedPeriod.current_calculation_id &&
            finding.severity === 'approval_required',
        )
        .map((finding) => finding.id);
      for (const findingId of approvalFindingIds) {
        await approveFindingButton(adminPage, findingId).click();
        await expectNoApproveFindingButton(adminPage, findingId);
      }
      await closeMonthButton(adminPage).click();
      await expect(visibleText(adminPage, PERIOD_STATE_LABELS.closed)).toBeVisible();
      await createPayrollExportButton(adminPage).click();
      await expect(visibleText(adminPage, payrollExportText(1, 'ready'))).toBeVisible();

      const state = await getP123State(world.orgId);
      expect(state.periods.find((candidate) => candidate.id === preparedPeriod.id)?.state).toBe('closed');
      expect(state.exports.filter((item) => item.period_id === preparedPeriod.id)).toMatchObject([
        { state: 'ready', version: 1 },
      ]);
      // The closed month now depends on every opening date: none is offered for correction.
      await adminPage.goto('/zeiterfassung/einstellungen');
      await expect(
        visibleText(timeAccountSettings(adminPage), TIME_ACCOUNT_COPY.openingDateLocked),
      ).toBeVisible();
      await expect(
        timeAccountSettings(adminPage).getByRole('button', { name: TIME_ACCOUNT_COPY.correctOpeningDate }),
      ).toHaveCount(0);
      return preparedPeriod.id;
    });

    await test.step('The employee reads the account with responsibility-aware navigation', async () => {
      await employeePage.goto('/zeiterfassung/zeitkonto');
      const headings = timeAccountHeadings(employeePage);
      await expect(headings.account).toBeVisible();
      await expect(headings.monthlyCloses).toBeVisible();
      await expect(visibleText(employeePage, PERIOD_STATE_LABELS.closed)).toBeVisible();
      const [employeeRecord, timeApproval] = await Promise.all([
        getEmployeeRecordStateByUser(world.orgId, world.users.employee.id),
        getLatestResponsibilityConfigurationState(world.orgId, 'time_approval'),
      ]);
      const isEffectiveTimeApprover =
        timeApproval.mode === 'selected' && timeApproval.holderEmployeeRecordIds.includes(employeeRecord.id);
      const navigation = timeAccountNavigation(employeePage);
      await expect(navigation.periods).toHaveCount(isEffectiveTimeApprover ? 1 : 0);
      await expect(navigation.rules).toHaveCount(0);
    });

    await test.step('Reopen with a reason', async () => {
      await adminPage.goto(`/zeiterfassung/perioden/${periodId}`);
      await reopenPeriod(adminPage, 'Korrektur für Folgelauf erforderlich');
      await expect
        .poll(
          async () =>
            (await getP123State(world.orgId)).periods.find((candidate) => candidate.id === periodId)?.state,
        )
        .toBe('reopened');
      await adminPage.reload();
      await expect(visibleText(adminPage, PERIOD_STATE_LABELS.reopened)).toBeVisible();
    });
  });
});
