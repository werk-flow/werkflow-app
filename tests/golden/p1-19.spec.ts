import { expectDefined } from '../../lib/testing/spec-support/expect-defined';
import { SERVICE_CASE_CHARGE_CONTEXT_LABELS } from '../../lib/service-cases/types';
import {
  beginWorkArtifact,
  fillWorkArtifactVisit,
  submitWorkArtifactAndClose,
  workArtifactField,
} from './support/spec-helpers/work-artifact-dialog';
import { expect, test } from './support/fixtures';
import { seedCustomer } from './support/db/customers';
import { seedRequest } from './support/db/requests';
import { getServiceCaseStateByNumber, seedInstalledEquipment, seedServiceCase } from './support/db/service';
import { seedJob, seedJobAssignment } from './support/db/work';
import { dispatchOverviewBerlinDateAtOffset } from './support/date-ownership';
import { expectLiveWithin } from './support/live';
import { createPlannedCalendarEntry } from './support/steps/calendar';
import {
  acknowledgeDispatchOnJobPage,
  issueDispatchForOccurrence,
  openDispatchPanel,
} from './support/steps/dispatch';
import {
  convertRequestToServiceCase,
  createDirectServiceCase,
  createServiceCaseFollowUp,
  linkServiceCaseEvidence,
  relateServiceCase,
  serviceCaseEvidenceLinkedBanner,
  serviceCaseEvidenceSection,
  serviceCaseRelationText,
  serviceCaseSourceRequestLink,
  updateServiceCaseViaDialog,
} from './support/steps/service';
import { testData, visibleText } from './support/steps/shared';
import { openFieldWorkPack } from './support/steps/work';

