import { WORK_EXECUTION_LABELS } from '../../../lib/work-lifecycle/types';
import { expect, test } from '../support/fixtures';
import { getDispatchState } from '../../golden/support/db/dispatch';
import { getInventoryLedgerState } from '../../golden/support/db/inventory';
import { getAppliedWorkTemplateState, getWorkLifecycleState } from '../../golden/support/db/work';
import { createPlannedCalendarEntry } from '../../golden/support/steps/calendar';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  createCustomer,
  openCustomerDetail,
} from '../../golden/support/steps/customers';
import {
  acknowledgeDispatchOnJobPage,
  challengeDispatchOnJobPage,
  DISPATCH_ACKNOWLEDGE_ACTION,
  dispatchParkedJobFromParkplatz,
  openParkplatzPanel,
} from '../../golden/support/steps/dispatch';
import {
  planMaterialOnJobPage,
  returnMaterialOnJobPage,
  takeMaterialOnJobPage,
} from '../../golden/support/steps/inventory';
import { SHARED_COPY, testData, visibleText } from '../../golden/support/steps/shared';
import {
  changeTimeOnWorkPack,
  createAndPublishWorkTemplate,
  createJob,
  createProject,
  CUSTOMER_PACKAGE_TERM,
  FIELD_PACK_SECTION_ORDER,
  fieldPackAbsentTerms,
  fieldPackButton,
  fieldPackCallLink,
  fieldPackLink,
  fieldPackMoreJobDetails,
  fieldPackNavigationLink,
  fieldPrimaryNextAction,
  instructionPrerequisite,
  lifecycleSavedBanner,
  openFieldWorkPack,
  parkJobOnJobPage,
  removeJobAssignment,
  reportOwnBlockerOnJobPage,
  resolveOwnBlockerOnJobPage,
  setInstructionCompletionOnJobPage,
  transitionWork,
} from '../../golden/support/steps/work';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  closeWorkArtifactDialog,
  newWorkArtifactButton,
  workArtifactAction,
  workArtifactDialog,
  workArtifactField,
  workArtifactVersion,
} from '../../golden/support/spec-helpers/work-artifact-dialog';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { representativeFieldWorkPackState } from '../support/p1-16-steps';

function dateDigits(dateIso: string): string {
  return dateIso.split('-').reverse().join('');
}

const FIELD_VIEWPORT = { width: 390, height: 844 } as const;

