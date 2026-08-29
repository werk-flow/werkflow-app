import { expect, test } from './support/fixtures';
import { resolveDailyTargets } from '../../lib/personnel/targets';
import { getBusinessWeekDates } from '../../lib/personnel/schedule';
import { formatDuration } from '../../lib/time-tracking/helpers';
import {
  getAbsenceSpansForRecord,
  getAttentionPatternStateForUser,
  getEmployeeRecordStateByUser,
  getLatestSicknessReportState,
  getTargetContextForRecord,
  getVisibleSicknessRecordIdsAs,
  hasApprovedVacationIntersecting,
} from './support/db';
import {
  attentionNotificationRow,
  cancelSicknessReportViaMenuWithReason,
  clockOut,
  expectClockInNoticeForSickness,
  expectSicknessOverlapRejectedViaDialog,
  markAttentionNotificationReadViaButton,
  openAufgaben,
  openMemberDetailFromList,
  openOwnSicknessSection,
  recordSicknessForMemberViaSection,
  reportOwnSicknessViaDialog,
  setOwnSicknessEndDateViaDialog,
  setSicknessEvidenceViaMenu,
  visibleText,
  textInDom,
} from './support/steps';

// P1-08 — Sickness / privacy-sensitive absence (@P1-08). A report is a FACT
// (reported → corrected/ended → possibly cancelled), never an approval
// lifecycle. Exit evidence covered end to end: the privacy matrix (layered
// disclosure per role, RLS with real credentials, neutral shared calendar),
// partial and retroactive cases, target-time effects through the one
// extended absence mechanism, and evidence access as tracked state without
// file bytes.
//
// DUAL-MODE DESIGN (testing.md): this file sorts LAST (after p1-07.spec.ts),
// so in the full suite it inherits EVERYTHING including GG-02's leftovers.
// It also runs focused on a fresh world. It therefore depends on NO
// responsibility state (sickness authority is the manager role, not a
// responsibility — no pinning needed), derives every mode-dependent
// expectation from the database at runtime (the vacation-overlap hint exists
// only when approved vacation actually intersects; weekly Soll is computed
// through the app's own resolver from stored schedules + absence spans), and
// asserts notification rows per item identity instead of totals or badges
// (inherited unread admin rows would make totals mode-dependent).
//
// State this spec leaves behind (the NEXT slice's spec sorts after it):
// the employee carries one CANCELLED sickness report (yesterday–today,
// Krankheit, evidence received) whose events are
// reported→ended→evidence_updated×2→cancelled; Büro carries one ACTIVE
// half-day „Kind krank" report for yesterday with evidence required/pending,
// recorded by the admin; sickness read markers exist for Büro (2 versions of
// the employee report) and the employee (the cancellation), plus matching
// attention_events. The employee's cancelled report no longer affects any
// target.

test.describe.configure({ mode: 'serial' });

function berlinTodayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

// Snapshot the business date ONCE at module load: every date the spec
// derives (report start, range texts) must stay consistent with what the app
// stored at report-creation time, even if wall-clock assertions run later.
const TODAY_ISO = berlinTodayIso();
const YESTERDAY_ISO = shiftIsoDate(TODAY_ISO, -1);

const yesterdayIso = () => YESTERDAY_ISO;

// The employee report's range texts (aria-label identity on both surfaces).
const openEndedRangeText = () => `${formatGermanDate(YESTERDAY_ISO)} – bis auf Weiteres`;
const endedRangeText = () => `${formatGermanDate(YESTERDAY_ISO)} – ${formatGermanDate(TODAY_ISO)}`;

