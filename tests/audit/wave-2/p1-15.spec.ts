import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import type { WorkArtifactKind } from '../../../lib/work-artifacts/types';
import {
  getJobSiteContactState,
  getWorkArtifactState,
  getWorkLifecycleState,
  seedJob,
  seedJobAssignment,
} from '../../golden/support/db/work';
import {
  addSiteOnCustomerDetail,
  createCustomer,
  openCustomerDetail,
} from '../../golden/support/steps/customers';
import {
  documentsRegion,
  documentsRegionUploadInput,
  documentUploadCompleted,
} from '../../golden/support/steps/documents';
import {
  selectFromSearchable,
  SHARED_COPY,
  testData,
  typeIntoDatePickerById,
  typeIntoDateTimeField,
  textInDom,
} from '../../golden/support/steps/shared';
import { clockInOnJob, clockOut } from '../../golden/support/steps/time-tracking';
import {
  addDeclaredWorkDependency,
  createAndPublishWorkTemplate,
  createJob,
  createProject,
  instructionEvidenceFulfilled,
  jobInstructionItem,
  lifecycleCardAction,
  lifecyclePendingFormalApprovals,
  linkWorkDependencyApproval,
  WORK_PAGE_LATER_SLICE_TERMS,
  workDependencyRow,
  workDependencyStateLabel,
} from '../../golden/support/steps/work';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  beginWorkArtifact,
  closeWorkArtifactDialog,
  makeWorkArtifactCustomerFacing,
  openWorkArtifact,
  openWorkArtifactLinkDisclosure,
  selectWorkArtifactAuthorization,
  selectWorkArtifactSeverity,
  selectWorkArtifactUnit,
  submitWorkArtifactWithEnter,
  WORK_ARTIFACTS_EMPTY,
  workArtifactAction,
  workArtifactCustomerDecisionPanel,
  workArtifactDialog,
  workArtifactEntry,
  workArtifactField,
  workArtifactFulfilEvidenceToggle,
  workArtifactFulfilWithVersion,
  workArtifactMessage,
  workArtifactOption,
  workArtifactPicker,
  workArtifactsLink,
  workArtifactsSection,
  workArtifactStatusLabel,
  workArtifactStatusText,
  workArtifactStatusVersion,
  workArtifactVersion,
  fillWorkArtifactVisit,
} from '../../golden/support/spec-helpers/work-artifact-dialog';
import { workArtifactTaskLink } from '../../golden/support/steps/attention';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';

function digits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

/** A new Arbeitsnachweis of this kind with the title and a summary derived from it. */
function newArtifact(kind: WorkArtifactKind, title: string): Parameters<typeof beginWorkArtifact>[1] {
  return { kind, title, summary: `Strukturierter Nachweis ${title}`, strict: true };
}

async function finishArtifact(dialog: Locator, submit = true): Promise<void> {
  if (submit) {
    await submitWorkArtifactWithEnter(dialog);
  } else {
    await workArtifactAction(dialog, 'saveDraft').click();
  }
  await expect(workArtifactVersion(dialog, 1)).toBeVisible({ timeout: 20_000 });
}

async function closeArtifact(dialog: Locator): Promise<void> {
  await closeWorkArtifactDialog(dialog);
  await expect(dialog).toHaveCount(0);
}

async function submitWorkReport(page: Page, title: string, visitDate: string): Promise<void> {
  const dialog = await beginWorkArtifact(page, newArtifact('work_report', title));
  await fillWorkArtifactVisit(dialog, { date: visitDate, from: '08:00', to: '09:00' });
  await workArtifactField(dialog, 'performedWork').fill(`Arbeiten zu ${title}`);
  await finishArtifact(dialog);
  await closeArtifact(dialog);
}

