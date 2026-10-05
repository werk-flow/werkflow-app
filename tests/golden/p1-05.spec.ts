import { expect, test } from './support/fixtures';
import {
  getEmployeeRecordStateByUser,
  getLatestResponsibilityConfigurationState,
  setResponsibilityHolders,
} from './support/db/personnel';
import { getLatestManualTimeEntryState } from './support/db/time-tracking';
import {
  confirmResponsibilityPreview,
  createResponsibilityDelegationViaSettings,
  endResponsibilityDelegationViaSettings,
  previewResponsibilityChange,
} from './support/steps/personnel';
import {
  approvePendingTimeEntry,
  createOwnManualTimeEntry,
  expectExpiredResponsibilityDeniedAtAction,
  expectMemberRemovalBlockedByResponsibility,
  expectPendingTimeApprovalHidden,
  expectPendingTimeApprovalVisible,
  expectTimeApprovalsUnavailable,
  openTimeApprovals,
} from './support/steps/time-tracking';
import type { TestRole, TestWorld } from './support/world';

// P1-05 — Scoped responsibilities and substitution (@P1-05). Every test pins
// the time-approval holders it builds on through the product's configuration
// function, so no test inherits another test's configuration. Which assignment
// rows each role can read and the owner protection are database rules
// (supabase/tests/people_boundaries.sql); what an affected person and Büro see
// in their own settings is the A3 audit's role variant.

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

async function pinTimeApprovalHolders(
  world: TestWorld,
  holders: readonly TestRole[] | 'role_default',
): Promise<void> {
  const holderEmployeeRecordIds =
    holders === 'role_default'
      ? holders
      : await Promise.all(
          holders.map(
            async (role) => (await getEmployeeRecordStateByUser(world.orgId, world.users[role].id)).id,
          ),
        );
  await setResponsibilityHolders({
    organizationId: world.orgId,
    ownerUserId: world.users.admin.id,
    responsibility: 'time_approval',
    holderEmployeeRecordIds,
  });
}

test.describe('P1-05 Verantwortlichkeiten und Vertretung @P1-05', () => {
  test('Die Vorschau zeigt die Wirkung, bevor die Verantwortung gespeichert wird', async ({
    adminPage,
    world,
  }) => {
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await pinTimeApprovalHolders(world, 'role_default');
    const before = await getLatestResponsibilityConfigurationState(world.orgId, 'time_approval');

    await previewResponsibilityChange(adminPage, {
      responsibility: 'time_approval',
      selectedNames: [adminName, employeeName],
      gainedNames: [employeeName],
      lostNames: [bueroName],
    });

    const duringPreview = await getLatestResponsibilityConfigurationState(world.orgId, 'time_approval');
    expect(duringPreview.id).toBe(before.id);

    await confirmResponsibilityPreview(adminPage);
    const after = await getLatestResponsibilityConfigurationState(world.orgId, 'time_approval');
    const [adminRecord, employeeRecord] = await Promise.all([
      getEmployeeRecordStateByUser(world.orgId, world.users.admin.id),
      getEmployeeRecordStateByUser(world.orgId, world.users.employee.id),
    ]);
    expect(after.id).not.toBe(before.id);
    expect(after.mode).toBe('selected');
    expect(after.holderEmployeeRecordIds).toEqual([adminRecord.id, employeeRecord.id].sort());
  });

  test('Eine gezielt verantwortliche Person kann freigeben', async ({
    bueroPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    await pinTimeApprovalHolders(world, ['admin', 'employee']);

    await createOwnManualTimeEntry(bueroPage, {
      memberName: bueroName,
      dateDigits: toDatePickerDigits(shiftIsoDate(businessDate, -1)),
      clockInDigits: '0600',
      clockOutDigits: '0700',
    });
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)).status).toBe('pending');

    await openTimeApprovals(employeePage);
    await expectPendingTimeApprovalVisible(employeePage, world.users.buero.id);
    await approvePendingTimeEntry(employeePage, world.users.buero.id);
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)).status).toBe('approved');
  });

  test('Eigene Einträge bleiben für Verantwortliche im Vier-Augen-Prinzip', async ({
    adminPage,
    bueroPage,
    businessDate,
    employeePage,
    world,
  }) => {
    await pinTimeApprovalHolders(world, ['admin', 'employee']);

    await createOwnManualTimeEntry(employeePage, {
      dateDigits: toDatePickerDigits(shiftIsoDate(businessDate, -1)),
      clockInDigits: '0600',
      clockOutDigits: '0700',
    });
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.employee.id)).status).toBe(
      'pending',
    );
    await expectTimeApprovalsUnavailable(bueroPage);
    await openTimeApprovals(employeePage);
    await expectPendingTimeApprovalHidden(employeePage, world.users.employee.id);

    await openTimeApprovals(adminPage);
    await expectPendingTimeApprovalVisible(adminPage, world.users.employee.id);
    await approvePendingTimeEntry(adminPage, world.users.employee.id);
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.employee.id)).status).toBe(
      'approved',
    );
  });

  test('Eine Vertretung gilt im Fenster und verliert die Freigabe nach dem Ende am Aktionspunkt', async ({
    adminPage,
    bueroPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await pinTimeApprovalHolders(world, ['admin', 'buero']);

    await createResponsibilityDelegationViaSettings(adminPage, {
      responsibility: 'time_approval',
      delegatorName: adminName,
      substituteName: employeeName,
      validFromDigits: toDatePickerDigits(businessDate),
      validUntilDigits: toDatePickerDigits(shiftIsoDate(businessDate, 1)),
    });

    await createOwnManualTimeEntry(bueroPage, {
      memberName: bueroName,
      dateDigits: toDatePickerDigits(shiftIsoDate(businessDate, -1)),
      clockInDigits: '0800',
      clockOutDigits: '0900',
    });
    await openTimeApprovals(employeePage);
    await expectPendingTimeApprovalVisible(employeePage, world.users.buero.id);

    // End the substitution in the admin session while the employee still has
    // the stale approval card. The click must be denied by action-time
    // resolution, not merely disappear after a UI refresh.
    await endResponsibilityDelegationViaSettings(adminPage, 'time_approval', employeeName);
    await expectExpiredResponsibilityDeniedAtAction(employeePage, world.users.buero.id);
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)).status).toBe('pending');

    await openTimeApprovals(adminPage);
    await approvePendingTimeEntry(adminPage, world.users.buero.id);
  });

  test('Der letzte ausgewählte Verantwortliche lässt sich nicht entfernen', async ({ adminPage, world }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await pinTimeApprovalHolders(world, ['employee']);

    await expectMemberRemovalBlockedByResponsibility(adminPage, employeeName);
  });
});
