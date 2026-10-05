import { expect, test } from '../support/fixtures';
import { ERROR_MESSAGES } from '../../../components/arbeitsvorlagen/work-template-editor-shared';
import { getCapabilityKindLabel } from '../../../lib/qualifications/types';
import { seedCustomer } from '../../golden/support/db/customers';
import {
  retireOrganizationCapability,
  seedOrganizationCertification,
} from '../../golden/support/db/qualifications';
import { getRequestConversionState, seedRequest } from '../../golden/support/db/requests';
import {
  getAppliedWorkTemplateState,
  getWorkTemplateApplicationCountForTarget,
  getWorkTemplateStateByName,
  seedJob,
  seedProject,
  seedPublishedWorkTemplate,
} from '../../golden/support/db/work';
import {
  calendarEntryDialog,
  calendarNewEntryButton,
  entryDialogTab,
} from '../../golden/support/steps/calendar';
import { dismissDialog, pressKey } from '../../golden/support/steps/interaction';
import { materialRowQuantity } from '../../golden/support/steps/inventory';
import { openSeededCustomerDetail } from '../../golden/support/steps/customers';
import {
  convertRequestToJobViaDialog,
  convertToJobSubmit,
  requestConversionDialog,
  requestConvertButton,
} from '../../golden/support/steps/requests';
import {
  selectFromSearchable,
  SHARED_COPY,
  testData,
  toggleInSearchableMulti,
  visibleMatchingText,
} from '../../golden/support/steps/shared';
import {
  createAndPublishWorkTemplate,
  createJob,
  createProject,
  evidenceCategoryOption,
  instructionPrerequisiteText,
  jobInstructionDetailsButtons,
  jobInstructionDetailsDialog,
  jobInstructionDetailsField,
  jobInstructionItem,
  jobInstructionToggle,
  lastJobInstructionDetailsButton,
  workCreateButton,
  workCreateTab,
  workTemplateCreateButton,
  workTemplateCreateDialog,
  workTemplateDraftEditor,
  workTemplateDraftHeading,
  workTemplateEditor,
  workTemplateEditorAction,
  workTemplateItemAction,
  workTemplateItemField,
  workTemplateItemKind,
  workTemplateItemKindOption,
  workTemplateItemNames,
  workTemplateItemPrerequisites,
  workTemplateOpenButton,
  workTemplatePicker,
  workTemplateProjectTargetOption,
  workTemplateSearch,
  workTemplateSelect,
} from '../../golden/support/steps/work';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import {
  appendedTemplateItemCard,
  applyTemplateDialog,
  exactText,
  materialArticlePicker,
  materialLocationPicker,
  materialPositionDialog,
  removeCapabilityRequirementButton,
  retiredCapabilityRefusal,
  TEMPLATE_AUDIT_COPY,
  templateItemCard,
  templateMaterialCard,
  templateQualificationRow,
  templateQuickCreateDialog,
  visibleExactText,
} from '../support/p1-13-steps';

function digits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

const { list, filterOption, quickCreate, apply, context } = TEMPLATE_AUDIT_COPY;

