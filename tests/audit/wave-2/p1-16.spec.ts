import { resolve } from 'node:path';

import { expect, test } from '../../golden/support/fixtures';
import {
  getAppliedWorkTemplateState,
  getDispatchState,
  getInventoryLedgerState,
  getWorkArtifactState,
  getWorkLifecycleState,
} from '../../golden/support/db';
import {
  acknowledgeDispatchOnJobPage,
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  challengeDispatchOnJobPage,
  changeTimeOnWorkPack,
  createAndPublishWorkTemplate,
  createCustomer,
  createJob,
  createPlannedCalendarEntry,
  createProject,
  openCustomerDetail,
  dispatchParkedJobFromParkplatz,
  openFieldWorkPack,
  openParkplatzPanel,
  parkJobOnJobPage,
  planMaterialOnJobPage,
  removeJobAssignment,
  reportOwnBlockerOnJobPage,
  resolveOwnBlockerOnJobPage,
  returnMaterialOnJobPage,
  setInstructionCompletionOnJobPage,
  takeMaterialOnJobPage,
  transitionWorkOnJobPage,
  uploadDocumentOnJobPage,
  visibleText,
} from '../../golden/support/steps';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { ARTIFACTS_DIR } from '../../golden/support/world';
import { closeWorkArtifactDialog } from '../../golden/support/spec-helpers/work-artifact-dialog';
import { representativeFieldWorkPackState } from '../support/p1-16-steps';

test.describe.configure({ mode: 'serial' });

function dateDigits(dateIso: string): string {
  return dateIso.split('-').reverse().join('');
}

const DATES = Array.from({ length: 5 }, (_, index) => ownedBerlinDateAtOffset('p1-16', 85 + index));
const FIELD_VIEWPORT = { width: 390, height: 844 } as const;

