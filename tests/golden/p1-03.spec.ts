import {
  ACCESS_STATE_LABELS,
  EMPLOYMENT_STATE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
} from '../../lib/personnel/types';
import { expect, test } from './support/fixtures';
import { getEmployeeRecordStateByUser } from './support/db/personnel';
import { getPendingInviteCode } from './support/db/shared';
import {
  expectRedirectedAway,
  joinOrganizationViaInviteLink,
  removeMemberFromDetail,
} from './support/steps/organization';
import {
  PERSONNEL_COPY,
  PERSONNEL_HISTORY_EVENTS,
  addConditionViaDialog,
  conditionRow,
  conditionWeeklyHoursText,
  createPersonnelRecordViaDialog,
  editConditionWeeklyHours,
  openJobEmployeePickerSearch,
  openMemberDetailFromList,
  personnelRecordHeader,
  sendInviteFromPersonnelRecord,
  versionBadge,
} from './support/steps/personnel';
import { expectVisibleAfterSave, visibleText, textInDom } from './support/steps/shared';

// P1-03 — Employee/personnel identity with date-effective employment
// conditions (@P1-03). The journey: conditions stay distinguishable over time,
// a record without login stays separate until its invitation links it, and a
// removed member stays as "Ausgeschieden". The member backfill and the owner
// protection are database rules (supabase/tests/people_boundaries.sql); the
// full master-data form, the history attribution and every list badge are the
// A3 audit's edge cases.

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

function toGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

