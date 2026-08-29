import { expect, test } from './support/fixtures';
import { getEmployeeRecordStateByUser, getPendingInviteCode } from './support/db';
import {
  addConditionViaDialog,
  createPersonnelRecordViaDialog,
  editConditionWeeklyHours,
  editPersonnelTextField,
  expectRedirectedAway,
  expectVisibleAfterSave,
  joinOrganizationViaInviteLink,
  openMemberDetailFromList,
  removeMemberFromDetail,
  sendInviteFromPersonnelRecord,
  visibleText,
  textInDom,
} from './support/steps';

// P1-03 — Employee/personnel identity with date-effective employment
// conditions (@P1-03). Bounded outcome: Admin/Büro maintain a stable personnel
// identity with master data and date-effective conditions; existing members
// were migrated automatically; future starters/non-login personnel and exited
// people stay visibly distinguishable; nothing reinterprets historical time.

test.describe.configure({ mode: 'serial' });

// Shared across the serial tests below.
let noraRecordId = '';

// Business dates are Europe/Berlin dates (sv-SE formats as YYYY-MM-DD).
function toBerlinIsoDate(value: string | Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof value === 'string' ? new Date(value) : value);
}

test.describe('P1-03 Personalidentität und Konditionen @P1-03', () => {
  test('Bestehende Mitglieder wurden automatisch migriert', async ({ world }) => {
    // The backfill/trigger created exactly one record per member with the
    // membership's join date (as a Berlin business date) as the entry-date
    // default; nothing invented an employee number.
    for (const user of [world.users.admin, world.users.buero, world.users.employee]) {
      const record = await getEmployeeRecordStateByUser(world.orgId, user.id);
      expect(record.recordCountForUser).toBe(1);
      expect(record.membershipJoinedAt).not.toBeNull();
      expect(record.entryDate).toBe(toBerlinIsoDate(record.membershipJoinedAt!));
      expect(record.exitDate).toBeNull();
    }
  });

  test('Admin pflegt Personalien am bestehenden Mitarbeiter', async ({ adminPage, world }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await openMemberDetailFromList(adminPage, employeeName);

    await editPersonnelTextField(adminPage, 'Personalnummer', 'MA-001');
    await editPersonnelTextField(adminPage, 'Telefon', '0151 2345678');
    await editPersonnelTextField(adminPage, 'Notfallkontakt', 'Elke Golden');

    // The change history records the master-data edits.
    await expect(visibleText(adminPage, 'Personalien geändert')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Konditionen: aktuelle und frühere Version bleiben unterscheidbar', async ({
    adminPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await openMemberDetailFromList(adminPage, employeeName);

    // A past version and a version effective today.
    await addConditionViaDialog(adminPage, {
      validFromDigits: '01012026',
      employmentTypeLabel: 'Vollzeit',
      weeklyHours: '40',
      vacationDays: '30',
    });
    await addConditionViaDialog(adminPage, {
      employmentTypeLabel: 'Teilzeit',
      weeklyHours: '25',
    });

    // Both versions stay visible and distinguishable: the newer one is the
    // current condition, the older one is clearly historical.
    await expectVisibleAfterSave(adminPage, 'Teilzeit');
    // Exact matching: "Aktuell" must be the version badge, not a substring of
    // "Aktueller Status".
    const currentCondition = adminPage.getByRole('listitem').filter({ hasText: 'Teilzeit' });
    await expect(currentCondition.getByText('Aktuell', { exact: true })).toBeVisible();
    await expect(visibleText(adminPage, 'Vollzeit')).toBeVisible();
    const historicalCondition = adminPage
      .getByRole('listitem')
      .filter({ hasText: 'Gültig ab 01.01.2026' });
    await expect(historicalCondition.getByText('Früher', { exact: true })).toBeVisible();
    await expect(visibleText(adminPage, 'Gültig ab 01.01.2026')).toBeVisible();

    // Correcting the historical version works and stays traceable.
    await editConditionWeeklyHours(adminPage, '01.01.2026', '38');
    await expectVisibleAfterSave(adminPage, '38 Std./Woche');
    await expect(visibleText(adminPage, 'Kondition geändert')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Personalakte ohne Zugang ist sichtbar getrennt und in keiner Auswahl', async ({
    adminPage,
    world,
  }) => {
    // Entry date in the next calendar year so the record is always a future
    // starter, regardless of when the suite runs.
    const nextYear = new Date().getFullYear() + 1;
    noraRecordId = await createPersonnelRecordViaDialog(adminPage, {
      firstName: 'Nora',
      lastName: `Neuling-${world.runId}`,
      entryDateDigits: `0101${nextYear}`,
    });

    // The record detail shows the derived states for a future starter.
    const recordTitleRow = adminPage
      .getByRole('heading', { name: `Nora Neuling-${world.runId}` })
      .locator('..');
    await expect(recordTitleRow.getByText('Geplant', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(recordTitleRow.getByText('Ohne Zugang', { exact: true })).toBeVisible();

    // The list page shows the record in the separate personnel section.
    await adminPage.goto('/mitarbeiter');
    await expect(visibleText(adminPage, 'Weiteres Personal')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(adminPage, `Nora Neuling-${world.runId}`)).toBeVisible();

    // No operational picker offers the non-login record: the job dialog's
    // employee picker finds a real member but not the personnel record.
    await adminPage.goto('/auftraege');
    await adminPage.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await adminPage.getByRole('tab', { name: 'Auftrag erstellen' }).click();
    await adminPage.getByRole('combobox').filter({ hasText: 'Mitarbeiter zuweisen' }).click();
    const search = adminPage.getByPlaceholder('Mitarbeiter suchen...');
    await search.fill(world.users.employee.firstName);
    await expect(
      adminPage
        .getByRole('listbox')
        .getByRole('button')
        .filter({
          hasText: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
        })
    ).toBeVisible({ timeout: 15_000 });
    await search.fill('Neuling');
    await expect(
      adminPage.getByRole('listbox').getByRole('button').filter({ hasText: 'Neuling' })
    ).toHaveCount(0);
  });

  test('Einladung verknüpft die Personalakte mit dem neuen Zugang', async ({
    adminPage,
    browser,
    world,
  }) => {
    await adminPage.goto(`/mitarbeiter/${noraRecordId}`);
    await sendInviteFromPersonnelRecord(adminPage, world.personnelInvitee.email, 'Handwerker/in');
    await expectVisibleAfterSave(adminPage, 'Eingeladen');

    const inviteCode = await getPendingInviteCode(world.orgId, world.personnelInvitee.email);
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();
    await joinOrganizationViaInviteLink(page, inviteCode, world.personnelInvitee, world.orgId);
    await context.close();

    // The redeemed invite linked the existing record instead of creating a
    // second one; the login connection is recorded.
    const record = await getEmployeeRecordStateByUser(world.orgId, world.personnelInvitee.id);
    expect(record.id).toBe(noraRecordId);
    expect(record.recordCountForUser).toBe(1);

    // The new member appears once: in the members table, no longer in the
    // separate personnel section.
    await adminPage.goto('/mitarbeiter');
    const memberName = `${world.personnelInvitee.firstName} ${world.personnelInvitee.lastName}`;
    await expectVisibleAfterSave(adminPage, memberName);
    await expect(
      adminPage.getByRole('main').getByText(memberName).filter({ visible: true })
    ).toHaveCount(1);
  });

  test('Entfernen heute: Personalakte bleibt als Ausgeschieden erhalten', async ({
    adminPage,
    world,
  }) => {
    const removableName = `${world.removableEmployee.firstName} ${world.removableEmployee.lastName}`;
    await removeMemberFromDetail(adminPage, removableName);

    // The destructive removal (P1-33 replaces it) keeps the personnel record
    // and marks the person as exited.
    const record = await getEmployeeRecordStateByUser(world.orgId, world.removableEmployee.id);
    expect(record.exitDate).not.toBeNull();

    await adminPage.goto('/mitarbeiter');
    await expectVisibleAfterSave(adminPage, removableName);
    await expect(visibleText(adminPage, 'Ausgeschieden')).toBeVisible();
  });

  test('Mitarbeiterrolle erreicht keine Personalflächen', async ({ employeePage }) => {
    await expectRedirectedAway(employeePage, '/mitarbeiter');
    // Direct record URL: the employee role is redirected away and sees nothing.
    await employeePage.goto(`/mitarbeiter/${noraRecordId}`);
    await expect(employeePage).not.toHaveURL(new RegExp(noraRecordId), {
      timeout: 15_000,
    });
    await expect(textInDom(employeePage, 'Personalien')).toHaveCount(0);
  });

  test('Fremde Organisation sieht keine Personalakten', async ({ outsiderPage, world }) => {
    await outsiderPage.goto('/mitarbeiter');
    await expect(textInDom(outsiderPage, `Neuling-${world.runId}`)).toHaveCount(0);
    await expect(textInDom(outsiderPage, world.users.employee.lastName)).toHaveCount(0);

    // Direct record URL from another organization resolves to nothing.
    await outsiderPage.goto(`/mitarbeiter/${noraRecordId}`);
    await expect(outsiderPage).not.toHaveURL(new RegExp(noraRecordId), {
      timeout: 15_000,
    });
    await expect(textInDom(outsiderPage, `Neuling-${world.runId}`)).toHaveCount(0);
  });
});