test.describe('P1-08 Krankmeldung und sensible Abwesenheit @P1-08', () => {
  test('Selbstmeldung: rückwirkend und offen, Sollzeit folgt, Kalender bleibt neutral, das Büro wird informiert', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);

    // Retroactive open-ended self-report (called in sick yesterday, end
    // unknown). Whether the overlap hint appears depends on inherited
    // approved vacation — derived from the database, not hardcoded per mode.
    const expectOverlap = await hasApprovedVacationIntersecting(
      world.orgId,
      employeeRecord.id,
      yesterdayIso(),
      null
    );
    await reportOwnSicknessViaDialog(employeePage, {
      startDigits: toDatePickerDigits(yesterdayIso()),
      expectVacationOverlapHint: expectOverlap,
    });

    // The reported fact, its audit start, and the no-diagnosis shape.
    const reportState = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(reportState.status).toBe('reported');
    expect(reportState.absenceType).toBe('krankheit');
    expect(reportState.startDate).toBe(yesterdayIso());
    expect(reportState.endDate).toBeNull();
    expect(reportState.eventTypes).toEqual(['reported']);

    // Own list: active, honestly open-ended.
    await openOwnSicknessSection(employeePage);
    await expect(visibleText(employeePage, openEndedRangeText())).toBeVisible({
      timeout: 15_000,
    });

    // Target truth: the dashboard's weekly Soll equals what the app's own
    // resolver computes from stored schedules, conditions, holidays, and the
    // clamped absence spans — in both modes.
    const weekDates = getBusinessWeekDates();
    const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    const absences = await getAbsenceSpansForRecord(
      world.orgId,
      employeeRecord.id,
      weekDates[0],
      weekDates[weekDates.length - 1]
    );
    const targets = resolveDailyTargets(weekDates, { ...context, absences });
    const expectedSollMinutes = targets.reduce((total, target) => total + target.targetMinutes, 0);
    await employeePage.goto('/zeiterfassung');
    await expect(
      visibleText(employeePage, `Soll: ${formatDuration(expectedSollMinutes)}`)
    ).toBeVisible({ timeout: 15_000 });
    // Today's Tagesziel explains itself — unless a holiday/closure already
    // zeroes the day with its own label (runtime-checked, never assumed).
    const todayTarget = targets.find((target) => target.date === TODAY_ISO);
    if (todayTarget && !todayTarget.isHoliday && !todayTarget.isClosureDay) {
      await expect(
        visibleText(employeePage, 'Krankmeldung – heute keine Sollarbeitszeit.')
      ).toBeVisible({ timeout: 15_000 });
    }

    // The shared calendar shows WHO is unavailable, never why: neutral
    // „Abwesend", no type, calm planning state for the manager.
    await adminPage.goto('/kalender');
    await adminPage.getByRole('tab', { name: 'Monat' }).click();
    await expect(
      visibleText(adminPage, `Abwesend – ${employeeName} (bis auf Weiteres)`)
    ).toBeVisible({ timeout: 15_000 });
    await expect(textInDom(adminPage, `Krank – ${employeeName}`)).toHaveCount(0);

    // Notifications (privacy-matrix audiences): both managers are informed —
    // minimal payload, no type; the reporter themselves gets no notice.
    await openAufgaben(bueroPage);
    const bueroRow = attentionNotificationRow(bueroPage, reportState.id);
    await expect(bueroRow).toHaveCount(1, { timeout: 15_000 });
    await expect(bueroRow).toHaveAttribute('data-unread', 'true');
    await expect(bueroRow.getByText(`Krankmeldung: ${employeeName}`)).toBeVisible();
    await expect(bueroRow.getByText('Krankheit')).toHaveCount(0);
    await markAttentionNotificationReadViaButton(bueroPage, reportState.id);

    await openAufgaben(adminPage);
    await expect(attentionNotificationRow(adminPage, reportState.id)).toHaveCount(1, {
      timeout: 15_000,
    });

    await openAufgaben(employeePage);
    await expect(attentionNotificationRow(employeePage, reportState.id)).toHaveCount(0);

    // A second overlapping own report is impossible, race-safe, explained.
    await expectSicknessOverlapRejectedViaDialog(employeePage, {
      startDigits: toDatePickerDigits(TODAY_ISO),
      endDigits: toDatePickerDigits(TODAY_ISO),
    });
  });

  test('Büro-Erfassung: der Anruf um 7 Uhr wird mit halbem Tag und Nachweispflicht erfasst; die betroffene Person sieht es transparent', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);

    // The admin records the phone-call-in for the Büro member: retroactive
    // single half day, neutral type label, evidence explicitly required (the
    // organization's own choice — no rule engine, no legal claim).
    const expectOverlap = await hasApprovedVacationIntersecting(
      world.orgId,
      bueroRecord.id,
      yesterdayIso(),
      yesterdayIso()
    );
    await openMemberDetailFromList(adminPage, bueroName);
    await recordSicknessForMemberViaSection(adminPage, {
      startDigits: toDatePickerDigits(yesterdayIso()),
      endDigits: toDatePickerDigits(yesterdayIso()),
      halfDay: true,
      typeLabel: 'Kind krank',
      evidenceRequired: true,
      expectVacationOverlapHint: expectOverlap,
    });

    const reportState = await getLatestSicknessReportState(world.orgId, bueroRecord.id);
    expect(reportState.status).toBe('reported');
    expect(reportState.absenceType).toBe('kind_krank');
    expect(reportState.dayPortion).toBe('half_day');
    expect(reportState.startDate).toBe(yesterdayIso());
    expect(reportState.endDate).toBe(yesterdayIso());
    expect(reportState.evidenceRequired).toBe(true);
    expect(reportState.evidenceStatus).toBe('pending');
    expect(reportState.eventTypes).toEqual(['reported']);

    // The manager surface shows type and evidence state (the narrow group's
    // view per the privacy matrix).
    await expect(
      visibleText(adminPage, 'Kind krank · Halbtägig · Nachweis ausstehend')
    ).toBeVisible({ timeout: 15_000 });

    // The affected person is informed transparently (own-flavored notice),
    // the recording manager is not re-notified of their own action.
    await openAufgaben(bueroPage);
    const bueroRow = attentionNotificationRow(bueroPage, reportState.id);
    await expect(bueroRow).toHaveCount(1, { timeout: 15_000 });
    await expect(bueroRow).toHaveAttribute('data-unread', 'true');
    await expect(bueroRow.getByText('Für dich wurde eine Krankmeldung erfasst')).toBeVisible();
    await markAttentionNotificationReadViaButton(bueroPage, reportState.id);

    await openAufgaben(adminPage);
    await expect(attentionNotificationRow(adminPage, reportState.id)).toHaveCount(0);
  });

  test('Korrekturen bleiben nachvollziehbar: Enddatum, wieder-ungelesene Meldung, Nachweisführung ohne Lärm', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const before = await getLatestSicknessReportState(world.orgId, employeeRecord.id);

    // „Ich bin wieder da": the person sets the end date themselves.
    await setOwnSicknessEndDateViaDialog(employeePage, {
      rangeText: openEndedRangeText(),
      endDigits: toDatePickerDigits(TODAY_ISO),
      expectedRangeText: endedRangeText(),
    });
    const afterEnd = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(afterEnd.id).toBe(before.id);
    expect(afterEnd.endDate).toBe(TODAY_ISO);
    expect(afterEnd.eventTypes).toEqual(['reported', 'ended']);

    // The correction re-surfaces the SAME manager notice unread — one row,
    // new version, never a duplicate.
    await openAufgaben(bueroPage);
    const bueroRow = attentionNotificationRow(bueroPage, before.id);
    await expect(bueroRow).toHaveCount(1, { timeout: 15_000 });
    await expect(bueroRow).toHaveAttribute('data-unread', 'true', {
      timeout: 15_000,
    });
    await markAttentionNotificationReadViaButton(bueroPage, before.id);

    // Evidence bookkeeping (state only, no bytes): require → received. The
    // office action is audited but deliberately makes no notification noise.
    await openMemberDetailFromList(adminPage, employeeName);
    await setSicknessEvidenceViaMenu(adminPage, endedRangeText(), {
      required: true,
      received: false,
    });
    await expect(visibleText(adminPage, 'Krankheit · Nachweis ausstehend')).toBeVisible({
      timeout: 15_000,
    });
    await setSicknessEvidenceViaMenu(adminPage, endedRangeText(), {
      required: true,
      received: true,
    });
    await expect(visibleText(adminPage, 'Krankheit · Nachweis erhalten')).toBeVisible({
      timeout: 15_000,
    });

    const afterEvidence = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(afterEvidence.evidenceRequired).toBe(true);
    expect(afterEvidence.evidenceStatus).toBe('received');
    expect(afterEvidence.eventTypes).toEqual([
      'reported',
      'ended',
      'evidence_updated',
      'evidence_updated',
    ]);

    // Evidence changes never re-surface the notice (version unchanged).
    await openAufgaben(bueroPage);
    await expect(bueroRow).toHaveAttribute('data-unread', 'false', {
      timeout: 15_000,
    });

    // Pattern audit: Büro's marker moved through both report versions.
    const bueroPattern = await getAttentionPatternStateForUser(world.orgId, world.users.buero.id);
    expect(
      bueroPattern.events.filter(
        (event) =>
          event.sourceType === 'sickness_report' &&
          event.sourceId === before.id &&
          event.eventType === 'marked_read'
      ).length
    ).toBe(2);
  });

  test('Einstempeln trotz Krankmeldung: sichtbarer Hinweis statt Blockade', async ({
    employeePage,
  }) => {
    // Today is still covered by the (now dated) report. A recovered person
    // clocking in early is reality — the action succeeds with a visible
    // notice nudging the end-date correction; the office sees the
    // contradiction on its surface either way.
    await expectClockInNoticeForSickness(employeePage);
    await clockOut(employeePage);
  });

  test('Privacy-Matrix per RLS: die Person sieht sich, Manager sehen die Organisation, Kolleginnen und Außenstehende nichts', async ({
    employeePage,
    world,
  }) => {
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);

    // Row-level truth with real credentials: the person exactly their own
    // report, managers every report of the organization, outsiders none.
    const employeeView = await getVisibleSicknessRecordIdsAs(world.users.employee, world.orgId);
    expect(employeeView).toEqual([employeeRecord.id]);

    const adminView = await getVisibleSicknessRecordIdsAs(world.users.admin, world.orgId);
    expect(adminView).toEqual([employeeRecord.id, bueroRecord.id].sort());

    const outsiderView = await getVisibleSicknessRecordIdsAs(world.outsider.admin, world.orgId);
    expect(outsiderView).toEqual([]);

    // Surface proof of the colleague boundary: the employee's calendar never
    // shows another person's absence, not even neutrally.
    await employeePage.goto('/kalender');
    await employeePage.getByRole('tab', { name: 'Monat' }).click();
    await expect(textInDom(employeePage, `Abwesend – ${bueroName}`)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(textInDom(employeePage, `Abwesend – ${adminName}`)).toHaveCount(0);
  });

  test('Stornierung: die Meldung zählt nicht mehr, beide Betroffenen sehen dieselbe Meldung erneut ungelesen', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const before = await getLatestSicknessReportState(world.orgId, employeeRecord.id);

    // The admin (manager, neither reporter nor affected) cancels the
    // employee's report with a required reason — recorded in error / worked
    // after all. The fact stays, traceably terminal.
    await openMemberDetailFromList(adminPage, employeeName);
    await cancelSicknessReportViaMenuWithReason(
      adminPage,
      endedRangeText(),
      'Doch gearbeitet – Meldung war ein Versehen'
    );

    const afterCancel = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(afterCancel.id).toBe(before.id);
    expect(afterCancel.status).toBe('cancelled');
    expect(afterCancel.cancellationReason).toBe('Doch gearbeitet – Meldung war ein Versehen');
    expect(afterCancel.eventTypes).toEqual([
      'reported',
      'ended',
      'evidence_updated',
      'evidence_updated',
      'cancelled',
    ]);

    // The SAME notification re-surfaces unread for the other manager…
    await openAufgaben(bueroPage);
    const bueroRow = attentionNotificationRow(bueroPage, before.id);
    await expect(bueroRow).toHaveCount(1, { timeout: 15_000 });
    await expect(bueroRow).toHaveAttribute('data-unread', 'true', {
      timeout: 15_000,
    });
    await expect(bueroRow.getByText('Krankmeldung storniert:')).toBeVisible();

    // …and the affected person now learns of the office action on their own
    // report (transparency: an availability change is always explainable).
    await openAufgaben(employeePage);
    const employeeRow = attentionNotificationRow(employeePage, before.id);
    await expect(employeeRow).toHaveCount(1, { timeout: 15_000 });
    await expect(employeeRow).toHaveAttribute('data-unread', 'true');
    await expect(employeeRow.getByText('Deine Krankmeldung', { exact: false })).toBeVisible();
    await expect(employeeRow.getByText('wurde storniert', { exact: false })).toBeVisible();
    await markAttentionNotificationReadViaButton(employeePage, before.id);
    const employeePattern = await getAttentionPatternStateForUser(
      world.orgId,
      world.users.employee.id
    );
    expect(
      employeePattern.readStates.some(
        (readState) =>
          readState.sourceType === 'sickness_report' &&
          readState.sourceId === before.id &&
          readState.stateVersion.startsWith('cancelled:')
      )
    ).toBe(true);

    // The availability signal is gone from planning.
    await adminPage.goto('/kalender');
    await adminPage.getByRole('tab', { name: 'Monat' }).click();
    await expect(textInDom(adminPage, `Abwesend – ${employeeName}`)).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
