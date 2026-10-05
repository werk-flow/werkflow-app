import { resolve } from 'node:path';

import { workTransitionActionLabel } from '../../lib/work-lifecycle/types';
import { expect, test } from './support/fixtures';
import { berlinDateAtOffset } from './support/date-ownership';
import { seedCustomer } from './support/db/customers';
import { getInventoryLedgerState } from './support/db/inventory';
import {
  getAppliedWorkTemplateState,
  getWorkArtifactState,
  getWorkLifecycleState,
  seedPublishedWorkTemplate,
} from './support/db/work';
import {
  closeWorkArtifactDialog,
  newWorkArtifactButton,
  workArtifactAction,
  workArtifactDialog,
  workArtifactField,
  workArtifactsSection,
  workArtifactVersion,
} from './support/spec-helpers/work-artifact-dialog';
import { uploadDocumentOnJobPage } from './support/steps/documents';
import {
  returnMaterialOnJobPage,
  takeFromStockButton,
  takeMaterialOnJobPage,
} from './support/steps/inventory';
import { SHARED_COPY, testData } from './support/steps/shared';
import {
  changeTimeOnWorkPack,
  createJob,
  fieldPackAbsentTerms,
  fieldPackButton,
  fieldPackCallLink,
  fieldPackHeading,
  fieldPackNavigationLink,
  fieldPackTimeAction,
  fieldPrimaryNextAction,
  lifecycleState,
  openFieldWorkPack,
  setInstructionCompletionOnJobPage,
  transitionWork,
} from './support/steps/work';
import { artifactsDirectory } from './support/world';

function dateDigits(value: string): string {
  return value.split('-').reverse().join('');
}

