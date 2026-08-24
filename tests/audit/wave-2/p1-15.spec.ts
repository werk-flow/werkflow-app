import { resolve } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../golden/support/fixtures';
import {
  getJobSiteContactState,
  getVisibleWorkArtifactCountsAs,
  getWorkArtifactState,
  getWorkLifecycleState,
} from '../../golden/support/db';
import {
  addSiteOnCustomerDetail,
  clockInOnJob,
  clockOut,
  createAndPublishWorkTemplate,
  createCustomer,
  createJob,
  createProject,
  openCustomerDetail,
  selectFromSearchable,
  typeIntoDatePickerById,
  typeIntoDateTimeField,
  uploadDocumentOnJobPage,
} from '../../golden/support/steps';
import { ARTIFACTS_DIR } from '../../golden/support/world';

test.describe.configure({ mode: 'serial' });

function berlinTodayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

function digits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DATES = Array.from({ length: 5 }, (_, index) => shiftIsoDate(berlinTodayIso(), 80 + index));

const KIND_LABELS = {
  site_diary: 'Bautagebuch',
  work_report: 'Arbeitsbericht',
  measurement: 'Aufmaß',
  defect: 'Mangel',
  change_work: 'Regie-/Änderungsnachweis',
} as const;

type ArtifactKind = keyof typeof KIND_LABELS;

async function selectOption(page: Page, trigger: Locator, name: string): Promise<void> {
  await trigger.click();
  const option = page.getByRole('option', { name, exact: true });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}

