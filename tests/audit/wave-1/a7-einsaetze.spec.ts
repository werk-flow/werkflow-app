import { expect, test } from '../support/fixtures';
import { getPlanningState } from '../../golden/support/db/calendar';
import { seedCustomer } from '../../golden/support/db/customers';
import { getCommitmentState, getDispatchState, getParkingState } from '../../golden/support/db/dispatch';
import { createAdminClient } from '../../golden/support/db/shared';
import { seedJob } from '../../golden/support/db/work';
import {
  challengeTaskLink,
  openAufgaben,
  parkingReviewTaskLink,
  taskResponsibleText,
} from '../../golden/support/steps/attention';
import {
  addOccurrenceAssignee,
  createPlannedCalendarEntry,
  editPlannedCalendarOccurrence,
  openOccurrenceEditDialogByDate,
  planningWarningReason,
  planningWarningSave,
  saveOccurrenceEditWithOverride,
} from '../../golden/support/steps/calendar';
import {
  acknowledgeDispatchButton,
  acknowledgeDispatchOnJobPage,
  arrivalWindowText,
  batchModeToggle,
  batchPreviewDialog,
  batchPreviewInstant,
  batchPreviewNotice,
  batchSelectionCount,
  batchShiftMissingError,
  challengeDispatchButton,
  checkBatchImpactButton,
  commitmentDialog,
  commitmentSubmit,
  commitmentSummaryText,
  DISPATCH_COMMITMENT_COPY,
  DISPATCH_READINESS_COPY,
  dispatchIssueDialog,
  dispatchNoteText,
  dispatchOccurrenceRow,
  dispatchPanel,
  dispatchPanelOccurrences,
  dispatchReasonDialog,
  dispatchRecipientOption,
  dispatchSendButton,
  issueDispatchForOccurrence,
  jobDispatchSection,
  moveNowButton,
  openDispatchPanel,
  openIssueDialogForPanelRow,
  openParkplatzPanel,
  parkingContextDialog,
  parkingContextSave,
  parkplatzCard,
  parkplatzDispatchButton,
  reasonDialogConfirm,
  readinessDimension,
  recordCommitmentButton,
  rowReasonAction,
  searchDispatchRecipients,
  submitDispatchChallenge,
} from '../../golden/support/steps/dispatch';
import { planMaterialOnJobPage } from '../../golden/support/steps/inventory';
import { createPersonnelRecordViaDialog } from '../../golden/support/steps/personnel';
import {
  calendarConfirmation,
  calendarViewTab,
  dayViewCards,
  parkplatzButton,
} from '../../golden/support/plantafel';
import {
  expectGone,
  planningWarningDialog,
  selectFromSearchable,
  SHARED_COPY,
  testData,
  typeIntoDatePickerById,
  typeIntoTimeInput,
} from '../../golden/support/steps/shared';
import { createJob, parkWork } from '../../golden/support/steps/work';
import { berlinDateAtOffset, dispatchOverviewBerlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  editJobLocation,
  firstDispatchPanelText,
  openJobViaDispatchTask,
  sendDispatchWithNote,
  unscheduledDispatchRow,
} from '../support/a7-steps';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { formatBerlinLocalDateTime } from '../../../lib/planning/date-time';
import { COMMITMENT_SOURCE_LABELS } from '../../../lib/commitments/types';
import { DISPATCH_RECIPIENT_STATE_LABELS, dispatchErrorMessage } from '../../../lib/dispatch/types';
import { REASON_MIN_8_MESSAGE } from '../../../lib/ui/field-validation';
import { WORK_BLOCKER_REASON_LABELS } from '../../../lib/work-lifecycle/types';

// A7 — Einsätze (P1-12): edge cases, denials and role variants around the
// golden dispatch journeys. Every test prepares its own customer, jobs and
// visits in the shared audit world and runs alone; every claimed operation
// runs through the real UI and the database access below is read-only
// assertion state. Each test plans its visits on its own day inside the
// dispatch panel's 14-day overview, so travel and capacity facts never mix.
// Acknowledgement-without-time, commitment separation, batch history and
// dispatch privacy are database rules in supabase/tests/planning_dispatch.sql.
// A7 creates no uniqueness-constrained rows; the owned +55…+64 reserve stays unused.

function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

// The panel's schedule formatter renders "Mo., 24.08., 06:00 Uhr" — the
// day-month fragment is the stable per-row identity for preview assertions.
function shortGermanDayMonth(dateIso: string): string {
  const [, month, day] = dateIso.split('-');
  return `${day}.${month}.`;
}

const OVERRIDE_REASON = 'Betrieblich abgestimmter A7 Einsatz.';
const MAIN_NOTE = 'Schlüssel beim Hausmeister abholen, Code 4711.';
const RESEND_NOTE = 'Neuer Hinweis: Ersatzteil liegt im Fahrzeug bereit.';
// Seeded site facts the dispatch surfaces must repeat.
const SITE_ACCESS_NOTE = testData`Zugang über Tor 2, Code 4711`;
const NORTH_STREET = testData`Nordstraße 7`;

// ---------------------------------------------------------------------------
// Audit-local read-only database observers (A7 only). Service-role SELECTs
// used exclusively for assertions.
// ---------------------------------------------------------------------------