// The journey (publish, create from a template, field completion, new version
// for future work only) lives in tests/golden/p1-13.spec.ts. Immutability,
// snapshot side effects, atomic failure and read boundaries are database rules
// in supabase/tests/p1_13_work_templates.sql.
test.describe('P1-13 exhaustive work-template flows @AUDIT-W2-P1-13 @AUDIT-W2', () => {
  test('empty state, role denial, validation, creation, filters, and safe realtime catch-up', async ({
    adminPage,
    bueroPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    // P1-13-F01, F02, F03, F09, F26, F27.
    const templateName = `Audit Wartung ${world.runId}`;
    await outsiderPage.goto('/arbeitsvorlagen');
    await expect(visibleExactText(outsiderPage, list.empty)).toBeVisible();
    await expect(exactText(outsiderPage, templateName)).toHaveCount(0);
    await employeePage.goto('/arbeitsvorlagen');
    await expect(employeePage).toHaveURL(/\/dashboard/);

    await bueroPage.goto('/arbeitsvorlagen');
    await workTemplateCreateButton(bueroPage).click();
    await expect(bueroPage.getByRole('dialog')).toBeVisible();

    await adminPage.goto('/arbeitsvorlagen');
    await workTemplateCreateButton(adminPage).click();
    const dialog = workTemplateCreateDialog(adminPage);
    await dialog.getByRole('button', { name: SHARED_COPY.action.create, exact: true }).click();
    const templateNameInput = dialog.locator('#new-template-name');
    await expect(dialog.getByText(TEMPLATE_AUDIT_COPY.createDialog.nameRequired)).toBeVisible();
    await expect(templateNameInput).toHaveAttribute('aria-invalid', 'true');
    await expect(templateNameInput).toBeFocused();
    await templateNameInput.fill(templateName);
    await dialog.locator('#new-template-description').fill(`Wiederkehrende Projektarbeit ${world.runId}`);
    await dialog.locator('#new-template-target').click();
    await workTemplateProjectTargetOption(adminPage).click();
    await dialog.getByRole('button', { name: SHARED_COPY.action.create, exact: true }).click();
    const editor = workTemplateDraftEditor(adminPage, 1);
    await expect(workTemplateDraftHeading(editor, 1)).toBeVisible({
      timeout: 20_000,
    });
    await workTemplateEditorAction(editor, 'publish', { exact: true }).click();
    await expect(editor.getByText(ERROR_MESSAGES.work_template_item_required)).toBeVisible();
    await workTemplateEditorAction(editor.locator('form'), 'close', { exact: true }).click();

    // Realtime must not interrupt the open Büro dialog; after close its list catches up.
    await expect(bueroPage.getByRole('dialog')).toBeVisible();
    await bueroPage.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
    await expect(visibleExactText(bueroPage, templateName)).toBeVisible({
      timeout: 20_000,
    });
    await workTemplateSearch(bueroPage).fill(`Wiederkehrende Projektarbeit ${world.runId}`);
    await expect(visibleExactText(bueroPage, templateName)).toBeVisible();
    await bueroPage.getByRole('combobox', { name: list.targetFilter }).click();
    await bueroPage.getByRole('option', { name: filterOption.onlyProjects }).click();
    await bueroPage.getByRole('combobox', { name: list.statusFilter }).click();
    await bueroPage.getByRole('option', { name: filterOption.drafts }).click();
    await expect(visibleExactText(bueroPage, templateName)).toBeVisible();
    await workTemplateSearch(bueroPage).fill('nicht vorhanden');
    await expect(visibleExactText(bueroPage, list.noMatch)).toBeVisible();
  });

  test('draft content covers tasks, evidence, material, qualifications, dependencies, and publish', async ({
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
    await workTemplateSearch(adminPage).fill(name);
    await workTemplateOpenButton(adminPage).click();
    let editor = workTemplateEditor(adminPage, name, 1);
    await workTemplateEditorAction(editor, 'newVersion').click();
    await expect(editor).toHaveCount(0, { timeout: 15_000 });
    await workTemplateOpenButton(adminPage).click();
    editor = workTemplateDraftEditor(adminPage, 2);

    const safetyCard = await templateItemCard(editor, 'Sicherheitsprüfung');
    await workTemplateItemKind(safetyCard, 'Sicherheitsprüfung').click();
    await workTemplateItemKindOption(adminPage, 'checklist').click();
    await workTemplateItemField(safetyCard, 'group').fill('Inbetriebnahme');
    await workTemplateItemField(safetyCard, 'notes').fill('Vor Ort mit dem Kunden abstimmen.');
    await workTemplateEditorAction(editor, 'addItem', { exact: true }).click();
    const appendedItemCard = appendedTemplateItemCard(editor);
    await workTemplateItemField(appendedItemCard, 'name').fill('Temporärer Punkt');
    await workTemplateItemAction(appendedItemCard, 'delete').click();
    await expect(workTemplateItemNames(editor)).toHaveCount(2);
    await workTemplateItemAction(safetyCard, 'moveDown').click();

    const safetyDependency = workTemplateItemPrerequisites(editor, 'Sicherheitsprüfung');
    await toggleInSearchableMulti(adminPage, safetyDependency, ['Messung dokumentieren']);
    await workTemplateEditorAction(editor, 'publish').click();
    await expect(editor.getByText(ERROR_MESSAGES.work_template_dependency_cycle)).toBeVisible();
    await toggleInSearchableMulti(adminPage, safetyDependency, ['Messung dokumentieren']);
    await workTemplateItemField(safetyCard, 'documentCategory').click();
    await evidenceCategoryOption(adminPage, 'report').click();

    await workTemplateEditorAction(editor, 'addMaterial', { exact: true }).click();
    const materialCard = templateMaterialCard(editor);
    await materialArticlePicker(materialCard).click();
    await adminPage.getByRole('button', { name: quickCreate.newItem }).click();
    const itemDialog = templateQuickCreateDialog(adminPage, 'item');
    await itemDialog.locator('#quick-item-name').fill(`Dichtung ${world.runId}`);
    await itemDialog.getByRole('button', { name: SHARED_COPY.action.create }).click();
    await expect(itemDialog).toHaveCount(0, { timeout: 15_000 });
    await materialLocationPicker(materialCard).click();
    await adminPage.getByRole('button', { name: quickCreate.newLocation }).click();
    const locationDialog = templateQuickCreateDialog(adminPage, 'location');
    const locationName = locationDialog.locator('#quick-location-name');
    await locationName.fill(`Servicewagen ${world.runId}`);
    await pressKey(locationDialog, 'Enter', { into: locationName });
    await expect(locationDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(editor).toBeVisible();
    await materialCard.locator('input[id^="quantity-"]').fill('3');
    await materialCard.getByRole('checkbox').click();
    await materialCard.getByLabel(TEMPLATE_AUDIT_COPY.material.notes).fill('Nur für die Einsatzplanung.');

    await workTemplateEditorAction(editor, 'addCapability', { exact: true }).click();
    const qualificationRow = templateQualificationRow(editor);
    await qualificationRow.getByRole('combobox').click();
    await adminPage.getByRole('button', { name: quickCreate.newCapability }).click();
    const capabilityDialog = templateQuickCreateDialog(adminPage, 'capability');
    await capabilityDialog.locator('#quick-capability-name').fill(`Gasprüfung ${world.runId}`);
    await capabilityDialog.getByRole('combobox', { name: quickCreate.capabilityKind }).click();
    await adminPage
      .getByRole('option', { name: getCapabilityKindLabel('certification'), exact: true })
      .click();
    await capabilityDialog.getByRole('button', { name: SHARED_COPY.action.create }).click();
    await expect(capabilityDialog).toHaveCount(0, { timeout: 15_000 });
    await qualificationRow.getByRole('checkbox').click();
    await workTemplateEditorAction(editor, 'save', { exact: true }).click();
    await expect(visibleExactText(adminPage, TEMPLATE_AUDIT_COPY.editor.draftSaved)).toBeVisible({
      timeout: 20_000,
    });
    await workTemplateEditorAction(editor, 'publish').click();
    await expect(editor).toHaveCount(0, { timeout: 20_000 });

    const state = await getWorkTemplateStateByName(world.orgId, name);
    const latestVersion = expectDefined(state.versions[1], 'the second template version');
    expect(latestVersion.status).toBe('published');
    const latestItems = state.items.filter((item) => item.version_id === latestVersion.id);
    expect(latestItems.map((item) => item.content)).toEqual(['Messung dokumentieren', 'Sicherheitsprüfung']);
    expect(latestItems[1]).toMatchObject({
      item_kind: 'checklist',
      group_label: 'Inbetriebnahme',
      notes: 'Vor Ort mit dem Kunden abstimmen.',
    });
    expect(state.materials).toEqual([
      expect.objectContaining({
        version_id: latestVersion.id,
        planned_quantity: 3,
        is_billable: false,
        notes: 'Nur für die Einsatzplanung.',
        preferred_location_id: expect.any(String),
      }),
    ]);
    expect(state.capabilities).toEqual([
      expect.objectContaining({ version_id: latestVersion.id, require_confirmation: true }),
    ]);
    expect(
      state.dependencies.filter((dependency) => dependency.version_id === latestVersion.id),
    ).toHaveLength(1);
  });

  test('a template-backed job keeps an editable, attributed snapshot', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-13-F11, F12, F13, F14, F19, F20, F21, F22.
    const capabilityName = `Gasprüfung Auftrag ${world.runId}`;
    const templateName = `Audit Snapshot ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P113-SNAP`;
    const jobTitle = `Audit Vorlage ${world.runId}`;
    const capabilityId = await seedOrganizationCertification(
      world.orgId,
      world.users.admin.id,
      capabilityName,
    );
    await seedPublishedWorkTemplate({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: templateName,
      targetType: 'job',
      items: [
        { content: 'Messung dokumentieren', requirementState: 'optional', dependsOn: 'Sicherheitsprüfung' },
        {
          content: 'Sicherheitsprüfung',
          itemKind: 'checklist',
          groupLabel: 'Inbetriebnahme',
          evidenceDescription: 'Foto des Messgeräts',
        },
      ],
      material: {
        itemId: world.inventory.itemId,
        locationId: world.inventory.locationId,
        plannedQuantity: 3,
      },
      capability: { capabilityId, requireConfirmation: true },
    });

    await createJob(adminPage, {
      jobNumber,
      title: jobTitle,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
      plannedDateDigits: digits(ownedBerlinDateAtOffset('p1-13', 70)),
      workTemplateName: templateName,
      qualificationOverrideReason: 'Abweichung für den vollständigen Auditfluss.',
    });
    const created = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    expect(created.applications).toHaveLength(1);
    expect(created.materials).toHaveLength(1);
    expect(created.capabilities).toHaveLength(1);
    expect(created.qualificationAssessments.map((assessment) => assessment.override_reason)).toEqual([
      'Abweichung für den vollständigen Auditfluss.',
    ]);

    await employeePage.goto(`/auftraege/${jobNumber}`);
    await expect(visibleExactText(employeePage, testData`Sicherheitsprüfung`)).toBeVisible();
    await expect(visibleExactText(employeePage, testData`Messung dokumentieren`)).toBeVisible();
    await expect(
      visibleMatchingText(employeePage, TEMPLATE_AUDIT_COPY.instructionMeta.optionalTask),
    ).toBeVisible();
    await expect(
      visibleExactText(employeePage, instructionPrerequisiteText(testData`Sicherheitsprüfung`)),
    ).toBeVisible();
    await expect(
      visibleMatchingText(employeePage, TEMPLATE_AUDIT_COPY.instructionMeta.evidenceExpected),
    ).toBeVisible();
    await expect(employeePage.getByRole('button', { name: apply.open })).toHaveCount(0);
    await jobInstructionToggle(
      jobInstructionItem(employeePage, testData`Sicherheitsprüfung`),
      'done',
    ).click();
    await expect
      .poll(
        async () =>
          (await getAppliedWorkTemplateState(world.orgId, { jobNumber })).instructions.find(
            (item) => item.content === 'Sicherheitsprüfung',
          )?.last_status_changed_by,
        { timeout: 20_000 },
      )
      .toBe(world.users.employee.id);
    await employeePage.reload();
    await expect(
      jobInstructionToggle(jobInstructionItem(employeePage, testData`Sicherheitsprüfung`), 'open'),
    ).toBeVisible();

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await expect(adminPage.getByRole('heading', { name: jobTitle })).toBeVisible({
      timeout: 20_000,
    });
    await expect(jobInstructionDetailsButtons(adminPage)).toHaveCount(2);
    const detailsDialog = jobInstructionDetailsDialog(adminPage);
    await expect(async () => {
      // The flow edits the second persisted item after asserting there are exactly two.
      if (!(await detailsDialog.isVisible().catch(() => false)))
        await lastJobInstructionDetailsButton(adminPage).click();
      await expect(detailsDialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await detailsDialog.locator('#instruction-group').fill('Vor Ort geändert');
    await detailsDialog.locator('#instruction-notes').fill('Am Auftrag individuell ergänzt.');
    await jobInstructionDetailsField(detailsDialog, 'evidenceDescription').fill('Foto direkt am Auftrag');
    await jobInstructionDetailsField(detailsDialog, 'evidenceCategory').click();
    await evidenceCategoryOption(adminPage, 'other').click();
    await detailsDialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
    await expect(detailsDialog).toHaveCount(0, { timeout: 15_000 });
    await adminPage.reload();
    await expect(visibleMatchingText(adminPage, new RegExp(testData`Vor Ort geändert`))).toBeVisible();
    const edited = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    expect(edited.instructions.find((item) => item.content === 'Sicherheitsprüfung')).toMatchObject({
      group_label: 'Vor Ort geändert',
      notes: 'Am Auftrag individuell ergänzt.',
    });
    expect(edited.evidence).toEqual([
      expect.objectContaining({
        description: 'Foto direkt am Auftrag',
        document_category: 'other',
        source_work_template_evidence_id: expect.any(String),
      }),
    ]);

    await adminPage.getByRole('button', { name: TEMPLATE_AUDIT_COPY.jobPlanning.editMaterial }).click();
    const materialDialog = materialPositionDialog(adminPage);
    await materialRowQuantity(materialDialog).fill('4');
    await materialDialog.locator('textarea[id$="-notes"]').fill('Am Auftrag angepasst.');
    await materialDialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
    await expect(materialDialog).toHaveCount(0, { timeout: 20_000 });
    await removeCapabilityRequirementButton(adminPage, capabilityName).click();
    await expect
      .poll(async () => (await getAppliedWorkTemplateState(world.orgId, { jobNumber })).capabilities.length, {
        timeout: 20_000,
      })
      .toBe(0);
    const adjusted = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    expect(adjusted.materials).toEqual([
      expect.objectContaining({ planned_quantity: 4, notes: 'Am Auftrag angepasst.' }),
    ]);
  });

  test('archive and reactivation hide a template from new work while its history keeps the application', async ({
    adminPage,
    world,
  }) => {
    // P1-13-F11, F12, F13, F14: archive, picker exclusion, reactivation, attributed history.
    const name = `Audit Archiv ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P113-ARCH`;
    const jobTitle = `Archivauftrag ${world.runId}`;
    await createAndPublishWorkTemplate(adminPage, {
      name,
      targetType: 'job',
      firstItem: 'Archivpunkt prüfen',
    });
    await createJob(adminPage, { jobNumber, title: jobTitle, workTemplateName: name });
    expect((await getAppliedWorkTemplateState(world.orgId, { jobNumber })).applications).toHaveLength(1);

    await adminPage.goto('/arbeitsvorlagen');
    await workTemplateSearch(adminPage).fill(name);
    await adminPage.getByRole('button', { name: list.archive }).click();
    await expect
      .poll(async () => (await getWorkTemplateStateByName(world.orgId, name)).template.archived_at, {
        timeout: 20_000,
      })
      .not.toBeNull();
    await adminPage.goto('/auftraege');
    await adminPage.getByRole('button', { name: SHARED_COPY.action.create, exact: true }).click();
    await workCreateTab(adminPage, 'job').click();
    await workTemplatePicker(adminPage.getByRole('dialog')).click();
    const templateOptions = adminPage.getByRole('listbox');
    await expect(templateOptions.getByText(name, { exact: true })).toHaveCount(0);
    await dismissDialog(templateOptions);
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: SHARED_COPY.action.close, exact: true })
      .click();

    await adminPage.goto('/arbeitsvorlagen');
    await workTemplateSearch(adminPage).fill(name);
    await adminPage.getByRole('combobox', { name: list.statusFilter }).click();
    await adminPage.getByRole('option', { name: filterOption.archive }).click();
    await expect(visibleExactText(adminPage, name)).toBeVisible();
    await adminPage.getByRole('button', { name: list.reactivate }).click();
    await expect
      .poll(async () => (await getWorkTemplateStateByName(world.orgId, name)).template.archived_at, {
        timeout: 20_000,
      })
      .toBeNull();
    const templateState = await getWorkTemplateStateByName(world.orgId, name);
    expect(templateState.events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(['applied', 'archived', 'reactivated']),
    );
    await adminPage.getByRole('combobox', { name: list.statusFilter }).click();
    await adminPage.getByRole('option', { name: filterOption.active }).click();
    await workTemplateOpenButton(adminPage).click();
    await expect(
      adminPage.getByRole('dialog').getByText(`${jobNumber} · ${jobTitle}`, {
        exact: true,
      }),
    ).toBeVisible();
  });

  test('after-creation preview, duplicate and additional warnings, and project-direct rows', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    // P1-13-F17, F18, F23, F24.
    const templateName = `Audit Nachträglich ${world.runId}`;
    const additionalTemplate = `Audit Zusatz ${world.runId}`;
    const projectTemplate = `Audit Projekt ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P113-LATE`;
    const projectNumber = `PRJ-${world.runId}-P113`;
    const childJobNumber = `AUF-${world.runId}-P113-CHILD`;
    const capabilityId = await seedOrganizationCertification(
      world.orgId,
      world.users.admin.id,
      `Gasprüfung Projekt ${world.runId}`,
    );
    for (const template of [
      { name: templateName, item: 'Messung nachträglich dokumentieren' },
      { name: additionalTemplate, item: 'Zusätzliche Sichtprüfung' },
    ]) {
      await seedPublishedWorkTemplate({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        name: template.name,
        targetType: 'job',
        items: [{ content: template.item }],
      });
    }
    await seedPublishedWorkTemplate({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: projectTemplate,
      targetType: 'project',
      items: [{ content: 'Projektstart dokumentieren' }],
      material: { itemId: world.inventory.itemId, locationId: null, plannedQuantity: 2 },
      capability: { capabilityId, requireConfirmation: true },
    });
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title: `Nachträglich ${world.runId}`,
    });

    const applyDialog = applyTemplateDialog(adminPage);
    const applySubmit = applyDialog.getByRole('button', { name: apply.submit, exact: true });
    await bueroPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByRole('button', { name: apply.open }).click();
    await selectFromSearchable(adminPage, applyDialog.getByRole('combobox'), templateName);
    await expect(applyDialog.getByText(apply.preview)).toBeVisible();
    await applySubmit.click();
    await expect(applyDialog).toHaveCount(0, { timeout: 20_000 });
    expect((await getAppliedWorkTemplateState(world.orgId, { jobNumber })).applications).toHaveLength(1);
    await expect(visibleExactText(bueroPage, testData`Messung nachträglich dokumentieren`)).toBeVisible({
      timeout: 25_000,
    });

    await adminPage.getByRole('button', { name: apply.open }).click();
    await selectFromSearchable(adminPage, applyDialog.getByRole('combobox'), templateName);
    await expect(applyDialog.getByText(apply.alreadyApplied)).toBeVisible();
    await applySubmit.click();
    await expect(applyDialog.getByText(apply.alreadyApplied)).toBeVisible();
    await applyDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();

    await adminPage.getByRole('button', { name: apply.open }).click();
    await selectFromSearchable(adminPage, applyDialog.getByRole('combobox'), additionalTemplate);
    await expect(applyDialog.getByText(apply.additional)).toBeVisible();
    await applySubmit.click();
    await expect(
      applyDialog.getByText(apply.confirmAdditional, {
        exact: true,
      }),
    ).toBeVisible();
    await applyDialog.getByRole('checkbox').click();
    await applySubmit.click();
    await expect(applyDialog).toHaveCount(0, { timeout: 20_000 });
    const additional = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    expect(additional.applications).toHaveLength(2);
    expect(additional.instructions.map((item) => item.content)).toContain('Zusätzliche Sichtprüfung');

    await createProject(adminPage, {
      projectNumber,
      title: `Audit Projekt ${world.runId}`,
      workTemplateName: projectTemplate,
    });
    const projectState = await getAppliedWorkTemplateState(world.orgId, { projectNumber });
    expect(projectState.instructions.map((item) => item.content)).toEqual(['Projektstart dokumentieren']);
    expect(projectState.materials).toHaveLength(1);
    expect(projectState.capabilities).toHaveLength(1);
    expect(projectState.projectJobs).toHaveLength(0);
    await createJob(adminPage, {
      jobNumber: childJobNumber,
      title: `Späterer Unterauftrag ${world.runId}`,
      projectNumber,
    });
    const childState = await getAppliedWorkTemplateState(world.orgId, { jobNumber: childJobNumber });
    expect(childState.applications).toHaveLength(0);
    expect(childState.instructions).toHaveLength(0);
  });

  test('request conversion applies a template and every creation context offers the optional picker', async ({
    adminPage,
    world,
  }) => {
    // P1-13-F15, F16.
    const templateName = `Audit Anfrage ${world.runId}`;
    const customerName = `Audit Kunde ${world.runId}`;
    const requestNumber = `ANF-${world.runId}-P113`;
    const projectNumber = `PRJ-${world.runId}-P113-CTX`;
    await seedPublishedWorkTemplate({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: templateName,
      targetType: 'job',
      items: [{ content: 'Anfrage vor Ort prüfen' }],
    });
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customerName,
    });
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary: `Vorlagenanfrage ${world.runId}`,
      requestNumber,
      clientId: customer.clientId,
    });
    await seedProject({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      projectNumber,
      name: `Kontextprojekt ${world.runId}`,
    });

    await adminPage.goto(`/anfragen/${requestId}`);
    await convertRequestToJobViaDialog(adminPage, {
      workTemplateName: templateName,
      plannedDate: ownedBerlinDateAtOffset('p1-13', 73),
    });
    const conversion = await getRequestConversionState(world.orgId, requestNumber);
    expect(conversion.status).toBe('umgewandelt');
    const convertedJobId = expectDefined(conversion.convertedJobId, 'the converted job id');
    expect(await getWorkTemplateApplicationCountForTarget(world.orgId, { jobId: convertedJobId })).toBe(1);

    const closeCreationDialog = adminPage
      .getByRole('dialog')
      .getByRole('button', { name: SHARED_COPY.action.close, exact: true });

    await openSeededCustomerDetail(adminPage, customer.clientId);
    const customerCreateButton = adminPage.getByRole('button', {
      name: SHARED_COPY.action.create,
      exact: true,
    });
    await expect(customerCreateButton).toBeVisible({ timeout: 15_000 });
    await customerCreateButton.click();
    await workCreateTab(adminPage, 'job').click();
    await expect(workTemplatePicker(adminPage.getByRole('dialog'))).toBeVisible({
      timeout: 15_000,
    });
    await closeCreationDialog.click();

    await adminPage.goto('/mitarbeiter');
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRow = adminPage.getByRole('row').filter({ hasText: employeeName });
    await expect(employeeRow).toBeVisible({ timeout: 15_000 });
    await employeeRow.getByRole('link', { name: employeeName }).click();
    const employeeCreateButton = adminPage.getByRole('button', {
      name: context.employeeCreateJob,
    });
    await expect(employeeCreateButton).toBeVisible({ timeout: 15_000 });
    await employeeCreateButton.click();
    await expect(workTemplatePicker(adminPage.getByRole('dialog'))).toBeVisible({
      timeout: 15_000,
    });
    await closeCreationDialog.click();

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    const projectCreateButton = adminPage.getByRole('button', {
      name: context.projectAddJob,
    });
    await expect(projectCreateButton).toBeVisible({ timeout: 15_000 });
    await projectCreateButton.click();
    await expect(workTemplatePicker(adminPage.getByRole('dialog'))).toBeVisible({
      timeout: 15_000,
    });
    await closeCreationDialog.click();

    await adminPage.goto('/kalender');
    const calendarCreateButton = calendarNewEntryButton(adminPage);
    await expect(calendarCreateButton).toBeVisible({ timeout: 15_000 });
    await calendarCreateButton.click();
    const calendarDialog = calendarEntryDialog(adminPage);
    await entryDialogTab(calendarDialog, 'job').click();
    await expect(workTemplateSelect(calendarDialog, 'job')).toBeVisible({
      timeout: 15_000,
    });
    await calendarDialog.getByRole('button', { name: SHARED_COPY.action.close, exact: true }).click();
  });

  test('a retired capability blocks template use with a named correction and other organizations see no template', async ({
    adminPage,
    outsiderPage,
    world,
  }) => {
    // P1-13-F16, F24, F25, F26.
    const capabilityName = `Gasprüfung Referenz ${world.runId}`;
    const referencedTemplate = `Audit Referenz ${world.runId}`;
    const cleanTemplate = `Audit Sauber ${world.runId}`;
    const requestNumber = `ANF-${world.runId}-P113-F`;
    const jobNumber = `AUF-${world.runId}-P113-REF`;
    const capabilityId = await seedOrganizationCertification(
      world.orgId,
      world.users.admin.id,
      capabilityName,
    );
    await seedPublishedWorkTemplate({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: referencedTemplate,
      targetType: 'job',
      items: [{ content: 'Gasleitung prüfen' }],
      capability: { capabilityId, requireConfirmation: true },
    });
    await seedPublishedWorkTemplate({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: cleanTemplate,
      targetType: 'job',
      items: [{ content: 'Zusätzliche Sichtprüfung' }],
    });
    await retireOrganizationCapability(world.orgId, capabilityId);
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: `Audit Referenzkunde ${world.runId}`,
    });
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary: `Fehlerhafte Vorlagenanfrage ${world.runId}`,
      requestNumber,
      clientId: customer.clientId,
    });
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title: `Referenzprüfung ${world.runId}`,
    });

    await outsiderPage.goto('/auftraege');
    await workCreateButton(outsiderPage).click();
    await workCreateTab(outsiderPage, 'job').click();
    await expect(visibleMatchingText(outsiderPage, TEMPLATE_AUDIT_COPY.picker.noTemplate)).toBeVisible({
      timeout: 15_000,
    });
    await expect(outsiderPage.getByRole('link', { name: TEMPLATE_AUDIT_COPY.picker.manage })).toHaveAttribute(
      'href',
      '/arbeitsvorlagen',
    );
    await expect(exactText(outsiderPage, referencedTemplate)).toHaveCount(0);

    await adminPage.goto(`/anfragen/${requestId}`);
    await requestConvertButton(adminPage).click();
    const conversionDialog = requestConversionDialog(adminPage);
    await selectFromSearchable(adminPage, workTemplateSelect(conversionDialog, 'job'), referencedTemplate);
    await expect(conversionDialog.locator('#convert-number')).toHaveValue(/.+/, {
      timeout: 15_000,
    });
    await convertToJobSubmit(conversionDialog).click();
    await expect(conversionDialog.getByText(TEMPLATE_AUDIT_COPY.conversion.referenceUnavailable)).toBeVisible(
      { timeout: 20_000 },
    );
    expect(await getRequestConversionState(world.orgId, requestNumber)).toMatchObject({
      status: 'offen',
      convertedJobId: null,
    });
    await conversionDialog
      .locator('form')
      .getByRole('button', { name: SHARED_COPY.action.cancel, exact: true })
      .click();

    const applyDialog = applyTemplateDialog(adminPage);
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByRole('button', { name: apply.open }).click();
    await selectFromSearchable(adminPage, applyDialog.getByRole('combobox'), referencedTemplate);
    await applyDialog.getByRole('button', { name: apply.submit, exact: true }).click();
    await expect(retiredCapabilityRefusal(applyDialog, capabilityName)).toBeVisible({ timeout: 20_000 });
    expect((await getAppliedWorkTemplateState(world.orgId, { jobNumber })).applications).toHaveLength(0);
    await applyDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();

    await adminPage.getByRole('button', { name: apply.open }).click();
    await selectFromSearchable(adminPage, applyDialog.getByRole('combobox'), cleanTemplate);
    await applyDialog.getByRole('button', { name: apply.submit, exact: true }).click();
    await expect(applyDialog).toHaveCount(0, { timeout: 20_000 });
    const retried = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    expect(retried.applications).toHaveLength(1);
    expect(retried.instructions.map((item) => item.content)).toEqual(['Zusätzliche Sichtprüfung']);
  });
});