test.describe('P1-03 Personalidentität und Konditionen @P1-03', () => {
  test('Konditionen: aktuelle und frühere Version bleiben unterscheidbar', async ({
    adminPage,
    businessDate,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const pastIso = shiftIsoDate(businessDate, -30);
    await openMemberDetailFromList(adminPage, employeeName);

    // A past version and a version effective today.
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(pastIso),
      employmentType: 'vollzeit',
      weeklyHours: '40',
      vacationDays: '30',
    });
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(businessDate),
      employmentType: 'teilzeit',
      weeklyHours: '25',
    });

    // Both versions stay visible and distinguishable: the newer one is the
    // current condition, the older one is clearly historical. Exact matching:
    // "Aktuell" must be the version badge, not a substring of "Aktueller Status".
    await expectVisibleAfterSave(adminPage, EMPLOYMENT_TYPE_LABELS.teilzeit);
    const currentCondition = adminPage
      .getByRole('listitem')
      .filter({ hasText: EMPLOYMENT_TYPE_LABELS.teilzeit });
    await expect(versionBadge(currentCondition, 'current')).toBeVisible();
    const historicalCondition = conditionRow(adminPage, toGermanDate(pastIso));
    await expect(versionBadge(historicalCondition, 'former')).toBeVisible();
    await expect(historicalCondition).toContainText(EMPLOYMENT_TYPE_LABELS.vollzeit);

    // Correcting the historical version works and stays traceable.
    await editConditionWeeklyHours(adminPage, toGermanDate(pastIso), '38');
    await expectVisibleAfterSave(adminPage, conditionWeeklyHoursText(38));
    await expect(visibleText(adminPage, PERSONNEL_HISTORY_EVENTS.condition_updated)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Personalakte ohne Zugang bleibt getrennt, steht in keiner Auswahl und wird per Einladung verknüpft', async ({
    adminPage,
    browser,
    businessDate,
    world,
  }) => {
    const recordName = `${world.personnelInvitee.firstName} ${world.personnelInvitee.lastName}`;

    const recordId = await test.step('Akte für eine künftige Mitarbeiterin anlegen', async () => {
      // Entry date in the next calendar year: always a future starter.
      const nextYear = Number(businessDate.slice(0, 4)) + 1;
      const created = await createPersonnelRecordViaDialog(adminPage, {
        firstName: world.personnelInvitee.firstName,
        lastName: world.personnelInvitee.lastName,
        entryDateDigits: `0101${nextYear}`,
      });
      // The saved record carries the names the dialog was given.
      expect([created.firstName, created.lastName]).toEqual([
        world.personnelInvitee.firstName,
        world.personnelInvitee.lastName,
      ]);
      const recordHeader = personnelRecordHeader(adminPage, recordName);
      await expect(recordHeader.getByText(EMPLOYMENT_STATE_LABELS.geplant, { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(recordHeader.getByText(ACCESS_STATE_LABELS.ohne_zugang, { exact: true })).toBeVisible();
      return created.id;
    });

    await test.step('Die Akte steht unter Weiteres Personal und in keiner Auswahl', async () => {
      await adminPage.goto('/mitarbeiter');
      await expect(visibleText(adminPage, PERSONNEL_COPY.otherPersonnel)).toBeVisible({
        timeout: 15_000,
      });
      await expect(visibleText(adminPage, recordName)).toBeVisible();

      // The job dialog's employee picker finds a real member but not the record.
      const search = await openJobEmployeePickerSearch(adminPage);
      await search.fill(world.users.employee.firstName);
      await expect(
        adminPage
          .getByRole('listbox')
          .getByRole('option')
          .filter({ hasText: `${world.users.employee.firstName} ${world.users.employee.lastName}` }),
      ).toBeVisible({ timeout: 15_000 });
      await search.fill(world.personnelInvitee.lastName);
      await expect(
        adminPage
          .getByRole('listbox')
          .getByRole('option')
          .filter({ hasText: world.personnelInvitee.lastName }),
      ).toHaveCount(0);
    });

    await test.step('Die eingelöste Einladung verknüpft die bestehende Akte', async () => {
      await adminPage.goto(`/mitarbeiter/${recordId}`);
      await sendInviteFromPersonnelRecord(adminPage, world.personnelInvitee.email, 'employee');
      await expectVisibleAfterSave(adminPage, ACCESS_STATE_LABELS.eingeladen);

      const inviteCode = await getPendingInviteCode(world.orgId, world.personnelInvitee.email);
      const context = await browser.newContext({ locale: 'de-DE' });
      try {
        const page = await context.newPage();
        await joinOrganizationViaInviteLink(page, inviteCode, world.personnelInvitee, world.orgId);
      } finally {
        await context.close();
      }

      // The redeemed invite linked the existing record instead of creating a second one.
      const record = await getEmployeeRecordStateByUser(world.orgId, world.personnelInvitee.id);
      expect(record.id).toBe(recordId);
      expect(record.recordCountForUser).toBe(1);

      // The new member appears once: in the members table, no longer in the
      // separate personnel section.
      await adminPage.goto('/mitarbeiter');
      await expectVisibleAfterSave(adminPage, recordName);
      await expect(adminPage.getByRole('main').getByText(recordName).filter({ visible: true })).toHaveCount(
        1,
      );
    });
  });

  test('Entfernen heute: Personalakte bleibt als Ausgeschieden erhalten', async ({ adminPage, world }) => {
    const removableName = `${world.removableEmployee.firstName} ${world.removableEmployee.lastName}`;
    await removeMemberFromDetail(adminPage, removableName);

    // The destructive removal (P1-33 replaces it) keeps the personnel record
    // and marks the person as exited.
    const record = await getEmployeeRecordStateByUser(world.orgId, world.removableEmployee.id);
    expect(record.exitDate).not.toBeNull();

    await adminPage.goto('/mitarbeiter');
    await expectVisibleAfterSave(adminPage, removableName);
    await expect(visibleText(adminPage, EMPLOYMENT_STATE_LABELS.ausgeschieden)).toBeVisible();
  });

  test('Mitarbeiterrolle und fremde Organisation erreichen keine Personalakte', async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const adminRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.admin.id);
    // Every member of this world carries the run's surname suffix; none of it may leak.
    const worldSurname = world.users.admin.lastName;

    await expectRedirectedAway(employeePage, '/mitarbeiter');
    await employeePage.goto(`/mitarbeiter/${adminRecord.id}`);
    await expect(employeePage).not.toHaveURL(new RegExp(adminRecord.id), {
      timeout: 15_000,
    });
    await expect(textInDom(employeePage, PERSONNEL_COPY.personnelSection)).toHaveCount(0);

    await outsiderPage.goto('/mitarbeiter');
    await expect(outsiderPage).toHaveURL(/\/mitarbeiter$/, { timeout: 15_000 });
    await expect(textInDom(outsiderPage, worldSurname)).toHaveCount(0);
    await outsiderPage.goto(`/mitarbeiter/${adminRecord.id}`);
    await expect(outsiderPage).not.toHaveURL(new RegExp(adminRecord.id), {
      timeout: 15_000,
    });
    await expect(textInDom(outsiderPage, worldSurname)).toHaveCount(0);
  });
});
