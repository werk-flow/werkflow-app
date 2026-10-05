import { expect, test } from './support/fixtures';
import { resolveDailyTargets } from '../../lib/personnel/targets';
import { getBusinessWeekDates } from '../../lib/personnel/schedule';
import { SICKNESS_TYPE_LABELS, formatSicknessRange } from '../../lib/sickness/types';
import { formatDuration } from '../../lib/time-tracking/helpers';
import { getAttentionPatternStateForUser } from './support/db/attention';
import { getEmployeeRecordStateByUser } from './support/db/personnel';
import { getAbsenceSpansForRecord, getLatestSicknessReportState } from './support/db/sickness';
import { getTargetContextForRecord, hasApprovedVacationIntersecting } from './support/db/vacation';
import {
  attentionNotificationRow,
  markAttentionNotificationReadViaButton,
  openAufgaben,
} from './support/steps/attention';
import { TARGET_COPY, openMemberDetailFromList, weeklyTargetText } from './support/steps/personnel';
import { visibleText, textInDom } from './support/steps/shared';
import { showCalendarMonth } from './support/steps/calendar';
import {
  SICKNESS_COPY,
  absenceCalendarLabel,
  cancelSicknessReportViaMenuWithReason,
  sicknessNoticeText,
  sicknessReportSummaryText,
  typedSicknessCalendarLabel,
  expectClockInNoticeForSickness,
  expectSicknessOverlapRejectedViaDialog,
  openOwnSicknessSection,
  recordSicknessForMemberViaSection,
  reportOwnSicknessViaDialog,
  setOwnSicknessEndDateViaDialog,
  setSicknessEvidenceViaMenu,
} from './support/steps/sickness';
import { clockOut } from './support/steps/time-tracking';

// P1-08 — Sickness / privacy-sensitive absence (@P1-08). A report is a FACT
// (reported → corrected/ended → possibly cancelled), never an approval
// lifecycle. Exit evidence covered end to end: the privacy matrix (layered
// disclosure per role, RLS with real credentials, neutral shared calendar),
// partial and retroactive cases, target-time effects through the one
// extended absence mechanism, and evidence access as tracked state without
// file bytes.
//
// Which report rows each role can read is proved in
// supabase/tests/people_boundaries.sql.
//
// One connected transaction: every later stage acts on the report the first
// stage created, so the stages are named steps of one test. A failure stops
// at its own step with one actionable message instead of five dependent
// failures. The spec runs on its own fresh world and derives runtime-dependent
// expectations from the database (the vacation-overlap hint exists only when
// approved vacation actually intersects; weekly Soll is computed through the
// app's own resolver from stored schedules + absence spans). Notification
// rows are asserted per item identity, never as totals or badges.

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

