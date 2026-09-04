import { expect, test } from '../../golden/support/fixtures';
import {
  getAppliedWorkTemplateState,
  getCustomerNumber,
  getJobCountByNumber,
  getRequestConversionState,
  getWorkTemplateApplicationCountForTarget,
  getWorkTemplateStateByName,
} from '../../golden/support/db';
import {
  convertRequestToJobViaDialog,
  createAndPublishWorkTemplate,
  createCustomer,
  createJob,
  createProject,
  createRequestViaDialog,
  inputByValue,
  selectFromSearchable,
  toggleInSearchableMulti,
} from '../../golden/support/steps';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { requireSerialPrecondition } from '../../golden/support/preconditions';
import {
  appendedTemplateItemCard,
  exactText,
  instructionCard,
  lastInstructionDetailsButton,
  materialArticlePicker,
  materialLocationPicker,
  templateItemCard,
  templateMaterialCard,
  templateQualificationRow,
  visibleExactText,
  visibleMatchingText,
} from '../support/p1-13-steps';

test.describe.configure({ mode: 'serial' });

function digits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

const DATES = Array.from({ length: 5 }, (_, index) => ownedBerlinDateAtOffset('p1-13', 70 + index));

async function workTemplateStateOrNull(organizationId: string, name: string) {
  try {
    return await getWorkTemplateStateByName(organizationId, name);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`No work template found for ${name}:`))
      return null;
    throw error;
  }
}

async function appliedTemplateStateOrNull(
  organizationId: string,
  input: { jobNumber?: string; projectNumber?: string }
) {
  try {
    return await getAppliedWorkTemplateState(organizationId, input);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Applied target lookup failed:'))
      return null;
    throw error;
  }
}

async function waitForAppliedTemplateState(
  organizationId: string,
  input: { jobNumber?: string; projectNumber?: string }
) {
  let state = await appliedTemplateStateOrNull(organizationId, input);
  await expect
    .poll(
      async () => {
        state = await appliedTemplateStateOrNull(organizationId, input);
        return state !== null;
      },
      { timeout: 20_000 }
    )
    .toBe(true);
  if (!state) throw new Error('Applied work-template state did not settle after creation.');
  return state;
}

async function customerExists(organizationId: string, customerName: string): Promise<boolean> {
  try {
    await getCustomerNumber(organizationId, customerName);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`Customer ${customerName} not found:`))
      return false;
    throw error;
  }
}

