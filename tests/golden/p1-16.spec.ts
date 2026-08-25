import { resolve } from 'node:path';

import { ensureOutsiderSession, expect, test } from './support/fixtures';
import {
  getAppliedWorkTemplateState,
  getInventoryLedgerState,
  getWorkArtifactState,
  getWorkLifecycleState,
} from './support/db';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  changeTimeOnWorkPack,
  createAndPublishWorkTemplate,
  createCustomer,
  createJob,
  openCustomerDetail,
  openFieldWorkPack,
  returnMaterialOnJobPage,
  setInstructionCompletionOnJobPage,
  takeMaterialOnJobPage,
  transitionWorkOnJobPage,
  uploadDocumentOnJobPage,
} from './support/steps';
import { ARTIFACTS_DIR } from './support/world';

test.describe.configure({ mode: 'serial' });

function berlinDateAfter(days: number): string {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function dateDigits(value: string): string {
  return value.split('-').reverse().join('');
}

test.describe('P1-16 focused field work pack @P1-16', () => {
  test('assigned worker executes one authoritative pack while other roles retain their boundary', async ({
    adminPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    test.setTimeout(480_000);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const customerName = `P116 Golden Kunde ${world.runId}`;
    const siteName = `P116 Golden Heizzentrale ${world.runId}`;
    const contactName = `P116 Golden Kontakt ${world.runId}`;
    const templateName = `P116 Golden Vorlage ${world.runId}`;
    const instruction = `Anlage prüfen ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P116-GOLDEN`;
    const unassignedJobNumber = `AUF-${world.runId}-P116-DENIED`;
    const jobTitle = `P116 Golden Einsatz ${world.runId}`;
    const plannedDate = berlinDateAfter(85);

    await createCustomer(adminPage, customerName);
    await openCustomerDetail(adminPage, customerName);
    await addContactOnCustomerDetail(adminPage, {
      name: contactName,
      role: 'Hausmeister/in',
      phone: '+49 30 5550123',
      email: `internal-${world.runId}@example.test`,
      notes: 'Diese interne Kontaktnotiz bleibt im Büro.',
      isPrimary: true,
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: siteName,
      street: 'Werkstraße 16',
      postalCode: '10115',
      city: 'Berlin',
      accessNotes: 'Am Pförtnerhaus melden.',
      notes: 'Diese interne Standortnotiz bleibt im Büro.',
      isPrimary: true,
    });
    await createAndPublishWorkTemplate(adminPage, {
      name: templateName,
      targetType: 'job',
      firstItem: instruction,
    });
    await createJob(adminPage, {
      jobNumber,
      title: jobTitle,
      description: 'Störung eingrenzen, Anlage prüfen und Ergebnis dokumentieren.',
      clientName: customerName,
      siteName,
      contactName,
      plannedDateDigits: dateDigits(plannedDate),
      assignEmployeeName: employeeName,
      workTemplateName: templateName,
    });
    await createJob(adminPage, {
      jobNumber: unassignedJobNumber,
      title: `P116 nicht zugewiesen ${world.runId}`,
    });

    const inventoryBefore = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId
    );
    await employeePage.setViewportSize({ width: 390, height: 844 });
    const pack = await openFieldWorkPack(employeePage, jobNumber);
    await expect(pack.getByRole('heading', { name: 'Vor dem Einsatz' })).toBeVisible();
    await expect(pack).toContainText(customerName);
    await expect(pack).toContainText(siteName);
    await expect(pack).toContainText('Werkstraße 16, 10115 Berlin');
    await expect(pack).toContainText('Am Pförtnerhaus melden.');
    await expect(pack).toContainText('Störung eingrenzen, Anlage prüfen und Ergebnis dokumentieren.');
    await expect(pack).not.toContainText('Diese interne');
    await expect(pack).not.toContainText('@example.test');
    await expect(pack.getByRole('link', { name: `${contactName} anrufen` })).toHaveAttribute('href', /tel:/);
    await expect(pack.getByRole('link', { name: /Navigation zu Werkstraße 16/ })).toHaveAttribute('href', /^geo:/);
    await expect(pack.getByTestId('field-primary-next-action')).toHaveCount(1);
    await expect(pack.getByTestId('field-primary-next-action')).toHaveText('In Ausführung');
    await expect(pack.getByRole('button', { name: 'Zuweisen', exact: true })).toHaveCount(0);
    await expect(pack.getByText(/Abrechenbar/)).toHaveCount(0);

    await transitionWorkOnJobPage(employeePage, 'In Ausführung');
    await setInstructionCompletionOnJobPage(employeePage, instruction, true);
    await changeTimeOnWorkPack(employeePage, 'start');
    await changeTimeOnWorkPack(employeePage, 'stop');
    await takeMaterialOnJobPage(employeePage, jobNumber, world.inventory.itemName, 2);
    await returnMaterialOnJobPage(employeePage, jobNumber, world.inventory.itemName, 2);
    await uploadDocumentOnJobPage(
      employeePage,
      jobNumber,
      resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
      'upload-fixture'
    );

    await employeePage.getByTestId('work-artifacts-section').getByRole('button', { name: 'Neu' }).click();
    const artifactDialog = employeePage.getByRole('dialog');
    await artifactDialog.getByLabel('Titel').fill(`P116 Arbeitsbericht ${world.runId}`);
    await artifactDialog.getByLabel('Zusammenfassung').fill('Anlage geprüft; Ergebnis ist im Auftrag dokumentiert.');
    await artifactDialog.getByLabel('Ausgeführte Arbeiten').fill('Anlage geprüft und Ergebnis dokumentiert.');
    await artifactDialog.getByRole('button', { name: 'Als Entwurf speichern' }).click();
    await expect(artifactDialog.getByText(/Version 1/)).toBeVisible({ timeout: 20_000 });
    await artifactDialog.getByRole('button', { name: 'Schließen' }).first().click();

    await transitionWorkOnJobPage(employeePage, 'Ausführung abgeschlossen');
    await expect(pack.getByText('Ausführung abgeschlossen', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(pack.getByTestId('field-primary-next-action')).toHaveCount(0);
    const readOnlyArtifacts = pack.getByTestId('work-artifacts-section');
    await expect(readOnlyArtifacts).toBeVisible();
    await expect(readOnlyArtifacts.getByRole('button', { name: 'Neu', exact: true })).toHaveCount(0);
    await expect(pack.getByRole('button', { name: 'Hochladen' })).toHaveCount(0);
    await expect(pack.getByRole('button', { name: /Arbeitszeit (starten|beenden)/ })).toHaveCount(0);
    await expect(pack.getByRole('button', { name: 'Aus Lager entnehmen' })).toHaveCount(0);

    const [applied, lifecycle, artifacts, inventoryAfter] = await Promise.all([
      getAppliedWorkTemplateState(world.orgId, { jobNumber }),
      getWorkLifecycleState(world.orgId, { jobNumber }),
      getWorkArtifactState(world.orgId, { jobNumber }),
      getInventoryLedgerState(world.orgId, world.inventory.itemId, world.inventory.locationId),
    ]);
    expect(applied.instructions).toHaveLength(1);
    expect(applied.instructions[0]).toMatchObject({ is_completed: true, last_status_changed_by: world.users.employee.id });
    expect(applied.timeEntries).toHaveLength(1);
    expect(applied.inventoryMovements).toHaveLength(2);
    expect(applied.documentLinks).toHaveLength(1);
    expect(lifecycle.entity).toMatchObject({ execution_state: 'execution_complete' });
    expect(artifacts.artifacts).toHaveLength(1);
    expect(artifacts.artifacts[0]).toMatchObject({ status: 'draft', created_by: world.users.employee.id });
    expect(inventoryAfter.quantityOnHand).toBe(inventoryBefore.quantityOnHand);
    expect(inventoryAfter.movementCount).toBe(inventoryBefore.movementCount + 2);

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await expect(adminPage.getByTestId('field-work-pack')).toHaveCount(0);
    await expect(adminPage.getByRole('heading', { name: 'Details' })).toBeVisible();
    await expect(adminPage.getByRole('button', { name: 'Zuweisen', exact: true })).toBeVisible();

    await employeePage.goto(`/auftraege/${unassignedJobNumber}`);
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await expect(employeePage.getByTestId('field-work-pack')).toHaveCount(0);
    await ensureOutsiderSession(outsiderPage.context(), outsiderPage);
    await outsiderPage.goto(`/auftraege/${jobNumber}`);
    await outsiderPage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await expect(outsiderPage.getByTestId('field-work-pack')).toHaveCount(0);
  });
});