// Project-child packs, dispatch, interruptions, time switching, own blockers,
// assignment revocation and the unassigned/outsider denials are edge cases in
// tests/audit/wave-2/p1-16.spec.ts.
test.describe('P1-16 focused field work pack @P1-16', () => {
  test('an assigned field worker works through the pack and completes the job', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const customerName = `P116 Golden Kunde ${world.runId}`;
    const siteName = `P116 Golden Heizzentrale ${world.runId}`;
    const contactName = `P116 Golden Kontakt ${world.runId}`;
    const templateName = `P116 Golden Vorlage ${world.runId}`;
    const instruction = `Anlage prüfen ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P116-GOLDEN`;
    const siteStreet = testData`Werkstraße 16`;
    const siteAddress = testData`Werkstraße 16, 10115 Berlin`;
    const accessNotes = testData`Am Pförtnerhaus melden.`;
    const internalSiteNote = testData`Diese interne Standortnotiz bleibt im Büro.`;
    const internalSiteNoteStart = testData`Diese interne`;
    const contactEmailDomain = testData`@example.test`;
    const jobDescription = testData`Störung eingrenzen, Anlage prüfen und Ergebnis dokumentieren.`;

    const pack = await test.step('The pack opens with only the practical field context', async () => {
      await seedCustomer({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        name: customerName,
        contacts: [
          {
            name: contactName,
            role: 'Hausmeister/in',
            phone: '+49 30 5550123',
            email: `internal-${world.runId}${contactEmailDomain}`,
            isPrimary: true,
          },
        ],
        sites: [
          {
            name: siteName,
            street: siteStreet,
            postalCode: '10115',
            city: 'Berlin',
            accessNotes,
            notes: internalSiteNote,
            isPrimary: true,
          },
        ],
      });
      await seedPublishedWorkTemplate({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        name: templateName,
        targetType: 'job',
        items: [{ content: instruction }],
      });
      await createJob(adminPage, {
        jobNumber,
        title: `P116 Golden Einsatz ${world.runId}`,
        description: jobDescription,
        clientName: customerName,
        siteName,
        contactName,
        plannedDateDigits: dateDigits(berlinDateAtOffset(85)),
        assignEmployeeName: employeeName,
        workTemplateName: templateName,
      });

      await employeePage.setViewportSize({ width: 390, height: 844 });
      const fieldPack = await openFieldWorkPack(employeePage, jobNumber);
      await expect(fieldPackHeading(fieldPack, 'beforeVisit')).toBeVisible();
      await expect(fieldPack).toContainText(customerName);
      await expect(fieldPack).toContainText(siteName);
      await expect(fieldPack).toContainText(siteAddress);
      await expect(fieldPack).toContainText(accessNotes);
      await expect(fieldPack).toContainText(jobDescription);
      await expect(fieldPack).not.toContainText(internalSiteNoteStart);
      await expect(fieldPack).not.toContainText(contactEmailDomain);
      await expect(fieldPackCallLink(fieldPack, contactName)).toHaveAttribute('href', /tel:/);
      await expect(fieldPackNavigationLink(fieldPack, siteStreet)).toHaveAttribute('href', /^geo:/);
      await expect(fieldPrimaryNextAction(fieldPack)).toHaveText(
        workTransitionActionLabel('not_started', 'in_progress'),
      );
      await expect(
        fieldPack.getByRole('button', { name: SHARED_COPY.assignment.assign, exact: true }),
      ).toHaveCount(0);
      await expect(fieldPackAbsentTerms(fieldPack, 'billing')).toHaveCount(0);
      return fieldPack;
    });

    await test.step('Field actions persist through their owning domains', async () => {
      const inventoryBefore = await getInventoryLedgerState(
        world.orgId,
        world.inventory.itemId,
        world.inventory.locationId,
      );
      await transitionWork(employeePage, 'not_started', 'in_progress');
      await setInstructionCompletionOnJobPage(employeePage, instruction, true);
      await changeTimeOnWorkPack(employeePage, 'start');
      await changeTimeOnWorkPack(employeePage, 'stop');
      await takeMaterialOnJobPage(employeePage, jobNumber, world.inventory.itemName, 2);
      await returnMaterialOnJobPage(employeePage, jobNumber, world.inventory.itemName, 2);
      await uploadDocumentOnJobPage(
        employeePage,
        jobNumber,
        resolve(artifactsDirectory(), 'upload-fixture.pdf'),
        'upload-fixture',
      );

      await newWorkArtifactButton(employeePage).click();
      const artifactDialog = workArtifactDialog(employeePage);
      await workArtifactField(artifactDialog, 'title').fill(`P116 Arbeitsbericht ${world.runId}`);
      await workArtifactField(artifactDialog, 'summary').fill(
        'Anlage geprüft; Ergebnis ist im Auftrag dokumentiert.',
      );
      await workArtifactField(artifactDialog, 'performedWork').fill(
        'Anlage geprüft und Ergebnis dokumentiert.',
      );
      await workArtifactAction(artifactDialog, 'saveDraft').click();
      await expect(workArtifactVersion(artifactDialog, 1)).toBeVisible({
        timeout: 20_000,
      });
      await closeWorkArtifactDialog(artifactDialog);

      const [applied, artifacts, inventory] = await Promise.all([
        getAppliedWorkTemplateState(world.orgId, { jobNumber }),
        getWorkArtifactState(world.orgId, { jobNumber }),
        getInventoryLedgerState(world.orgId, world.inventory.itemId, world.inventory.locationId),
      ]);
      expect(applied.instructions).toEqual([
        expect.objectContaining({ is_completed: true, last_status_changed_by: world.users.employee.id }),
      ]);
      expect(applied.timeSegments).toHaveLength(1);
      expect(applied.inventoryMovements).toHaveLength(2);
      expect(applied.documentLinks).toHaveLength(1);
      expect(artifacts.artifacts).toEqual([
        expect.objectContaining({ status: 'draft', created_by: world.users.employee.id }),
      ]);
      expect(inventory.quantityOnHand).toBe(inventoryBefore.quantityOnHand);
      expect(inventory.movementCount).toBe(inventoryBefore.movementCount + 2);
    });

    await test.step('Completion leaves a read-only pack while the office keeps its own view', async () => {
      await openFieldWorkPack(employeePage, jobNumber);
      await transitionWork(employeePage, 'in_progress', 'execution_complete');
      await expect(lifecycleState(employeePage, 'execution_complete').filter({ visible: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect(fieldPrimaryNextAction(pack)).toHaveCount(0);
      await expect(workArtifactsSection(employeePage)).toBeVisible();
      await expect(newWorkArtifactButton(employeePage, { exact: true })).toHaveCount(0);
      await expect(fieldPackButton(pack, 'upload')).toHaveCount(0);
      await expect(fieldPackTimeAction(pack)).toHaveCount(0);
      await expect(takeFromStockButton(pack)).toHaveCount(0);
      const lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber });
      expect(lifecycle.entity).toMatchObject({ execution_state: 'execution_complete' });

      await adminPage.goto(`/auftraege/${jobNumber}`);
      await expect(adminPage.getByTestId('field-work-pack')).toHaveCount(0);
      await expect(adminPage.getByRole('heading', { name: SHARED_COPY.region.details })).toBeVisible();
      await expect(
        adminPage.getByRole('button', { name: SHARED_COPY.assignment.assign, exact: true }),
      ).toBeVisible();
    });
  });
});
