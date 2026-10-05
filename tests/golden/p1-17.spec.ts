import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from './support/fixtures';
import { berlinDateAtOffset } from './support/date-ownership';
import { getDispatchState } from './support/db/dispatch';
import { getWorkArtifactState, getWorkHandoverState, seedPublishedWorkTemplate } from './support/db/work';
import {
  approveWorkArtifact,
  beginWorkArtifact,
  closeWorkArtifactDialog,
  readPopupBodyText,
  selectWorkArtifactSeverity,
  selectWorkArtifactUnit,
  submitWorkArtifactAndClose,
  workArtifactAction,
  workArtifactCustomerDecisionPanel,
  workArtifactDialog,
  workArtifactEntry,
  workArtifactField,
  workArtifactOption,
  fillWorkArtifactVisit,
} from './support/spec-helpers/work-artifact-dialog';
import { createPlannedCalendarEntry } from './support/steps/calendar';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  createCustomer,
  openCustomerDetail,
} from './support/steps/customers';
import {
  acknowledgeDispatchOnJobPage,
  dispatchParkedJobFromParkplatz,
  openParkplatzPanel,
} from './support/steps/dispatch';
import { uploadDocumentOnJobPage } from './support/steps/documents';
import { planMaterialOnJobPage, takeMaterialOnJobPage } from './support/steps/inventory';
import { testData, typeIntoDatePickerById } from './support/steps/shared';
import {
  changeTimeOnWorkPack,
  completeExecutionAsManager,
  confirmLifecycleReason,
  createJob,
  fieldPackButton,
  handoverAction,
  handoverField,
  handoverMessage,
  handoverReleaseHistory,
  handoverReviewLink,
  handoverStateLabel,
  HANDOVER_TEXT,
  openFieldWorkPack,
  parkJobOnJobPage,
  selectAllHandoverSources,
  setInstructionCompletionOnJobPage,
  transitionWork,
  workHandoverSection,
} from './support/steps/work';

async function completeWithManagerOverride(page: Page, jobNumber: string): Promise<void> {
  await page.goto(`/auftraege/${encodeURIComponent(jobNumber)}`);
  await completeExecutionAsManager(page, {
    reason: 'Offene Nachweise werden transparent an die Übergabeprüfung weitergegeben.',
    managerException: 'use',
  });
}

async function releaseCurrentDraft(page: Page): Promise<string> {
  const section = workHandoverSection(page);
  await selectAllHandoverSources(section);
  await handoverAction(section, 'saveDraft').click();
  await expect(handoverMessage(section, 'draftSaved')).toBeVisible({
    timeout: 20_000,
  });
  await expect(section).toContainText(HANDOVER_TEXT.openReviewPoints);
  await expect(section).toContainText(HANDOVER_TEXT.notAssessed);
  const override = handoverField(section, 'exceptionReason');
  if (await override.isVisible().catch(() => false)) {
    await override.fill('Offener Mangel und fehlende Unterschrift sind im Paket klar ausgewiesen.');
  }
  const popupPromise = page.waitForEvent('popup');
  await handoverAction(section, 'openPreview').click();
  const preview = await popupPromise;
  await preview.waitForLoadState('domcontentloaded');
  await expect(handoverMessage(section, 'previewCreated')).toBeVisible({
    timeout: 20_000,
  });
  const html = await readPopupBodyText(preview);
  await handoverAction(section, 'release').click();
  await expect(handoverMessage(section, 'released')).toBeVisible({
    timeout: 30_000,
  });
  await preview.close();
  return html;
}