test.describe('P1-08 Krankmeldung und sensible Abwesenheit @P1-08', () => {
  test('Eine Krankmeldung als Faktenkette: Selbstmeldung, Büro-Erfassung, Korrektur, Einstempeln, Privacy-Matrix und Stornierung', async ({
    adminPage,
    bueroPage,
    businessDate,
    employeePage,
    world,
  }) => {
    // Every date the spec derives (report start, range texts) comes from the
    // run's business date, so it stays consistent with what the app stored.
    const todayIso = businessDate;
    const yesterdayIso = shiftIsoDate(todayIso, -1);
    // The employee report's range texts (aria-label identity on both surfaces).
    const openEndedRangeText = formatSicknessRange({ startDate: yesterdayIso, endDate: null });
    const endedRangeText = formatSicknessRange({ startDate: yesterdayIso, endDate: todayIso });
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);

    const reportId =
      await test.step('Selbstmeldung: rückwirkend und offen, Sollzeit folgt, Kalender bleibt neutral, das Büro wird informiert', async () => {
        // Retroactive open-ended self-report (called in sick yesterday, end
        // unknown). Whether the overlap hint appears depends on approved
        // vacation — derived from the database, not hardcoded.
        const expectOverlap = await hasApprovedVacationIntersecting(
          world.orgId,
          employeeRecord.id,
          yesterdayIso,
          null,
        );
        await reportOwnSicknessViaDialog(employeePage, {
          startDigits: toDatePickerDigits(yesterdayIso),
          expectVacationOverlapHint: expectOverlap,
        });

        // The reported fact, its audit start, and the no-diagnosis shape.
        const reportState = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
        expect(reportState.status).toBe('reported');
        expect(reportState.absenceType).toBe('krankheit');
        expect(reportState.startDate).toBe(yesterdayIso);
        expect(reportState.endDate).toBeNull();
        expect(reportState.eventTypes).toEqual(['reported']);

        // Own list: active, honestly open-ended.
        await openOwnSicknessSection(employeePage);
        await expect(visibleText(employeePage, openEndedRangeText)).toBeVisible({
          timeout: 15_000,
        });

        // Target truth: the dashboard's weekly Soll equals what the app's own
        // resolver computes from stored schedules, conditions, holidays, and the
        // clamped absence spans.
        const weekDates = getBusinessWeekDates(new Date(`${todayIso}T12:00:00Z`));
        const [weekStart] = weekDates;
        const weekEnd = weekDates.at(-1);
        if (!weekStart || !weekEnd) throw new Error('P1-08: the business week has no dates');
        const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
        const absences = await getAbsenceSpansForRecord(world.orgId, employeeRecord.id, weekStart, weekEnd);
        const targets = resolveDailyTargets(weekDates, { ...context, absences });
        const expectedSollMinutes = targets.reduce((total, target) => total + target.targetMinutes, 0);
        await employeePage.goto('/zeiterfassung');
        await expect(
          visibleText(employeePage, weeklyTargetText(formatDuration(expectedSollMinutes))),
        ).toBeVisible({
          timeout: 15_000,
        });
        // Today's Tagesziel explains itself — unless a holiday/closure already
        // zeroes the day with its own label (runtime-checked, never assumed).
        const todayTarget = targets.find((target) => target.date === todayIso);
        if (todayTarget && !todayTarget.isHoliday && !todayTarget.isClosureDay) {
          await expect(visibleText(employeePage, TARGET_COPY.sicknessNoTarget)).toBeVisible({
            timeout: 15_000,
          });
        }

        // The shared calendar shows WHO is unavailable, never why: neutral
        // „Abwesend", no type, calm planning state for the manager.
        await showCalendarMonth(adminPage);
        await expect(
          visibleText(adminPage, absenceCalendarLabel(employeeName, { openEnded: true })),
        ).toBeVisible({
          timeout: 15_000,
        });
        await expect(textInDom(adminPage, typedSicknessCalendarLabel(employeeName))).toHaveCount(0);

        // Notifications (privacy-matrix audiences): both managers are informed —
        // minimal payload, no type; the reporter themselves gets no notice.
        await openAufgaben(bueroPage);
        const bueroRow = attentionNotificationRow(bueroPage, reportState.id);
        await expect(bueroRow).toHaveCount(1, { timeout: 15_000 });
        await expect(bueroRow).toHaveAttribute('data-unread', 'true');
        await expect(bueroRow.getByText(sicknessNoticeText(employeeName))).toBeVisible();
        await expect(bueroRow.getByText(SICKNESS_TYPE_LABELS.krankheit)).toHaveCount(0);
        await markAttentionNotificationReadViaButton(bueroPage, reportState.id);

        await openAufgaben(adminPage);
        await expect(attentionNotificationRow(adminPage, reportState.id)).toHaveCount(1, {
          timeout: 15_000,
        });

        await openAufgaben(employeePage);
        await expect(attentionNotificationRow(employeePage, reportState.id)).toHaveCount(0);

        // A second overlapping own report is impossible, race-safe, explained.
        await expectSicknessOverlapRejectedViaDialog(employeePage, {
          startDigits: toDatePickerDigits(todayIso),
          endDigits: toDatePickerDigits(todayIso),
        });
        return reportState.id;
      });

    const bueroReportId =
      await test.step('Büro-Erfassung: der Anruf um 7 Uhr wird mit halbem Tag und Nachweispflicht erfasst; die betroffene Person sieht es transparent', async () => {
        // The admin records the phone-call-in for the Büro member: retroactive
        // single half day, neutral type label, evidence explicitly required (the
        // organization's own choice — no rule engine, no legal claim).
        const expectOverlap = await hasApprovedVacationIntersecting(
          world.orgId,
          bueroRecord.id,
          yesterdayIso,
          yesterdayIso,
        );
        await openMemberDetailFromList(adminPage, bueroName);
        await recordSicknessForMemberViaSection(adminPage, {
          startDigits: toDatePickerDigits(yesterdayIso),
          endDigits: toDatePickerDigits(yesterdayIso),
          halfDay: true,
          type: 'kind_krank',
          evidenceRequired: true,
          expectVacationOverlapHint: expectOverlap,
        });

        const reportState = await getLatestSicknessReportState(world.orgId, bueroRecord.id);
        expect(reportState.status).toBe('reported');
        expect(reportState.absenceType).toBe('kind_krank');
        expect(reportState.dayPortion).toBe('half_day');
        expect(reportState.startDate).toBe(yesterdayIso);
        expect(reportState.endDate).toBe(yesterdayIso);
        expect(reportState.evidenceRequired).toBe(true);
        expect(reportState.evidenceStatus).toBe('pending');
        expect(reportState.eventTypes).toEqual(['reported']);

        // The manager surface shows type and evidence state (the narrow group's
        // view per the privacy matrix).
        await expect(
          visibleText(
            adminPage,
            sicknessReportSummaryText({ type: 'kind_krank', halfDay: true, evidence: 'pending' }),
          ),
        ).toBeVisible({
          timeout: 15_000,
        });

        // The affected person is informed transparently (own-flavored notice),
        // the recording manager is not re-notified of their own action.
        await openAufgaben(bueroPage);
        const bueroRow = attentionNotificationRow(bueroPage, reportState.id);
        await expect(bueroRow).toHaveCount(1, { timeout: 15_000 });
        await expect(bueroRow).toHaveAttribute('data-unread', 'true');
        await expect(bueroRow.getByText(SICKNESS_COPY.recordedForYouNotice)).toBeVisible();
        await markAttentionNotificationReadViaButton(bueroPage, reportState.id);

        await openAufgaben(adminPage);
        await expect(attentionNotificationRow(adminPage, reportState.id)).toHaveCount(0);
        return reportState.id;
      });

    await test.step('Korrekturen bleiben nachvollziehbar: Enddatum, wieder-ungelesene Meldung, Nachweisführung ohne Lärm', async () => {
      // „Ich bin wieder da": the person sets the end date themselves.
      await setOwnSicknessEndDateViaDialog(employeePage, {
        rangeText: openEndedRangeText,
        endDigits: toDatePickerDigits(todayIso),
        expectedRangeText: endedRangeText,
      });
      const afterEnd = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
      expect(afterEnd.id).toBe(reportId);
      expect(afterEnd.endDate).toBe(todayIso);
      expect(afterEnd.eventTypes).toEqual(['reported', 'ended']);

      // The correction re-surfaces the SAME manager notice unread — one row,
      // new version, never a duplicate.
      await openAufgaben(bueroPage);
      const bueroRow = attentionNotificationRow(bueroPage, reportId);
      await expect(bueroRow).toHaveCount(1, { timeout: 15_000 });
      await expect(bueroRow).toHaveAttribute('data-unread', 'true', {
        timeout: 15_000,
      });
      await markAttentionNotificationReadViaButton(bueroPage, reportId);

      // Evidence bookkeeping (state only, no bytes): require → received. The
      // office action is audited but deliberately makes no notification noise.
      await openMemberDetailFromList(adminPage, employeeName);
      await setSicknessEvidenceViaMenu(adminPage, endedRangeText, {
        required: true,
        received: false,
      });
      await expect(
        visibleText(adminPage, sicknessReportSummaryText({ type: 'krankheit', evidence: 'pending' })),
      ).toBeVisible({
        timeout: 15_000,
      });
      await setSicknessEvidenceViaMenu(adminPage, endedRangeText, {
        required: true,
        received: true,
      });
      await expect(
        visibleText(adminPage, sicknessReportSummaryText({ type: 'krankheit', evidence: 'received' })),
      ).toBeVisible({
        timeout: 15_000,
      });

      const afterEvidence = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
      expect(afterEvidence.evidenceRequired).toBe(true);
      expect(afterEvidence.evidenceStatus).toBe('received');
      expect(afterEvidence.eventTypes).toEqual(['reported', 'ended', 'evidence_updated', 'evidence_updated']);

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
            event.sourceId === reportId &&
            event.eventType === 'marked_read',
        ).length,
      ).toBe(2);
    });

    await test.step('Einstempeln trotz Krankmeldung: sichtbarer Hinweis statt Blockade', async () => {
      // Today is still covered by the (now dated) report. A recovered person
      // clocking in early is reality — the action succeeds with a visible
      // notice nudging the end-date correction; the office sees the
      // contradiction on its surface either way.
      await expectClockInNoticeForSickness(employeePage);
      await clockOut(employeePage);
    });

    await test.step('Kolleginnen sehen keine fremde Abwesenheit, nicht einmal neutral', async () => {
      // Which report rows each role can read is a database rule
      // (supabase/tests/people_boundaries.sql). The surface proof: the
      // employee's calendar never shows another person's absence.
      await showCalendarMonth(employeePage);
      await expect(textInDom(employeePage, absenceCalendarLabel(bueroName))).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(textInDom(employeePage, absenceCalendarLabel(adminName))).toHaveCount(0);
    });

    await test.step('Stornierung: die Meldung zählt nicht mehr, beide Betroffenen sehen dieselbe Meldung erneut ungelesen', async () => {
      // The admin (manager, neither reporter nor affected) cancels the
      // employee's report with a required reason — recorded in error / worked
      // after all. The fact stays, traceably terminal.
      await openMemberDetailFromList(adminPage, employeeName);
      await cancelSicknessReportViaMenuWithReason(
        adminPage,
        endedRangeText,
        'Doch gearbeitet – Meldung war ein Versehen',
      );

      const afterCancel = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
      expect(afterCancel.id).toBe(reportId);
      expect(afterCancel.status).toBe('cancelled');
      expect(afterCancel.cancellationReason).toBe('Doch gearbeitet – Meldung war ein Versehen');
      expect(afterCancel.eventTypes).toEqual([
        'reported',
        'ended',
        'evidence_updated',
        'evidence_updated',
        'cancelled',
      ]);
      // The Büro member's own report is untouched by the employee's cancellation.
      expect((await getLatestSicknessReportState(world.orgId, bueroRecord.id)).id).toBe(bueroReportId);

      // The SAME notification re-surfaces unread for the other manager…
      await openAufgaben(bueroPage);
      const bueroRow = attentionNotificationRow(bueroPage, reportId);
      await expect(bueroRow).toHaveCount(1, { timeout: 15_000 });
      await expect(bueroRow).toHaveAttribute('data-unread', 'true', {
        timeout: 15_000,
      });
      await expect(bueroRow.getByText(SICKNESS_COPY.cancelledNoticePrefix)).toBeVisible();

      // …and the affected person now learns of the office action on their own
      // report (transparency: an availability change is always explainable).
      await openAufgaben(employeePage);
      const employeeRow = attentionNotificationRow(employeePage, reportId);
      await expect(employeeRow).toHaveCount(1, { timeout: 15_000 });
      await expect(employeeRow).toHaveAttribute('data-unread', 'true');
      await expect(
        employeeRow.getByText(SICKNESS_COPY.ownCancelledNoticeStart, { exact: false }),
      ).toBeVisible();
      await expect(
        employeeRow.getByText(SICKNESS_COPY.ownCancelledNoticeEnd, { exact: false }),
      ).toBeVisible();
      await markAttentionNotificationReadViaButton(employeePage, reportId);
      const employeePattern = await getAttentionPatternStateForUser(world.orgId, world.users.employee.id);
      expect(
        employeePattern.readStates.some(
          (readState) =>
            readState.sourceType === 'sickness_report' &&
            readState.sourceId === reportId &&
            readState.stateVersion.startsWith('cancelled:'),
        ),
      ).toBe(true);

      // The availability signal is gone from planning.
      await showCalendarMonth(adminPage);
      await expect(textInDom(adminPage, absenceCalendarLabel(employeeName))).toHaveCount(0, {
        timeout: 15_000,
      });
    });
  });
});
