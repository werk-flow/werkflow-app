import { resolve } from 'node:path';

import { expect, test } from './support/fixtures';
import {
  getAppliedWorkTemplateState,
  getInventoryLedgerState,
  getJobCountByNumber,
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
import { ARTIFACTS_DIR, type TestWorld } from './support/world';

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

function names(world: TestWorld) {
  return {
    employeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    customerName: `P116 Golden Kunde ${world.runId}`,
    siteName: `P116 Golden Heizzentrale ${world.runId}`,
    contactName: `P116 Golden Kontakt ${world.runId}`,
    templateName: `P116 Golden Vorlage ${world.runId}`,
    instruction: `Anlage prüfen ${world.runId}`,
    jobNumber: `AUF-${world.runId}-P116-GOLDEN`,
    unassignedJobNumber: `AUF-${world.runId}-P116-DENIED`,
    jobTitle: `P116 Golden Einsatz ${world.runId}`,
  };
}

async function expectSetupJob(world: TestWorld, jobNumber: string): Promise<void> {
  const count = await getJobCountByNumber(world.orgId, jobNumber);
  expect(count, `P1-16 setup prerequisite is missing for ${jobNumber}`).toBe(1);
}

test.describe('P1-16 focused field work pack @P1-16', () => {
  test('setup and first viewport expose only the practical field context @P1-16-stage-setup', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    test.setTimeout(300_000);
    const fixture = names(world);
    await createCustomer(adminPage, fixture.customerName);
    await openCustomerDetail(adminPage, fixture.customerName);
    await addContactOnCustomerDetail(adminPage, {
      name: fixture.contactName,
      role: 'Hausmeister/in',
      phone: '+49 30 5550123',
      email: `internal-${world.runId}@example.test`,
      notes: 'Diese interne Kontaktnotiz bleibt im Büro.',
      isPrimary: true,
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.siteName,
      street: 'Werkstraße 16',
      postalCode: '10115',
      city: 'Berlin',
      accessNotes: 'Am Pförtnerhaus melden.',
      notes: 'Diese interne Standortnotiz bleibt im Büro.',
      isPrimary: true,
    });
    await createAndPublishWorkTemplate(adminPage, {
      name: fixture.templateName,
      targetType: 'job',
      firstItem: fixture.instruction,
    });
    await createJob(adminPage, {
      jobNumber: fixture.jobNumber,
      title: fixture.jobTitle,
      description: 'Störung eingrenzen, Anlage prüfen und Ergebnis dokumentieren.',
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      contactName: fixture.contactName,
      plannedDateDigits: dateDigits(berlinDateAfter(85)),
      assignEmployeeName: fixture.employeeName,
      workTemplateName: fixture.templateName,
    });
    await createJob(adminPage, {
      jobNumber: fixture.unassignedJobNumber,
      title: `P116 nicht zugewiesen ${world.runId}`,
    });

    await employeePage.setViewportSize({ width: 390, height: 844 });
    const pack = await openFieldWorkPack(employeePage, fixture.jobNumber);
    await expect(pack.getByRole('heading', { name: 'Vor dem Einsatz' })).toBeVisible();
    await expect(pack).toContainText(fixture.customerName);
    await expect(pack).toContainText(fixture.siteName);
    await expect(pack).toContainText('Werkstraße 16, 10115 Berlin');
    await expect(pack).toContainText('Am Pförtnerhaus melden.');
    await expect(pack).toContainText('Störung eingrenzen, Anlage prüfen und Ergebnis dokumentieren.');
    await expect(pack).not.toContainText('Diese interne');
    await expect(pack).not.toContainText('@example.test');
    await expect(pack.getByRole('link', { name: `${fixture.contactName} anrufen` })).toHaveAttribute('href', /tel:/);
    await expect(pack.getByRole('link', { name: /Navigation zu Werkstraße 16/ })).toHaveAttribute('href', /^geo:/);
    await expect(pack.getByTestId('field-primary-next-action')).toHaveCount(1);
    await expect(pack.getByTestId('field-primary-next-action')).toHaveText('In Ausführung');
    await expect(pack.getByRole('button', { name: 'Zuweisen', exact: true })).toHaveCount(0);
    await expect(pack.getByText(/Abrechenbar/)).toHaveCount(0);
  });

  test('field actions persist through their owning domains @P1-16-stage-execution', async ({
    employeePage,
    world,
  }) => {
    test.setTimeout(360_000);
    const fixture = names(world);
    await expectSetupJob(world, fixture.jobNumber);
    await employeePage.setViewportSize({ width: 390, height: 844 });
    await openFieldWorkPack(employeePage, fixture.jobNumber);
    const inventoryBefore = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId
    );
    await transitionWorkOnJobPage(employeePage, 'In Ausführung');
    await setInstructionCompletionOnJobPage(employeePage, fixture.instruction, true);
    await changeTimeOnWorkPack(employeePage, 'start');
    await changeTimeOnWorkPack(employeePage, 'stop');
    await takeMaterialOnJobPage(employeePage, fixture.jobNumber, world.inventory.itemName, 2);
    await returnMaterialOnJobPage(employeePage, fixture.jobNumber, world.inventory.itemName, 2);
    await uploadDocumentOnJobPage(
      employeePage,
      fixture.jobNumber,
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

    const [applied, artifacts, inventory] = await Promise.all([
      getAppliedWorkTemplateState(world.orgId, { jobNumber: fixture.jobNumber }),
      getWorkArtifactState(world.orgId, { jobNumber: fixture.jobNumber }),
      getInventoryLedgerState(world.orgId, world.inventory.itemId, world.inventory.locationId),
    ]);
    expect(applied.instructions).toHaveLength(1);
    expect(applied.instructions[0]).toMatchObject({
      is_completed: true,
      last_status_changed_by: world.users.employee.id,
    });
    expect(applied.timeEntries).toHaveLength(1);
    expect(applied.inventoryMovements).toHaveLength(2);
    expect(applied.documentLinks).toHaveLength(1);
    expect(artifacts.artifacts).toHaveLength(1);
    expect(artifacts.artifacts[0]).toMatchObject({
      status: 'draft',
      created_by: world.users.employee.id,
    });
    expect(inventory.quantityOnHand).toBe(inventoryBefore.quantityOnHand);
    expect(inventory.movementCount).toBe(inventoryBefore.movementCount + 2);
  });

  test('terminal and cross-role boundaries survive a fresh session @P1-16-stage-boundaries', async ({
    adminPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    test.setTimeout(240_000);
    const fixture = names(world);
    await expectSetupJob(world, fixture.jobNumber);
    await employeePage.setViewportSize({ width: 390, height: 844 });
    const pack = await openFieldWorkPack(employeePage, fixture.jobNumber);
    const lifecycleBefore = await getWorkLifecycleState(world.orgId, {
      jobNumber: fixture.jobNumber,
    });
    const executionState = lifecycleBefore.entity && 'execution_state' in lifecycleBefore.entity
      ? lifecycleBefore.entity.execution_state
      : null;
    if (executionState !== 'execution_complete') {
      await transitionWorkOnJobPage(employeePage, 'Ausführung abgeschlossen');
    }
    await expect(pack.getByText('Ausführung abgeschlossen', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(pack.getByTestId('field-primary-next-action')).toHaveCount(0);
    const readOnlyArtifacts = pack.getByTestId('work-artifacts-section');
    await expect(readOnlyArtifacts).toBeVisible();
    await expect(readOnlyArtifacts.getByRole('button', { name: 'Neu', exact: true })).toHaveCount(0);
    await expect(pack.getByRole('button', { name: 'Hochladen' })).toHaveCount(0);
    await expect(pack.getByRole('button', { name: /Arbeitszeit (starten|beenden)/ })).toHaveCount(0);
    await expect(pack.getByRole('button', { name: 'Aus Lager entnehmen' })).toHaveCount(0);

    const lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber: fixture.jobNumber });
    expect(lifecycle.entity).toMatchObject({ execution_state: 'execution_complete' });

    await adminPage.goto(`/auftraege/${fixture.jobNumber}`);
    await expect(adminPage.getByTestId('field-work-pack')).toHaveCount(0);
    await expect(adminPage.getByRole('heading', { name: 'Details' })).toBeVisible();
    await expect(adminPage.getByRole('button', { name: 'Zuweisen', exact: true })).toBeVisible();

    await employeePage.goto(`/auftraege/${fixture.unassignedJobNumber}`);
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await expect(employeePage.getByTestId('field-work-pack')).toHaveCount(0);
    await outsiderPage.goto(`/auftraege/${fixture.jobNumber}`);
    await outsiderPage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await expect(outsiderPage.getByTestId('field-work-pack')).toHaveCount(0);
  });
});