test.describe('P1-19 reactive service vertical slice @P1-19 @GG-05', () => {
  test('takes a reported fault from intake to a dispatched visit with evidence @P1-19-journey', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const names = {
      customer: testData`P119 Golden Kunde ${world.runId}`,
      site: testData`P119 Golden Heizzentrale ${world.runId}`,
      equipment: testData`P119 Golden Wärmeerzeuger ${world.runId}`,
      directSummary: testData`P119 direkter Wiederholungsfall ${world.runId}`,
      requestSummary: testData`P119 Heizung ausgefallen ${world.runId}`,
      requestNumber: testData`P119-ANF-${world.runId}`,
      jobNumber: testData`AUF-${world.runId}-P119-SERVICE`,
      jobTitle: testData`P119 Serviceeinsatz ${world.runId}`,
      evidenceTitle: testData`P119 Servicebericht ${world.runId}`,
      employee: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    };
    const accessInstructions = testData`Zugang über den Hof; Heizraum links.`;
    const triageNotePrefix = testData`Kein Rechtsentscheid`;
    const visitDate = dispatchOverviewBerlinDateAtOffset(7);

    const requestId =
      await test.step('Seed the customer site, equipment, assigned job and request', async () => {
        const customer = await seedCustomer({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          name: names.customer,
          sites: [
            {
              name: names.site,
              street: 'Serviceweg 19',
              postalCode: '10115',
              city: 'Berlin',
              isPrimary: true,
            },
          ],
        });
        const siteId = expectDefined(customer.siteIds.get(names.site), 'the seeded P1-19 site');
        await seedInstalledEquipment({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          clientId: customer.clientId,
          siteId,
          name: names.equipment,
          manufacturer: 'WerkFlow Testtechnik',
          model: 'SRV 19',
        });
        const jobId = await seedJob({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          jobNumber: names.jobNumber,
          title: names.jobTitle,
          clientId: customer.clientId,
          siteId,
        });
        await seedJobAssignment({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          jobId,
          userId: world.users.employee.id,
        });
        return seedRequest({
          orgId: world.orgId,
          actorId: world.users.admin.id,
          summary: names.requestSummary,
          requestNumber: names.requestNumber,
          clientId: customer.clientId,
          siteId,
        });
      });

    const directCaseNumber =
      await test.step('Record a repeat fault directly with its equipment', async () => {
        const directCase = await createDirectServiceCase(adminPage, {
          orgId: world.orgId,
          customerName: names.customer,
          siteName: names.site,
          statement: 'Die Anlage macht wieder dieselben Geräusche.',
          summary: names.directSummary,
          urgency: 'normal',
          chargeContext: 'suspected_rework',
          equipmentName: names.equipment,
        });
        expect(directCase.summary).toBe(names.directSummary);
        const state = await getServiceCaseStateByNumber(world.orgId, directCase.caseNumber);
        expect(state.serviceCase).toMatchObject({
          intake_type: 'direct',
          source_request_id: null,
          original_statement: 'Die Anlage macht wieder dieselben Geräusche.',
          charge_context: 'suspected_rework',
        });
        expect(state.equipmentLinks).toHaveLength(1);
        return directCase.caseNumber;
      });

    const caseNumber = await test.step('Take over the customer request as a service case', async () => {
      await adminPage.goto(`/anfragen/${requestId}`);
      const requestCase = await convertRequestToServiceCase(adminPage, world.orgId);
      await expect(serviceCaseSourceRequestLink(adminPage)).toBeVisible();
      expect(requestCase.sourceRequestId).toBe(requestId);
      const requestCaseNumber = requestCase.caseNumber;
      const state = await getServiceCaseStateByNumber(world.orgId, requestCaseNumber);
      expect(state.serviceCase).toMatchObject({
        intake_type: 'request',
        source_request_id: requestId,
        original_statement: names.requestSummary,
      });
      expect(state.equipmentLinks).toHaveLength(0);
      expect(state.events.map((event) => event.event_type)).toEqual(['created']);
      return requestCaseNumber;
    });

    await test.step('Triage the case, link the job and relate the repeat case', async () => {
      await adminPage.goto(`/service/faelle/${caseNumber}`);
      await updateServiceCaseViaDialog(adminPage, {
        status: 'visit_required',
        urgency: 'notfall',
        chargeContext: 'suspected_warranty',
        jobNumber: names.jobNumber,
        accessInstructions,
        triageNote: `${triageNotePrefix}; Serienfehler nur als Verdacht.`,
        equipmentName: names.equipment,
        reason: 'Einsatz nach telefonischer Rückfrage vorbereitet',
      });
      await expect(visibleText(adminPage, names.jobNumber)).toBeVisible({ timeout: 20_000 });

      await relateServiceCase(adminPage, {
        relatedCaseNumber: directCaseNumber,
        relation: 'continuation_of',
        reason: 'Wiederkehrendes Fehlerbild derselben Kundenanlage',
      });
      await expect(serviceCaseRelationText(adminPage, 'continuation_of', directCaseNumber)).toBeVisible({
        timeout: 20_000,
      });

      const state = await getServiceCaseStateByNumber(world.orgId, caseNumber);
      expect(state.serviceCase).toMatchObject({
        status: 'visit_required',
        urgency: 'notfall',
        charge_context: 'suspected_warranty',
      });
      expect(state.serviceCase.job_id).not.toBeNull();
      expect(state.equipmentLinks).toHaveLength(1);
      expect(state.relations).toHaveLength(1);
    });

    await test.step('Plan, dispatch and acknowledge the visit', async () => {
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: names.jobNumber,
        date: visitDate,
        time: '06:00',
        employeeNames: [names.employee],
        overrideReason: 'Bestätigter dringender Serviceeinsatz',
      });
      await openDispatchPanel(adminPage, visitDate);
      await issueDispatchForOccurrence(adminPage, names.jobTitle);
      await acknowledgeDispatchOnJobPage(employeePage, names.jobNumber);
    });

    await test.step('Show the field worker the case without internal triage', async () => {
      const pack = await openFieldWorkPack(employeePage, names.jobNumber);
      await expect(pack).toContainText(caseNumber);
      await expect(pack).toContainText(names.equipment);
      await expect(pack).toContainText(accessInstructions);
      await expect(pack).not.toContainText(SERVICE_CASE_CHARGE_CONTEXT_LABELS.suspected_warranty);
      await expect(pack).not.toContainText(triageNotePrefix);
    });

    await test.step('Link the visit evidence and an existing follow-up owner', async () => {
      await employeePage.goto(`/auftraege/${names.jobNumber}`);
      const workReport = await beginWorkArtifact(employeePage, {
        kind: 'work_report',
        title: names.evidenceTitle,
        summary: 'Störung geprüft und Betrieb wiederhergestellt.',
      });
      await fillWorkArtifactVisit(workReport, { date: visitDate, from: '06:00', to: '07:30' });
      await workArtifactField(workReport, 'performedWork').fill('Regelung geprüft und Anlage neu gestartet.');
      await submitWorkArtifactAndClose(workReport);

      await adminPage.goto(`/service/faelle/${caseNumber}`);
      await linkServiceCaseEvidence(adminPage, names.evidenceTitle);
      // The version is listed with the click; the banner confirms the link.
      await expect(serviceCaseEvidenceLinkedBanner(adminPage)).toBeVisible({ timeout: 20_000 });
      await expect(serviceCaseEvidenceSection(adminPage)).toContainText(names.evidenceTitle, {
        timeout: 20_000,
      });

      await createServiceCaseFollowUp(adminPage, 'Gewährleistungsunterlagen im Büro prüfen.');

      const state = await getServiceCaseStateByNumber(world.orgId, caseNumber);
      expect(state.evidenceLinks).toHaveLength(1);
      expect(state.followUps).toHaveLength(1);
      expect(state.followUps[0]).toMatchObject({
        source_type: 'service_case',
        source_id: state.serviceCase.id,
        status: 'open',
      });
    });
  });

  test('refreshes managers across sessions @P1-19-stage-realtime @FRESHNESS', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const siteName = `P119 Live Heizzentrale ${world.runId}`;
    const liveSummary = `P119 live aktualisiert ${world.runId}`;
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: `P119 Live Kunde ${world.runId}`,
      sites: [{ name: siteName, isPrimary: true }],
    });
    const { caseNumber } = await seedServiceCase({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId: expectDefined(customer.siteIds.get(siteName), 'the seeded live site'),
      summary: `P119 Live Störung ${world.runId}`,
      statement: 'Die Heizung bleibt seit dem Morgen kalt.',
    });
    await adminPage.goto(`/service/faelle/${caseNumber}`);
    await bueroPage.goto(`/service/faelle/${caseNumber}`);
    await expectLiveWithin(bueroPage.getByRole('heading', { name: liveSummary }), {
      label: 'P1-19 service case cross-session refresh',
      actingPage: adminPage,
      mutation: (beforeSubmit) =>
        updateServiceCaseViaDialog(adminPage, {
          summary: liveSummary,
          reason: 'Kurzbeschreibung nach Rückmeldung berichtigt',
          beforeSubmit,
        }),
    });
  });
});
