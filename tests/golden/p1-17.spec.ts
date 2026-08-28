import { resolve } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, test } from './support/fixtures';
import {
  getAppliedWorkTemplateState,
  getDispatchState,
  getVisibleWorkHandoverCountsAs,
  getWorkArtifactState,
  getWorkHandoverState,
  getWorkLifecycleState,
} from './support/db';
import {
  acknowledgeDispatchOnJobPage,
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  changeTimeOnWorkPack,
  createAndPublishWorkTemplate,
  createCustomer,
  createJob,
  createPlannedCalendarEntry,
  dispatchParkedJobFromParkplatz,
  openCustomerDetail,
  openFieldWorkPack,
  openParkplatzPanel,
  parkJobOnJobPage,
  planMaterialOnJobPage,
  selectAllHandoverSources,
  setInstructionCompletionOnJobPage,
  takeMaterialOnJobPage,
  transitionWorkOnJobPage,
  typeIntoDatePickerById,
  typeIntoDateTimeField,
  uploadDocumentOnJobPage,
} from './support/steps';
import type { TestWorld } from './support/world';

test.describe.configure({ mode: 'serial' });

function berlinDateAfter(days: number): string {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000)
    .toISOString().slice(0, 10);
}

const DATES = Array.from({ length: 5 }, (_, index) => berlinDateAfter(90 + index));

function names(world: TestWorld) {
  return {
    customerName: `P117 Golden Kunde ${world.runId}`,
    contactName: `P117 Golden Kontakt ${world.runId}`,
    siteName: `P117 Golden Heizzentrale ${world.runId}`,
    templateName: `P117 Golden Vorlage ${world.runId}`,
    instruction: `Anlage sicher übergeben ${world.runId}`,
    jobNumber: `AUF-${world.runId}-P117-GOLDEN`,
    jobTitle: `P117 Golden Einsatz ${world.runId}`,
    reportTitle: `P117 Kundenbericht ${world.runId}`,
    measurementTitle: `P117 Aufmaß ${world.runId}`,
    defectTitle: `P117 Mangel ${world.runId}`,
    changeTitle: `P117 Regienachweis ${world.runId}`,
    internalTitle: `P117 INTERN ${world.runId}`,
    employeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
  };
}

async function selectOption(page: Page, trigger: Locator, name: string): Promise<void> {
  await trigger.click();
  await page.getByRole('option', { name, exact: true }).click();
}

async function beginArtifact(
  page: Page,
  kind: string,
  title: string,
  customerFacing = true
): Promise<Locator> {
  await page.getByTestId('work-artifacts-section').getByRole('button', { name: 'Neu' }).click();
  const dialog = page.getByRole('dialog');
  await selectOption(page, dialog.getByRole('combobox', { name: 'Art des Arbeitsnachweises' }), kind);
  if (customerFacing) {
    await selectOption(
      page,
      dialog.getByRole('combobox', { name: 'Sichtbarkeit des Arbeitsnachweises' }),
      'Für Kundendokumentation'
    );
  }
  await dialog.getByLabel('Titel').fill(title);
  await dialog.getByLabel('Zusammenfassung').fill(`Kundenfähiger Nachweis ${title}`);
  return dialog;
}

async function submitAndClose(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Zur Prüfung einreichen', exact: true }).click();
  await expect(dialog.getByText(/Version 1/)).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).first().click();
}

