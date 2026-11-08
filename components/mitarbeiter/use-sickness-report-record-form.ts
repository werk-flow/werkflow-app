'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { recordSicknessForMember } from '@/lib/sickness/actions';
import { SICKNESS_ERROR_MESSAGES, type SicknessAbsenceType, type SicknessReport } from '@/lib/sickness/types';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

export type SicknessReportRecordForm = ReturnType<typeof useSicknessReportRecordForm>;

/** The saved report and whether it overlaps approved vacation. */
export type RecordedSickness = { report: SicknessReport; vacationOverlap: boolean };

type SicknessRecordOutcome = {
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  setRecorded: (recorded: RecordedSickness) => void;
  setError: (error: string | null) => void;
};

/**
 * Confirms a recorded report and keeps the dialog open on what it affects
 * (the visits to rearrange, an overlap with vacation) until the office closes
 * it, never raced by a timer; or shows why it was refused.
 */
function showRecordOutcome(
  result: Awaited<ReturnType<typeof recordSicknessForMember>>,
  { showBanner, setRecorded, setError }: SicknessRecordOutcome,
) {
  if (result.success) {
    showBanner({
      variant: 'success',
      message: 'Die Krankmeldung wurde erfasst.',
    });
    setRecorded({ report: result.report, vacationOverlap: result.vacationOverlap });
  } else {
    setError(
      describeFailure(result.error, SICKNESS_ERROR_MESSAGES, 'Die Meldung konnte nicht gespeichert werden.'),
    );
  }
}

export function useSicknessReportRecordForm(recordId: string) {
  const todayIso = getBusinessTodayIso();
  const { showBanner } = useBanner();
  const [absenceType, setAbsenceType] = useState<SicknessAbsenceType>('krankheit');
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endKnown, setEndKnown] = useState(false);
  const [endDate, setEndDate] = useState<string>(todayIso);
  const [halfDay, setHalfDay] = useState(false);
  const [evidenceRequired, setEvidenceRequired] = useState(false);
  const { run: runSave, isPending: isSaving } = useServerAction(recordSicknessForMember);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<RecordedSickness | null>(null);
  const [dateErrors, setDateErrors] = useState<{ start?: string | undefined; end?: string | undefined }>({});

  const isSingleDay = endKnown && startDate === endDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    const nextDateErrors = {
      start: startDate ? undefined : 'Bitte wähle ein Datum aus.',
      end:
        endKnown && !endDate
          ? 'Bitte wähle ein Datum aus.'
          : endKnown && endDate < startDate
            ? SICKNESS_ERROR_MESSAGES.invalid_range
            : undefined,
    };
    setDateErrors(nextDateErrors);
    const invalid = focusFirstInvalidField({
      'record-sickness-start': nextDateErrors.start,
      'record-sickness-end': nextDateErrors.end,
    });
    if (invalid) return;

    try {
      const result = await runSave({
        employeeRecordId: recordId,
        absenceType,
        startDate,
        endDate: endKnown ? endDate : null,
        dayPortion: halfDay && isSingleDay ? 'half_day' : 'full',
        evidenceRequired,
      });
      showRecordOutcome(result, { showBanner, setRecorded, setError });
    } catch (submitError) {
      logError('Error recording sickness:', submitError);
      setError('Die Meldung konnte nicht gespeichert werden.');
    }
  };

  return {
    absenceType,
    setAbsenceType,
    startDate,
    setStartDate,
    endKnown,
    setEndKnown,
    endDate,
    setEndDate,
    halfDay,
    setHalfDay,
    evidenceRequired,
    setEvidenceRequired,
    isSaving,
    error,
    recorded,
    dateErrors,
    isSingleDay,
    handleSubmit,
  };
}
