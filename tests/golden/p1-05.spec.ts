import { expect, test } from './support/fixtures';
import {
  expectOwnerRoleMutationRejected,
  getEmployeeRecordStateByUser,
  getLatestManualTimeEntryState,
  getLatestResponsibilityConfigurationState,
  getVisibleResponsibilityEmployeeRecordIdsAs,
} from './support/db';
import {
  approvePendingTimeEntry,
  confirmResponsibilityPreview,
  createOwnManualTimeEntry,
  createResponsibilityDelegationViaSettings,
  endResponsibilityDelegationViaSettings,
  expectExpiredResponsibilityDeniedAtAction,
  expectMemberRemovalBlockedByResponsibility,
  expectPendingTimeApprovalHidden,
  expectPendingTimeApprovalVisible,
  expectVisibleAfterSave,
  openTimeApprovals,
  previewResponsibilityChange,
  textInDom,
  visibleText,
} from './support/steps';

test.describe.configure({ mode: 'serial' });

function berlinTodayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

test.describe('P1-05 Verantwortlichkeiten und Vertretung @P1-05', () => {
  test('Die Vorschau zeigt die Wirkung, bevor die Verantwortung gespeichert wird', async ({
    adminPage,
    world,
  }) => {
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const before = await getLatestResponsibilityConfigurationState(
      world.orgId,
      'time_approval'
    );

    await previewResponsibilityChange(adminPage, {
      responsibility: 'time_approval',
      selectedNames: [adminName, employeeName],
      gainedNames: [employeeName],
      lostNames: [bueroName],
    });

    const duringPreview = await getLatestResponsibilityConfigurationState(
      world.orgId,
      'time_approval'
    );
    expect(duringPreview.id).toBe(before.id);

    await confirmResponsibilityPreview(adminPage);
    const after = await getLatestResponsibilityConfigurationState(
      world.orgId,
      'time_approval'
    );
    expect(after.id).not.toBe(before.id);
    expect(after.mode).toBe('selected');
  });

  test('Eine gezielt verantwortliche Person kann freigeben', async ({
    bueroPage,
    employeePage,
    world,
  }) => {
    const yesterdayDigits = toDatePickerDigits(
      shiftIsoDate(berlinTodayIso(), -1)
    );
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const [adminRecord, employeeRecord] = await Promise.all([
      getEmployeeRecordStateByUser(world.orgId, world.users.admin.id),
      getEmployeeRecordStateByUser(world.orgId, world.users.employee.id),
    ]);
    const configuration = await getLatestResponsibilityConfigurationState(
      world.orgId,
      'time_approval'
    );
    expect(configuration.mode).toBe('selected');
    expect(configuration.holderEmployeeRecordIds).toEqual(
      [adminRecord.id, employeeRecord.id].sort()
    );

    await createOwnManualTimeEntry(bueroPage, {
      memberName: bueroName,
      dateDigits: yesterdayDigits,
      clockInDigits: '0600',
      clockOutDigits: '0700',
    });
    expect(
      (await getLatestManualTimeEntryState(world.orgId, world.users.buero.id))
        .status
    ).toBe('pending');

    await openTimeApprovals(employeePage);
    await expectPendingTimeApprovalVisible(employeePage, world.users.buero.id);
    await approvePendingTimeEntry(employeePage, world.users.buero.id);
    expect(
      (await getLatestManualTimeEntryState(world.orgId, world.users.buero.id))
        .status
    ).toBe('approved');
  });

  test('Eigene Einträge bleiben für Verantwortliche im Vier-Augen-Prinzip', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const yesterdayDigits = toDatePickerDigits(
      shiftIsoDate(berlinTodayIso(), -1)
    );

    await createOwnManualTimeEntry(employeePage, {
      dateDigits: yesterdayDigits,
      clockInDigits: '0600',
      clockOutDigits: '0700',
    });
    await openTimeApprovals(bueroPage);
    await expectPendingTimeApprovalHidden(bueroPage, world.users.employee.id);
    await openTimeApprovals(employeePage);
    await expectPendingTimeApprovalHidden(employeePage, world.users.employee.id);

    await openTimeApprovals(adminPage);
    await expectPendingTimeApprovalVisible(adminPage, world.users.employee.id);
    await approvePendingTimeEntry(adminPage, world.users.employee.id);
    expect(
      (
        await getLatestManualTimeEntryState(
          world.orgId,
          world.users.employee.id
        )
      ).status
    ).toBe('approved');
  });

  test('Eine Vertretung gilt im Fenster und verliert die Freigabe nach dem Ende am Aktionspunkt', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const todayIso = berlinTodayIso();
    const yesterdayDigits = toDatePickerDigits(shiftIsoDate(todayIso, -1));
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    await previewResponsibilityChange(adminPage, {
      responsibility: 'time_approval',
      selectedNames: [adminName, bueroName],
      gainedNames: [bueroName],
      lostNames: [employeeName],
    });
    await confirmResponsibilityPreview(adminPage);
    await createResponsibilityDelegationViaSettings(adminPage, {
      responsibility: 'time_approval',
      delegatorName: adminName,
      substituteName: employeeName,
      validFromDigits: toDatePickerDigits(todayIso),
      validUntilDigits: toDatePickerDigits(shiftIsoDate(todayIso, 1)),
    });

    await createOwnManualTimeEntry(bueroPage, {
      memberName: bueroName,
      dateDigits: yesterdayDigits,
      clockInDigits: '0800',
      clockOutDigits: '0900',
    });
    await openTimeApprovals(employeePage);
    await expectPendingTimeApprovalVisible(employeePage, world.users.buero.id);

    // End the substitution in the admin session while the employee still has
    // the stale approval card. The click must be denied by action-time
    // resolution, not merely disappear after a UI refresh.
    await endResponsibilityDelegationViaSettings(
      adminPage,
      'time_approval',
      employeeName
    );
    await expectExpiredResponsibilityDeniedAtAction(
      employeePage,
      world.users.buero.id
    );
    expect(
      (await getLatestManualTimeEntryState(world.orgId, world.users.buero.id))
        .status
    ).toBe('pending');

    await openTimeApprovals(adminPage);
    await approvePendingTimeEntry(adminPage, world.users.buero.id);
  });

  test('Letzter Admin und letzter ausgewählter Verantwortlicher bleiben geschützt', async ({
    adminPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await previewResponsibilityChange(adminPage, {
      responsibility: 'time_approval',
      selectedNames: [employeeName],
    });
    await confirmResponsibilityPreview(adminPage);

    await expectMemberRemovalBlockedByResponsibility(adminPage, employeeName);
    await expectOwnerRoleMutationRejected(world.orgId, world.users.admin.id);
  });

  test('Betroffene sehen nur die eigene Verantwortung; Fremdorganisationen sehen nichts', async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    const configuration = await getLatestResponsibilityConfigurationState(
      world.orgId,
      'time_approval'
    );
    expect(configuration.mode).toBe('selected');
    expect(configuration.holderEmployeeRecordIds).toEqual([employeeRecord.id]);
    const visibleToEmployee =
      await getVisibleResponsibilityEmployeeRecordIdsAs(
        world.users.employee,
        world.orgId
      );
    expect(visibleToEmployee).toEqual([employeeRecord.id]);

    const visibleToOutsider =
      await getVisibleResponsibilityEmployeeRecordIdsAs(
        world.outsider.admin,
        world.orgId
      );
    expect(visibleToOutsider).toEqual([]);

    await employeePage.goto('/einstellungen/mitarbeiter');
    await expectVisibleAfterSave(
      employeePage,
      'Meine Verantwortlichkeiten und Vertretungen'
    );
    await expect(
      employeePage.getByRole('button', { name: 'Verantwortung ändern' })
    ).toHaveCount(0);
    await expect(visibleText(employeePage, 'Zeitfreigaben')).toBeVisible();

    await outsiderPage.goto('/einstellungen/mitarbeiter');
    await expect(visibleText(outsiderPage, world.outsider.orgName)).toBeVisible();
    await expect(
      visibleText(outsiderPage, 'Verantwortlichkeiten und Freigaben')
    ).toBeVisible();
    await expect(textInDom(outsiderPage, world.orgName)).toHaveCount(0);
  });
});