// Project packages composed from child releases, stale office drafts and the
// project-level successor are edge cases in tests/audit/wave-2/p1-17.spec.ts;
// the organization boundary is in supabase/tests/work_execution_boundaries.sql.
test.describe('P1-17 field execution and office handover @P1-17 @GG-04', () => {
  test('a dispatched job is executed, handed over, withdrawn, and released again @P1-17-stage-setup @P1-17-stage-execution @P1-17-stage-handover @P1-17-stage-reopen @P1-17-stage-boundaries', async ({
    adminPage,
    bueroPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    const customerName = `P117 Golden Kunde ${world.runId}`;
    const contactName = `P117 Golden Kontakt ${world.runId}`;
    const siteName = `P117 Golden Heizzentrale ${world.runId}`;
    const templateName = `P117 Golden Vorlage ${world.runId}`;
    const instruction = `Anlage sicher übergeben ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P117-GOLDEN`;
    const jobTitle = `P117 Golden Einsatz ${world.runId}`;
    const reportTitle = `P117 Kundenbericht ${world.runId}`;
    const measurementTitle = `P117 Aufmaß ${world.runId}`;
    const defectTitle = `P117 Mangel ${world.runId}`;
    const changeTitle = `P117 Regienachweis ${world.runId}`;
    const internalTitle = `P117 INTERN ${world.runId}`;
    const internalSecret = testData`INTERNES-GEHEIMNIS-P117`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const visitDate = berlinDateAtOffset(90);

    await test.step('Plan, park, dispatch and confirm the assigned job', async () => {
      // P1-17-F01…F22: target, role, contact, template, schedule, dispatch,
      // assignment and side-effect-free initial handover state.
      await createCustomer(adminPage, customerName);
      await openCustomerDetail(adminPage, customerName);
      await addContactOnCustomerDetail(adminPage, {
        name: contactName,
        role: 'Objektleitung',
        phone: '+49 30 5550170',
        email: `p117-${world.runId}@example.test`,
        notes: 'Interne Kontaktnotiz darf nie in das Kundenpaket.',
        isPrimary: true,
      });
      await addSiteOnCustomerDetail(adminPage, {
        name: siteName,
        street: 'Übergabestraße 17',
        postalCode: '10115',
        city: 'Berlin',
        notes: 'Interne Standortnotiz darf nie in das Kundenpaket.',
        isPrimary: true,
      });
      await seedPublishedWorkTemplate({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        name: templateName,
        targetType: 'job',
        items: [{ content: instruction, evidenceDescription: 'Kundenfähiger Abschlussbericht' }],
      });
      await createJob(adminPage, {
        jobNumber,
        title: jobTitle,
        clientName: customerName,
        siteName,
        contactName,
        assignEmployeeName: employeeName,
        workTemplateName: templateName,
      });
      await planMaterialOnJobPage(
        adminPage,
        jobNumber,
        world.inventory.itemName,
        world.inventory.locationName,
        2,
      );
      await parkJobOnJobPage(
        adminPage,
        jobNumber,
        'Einsatz bleibt bis zur disponierten Übergabeplanung geparkt.',
        world.users.admin.firstName,
        visitDate,
      );
      await openParkplatzPanel(adminPage);
      await dispatchParkedJobFromParkplatz(adminPage, {
        jobTitle,
        recipientName: employeeName,
      });
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: jobNumber,
        date: visitDate,
        time: '06:00',
        employeeNames: [employeeName],
        overrideReason: 'P1-17 deterministischer Einsatztermin.',
      });
      await acknowledgeDispatchOnJobPage(employeePage, jobNumber);
      await adminPage.goto(`/auftraege/${jobNumber}`);
      const unparkDialog = await confirmLifecycleReason(
        adminPage,
        'continuePlanning',
        'Einsatz ist disponiert und kann ausgeführt werden.',
      );
      await expect(unparkDialog).toHaveCount(0, { timeout: 20_000 });

      const [dispatch, handover] = await Promise.all([
        getDispatchState(world.orgId, jobNumber),
        getWorkHandoverState(world.orgId, { jobNumber }),
      ]);
      expect(dispatch.dispatches).toHaveLength(1);
      expect(handover.package).toBeNull();
    });

    await test.step('Execute the work and capture the GG-04 evidence set', async () => {
      // P1-17-F23…F57: assigned execution, checklist, time/material, photo,
      // measurement, defect/change, customer refusal, approval and privacy.
      const pack = await openFieldWorkPack(employeePage, jobNumber);
      await transitionWork(employeePage, 'not_started', 'in_progress');
      await setInstructionCompletionOnJobPage(employeePage, instruction, true);
      await changeTimeOnWorkPack(employeePage, 'start');
      await changeTimeOnWorkPack(employeePage, 'stop');
      await takeMaterialOnJobPage(employeePage, jobNumber, world.inventory.itemName, 1);
      await uploadDocumentOnJobPage(
        employeePage,
        jobNumber,
        resolve(process.cwd(), 'public/logo-icon-light.svg'),
        'logo-icon-light',
      );

      let dialog = await beginWorkArtifact(employeePage, {
        kind: 'work_report',
        title: reportTitle,
        summary: `Kundenfähiger Nachweis ${reportTitle}`,
        customerFacing: true,
      });
      await fillWorkArtifactVisit(dialog, { date: visitDate, from: '06:00', to: '08:00' });
      await workArtifactField(dialog, 'performedWork').fill('Anlage geprüft und übergabefähig dokumentiert.');
      await workArtifactOption(dialog, 'customerDecisionRequired').click();
      await workArtifactOption(dialog, 'signatureRequired').click();
      await submitWorkArtifactAndClose(dialog);

      dialog = await beginWorkArtifact(employeePage, {
        kind: 'measurement',
        title: measurementTitle,
        summary: `Kundenfähiger Nachweis ${measurementTitle}`,
        customerFacing: true,
      });
      await typeIntoDatePickerById(dialog, 'artifact-measurement-date', visitDate);
      await workArtifactField(dialog, 'measurementLocation').fill('Heizzentrale');
      await workArtifactAction(dialog, 'addMeasurementLine').click();
      await workArtifactField(dialog, 'lineName').fill('Kupferrohr');
      await dialog.locator('#artifact-measurement-quantity-0').fill('4,5');
      await selectWorkArtifactUnit(employeePage, dialog, 'meter');
      await submitWorkArtifactAndClose(dialog);

      dialog = await beginWorkArtifact(employeePage, {
        kind: 'defect',
        title: defectTitle,
        summary: `Kundenfähiger Nachweis ${defectTitle}`,
        customerFacing: true,
      });
      await workArtifactField(dialog, 'defectDescription').fill('Dämmung muss nachgearbeitet werden.');
      await workArtifactField(dialog, 'location').fill('Heizzentrale');
      await selectWorkArtifactSeverity(employeePage, dialog, 'medium');
      await submitWorkArtifactAndClose(dialog);

      dialog = await beginWorkArtifact(employeePage, {
        kind: 'change_work',
        title: changeTitle,
        summary: `Kundenfähiger Nachweis ${changeTitle}`,
        customerFacing: true,
      });
      await workArtifactField(dialog, 'changeWork').fill('Zusätzliche Absperrung dokumentiert.');
      await workArtifactField(dialog, 'reason').fill('Leitungsführung wurde vor Ort präzisiert.');
      await workArtifactField(dialog, 'requestedBy').fill('Objektleitung vor Ort');
      await submitWorkArtifactAndClose(dialog);

      dialog = await beginWorkArtifact(employeePage, {
        kind: 'work_report',
        title: internalTitle,
        summary: `Kundenfähiger Nachweis ${internalTitle}`,
      });
      await workArtifactField(dialog, 'performedWork').fill(internalSecret);
      await workArtifactAction(dialog, 'saveDraft').click();
      await closeWorkArtifactDialog(dialog);

      await adminPage.goto(`/auftraege/${jobNumber}`);
      for (const title of [reportTitle, measurementTitle, defectTitle, changeTitle]) {
        await approveWorkArtifact(adminPage, title);
      }
      await employeePage.reload();
      await workArtifactEntry(employeePage, reportTitle).click();
      dialog = workArtifactDialog(employeePage);
      await workArtifactCustomerDecisionPanel(dialog).click();
      await dialog.locator('#artifact-customer-name').fill('Erika Beispiel');
      await dialog
        .locator('#artifact-action-reason')
        .fill('Kundin bestätigt die Arbeiten, lehnt eine digitale Unterschrift jedoch ab.');
      await workArtifactAction(dialog, 'recordRefusal').click();
      await closeWorkArtifactDialog(dialog);

      const artifacts = await getWorkArtifactState(world.orgId, { jobNumber });
      expect(artifacts.measurements).toHaveLength(1);
      expect(artifacts.defects).toHaveLength(1);
      expect(artifacts.changes).toHaveLength(1);
      expect(artifacts.actions.some((action) => action.action_type === 'customer_refused')).toBe(true);
      await expect(pack).toBeVisible({ timeout: 20_000 });
      await expect(pack).not.toContainText(internalSecret);
    });

    await test.step('Review, preview and atomically release the exact package', async () => {
      // P1-17-F58…F88: completion versus handover, classified gates, exact
      // sources, preview privacy, reasoned override, immutable release and field projection.
      await completeWithManagerOverride(adminPage, jobNumber);
      await adminPage.goto(`/auftraege/${jobNumber}`);
      await expect(handoverReviewLink(adminPage)).toBeVisible();
      await handoverReviewLink(adminPage).click();
      const section = workHandoverSection(adminPage);
      await expect(section).not.toContainText(internalTitle);
      const previewText = await releaseCurrentDraft(adminPage);
      expect(previewText).toContain(customerName);
      expect(previewText).toContain(contactName);
      expect(previewText).not.toContain(internalSecret);
      expect(previewText).not.toContain('Interne Kontaktnotiz');

      const handover = await getWorkHandoverState(world.orgId, { jobNumber });
      expect(handover.target).toMatchObject({ execution_state: 'handed_over' });
      expect(handover.releases).toHaveLength(1);
      const release = handover.releases[0];
      expect(handover.package).toMatchObject({ state: 'released', current_release_id: release?.id });
      expect(handover.documents).toHaveLength(1);
      expect(release).toMatchObject({
        commercial_readiness: 'ready_with_exceptions',
        target_snapshot: expect.objectContaining({ customerName, contactName }),
      });

      const fieldPack = await openFieldWorkPack(employeePage, jobNumber);
      await expect(fieldPack).toContainText(handoverStateLabel('released'));
      await expect(fieldPackButton(fieldPack, 'handoverDocument')).toBeVisible();
    });

    await test.step('Withdraw, correct and re-release without rewriting history', async () => {
      // P1-17-F89…F101: reasoned withdrawal, correction reopening, successor
      // draft/release, predecessor linkage and preserved lifecycle/package events.
      await adminPage.goto(`/auftraege/${jobNumber}/uebergabe`);
      const section = workHandoverSection(adminPage);
      await handoverField(section, 'withdrawReason').fill(
        'Seriennummer muss nach dem Termin ergänzt werden.',
      );
      await handoverAction(section, 'withdraw').click();
      await expect(handoverMessage(section, 'withdrawn')).toBeVisible({
        timeout: 20_000,
      });
      await adminPage.reload();
      const reopenSection = workHandoverSection(adminPage);
      await handoverField(reopenSection, 'reopenReason').fill('Techniker ergänzt die Seriennummer vor Ort.');
      await handoverAction(reopenSection, 'reopenForCorrection').click();
      await expect(handoverMessage(reopenSection, 'reopened')).toBeVisible({
        timeout: 20_000,
      });

      await completeWithManagerOverride(adminPage, jobNumber);
      await adminPage.goto(`/auftraege/${jobNumber}/uebergabe`);
      await releaseCurrentDraft(adminPage);
      const state = await getWorkHandoverState(world.orgId, { jobNumber });
      expect(state.releases).toHaveLength(2);
      expect(state.releases[1]?.previous_release_id).toBe(state.releases[0]?.id);
      expect(state.events.map((event) => event.event_type)).toEqual(
        expect.arrayContaining(['released', 'handover_withdrawn', 'review_returned', 'execution_reopened']),
      );
      expect(state.target).toMatchObject({ execution_state: 'handed_over' });
    });

    await test.step('The office keeps the history while field and foreign sessions are refused', async () => {
      // P1-17-F102…F109: office continuity, assigned-field minimalism and
      // non-reviewer route denial.
      await bueroPage.goto(`/auftraege/${jobNumber}/uebergabe`);
      await expect(workHandoverSection(bueroPage)).toContainText(handoverReleaseHistory(2));
      await employeePage.goto(`/auftraege/${jobNumber}/uebergabe`);
      await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
      await outsiderPage.goto(`/auftraege/${jobNumber}/uebergabe`);
      await outsiderPage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    });
  });
});
