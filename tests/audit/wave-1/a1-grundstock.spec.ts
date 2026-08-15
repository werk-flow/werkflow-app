import type { Page } from '@playwright/test';

import { expect, test } from '../../golden/support/fixtures';
import {
  getInventoryLedgerState,
  getOrganizationTimeEntryCount,
} from '../../golden/support/db';
import {
  clockInOnJob,
  clockOut,
  createCustomer,
  createInventoryItem,
  createInventoryLocation,
  createJob,
  createOwnManualTimeEntry,
  createPlannedCalendarEntry,
  createProject,
  endClockBreak,
  editMetadataTextField,
  expectRedirectedAway,
  loginViaUi,
  openCustomerDetail,
  openTimeApprovals,
  approvePendingTimeEntry,
  showPlanningMonth,
  signOutViaUi,
  startClockBreak,
  switchClockJob,
  takeMaterialOnJobPage,
  typeIntoDatePicker,
  typeIntoTimeInput,
  visibleText,
} from '../../golden/support/steps';
import { storageStatePath } from '../../golden/support/world';
import { confirmTestUserEmail } from '../../golden/support/seed';

test.describe.configure({ mode: 'serial' });

function berlinDateAtOffset(offsetDays: number): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const berlinToday = formatter.format(new Date());
  const date = new Date(`${berlinToday}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function detailActionsButton(page: Page) {
  return page
    .getByRole('heading', { level: 1 })
    .locator('xpath=ancestor::div[contains(@class, "sticky")][1]')
    .getByRole('button', { name: 'Aktionen öffnen' });
}

async function setJobStatus(page: Page, status: string): Promise<void> {
  const details = page.getByRole('heading', { name: 'Details' }).locator('..');
  const statusRow = details.getByText('Status', { exact: true }).locator('..');
  await statusRow.getByRole('button', { name: 'Status bearbeiten' }).click();
  await statusRow.getByRole('combobox').click();
  await page.getByRole('option', { name: status, exact: true }).click();
  await statusRow.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(statusRow.getByRole('button', { name: 'Status bearbeiten' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(statusRow).toContainText(status);
}

test.describe('A1 Grundstock und Wave 0 @AUDIT-W1-A1', () => {
  let secondaryOrganizationName = '';
  let secondaryOrganizationCode = '';
  let customerName = '';
  let renamedCustomerName = '';
  let linkedJobNumber = '';
  let linkedProjectNumber = '';
  let checklistJobNumber = '';
  let inventoryLocationName = '';
  let inventoryItemName = '';

  test('A1-01/A1-07: Konto, erste Organisation und Auto-Ausstempeln beim Abmelden', async ({
    browser,
    world,
  }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();
    const email = `a1-signup-${world.runId}@werkflow-golden.test`;
    const password = `A1-Sicher!${world.runId}2026`;
    const organizationName = `Golden Test SHK A1 Signup ${world.runId}`;

    await page.goto('/signup');
    await page.getByLabel('Vorname').fill('Sina');
    await page.getByLabel('Nachname').fill(`Audit-${world.runId}`);
    await page.getByLabel('E-Mail').fill(email);
    await page.getByRole('textbox', { name: 'Passwort', exact: true }).fill(password);
    await page.getByRole('button', { name: 'Registrieren' }).click();

    await expect(page).toHaveURL(/\/(verify|upgrade|onboarding)/, { timeout: 30_000 });
    if (/\/verify/.test(page.url())) {
      await confirmTestUserEmail(email);
      await page.goto('/login');
      await page.locator('input[autocomplete="email"]').fill(email);
      await page.locator('input[autocomplete="current-password"]').fill(password);
      await page.getByRole('button', { name: 'Anmelden' }).click();
      await expect(page).toHaveURL(/\/(upgrade|onboarding)/, { timeout: 30_000 });
    }
    if (/\/onboarding\/start/.test(page.url())) {
      await page.locator('a[href="/upgrade"]').click();
      await expect(page).toHaveURL(/\/upgrade/, { timeout: 30_000 });
    }
    if (/\/upgrade/.test(page.url())) {
      await page.getByRole('button', { name: 'Zahlung simulieren / Fortfahren' }).click();
      await expect(page).toHaveURL(/\/onboarding\/create-organization/, {
        timeout: 30_000,
      });
    }

    await page.locator('#org-name').fill(organizationName);
    await page.getByRole('button', { name: 'Organisation erstellen' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await expect(visibleText(page, organizationName)).toBeVisible();

    await clockInOnJob(page);
    await signOutViaUi(page);
    await loginViaUi(page, {
      email,
      password,
    });
    await expect(page.locator('button[title="Einstempeln"]')).toBeVisible();
    await signOutViaUi(page);
    await context.close();
  });

  test('A1-02/A1-03: Beitritt per Code, Organisationswechsel und Datentrennung', async ({
    adminPage,
    browser,
    world,
  }) => {
    secondaryOrganizationName = `Golden Test SHK A1 Zweitorg ${world.runId}`;
    await adminPage.goto('/dashboard');
    await adminPage.getByRole('button', { name: 'Organisation erstellen' }).click();
    await adminPage.locator('#dialog-org-name').fill(secondaryOrganizationName);
    await adminPage.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await expect(adminPage).toHaveURL(/\/dashboard\?created=/, { timeout: 30_000 });
    await expect(visibleText(adminPage, secondaryOrganizationName)).toBeVisible();
    secondaryOrganizationCode = (
      await adminPage.locator('code').filter({ hasText: /[A-Z0-9]{6}/ }).textContent()
    )?.trim() ?? '';
    expect(secondaryOrganizationCode).toMatch(/^[A-Z0-9]{6}$/);

    await createCustomer(adminPage, `Nur Zweitorg ${world.runId}`);

    const employeeContext = await browser.newContext({
      storageState: storageStatePath('employee'),
    });
    const employeePage = await employeeContext.newPage();
    await employeePage.goto('/dashboard');
    await employeePage.getByRole('button', { name: 'Organisation beitreten' }).click();
    await employeePage.locator('#dialog-org-code').fill(secondaryOrganizationCode);
    await employeePage.getByRole('button', { name: 'Beitreten', exact: true }).click();
    await expect(employeePage).toHaveURL(/\/dashboard\?joined=/, { timeout: 30_000 });
    await expect(visibleText(employeePage, secondaryOrganizationName)).toBeVisible();
    await expectRedirectedAway(employeePage, '/kunden');

    await employeePage.getByRole('combobox').filter({ hasText: secondaryOrganizationName }).click();
    await employeePage.getByRole('option').filter({ hasText: world.orgName }).click();
    await expect(visibleText(employeePage, world.orgName)).toBeVisible({ timeout: 20_000 });
    await employeePage.goto('/auftraege');
    await expect(employeePage.getByText(`Nur Zweitorg ${world.runId}`)).toHaveCount(0);
    await employeeContext.close();

    await adminPage.getByRole('combobox').filter({ hasText: secondaryOrganizationName }).click();
    await adminPage.getByRole('option').filter({ hasText: world.orgName }).click();
    await expect(visibleText(adminPage, world.orgName)).toBeVisible({ timeout: 20_000 });
  });

  test('A1-04/A1-06: Handwerker-Oberfläche und konservative Rollenregeln', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    await expectRedirectedAway(employeePage, '/mitarbeiter');
    await adminPage.goto('/mitarbeiter');
    const adminOwnRow = adminPage.locator('tbody tr').filter({ hasText: 'Greta' });
    await expect(adminOwnRow).toBeVisible();
    await expect(adminOwnRow.getByRole('button', { name: 'Aktionen öffnen' })).toHaveCount(0);

    await bueroPage.goto('/mitarbeiter');
    const bueroOwnRow = bueroPage.locator('tbody tr').filter({ hasText: 'Bruno' });
    const adminRow = bueroPage.locator('tbody tr').filter({ hasText: 'Greta' });
    const employeeRow = bueroPage.locator('tbody tr').filter({ hasText: 'Emil' });
    await expect(bueroOwnRow.getByRole('button', { name: 'Aktionen öffnen' })).toHaveCount(0);
    await expect(adminRow.getByRole('button', { name: 'Aktionen öffnen' })).toHaveCount(0);
    await expect(employeeRow.getByRole('button', { name: 'Aktionen öffnen' })).toBeVisible();
    await expect(visibleText(adminPage, world.orgName)).toBeVisible();
  });

  test('A1-05/A1-26/A1-27/A1-28: Live-Status, Pause, Auftragwechsel und Org-Sperre', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const firstJob = `A1 Zeitauftrag 1 ${world.runId}`;
    const secondJob = `A1 Zeitauftrag 2 ${world.runId}`;
    await createJob(adminPage, {
      jobNumber: `A1-Z1-${world.runId}`,
      title: firstJob,
      assignEmployeeName: 'Emil',
    });
    await createJob(adminPage, {
      jobNumber: `A1-Z2-${world.runId}`,
      title: secondJob,
      assignEmployeeName: 'Emil',
    });

    await adminPage.goto('/mitarbeiter');
    await clockInOnJob(employeePage, firstJob);
    await expect(visibleText(adminPage, 'Arbeitet')).toBeVisible({ timeout: 30_000 });
    await startClockBreak(employeePage);
    await expect(visibleText(adminPage, 'Macht Pause')).toBeVisible({ timeout: 30_000 });
    await endClockBreak(employeePage, firstJob);
    await switchClockJob(employeePage, secondJob);

    await employeePage.goto('/dashboard');
    await employeePage.getByRole('combobox').filter({ hasText: world.orgName }).click();
    await employeePage.getByRole('option').filter({ hasText: secondaryOrganizationName }).click();
    await expect(visibleText(employeePage, secondaryOrganizationName)).toBeVisible({ timeout: 20_000 });
    await employeePage.locator('button[title="Einstempeln"]').click();
    await employeePage.locator('button:not([title])', { hasText: 'Einstempeln' }).click();
    await expect(visibleText(employeePage, 'Bereits in anderer Organisation eingestempelt')).toBeVisible({
      timeout: 20_000,
    });
    await employeePage.getByRole('combobox').filter({ hasText: secondaryOrganizationName }).click();
    await employeePage.getByRole('option').filter({ hasText: world.orgName }).click();
    await clockOut(employeePage);
    await employeePage.goto('/zeiterfassung');
    await expect(visibleText(employeePage, 'Arbeitszeit')).toBeVisible();
    await expect(visibleText(employeePage, 'Pause')).toBeVisible();
  });

  test('A1-09/A1-11: Kundendaten inline und Kunde direkt im Arbeitsdialog', async ({
    adminPage,
    world,
  }) => {
    customerName = `A1 Kunde ${world.runId}`;
    renamedCustomerName = `A1 Kunde Neu ${world.runId}`;
    await createCustomer(adminPage, customerName, { type: 'Gewerblich' });
    await openCustomerDetail(adminPage, customerName);
    await editMetadataTextField(adminPage, 'Name', renamedCustomerName);
    await expect(visibleText(adminPage, renamedCustomerName)).toBeVisible({ timeout: 15_000 });

    const inlineCustomer = `A1 Inlinekunde ${world.runId}`;
    await adminPage.goto('/auftraege');
    await adminPage.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await adminPage.getByRole('tab', { name: 'Auftrag erstellen' }).click();
    await adminPage.getByRole('combobox').filter({ hasText: 'Kein Kunde' }).click();
    await adminPage.getByRole('button', { name: 'Neuen Kunden erstellen' }).click();
    await adminPage.locator('#client-name').fill(inlineCustomer);
    await adminPage.getByRole('button', { name: 'Kunde erstellen' }).click();
    await expect(adminPage.getByRole('heading', { name: 'Neuen Kunden anlegen' })).toBeHidden({
      timeout: 15_000,
    });
    await expect(adminPage.getByRole('combobox').filter({ hasText: inlineCustomer })).toBeVisible();
    await adminPage.keyboard.press('Escape');
    await expect(
      adminPage.getByRole('heading', { name: 'Neuen Auftrag oder Projekt erstellen' })
    ).toBeHidden();
  });

  test('A1-10/A1-14: Kunden- und Projektlöschung erhalten die Arbeit', async ({
    adminPage,
    world,
  }) => {
    linkedJobNumber = `A1-KD-${world.runId}`;
    linkedProjectNumber = `A1-PD-${world.runId}`;
    const projectTitle = `A1 Kundenprojekt ${world.runId}`;
    await createProject(adminPage, {
      projectNumber: linkedProjectNumber,
      title: projectTitle,
      clientName: renamedCustomerName,
    });
    await createJob(adminPage, {
      jobNumber: linkedJobNumber,
      title: `A1 Kundenauftrag ${world.runId}`,
      projectNumber: linkedProjectNumber,
    });

    await adminPage.goto(`/auftraege/projekt/${linkedProjectNumber}`);
    await expect(visibleText(adminPage, linkedJobNumber)).toBeVisible();
    await expect(visibleText(adminPage, renamedCustomerName)).toBeVisible();

    await openCustomerDetail(adminPage, renamedCustomerName);
    await detailActionsButton(adminPage).click();
    await adminPage.getByRole('menuitem', { name: 'Kunde löschen' }).click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(adminPage).toHaveURL(/\/kunden$/, { timeout: 20_000 });
    await adminPage.goto('/auftraege');
    await expect(visibleText(adminPage, linkedProjectNumber)).toBeVisible();
    await adminPage.getByRole('button', { name: 'Projekt aufklappen' }).click();
    await expect(visibleText(adminPage, linkedJobNumber)).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${linkedProjectNumber}`);
    await detailActionsButton(adminPage).click();
    await adminPage.getByRole('menuitem', { name: 'Projekt löschen' }).click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(adminPage).toHaveURL(/\/auftraege$/, { timeout: 20_000 });
    await expect(visibleText(adminPage, linkedJobNumber)).toBeVisible();
    await adminPage.goto(`/auftraege/${linkedJobNumber}`);
    await expect(visibleText(adminPage, 'Keinem Projekt zugeordnet')).toBeVisible();
  });

  test('A1-12/A1-13: Zuweisung entfernen, bearbeiten und Auftrag löschen', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const jobNumber = `A1-EDIT-${world.runId}`;
    const title = `A1 Auftrag bearbeiten ${world.runId}`;
    await createJob(adminPage, { jobNumber, title, assignEmployeeName: 'Emil' });
    await employeePage.goto('/auftraege');
    await expect(visibleText(employeePage, jobNumber)).toBeVisible();

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await detailActionsButton(adminPage).click();
    await adminPage.getByRole('menuitem', { name: 'Bearbeiten' }).click();
    const dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Auftrag bearbeiten' }),
    });
    await dialog.locator('#edit-job-title').fill(`${title} geändert`);
    const employeePicker = dialog.getByRole('combobox').filter({ hasText: '1 Mitarbeiter' });
    await expect(employeePicker).toBeEnabled({ timeout: 20_000 });
    await employeePicker.click();
    await adminPage.getByRole('listbox').getByRole('button', { name: /Emil/ }).click();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(visibleText(adminPage, `${title} geändert`)).toBeVisible();
    await employeePage.reload();
    await expect(employeePage.getByText(jobNumber)).toHaveCount(0);

    await detailActionsButton(adminPage).click();
    await adminPage.getByRole('menuitem', { name: 'Auftrag löschen' }).click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(adminPage).toHaveURL(/\/auftraege$/, { timeout: 20_000 });
    await expect(adminPage.getByText(jobNumber)).toHaveCount(0);
  });

  test('A1-15/A1-16: Entplanen parkt und Projektparken bewahrt fertige Kinder', async ({
    adminPage,
    world,
  }) => {
    const plannedDate = berlinDateAtOffset(21);
    const plannedDateDigits = plannedDate.split('-').reverse().join('');
    const projectNumber = `A1-PARK-P-${world.runId}`;
    const projectTitle = `A1 Parkprojekt ${world.runId}`;
    const unfinishedNumber = `A1-PARK-OFFEN-${world.runId}`;
    const finishedNumber = `A1-PARK-FERTIG-${world.runId}`;
    await createProject(adminPage, { projectNumber, title: projectTitle });
    await createJob(adminPage, {
      jobNumber: unfinishedNumber,
      title: `A1 Parken offen ${world.runId}`,
      projectNumber,
      plannedDateDigits,
    });
    await createJob(adminPage, {
      jobNumber: finishedNumber,
      title: `A1 Parken fertig ${world.runId}`,
      projectNumber,
      plannedDateDigits,
    });
    await adminPage.goto(`/auftraege/${finishedNumber}`);
    await setJobStatus(adminPage, 'Fertig');
    await expect(visibleText(adminPage, 'Fertig')).toBeVisible();

    await adminPage.goto(`/auftraege/${unfinishedNumber}`);
    await adminPage.getByRole('button', { name: 'Geplantes Datum bearbeiten' }).click();
    await adminPage.getByRole('button', { name: 'Leeren' }).click();
    await adminPage.getByRole('button', { name: 'Speichern', exact: true }).click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Datum entfernen' }).click();
    await expect(visibleText(adminPage, 'Geparkt')).toBeVisible({ timeout: 20_000 });
    await adminPage.getByRole('button', { name: 'Geplantes Datum bearbeiten' }).click();
    await typeIntoDatePicker(adminPage.locator('body'), 'Datum', plannedDateDigits);
    await adminPage.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(visibleText(adminPage, 'Geparkt')).toHaveCount(0);

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(adminPage.getByText(/50\s*%/).filter({ visible: true }).first()).toBeVisible();
    await detailActionsButton(adminPage).click();
    const overrideTrigger = adminPage.getByRole('menuitem', {
      name: 'Status überschreiben',
    });
    await overrideTrigger.focus();
    await overrideTrigger.press('ArrowRight');
    const parkedOption = adminPage.getByRole('menuitem', { name: 'Geparkt', exact: true });
    await expect(parkedOption).toBeVisible();
    await parkedOption.focus();
    await parkedOption.press('Enter');
    await expect(visibleText(adminPage, 'Geparkt')).toBeVisible({ timeout: 20_000 });
    await adminPage.goto(`/auftraege/${unfinishedNumber}`);
    await expect(visibleText(adminPage, 'Geparkt')).toBeVisible();
    await adminPage.goto(`/auftraege/${finishedNumber}`);
    await expect(visibleText(adminPage, 'Fertig')).toBeVisible();
    await expect(visibleText(adminPage, 'Abschlussdatum')).toBeVisible();
  });

  test('A1-17/A1-18: Checkliste, Attribution und Abschlussdatum', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    checklistJobNumber = `A1-CHECK-${world.runId}`;
    const title = `A1 Checkliste ${world.runId}`;
    await createJob(adminPage, {
      jobNumber: checklistJobNumber,
      title,
      assignEmployeeName: 'Emil',
    });
    await adminPage.goto(`/auftraege/${checklistJobNumber}`);
    await adminPage
      .getByRole('textbox', { name: 'Neuen Arbeitsanweisungs-Punkt eingeben' })
      .fill('Anlage druckprüfen');
    await adminPage
      .getByRole('textbox', { name: 'Neuen Arbeitsanweisungs-Punkt eingeben' })
      .press('Enter');
    await expect(visibleText(adminPage, 'Erstellt von Greta')).toBeVisible({ timeout: 15_000 });
    const persistedInstruction = adminPage
      .getByRole('textbox', { name: 'Arbeitsanweisungs-Punkt bearbeiten' })
      .first();
    await expect(persistedInstruction).toHaveValue('Anlage druckprüfen');
    await expect(persistedInstruction.locator('xpath=../../..')).not.toHaveClass(/opacity-80/, {
      timeout: 15_000,
    });

    await employeePage.goto(`/auftraege/${checklistJobNumber}`);
    await employeePage.getByRole('button', { name: 'Punkt als erledigt markieren' }).click();
    await expect(visibleText(employeePage, 'Zuletzt erledigt von Emil')).toBeVisible();
    await employeePage.getByRole('button', { name: 'Punkt als offen markieren' }).click();
    await expect(visibleText(employeePage, 'Zuletzt offen von Emil')).toBeVisible();

    await adminPage.reload();
    await setJobStatus(adminPage, 'Fertig');
    const completionDate = berlinDateAtOffset(0).split('-').reverse().join('.');
    const completionRow = adminPage.getByText('Abschlussdatum', { exact: true }).locator('..');
    await expect(completionRow).toContainText(completionDate, { timeout: 20_000 });
  });

  test('A1-19: Auftragsliste sucht, filtert und trennt Parkplatz/Archiv', async ({
    adminPage,
    world,
  }) => {
    const listJobNumber = `A1-LIST-${world.runId}`;
    await createJob(adminPage, {
      jobNumber: listJobNumber,
      title: `A1 Listenauftrag ${world.runId}`,
      plannedDateDigits: berlinDateAtOffset(20).split('-').reverse().join(''),
    });
    await createJob(adminPage, {
      jobNumber: `A1-PARK-LIST-${world.runId}`,
      title: `A1 Parkplatzliste ${world.runId}`,
    });
    const archiveJobNumber = `A1-ARCHIV-${world.runId}`;
    await createJob(adminPage, {
      jobNumber: archiveJobNumber,
      title: `A1 Archivliste ${world.runId}`,
      plannedDateDigits: berlinDateAtOffset(20).split('-').reverse().join(''),
    });
    await adminPage.goto(`/auftraege/${archiveJobNumber}`);
    await setJobStatus(adminPage, 'Fertig');
    await adminPage.goto('/auftraege');
    const search = adminPage.getByPlaceholder('Suche nach Titel, Nummer, Kunde, Ort...').first();
    await search.fill(listJobNumber);
    await expect(visibleText(adminPage, listJobNumber)).toBeVisible();
    await search.fill('kein-treffer-a1');
    await expect(adminPage.getByText(listJobNumber)).toHaveCount(0);
    await search.fill('');
    await expect(adminPage.getByText(/Parkplatz/).first()).toBeVisible();
    await expect(adminPage.getByText(/Archiv/).first()).toBeVisible();
    await expect(visibleText(adminPage, world.orgName)).toBeVisible();
  });

  test('A1-21/A1-24: Kalenderansichten und getrennte Plan-/Arbeitszeitfilter', async ({
    adminPage,
    world,
  }) => {
    const title = `A1 Kalender ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: title,
      date: berlinDateAtOffset(20),
      time: '06:00',
      durationHours: 1,
      employeeNames: ['Emil'],
      overrideReason: 'A1 Audit ohne hinterlegten Wochenplan',
    });
    await adminPage.goto('/kalender');
    for (const view of ['Tag', 'Woche', 'Monat']) {
      await adminPage.getByRole('tab', { name: view, exact: true }).click();
      await expect(adminPage.getByRole('tab', { name: view, exact: true })).toHaveAttribute(
        'data-state',
        'active'
      );
    }
    const planningDate = berlinDateAtOffset(20);
    await showPlanningMonth(adminPage, planningDate);
    await adminPage.getByRole('button', { name: 'Aktualisieren' }).click();
    const targetDay = adminPage.locator(
      `.fc-daygrid-day[data-date="${planningDate}"]`
    );
    const calendarEvent = targetDay.locator('.fc-event-job').filter({ hasText: title });
    await expect(calendarEvent).toHaveCount(1, { timeout: 20_000 });
    const calendarTitle = visibleText(adminPage, title);
    if (!(await calendarTitle.isVisible().catch(() => false))) {
      await targetDay.getByText(/\+\d+ mehr/).click({ timeout: 5_000 });
    }
    await expect(calendarTitle).toBeVisible({ timeout: 20_000 });
    const calendarMain = adminPage.getByRole('main');
    await expect(calendarMain.getByText('Arbeitszeiten', { exact: true })).toBeVisible();
    await expect(calendarMain.getByText('Aufträge', { exact: true })).toBeVisible();
  });

  test('A1-22: Kalender-Drag verschiebt Planung erst nach bestätigtem Warnpfad', async ({
    adminPage,
    world,
  }) => {
    const sourceDate = berlinDateAtOffset(22);
    const targetDate = berlinDateAtOffset(23);
    const title = `A1 Drag ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: title,
      date: sourceDate,
      time: '06:00',
      durationHours: 1,
      employeeNames: ['Emil'],
      overrideReason: 'A1 Ausgangsplanung ohne Wochenplan',
    });
    await showPlanningMonth(adminPage, sourceDate);
    const event = adminPage.locator('.fc-event-job').filter({ hasText: title });
    const targetCell = adminPage.locator(`.fc-daygrid-day[data-date="${targetDate}"]`);
    await event.dragTo(targetCell);
    const warning = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Planungshinweise prüfen' }),
    });
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await warning.locator('#planning-warning-reason').fill('A1 Drag bewusst bestätigt');
    await warning.getByRole('button', { name: 'Mit Begründung speichern' }).click();
    await expect(warning).toHaveCount(0, { timeout: 20_000 });
    await showPlanningMonth(adminPage, targetDate);
    await expect(adminPage.locator(`.fc-daygrid-day[data-date="${targetDate}"]`).filter({ hasText: title })).toBeVisible();
  });

  test('A1-29: Manuelle Zeiten lehnen falsche Reihenfolge und Überlappung ab', async ({
    employeePage,
  }) => {
    const completedBusinessDate = berlinDateAtOffset(-1);
    const digits = completedBusinessDate.split('-').reverse().join('');
    await employeePage.goto('/zeiterfassung');
    await employeePage.getByRole('button', { name: 'Manuelle Eintragung' }).click();
    let dialog = employeePage.getByRole('dialog');
    await typeIntoDatePicker(dialog, 'Datum', digits);
    await typeIntoTimeInput(dialog, 'clockInTime', '0900');
    await typeIntoTimeInput(dialog, 'clockOutTime', '0800');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByText('Die Einstempelzeit muss vor der Ausstempelzeit liegen.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Schließen' }).click();

    await employeePage.getByRole('button', { name: 'Manuelle Eintragung' }).click();
    dialog = employeePage.getByRole('dialog');
    await typeIntoDatePicker(dialog, 'Datum', digits);
    await typeIntoTimeInput(dialog, 'clockInTime', '0600');
    await typeIntoTimeInput(dialog, 'clockOutTime', '0700');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByText('Antrag wurde zur Genehmigung eingereicht.')).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });

    await employeePage.getByRole('button', { name: 'Manuelle Eintragung' }).click();
    dialog = employeePage.getByRole('dialog');
    await typeIntoDatePicker(dialog, 'Datum', digits);
    await typeIntoTimeInput(dialog, 'clockInTime', '0630');
    await typeIntoTimeInput(dialog, 'clockOutTime', '0730');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByText(/überschneidet|Überlappung/i)).toBeVisible({ timeout: 15_000 });
  });

  test('A1-30: Manager korrigiert, hängt um und löscht bestehende Arbeitsblöcke', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const completedBusinessDate = berlinDateAtOffset(-1);
    const digits = completedBusinessDate.split('-').reverse().join('');
    await createOwnManualTimeEntry(employeePage, {
      dateDigits: digits,
      clockInDigits: '1000',
      clockOutDigits: '1100',
    });
    await openTimeApprovals(adminPage);
    await approvePendingTimeEntry(
      adminPage,
      world.users.employee.id,
      /10:00.*11:00/
    );

    await adminPage.goto('/kalender');
    await adminPage.getByRole('tab', { name: 'Tag', exact: true }).click();
    await adminPage.getByRole('button', { name: 'Zurück' }).click();
    await adminPage.getByText('Arbeitszeiten', { exact: true }).click();
    await adminPage.getByRole('button', { name: 'Aktualisieren' }).click();
    const workBlock = adminPage.getByTitle(/10:00.*11:00/).filter({ visible: true }).first();
    await expect(workBlock).toBeVisible({ timeout: 20_000 });
    await workBlock.click();
    let dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Eintrag Details' }),
    });
    await dialog
      .getByRole('button', { name: 'Bearbeiten', exact: true })
      .click({ delay: 250 });
    const clockOutTime = dialog.getByRole('group', { name: 'Uhrzeit' }).nth(1);
    // The live calendar can replace the editor wrapper while its data refreshes.
    // Focus avoids Playwright's click-stability wait; each key action re-resolves
    // the locator if React replaced the node.
    await clockOutTime.focus();
    await clockOutTime.press('ArrowLeft');
    await clockOutTime.pressSequentially('1130');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await adminPage.keyboard.press('Escape');
    await expect(adminPage.getByTitle(/10:00.*11:30/).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });

    const source = adminPage
      .getByTitle(/10:00.*11:30/)
      .filter({ visible: true })
      .first()
      .getByRole('button');
    const sourceBox = await source.boundingBox();
    if (!sourceBox) throw new Error('A1-30 source work block has no bounding box');
    await adminPage.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await adminPage.mouse.down();
    await adminPage.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y - 72, { steps: 12 });
    await adminPage.mouse.up();
    await expect(visibleText(
      adminPage,
      `Zeiteintrag wurde zu ${world.users.buero.firstName} ${world.users.buero.lastName} verschoben.`
    )).toBeVisible({
      timeout: 20_000,
    });

    await adminPage.getByTitle(/10:00.*11:30/).filter({ visible: true }).first().click();
    dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Eintrag Details' }),
    });
    await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(adminPage.getByTitle(/10:00.*11:30/)).toHaveCount(0, { timeout: 20_000 });
  });

  test('A1-32: Nur Admin ändert Pausenregel und abgeschlossene Historie bleibt stabil', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const countBefore = await getOrganizationTimeEntryCount(world.orgId);
    await adminPage.goto('/einstellungen/zeiterfassung');
    await adminPage.getByLabel('Art der Pausenbuchung').click();
    await adminPage.getByRole('option', { name: 'Pause automatisch abziehen' }).click();
    await adminPage.getByRole('spinbutton', { name: 'Automatische Schwelle (Minuten)' }).fill('360');
    await adminPage.getByRole('spinbutton', { name: 'Automatische Pausendauer (Minuten)' }).fill('30');
    await adminPage.getByRole('button', { name: 'Zeiterfassung speichern' }).click();
    await expect(visibleText(adminPage, 'Die Regeln für die Zeiterfassung wurden gespeichert.')).toBeVisible();

    await bueroPage.goto('/einstellungen/zeiterfassung');
    await expect(bueroPage.getByLabel('Art der Pausenbuchung')).toBeDisabled();
    await expect(visibleText(bueroPage, 'Du kannst diese Regeln einsehen, aber nur der Admin kann sie ändern.')).toBeVisible();
    expect(await getOrganizationTimeEntryCount(world.orgId)).toBe(countBefore);
  });

  test('A1-34/A1-35: Ordner, Verschieben/Kopieren und Arbeitsverknüpfung', async ({
    adminPage,
    world,
  }) => {
    const folderName = `A1 Ordner ${world.runId}`;
    const fileName = `a1-dokument-${world.runId}.txt`;
    await adminPage.goto('/dokumente');
    await adminPage.getByRole('button', { name: 'Hochladen oder Erstellen' }).click();
    await adminPage.getByRole('menuitem', { name: 'Neuer Ordner' }).click();
    const folderDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Ordner erstellen' }),
    });
    await folderDialog.getByPlaceholder('Ordnername').fill(folderName);
    await folderDialog.getByRole('button', { name: 'Erstellen' }).click();
    await expect(folderDialog).toHaveCount(0, { timeout: 15_000 });

    await adminPage.locator('input[type="file"]:not([webkitdirectory])').setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('WerkFlow A1 Dokument'),
    });
    await expect(adminPage.getByText('1 von 1 abgeschlossen')).toBeVisible({ timeout: 60_000 });
    await adminPage.getByRole('button', { name: 'Schließen' }).first().click();
    await expect(visibleText(adminPage, fileName)).toBeVisible({ timeout: 20_000 });

    await adminPage.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` }).click();
    await adminPage.getByRole('menuitem', { name: 'Verknüpfungen verwalten' }).click();
    const linkDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Verknüpfungen verwalten' }),
    });
    await linkDialog.getByPlaceholder('Auftrag suchen...').fill(checklistJobNumber);
    await linkDialog.getByRole('button').filter({ hasText: checklistJobNumber }).click();
    await linkDialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(linkDialog).toHaveCount(0, { timeout: 20_000 });

    await adminPage.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` }).click();
    await adminPage.getByRole('menuitem', { name: 'Kopieren' }).click();
    let destination = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Kopieren nach' }),
    });
    await destination.getByRole('button', { name: folderName }).click();
    await destination.getByRole('button', { name: 'Hierhin kopieren' }).click();
    await expect(destination).toHaveCount(0, { timeout: 20_000 });

    await adminPage.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` }).click();
    await adminPage.getByRole('menuitem', { name: 'Verschieben' }).click();
    destination = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Verschieben nach' }),
    });
    await destination.getByRole('button', { name: folderName }).click();
    await destination.getByRole('button', { name: 'Hierhin verschieben' }).click();
    await expect(destination).toHaveCount(0, { timeout: 20_000 });
  });

  test('A1-36/A1-37: Papierkorb, Wiederherstellung, endgültiges Löschen, Version und Verlauf', async ({
    adminPage,
    world,
  }) => {
    const fileName = `a1-version-${world.runId}.pdf`;
    await adminPage.goto('/dokumente');
    await adminPage.getByRole('button', { name: 'Hochladen oder Erstellen' }).click();
    const fileChooserPromise = adminPage.waitForEvent('filechooser');
    await adminPage.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nWerkFlow A1 Version 1'),
    });
    await expect(adminPage.getByText('1 von 1 abgeschlossen')).toBeVisible({ timeout: 60_000 });
    await adminPage.getByRole('button', { name: 'Schließen' }).first().click();
    await adminPage.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` }).click();
    await adminPage.getByRole('menuitem', { name: 'Details' }).click();
    const details = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Dateidetails' }),
    });
    await expect(details.getByText('Hochgeladen', { exact: true })).toBeVisible({ timeout: 20_000 });
    await details.locator('select').selectOption('contract');
    await expect(details.locator('select')).toHaveValue('contract');
    await adminPage.keyboard.press('Escape');
    await adminPage.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` }).click();
    await adminPage.getByRole('menuitem', { name: 'Details' }).click();
    await expect(details.getByText('Kategorie geändert', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(details.getByRole('button', { name: 'Neue Version' })).toBeVisible();
    await details.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nWerkFlow A1 Version 2'),
    });
    await expect(visibleText(adminPage, 'Neue Version wurde hochgeladen.')).toBeVisible({ timeout: 60_000 });
    await expect(details.getByText('Aktuelle Version 2')).toBeVisible();
    await expect(details.getByText('Neue Version hochgeladen')).toBeVisible();
    await adminPage.keyboard.press('Escape');
    await expect(details).toHaveCount(0);

    await adminPage.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` }).click();
    await adminPage.getByRole('menuitem', { name: 'Löschen' }).click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Datei löschen' }).click();
    await adminPage.getByRole('button', { name: 'Papierkorb' }).click();
    await expect(visibleText(adminPage, fileName)).toBeVisible({ timeout: 20_000 });
    await adminPage.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` }).click();
    await adminPage.getByRole('menuitem', { name: 'Wiederherstellen' }).click();
    await expect(visibleText(adminPage, 'Datei wurde wiederhergestellt.')).toBeVisible();

    await adminPage.getByRole('button', { name: 'Papierkorb' }).click();
    await adminPage.goto('/dokumente');
    await adminPage.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` }).click();
    await adminPage.getByRole('menuitem', { name: 'Löschen' }).click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Datei löschen' }).click();
    await adminPage.getByRole('button', { name: 'Papierkorb' }).click();
    await adminPage.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` }).click();
    await adminPage.getByRole('menuitem', { name: 'Endgültig löschen' }).click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Endgültig löschen' }).click();
    await expect(adminPage.getByText(fileName)).toHaveCount(0);

    await adminPage.goto('/dokumente');
    await adminPage.getByRole('button', { name: 'Hochladen oder Erstellen' }).click();
    const viewerFileChooserPromise = adminPage.waitForEvent('filechooser');
    await adminPage.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
    const viewerFileChooser = await viewerFileChooserPromise;
    await viewerFileChooser.setFiles({
      name: `a1-viewer-${world.runId}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    });
    await expect(adminPage.getByText('1 von 1 abgeschlossen')).toBeVisible({ timeout: 60_000 });
    await adminPage.getByRole('button', { name: 'Schließen' }).first().click();
    await expect(visibleText(adminPage, `a1-viewer-${world.runId}.png`)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('A1-40/A1-44: Artikel und Lager per UI sowie alle Inventaransichten', async ({
    adminPage,
    world,
  }) => {
    inventoryLocationName = `A1 Lager ${world.runId}`;
    inventoryItemName = `A1 Artikel ${world.runId}`;
    await createInventoryLocation(adminPage, inventoryLocationName);
    await createInventoryItem(adminPage, {
      name: inventoryItemName,
      locationName: inventoryLocationName,
      initialQuantity: 5,
      supplierName: `A1 Lieferant ${world.runId}`,
    });
    await adminPage.goto('/inventar');
    await expect(visibleText(adminPage, inventoryItemName)).toBeVisible();
    for (const view of ['Alle Artikel', 'Lager', 'Geplant', 'Bewegungen']) {
      await adminPage.getByRole('tab', { name: view, exact: true }).click();
      await expect(adminPage.getByRole('tab', { name: view, exact: true })).toHaveAttribute(
        'data-state',
        'active'
      );
    }
  });

  test('A1-41: Zu-/Abgang, Negativsperre und nachvollziehbare Bewegung', async ({
    adminPage,
  }) => {
    await adminPage.goto('/inventar');
    let row = adminPage.locator('tbody tr').filter({ hasText: inventoryItemName });
    await row.getByRole('button').last().click();
    await adminPage.getByRole('menuitem', { name: 'Bestand ändern' }).click();
    let dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Bestand ändern' }),
    });
    await dialog.locator('#inventory-stock-quantity').fill('2');
    await dialog.locator('#inventory-stock-reason').fill('A1 Zugang');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    row = adminPage.locator('tbody tr').filter({ hasText: inventoryItemName });
    await row.getByRole('button').last().click();
    await adminPage.getByRole('menuitem', { name: 'Bestand ändern' }).click();
    dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Bestand ändern' }),
    });
    await dialog.getByRole('button', { name: 'Entnehmen' }).click();
    await dialog.locator('#inventory-stock-quantity').fill('999');
    await dialog.locator('#inventory-stock-reason').fill('A1 Negativtest');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog.getByText(/Bestand.*reicht nicht aus/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();

    await adminPage.getByRole('tab', { name: 'Bewegungen' }).click();
    const movement = adminPage
      .locator('tbody tr')
      .filter({ hasText: inventoryItemName })
      .filter({ hasText: 'Eingang' });
    await expect(movement).toContainText('A1 Zugang');
    await expect(movement).toContainText(/5.*7|7.*5/);
  });

  test('A1-39/A1-42: Material planen, geplant und ungeplant entnehmen, Projekt summiert', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const projectNumber = `A1-MAT-P-${world.runId}`;
    const projectTitle = `A1 Materialprojekt ${world.runId}`;
    const jobNumber = `A1-MAT-J-${world.runId}`;
    await createProject(adminPage, { projectNumber, title: projectTitle });
    await createJob(adminPage, {
      jobNumber,
      title: `A1 Materialauftrag ${world.runId}`,
      projectNumber,
      assignEmployeeName: 'Emil',
    });

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByRole('button', { name: 'Material planen' }).click();
    let dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Material planen' }),
    });
    await dialog.getByLabel('Artikel suchen').fill(world.inventory.itemName);
    await dialog.getByRole('button').filter({ hasText: world.inventory.itemName }).click();
    await dialog.locator('input[id$="-quantity"]').fill('3');
    await dialog.locator('button[id$="-location"]').click();
    await adminPage.getByRole('option', { name: world.inventory.locationName }).click();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    expect((await getInventoryLedgerState(world.orgId, world.inventory.itemId, world.inventory.locationId)).quantityOnHand).toBe(world.inventory.initialQuantity);

    await employeePage.goto(`/auftraege/${jobNumber}`);
    const plannedLine = employeePage.locator('div.rounded-md.border').filter({ hasText: world.inventory.itemName }).first();
    await plannedLine.getByRole('button', { name: 'Entnahme buchen' }).click();
    dialog = employeePage.getByRole('dialog').filter({
      has: employeePage.getByRole('heading', { name: 'Entnahme buchen' }),
    });
    await dialog.locator('input[id$="-quantity"]').fill('2');
    await dialog.locator('button[id$="-location"]').click();
    await employeePage.getByRole('option', { name: /Hauptlager \(Golden\)/ }).click();
    await dialog.getByRole('button', { name: 'Entnahme buchen' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await takeMaterialOnJobPage(employeePage, jobNumber, inventoryItemName, 1);

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(visibleText(adminPage, 'Aus Aufträgen übernommen')).toBeVisible();
    await expect(visibleText(adminPage, 'Projekt gesamt')).toBeVisible();
    await expect(visibleText(adminPage, world.inventory.itemName)).toBeVisible();
  });

  test('A1-43: CSV-Spaltenzuordnung legt Stammdaten und Anfangsbewegung an', async ({
    adminPage,
    world,
  }) => {
    const importedItem = `A1 CSV Artikel ${world.runId}`;
    const importedLocation = `A1 CSV Lager ${world.runId}`;
    await adminPage.goto('/inventar');
    await adminPage.getByRole('button', { name: 'CSV importieren' }).click();
    const dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'CSV importieren' }),
    });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: `a1-import-${world.runId}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        `Bezeichnung;Gruppe;Ort;Anbieter;Menge;Einheit\n${importedItem};A1 Kategorie;${importedLocation};A1 CSV Lieferant;4;Stück`
      ),
    });
    const mappings = {
      name: 'Bezeichnung',
      categoryName: 'Gruppe',
      locationName: 'Ort',
      supplierName: 'Anbieter',
      quantity: 'Menge',
      unit: 'Einheit',
    } as const;
    for (const [field, header] of Object.entries(mappings)) {
      await dialog.locator(`#inventory-import-${field}`).click();
      await adminPage.getByRole('option', { name: header, exact: true }).click();
    }
    await dialog.getByRole('button', { name: 'Importieren' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(visibleText(adminPage, importedItem)).toBeVisible({ timeout: 20_000 });
    await adminPage.getByRole('tab', { name: 'Lager' }).click();
    await expect(visibleText(adminPage, importedLocation)).toBeVisible();
    await adminPage.getByRole('tab', { name: 'Bewegungen' }).click();
    await expect(visibleText(adminPage, importedItem)).toBeVisible();
  });
});