async function getDispatchRevisionNotes(orgId: string, jobNumber: string): Promise<Array<string | null>> {
  const dispatchIds = (await getDispatchState(orgId, jobNumber)).dispatches.map(
    (dispatch) => dispatch.dispatchId,
  );
  if (!dispatchIds.length) return [];
  const { data, error } = await createAdminClient()
    .from('planning_dispatch_revisions')
    .select('dispatch_note')
    .eq('organization_id', orgId)
    .in('dispatch_id', dispatchIds)
    .order('revision_number', { ascending: true });
  if (error) throw new Error(`A7 revision lookup failed: ${error.message}`);
  return (data ?? []).map((row) => row.dispatch_note);
}

async function getCommitmentFacts(
  orgId: string,
  jobNumber: string,
): Promise<
  Array<{
    status: string;
    source: string;
    windowStartTime: string | null;
    windowEndTime: string | null;
    withdrawalReason: string | null;
  }>
> {
  const occurrenceIds = (await getPlanningState(orgId, { jobNumber })).occurrences.map(
    (occurrence) => occurrence.id,
  );
  if (!occurrenceIds.length) return [];
  const { data, error } = await createAdminClient()
    .from('planning_customer_commitments')
    .select('status, source, window_start_time, window_end_time, withdrawal_reason, recorded_at')
    .eq('organization_id', orgId)
    .in('occurrence_id', occurrenceIds)
    .order('recorded_at', { ascending: true });
  if (error) throw new Error(`A7 commitment lookup failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    status: row.status,
    source: row.source,
    windowStartTime: row.window_start_time,
    windowEndTime: row.window_end_time,
    withdrawalReason: row.withdrawal_reason,
  }));
}

test.describe('A7 Einsätze @AUDIT-W1-A7', () => {
  test('A7-T1: Das Bereitschaftsbild ist ehrlich — sechs Dimensionen, Material nie reserviert, Unbekanntes nie grün [P1-12-F02]', async ({
    adminPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const customerName = `A7-T1 Kundin ${world.runId}`;
    const siteName = `A7-T1 Werk Nord ${world.runId}`;
    const jobNumber = `A7-T1-${world.runId}`;
    const title = `A7-T1 Einsatzbesuch ${world.runId}`;

    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customerName,
      clientType: 'gewerblich',
      address: 'Nordstraße 7, 10115 Berlin',
      sites: [
        {
          name: siteName,
          street: 'Nordstraße 7',
          postalCode: '10115',
          city: 'Berlin',
          accessNotes: SITE_ACCESS_NOTE,
        },
      ],
    });
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title,
      clientId: customer.clientId,
      siteId: expectDefined(customer.siteIds.get(siteName), 'the seeded site'),
    });
    // Planned material demand against the seeded stock: the readiness picture
    // must label it "nicht reserviert" no matter how much stock exists.
    await planMaterialOnJobPage(
      adminPage,
      jobNumber,
      world.inventory.itemName,
      world.inventory.locationName,
      2,
    );
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber,
      date: dispatchOverviewBerlinDateAtOffset(5),
      time: '06:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });

    await openDispatchPanel(adminPage);
    const dialog = await openIssueDialogForPanelRow(adminPage, title);

    // All six dimensions render as labeled content.
    for (const [key, label] of Object.entries(DISPATCH_READINESS_COPY.label)) {
      await expect(readinessDimension(dialog, key)).toBeVisible();
      await expect(readinessDimension(dialog, key)).toContainText(label);
    }
    // Capacity comes from the planning assessment: the audit world has no
    // work schedules, so the schedule-fallback warning is deterministic.
    await expect(readinessDimension(dialog, 'capacity', 'warning')).toBeVisible();
    // Site/access facts are visible.
    await expect(readinessDimension(dialog, 'site')).toContainText(siteName);
    await expect(readinessDimension(dialog, 'site')).toContainText(SITE_ACCESS_NOTE);
    // Travel has no provable fact — honestly "nicht bewertet".
    await expect(readinessDimension(dialog, 'travel', 'unknown')).toBeVisible();
    await expect(readinessDimension(dialog, 'travel')).toContainText(DISPATCH_READINESS_COPY.travelUnknown);
    // Material demand is ALWAYS labeled unreserved, per line and per label.
    await expect(readinessDimension(dialog, 'material')).toContainText(DISPATCH_READINESS_COPY.materialLabel);
    await expect(readinessDimension(dialog, 'material')).toContainText(world.inventory.itemName);
    await expect(readinessDimension(dialog, 'material')).toContainText(
      DISPATCH_READINESS_COPY.materialLineEnd,
    );
    // Tools are never assessed in this slice.
    await expect(readinessDimension(dialog, 'tools')).toContainText(
      DISPATCH_READINESS_COPY.toolsUnknownLabel,
    );
    await expect(readinessDimension(dialog, 'tools')).toContainText(DISPATCH_READINESS_COPY.toolsUnknown);
    // The negative: no unknown dimension may borrow the success icon.
    const renderedUnknownDimensions = await dialog.locator('[data-readiness-state="unknown"]').all();
    expect(renderedUnknownDimensions.length).toBeGreaterThan(0);
    for (const unknownDimension of renderedUnknownDimensions) {
      await expect(unknownDimension.locator('[data-readiness-icon="unknown"]')).toBeVisible();
      await expect(unknownDimension.locator('[data-readiness-icon="ok"]')).toHaveCount(0);
    }

    // The optional Hinweistext travels with the dispatch.
    await dialog.locator('#dispatch-note').fill(MAIN_NOTE);
    await dispatchSendButton(dialog).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    const state = await getDispatchState(world.orgId, jobNumber);
    expect(state.dispatches.map((dispatch) => dispatch.status)).toEqual(['active']);
    expect(await getDispatchRevisionNotes(world.orgId, jobNumber)).toEqual([MAIN_NOTE]);
  });

  test('A7-T2: Belegbare Fahrzeit warnt; die Mein-Einsatz-Karte trägt Termin, Ort und Hinweis; Bestätigen läuft über /aufgaben [P1-12-F02/P1-12-F03/P1-12-F07]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const customerName = `A7-T2 Kundin ${world.runId}`;
    const northSite = `A7-T2 Werk Nord ${world.runId}`;
    const southSite = `A7-T2 Werk Süd ${world.runId}`;
    const mainNumber = `A7-T2-MAIN-${world.runId}`;
    const mainTitle = `A7-T2 Einsatzbesuch ${world.runId}`;
    const travelNumber = `A7-T2-TRAVEL-${world.runId}`;
    const travelTitle = `A7-T2 Anschlussbesuch ${world.runId}`;
    const visitDate = dispatchOverviewBerlinDateAtOffset(6);

    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customerName,
      clientType: 'gewerblich',
      sites: [
        { name: northSite, street: NORTH_STREET, postalCode: '10115', city: 'Berlin' },
        { name: southSite, street: 'Südstraße 9', postalCode: '12099', city: 'Berlin' },
      ],
    });
    // A provable travel fact: the same person leaves the Nord site at 07:00
    // and starts at the Süd site at 07:00 — zero gap between different sites.
    await createJob(adminPage, {
      jobNumber: mainNumber,
      title: mainTitle,
      clientName: customerName,
      siteName: northSite,
    });
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber: travelNumber,
      title: travelTitle,
      clientId: customer.clientId,
      siteId: expectDefined(customer.siteIds.get(southSite), 'the seeded south site'),
    });
    for (const [jobSearch, time] of [
      [mainNumber, '06:00'],
      [travelNumber, '07:00'],
    ] as const) {
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch,
        date: visitDate,
        time,
        employeeNames: [employeeName],
        overrideReason: OVERRIDE_REASON,
      });
    }

    await openDispatchPanel(adminPage);
    await sendDispatchWithNote(adminPage, mainTitle, MAIN_NOTE);
    const travelDialog = await openIssueDialogForPanelRow(adminPage, travelTitle);
    await expect(readinessDimension(travelDialog, 'travel', 'warning')).toBeVisible();
    await expect(readinessDimension(travelDialog, 'travel')).toContainText(
      DISPATCH_READINESS_COPY.travelConflict,
    );
    await travelDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
    await expect(travelDialog).toHaveCount(0, { timeout: 15_000 });
    // The panel surfaces the same provable fact as a Fahrzeit-Hinweis.
    await expect(
      firstDispatchPanelText(adminPage, new RegExp(DISPATCH_READINESS_COPY.travelConflict)),
    ).toBeVisible({
      timeout: 20_000,
    });

    // The worker's card: Termin, Ort, Hinweis — then confirmation VIA the
    // /aufgaben task (deep link, not a direct navigation).
    await openJobViaDispatchTask(employeePage, mainTitle);
    const card = jobDispatchSection(employeePage).locator('[data-dispatch-state="ausstehend"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(`${formatGermanDate(visitDate)}, 06:00`);
    await expect(card).toContainText(NORTH_STREET);
    await expect(card).toContainText(dispatchNoteText(MAIN_NOTE));
    await acknowledgeDispatchButton(jobDispatchSection(employeePage)).click();
    await expect(jobDispatchSection(employeePage).locator('[data-dispatch-state="bestaetigt"]')).toBeVisible({
      timeout: 20_000,
    });

    const state = await getDispatchState(world.orgId, mainNumber);
    expect(
      state.dispatches[0]?.acknowledgements.filter(
        (ack) => ack.revisionNumber === 1 && ack.state === 'acknowledged',
      ),
    ).toHaveLength(1);
    // A confirmation is only "seen and accepted": no commitment, no time on this job.
    expect(await getCommitmentState(world.orgId, mainNumber)).toHaveLength(0);
    expect((await getPlanningState(world.orgId, { jobNumber: mainNumber })).actualTimeCount).toBe(0);
  });

  test('A7-T3: Empfängerstände — Übernommen bei reiner Empfängeränderung, „nicht möglich" ohne Login, nie automatisch bestätigt [P1-12-F01/P1-12-F04]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const emilName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const jobNumber = `A7-T3-${world.runId}`;
    const title = `A7-T3 Empfängerbesuch ${world.runId}`;
    const visitDate = dispatchOverviewBerlinDateAtOffset(7);
    const noLoginLastName = `Nurpapier-${world.runId}`;
    const noLoginName = `Nils ${noLoginLastName}`;

    // An acknowledged dispatch for Emil is the starting point.
    await seedJob({ orgId: world.orgId, actorId: world.users.admin.id, jobNumber, title });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber,
      date: visitDate,
      time: '06:00',
      employeeNames: [emilName],
      overrideReason: OVERRIDE_REASON,
    });
    await openDispatchPanel(adminPage);
    await issueDispatchForOccurrence(adminPage, title);
    await acknowledgeDispatchOnJobPage(employeePage, jobNumber);
    const { id: noLoginRecordId } = await createPersonnelRecordViaDialog(adminPage, {
      firstName: 'Nils',
      lastName: noLoginLastName,
    });

    // A PURE recipient-set change: the visit itself stays untouched.
    const editDialog = await openOccurrenceEditDialogByDate(adminPage, title, visitDate);
    await addOccurrenceAssignee(adminPage, editDialog, world.users.buero.firstName);
    await addOccurrenceAssignee(adminPage, editDialog, noLoginName);
    await saveOccurrenceEditWithOverride(editDialog, OVERRIDE_REASON);

    const state = await getDispatchState(world.orgId, jobNumber);
    const dispatch = expectDefined(state.dispatches[0], 'the dispatch');
    expect(dispatch.revisionChangeKinds).toEqual(['issued', 'reassigned']);
    expect(dispatch.currentRecipientRecordIds).toHaveLength(3);
    // The unchanged recipient's confirmation lives on traceably.
    expect(
      dispatch.acknowledgements.filter((ack) => ack.revisionNumber === 2).map((ack) => ack.state),
    ).toEqual(['carried_forward']);
    // A record without login is NEVER auto-confirmed.
    expect(dispatch.acknowledgements.filter((ack) => ack.employeeRecordId === noLoginRecordId)).toHaveLength(
      0,
    );

    // The panel shows the full visible state vocabulary.
    await openDispatchPanel(adminPage);
    const row = dispatchOccurrenceRow(adminPage, title);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('[data-recipient-state="uebernommen"]')).toContainText(
      `${emilName} · ${DISPATCH_RECIPIENT_STATE_LABELS.uebernommen}`,
    );
    await expect(row.locator('[data-recipient-state="ausstehend"]')).toContainText(
      DISPATCH_RECIPIENT_STATE_LABELS.ausstehend,
    );
    await expect(row.locator('[data-recipient-state="nicht_moeglich"]')).toContainText(
      `${noLoginName} · ${DISPATCH_RECIPIENT_STATE_LABELS.nicht_moeglich}`,
    );
  });

  test('A7-T4: Rückfrage über /aufgaben wird Manager-Aufgabe; die Plananpassung erzeugt automatisch den neuen Stand; ein geänderter Ort macht Bestätigungen ungültig [P1-12-F03/P1-12-F04/P1-12-F05]', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const brunoName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const jobNumber = `A7-T4-${world.runId}`;
    const title = `A7-T4 Rückfragebesuch ${world.runId}`;
    const visitDate = dispatchOverviewBerlinDateAtOffset(8);
    const movedDate = dispatchOverviewBerlinDateAtOffset(9);
    const challengeReason = testData`A7 Terminüberschneidung mit anderem Einsatz.`;
    const newLocation = `A7 Ausweichlager Ost ${world.runId}`;

    await seedJob({ orgId: world.orgId, actorId: world.users.admin.id, jobNumber, title });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber,
      date: visitDate,
      time: '06:00',
      employeeNames: [brunoName],
      overrideReason: OVERRIDE_REASON,
    });
    await openDispatchPanel(adminPage);
    await issueDispatchForOccurrence(adminPage, title);

    // The recipient challenges VIA the /aufgaben task's deep link.
    await openJobViaDispatchTask(bueroPage, title);
    await challengeDispatchButton(bueroPage).click();
    await submitDispatchChallenge(bueroPage, challengeReason);
    await expect(jobDispatchSection(bueroPage).locator('[data-dispatch-state="rueckfrage"]')).toBeVisible({
      timeout: 20_000,
    });

    // The open challenge is a manager task AND visible in the panel.
    await openAufgaben(adminPage);
    const challengeGroup = adminPage.getByRole('main').getByTestId('attention-dispatch-challenge-tasks');
    await expect(challengeGroup).toBeVisible({ timeout: 20_000 });
    await expect(challengeTaskLink(challengeGroup, brunoName, title)).toBeVisible();
    await expect(challengeGroup.getByText(challengeReason)).toBeVisible();
    await openDispatchPanel(adminPage);
    await expect(firstDispatchPanelText(adminPage, challengeReason)).toBeVisible({
      timeout: 20_000,
    });

    // Resolution by ADAPTING the plan: moving the visit supersedes the
    // revision, closes the challenge, and the recipient sees the new state.
    await editPlannedCalendarOccurrence(adminPage, {
      title,
      calendarDate: visitDate,
      scope: 'one',
      date: movedDate,
      overrideReason: OVERRIDE_REASON,
    });
    let state = await getDispatchState(world.orgId, jobNumber);
    expect(state.dispatches[0]?.revisionChangeKinds).toEqual(['issued', 'schedule_changed']);
    expect(
      state.dispatches[0]?.acknowledgements.find(
        (ack) => ack.revisionNumber === 1 && ack.state === 'challenged',
      )?.challengeResolution,
    ).toBe('superseded');
    await openAufgaben(adminPage);
    await expectGone(challengeTaskLink(adminPage, brunoName, title));

    // The recipient sees "ausstehend" WITH the new state (the moved date).
    await bueroPage.goto(`/auftraege/${jobNumber}`);
    const pendingCard = jobDispatchSection(bueroPage).locator('[data-dispatch-state="ausstehend"]');
    await expect(pendingCard).toBeVisible({ timeout: 20_000 });
    await expect(pendingCard).toContainText(formatGermanDate(movedDate));

    // A changed Ort is a material instruction change: the confirmed dispatch
    // is superseded again and the card shows the new location.
    await acknowledgeDispatchButton(jobDispatchSection(bueroPage)).click();
    await expect(jobDispatchSection(bueroPage).locator('[data-dispatch-state="bestaetigt"]')).toBeVisible({
      timeout: 20_000,
    });
    await editJobLocation(adminPage, jobNumber, newLocation);

    await expect
      .poll(
        async () => {
          state = await getDispatchState(world.orgId, jobNumber);
          return state.dispatches[0]?.revisionChangeKinds;
        },
        { timeout: 20_000 },
      )
      .toEqual(['issued', 'schedule_changed', 'instruction_changed']);
    expect(state.dispatches[0]?.acknowledgements.filter((ack) => ack.revisionNumber === 3)).toHaveLength(0);
    const invalidatedCard = jobDispatchSection(bueroPage).locator('[data-dispatch-state="ausstehend"]');
    await expect(invalidatedCard).toBeVisible({ timeout: 20_000 });
    await expect(invalidatedCard).toContainText(newLocation);
  });

  test('A7-T5: Parkplatz — bewusster Kontext, Einsatz an die Zugewiesenen, manueller Storno und Neusenden mit geändertem Hinweis [P1-12-F04/P1-12-F06/P1-12-F12/P1-14-F21]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const parkNumber = `A7-T5-${world.runId}`;
    const parkTitle = `A7-T5 Rückstau ${world.runId}`;
    const emilName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    await createJob(adminPage, {
      jobNumber: parkNumber,
      title: parkTitle,
      assignEmployeeName: world.users.employee.firstName,
    });
    await adminPage.goto(`/auftraege/${parkNumber}`);
    const parkingDialog = await parkWork(adminPage, {
      reason: 'capacity',
      details: 'Einsatz wird aus dem Parkplatz heraus abgestimmt.',
      responsibleName: world.users.admin.firstName,
      reviewDate: berlinDateAtOffset(2),
    });
    await expect(parkingDialog).toHaveCount(0, { timeout: 20_000 });

    await openParkplatzPanel(adminPage);
    const card = parkplatzCard(adminPage, parkTitle);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-parking-context="set"]')).toContainText(
      WORK_BLOCKER_REASON_LABELS.capacity,
    );

    // Dispatch to the ASSIGNED employees: the dialog preselects them.
    await parkplatzDispatchButton(card).click();
    const dialog = dispatchIssueDialog(adminPage);
    await expect(readinessDimension(dialog, 'tools', 'unknown')).toBeVisible({
      timeout: 20_000,
    });
    await searchDispatchRecipients(adminPage, dialog, emilName);
    await expect(dispatchRecipientOption(adminPage, emilName)).toHaveAttribute('aria-selected', 'true');
    await dialog.getByRole('heading').click();
    await dialog.locator('#dispatch-note').fill(MAIN_NOTE);
    await dispatchSendButton(dialog).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    await employeePage.goto(`/auftraege/${parkNumber}`);
    await expect(jobDispatchSection(employeePage).locator('[data-dispatch-state="ausstehend"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(jobDispatchSection(employeePage)).toContainText(dispatchNoteText(MAIN_NOTE));

    // Manual cancel with reason: history stays, the worker's card disappears.
    await openDispatchPanel(adminPage);
    const unscheduledRow = unscheduledDispatchRow(adminPage, parkTitle);
    await expect(unscheduledRow).toBeVisible({ timeout: 20_000 });
    await rowReasonAction(unscheduledRow, 'withdrawDispatch').click();
    const cancelDialog = dispatchReasonDialog(adminPage, 'withdrawDispatch');
    await cancelDialog
      .locator('#dispatch-reason-dialog')
      .fill('A7 Material fehlt, Einsatz wird neu geplant.');
    await reasonDialogConfirm(cancelDialog, 'withdrawDispatch').click();
    await expect(cancelDialog).toHaveCount(0, { timeout: 20_000 });

    let state = await getDispatchState(world.orgId, parkNumber);
    expect(state.dispatches.map((dispatch) => dispatch.status)).toEqual(['cancelled']);
    await employeePage.goto(`/auftraege/${parkNumber}`);
    await expect(jobDispatchSection(employeePage)).toHaveCount(0);

    // The Hinweistext is immutable after sending; a changed instruction
    // reaches the person via withdraw + re-send.
    await openParkplatzPanel(adminPage);
    const cardAgain = parkplatzCard(adminPage, parkTitle);
    await expect(cardAgain).toBeVisible({ timeout: 20_000 });
    await parkplatzDispatchButton(cardAgain).click();
    const resendDialog = dispatchIssueDialog(adminPage);
    await expect(readinessDimension(resendDialog, 'tools', 'unknown')).toBeVisible({ timeout: 20_000 });
    await searchDispatchRecipients(adminPage, resendDialog, emilName);
    await expect(dispatchRecipientOption(adminPage, emilName)).toHaveAttribute('aria-selected', 'true');
    await resendDialog.getByRole('heading').click();
    await resendDialog.locator('#dispatch-note').fill(RESEND_NOTE);
    await dispatchSendButton(resendDialog).click();
    await expect(resendDialog).toHaveCount(0, { timeout: 20_000 });

    state = await getDispatchState(world.orgId, parkNumber);
    expect(state.dispatches.map((dispatch) => dispatch.status)).toEqual(['cancelled', 'active']);
    expect(await getDispatchRevisionNotes(world.orgId, parkNumber)).toEqual(
      expect.arrayContaining([MAIN_NOTE, RESEND_NOTE]),
    );
    await employeePage.goto(`/auftraege/${parkNumber}`);
    await expect(jobDispatchSection(employeePage).locator('[data-dispatch-state="ausstehend"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(jobDispatchSection(employeePage)).toContainText(dispatchNoteText(RESEND_NOTE));
  });

  test('A7-T6: Parken storniert aktive Einsätze sichtbar; der atomare Kontext nutzt das gemeinsame Grundvokabular; die fällige Wiedervorlage wird Aufgabe [P1-12-F06/P1-12-F08/P1-12-F10/P1-14-F19/P1-14-F21]', async ({
    adminPage,
    bueroPage,
    employeePage,
    businessDate,
    world,
  }) => {
    const schedTitle = `A7-T6 Künftiger Einsatz ${world.runId}`;
    const schedNumber = `A7-T6-${world.runId}`;
    const scheduledDate = dispatchOverviewBerlinDateAtOffset(2);

    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber: schedNumber,
      title: schedTitle,
    });
    // Use a future timed visit. Started visits are deliberately not draggable.
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: schedNumber,
      date: scheduledDate,
      time: '06:00',
      employeeNames: [`${world.users.employee.firstName} ${world.users.employee.lastName}`],
      overrideReason: OVERRIDE_REASON,
    });
    await openDispatchPanel(adminPage);
    await issueDispatchForOccurrence(adminPage, schedTitle);
    await acknowledgeDispatchOnJobPage(employeePage, schedNumber);

    // Park via the calendar drag gesture — the path that triggers the offer.
    await adminPage.goto(`/kalender?date=${scheduledDate}`);
    await calendarViewTab(adminPage, 'day').click();
    const block = dayViewCards(adminPage, schedTitle);
    await expect(block).toBeVisible({ timeout: 20_000 });
    await expect(block).not.toHaveAttribute('data-locked', '');
    const blockBox = await block.boundingBox();
    const parkplatzBox = await parkplatzButton(adminPage).boundingBox();
    if (!blockBox || !parkplatzBox) {
      throw new Error('A7-T6: park drag targets are unavailable');
    }
    await adminPage.mouse.move(blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2);
    await adminPage.mouse.down();
    await adminPage.mouse.move(
      parkplatzBox.x + parkplatzBox.width / 2,
      parkplatzBox.y + parkplatzBox.height / 2,
      { steps: 15 },
    );
    await adminPage.mouse.up();
    // Dragging opens the required atomic parking context before anything is
    // persisted.
    const contextDialog = parkingContextDialog(adminPage);
    await expect(contextDialog).toBeVisible({ timeout: 20_000 });
    // The P1-14 canonical reason vocabulary is offered in one place.
    await contextDialog.locator('#parking-reason').click();
    const reasonListbox = adminPage.getByRole('listbox');
    await expect(reasonListbox.getByRole('option')).toHaveCount(10);
    for (const label of Object.values(WORK_BLOCKER_REASON_LABELS)) {
      await expect(reasonListbox.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    await reasonListbox
      .getByRole('option', { name: WORK_BLOCKER_REASON_LABELS.approval, exact: true })
      .click();
    await contextDialog.locator('#parking-note').fill('A7 Freigabe des Eigentümers steht aus.');
    await selectFromSearchable(
      adminPage,
      contextDialog.locator('#parking-responsible'),
      world.users.buero.firstName,
    );
    // A review date of TODAY is already overdue (≤ business today).
    await typeIntoDatePickerById(contextDialog, 'parking-review-date', businessDate);
    await parkingContextSave(contextDialog).click();
    await expect(contextDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(calendarConfirmation(adminPage, 'parked')).toBeVisible({
      timeout: 20_000,
    });

    const parking = await getParkingState(world.orgId, schedNumber);
    expect(parking.context?.reason).toBe('approval');
    expect(parking.context?.nextReviewDate).toBe(businessDate);

    // Parking cancelled the acknowledged dispatch automatically and visibly.
    const state = await getDispatchState(world.orgId, schedNumber);
    expect(state.dispatches.map((dispatch) => dispatch.status)).toEqual(['cancelled']);
    await employeePage.goto(`/auftraege/${schedNumber}`);
    await expect(jobDispatchSection(employeePage)).toHaveCount(0);
    await openDispatchPanel(adminPage);
    await expectGone(dispatchOccurrenceRow(adminPage, schedTitle));

    // The overdue Wiedervorlage is a task for the responsible person.
    await openAufgaben(bueroPage);
    const reviewGroup = bueroPage.getByRole('main').getByTestId('attention-parking-review-tasks');
    await expect(reviewGroup).toBeVisible({ timeout: 20_000 });
    const reviewTask = parkingReviewTaskLink(reviewGroup, schedTitle);
    await expect(reviewTask).toBeVisible();
    await expect(reviewTask).toContainText(taskResponsibleText(world.users.buero.firstName));
  });

  test('A7-T7: Kundenzusage — Ankunftsfenster, vier Kanäle, kein Versand; nach dem Verschieben sichtbare Abweichung und Rückzug mit Grund [P1-12-F13/P1-12-F14]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const commitTitle = `A7-T7 Zusagebesuch ${world.runId}`;
    const commitNumber = `A7-T7-${world.runId}`;
    const commitDate = dispatchOverviewBerlinDateAtOffset(10);

    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber: commitNumber,
      title: commitTitle,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: commitNumber,
      date: commitDate,
      time: '06:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });
    await openDispatchPanel(adminPage);
    await issueDispatchForOccurrence(adminPage, commitTitle);

    const row = dispatchOccurrenceRow(adminPage, commitTitle);
    await recordCommitmentButton(row).click();
    const dialog = commitmentDialog(adminPage);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Recording documents an internal note only — the app sends nothing.
    await expect(dialog).toContainText(DISPATCH_COMMITMENT_COPY.noMessageSent);
    // Exactly the four catalog channels are offered.
    await dialog.locator('#commitment-source').click();
    await expect(adminPage.getByRole('option')).toHaveCount(4);
    for (const label of Object.values(COMMITMENT_SOURCE_LABELS)) {
      await expect(adminPage.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    await adminPage.getByRole('option', { name: COMMITMENT_SOURCE_LABELS.vor_ort, exact: true }).click();
    // The optional arrival window covers the visit's 06:00 start.
    await typeIntoTimeInput(dialog, 'commitment-window-start', '0600');
    await typeIntoTimeInput(dialog, 'commitment-window-end', '0800');
    await commitmentSubmit(dialog).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    await expect(row.locator('[data-commitment-mismatch="false"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(row).toContainText(commitmentSummaryText(formatGermanDate(commitDate), '06:00', '08:00'));
    const recorded = await getCommitmentFacts(world.orgId, commitNumber);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.source).toBe('vor_ort');
    expect(recorded[0]?.windowStartTime?.slice(0, 5)).toBe('06:00');
    expect(recorded[0]?.windowEndTime?.slice(0, 5)).toBe('08:00');
    // The worker sees the internal promise on their card.
    await employeePage.goto(`/auftraege/${commitNumber}`);
    await expect(jobDispatchSection(employeePage)).toContainText(
      DISPATCH_COMMITMENT_COPY.committedToCustomer,
    );
    await expect(jobDispatchSection(employeePage)).toContainText(arrivalWindowText('06:00', '08:00'));

    // Moving the visit leaves the commitment standing and shows the mismatch.
    await editPlannedCalendarOccurrence(adminPage, {
      title: commitTitle,
      calendarDate: commitDate,
      scope: 'one',
      date: dispatchOverviewBerlinDateAtOffset(11),
      overrideReason: OVERRIDE_REASON,
    });
    await openDispatchPanel(adminPage);
    const movedRow = dispatchOccurrenceRow(adminPage, commitTitle);
    await expect(movedRow.locator('[data-commitment-mismatch="true"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(movedRow).toContainText(DISPATCH_COMMITMENT_COPY.mismatch);

    // Explicit resolution: withdraw WITH reason; no customer notification.
    await rowReasonAction(movedRow, 'withdrawCommitment').click();
    const withdrawDialog = dispatchReasonDialog(adminPage, 'withdrawCommitment');
    await expect(withdrawDialog).toContainText(DISPATCH_COMMITMENT_COPY.customerNotNotified);
    await withdrawDialog
      .locator('#dispatch-reason-dialog')
      .fill('A7 Kundin hat den Termin telefonisch abgesagt.');
    await reasonDialogConfirm(withdrawDialog, 'withdrawCommitment').click();
    await expect(withdrawDialog).toHaveCount(0, { timeout: 20_000 });

    const withdrawn = await getCommitmentFacts(world.orgId, commitNumber);
    expect(withdrawn.map((commitment) => commitment.status)).toEqual(['withdrawn']);
    expect(withdrawn[0]?.withdrawalReason).toBe('A7 Kundin hat den Termin telefonisch abgesagt.');
    await expect(recordCommitmentButton(movedRow)).toBeVisible({
      timeout: 20_000,
    });
    await expectGone(movedRow.locator('[data-commitment-mismatch]'));
  });

  test('A7-T8: Batch-Auswahl kennt nur die Zukunft; ganztägige Besuche brauchen eine Tagesverschiebung — alles oder nichts [P1-12-F15/P1-12-F17]', async ({
    adminPage,
    businessDate,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const todayNumber = `A7-T8-HEUTE-${world.runId}`;
    const todayTitle = `A7-T8 Ganztag heute ${world.runId}`;
    const alldayNumber = `A7-T8-${world.runId}`;
    const alldayTitle = `A7-T8 Ganztagsbesuch ${world.runId}`;
    const alldayDate = dispatchOverviewBerlinDateAtOffset(4);

    for (const [jobNumber, title, date] of [
      [todayNumber, todayTitle, businessDate],
      [alldayNumber, alldayTitle, alldayDate],
    ] as const) {
      await seedJob({ orgId: world.orgId, actorId: world.users.admin.id, jobNumber, title });
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: jobNumber,
        date,
        durationDays: 1,
        employeeNames: [employeeName],
        overrideReason: OVERRIDE_REASON,
      });
    }

    await openDispatchPanel(adminPage);
    const panel = dispatchPanel(adminPage);
    await batchModeToggle(panel).click();

    // Only FUTURE visits are selectable: today's all-day visit is offered as
    // a row but its checkbox stays disabled.
    const todayRow = dispatchOccurrenceRow(adminPage, todayTitle);
    await expect(todayRow).toBeVisible({ timeout: 20_000 });
    await expect(todayRow.getByRole('checkbox')).toBeDisabled();

    const alldayRow = dispatchOccurrenceRow(adminPage, alldayTitle);
    await alldayRow.getByRole('checkbox').check();
    await expect(batchSelectionCount(panel, 1)).toBeVisible({
      timeout: 10_000,
    });
    await panel.locator('#batch-day-shift').fill('0');
    await panel.locator('#batch-reason').fill('A7 Uhrzeitverschiebung ohne Tageswechsel.');
    // A zero shift without a new time is no move at all: submitting names the
    // missing input and opens no preview.
    await checkBatchImpactButton(panel).click();
    await expect(batchShiftMissingError(panel)).toBeVisible();
    await expect(batchPreviewDialog(adminPage)).toHaveCount(0);

    // All-or-nothing rejection: an all-day visit with a pure time shift is
    // refused with the exact German message and NOTHING moves.
    await typeIntoTimeInput(panel, 'batch-new-time', '0700');
    await checkBatchImpactButton(panel).click();
    await expect(panel.getByText(dispatchErrorMessage('batch_item_all_day_needs_day_shift'))).toBeVisible({
      timeout: 20_000,
    });
    const allday = await getPlanningState(world.orgId, { jobNumber: alldayNumber });
    expect(allday.occurrences.map((occurrence) => occurrence.startDate)).toEqual([alldayDate]);
  });

  test('A7-T9: Batch mit neuer Uhrzeit — Vorschau je Termin alt und neu, Konflikte nur mit Grund, Serientermine werden Einzel-Ausnahmen [P1-12-F15/P1-12-F16/P1-12-F17]', async ({
    adminPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const seriesTitle = `A7-T9 Serienbesuch ${world.runId}`;
    const seriesNumber = `A7-T9-${world.runId}`;
    const seriesDate = dispatchOverviewBerlinDateAtOffset(12);
    const secondSourceDate = dispatchOverviewBerlinDateAtOffset(13);
    const shiftedFirst = berlinDateAtOffset(13);
    const shiftedSecond = berlinDateAtOffset(14);

    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber: seriesNumber,
      title: seriesTitle,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: seriesNumber,
      date: seriesDate,
      time: '06:00',
      employeeNames: [employeeName],
      recurrence: { frequency: 'daily', count: 2 },
      overrideReason: OVERRIDE_REASON,
    });
    const before = await getPlanningState(world.orgId, { jobNumber: seriesNumber });
    expect(before.occurrenceCount).toBe(2);
    const seriesId = expectDefined(before.occurrences[0]?.seriesId, 'the series id');

    await openDispatchPanel(adminPage);
    const panel = dispatchPanel(adminPage);
    await batchModeToggle(panel).click();
    const rows = dispatchPanelOccurrences(panel, seriesTitle);
    // The overview loads asynchronously after the panel opens — wait for the
    // series rows before touching any checkbox.
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    for (const row of await rows.all()) {
      await row.getByRole('checkbox').check();
    }
    await expect(batchSelectionCount(panel, 2)).toBeVisible({
      timeout: 10_000,
    });
    // Whole days AND a new time together.
    await panel.locator('#batch-day-shift').fill('1');
    await typeIntoTimeInput(panel, 'batch-new-time', '0800');
    await panel.locator('#batch-reason').fill('A7 Krankheitsbedingte Umplanung mit neuer Anfahrtszeit.');
    await checkBatchImpactButton(panel).click();
    const preview = batchPreviewDialog(adminPage);
    await expect(preview).toBeVisible({ timeout: 30_000 });

    // The preview names each occurrence with its OLD and NEW instant, ordered
    // by the old start (the server sorts the items deterministically).
    const previewItems = preview.locator('[data-batch-preview-item]');
    await expect(previewItems).toHaveCount(2);
    const expectedRows = [
      { oldDate: seriesDate, newDate: shiftedFirst },
      { oldDate: secondSourceDate, newDate: shiftedSecond },
    ];
    for (const [index, item] of (await previewItems.all()).entries()) {
      const expectedRow = expectDefined(expectedRows[index], `the expected preview row ${index}`);
      await expect(item).toContainText(seriesTitle);
      await expect(item).toContainText(
        batchPreviewInstant(shortGermanDayMonth(expectedRow.oldDate), '06:00'),
      );
      await expect(item).toContainText('→');
      await expect(item).toContainText(
        batchPreviewInstant(shortGermanDayMonth(expectedRow.newDate), '08:00'),
      );
    }
    // Capacity conflicts (no schedules in this world) are announced with the
    // reason requirement before anything moves.
    await expect(batchPreviewNotice(preview, 'planningWarnings')).toBeVisible();

    await moveNowButton(preview).click();
    const warning = planningWarningDialog(adminPage);
    await expect(warning).toBeVisible({ timeout: 30_000 });
    // Conflicts override ONLY with a sufficient reason.
    await planningWarningReason(warning).fill('kurz');
    await planningWarningSave(warning).click();
    await expect(warning.getByText(REASON_MIN_8_MESSAGE, { exact: true })).toBeVisible();
    await planningWarningReason(warning).fill('A7 Umplanung betrieblich abgestimmt und bestätigt.');
    await planningWarningSave(warning).click();
    await expect(warning).toHaveCount(0, { timeout: 30_000 });
    await expect(preview).toHaveCount(0, { timeout: 30_000 });

    // Both visits moved one day to 08:00 as exceptions of the SAME series.
    const after = await getPlanningState(world.orgId, { jobNumber: seriesNumber });
    expect(
      after.occurrences
        .map((occurrence) =>
          occurrence.startAt ? formatBerlinLocalDateTime(occurrence.startAt).slice(0, 16) : '',
        )
        .sort(),
    ).toEqual([`${shiftedFirst}T08:00`, `${shiftedSecond}T08:00`]);
    expect(after.occurrences.every((occurrence) => occurrence.isException)).toBe(true);
    expect(after.occurrences.every((occurrence) => occurrence.seriesId === seriesId)).toBe(true);
  });
});