test.describe('P1-16 exhaustive field work pack flows @AUDIT-W2-P1-16 @AUDIT-W2', () => {
  test('role-aware standalone and project-child packs expose only practical field context', async ({
    adminPage,
    bueroPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    // P1-16-F01…F26 and F83: assigned access, shared routes, minimal parent
    // projection, office continuity, server authorization, side-effect-free
    // opening, first-viewport order, practical contact actions, and privacy.
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const customerName = `P116 Audit Kunde ${world.runId}`;
    const contactName = `P116 Audit Kontakt ${world.runId}`;
    const siteName = `P116 Audit Heizzentrale ${world.runId}`;
    const projectNumber = `PRJ-${world.runId}-P116`;
    const projectTitle = `P116 Audit Projekt ${world.runId}`;
    const childJobNumber = `${projectNumber}-1`;
    const siblingJobNumber = `${projectNumber}-2`;
    const unassignedJobNumber = `AUF-${world.runId}-P116-UNASSIGNED`;

    await createCustomer(adminPage, customerName);
    await openCustomerDetail(adminPage, customerName);
    await addContactOnCustomerDetail(adminPage, {
      name: contactName,
      role: 'Objektleitung',
      phone: '+49 30 5550160',
      email: `office-only-${world.runId}@example.test`,
      notes: 'Interne Kontaktnotiz für das Büro.',
      isPrimary: true,
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: siteName,
      street: 'Feldstraße 16',
      postalCode: '10115',
      city: 'Berlin',
      accessNotes: 'Schlüssel an der Pforte abholen.',
      notes: 'Interne Standortbewertung für die Einsatzleitung.',
      isPrimary: true,
    });
    await createProject(adminPage, {
      projectNumber,
      title: projectTitle,
      clientName: customerName,
      siteName,
      contactName,
    });
    await createJob(adminPage, {
      jobNumber: childJobNumber,
      title: `P116 Kindauftrag ${world.runId}`,
      description: 'Störung prüfen und Ergebnis dokumentieren.',
      projectNumber,
      clientName: customerName,
      siteName,
      contactName,
      assignEmployeeName: employeeName,
      plannedDateDigits: dateDigits(DATES[0]),
    });
    await createJob(adminPage, {
      jobNumber: siblingJobNumber,
      title: `P116 Vertraulicher Geschwisterauftrag ${world.runId}`,
      projectNumber,
      clientName: customerName,
    });
    await createJob(adminPage, {
      jobNumber: unassignedJobNumber,
      title: `P116 Nicht zugewiesen ${world.runId}`,
      plannedDateDigits: dateDigits(DATES[0]),
    });

    const officeDraftTitle = `P116 interner Büroentwurf ${world.runId}`;
    await bueroPage.goto(`/auftraege/projekt/${projectNumber}/${childJobNumber}`);
    await bueroPage
      .getByTestId('work-artifacts-section')
      .getByRole('button', { name: 'Neu' })
      .click();
    const officeDraftDialog = bueroPage.getByRole('dialog');
    await officeDraftDialog.getByLabel('Titel').fill(officeDraftTitle);
    await officeDraftDialog
      .getByLabel('Zusammenfassung')
      .fill('Interner Entwurf für die Einsatzleitung.');
    await officeDraftDialog
      .getByLabel('Ausgeführte Arbeiten')
      .fill('Noch nicht für das Feld freigegeben.');
    await officeDraftDialog.getByRole('button', { name: 'Als Entwurf speichern' }).click();
    await expect(officeDraftDialog.getByText(/Version 1/)).toBeVisible({
      timeout: 20_000,
    });
    await closeWorkArtifactDialog(officeDraftDialog);

    const stateBeforeOpen = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: childJobNumber,
    });
    await employeePage.setViewportSize(FIELD_VIEWPORT);
    const pack = await openFieldWorkPack(employeePage, childJobNumber, projectNumber);
    await expect(pack).toContainText(projectTitle);
    await expect(pack).toContainText(customerName);
    await expect(pack).toContainText(contactName);
    await expect(pack).toContainText(siteName);
    await expect(pack).toContainText('Feldstraße 16, 10115 Berlin');
    await expect(pack).toContainText('Schlüssel an der Pforte abholen.');
    await expect(pack).toContainText('Störung prüfen und Ergebnis dokumentieren.');
    await expect(pack).not.toContainText(`P116 Vertraulicher Geschwisterauftrag ${world.runId}`);
    await expect(pack).not.toContainText('@example.test');
    await expect(pack).not.toContainText('Interne Kontakt');
    await expect(pack).not.toContainText('Interne Standort');
    await expect(pack).not.toContainText(officeDraftTitle);
    await expect(pack.getByRole('button', { name: 'Zuweisen', exact: true })).toHaveCount(0);
    await expect(pack.getByText(/Abrechenbar|Einkaufspreis|Verkaufspreis|Marge/)).toHaveCount(0);
    await expect(pack.getByRole('link', { name: `${contactName} anrufen` })).toHaveAttribute(
      'href',
      'tel:+49305550160'
    );
    await expect(pack.getByRole('link', { name: /Navigation zu Feldstraße 16/ })).toHaveAttribute(
      'href',
      /^geo:/
    );
    await expect(pack.getByRole('button', { name: 'Adresse kopieren' })).toBeVisible();

    const headingOrder = await pack.locator('h2, h3').allTextContents();
    for (const heading of [
      'Vor dem Einsatz',
      'Arbeitsstand',
      'Arbeitsanweisungen & Notizen',
      'Arbeitsnachweise',
    ]) {
      expect(headingOrder).toContain(heading);
    }
    expect(headingOrder.indexOf('Vor dem Einsatz')).toBeLessThan(
      headingOrder.indexOf('Arbeitsstand')
    );
    expect(headingOrder.indexOf('Arbeitsstand')).toBeLessThan(
      headingOrder.indexOf('Arbeitsanweisungen & Notizen')
    );
    expect(headingOrder.indexOf('Arbeitsanweisungen & Notizen')).toBeLessThan(
      headingOrder.indexOf('Arbeitsnachweise')
    );
    const primaryAction = pack.getByTestId('field-primary-next-action');
    await expect(primaryAction).toHaveCount(1);
    const primaryBox = await primaryAction.boundingBox();
    expect(primaryBox).not.toBeNull();
    expect(primaryBox!.y + primaryBox!.height).toBeLessThanOrEqual(FIELD_VIEWPORT.height);
    for (const action of [
      pack.getByRole('link', { name: `${contactName} anrufen` }),
      pack.getByRole('link', { name: /Navigation zu Feldstraße 16/ }),
      primaryAction,
    ]) {
      const box = await action.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    const stateAfterOpen = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: childJobNumber,
    });
    expect(stateAfterOpen).toEqual(stateBeforeOpen);

    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${childJobNumber}`);
    await expect(adminPage.getByTestId('field-work-pack')).toHaveCount(0);
    await expect(adminPage.getByRole('button', { name: 'Zuweisen', exact: true })).toBeVisible();
    await bueroPage.goto(`/auftraege/projekt/${projectNumber}/${childJobNumber}`);
    await expect(bueroPage.getByTestId('field-work-pack')).toHaveCount(0);
    await expect(bueroPage.getByRole('heading', { name: 'Details' })).toBeVisible();

    await employeePage.goto(`/auftraege/${unassignedJobNumber}`);
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await expect(employeePage.getByTestId('field-work-pack')).toHaveCount(0);
    await outsiderPage.goto(`/auftraege/projekt/${projectNumber}/${childJobNumber}`);
    await outsiderPage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await expect(outsiderPage.getByTestId('field-work-pack')).toHaveCount(0);
  });

  test('dispatch and readiness keep one next action without changing execution facts', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-16-F27…F35: pending dispatch priority, one CTA, canonical readiness,
    // honest unknowns, acknowledgement/challenge ownership, and no cross-domain
    // time, stock, status, promise, or message mutation.
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const acknowledgeNumber = `AUF-${world.runId}-P116-DISPATCH-ACK`;
    const challengeNumber = `AUF-${world.runId}-P116-DISPATCH-QUESTION`;
    const acknowledgeTitle = `P116 Einsatzbestätigung ${world.runId}`;
    const challengeTitle = `P116 Einsatzrückfrage ${world.runId}`;
    for (const job of [
      { number: acknowledgeNumber, title: acknowledgeTitle },
      { number: challengeNumber, title: challengeTitle },
    ]) {
      await createJob(adminPage, {
        jobNumber: job.number,
        title: job.title,
        assignEmployeeName: employeeName,
        plannedDateDigits: dateDigits(DATES[1]),
      });
    }
    await parkJobOnJobPage(
      adminPage,
      acknowledgeNumber,
      'Einsatz wird bis zur Disposition bereitgehalten.',
      world.users.admin.firstName,
      DATES[1]
    );
    await parkJobOnJobPage(
      adminPage,
      challengeNumber,
      'Einsatz wird bis zur Disposition bereitgehalten.',
      world.users.admin.firstName,
      DATES[1]
    );
    const pack = await openFieldWorkPack(employeePage, acknowledgeNumber);
    await expect(pack.getByTestId('field-primary-next-action')).toHaveCount(1);
    await expect(pack.getByTestId('field-primary-next-action')).not.toHaveText(
      'Einsatz bestätigen'
    );
    await openParkplatzPanel(adminPage);
    await dispatchParkedJobFromParkplatz(adminPage, {
      jobTitle: acknowledgeTitle,
      recipientName: employeeName,
    });
    await employeePage.bringToFront();
    await employeePage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(pack.getByTestId('field-primary-next-action')).toHaveText('Einsatz bestätigen', {
      timeout: 30_000,
    });
    await expect(pack.getByTestId('field-primary-next-action')).toHaveCount(1);
    await adminPage.bringToFront();
    await dispatchParkedJobFromParkplatz(adminPage, {
      jobTitle: challengeTitle,
      recipientName: employeeName,
    });
    for (const job of [
      { number: acknowledgeNumber, title: acknowledgeTitle },
      { number: challengeNumber, title: challengeTitle },
    ]) {
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: job.number,
        date: DATES[1],
        time: '06:00',
        employeeNames: [employeeName],
        overrideReason: 'P1-16 reservierter Prüftermin.',
      });
    }

    const lifecycleBefore = await getWorkLifecycleState(world.orgId, {
      jobNumber: acknowledgeNumber,
    });
    await employeePage.bringToFront();
    await expect(representativeFieldWorkPackState(pack, 'Nicht bewertet')).toBeVisible();
    await acknowledgeDispatchOnJobPage(employeePage, acknowledgeNumber);
    const acknowledged = await getDispatchState(world.orgId, acknowledgeNumber);
    expect(
      acknowledged.dispatches[0].acknowledgements.filter((entry) => entry.state === 'acknowledged')
    ).toHaveLength(1);
    const lifecycleAfter = await getWorkLifecycleState(world.orgId, {
      jobNumber: acknowledgeNumber,
    });
    expect(lifecycleAfter.entity).toEqual(lifecycleBefore.entity);
    expect(lifecycleAfter.executionEvents).toEqual(lifecycleBefore.executionEvents);

    const challengeReason = 'Zugang ist zum geplanten Zeitpunkt noch nicht bestätigt.';
    await challengeDispatchOnJobPage(employeePage, challengeNumber, challengeReason);
    const challenged = await getDispatchState(world.orgId, challengeNumber);
    expect(
      challenged.dispatches[0].acknowledgements.filter((entry) => entry.state === 'challenged')
    ).toHaveLength(1);
    await employeePage.reload();
    await expect(visibleText(employeePage, challengeReason)).toBeVisible();
  });

  test('instructions, lifecycle, evidence, documents, and artifacts remain authoritative', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-16-F36…F61: execution transitions and gates, ordered/dependent
    // instructions, reopen, evidence expectations, existing artifact ownership,
    // direct contextual upload, persisted recovery, terminal read-only behavior,
    // and the explicit P1-17 handover boundary.
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const templateName = `P116 Ausführungsvorlage ${world.runId}`;
    const firstInstruction = `Anlage absichern ${world.runId}`;
    const secondInstruction = `Messwerte dokumentieren ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P116-EXECUTION`;
    await createAndPublishWorkTemplate(adminPage, {
      name: templateName,
      targetType: 'job',
      firstItem: firstInstruction,
      secondItem: secondInstruction,
    });
    await createJob(adminPage, {
      jobNumber,
      title: `P116 Ausführung ${world.runId}`,
      assignEmployeeName: employeeName,
      plannedDateDigits: dateDigits(DATES[2]),
      workTemplateName: templateName,
    });
    const pack = await openFieldWorkPack(employeePage, jobNumber);
    await expect(pack.getByText(firstInstruction, { exact: true })).toBeVisible();
    await expect(pack.getByText(secondInstruction, { exact: true })).toBeVisible();
    await expect(
      pack.getByText(`Voraussetzung: ${firstInstruction}`, { exact: true })
    ).toBeVisible();

    await transitionWorkOnJobPage(employeePage, 'In Ausführung');
    await transitionWorkOnJobPage(
      employeePage,
      'Unterbrochen',
      'Werkzeug wird aus dem Fahrzeug geholt.'
    );
    await transitionWorkOnJobPage(employeePage, 'In Ausführung');
    await setInstructionCompletionOnJobPage(employeePage, firstInstruction, true);
    await setInstructionCompletionOnJobPage(employeePage, firstInstruction, false);
    await setInstructionCompletionOnJobPage(employeePage, firstInstruction, true);

    await uploadDocumentOnJobPage(
      employeePage,
      jobNumber,
      resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
      'upload-fixture'
    );
    const artifacts = employeePage.getByTestId('work-artifacts-section');
    await artifacts.getByRole('button', { name: 'Neu', exact: true }).click();
    const dialog = employeePage.getByRole('dialog');
    const artifactTitle = `P116 Feldbericht ${world.runId}`;
    await dialog.getByLabel('Titel').fill(artifactTitle);
    await dialog.getByLabel('Zusammenfassung').fill('Ausführung und Ergebnis sind dokumentiert.');
    await dialog
      .getByLabel('Ausgeführte Arbeiten')
      .fill('Ausführung geprüft und Ergebnis dokumentiert.');
    await dialog.getByRole('button', { name: 'Als Entwurf speichern' }).click();
    await expect(dialog.getByText(/Version 1/)).toBeVisible({
      timeout: 20_000,
    });
    await closeWorkArtifactDialog(dialog);
    await employeePage.reload();
    await expect(
      employeePage.getByTestId('work-artifacts-section').getByText(artifactTitle, { exact: true })
    ).toBeVisible();

    await transitionWorkOnJobPage(employeePage, 'Ausführung abgeschlossen');
    await expect(
      employeePage.getByRole('alert').filter({
        hasText: 'Arbeitsstand wurde aktualisiert.',
      })
    ).toBeVisible({ timeout: 20_000 });
    await expect(pack.getByTestId('field-primary-next-action')).toHaveCount(0);
    await expect(artifacts.getByRole('button', { name: 'Neu', exact: true })).toHaveCount(0);
    await expect(pack.getByRole('button', { name: 'Hochladen' })).toHaveCount(0);
    await expect(
      pack.getByRole('button', {
        name: /Arbeitszeit starten|Arbeitszeit beenden/,
      })
    ).toHaveCount(0);
    await expect(pack).toContainText('Ausführung abgeschlossen');
    await expect(pack).not.toContainText('Kundenpaket');

    const [applied, lifecycle, artifactState] = await Promise.all([
      getAppliedWorkTemplateState(world.orgId, { jobNumber }),
      getWorkLifecycleState(world.orgId, { jobNumber }),
      getWorkArtifactState(world.orgId, { jobNumber }),
    ]);
    expect(applied.instructions[0]).toMatchObject({
      is_completed: true,
      last_status_changed_by: world.users.employee.id,
    });
    expect(applied.documentLinks).toHaveLength(1);
    expect(lifecycle.entity).toMatchObject({
      execution_state: 'execution_complete',
    });
    expect(lifecycle.executionEvents.map((event) => event.to_state)).toEqual([
      'in_progress',
      'interrupted',
      'in_progress',
      'execution_complete',
    ]);
    expect(artifactState.artifacts[0]).toMatchObject({
      status: 'draft',
      created_by: world.users.employee.id,
    });

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await expect(adminPage.getByTestId('field-work-pack')).toHaveCount(0);
    await expect(adminPage.getByRole('button', { name: 'Zuweisen', exact: true })).toBeVisible();
  });

  test('time and material context stay separate from planning, valuation, and consumption', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-16-F62…F77: own time only, start/switch/stop, assignment versus
    // attendance, planned and unplanned material actions, return, field privacy,
    // persisted stock history, and no schedule/stock/time or consumption repair.
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const mainNumber = `AUF-${world.runId}-P116-CONTEXT`;
    const switchNumber = `AUF-${world.runId}-P116-SWITCH`;
    const mainTitle = `P116 Zeit und Material ${world.runId}`;
    const switchTitle = `P116 Vorheriger Einsatz ${world.runId}`;
    for (const job of [
      { number: mainNumber, title: mainTitle },
      { number: switchNumber, title: switchTitle },
    ]) {
      await createJob(adminPage, {
        jobNumber: job.number,
        title: job.title,
        assignEmployeeName: employeeName,
        plannedDateDigits: dateDigits(DATES[3]),
      });
    }
    const ledgerBeforePlanning = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId
    );
    await planMaterialOnJobPage(
      adminPage,
      mainNumber,
      world.inventory.itemName,
      world.inventory.locationName,
      3
    );
    const ledgerBefore = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId
    );
    expect(ledgerBefore).toEqual(ledgerBeforePlanning);

    await openFieldWorkPack(employeePage, switchNumber);
    await changeTimeOnWorkPack(employeePage, 'start');
    const contextPack = await openFieldWorkPack(employeePage, mainNumber);
    await planMaterialOnJobPage(
      adminPage,
      mainNumber,
      world.inventory.itemName,
      world.inventory.locationName,
      1
    );
    const ledgerAfterSecondPlan = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId
    );
    expect(ledgerAfterSecondPlan).toEqual(ledgerBefore);
    await employeePage.bringToFront();
    // Role fixtures use separate browser contexts, so bringToFront does not
    // reliably emit the tab-focus event that drives the production catch-up.
    await employeePage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(contextPack.getByText(world.inventory.itemName, { exact: true })).toHaveCount(2, {
      timeout: 30_000,
    });
    await changeTimeOnWorkPack(employeePage, 'switch');
    await changeTimeOnWorkPack(employeePage, 'stop');
    await expect(contextPack.getByText(world.users.employee.email, { exact: false })).toHaveCount(
      0
    );
    await expect(
      contextPack.getByText(/Abrechenbar|Bewertung|Einkaufspreis|Verkaufspreis/)
    ).toHaveCount(0);
    await expect(contextPack.getByRole('link', { name: 'Inventar' })).toHaveCount(0);

    await takeMaterialOnJobPage(employeePage, mainNumber, world.inventory.itemName, 2);
    await returnMaterialOnJobPage(employeePage, mainNumber, world.inventory.itemName, 1);
    const [applied, ledgerAfter, lifecycle] = await Promise.all([
      getAppliedWorkTemplateState(world.orgId, { jobNumber: mainNumber }),
      getInventoryLedgerState(world.orgId, world.inventory.itemId, world.inventory.locationId),
      getWorkLifecycleState(world.orgId, { jobNumber: mainNumber }),
    ]);
    expect(applied.timeEntries).toHaveLength(1);
    expect(applied.inventoryMovements).toHaveLength(2);
    expect(applied.materials.some((line) => Number(line.planned_quantity) === 3)).toBe(true);
    expect(
      applied.materials.some(
        (line) => Number(line.taken_quantity) === 2 && Number(line.returned_quantity) === 1
      )
    ).toBe(true);
    expect(ledgerAfter.quantityOnHand).toBe(ledgerBefore.quantityOnHand - 1);
    expect(ledgerAfter.movementCount).toBe(ledgerBefore.movementCount + 2);
    expect(lifecycle.entity).toMatchObject({ execution_state: 'in_progress' });
    expect(lifecycle.executionEvents.map((event) => event.to_state)).toEqual(['in_progress']);
  });

  test('own blockers, assignment revocation, recovery states, and later-slice boundaries stay explicit', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-16-F78…F82 and F84…F94: own blocker lifecycle, issue summary,
    // retry/stale contracts, assignment revocation and Realtime catch-up,
    // accessible field controls, no offline promise or external provider,
    // no handover/message/service/commercial scope, and authoritative actions.
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const jobNumber = `AUF-${world.runId}-P116-BLOCKER`;
    const blockerDetails = `P116 Zugang fehlt ${world.runId}`;
    await createJob(adminPage, {
      jobNumber,
      title: `P116 Blocker und Entzug ${world.runId}`,
      assignEmployeeName: employeeName,
      plannedDateDigits: dateDigits(DATES[4]),
    });
    const pack = await openFieldWorkPack(employeePage, jobNumber);
    await transitionWorkOnJobPage(employeePage, 'In Ausführung');
    await reportOwnBlockerOnJobPage(employeePage, blockerDetails);
    await expect(pack.getByText(blockerDetails, { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(pack.getByRole('link', { name: 'Offene Punkte prüfen' })).toBeVisible();
    let lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(lifecycle.blockers[0]).toMatchObject({
      details: blockerDetails,
      state: 'open',
    });
    await resolveOwnBlockerOnJobPage(
      employeePage,
      'Zugang wurde durch die Objektleitung freigegeben.'
    );
    lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(lifecycle.blockers[0]).toMatchObject({
      state: 'resolved',
      resolution_note: 'Zugang wurde durch die Objektleitung freigegeben.',
    });

    await expect(pack.getByText(/offline/i)).toHaveCount(0);
    await expect(
      pack.getByText(
        /\bGPS\b|\bGoogle Maps\b|\bNachricht senden\b|\bKundenpaket\b|\bRechnung\b|\bServicehistorie\b/i
      )
    ).toHaveCount(0);
    await expect(pack.getByText('Weitere Auftragsangaben')).toBeVisible();
    await removeJobAssignment(adminPage, jobNumber, employeeName);
    await employeePage.bringToFront();
    await employeePage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 30_000 });
    await expect(employeePage.getByTestId('field-work-pack')).toHaveCount(0);
    await employeePage.goto(`/auftraege/${jobNumber}`);
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
  });
});