// The standalone journey (first viewport, field actions, terminal read-only
// pack, office view) lives in tests/golden/p1-16.spec.ts.
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
    // Short suffix: the world already isolates the organization, and a 32-character
    // hex token wraps the phone header to three lines, which no real job title does.
    const fixtureTag = world.runId.slice(0, 8);
    const customerName = `P116 Audit Kunde ${fixtureTag}`;
    const contactName = `P116 Audit Kontakt ${fixtureTag}`;
    const siteName = `P116 Audit Heizzentrale ${fixtureTag}`;
    const projectNumber = `PRJ-${world.runId}-P116`;
    const projectTitle = `P116 Audit Projekt ${world.runId}`;
    const childJobNumber = `${projectNumber}-1`;
    const siblingJobNumber = `${projectNumber}-2`;
    const unassignedJobNumber = `AUF-${world.runId}-P116-UNASSIGNED`;
    const siblingJobTitle = `P116 Vertraulicher Geschwisterauftrag ${world.runId}`;
    const visitDate = ownedBerlinDateAtOffset('p1-16', 85);
    const emailDomain = testData`@example.test`;
    const contactNote = testData`Interne Kontaktnotiz für das Büro.`;
    const contactNoteStart = testData`Interne Kontakt`;
    const siteStreet = testData`Feldstraße 16`;
    const siteAddress = testData`Feldstraße 16, 10115 Berlin`;
    const accessNotes = testData`Schlüssel an der Pforte abholen.`;
    const siteNote = testData`Interne Standortbewertung für die Einsatzleitung.`;
    const siteNoteStart = testData`Interne Standort`;
    const jobDescription = testData`Störung prüfen und Ergebnis dokumentieren.`;

    await createCustomer(adminPage, customerName);
    await openCustomerDetail(adminPage, customerName);
    await addContactOnCustomerDetail(adminPage, {
      name: contactName,
      role: 'Objektleitung',
      phone: '+49 30 5550160',
      email: `office-only-${world.runId}${emailDomain}`,
      notes: contactNote,
      isPrimary: true,
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: siteName,
      street: siteStreet,
      postalCode: '10115',
      city: 'Berlin',
      accessNotes,
      notes: siteNote,
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
      title: `P116 Kindauftrag ${fixtureTag}`,
      description: jobDescription,
      projectNumber,
      clientName: customerName,
      siteName,
      contactName,
      assignEmployeeName: employeeName,
      plannedDateDigits: dateDigits(visitDate),
    });
    await createJob(adminPage, {
      jobNumber: siblingJobNumber,
      title: siblingJobTitle,
      projectNumber,
      clientName: customerName,
    });
    await createJob(adminPage, {
      jobNumber: unassignedJobNumber,
      title: `P116 Nicht zugewiesen ${world.runId}`,
      plannedDateDigits: dateDigits(visitDate),
    });

    const officeDraftTitle = `P116 interner Büroentwurf ${world.runId}`;
    await bueroPage.goto(`/auftraege/projekt/${projectNumber}/${childJobNumber}`);
    await newWorkArtifactButton(bueroPage).click();
    const officeDraftDialog = workArtifactDialog(bueroPage);
    await workArtifactField(officeDraftDialog, 'title').fill(officeDraftTitle);
    await workArtifactField(officeDraftDialog, 'summary').fill('Interner Entwurf für die Einsatzleitung.');
    await workArtifactField(officeDraftDialog, 'performedWork').fill('Noch nicht für das Feld freigegeben.');
    await workArtifactAction(officeDraftDialog, 'saveDraft').click();
    await expect(workArtifactVersion(officeDraftDialog, 1)).toBeVisible({
      timeout: 20_000,
    });
    await closeWorkArtifactDialog(officeDraftDialog);

    const stateBeforeOpen = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: childJobNumber,
    });
    await employeePage.setViewportSize(FIELD_VIEWPORT);
    const pack = await openFieldWorkPack(employeePage, childJobNumber, projectNumber);
    await expect(employeePage.getByRole('navigation', { name: SHARED_COPY.region.breadcrumb })).toContainText(
      projectTitle,
    );
    await expect(pack).toContainText(customerName);
    await expect(pack).toContainText(contactName);
    await expect(pack).toContainText(siteName);
    await expect(pack).toContainText(siteAddress);
    await expect(pack).toContainText(accessNotes);
    await expect(pack).toContainText(jobDescription);
    await expect(pack).not.toContainText(siblingJobTitle);
    await expect(pack).not.toContainText(emailDomain);
    await expect(pack).not.toContainText(contactNoteStart);
    await expect(pack).not.toContainText(siteNoteStart);
    await expect(pack).not.toContainText(officeDraftTitle);
    await expect(pack.getByRole('button', { name: SHARED_COPY.assignment.assign, exact: true })).toHaveCount(
      0,
    );
    await expect(fieldPackAbsentTerms(pack, 'prices')).toHaveCount(0);
    await expect(fieldPackCallLink(pack, contactName)).toHaveAttribute('href', 'tel:+49305550160');
    await expect(fieldPackNavigationLink(pack, siteStreet)).toHaveAttribute('href', /^geo:/);
    await expect(fieldPackButton(pack, 'copyAddress')).toBeVisible();

    const headingOrder = await pack.locator('h2, h3').allTextContents();
    for (const heading of FIELD_PACK_SECTION_ORDER) {
      expect(headingOrder).toContain(heading);
    }
    const [beforeVisit, lifecycleHeading, instructions, artifacts] = FIELD_PACK_SECTION_ORDER;
    expect(headingOrder.indexOf(beforeVisit)).toBeLessThan(headingOrder.indexOf(lifecycleHeading));
    expect(headingOrder.indexOf(lifecycleHeading)).toBeLessThan(headingOrder.indexOf(instructions));
    expect(headingOrder.indexOf(instructions)).toBeLessThan(headingOrder.indexOf(artifacts));
    const primaryAction = fieldPrimaryNextAction(pack);
    await expect(primaryAction).toHaveCount(1);
    const primaryBox = expectDefined(await primaryAction.boundingBox(), 'the primary action box');
    expect(primaryBox.y + primaryBox.height).toBeLessThanOrEqual(FIELD_VIEWPORT.height);
    for (const action of [
      fieldPackCallLink(pack, contactName),
      fieldPackNavigationLink(pack, siteStreet),
      primaryAction,
    ]) {
      const box = expectDefined(await action.boundingBox(), 'a field action box');
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    const stateAfterOpen = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: childJobNumber,
    });
    expect(stateAfterOpen).toEqual(stateBeforeOpen);

    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${childJobNumber}`);
    await expect(adminPage.getByTestId('field-work-pack')).toHaveCount(0);
    await expect(
      adminPage.getByRole('button', { name: SHARED_COPY.assignment.assign, exact: true }),
    ).toBeVisible();
    await bueroPage.goto(`/auftraege/projekt/${projectNumber}/${childJobNumber}`);
    await expect(bueroPage.getByTestId('field-work-pack')).toHaveCount(0);
    await expect(bueroPage.getByRole('heading', { name: SHARED_COPY.region.details })).toBeVisible();

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
    const visitDate = ownedBerlinDateAtOffset('p1-16', 86);
    for (const job of [
      { number: acknowledgeNumber, title: acknowledgeTitle },
      { number: challengeNumber, title: challengeTitle },
    ]) {
      await createJob(adminPage, {
        jobNumber: job.number,
        title: job.title,
        assignEmployeeName: employeeName,
        plannedDateDigits: dateDigits(visitDate),
      });
    }
    await parkJobOnJobPage(
      adminPage,
      acknowledgeNumber,
      'Einsatz wird bis zur Disposition bereitgehalten.',
      world.users.admin.firstName,
      visitDate,
    );
    await parkJobOnJobPage(
      adminPage,
      challengeNumber,
      'Einsatz wird bis zur Disposition bereitgehalten.',
      world.users.admin.firstName,
      visitDate,
    );
    const pack = await openFieldWorkPack(employeePage, acknowledgeNumber);
    await expect(fieldPrimaryNextAction(pack)).toHaveCount(1);
    await expect(fieldPrimaryNextAction(pack)).not.toHaveText(DISPATCH_ACKNOWLEDGE_ACTION);
    await openParkplatzPanel(adminPage);
    await dispatchParkedJobFromParkplatz(adminPage, {
      jobTitle: acknowledgeTitle,
      recipientName: employeeName,
    });
    await employeePage.bringToFront();
    await employeePage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(fieldPrimaryNextAction(pack)).toHaveText(DISPATCH_ACKNOWLEDGE_ACTION, {
      timeout: 30_000,
    });
    await expect(fieldPrimaryNextAction(pack)).toHaveCount(1);
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
        date: visitDate,
        time: '06:00',
        employeeNames: [employeeName],
        overrideReason: 'P1-16 reservierter Prüftermin.',
      });
    }

    const lifecycleBefore = await getWorkLifecycleState(world.orgId, {
      jobNumber: acknowledgeNumber,
    });
    await employeePage.bringToFront();
    await expect(representativeFieldWorkPackState(pack, 'unknown')).toBeVisible();
    await acknowledgeDispatchOnJobPage(employeePage, acknowledgeNumber);
    const acknowledged = await getDispatchState(world.orgId, acknowledgeNumber);
    expect(
      acknowledged.dispatches[0]?.acknowledgements.filter((entry) => entry.state === 'acknowledged'),
    ).toHaveLength(1);
    const lifecycleAfter = await getWorkLifecycleState(world.orgId, {
      jobNumber: acknowledgeNumber,
    });
    expect(lifecycleAfter.entity).toEqual(lifecycleBefore.entity);
    expect(lifecycleAfter.executionEvents).toEqual(lifecycleBefore.executionEvents);

    const challengeReason = testData`Zugang ist zum geplanten Zeitpunkt noch nicht bestätigt.`;
    await challengeDispatchOnJobPage(employeePage, challengeNumber, challengeReason);
    const challenged = await getDispatchState(world.orgId, challengeNumber);
    expect(
      challenged.dispatches[0]?.acknowledgements.filter((entry) => entry.state === 'challenged'),
    ).toHaveLength(1);
    await employeePage.reload();
    await expect(visibleText(employeePage, challengeReason)).toBeVisible();
  });

  test('ordered instructions, interruption, reopening, and completion feedback remain authoritative', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-16-F36…F61: execution transitions and gates, ordered/dependent
    // instructions, reopen, completion feedback and the explicit P1-17 handover
    // boundary. Contextual upload, artifact drafts and the terminal read-only
    // pack are the golden journey.
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
      plannedDateDigits: dateDigits(ownedBerlinDateAtOffset('p1-16', 87)),
      workTemplateName: templateName,
    });
    const pack = await openFieldWorkPack(employeePage, jobNumber);
    await expect(pack.getByText(firstInstruction, { exact: true })).toBeVisible();
    await expect(pack.getByText(secondInstruction, { exact: true })).toBeVisible();
    await expect(instructionPrerequisite(pack, firstInstruction)).toBeVisible();

    await transitionWork(employeePage, 'not_started', 'in_progress');
    await transitionWork(employeePage, 'in_progress', 'interrupted', {
      reason: 'Werkzeug wird aus dem Fahrzeug geholt.',
    });
    await transitionWork(employeePage, 'interrupted', 'in_progress');
    await setInstructionCompletionOnJobPage(employeePage, firstInstruction, true);
    await setInstructionCompletionOnJobPage(employeePage, firstInstruction, false);
    await setInstructionCompletionOnJobPage(employeePage, firstInstruction, true);

    await transitionWork(employeePage, 'in_progress', 'execution_complete');
    await expect(lifecycleSavedBanner(employeePage)).toBeVisible({ timeout: 20_000 });
    await expect(pack).toContainText(WORK_EXECUTION_LABELS.execution_complete);
    await expect(pack).not.toContainText(CUSTOMER_PACKAGE_TERM);

    const [applied, lifecycle] = await Promise.all([
      getAppliedWorkTemplateState(world.orgId, { jobNumber }),
      getWorkLifecycleState(world.orgId, { jobNumber }),
    ]);
    expect(applied.instructions.find((item) => item.content === firstInstruction)).toMatchObject({
      is_completed: true,
      last_status_changed_by: world.users.employee.id,
    });
    expect(lifecycle.executionEvents.map((event) => event.to_state)).toEqual([
      'in_progress',
      'interrupted',
      'in_progress',
      'execution_complete',
    ]);
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
        plannedDateDigits: dateDigits(ownedBerlinDateAtOffset('p1-16', 88)),
      });
    }
    const ledgerBeforePlanning = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId,
    );
    await planMaterialOnJobPage(
      adminPage,
      mainNumber,
      world.inventory.itemName,
      world.inventory.locationName,
      3,
    );
    const ledgerBefore = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId,
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
      1,
    );
    const ledgerAfterSecondPlan = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId,
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
    await expect(contextPack.getByText(world.users.employee.email, { exact: false })).toHaveCount(0);
    await expect(fieldPackAbsentTerms(contextPack, 'valuation')).toHaveCount(0);
    await expect(fieldPackLink(contextPack, 'inventory')).toHaveCount(0);

    await takeMaterialOnJobPage(employeePage, mainNumber, world.inventory.itemName, 2);
    await returnMaterialOnJobPage(employeePage, mainNumber, world.inventory.itemName, 1);
    const [applied, ledgerAfter, lifecycle] = await Promise.all([
      getAppliedWorkTemplateState(world.orgId, { jobNumber: mainNumber }),
      getInventoryLedgerState(world.orgId, world.inventory.itemId, world.inventory.locationId),
      getWorkLifecycleState(world.orgId, { jobNumber: mainNumber }),
    ]);
    expect(applied.timeSegments).toHaveLength(1);
    expect(applied.timeEntries).toHaveLength(0);
    expect(applied.inventoryMovements).toHaveLength(2);
    expect(applied.materials.some((line) => Number(line.planned_quantity) === 3)).toBe(true);
    expect(
      applied.materials.some(
        (line) => Number(line.taken_quantity) === 2 && Number(line.returned_quantity) === 1,
      ),
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
      plannedDateDigits: dateDigits(ownedBerlinDateAtOffset('p1-16', 89)),
    });
    const pack = await openFieldWorkPack(employeePage, jobNumber);
    await transitionWork(employeePage, 'not_started', 'in_progress');
    await reportOwnBlockerOnJobPage(employeePage, blockerDetails);
    await expect(pack.getByText(blockerDetails, { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(fieldPackLink(pack, 'reviewOpenPoints')).toBeVisible();
    let lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(lifecycle.blockers[0]).toMatchObject({
      details: blockerDetails,
      state: 'open',
    });
    await resolveOwnBlockerOnJobPage(employeePage, 'Zugang wurde durch die Objektleitung freigegeben.');
    lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(lifecycle.blockers[0]).toMatchObject({
      state: 'resolved',
      resolution_note: 'Zugang wurde durch die Objektleitung freigegeben.',
    });

    await expect(fieldPackAbsentTerms(pack, 'offline')).toHaveCount(0);
    await expect(fieldPackAbsentTerms(pack, 'laterSlices')).toHaveCount(0);
    await expect(fieldPackMoreJobDetails(pack)).toBeVisible();
    await removeJobAssignment(adminPage, jobNumber, employeeName);
    await employeePage.bringToFront();
    await employeePage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 30_000 });
    await expect(employeePage.getByTestId('field-work-pack')).toHaveCount(0);
    await employeePage.goto(`/auftraege/${jobNumber}`);
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
  });
});