async function beginArtifact(page: Page, kind: ArtifactKind, title: string): Promise<Locator> {
  const section = page.getByTestId('work-artifacts-section');
  await section.getByRole('button', { name: 'Neu', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Arbeitsnachweis erstellen' })).toBeVisible();
  await selectOption(page, dialog.getByRole('combobox', { name: 'Art des Arbeitsnachweises' }), KIND_LABELS[kind]);
  await dialog.getByLabel('Titel').fill(title);
  await dialog.getByLabel('Zusammenfassung').fill(`Strukturierter Nachweis ${title}`);
  return dialog;
}

async function finishArtifact(dialog: Locator, submit = true): Promise<void> {
  await dialog.getByRole('button', { name: submit ? 'Zur Prüfung einreichen' : 'Als Entwurf speichern', exact: true }).click();
  await expect(dialog.getByText(/Version 1/)).toBeVisible({ timeout: 20_000 });
}

async function closeArtifact(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
}

async function openArtifactAfterReload(page: Page, title: string): Promise<Locator> {
  const row = page.getByTestId('work-artifacts-section').getByRole('button', {
    name: new RegExp(`^${escapeRegExp(title)}`),
  });
  const dialog = page.getByRole('dialog');
  for (let attempt = 0; attempt < 2; attempt++) {
    await row.click();
    if (await dialog.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
      return dialog;
    }
  }
  throw new Error(`Artifact dialog did not open after hydration retry: ${title}`);
}

test.describe('P1-15 exhaustive structured site evidence flows @AUDIT-W2-P1-15 @AUDIT-W2', () => {
  test('targets, roles, five structured kinds, validation, and organization isolation', async ({
    adminPage, employeePage, outsiderPage, world,
  }) => {
    test.setTimeout(600_000);
    // P1-15-F01…F16 and F18…F27: placement, exact target, site/task context,
    // visibility, empty/list/detail states, role bounds, and all five schemas.
    const customerName = `P115 Kunde ${world.runId}`;
    const siteName = `P115 Einsatzort ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P115`;
    const projectNumber = `PRJ-${world.runId}-P115`;
    const childJobNumber = `${projectNumber}-1`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    await createCustomer(adminPage, customerName);
    await openCustomerDetail(adminPage, customerName);
    await addSiteOnCustomerDetail(adminPage, { name: siteName, street: 'Werkstraße 15', postalCode: '10115', city: 'Berlin', isPrimary: true });
    await createJob(adminPage, { jobNumber, title: `P115 Einsatz ${world.runId}`, clientName: customerName, siteName, assignEmployeeName: employeeName, plannedDateDigits: digits(DATES[0]) });
    await createProject(adminPage, { projectNumber, title: `P115 Projekt ${world.runId}`, clientName: customerName, siteName });
    await createJob(adminPage, { jobNumber: childJobNumber, title: `P115 Projektauftrag ${world.runId}`, projectNumber, clientName: customerName, assignEmployeeName: employeeName });

    await employeePage.goto(`/auftraege/${jobNumber}`);
    const section = employeePage.getByTestId('work-artifacts-section');
    await expect(section.getByText('Noch keine Arbeitsnachweise erfasst.')).toBeVisible();
    await expect(employeePage.getByRole('link', { name: 'Arbeitsnachweise' })).toHaveCount(0);

    let dialog = await beginArtifact(employeePage, 'work_report', `Entwurf zum Verwerfen ${world.runId}`);
    await dialog.getByLabel('Ausgeführte Arbeiten').fill('Noch nicht eingereichter Testentwurf.');
    await finishArtifact(dialog, false);
    await dialog.locator('#artifact-action-reason').fill('Eigener ungesendeter Testentwurf wird verworfen.');
    await dialog.getByRole('button', { name: 'Ungültig setzen' }).click();
    await expect(dialog.getByText(/Ungültig · Version 1/)).toBeVisible({ timeout: 20_000 });
    await closeArtifact(dialog);

    dialog = await beginArtifact(employeePage, 'site_diary', `Bautagebuch ${world.runId}`);
    await dialog.getByLabel('Fortschritt').fill('Zwischenstand noch ohne Arbeitstag.');
    await finishArtifact(dialog, false);
    await expect(dialog.getByText('Entwurf', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Neue Version' }).click();
    await typeIntoDatePickerById(dialog, 'artifact-work-date', DATES[0]);
    await dialog.getByLabel('Fortschritt').fill('Rohinstallation im Erdgeschoss abgeschlossen.');
    await dialog.getByLabel('Anwesende Personen').fill('Monteur, Bauleitung');
    await dialog.getByLabel('Wetter').fill('Trocken, 18 °C');
    await dialog.getByLabel('Bedingungen vor Ort').fill('Zugang frei und abgesichert.');
    await dialog.getByLabel('Lieferungen').fill('Rohrmaterial vollständig eingetroffen.');
    await dialog.getByLabel('Behinderungen').fill('Keine.');
    await dialog.getByLabel('Entscheidungen').fill('Steigstrang wird links geführt.');
    await dialog.getByLabel('Besondere Ereignisse').fill('Abnahme der Leitungsführung durch Bauleitung.');
    await dialog.getByRole('button', { name: 'Zur Prüfung einreichen', exact: true }).click();
    await expect(dialog.getByText(/Version 2/)).toBeVisible({ timeout: 20_000 });
    await closeArtifact(dialog);

    dialog = await beginArtifact(employeePage, 'work_report', `Arbeitsbericht ${world.runId}`);
    await typeIntoDateTimeField(dialog, 'artifact-visit-start', `${DATES[0]}T08:00`);
    await typeIntoDateTimeField(dialog, 'artifact-visit-end', `${DATES[0]}T10:30`);
    await dialog.getByLabel('Ausgeführte Arbeiten').fill('Wärmepumpe geprüft und Filter gereinigt.');
    await dialog.getByLabel('Offene Arbeiten').fill('Ersatzfilter beim nächsten Termin einsetzen.');
    await dialog.getByLabel('Materialhinweise').fill('Ein Filtereinsatz vorgemerkt.');
    await typeIntoDateTimeField(dialog, 'artifact-next-visit', `${DATES[1]}T09:00`);
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    dialog = await beginArtifact(employeePage, 'measurement', `Aufmaß ${world.runId}`);
    await dialog.getByRole('button', { name: 'Zur Prüfung einreichen', exact: true }).click();
    await expect(dialog.getByText('Bitte fülle die Pflichtangaben')).toBeVisible();
    await typeIntoDatePickerById(dialog, 'artifact-measurement-date', DATES[0]);
    await dialog.getByLabel('Aufmaßort').fill('Heizraum');
    await dialog.getByLabel('Aufmaßhinweise').fill('Lichte Maße vor Ort geprüft.');
    await dialog.getByRole('button', { name: 'Position ergänzen' }).click();
    await dialog.getByLabel('Bezeichnung').fill('Kupferrohr');
    await dialog.locator('#artifact-measurement-quantity-0').fill('12,5');
    await selectOption(employeePage, dialog.getByRole('combobox', { name: 'Aufmaßeinheit' }), 'm');
    await dialog.getByLabel('Ort', { exact: true }).fill('Technikraum Nord');
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    dialog = await beginArtifact(employeePage, 'defect', `Mangel ${world.runId}`);
    await dialog.getByLabel('Mangelbeschreibung').fill('Dämmung an der Vorlaufleitung ist beschädigt.');
    await dialog.getByLabel('Ort', { exact: true }).fill('Heizraum');
    await selectOption(employeePage, dialog.getByRole('combobox', { name: 'Schweregrad' }), 'Hoch');
    await typeIntoDatePickerById(dialog, 'artifact-due-date', berlinTodayIso());
    await dialog.getByLabel('Zuständigkeit').fill('Bauleitung vor Ort');
    await dialog.getByLabel('Vorgeschlagene Lösung').fill('Dämmung fachgerecht erneuern.');
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    await employeePage.goto(`/auftraege/projekt/${projectNumber}`);
    dialog = await beginArtifact(employeePage, 'change_work', `Regiearbeit ${world.runId}`);
    await dialog.getByLabel('Änderungs-/Regiearbeit').fill('Zusätzliche Absperrarmatur montieren.');
    await dialog.getByLabel('Grund', { exact: true }).fill('Leitungsführung wurde vor Ort geändert.');
    await dialog.getByLabel('Angefordert durch').fill('Bauleitung, mündlich vor Ort');
    await dialog.getByLabel('Erwartete Arbeitsminuten').fill('90');
    await dialog.getByLabel('Tatsächliche Arbeitsminuten').fill('105');
    await dialog.getByLabel('Erwartetes Material').fill('Eine Absperrarmatur');
    await dialog.getByLabel('Tatsächliches Material').fill('Eine Absperrarmatur und zwei Fittings');
    await selectOption(employeePage, dialog.getByRole('combobox', { name: 'Autorisierungsstand' }), 'Autorisiert');
    await dialog.getByLabel('Terminauswirkung').fill('Keine Auswirkung auf den Endtermin.');
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    const jobState = await getWorkArtifactState(world.orgId, { jobNumber });
    const activeArtifacts = jobState.artifacts.filter((row) => row.status !== 'voided');
    expect(activeArtifacts.map((row) => row.kind).sort()).toEqual(['defect', 'measurement', 'site_diary', 'work_report']);
    const activeSiteDiary = activeArtifacts.find((row) => row.kind === 'site_diary');
    expect(jobState.revisions.filter((row) => row.artifact_id === activeSiteDiary?.id)).toHaveLength(2);
    expect(jobState.artifacts.find((row) => row.status === 'voided')).toMatchObject({ created_by: world.users.employee.id });
    expect(jobState.measurements[0]).toMatchObject({ description: 'Kupferrohr', unit: 'meter' });
    expect(Number(jobState.measurements[0].quantity)).toBe(12.5);
    expect(jobState.defects[0]).toMatchObject({ severity: 'high', state: 'open', location: 'Heizraum' });
    expect(jobState.revisions.every((row) => row.artifact_id && row.created_by && row.created_at)).toBe(true);
    const siteDiaryRevision = jobState.revisions.find((row) => row.artifact_id === activeSiteDiary?.id);
    expect(siteDiaryRevision?.site_id).toBe((await getJobSiteContactState(world.orgId, jobNumber)).siteId);
    const projectState = await getWorkArtifactState(world.orgId, { projectNumber });
    expect(projectState.changes[0]).toMatchObject({ authorization_state: 'authorized', expected_labor_minutes: 90, actual_labor_minutes: 105 });

    const outsiderCounts = await getVisibleWorkArtifactCountsAs(world.outsider.admin, world.orgId);
    expect(Object.values(outsiderCounts).every((count) => count === 0)).toBe(true);
    await outsiderPage.goto(`/auftraege/${jobNumber}`);
    await expect(outsiderPage.getByTestId('work-artifacts-section')).toHaveCount(0);
  });

  test('immutable revisions, stale-write recovery, idempotent actions, and realtime catch-up', async ({
    adminPage, employeePage, bueroPage, world,
  }) => {
    test.setTimeout(300_000);
    // P1-15-F28…F40: explicit save/submit, atomic validation, immutable history,
    // correction reasons, no evidence inheritance, stale conflicts, idempotency,
    // and a resting list versus an open edited dialog.
    const jobNumber = `AUF-${world.runId}-P115`;
    const title = `Arbeitsbericht ${world.runId}`;
    await Promise.all([
      adminPage.goto(`/auftraege/${jobNumber}`),
      bueroPage.goto(`/auftraege/${jobNumber}`),
      employeePage.goto(`/auftraege/${jobNumber}`),
    ]);
    await adminPage.getByText(title, { exact: true }).click();
    await bueroPage.getByText(title, { exact: true }).click();
    const adminDialog = adminPage.getByRole('dialog');
    const bueroDialog = bueroPage.getByRole('dialog');
    await adminDialog.getByRole('button', { name: 'Neue Version' }).click();
    await bueroDialog.getByRole('button', { name: 'Neue Version' }).click();
    await adminDialog.getByLabel('Titel').fill(`${title} v2`);
    await adminDialog.getByLabel('Grund der neuen Version').fill('Leistungsumfang wurde vor Ort präzisiert.');
    await bueroDialog.getByLabel('Titel').fill(`${title} lokaler Entwurf`);
    await bueroDialog.getByLabel('Grund der neuen Version').fill('Lokale, noch nicht gespeicherte Korrektur.');
    await adminDialog.getByRole('button', { name: 'Als Entwurf speichern' }).click();
    await expect(adminDialog.getByText(/Version 2/)).toBeVisible({ timeout: 20_000 });
    await bueroDialog.getByRole('button', { name: 'Als Entwurf speichern' }).click();
    await expect(bueroDialog.getByText('Der Arbeitsnachweis wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten.')).toBeVisible();
    await expect(bueroDialog.getByLabel('Titel')).toHaveValue(`${title} lokaler Entwurf`);
    await bueroDialog.getByRole('button', { name: 'Schließen' }).first().click();
    await expect(bueroPage.getByText(`${title} v2`, { exact: true })).toBeVisible({ timeout: 20_000 });

    const state = await getWorkArtifactState(world.orgId, { jobNumber });
    const initialReportRevision = state.revisions.find((row) => row.title === title);
    const report = state.artifacts.find((row) => row.id === initialReportRevision?.artifact_id);
    const revisions = state.revisions.filter((row) => row.artifact_id === report?.id);
    expect(revisions).toHaveLength(2);
    expect(revisions.map((row) => row.title)).toEqual([title, `${title} v2`]);
    expect(revisions[1]).toMatchObject({ corrects_revision_id: revisions[0].id, correction_reason: 'Leistungsumfang wurde vor Ort präzisiert.' });
    expect(report).toMatchObject({ version: 2, status: 'draft', current_revision_id: revisions[1].id });
  });

  test('four-eyes responsibility, review outcomes, attention identity, and void history', async ({
    adminPage, employeePage, world,
  }) => {
    test.setTimeout(360_000);
    // P1-15-F41…F49 plus F36: shared responsibility, no self-approval,
    // approve/reject/correct/withdraw, stable attention links, and reasoned void.
    const jobNumber = `AUF-${world.runId}-P115`;
    const siteDiaryTitle = `Bautagebuch ${world.runId}`;
    await employeePage.goto(`/auftraege/${jobNumber}`);
    await employeePage.getByText(siteDiaryTitle, { exact: true }).click();
    await expect(employeePage.getByRole('button', { name: 'Intern freigeben' })).toHaveCount(0);
    await employeePage.getByRole('dialog').getByRole('button', { name: 'Schließen' }).first().click();

    await adminPage.goto('/aufgaben');
    await expect(adminPage.getByRole('link', { name: `Prüfung für ${siteDiaryTitle} öffnen` })).toBeVisible({ timeout: 20_000 });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByText(siteDiaryTitle, { exact: true }).click();
    const dialog = adminPage.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Intern freigeben' }).click();
    await expect(dialog.getByText('Intern freigegeben', { exact: false })).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Schließen' }).first().click();

    const approvedState = await getWorkArtifactState(world.orgId, { jobNumber });
    const siteDiary = approvedState.artifacts.find((row) => row.kind === 'site_diary');
    const approval = approvedState.actions.find((row) => row.artifact_id === siteDiary?.id && row.action_type === 'internal_approved');
    expect(approval?.responsibility_snapshot).toMatchObject({ responsibility: 'work_artifact_approval' });
    expect(approval?.created_by).toBe(world.users.admin.id);
    expect(siteDiary?.status).toBe('approved');

    await adminPage.getByText(`Aufmaß ${world.runId}`, { exact: true }).click();
    await dialog.locator('#artifact-action-reason').fill('Aufmaßort muss genauer bezeichnet werden.');
    await dialog.getByRole('button', { name: 'Korrektur anfordern' }).click();
    await expect(dialog.getByText('Korrektur angefordert', { exact: false })).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Schließen' }).first().click();
    await employeePage.goto('/aufgaben');
    await expect(employeePage.getByRole('link', { name: `Korrektur für Aufmaß ${world.runId} öffnen` })).toBeVisible({ timeout: 20_000 });

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByText(`Mangel ${world.runId}`, { exact: true }).click();
    await dialog.locator('#artifact-action-reason').fill('Zuständigkeit ist noch nicht eindeutig.');
    await dialog.getByRole('button', { name: 'Ablehnen' }).click();
    await expect(dialog.getByText('Abgelehnt', { exact: false })).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Schließen' }).first().click();

    await employeePage.goto(`/auftraege/projekt/PRJ-${world.runId}-P115`);
    await employeePage.getByText(`Regiearbeit ${world.runId}`, { exact: true }).click();
    const employeeDialog = employeePage.getByRole('dialog');
    await employeeDialog.getByRole('button', { name: 'Prüfung zurückziehen' }).click();
    await expect(employeeDialog.getByText('Entwurf', { exact: false })).toBeVisible({ timeout: 20_000 });
    await employeeDialog.getByRole('button', { name: 'Schließen' }).first().click();

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByText(`Mangel ${world.runId}`, { exact: true }).click();
    await dialog.locator('#artifact-action-reason').fill('Durch einen gültigen Folgevorgang ersetzt.');
    await dialog.getByRole('button', { name: 'Ungültig setzen' }).click();
    await expect(dialog.getByText(/Mangel · Ungültig · Version 1/)).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Schließen' }).first().click();
    await expect(adminPage.getByTestId('work-artifacts-section').getByRole('button', {
      name: new RegExp(`Mangel ${escapeRegExp(world.runId)}.*Ungültig`),
    })).toBeVisible();
  });

  test('customer outcomes, signature, document/source/evidence links, and deterministic export', async ({
    adminPage, employeePage, world,
  }) => {
    test.setTimeout(600_000);
    // P1-15-F17, F50…F70: independent customer/internal outcomes, named
    // offline signer context, on-device signature, explicit document/source
    // and checklist evidence links, reasoned removal, and idempotent HTML export.
    const templateName = `P115 Nachweisvorlage ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P115-EVIDENCE`;
    const jobTitle = `P115 Nachweisauftrag ${world.runId}`;
    const artifactTitle = `Kundenbericht ${world.runId}`;
    await createAndPublishWorkTemplate(adminPage, { name: templateName, targetType: 'job', firstItem: 'Inbetriebnahme dokumentieren', evidenceDescription: 'Abschlussbericht der Inbetriebnahme' });
    await createJob(adminPage, { jobNumber, title: jobTitle, assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`, workTemplateName: templateName });
    await uploadDocumentOnJobPage(employeePage, jobNumber, resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'), 'upload-fixture');
    await clockInOnJob(employeePage, jobTitle);
    await clockOut(employeePage);
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await expect(adminPage.getByTestId('work-artifacts-section')).toContainText('Noch keine Arbeitsnachweise erfasst.');
    await employeePage.goto(`/auftraege/${jobNumber}`);
    let dialog = await beginArtifact(employeePage, 'work_report', artifactTitle);
    await selectOption(employeePage, dialog.getByRole('combobox', { name: 'Sichtbarkeit des Arbeitsnachweises' }), 'Für Kundendokumentation');
    await selectOption(employeePage, dialog.getByRole('combobox', { name: 'Zugehörige Aufgabe oder Checkliste' }), 'Inbetriebnahme dokumentieren');
    await typeIntoDateTimeField(dialog, 'artifact-visit-start', `${DATES[2]}T07:30`);
    await typeIntoDateTimeField(dialog, 'artifact-visit-end', `${DATES[2]}T09:15`);
    await dialog.getByLabel('Ausgeführte Arbeiten').fill('Anlage in Betrieb genommen und Werte protokolliert.');
    await dialog.getByLabel('Kundenaussage').fill('Einweisung wurde vor Ort durchgeführt.');
    await dialog.getByText('Kundenentscheidung erforderlich').click();
    await dialog.getByText('Unterschrift erforderlich').click();
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    await adminPage.reload();
    await adminPage.waitForLoadState('networkidle');
    await expect(adminPage.getByText(artifactTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
    dialog = await openArtifactAfterReload(adminPage, artifactTitle);
    await dialog.getByRole('button', { name: 'Intern freigeben' }).click();
    await expect(dialog.getByText('Intern freigegeben', { exact: false })).toBeVisible({ timeout: 20_000 });
    await closeArtifact(dialog);
    await employeePage.reload();
    dialog = await openArtifactAfterReload(employeePage, artifactTitle);
    await dialog.getByText('Kundenentscheidung und Unterschrift').click();
    await expect(dialog.getByText('keine besondere Rechtswirksamkeit', { exact: false })).toBeVisible();
    await dialog.locator('#artifact-customer-name').fill('Erika Beispiel');
    await dialog.locator('#artifact-customer-role').fill('Objektleitung');
    await dialog.locator('#artifact-customer-relationship').fill('Bevollmächtigte Ansprechperson vor Ort');
    await dialog.getByRole('button', { name: 'Bestätigung erfassen' }).click();
    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).actions
      .filter((action) => action.action_type === 'customer_acknowledged').length).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Bestätigung erfassen' })).toBeEnabled();
    await dialog.locator('#artifact-action-reason').fill('Kundin bittet um Ergänzung der Seriennummer.');
    await dialog.getByRole('button', { name: 'Vorbehalt erfassen' }).click();
    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).actions
      .filter((action) => action.action_type === 'customer_reserved').length).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Bestätigung erfassen' })).toBeEnabled();
    await dialog.locator('#artifact-action-reason').fill('Kunde möchte erst nach eigener Prüfung bestätigen.');
    await dialog.getByRole('button', { name: 'Ablehnung erfassen' }).click();
    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).actions
      .filter((action) => action.action_type === 'customer_refused').length).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Bestätigung erfassen' })).toBeEnabled();

    const canvas = dialog.getByLabel('Unterschrift zeichnen');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Signature canvas has no bounding box');
    await employeePage.mouse.move(box.x + 20, box.y + 45);
    await employeePage.mouse.down();
    await employeePage.mouse.move(box.x + 120, box.y + 80, { steps: 8 });
    await employeePage.mouse.up();
    await expect(dialog.getByRole('button', { name: 'Zurücksetzen' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Unterschrift speichern' }).click();
    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).actions
      .filter((action) => action.action_type === 'signature_captured').length, { timeout: 60_000 }).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();

    await dialog.getByText('Dokument verknüpfen').click();
    await selectOption(employeePage, dialog.getByRole('combobox', { name: 'Dokument auswählen' }), 'upload-fixture.pdf');
    await dialog.getByRole('button', { name: 'Verknüpfen', exact: true }).first().click();
    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).documents
      .filter((document) => document.relation === 'supporting_evidence').length).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await dialog.getByText('Zeiteintrag verknüpfen').click();
    await dialog.getByRole('combobox', { name: 'Zeiteintrag auswählen' }).click();
    await employeePage.getByRole('option').first().click();
    await dialog.getByRole('button', { name: 'Verknüpfen', exact: true }).last().click();
    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).sources.length).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await dialog.getByText('Nachweiserwartung erfüllen').click();
    await dialog.getByRole('button', { name: /Mit Version 1 erfüllen/ }).click();
    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).fulfillments.length).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).actions
      .filter((action) => action.action_type === 'exported').length, { timeout: 60_000 }).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await Promise.all([
      employeePage.waitForResponse((response) => response.request().method() === 'POST'
        && response.url().includes(encodeURIComponent(jobNumber))),
      dialog.getByRole('button', { name: 'Export', exact: true }).click(),
    ]);
    await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).actions
      .filter((action) => action.action_type === 'exported').length).toBe(1);
    await closeArtifact(dialog);

    await employeePage.reload();
    await expect(employeePage.getByText(/^Nachweis erfüllt:/)).toBeVisible({ timeout: 20_000 });
    const state = await getWorkArtifactState(world.orgId, { jobNumber });
    const currentRevisionId = state.artifacts[0].current_revision_id;
    expect(state.actions.filter((row) => row.action_type === 'exported')).toHaveLength(1);
    expect(state.actions.filter((row) => ['customer_acknowledged', 'customer_reserved', 'customer_refused', 'signature_captured'].includes(row.action_type))).toHaveLength(4);
    expect(state.actions.filter((row) => row.signer_name).every((row) => row.signer_name === 'Erika Beispiel' && row.revision_id === currentRevisionId)).toBe(true);
    expect(state.documents.filter((row) => row.relation === 'rendered_export')).toHaveLength(1);
    expect(state.documents.find((row) => row.relation === 'rendered_export')).toMatchObject({ renderer_version: 'p1-15-html-v3' });
    expect(state.documents.find((row) => row.relation === 'rendered_export')?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.sources).toHaveLength(1);
    expect(state.fulfillments[0]).toMatchObject({ artifact_revision_id: currentRevisionId, removed_at: null });

    // P1-15-F71…F78: measurements, defects, formal decisions, customer gates,
    // approval dependency, shared cache/realtime projections, explicit non-effects,
    // and absence of later-slice modules from this surface.
    await adminPage.goto(`/auftraege/${jobNumber}`);
    const card = adminPage.getByTestId('work-lifecycle-card');
    await card.getByRole('button', { name: 'Abschlussprüfungen und Verlauf' }).click();
    await expect(card.getByText(/formale Freigaben offen/)).toBeVisible();
    const snapshot = (await getWorkLifecycleState(world.orgId, { jobNumber })).snapshot;
    expect(snapshot.gates.pendingFormalApprovals).toBe(0);
    expect(snapshot.gates.requiredCustomerDecisions).toBe(0);
    expect(snapshot.gates.requiredSignatures).toBe(0);
    expect(snapshot.gates.incompleteInstructionEvidence).toBe(0);

    await card.getByRole('button', { name: 'Voraussetzung', exact: true }).click();
    dialog = adminPage.getByRole('dialog');
    await selectOption(adminPage, dialog.locator('#dependency-type'), 'Deklarierte Voraussetzung');
    await selectFromSearchable(adminPage, dialog.locator('#dependency-target'), 'Freigabe');
    await dialog.locator('#dependency-description').fill('Interne Freigabe des Inbetriebnahmeberichts');
    await dialog.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    const dependencyRow = card.getByTestId('work-dependency-row').filter({ hasText: 'Interne Freigabe des Inbetriebnahmeberichts' });
    await expect(dependencyRow).toContainText('offen');
    await dependencyRow.getByRole('button', { name: 'Freigabe verknüpfen' }).click();
    dialog = adminPage.getByRole('dialog');
    await selectFromSearchable(adminPage, dialog.locator('#dependency-artifact-approval'), `Kundenbericht ${world.runId}`);
    await dialog.locator('#dependency-artifact-reason').fill('Aktuelle interne Freigabe erfüllt die dokumentierte Voraussetzung.');
    await dialog.getByRole('button', { name: 'Verknüpfen', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(dependencyRow).toContainText('erfüllt');

    const lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(lifecycle.dependencies.at(-1)).toMatchObject({ declared_kind: 'approval', isSatisfied: true });
    expect(lifecycle.dependencies.at(-1)?.artifact_approval_action_id).toBeTruthy();
    await expect(adminPage.getByTestId('work-artifacts-section')).toBeVisible();
    await expect(adminPage.getByText('Arbeitspack')).toHaveCount(0);
    await expect(adminPage.getByText('Geräteakte')).toHaveCount(0);
    await expect(adminPage.getByText('Rechnung erstellen')).toHaveCount(0);
  });
});