test.describe('P1-13 exhaustive work-template flows @AUDIT-W2-P1-13 @AUDIT-W2', () => {
  test('empty state, role denial, validation, creation, filters, and safe realtime catch-up', async ({
    adminPage,
    bueroPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    // P1-13-F01, F02, F03, F09, F26, F27.
    await outsiderPage.goto('/arbeitsvorlagen');
    await expect(visibleExactText(outsiderPage, 'Erste Arbeitsvorlage anlegen')).toBeVisible();
    await expect(exactText(outsiderPage, 'Heizungswartung Standard')).toHaveCount(0);
    await employeePage.goto('/arbeitsvorlagen');
    await expect(employeePage).toHaveURL(/\/dashboard/);

    await bueroPage.goto('/arbeitsvorlagen');
    await bueroPage.getByRole('button', { name: 'Vorlage erstellen', exact: true }).click();
    await expect(bueroPage.getByRole('dialog')).toBeVisible();

    await adminPage.goto('/arbeitsvorlagen');
    await adminPage.getByRole('button', { name: 'Vorlage erstellen', exact: true }).click();
    const dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Arbeitsvorlage erstellen',
      }),
    });
    await dialog.getByRole('button', { name: 'Erstellen', exact: true }).click();
    const templateName = dialog.locator('#new-template-name');
    await expect(dialog.getByText('Bitte gib einen Namen an.')).toBeVisible();
    await expect(templateName).toHaveAttribute('aria-invalid', 'true');
    await expect(templateName).toBeFocused();
    await templateName.fill(`Audit Wartung ${world.runId}`);
    await dialog
      .locator('#new-template-description')
      .fill(`Wiederkehrende Projektarbeit ${world.runId}`);
    await dialog.locator('#new-template-target').click();
    await adminPage.getByRole('option', { name: 'Projekte', exact: true }).click();
    await dialog.getByRole('button', { name: 'Erstellen', exact: true }).click();
    const editor = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: /Entwurf · Version 1/ }),
    });
    await expect(editor.getByRole('heading', { name: /Entwurf · Version 1/ })).toBeVisible({
      timeout: 20_000,
    });
    await editor.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
    await expect(
      editor.getByText('Füge mindestens eine Aufgabe oder einen Checklistenpunkt hinzu.')
    ).toBeVisible();
    await editor.locator('form').getByRole('button', { name: 'Schließen', exact: true }).click();

    // Realtime must not interrupt the open Büro dialog; after close its list catches up.
    await expect(bueroPage.getByRole('dialog')).toBeVisible();
    await bueroPage.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(visibleExactText(bueroPage, `Audit Wartung ${world.runId}`)).toBeVisible({
      timeout: 20_000,
    });
    await bueroPage
      .getByLabel('Arbeitsvorlagen suchen')
      .fill(`Wiederkehrende Projektarbeit ${world.runId}`);
    await expect(visibleExactText(bueroPage, `Audit Wartung ${world.runId}`)).toBeVisible();
    await bueroPage.getByRole('combobox', { name: 'Ziel filtern' }).click();
    await bueroPage.getByRole('option', { name: 'Nur Projekte' }).click();
    await bueroPage.getByRole('combobox', { name: 'Status filtern' }).click();
    await bueroPage.getByRole('option', { name: 'Entwürfe' }).click();
    await expect(visibleExactText(bueroPage, `Audit Wartung ${world.runId}`)).toBeVisible();
    await bueroPage.getByLabel('Arbeitsvorlagen suchen').fill('nicht vorhanden');
    await expect(
      visibleExactText(bueroPage, 'Keine Arbeitsvorlage passt zu Suche und Filtern.')
    ).toBeVisible();
  });

  test('draft content covers tasks, evidence, material, qualifications, dependencies, and immutable publish', async ({
    adminPage,
    world,
  }) => {
    // P1-13-F04, F05, F06, F07, F08, F10.
    const name = `Audit Komplett ${world.runId}`;
    await createAndPublishWorkTemplate(adminPage, {
      name,
      targetType: 'job',
      firstItem: 'Sicherheitsprüfung',
      secondItem: 'Messung dokumentieren',
      evidenceDescription: 'Foto des Messgeräts',
    });
    await adminPage.goto('/arbeitsvorlagen');
    await adminPage.getByLabel('Arbeitsvorlagen suchen').fill(name);
    await adminPage.getByRole('button', { name: 'Öffnen', exact: true }).click();
    let editor = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: `${name} · Version 1`,
        exact: true,
      }),
    });
    await editor.getByRole('button', { name: 'Neue Version' }).click();
    await expect(editor).toHaveCount(0, { timeout: 15_000 });
    await adminPage.getByRole('button', { name: 'Öffnen', exact: true }).click();
    editor = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: /Entwurf · Version 2/ }),
    });

    const safetyCard = await templateItemCard(editor, 'Sicherheitsprüfung');
    await safetyCard.getByRole('combobox', { name: 'Art für Sicherheitsprüfung' }).click();
    await adminPage.getByRole('option', { name: 'Checkliste', exact: true }).click();
    await safetyCard.getByLabel('Gruppe').fill('Inbetriebnahme');
    await safetyCard.getByLabel('Hinweise').fill('Vor Ort mit dem Kunden abstimmen.');
    await editor.getByRole('button', { name: 'Eintrag', exact: true }).click();
    const appendedItemCard = appendedTemplateItemCard(editor);
    await appendedItemCard.getByLabel('Bezeichnung').fill('Temporärer Punkt');
    await appendedItemCard.getByRole('button', { name: 'Eintrag löschen' }).click();
    await expect(editor.getByLabel('Bezeichnung')).toHaveCount(2);
    await safetyCard.getByRole('button', { name: 'Eintrag nach unten' }).click();

    const safetyDependency = editor.getByRole('combobox', {
      name: 'Voraussetzungen für Sicherheitsprüfung',
    });
    await toggleInSearchableMulti(adminPage, safetyDependency, ['Messung dokumentieren']);
    await editor.getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(editor.getByText('Abhängigkeiten dürfen keinen Kreis bilden.')).toBeVisible();
    await toggleInSearchableMulti(adminPage, safetyDependency, ['Messung dokumentieren']);
    await safetyCard.getByLabel('Dokumentkategorie').click();
    await adminPage.getByRole('option', { name: 'Bericht', exact: true }).click();

    await editor.getByRole('button', { name: 'Material', exact: true }).click();
    const materialCard = templateMaterialCard(editor);
    await materialArticlePicker(materialCard).click();
    await adminPage.getByRole('button', { name: 'Neuen Artikel erstellen' }).click();
    const itemDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Artikel erstellen' }),
    });
    await itemDialog.locator('#quick-item-name').fill(`Dichtung ${world.runId}`);
    await itemDialog.getByRole('button', { name: 'Erstellen' }).click();
    await expect(itemDialog).toHaveCount(0, { timeout: 15_000 });
    await materialLocationPicker(materialCard).click();
    await adminPage.getByRole('button', { name: 'Neues Lager erstellen' }).click();
    const locationDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Lager erstellen' }),
    });
    await locationDialog.locator('#quick-location-name').fill(`Servicewagen ${world.runId}`);
    await locationDialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(locationDialog).toHaveCount(0, { timeout: 15_000 });
    await materialCard.locator('input[id^="quantity-"]').fill('3');
    await materialCard.getByRole('checkbox').click();
    await materialCard.getByLabel('Notiz').fill('Nur für die Einsatzplanung.');

    await editor.getByRole('button', { name: 'Qualifikation', exact: true }).click();
    const qualificationRow = templateQualificationRow(editor);
    await qualificationRow.getByRole('combobox').click();
    await adminPage.getByRole('button', { name: 'Neue Qualifikation erstellen' }).click();
    const capabilityDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Qualifikation erstellen',
      }),
    });
    await capabilityDialog.locator('#quick-capability-name').fill(`Gasprüfung ${world.runId}`);
    await capabilityDialog.getByRole('combobox', { name: 'Art der Qualifikation' }).click();
    await adminPage.getByRole('option', { name: 'Zertifizierung', exact: true }).click();
    await capabilityDialog.getByRole('button', { name: 'Erstellen' }).click();
    await expect(capabilityDialog).toHaveCount(0, { timeout: 15_000 });
    await qualificationRow.getByRole('checkbox').click();
    await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(visibleExactText(adminPage, 'Entwurf gespeichert.')).toBeVisible({
      timeout: 20_000,
    });
    await editor.getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(editor).toHaveCount(0, { timeout: 20_000 });

    const state = await getWorkTemplateStateByName(world.orgId, name);
    expect(state.versions).toHaveLength(2);
    expect(state.versions.every((version) => version.status === 'published')).toBe(true);
    expect(state.materials).toHaveLength(1);
    expect(state.capabilities).toHaveLength(1);
    expect(state.evidence).toHaveLength(2);
    expect(state.dependencies).toHaveLength(2);
    const latestVersionId = state.versions[1].id;
    const latestItems = state.items.filter((item) => item.version_id === latestVersionId);
    expect(latestItems.map((item) => item.content)).toEqual([
      'Messung dokumentieren',
      'Sicherheitsprüfung',
    ]);
    expect(latestItems[1]).toMatchObject({
      item_kind: 'checklist',
      group_label: 'Inbetriebnahme',
      notes: 'Vor Ort mit dem Kunden abstimmen.',
    });
    expect(state.materials[0]).toMatchObject({
      planned_quantity: 3,
      is_billable: false,
      notes: 'Nur für die Einsatzplanung.',
    });
    expect(state.materials[0].preferred_location_id).not.toBeNull();
    expect(state.capabilities[0].require_confirmation).toBe(true);
  });

  test('version history, archive/reactivation, picker application on create, and snapshot meaning persist', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-13-F11, F12, F13, F14, F19, F20, F21, F22.
    const name = `Audit Komplett ${world.runId}`;
    const templatePrecondition = await workTemplateStateOrNull(world.orgId, name);
    requireSerialPrecondition(templatePrecondition !== null, {
      test: 'P1-13-F11',
      needs: 'the published Audit Komplett template created by the draft-content test',
      grep: 'draft content covers|version history',
      suite: 'audit',
    });
    const jobNumber = `AUF-${world.runId}-P113-70`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await createJob(adminPage, {
      jobNumber,
      title: `Audit Vorlage ${world.runId}`,
      assignEmployeeName: employeeName,
      plannedDateDigits: digits(DATES[0]),
      workTemplateName: name,
      qualificationOverrideReason: 'Abweichung für den vollständigen Auditfluss.',
    });
    let state = await waitForAppliedTemplateState(world.orgId, { jobNumber });
    expect(state.applications).toHaveLength(1);
    expect(state.materials).toHaveLength(1);
    expect(state.capabilities).toHaveLength(1);
    expect(state.capabilityOrigins).toHaveLength(1);
    expect(state.evidence).toHaveLength(1);
    expect(state.dependencies).toHaveLength(1);
    expect(state.inventoryMovements).toHaveLength(0);
    expect(state.planningOccurrences).toHaveLength(1);
    expect(state.assignments).toHaveLength(1);
    expect(state.timeEntries).toHaveLength(0);
    expect(state.timeSegments).toHaveLength(0);
    expect(state.documentLinks).toHaveLength(0);
    expect(state.materials[0].taken_quantity).toBe(0);
    expect(state.materials[0].returned_quantity).toBe(0);
    expect(state.qualificationAssessments).toHaveLength(1);
    expect(state.qualificationAssessments[0].override_reason).toBe(
      'Abweichung für den vollständigen Auditfluss.'
    );
    expect(state.qualificationAssessments[0].coverage_fingerprint).toBeTruthy();

    await employeePage.goto(`/auftraege/${jobNumber}`);
    await expect(visibleExactText(employeePage, 'Sicherheitsprüfung')).toBeVisible();
    await expect(visibleExactText(employeePage, 'Messung dokumentieren')).toBeVisible();
    await expect(visibleMatchingText(employeePage, /Aufgabe · Optional/)).toBeVisible();
    await expect(visibleExactText(employeePage, 'Voraussetzung: Sicherheitsprüfung')).toBeVisible();
    await expect(visibleMatchingText(employeePage, /Nachweis erwartet:/)).toBeVisible();
    const safetyInstruction = instructionCard(employeePage, 'Sicherheitsprüfung');
    await safetyInstruction.getByRole('button', { name: 'Punkt als erledigt markieren' }).click();
    await expect
      .poll(
        async () =>
          (await getAppliedWorkTemplateState(world.orgId, { jobNumber })).instructions.find(
            (item) => item.content === 'Sicherheitsprüfung'
          )?.is_completed,
        { timeout: 20_000 }
      )
      .toBe(true);
    await employeePage.reload();
    await expect(
      instructionCard(employeePage, 'Sicherheitsprüfung').getByRole('button', {
        name: 'Punkt als offen markieren',
      })
    ).toBeVisible();
    state = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    const completedInstruction = state.instructions.find(
      (item) => item.content === 'Sicherheitsprüfung'
    );
    expect(completedInstruction?.last_status_changed_by).toBe(world.users.employee.id);
    expect(completedInstruction?.last_status_changed_at).toBeTruthy();

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await expect(
      adminPage.getByRole('heading', { name: `Audit Vorlage ${world.runId}` })
    ).toBeVisible({ timeout: 20_000 });
    const detailButtons = adminPage.getByRole('button', {
      name: 'Eintragsdetails bearbeiten',
    });
    await expect(detailButtons).toHaveCount(2);
    const detailsDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Eintragsdetails bearbeiten',
      }),
    });
    await expect(async () => {
      if (!(await detailsDialog.isVisible().catch(() => false)))
        await lastInstructionDetailsButton(adminPage).click();
      await expect(detailsDialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await detailsDialog.locator('#instruction-group').fill('Vor Ort geändert');
    await detailsDialog.locator('#instruction-notes').fill('Am Auftrag individuell ergänzt.');
    await detailsDialog.getByLabel('Nachweisbeschreibung').fill('Foto direkt am Auftrag');
    await detailsDialog.getByLabel('Nachweiskategorie').click();
    await adminPage.getByRole('option', { name: 'Sonstiges', exact: true }).click();
    await detailsDialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(detailsDialog).toHaveCount(0, { timeout: 15_000 });
    await adminPage.reload();
    await expect(visibleMatchingText(adminPage, /Vor Ort geändert/)).toBeVisible();
    state = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    const editedInstruction = state.instructions.find(
      (item) => item.content === 'Sicherheitsprüfung'
    )!;
    expect(editedInstruction.group_label).toBe('Vor Ort geändert');
    expect(editedInstruction.notes).toBe('Am Auftrag individuell ergänzt.');
    expect(state.evidence[0]).toMatchObject({
      description: 'Foto direkt am Auftrag',
      document_category: 'other',
    });
    expect(state.evidence[0].source_work_template_evidence_id).not.toBeNull();

    await adminPage.getByRole('button', { name: 'Position bearbeiten' }).click();
    const materialDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Materialposition bearbeiten',
      }),
    });
    await materialDialog.locator('input[id$="-quantity"]').fill('4');
    await materialDialog.locator('textarea[id$="-notes"]').fill('Am Auftrag angepasst.');
    await materialDialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(materialDialog).toHaveCount(0, { timeout: 20_000 });
    await adminPage
      .getByRole('button', {
        name: `${`Gasprüfung ${world.runId}`} als Anforderung entfernen`,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await getAppliedWorkTemplateState(world.orgId, { jobNumber })).capabilities.length,
        { timeout: 20_000 }
      )
      .toBe(0);
    state = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    expect(state.materials[0]).toMatchObject({
      planned_quantity: 4,
      notes: 'Am Auftrag angepasst.',
    });
    expect(state.capabilities).toHaveLength(0);

    await adminPage.goto('/arbeitsvorlagen');
    await adminPage.getByLabel('Arbeitsvorlagen suchen').fill(name);
    await adminPage.getByRole('button', { name: 'Öffnen', exact: true }).click();
    let templateEditor = adminPage.getByRole('dialog');
    await templateEditor.getByRole('button', { name: 'Neue Version' }).click();
    await expect(templateEditor).toHaveCount(0, { timeout: 15_000 });
    await adminPage.getByRole('button', { name: 'Öffnen', exact: true }).click();
    templateEditor = adminPage.getByRole('dialog');
    await (
      await inputByValue(templateEditor, 'Bezeichnung', 'Messung dokumentieren')
    ).fill('Messung in neuer Vorlage');
    await templateEditor.getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(templateEditor).toHaveCount(0, { timeout: 20_000 });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await expect(visibleExactText(adminPage, 'Messung dokumentieren')).toBeVisible();
    await expect(exactText(adminPage, 'Messung in neuer Vorlage')).toHaveCount(0);

    await adminPage.goto('/arbeitsvorlagen');
    await adminPage.getByLabel('Arbeitsvorlagen suchen').fill(name);
    await adminPage.getByRole('button', { name: 'Arbeitsvorlage archivieren' }).click();
    await expect
      .poll(
        async () => (await getWorkTemplateStateByName(world.orgId, name)).template.archived_at,
        { timeout: 20_000 }
      )
      .not.toBeNull();
    await adminPage.goto('/auftraege');
    await adminPage.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await adminPage.getByRole('tab', { name: 'Auftrag erstellen' }).click();
    await adminPage.getByRole('dialog').getByLabel('Arbeitsvorlage (optional)').click();
    await expect(adminPage.getByRole('listbox').getByText(name, { exact: true })).toHaveCount(0);
    await adminPage.keyboard.press('Escape');
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Schließen', exact: true })
      .click();
    await adminPage.goto('/arbeitsvorlagen');
    await adminPage.getByLabel('Arbeitsvorlagen suchen').fill(name);
    await adminPage.getByRole('combobox', { name: 'Status filtern' }).click();
    await adminPage.getByRole('option', { name: 'Archiv' }).click();
    await expect(visibleExactText(adminPage, name)).toBeVisible();
    await adminPage.getByRole('button', { name: 'Arbeitsvorlage reaktivieren' }).click();
    // Poll like the archive step above: the immediate read raced the
    // reactivation commit on the fast local stack (2026-08-28).
    await expect
      .poll(
        async () => (await getWorkTemplateStateByName(world.orgId, name)).template.archived_at,
        { timeout: 20_000 }
      )
      .toBeNull();
    const templateState = await getWorkTemplateStateByName(world.orgId, name);
    expect(templateState.template.archived_at).toBeNull();
    expect(templateState.events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(['draft_created', 'archived', 'reactivated'])
    );
    expect(templateState.events.every((event) => event.actor_id && event.created_at)).toBe(true);
    const appliedEvent = templateState.events.find((event) => event.event_type === 'applied')!;
    expect(appliedEvent.application_id).not.toBeNull();
    expect(appliedEvent.event_payload).toMatchObject({
      jobId: state.targetId,
      versionNumber: 2,
    });
    expect(state.applications[0].template_version_id).toBe(templateState.versions[1].id);
    await adminPage.getByRole('combobox', { name: 'Status filtern' }).click();
    await adminPage.getByRole('option', { name: 'Aktive Vorlagen' }).click();
    await adminPage.getByRole('button', { name: 'Öffnen', exact: true }).click();
    await expect(
      adminPage.getByRole('dialog').getByText(`${jobNumber} · Audit Vorlage ${world.runId}`, {
        exact: true,
      })
    ).toBeVisible();
  });

  test('after-creation preview, duplicate/additional warnings, and project-direct rows are persisted', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    // P1-13-F17, F18, F23, F24.
    const completeTemplateState = await workTemplateStateOrNull(
      world.orgId,
      `Audit Komplett ${world.runId}`
    );
    requireSerialPrecondition(
      Boolean(
        completeTemplateState?.versions.length === 3 &&
        completeTemplateState.items.some((item) => item.content === 'Messung in neuer Vorlage')
      ),
      {
        test: 'P1-13-F17',
        needs:
          'the published Audit Komplett V3 snapshot created by the draft and version-history tests',
        grep: 'draft content covers|version history|after-creation preview',
        suite: 'audit',
      }
    );
    const jobNumber = `AUF-${world.runId}-P113-71`;
    await createJob(adminPage, {
      jobNumber,
      title: `Nachträglich ${world.runId}`,
      plannedDateDigits: digits(DATES[1]),
    });
    let state = await waitForAppliedTemplateState(world.orgId, { jobNumber });
    const occurrenceCountBeforeApplication = state.planningOccurrences.length;
    expect(state.applications).toHaveLength(0);
    expect(state.instructions).toHaveLength(0);
    await bueroPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByRole('button', { name: 'Vorlage anwenden' }).click();
    const dialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Arbeitsvorlage anwenden',
      }),
    });
    await selectFromSearchable(
      adminPage,
      dialog.getByRole('combobox'),
      `Audit Komplett ${world.runId}`
    );
    await expect(dialog.getByText(/Aufgaben\/Checklistenpunkte/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Anwenden', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect
      .poll(
        async () => {
          state = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
          return state.applications.length;
        },
        { timeout: 20_000 }
      )
      .toBe(1);
    expect(state.applications).toHaveLength(1);
    expect(state.planningOccurrences).toHaveLength(occurrenceCountBeforeApplication);
    await expect(visibleExactText(bueroPage, 'Messung in neuer Vorlage')).toBeVisible({
      timeout: 25_000,
    });

    await adminPage.getByRole('button', { name: 'Vorlage anwenden' }).click();
    const duplicateDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Arbeitsvorlage anwenden',
      }),
    });
    await selectFromSearchable(
      adminPage,
      duplicateDialog.getByRole('combobox'),
      `Audit Komplett ${world.runId}`
    );
    await expect(
      duplicateDialog.getByText('Diese Version wurde bereits angewendet.')
    ).toBeVisible();
    await expect(
      duplicateDialog.getByRole('button', { name: 'Anwenden', exact: true })
    ).toBeDisabled();
    await duplicateDialog.getByRole('button', { name: 'Abbrechen' }).click();

    const additionalTemplate = `Audit Zusatz ${world.runId}`;
    await createAndPublishWorkTemplate(adminPage, {
      name: additionalTemplate,
      targetType: 'job',
      firstItem: 'Zusätzliche Sichtprüfung',
    });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByRole('button', { name: 'Vorlage anwenden' }).click();
    const additionalDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Arbeitsvorlage anwenden',
      }),
    });
    await selectFromSearchable(
      adminPage,
      additionalDialog.getByRole('combobox'),
      additionalTemplate
    );
    await expect(
      additionalDialog.getByText('Weitere Vorlage ergänzen. Vorhandene Planung bleibt bestehen.')
    ).toBeVisible();
    await expect(
      additionalDialog.getByRole('button', { name: 'Anwenden', exact: true })
    ).toBeDisabled();
    await additionalDialog.getByRole('checkbox').click();
    await additionalDialog.getByRole('button', { name: 'Anwenden', exact: true }).click();
    await expect(additionalDialog).toHaveCount(0, { timeout: 20_000 });
    state = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    expect(state.applications).toHaveLength(2);
    expect(state.instructions.map((item) => item.content)).toContain('Zusätzliche Sichtprüfung');

    const projectTemplate = `Audit Projekt ${world.runId}`;
    await createAndPublishWorkTemplate(adminPage, {
      name: projectTemplate,
      targetType: 'project',
      firstItem: 'Projektstart dokumentieren',
    });
    await adminPage.goto('/arbeitsvorlagen');
    await adminPage.getByLabel('Arbeitsvorlagen suchen').fill(projectTemplate);
    await adminPage.getByRole('button', { name: 'Öffnen', exact: true }).click();
    let projectEditor = adminPage.getByRole('dialog');
    await projectEditor.getByRole('button', { name: 'Neue Version' }).click();
    await expect(projectEditor).toHaveCount(0, { timeout: 15_000 });
    await adminPage.getByRole('button', { name: 'Öffnen', exact: true }).click();
    projectEditor = adminPage.getByRole('dialog');
    await projectEditor.getByRole('button', { name: 'Material', exact: true }).click();
    await selectFromSearchable(
      adminPage,
      materialArticlePicker(templateMaterialCard(projectEditor)),
      `Dichtung ${world.runId}`
    );
    await projectEditor.getByRole('button', { name: 'Qualifikation', exact: true }).click();
    await selectFromSearchable(
      adminPage,
      templateQualificationRow(projectEditor).getByRole('combobox'),
      `Gasprüfung ${world.runId}`
    );
    await projectEditor.getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(projectEditor).toHaveCount(0, { timeout: 20_000 });
    const projectNumber = `PRJ-${world.runId}-P113-72`;
    await createProject(adminPage, {
      projectNumber,
      title: `Audit Projekt ${world.runId}`,
      workTemplateName: projectTemplate,
    });
    const projectState = await getAppliedWorkTemplateState(world.orgId, {
      projectNumber,
    });
    expect(projectState.instructions.map((item) => item.content)).toEqual([
      'Projektstart dokumentieren',
    ]);
    expect(projectState.instructions[0].work_template_application_id).not.toBeNull();
    expect(projectState.materials).toHaveLength(1);
    expect(projectState.capabilities).toHaveLength(1);
    expect(projectState.capabilityOrigins).toHaveLength(1);
    expect(projectState.inventoryMovements).toHaveLength(0);
    expect(projectState.projectJobs).toHaveLength(0);
    const childJobNumber = `AUF-${world.runId}-P113-72`;
    await createJob(adminPage, {
      jobNumber: childJobNumber,
      title: `Späterer Unterauftrag ${world.runId}`,
      projectNumber,
    });
    const childState = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: childJobNumber,
    });
    expect(childState.applications).toHaveLength(0);
    expect(childState.instructions).toHaveLength(0);
    expect(childState.materials).toHaveLength(0);
    expect(childState.capabilities).toHaveLength(0);
  });

  test('request conversion applies atomically and every shared creation context exposes the optional picker', async ({
    adminPage,
    world,
  }) => {
    // P1-13-F15, F16.
    const projectNumber = `PRJ-${world.runId}-P113-72`;
    const projectPrecondition = await appliedTemplateStateOrNull(world.orgId, {
      projectNumber,
    });
    requireSerialPrecondition(projectPrecondition !== null, {
      test: 'P1-13-F15',
      needs: 'the template-backed project created by the after-creation test',
      grep: 'draft content covers|version history|after-creation preview|request conversion applies atomically',
      suite: 'audit',
    });
    const customerName = `Audit Kunde ${world.runId}`;
    await createCustomer(adminPage, customerName);
    const requestNumber = `ANF-${world.runId}-P113`;
    await createRequestViaDialog(adminPage, {
      summary: `Vorlagenanfrage ${world.runId}`,
      requestNumber,
      clientName: customerName,
    });
    await convertRequestToJobViaDialog(adminPage, {
      workTemplateName: `Audit Komplett ${world.runId}`,
      plannedDate: DATES[3],
    });
    const conversion = await getRequestConversionState(world.orgId, requestNumber);
    expect(conversion.status).toBe('umgewandelt');
    expect(conversion.convertedJobId).not.toBeNull();
    expect(
      await getWorkTemplateApplicationCountForTarget(world.orgId, {
        jobId: conversion.convertedJobId!,
      })
    ).toBe(1);

    await adminPage.goto('/kunden');
    await adminPage.getByRole('row').filter({ hasText: customerName }).click();
    const customerCreateButton = adminPage.getByRole('button', {
      name: 'Erstellen',
      exact: true,
    });
    await expect(customerCreateButton).toBeVisible({ timeout: 15_000 });
    await customerCreateButton.click();
    await adminPage.getByRole('tab', { name: 'Auftrag erstellen' }).click();
    await expect(adminPage.getByRole('dialog').getByLabel('Arbeitsvorlage (optional)')).toBeVisible(
      { timeout: 15_000 }
    );
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Schließen', exact: true })
      .click();

    await adminPage.goto('/mitarbeiter');
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRow = adminPage.getByRole('row').filter({ hasText: employeeName });
    await expect(employeeRow).toBeVisible({ timeout: 15_000 });
    await employeeRow.getByRole('link', { name: employeeName }).click();
    const employeeCreateButton = adminPage.getByRole('button', {
      name: 'Auftrag erstellen',
    });
    await expect(employeeCreateButton).toBeVisible({ timeout: 15_000 });
    await employeeCreateButton.click();
    await expect(adminPage.getByRole('dialog').getByLabel('Arbeitsvorlage (optional)')).toBeVisible(
      { timeout: 15_000 }
    );
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Schließen', exact: true })
      .click();

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    const projectCreateButton = adminPage.getByRole('button', {
      name: 'Auftrag hinzufügen',
    });
    await expect(projectCreateButton).toBeVisible({ timeout: 15_000 });
    await projectCreateButton.click();
    await expect(adminPage.getByRole('dialog').getByLabel('Arbeitsvorlage (optional)')).toBeVisible(
      { timeout: 15_000 }
    );
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Schließen', exact: true })
      .click();

    await adminPage.goto('/kalender');
    const calendarCreateButton = adminPage.getByRole('button', {
      name: 'Kalendereintrag',
      exact: true,
    });
    await expect(calendarCreateButton).toBeVisible({ timeout: 15_000 });
    await calendarCreateButton.click();
    const calendarDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Kalendereintrag erstellen',
      }),
    });
    await calendarDialog.getByRole('tab', { name: 'Auftrag erstellen' }).click();
    await expect(calendarDialog.locator('#work-template-job')).toBeVisible({
      timeout: 15_000,
    });
    await calendarDialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  });

  test('retired references fail atomically while role and organization boundaries stay closed', async ({
    adminPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    // P1-13-F16, F24, F25, F26.
    const customerName = `Audit Kunde ${world.runId}`;
    const [additionalTemplateState, originalJobState, hasCustomer] = await Promise.all([
      workTemplateStateOrNull(world.orgId, `Audit Zusatz ${world.runId}`),
      appliedTemplateStateOrNull(world.orgId, {
        jobNumber: `AUF-${world.runId}-P113-70`,
      }),
      customerExists(world.orgId, customerName),
    ]);
    requireSerialPrecondition(
      additionalTemplateState !== null && originalJobState !== null && hasCustomer,
      {
        test: 'P1-13-F25',
        needs:
          'the complete template chain, original applied job, additional template, and customer from the earlier tests',
        grep: 'draft content covers|version history|after-creation preview|request conversion applies atomically|retired references fail atomically',
        suite: 'audit',
      }
    );
    await outsiderPage.goto('/auftraege');
    await outsiderPage.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await outsiderPage.getByRole('tab', { name: 'Auftrag erstellen' }).click();
    await expect(
      visibleMatchingText(outsiderPage, /Noch keine passende Vorlage veröffentlicht\./)
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      outsiderPage.getByRole('link', { name: 'Arbeitsvorlagen verwalten' })
    ).toHaveAttribute('href', '/arbeitsvorlagen');
    await expect(exactText(outsiderPage, `Audit Komplett ${world.runId}`)).toHaveCount(0);

    await employeePage.goto(`/auftraege/AUF-${world.runId}-P113-70`);
    await expect(employeePage.getByRole('button', { name: 'Vorlage anwenden' })).toHaveCount(0);

    await adminPage.goto('/mitarbeiter');
    await adminPage.getByRole('tab', { name: 'Qualifikationen', exact: true }).click();
    const capabilityRow = adminPage
      .getByTestId('capability-definition-row')
      .filter({ hasText: `Gasprüfung ${world.runId}` });
    await expect(capabilityRow).toBeVisible({ timeout: 15_000 });
    await capabilityRow.getByRole('button', { name: 'Archivieren' }).click();
    await expect(visibleExactText(adminPage, 'Der Begriff wurde archiviert.')).toBeVisible({
      timeout: 20_000,
    });

    const failedRequestNumber = `ANF-${world.runId}-P113-F`;
    await createRequestViaDialog(adminPage, {
      summary: `Fehlerhafte Vorlagenanfrage ${world.runId}`,
      requestNumber: failedRequestNumber,
      clientName: customerName,
    });
    await adminPage.getByRole('button', { name: 'Umwandeln' }).click();
    const conversionDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Anfrage umwandeln' }),
    });
    await selectFromSearchable(
      adminPage,
      conversionDialog.locator('#work-template-job'),
      `Audit Komplett ${world.runId}`
    );
    await expect(conversionDialog.locator('#convert-number')).toHaveValue(/.+/, {
      timeout: 15_000,
    });
    const failedJobNumber = await conversionDialog.locator('#convert-number').inputValue();
    await conversionDialog.getByRole('button', { name: 'In Auftrag umwandeln' }).click();
    await expect(
      conversionDialog.getByText('Die Arbeitsvorlage verweist auf nicht mehr aktive Stammdaten.')
    ).toBeVisible({ timeout: 20_000 });
    const requestState = await getRequestConversionState(world.orgId, failedRequestNumber);
    expect(requestState.status).toBe('offen');
    expect(requestState.convertedJobId).toBeNull();
    expect(await getJobCountByNumber(world.orgId, failedJobNumber)).toBe(0);
    await conversionDialog
      .locator('form')
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();

    const cleanJobNumber = `AUF-${world.runId}-P113-74`;
    await createJob(adminPage, {
      jobNumber: cleanJobNumber,
      title: `Referenzprüfung ${world.runId}`,
      plannedDateDigits: digits(DATES[4]),
    });
    await adminPage.goto(`/auftraege/${cleanJobNumber}`);
    await adminPage.getByRole('button', { name: 'Vorlage anwenden' }).click();
    const applyDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Arbeitsvorlage anwenden',
      }),
    });
    await selectFromSearchable(
      adminPage,
      applyDialog.getByRole('combobox'),
      `Audit Komplett ${world.runId}`
    );
    await applyDialog.getByRole('button', { name: 'Anwenden', exact: true }).click();
    await expect(
      applyDialog.getByText(
        `„Gasprüfung ${world.runId}“ ist nicht mehr aktiv. Korrigiere die Vorlage und versuche es erneut.`
      )
    ).toBeVisible({ timeout: 20_000 });
    let cleanState = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: cleanJobNumber,
    });
    expect(cleanState.applications).toHaveLength(0);
    expect(cleanState.instructions).toHaveLength(0);
    expect(cleanState.materials).toHaveLength(0);
    expect(cleanState.capabilities).toHaveLength(0);
    await applyDialog.getByRole('button', { name: 'Abbrechen' }).click();
    await adminPage.getByRole('button', { name: 'Vorlage anwenden' }).click();
    const retryDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', {
        name: 'Arbeitsvorlage anwenden',
      }),
    });
    await selectFromSearchable(
      adminPage,
      retryDialog.getByRole('combobox'),
      `Audit Zusatz ${world.runId}`
    );
    await retryDialog.getByRole('button', { name: 'Anwenden', exact: true }).click();
    await expect(retryDialog).toHaveCount(0, { timeout: 20_000 });
    cleanState = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: cleanJobNumber,
    });
    expect(cleanState.applications).toHaveLength(1);
    expect(cleanState.instructions.map((item) => item.content)).toEqual([
      'Zusätzliche Sichtprüfung',
    ]);
  });
});