async function approveArtifact(page: Page, title: string): Promise<void> {
  await page.getByText(title, { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Intern freigeben' }).click();
  await expect(dialog.getByText('Intern freigegeben', { exact: false })).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).first().click();
}

async function completeWithManagerOverride(page: Page, jobNumber: string): Promise<void> {
  await page.goto(`/auftraege/${encodeURIComponent(jobNumber)}`);
  await page.getByTestId('work-lifecycle-card')
    .getByRole('button', { name: 'Ausführung abgeschlossen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const overrideCheckbox = dialog.getByRole('checkbox').first();
  if (await overrideCheckbox.isVisible().catch(() => false)) {
    await overrideCheckbox.check();
  }
  await dialog.locator('#work-transition-reason')
    .fill('Offene Nachweise werden transparent an die Übergabeprüfung weitergegeben.');
  await dialog.getByRole('button', { name: 'Änderung speichern' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

async function releaseCurrentDraft(page: Page): Promise<string> {
  const section = page.getByTestId('work-handover-section');
  await selectAllHandoverSources(section);
  await section.getByRole('button', { name: 'Entwurf speichern' }).click();
  await expect(section.getByText('Entwurf gespeichert.')).toBeVisible({ timeout: 20_000 });
  await expect(section).toContainText('Offene Prüfpunkte');
  await expect(section).toContainText('Nicht automatisch bewertet');
  const override = section.getByLabel('Begründung der Ausnahme');
  if (await override.isVisible().catch(() => false)) {
    await override.fill('Offener Mangel und fehlende Unterschrift sind im Paket klar ausgewiesen.');
  }
  const popupPromise = page.waitForEvent('popup');
  await section.getByRole('button', { name: 'Vorschau öffnen' }).click();
  const preview = await popupPromise;
  await preview.waitForLoadState('domcontentloaded');
  await expect(section.getByText('Vorschau erstellt.', { exact: false })).toBeVisible({ timeout: 20_000 });
  const html = await preview.locator('body').innerText();
  await section.getByRole('button', { name: 'Freigeben und übergeben' }).click();
  await expect(section.getByText('Übergabepaket freigegeben', { exact: false })).toBeVisible({ timeout: 30_000 });
  await preview.close();
  return html;
}

test.describe('P1-17 field execution and office handover @P1-17 @GG-04', () => {
  test('creates the persisted template, dispatch, and target context @P1-17-stage-setup', async ({
    adminPage, employeePage, world,
  }) => {
    test.setTimeout(420_000);
    // P1-17-F01…F22: target, role, contact, template, schedule, dispatch,
    // assignment and side-effect-free initial handover state.
    const fixture = names(world);
    await createCustomer(adminPage, fixture.customerName);
    await openCustomerDetail(adminPage, fixture.customerName);
    await addContactOnCustomerDetail(adminPage, {
      name: fixture.contactName,
      role: 'Objektleitung',
      phone: '+49 30 5550170',
      email: `p117-${world.runId}@example.test`,
      notes: 'Interne Kontaktnotiz darf nie in das Kundenpaket.',
      isPrimary: true,
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.siteName,
      street: 'Übergabestraße 17',
      postalCode: '10115',
      city: 'Berlin',
      notes: 'Interne Standortnotiz darf nie in das Kundenpaket.',
      isPrimary: true,
    });
    await createAndPublishWorkTemplate(adminPage, {
      name: fixture.templateName,
      targetType: 'job',
      firstItem: fixture.instruction,
      evidenceDescription: 'Kundenfähiger Abschlussbericht',
    });
    await createJob(adminPage, {
      jobNumber: fixture.jobNumber,
      title: fixture.jobTitle,
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      contactName: fixture.contactName,
      assignEmployeeName: fixture.employeeName,
      workTemplateName: fixture.templateName,
    });
    await planMaterialOnJobPage(
      adminPage, fixture.jobNumber, world.inventory.itemName, world.inventory.locationName, 2
    );
    await parkJobOnJobPage(
      adminPage,
      fixture.jobNumber,
      'Einsatz bleibt bis zur disponierten Übergabeplanung geparkt.',
      world.users.admin.firstName,
      DATES[0]
    );
    await openParkplatzPanel(adminPage);
    await dispatchParkedJobFromParkplatz(adminPage, {
      jobTitle: fixture.jobTitle,
      recipientName: fixture.employeeName,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit', jobSearch: fixture.jobNumber, date: DATES[0], time: '06:00',
      employeeNames: [fixture.employeeName],
      overrideReason: 'P1-17 deterministischer Einsatztermin.',
    });
    await acknowledgeDispatchOnJobPage(employeePage, fixture.jobNumber);
    await adminPage.goto(`/auftraege/${fixture.jobNumber}`);
    await adminPage.getByTestId('work-lifecycle-card')
      .getByRole('button', { name: 'Weiterplanen' }).click();
    const unparkDialog = adminPage.getByRole('dialog');
    await unparkDialog.locator('#work-reason')
      .fill('Einsatz ist disponiert und kann ausgeführt werden.');
    await unparkDialog.getByRole('button', { name: 'Weiterführen' }).click();
    await expect(unparkDialog).toHaveCount(0, { timeout: 20_000 });

    const [dispatch, handover] = await Promise.all([
      getDispatchState(world.orgId, fixture.jobNumber),
      getWorkHandoverState(world.orgId, { jobNumber: fixture.jobNumber }),
    ]);
    expect(dispatch.dispatches).toHaveLength(1);
    expect(handover.package).toBeNull();
  });

  test('executes work and captures the GG-04 evidence set @P1-17-stage-execution', async ({
    adminPage, employeePage, world,
  }) => {
    test.setTimeout(720_000);
    // P1-17-F23…F57: assigned execution, checklist, time/material, photo,
    // measurement, defect/change, customer refusal, approval and privacy.
    const fixture = names(world);
    expect((await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: fixture.jobNumber,
    })).instructions).toHaveLength(1);
    const pack = await openFieldWorkPack(employeePage, fixture.jobNumber);
    await transitionWorkOnJobPage(employeePage, 'In Ausführung');
    await setInstructionCompletionOnJobPage(employeePage, fixture.instruction, true);
    await changeTimeOnWorkPack(employeePage, 'start');
    await changeTimeOnWorkPack(employeePage, 'stop');
    await takeMaterialOnJobPage(employeePage, fixture.jobNumber, world.inventory.itemName, 1);
    await uploadDocumentOnJobPage(
      employeePage,
      fixture.jobNumber,
      resolve(process.cwd(), 'public/logo-icon-light.svg'),
      'logo-icon-light'
    );

    let dialog = await beginArtifact(employeePage, 'Arbeitsbericht', fixture.reportTitle);
    await typeIntoDateTimeField(dialog, 'artifact-visit-start', `${DATES[0]}T06:00`);
    await typeIntoDateTimeField(dialog, 'artifact-visit-end', `${DATES[0]}T08:00`);
    await dialog.getByLabel('Ausgeführte Arbeiten').fill('Anlage geprüft und übergabefähig dokumentiert.');
    await dialog.getByText('Kundenentscheidung erforderlich').click();
    await dialog.getByText('Unterschrift erforderlich').click();
    await submitAndClose(dialog);

    dialog = await beginArtifact(employeePage, 'Aufmaß', fixture.measurementTitle);
    await typeIntoDatePickerById(dialog, 'artifact-measurement-date', DATES[0]);
    await dialog.getByLabel('Aufmaßort').fill('Heizzentrale');
    await dialog.getByRole('button', { name: 'Position ergänzen' }).click();
    await dialog.getByLabel('Bezeichnung').fill('Kupferrohr');
    await dialog.locator('#artifact-measurement-quantity-0').fill('4,5');
    await selectOption(employeePage, dialog.getByRole('combobox', { name: 'Aufmaßeinheit' }), 'm');
    await submitAndClose(dialog);

    dialog = await beginArtifact(employeePage, 'Mangel', fixture.defectTitle);
    await dialog.getByLabel('Mangelbeschreibung').fill('Dämmung muss nachgearbeitet werden.');
    await dialog.getByLabel('Ort', { exact: true }).fill('Heizzentrale');
    await selectOption(employeePage, dialog.getByRole('combobox', { name: 'Schweregrad' }), 'Mittel');
    await submitAndClose(dialog);

    dialog = await beginArtifact(employeePage, 'Regie-/Änderungsnachweis', fixture.changeTitle);
    await dialog.getByLabel('Änderungs-/Regiearbeit').fill('Zusätzliche Absperrung dokumentiert.');
    await dialog.getByLabel('Grund', { exact: true }).fill('Leitungsführung wurde vor Ort präzisiert.');
    await dialog.getByLabel('Angefordert durch').fill('Objektleitung vor Ort');
    await submitAndClose(dialog);

    dialog = await beginArtifact(employeePage, 'Arbeitsbericht', fixture.internalTitle, false);
    await dialog.getByLabel('Ausgeführte Arbeiten').fill('INTERNES-GEHEIMNIS-P117');
    await dialog.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).first().click();

    await adminPage.goto(`/auftraege/${fixture.jobNumber}`);
    for (const title of [
      fixture.reportTitle, fixture.measurementTitle, fixture.defectTitle, fixture.changeTitle,
    ]) {
      await approveArtifact(adminPage, title);
    }
    await employeePage.reload();
    await employeePage.getByText(fixture.reportTitle, { exact: true }).click();
    dialog = employeePage.getByRole('dialog');
    await dialog.getByText('Kundenentscheidung und Unterschrift').click();
    await dialog.locator('#artifact-customer-name').fill('Erika Beispiel');
    await dialog.locator('#artifact-action-reason')
      .fill('Kundin bestätigt die Arbeiten, lehnt eine digitale Unterschrift jedoch ab.');
    await dialog.getByRole('button', { name: 'Ablehnung erfassen' }).click();
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).first().click();

    const artifacts = await getWorkArtifactState(world.orgId, { jobNumber: fixture.jobNumber });
    expect(artifacts.measurements).toHaveLength(1);
    expect(artifacts.defects).toHaveLength(1);
    expect(artifacts.changes).toHaveLength(1);
    expect(artifacts.actions.some((action) => action.action_type === 'customer_refused')).toBe(true);
    await expect(pack).toBeVisible({ timeout: 20_000 });
    await expect(pack).not.toContainText('INTERNES-GEHEIMNIS-P117');
  });

  test('reviews, previews, and atomically releases the exact package @P1-17-stage-handover', async ({
    adminPage, employeePage, world,
  }) => {
    test.setTimeout(420_000);
    // P1-17-F58…F88: completion versus handover, classified gates, exact
    // sources, preview privacy, reasoned override, immutable release and field projection.
    const fixture = names(world);
    const before = await getWorkLifecycleState(world.orgId, { jobNumber: fixture.jobNumber });
    const executionState = before.entity && 'execution_state' in before.entity
      ? before.entity.execution_state
      : null;
    expect(['in_progress', 'execution_complete', 'handed_over']).toContain(executionState);
    if (executionState === 'handed_over') {
      const retainedRelease = await getWorkHandoverState(world.orgId, {
        jobNumber: fixture.jobNumber,
      });
      expect(retainedRelease.releases).toHaveLength(1);
      const retainedFieldPack = await openFieldWorkPack(employeePage, fixture.jobNumber);
      await expect(retainedFieldPack).toContainText('An das Büro übergeben');
      await expect(retainedFieldPack.getByRole('button', {
        name: 'Übergabedokument',
      })).toBeVisible();
      return;
    }
    if (executionState === 'in_progress') {
      await completeWithManagerOverride(adminPage, fixture.jobNumber);
    }
    await adminPage.goto(`/auftraege/${fixture.jobNumber}`);
    const summary = adminPage.getByTestId('work-handover-summary');
    await expect(summary.getByRole('link', { name: 'Übergabe prüfen' })).toBeVisible();
    await summary.getByRole('link', { name: 'Übergabe prüfen' }).click();
    const section = adminPage.getByTestId('work-handover-section');
    await expect(section).not.toContainText(fixture.internalTitle);
    const previewText = await releaseCurrentDraft(adminPage);
    expect(previewText).toContain(fixture.customerName);
    expect(previewText).toContain(fixture.contactName);
    expect(previewText).not.toContain('INTERNES-GEHEIMNIS-P117');
    expect(previewText).not.toContain('Interne Kontaktnotiz');

    const handover = await getWorkHandoverState(world.orgId, { jobNumber: fixture.jobNumber });
    expect(handover.target).toMatchObject({ execution_state: 'handed_over' });
    expect(handover.package).toMatchObject({ state: 'released', current_release_id: handover.releases[0].id });
    expect(handover.releases).toHaveLength(1);
    expect(handover.releaseItems.length).toBeGreaterThanOrEqual(5);
    expect(handover.documents).toHaveLength(1);
    expect(handover.releases[0].commercial_readiness).toBe('ready_with_exceptions');
    expect(handover.releases[0].target_snapshot).toMatchObject({
      customerName: fixture.customerName,
      contactName: fixture.contactName,
    });
    expect(handover.releases[0].time_summary).toMatchObject({ Quellenfingerabdruck: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(handover.releases[0].material_summary).toMatchObject({ Quellenfingerabdruck: expect.stringMatching(/^[0-9a-f]{64}$/) });

    const fieldPack = await openFieldWorkPack(employeePage, fixture.jobNumber);
    await expect(fieldPack).toContainText('An das Büro übergeben');
    await expect(fieldPack.getByRole('button', { name: 'Übergabedokument' })).toBeVisible();
  });

  test('withdraws, corrects, and re-releases without rewriting history @P1-17-stage-reopen', async ({
    adminPage, world,
  }) => {
    test.setTimeout(420_000);
    // P1-17-F89…F101: reasoned withdrawal, correction reopening, successor
    // draft/release, predecessor linkage and preserved lifecycle/package events.
    const fixture = names(world);
    await adminPage.goto(`/auftraege/${fixture.jobNumber}/uebergabe`);
    const section = adminPage.getByTestId('work-handover-section');
    await section.getByLabel('Grund für die Rücknahme')
      .fill('Seriennummer muss nach dem Termin ergänzt werden.');
    await section.getByRole('button', { name: 'Übergabe zurücknehmen' }).click();
    await expect(section.getByText('Übergabe zurückgenommen.', { exact: false })).toBeVisible({ timeout: 20_000 });
    await adminPage.reload();
    const reopenSection = adminPage.getByTestId('work-handover-section');
    await reopenSection.getByLabel('Ausführung erneut öffnen')
      .fill('Techniker ergänzt die Seriennummer vor Ort.');
    await reopenSection.getByRole('button', { name: 'Zur Korrektur in Ausführung geben' }).click();
    await expect(reopenSection.getByText('Ausführung zur Korrektur geöffnet.'))
      .toBeVisible({ timeout: 20_000 });

    await completeWithManagerOverride(adminPage, fixture.jobNumber);
    await adminPage.goto(`/auftraege/${fixture.jobNumber}/uebergabe`);
    await releaseCurrentDraft(adminPage);
    const state = await getWorkHandoverState(world.orgId, { jobNumber: fixture.jobNumber });
    expect(state.releases).toHaveLength(2);
    expect(state.releases[1].previous_release_id).toBe(state.releases[0].id);
    expect(state.events.map((event) => event.event_type)).toEqual(expect.arrayContaining([
      'released', 'handover_withdrawn', 'review_returned', 'execution_reopened',
    ]));
    expect(state.target).toMatchObject({ execution_state: 'handed_over' });
  });

  test('enforces responsibility and organization boundaries @P1-17-stage-boundaries', async ({
    employeePage, outsiderPage, bueroPage, world,
  }) => {
    test.setTimeout(180_000);
    // P1-17-F102…F109: office continuity, assigned-field minimalism,
    // non-reviewer route denial, outsider RLS, history visibility and zero widening.
    const fixture = names(world);
    await bueroPage.goto(`/auftraege/${fixture.jobNumber}/uebergabe`);
    await expect(bueroPage.getByTestId('work-handover-section')).toContainText('Freigabeverlauf (2)');
    await employeePage.goto(`/auftraege/${fixture.jobNumber}/uebergabe`);
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await outsiderPage.goto(`/auftraege/${fixture.jobNumber}/uebergabe`);
    await outsiderPage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    const outsiderCounts = await getVisibleWorkHandoverCountsAs(world.outsider.admin, world.orgId);
    expect(Object.values(outsiderCounts).every((count) => count === 0)).toBe(true);
    const state = await getWorkHandoverState(world.orgId, { jobNumber: fixture.jobNumber });
    expect(state.releases).toHaveLength(2);
    expect(state.releaseItems.every((item) => item.customer_label !== fixture.internalTitle)).toBe(true);
    expect(state.documents.every((document) => document.storage_path.includes('/work-handover-packages/'))).toBe(true);
  });
});