// The submit, approve and measurement journey lives in tests/golden/p1-15.spec.ts;
// the organization boundary is in supabase/tests/work_execution_boundaries.sql.
test.describe('P1-15 exhaustive structured site evidence flows @AUDIT-W2-P1-15 @AUDIT-W2', () => {
  test('targets, roles, five structured kinds, validation, and outsider denial', async ({
    adminPage,
    businessDate,
    employeePage,
    outsiderPage,
    world,
  }) => {
    // P1-15-F01…F16 and F18…F27: placement, exact target, site/task context,
    // visibility, empty/list/detail states, role bounds, and all five schemas.
    const customerName = `P115 Kunde ${world.runId}`;
    const siteName = `P115 Einsatzort ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P115`;
    const projectNumber = `PRJ-${world.runId}-P115`;
    const childJobNumber = `${projectNumber}-1`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const workDate = berlinDateAtOffset(80);

    await createCustomer(adminPage, customerName);
    await openCustomerDetail(adminPage, customerName);
    await addSiteOnCustomerDetail(adminPage, {
      name: siteName,
      street: 'Werkstraße 15',
      postalCode: '10115',
      city: 'Berlin',
      isPrimary: true,
    });
    await createJob(adminPage, {
      jobNumber,
      title: `P115 Einsatz ${world.runId}`,
      clientName: customerName,
      siteName,
      assignEmployeeName: employeeName,
      plannedDateDigits: digits(ownedBerlinDateAtOffset('p1-15', 80)),
    });
    await createProject(adminPage, {
      projectNumber,
      title: `P115 Projekt ${world.runId}`,
      clientName: customerName,
      siteName,
    });
    await createJob(adminPage, {
      jobNumber: childJobNumber,
      title: `P115 Projektauftrag ${world.runId}`,
      projectNumber,
      clientName: customerName,
      assignEmployeeName: employeeName,
    });

    await employeePage.goto(`/auftraege/${jobNumber}`);
    const section = workArtifactsSection(employeePage);
    await expect(workArtifactMessage(section, 'empty')).toBeVisible();
    await expect(workArtifactsLink(employeePage)).toHaveCount(0);

    let dialog = await beginWorkArtifact(
      employeePage,
      newArtifact('work_report', `Entwurf zum Verwerfen ${world.runId}`),
    );
    await workArtifactField(dialog, 'performedWork').fill('Noch nicht eingereichter Testentwurf.');
    await finishArtifact(dialog, false);
    await dialog.locator('#artifact-action-reason').fill('Eigener ungesendeter Testentwurf wird verworfen.');
    await workArtifactAction(dialog, 'void').click();
    await expect(workArtifactStatusVersion(dialog, 'voided', 1)).toBeVisible({
      timeout: 20_000,
    });
    await closeArtifact(dialog);

    dialog = await beginWorkArtifact(employeePage, newArtifact('site_diary', `Bautagebuch ${world.runId}`));
    await workArtifactField(dialog, 'progress').fill('Zwischenstand noch ohne Arbeitstag.');
    await finishArtifact(dialog, false);
    await expect(workArtifactStatusText(dialog, 'draft')).toBeVisible();
    await workArtifactAction(dialog, 'newVersion').click();
    await typeIntoDatePickerById(dialog, 'artifact-work-date', workDate);
    await workArtifactField(dialog, 'progress').fill('Rohinstallation im Erdgeschoss abgeschlossen.');
    await workArtifactField(dialog, 'attendees').fill('Monteur, Bauleitung');
    await workArtifactField(dialog, 'weather').fill('Trocken, 18 °C');
    await workArtifactField(dialog, 'siteConditions').fill('Zugang frei und abgesichert.');
    await workArtifactField(dialog, 'deliveries').fill('Rohrmaterial vollständig eingetroffen.');
    await workArtifactField(dialog, 'obstructions').fill('Keine.');
    await workArtifactField(dialog, 'decisions').fill('Steigstrang wird links geführt.');
    await workArtifactField(dialog, 'specialEvents').fill('Abnahme der Leitungsführung durch Bauleitung.');
    await workArtifactAction(dialog, 'submitForReview').click();
    await expect(workArtifactVersion(dialog, 2)).toBeVisible({
      timeout: 20_000,
    });
    await closeArtifact(dialog);

    dialog = await beginWorkArtifact(
      employeePage,
      newArtifact('work_report', `Arbeitsbericht ${world.runId}`),
    );
    await fillWorkArtifactVisit(dialog, { date: workDate, from: '08:00', to: '10:30' });
    await workArtifactField(dialog, 'performedWork').fill('Wärmepumpe geprüft und Filter gereinigt.');
    await workArtifactField(dialog, 'openWork').fill('Ersatzfilter beim nächsten Termin einsetzen.');
    await workArtifactField(dialog, 'materialNotes').fill('Ein Filtereinsatz vorgemerkt.');
    await typeIntoDateTimeField(dialog, 'artifact-next-visit', `${berlinDateAtOffset(81)}T09:00`);
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    dialog = await beginWorkArtifact(employeePage, newArtifact('measurement', `Aufmaß ${world.runId}`));
    await workArtifactAction(dialog, 'submitForReview').click();
    await expect(workArtifactMessage(dialog, 'requiredFields')).toBeVisible();
    await typeIntoDatePickerById(dialog, 'artifact-measurement-date', workDate);
    await workArtifactField(dialog, 'measurementLocation').fill('Heizraum');
    await workArtifactField(dialog, 'measurementNotes').fill('Lichte Maße vor Ort geprüft.');
    await workArtifactAction(dialog, 'addMeasurementLine').click();
    await workArtifactField(dialog, 'lineName').fill('Kupferrohr');
    await dialog.locator('#artifact-measurement-quantity-0').fill('12,5');
    await selectWorkArtifactUnit(employeePage, dialog, 'meter');
    await workArtifactField(dialog, 'location').fill('Technikraum Nord');
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    dialog = await beginWorkArtifact(employeePage, newArtifact('defect', `Mangel ${world.runId}`));
    await workArtifactField(dialog, 'defectDescription').fill(
      'Dämmung an der Vorlaufleitung ist beschädigt.',
    );
    await workArtifactField(dialog, 'location').fill('Heizraum');
    await selectWorkArtifactSeverity(employeePage, dialog, 'high');
    await typeIntoDatePickerById(dialog, 'artifact-due-date', businessDate);
    await workArtifactField(dialog, 'responsibility').fill('Bauleitung vor Ort');
    await workArtifactField(dialog, 'proposedSolution').fill('Dämmung fachgerecht erneuern.');
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    await employeePage.goto(`/auftraege/projekt/${projectNumber}`);
    dialog = await beginWorkArtifact(employeePage, newArtifact('change_work', `Regiearbeit ${world.runId}`));
    await workArtifactField(dialog, 'changeWork').fill('Zusätzliche Absperrarmatur montieren.');
    await workArtifactField(dialog, 'reason').fill('Leitungsführung wurde vor Ort geändert.');
    await workArtifactField(dialog, 'requestedBy').fill('Bauleitung, mündlich vor Ort');
    await workArtifactField(dialog, 'expectedMinutes').fill('90');
    await workArtifactField(dialog, 'actualMinutes').fill('105');
    await workArtifactField(dialog, 'expectedMaterial').fill('Eine Absperrarmatur');
    await workArtifactField(dialog, 'actualMaterial').fill('Eine Absperrarmatur und zwei Fittings');
    await selectWorkArtifactAuthorization(employeePage, dialog, 'authorized');
    await workArtifactField(dialog, 'scheduleImpact').fill('Keine Auswirkung auf den Endtermin.');
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    const jobState = await getWorkArtifactState(world.orgId, { jobNumber });
    const activeArtifacts = jobState.artifacts.filter((row) => row.status !== 'voided');
    expect(activeArtifacts.map((row) => row.kind).sort()).toEqual([
      'defect',
      'measurement',
      'site_diary',
      'work_report',
    ]);
    const activeSiteDiary = activeArtifacts.find((row) => row.kind === 'site_diary');
    expect(jobState.revisions.filter((row) => row.artifact_id === activeSiteDiary?.id)).toHaveLength(2);
    expect(jobState.artifacts.find((row) => row.status === 'voided')).toMatchObject({
      created_by: world.users.employee.id,
    });
    expect(jobState.measurements[0]).toMatchObject({
      description: 'Kupferrohr',
      unit: 'meter',
    });
    expect(Number(jobState.measurements[0]?.quantity)).toBe(12.5);
    expect(jobState.defects[0]).toMatchObject({
      severity: 'high',
      state: 'open',
      location: 'Heizraum',
    });
    expect(jobState.revisions.every((row) => row.artifact_id && row.created_by && row.created_at)).toBe(true);
    const siteDiaryRevision = jobState.revisions.find((row) => row.artifact_id === activeSiteDiary?.id);
    expect(siteDiaryRevision?.site_id).toBe((await getJobSiteContactState(world.orgId, jobNumber)).siteId);
    const projectState = await getWorkArtifactState(world.orgId, {
      projectNumber,
    });
    expect(projectState.changes[0]).toMatchObject({
      authorization_state: 'authorized',
      expected_labor_minutes: 90,
      actual_labor_minutes: 105,
    });

    await outsiderPage.goto(`/auftraege/${jobNumber}`);
    await expect(outsiderPage.getByTestId('work-artifacts-section')).toHaveCount(0);
  });

  test('immutable revisions, stale-write recovery, idempotent actions, and realtime catch-up', async ({
    adminPage,
    employeePage,
    bueroPage,
    world,
  }) => {
    // P1-15-F28…F40: explicit save/submit, atomic validation, immutable history,
    // correction reasons, no evidence inheritance, stale conflicts, idempotency,
    // and a resting list versus an open edited dialog.
    const jobNumber = `AUF-${world.runId}-P115-STALE`;
    const title = `Konfliktbericht ${world.runId}`;
    const jobId = await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title: `P115 Konflikt ${world.runId}`,
    });
    await seedJobAssignment({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobId,
      userId: world.users.employee.id,
    });
    await employeePage.goto(`/auftraege/${jobNumber}`);
    await submitWorkReport(employeePage, title, berlinDateAtOffset(82));
    await Promise.all([adminPage.goto(`/auftraege/${jobNumber}`), bueroPage.goto(`/auftraege/${jobNumber}`)]);
    await expect(workArtifactEntry(adminPage, title)).toBeVisible({ timeout: 20_000 });
    await expect(workArtifactEntry(bueroPage, title)).toBeVisible({ timeout: 20_000 });
    await workArtifactEntry(adminPage, title).click();
    await workArtifactEntry(bueroPage, title).click();
    const adminDialog = workArtifactDialog(adminPage);
    const bueroDialog = workArtifactDialog(bueroPage);
    await workArtifactAction(adminDialog, 'newVersion').click();
    await workArtifactAction(bueroDialog, 'newVersion').click();
    await workArtifactField(adminDialog, 'title').fill(`${title} v2`);
    await workArtifactField(adminDialog, 'revisionReason').fill('Leistungsumfang wurde vor Ort präzisiert.');
    await workArtifactField(bueroDialog, 'title').fill(`${title} lokaler Entwurf`);
    await workArtifactField(bueroDialog, 'revisionReason').fill('Lokale, noch nicht gespeicherte Korrektur.');
    await workArtifactAction(adminDialog, 'saveDraft').click();
    await expect(workArtifactVersion(adminDialog, 2)).toBeVisible({
      timeout: 20_000,
    });
    await workArtifactAction(bueroDialog, 'saveDraft').click();
    await expect(workArtifactMessage(bueroDialog, 'changedMeanwhile')).toBeVisible();
    await expect(workArtifactField(bueroDialog, 'title')).toHaveValue(`${title} lokaler Entwurf`);
    await closeWorkArtifactDialog(bueroDialog);
    await expect(workArtifactEntry(bueroPage, `${title} v2`)).toBeVisible({
      timeout: 20_000,
    });

    const state = await getWorkArtifactState(world.orgId, { jobNumber });
    const report = expectDefined(state.artifacts[0], 'the work report');
    expect(state.revisions.map((row) => row.title)).toEqual([title, `${title} v2`]);
    const firstRevision = expectDefined(state.revisions[0], 'the first report revision');
    const secondRevision = expectDefined(state.revisions[1], 'the second report revision');
    expect(secondRevision).toMatchObject({
      corrects_revision_id: firstRevision.id,
      correction_reason: 'Leistungsumfang wurde vor Ort präzisiert.',
    });
    expect(report).toMatchObject({
      version: 2,
      status: 'draft',
      current_revision_id: secondRevision.id,
    });
  });

  test('four-eyes responsibility, review outcomes, attention identity, and void history', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-15-F41…F49 plus F36: shared responsibility, no self-approval,
    // approve/reject/correct/withdraw, stable attention links, and reasoned void.
    const jobNumber = `AUF-${world.runId}-P115-REVIEW`;
    const approvedTitle = `Freigabebericht ${world.runId}`;
    const correctionTitle = `Korrekturbericht ${world.runId}`;
    const rejectedTitle = `Ablehnungsbericht ${world.runId}`;
    const withdrawnTitle = `Rückzugsbericht ${world.runId}`;
    const visitDate = berlinDateAtOffset(83);
    const jobId = await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title: `P115 Prüfung ${world.runId}`,
    });
    await seedJobAssignment({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobId,
      userId: world.users.employee.id,
    });
    await employeePage.goto(`/auftraege/${jobNumber}`);
    for (const title of [approvedTitle, correctionTitle, rejectedTitle, withdrawnTitle]) {
      await submitWorkReport(employeePage, title, visitDate);
    }
    await workArtifactEntry(employeePage, approvedTitle).click();
    await expect(workArtifactAction(employeePage, 'approveInternally')).toHaveCount(0);
    await closeWorkArtifactDialog(workArtifactDialog(employeePage));

    await adminPage.goto('/aufgaben');
    await expect(workArtifactTaskLink(adminPage, 'review', approvedTitle)).toBeVisible({ timeout: 20_000 });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await workArtifactEntry(adminPage, approvedTitle).click();
    const dialog = workArtifactDialog(adminPage);
    await workArtifactAction(dialog, 'approveInternally').click();
    await expect(workArtifactStatusText(dialog, 'approved')).toBeVisible({
      timeout: 20_000,
    });
    await closeWorkArtifactDialog(dialog);

    const approvedState = await getWorkArtifactState(world.orgId, { jobNumber });
    const approvedRevision = approvedState.revisions.find((row) => row.title === approvedTitle);
    const approvedReport = approvedState.artifacts.find((row) => row.id === approvedRevision?.artifact_id);
    expect(approvedReport?.status).toBe('approved');
    const approval = approvedState.actions.find(
      (row) => row.artifact_id === approvedReport?.id && row.action_type === 'internal_approved',
    );
    expect(approval?.responsibility_snapshot).toMatchObject({
      responsibility: 'work_artifact_approval',
    });
    expect(approval?.created_by).toBe(world.users.admin.id);

    await workArtifactEntry(adminPage, correctionTitle).click();
    await dialog.locator('#artifact-action-reason').fill('Leistungsort muss genauer bezeichnet werden.');
    await workArtifactAction(dialog, 'requestCorrection').click();
    await expect(workArtifactStatusText(dialog, 'correction_requested')).toBeVisible({
      timeout: 20_000,
    });
    await closeWorkArtifactDialog(dialog);
    await employeePage.goto('/aufgaben');
    await expect(workArtifactTaskLink(employeePage, 'correction', correctionTitle)).toBeVisible({
      timeout: 20_000,
    });

    await workArtifactEntry(adminPage, rejectedTitle).click();
    await dialog.locator('#artifact-action-reason').fill('Zuständigkeit ist noch nicht eindeutig.');
    await workArtifactAction(dialog, 'reject').click();
    await expect(workArtifactStatusText(dialog, 'rejected')).toBeVisible({
      timeout: 20_000,
    });
    await closeWorkArtifactDialog(dialog);

    await employeePage.goto(`/auftraege/${jobNumber}`);
    await workArtifactEntry(employeePage, withdrawnTitle).click();
    const employeeDialog = workArtifactDialog(employeePage);
    await workArtifactAction(employeeDialog, 'withdrawReview').click();
    await expect(workArtifactStatusText(employeeDialog, 'draft')).toBeVisible({
      timeout: 20_000,
    });
    await closeWorkArtifactDialog(employeeDialog);

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await workArtifactEntry(adminPage, rejectedTitle).click();
    await dialog.locator('#artifact-action-reason').fill('Durch einen gültigen Folgevorgang ersetzt.');
    await workArtifactAction(dialog, 'void').click();
    await expect(workArtifactStatusVersion(dialog, 'voided', 1)).toBeVisible({
      timeout: 20_000,
    });
    await closeWorkArtifactDialog(dialog);
    await expect(workArtifactEntry(adminPage, rejectedTitle)).toContainText(
      workArtifactStatusLabel('voided'),
    );
  });

  test('customer outcomes, signature, document/source/evidence links, and deterministic export', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-15-F17, F50…F70: independent customer/internal outcomes, named
    // offline signer context, on-device signature, explicit document/source
    // and checklist evidence links, reasoned removal, and idempotent HTML export.
    const templateName = `P115 Nachweisvorlage ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P115-EVIDENCE`;
    const jobTitle = `P115 Nachweisauftrag ${world.runId}`;
    const artifactTitle = `Kundenbericht ${world.runId}`;
    const commissioning = testData`Inbetriebnahme dokumentieren`;
    await createAndPublishWorkTemplate(adminPage, {
      name: templateName,
      targetType: 'job',
      firstItem: commissioning,
      evidenceDescription: 'Abschlussbericht der Inbetriebnahme',
    });
    await createJob(adminPage, {
      jobNumber,
      title: jobTitle,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
      workTemplateName: templateName,
    });
    // Run-scoped name: the shared fixture name collides with A2's uploads in
    // the full-battery world and gets dedup-renamed, which would break the
    // exact-name document selection below.
    const evidenceFileName = `p115-nachweis-${world.runId}.pdf`;
    await employeePage.goto(`/auftraege/${jobNumber}`);
    const documents = documentsRegion(employeePage.getByRole('main'));
    await expect(documents).toBeVisible({ timeout: 30_000 });
    await documentsRegionUploadInput(documents).setInputFiles({
      name: evidenceFileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nP1-15 Nachweisdokument'),
    });
    await expect(documentUploadCompleted(employeePage, 1, 1)).toBeVisible({
      timeout: 60_000,
    });
    await expect(textInDom(employeePage, SHARED_COPY.upload.failed)).toHaveCount(0);
    const evidenceUploadClose = employeePage.getByRole('button', {
      name: SHARED_COPY.action.close,
    });
    if (await evidenceUploadClose.isVisible().catch(() => false)) {
      await evidenceUploadClose.click();
    }
    await expect(employeePage.getByRole('dialog')).toHaveCount(0, {
      timeout: 10_000,
    });
    await clockInOnJob(employeePage, jobTitle);
    await clockOut(employeePage);
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await expect(workArtifactsSection(adminPage)).toContainText(WORK_ARTIFACTS_EMPTY);
    await employeePage.goto(`/auftraege/${jobNumber}`);
    let dialog = await beginWorkArtifact(employeePage, newArtifact('work_report', artifactTitle));
    await makeWorkArtifactCustomerFacing(employeePage, dialog);
    await selectFromSearchable(employeePage, workArtifactPicker(dialog, 'instruction'), commissioning);
    await fillWorkArtifactVisit(dialog, { date: berlinDateAtOffset(84), from: '07:30', to: '09:15' });
    await workArtifactField(dialog, 'performedWork').fill(
      'Anlage in Betrieb genommen und Werte protokolliert.',
    );
    await workArtifactField(dialog, 'customerStatement').fill('Einweisung wurde vor Ort durchgeführt.');
    await workArtifactOption(dialog, 'customerDecisionRequired').click();
    await workArtifactOption(dialog, 'signatureRequired').click();
    await finishArtifact(dialog);
    await closeArtifact(dialog);

    await adminPage.reload();
    await adminPage.waitForLoadState('networkidle');
    await expect(workArtifactEntry(adminPage, artifactTitle)).toBeVisible({
      timeout: 20_000,
    });
    dialog = await openWorkArtifact(adminPage, artifactTitle, { attempts: 2, timeout: 5_000 });
    await workArtifactAction(dialog, 'approveInternally').click();
    await expect(workArtifactStatusText(dialog, 'approved')).toBeVisible({
      timeout: 20_000,
    });
    await closeArtifact(dialog);
    await employeePage.reload();
    dialog = await openWorkArtifact(employeePage, artifactTitle, { attempts: 2, timeout: 5_000 });
    await workArtifactCustomerDecisionPanel(dialog).click();
    await expect(workArtifactMessage(dialog, 'legalNotice')).toBeVisible();
    await dialog.locator('#artifact-customer-name').fill('Erika Beispiel');
    await dialog.locator('#artifact-customer-role').fill('Objektleitung');
    await dialog.locator('#artifact-customer-relationship').fill('Bevollmächtigte Ansprechperson vor Ort');
    const acknowledge = workArtifactAction(dialog, 'recordAcknowledgement');
    await acknowledge.click();
    await expect
      .poll(
        async () =>
          (await getWorkArtifactState(world.orgId, { jobNumber })).actions.filter(
            (action) => action.action_type === 'customer_acknowledged',
          ).length,
      )
      .toBe(1);
    await expect(acknowledge).toBeEnabled();
    await dialog.locator('#artifact-action-reason').fill('Kundin bittet um Ergänzung der Seriennummer.');
    await workArtifactAction(dialog, 'recordReservation').click();
    await expect
      .poll(
        async () =>
          (await getWorkArtifactState(world.orgId, { jobNumber })).actions.filter(
            (action) => action.action_type === 'customer_reserved',
          ).length,
      )
      .toBe(1);
    await expect(acknowledge).toBeEnabled();
    await dialog
      .locator('#artifact-action-reason')
      .fill('Kunde möchte erst nach eigener Prüfung bestätigen.');
    await workArtifactAction(dialog, 'recordRefusal').click();
    await expect
      .poll(
        async () =>
          (await getWorkArtifactState(world.orgId, { jobNumber })).actions.filter(
            (action) => action.action_type === 'customer_refused',
          ).length,
      )
      .toBe(1);
    await expect(acknowledge).toBeEnabled();

    const canvas = workArtifactField(dialog, 'signaturePad');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Signature canvas has no bounding box');
    await employeePage.mouse.move(box.x + 20, box.y + 45);
    await employeePage.mouse.down();
    await employeePage.mouse.move(box.x + 120, box.y + 80, { steps: 8 });
    await employeePage.mouse.up();
    await expect(workArtifactAction(dialog, 'resetSignature')).toBeEnabled();
    await workArtifactAction(dialog, 'saveSignature').click();
    await expect
      .poll(
        async () =>
          (await getWorkArtifactState(world.orgId, { jobNumber })).actions.filter(
            (action) => action.action_type === 'signature_captured',
          ).length,
        { timeout: 60_000 },
      )
      .toBe(1);
    const exportButton = workArtifactAction(dialog, 'export');
    await expect(exportButton).toBeEnabled();

    const documentDisclosure = await openWorkArtifactLinkDisclosure(dialog, 'document');
    await selectFromSearchable(employeePage, workArtifactPicker(dialog, 'document'), evidenceFileName);
    await workArtifactAction(documentDisclosure, 'link').click();
    await expect
      .poll(
        async () =>
          (await getWorkArtifactState(world.orgId, { jobNumber })).documents.filter(
            (document) => document.relation === 'supporting_evidence',
          ).length,
      )
      .toBe(1);
    await expect(exportButton).toBeEnabled();
    const timeEntryDisclosure = await openWorkArtifactLinkDisclosure(dialog, 'timeEntry');
    // The time-entry picker is a searchable select (registry rule for entity
    // lists): its rows are buttons inside the open listbox.
    await workArtifactPicker(dialog, 'timeEntry').click();
    const timeEntryOptions = employeePage.getByRole('listbox').getByRole('option');
    await expect(timeEntryOptions).toHaveCount(1);
    await timeEntryOptions.click();
    await workArtifactAction(timeEntryDisclosure, 'link').click();
    await expect
      .poll(async () => {
        const sources = (await getWorkArtifactState(world.orgId, { jobNumber })).sources;
        return sources.map((source) => ({
          timeEntryId: source.time_entry_id,
          timeSegmentId: source.time_segment_id,
        }));
      })
      .toEqual([
        {
          timeEntryId: null,
          timeSegmentId: expect.any(String),
        },
      ]);
    await expect(exportButton).toBeEnabled();
    await workArtifactFulfilEvidenceToggle(dialog).click();
    await workArtifactFulfilWithVersion(dialog, 1).click();
    await expect
      .poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).fulfillments.length)
      .toBe(1);
    await expect(exportButton).toBeEnabled();
    await exportButton.click();
    await expect
      .poll(
        async () =>
          (await getWorkArtifactState(world.orgId, { jobNumber })).actions.filter(
            (action) => action.action_type === 'exported',
          ).length,
        { timeout: 60_000 },
      )
      .toBe(1);
    await expect(exportButton).toBeEnabled();
    await Promise.all([
      employeePage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().includes(encodeURIComponent(jobNumber)),
      ),
      exportButton.click(),
    ]);
    await expect(exportButton).toBeEnabled();
    await expect
      .poll(
        async () =>
          (await getWorkArtifactState(world.orgId, { jobNumber })).actions.filter(
            (action) => action.action_type === 'exported',
          ).length,
      )
      .toBe(1);
    await closeArtifact(dialog);

    await employeePage.reload();
    await expect(instructionEvidenceFulfilled(jobInstructionItem(employeePage, commissioning))).toBeVisible({
      timeout: 20_000,
    });
    const state = await getWorkArtifactState(world.orgId, { jobNumber });
    const exportedArtifact = expectDefined(state.artifacts[0], 'the exported artifact');
    const currentRevisionId = exportedArtifact.current_revision_id;
    expect(state.actions.filter((row) => row.action_type === 'exported')).toHaveLength(1);
    expect(
      state.actions.filter((row) =>
        ['customer_acknowledged', 'customer_reserved', 'customer_refused', 'signature_captured'].includes(
          row.action_type,
        ),
      ),
    ).toHaveLength(4);
    expect(
      state.actions
        .filter((row) => row.signer_name)
        .every((row) => row.signer_name === 'Erika Beispiel' && row.revision_id === currentRevisionId),
    ).toBe(true);
    expect(state.documents.filter((row) => row.relation === 'rendered_export')).toHaveLength(1);
    expect(state.documents.find((row) => row.relation === 'rendered_export')).toMatchObject({
      renderer_version: 'p1-21-html-v5',
    });
    expect(state.documents.find((row) => row.relation === 'rendered_export')?.content_hash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(state.sources).toHaveLength(1);
    expect(state.fulfillments[0]).toMatchObject({
      artifact_revision_id: currentRevisionId,
      removed_at: null,
    });

    // P1-15-F71…F78: measurements, defects, formal decisions, customer gates,
    // approval dependency, shared cache/realtime projections, explicit non-effects,
    // and absence of later-slice modules from this surface.
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await lifecycleCardAction(adminPage, 'gatesAndHistory').click();
    await expect(lifecyclePendingFormalApprovals(adminPage)).toBeVisible();
    const snapshot = (await getWorkLifecycleState(world.orgId, { jobNumber })).snapshot;
    expect(snapshot.gates.pendingFormalApprovals).toBe(0);
    expect(snapshot.gates.requiredCustomerDecisions).toBe(0);
    expect(snapshot.gates.requiredSignatures).toBe(0);
    expect(snapshot.gates.incompleteInstructionEvidence).toBe(0);

    const dependencyDescription = testData`Interne Freigabe des Inbetriebnahmeberichts`;
    dialog = await addDeclaredWorkDependency(adminPage, {
      kind: 'approval',
      description: dependencyDescription,
    });
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    const dependencyRow = workDependencyRow(adminPage, dependencyDescription);
    await expect(dependencyRow).toContainText(workDependencyStateLabel('open'));
    dialog = await linkWorkDependencyApproval(adminPage, dependencyRow, {
      artifactTitle: artifactTitle,
      reason: 'Aktuelle interne Freigabe erfüllt die dokumentierte Voraussetzung.',
    });
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(dependencyRow).toContainText(workDependencyStateLabel('satisfied'));

    const lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(lifecycle.dependencies.at(-1)).toMatchObject({
      declared_kind: 'approval',
      isSatisfied: true,
    });
    expect(lifecycle.dependencies.at(-1)?.artifact_approval_action_id).toBeTruthy();
    await expect(workArtifactsSection(adminPage)).toBeVisible();
    for (const term of WORK_PAGE_LATER_SLICE_TERMS) {
      await expect(textInDom(adminPage, term)).toHaveCount(0);
    }
  });
});
