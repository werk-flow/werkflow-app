'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { recordSicknessForMember } from '@/lib/sickness/actions';
import { SICKNESS_ERROR_MESSAGES, type SicknessAbsenceType } from '@/lib/sickness/types';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { logError } from '@/lib/logging';

export type SicknessReportRecordForm = ReturnType<typeof useSicknessReportRecordForm>;

export function useSicknessReportRecordForm(recordId: string, onClose: (saved: boolean) => void) {
  const todayIso = getBusinessTodayIso();
  const { showBanner } = useBanner();
  const [absenceType, setAbsenceType] = useState<SicknessAbsenceType>('krankheit');
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endKnown, setEndKnown] = useState(false);
  const [endDate, setEndDate] = useState<string>(todayIso);
  const [halfDay, setHalfDay] = useState(false);
  const [evidenceRequired, setEvidenceRequired] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlapHint, setOverlapHint] = useState(false);
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
    if (nextDateErrors.start || nextDateErrors.end) {
      document
        .getElementById(nextDateErrors.start ? 'record-sickness-start' : 'record-sickness-end')
        ?.focus();
      return;
    }

    setIsSaving(true);
    try {
      const result = await recordSicknessForMember({
        employeeRecordId: recordId,
        absenceType,
        startDate,
        endDate: endKnown ? endDate : null,
        dayPortion: halfDay && isSingleDay ? 'half_day' : 'full',
        evidenceRequired,
      });
      if (result.success) {
        showBanner({
          variant: 'success',
          message: 'Die Krankmeldung wurde erfasst.',
        });
        if (result.vacationOverlap) {
          // Saved; the hint must be acknowledged, never raced by a timer.
          setOverlapHint(true);
        } else {
          onClose(true);
        }
      } else {
        setError(
          describeFailure(
            result.error,
            SICKNESS_ERROR_MESSAGES,
            'Die Meldung konnte nicht gespeichert werden.',
          ),
        );
      }
    } catch (submitError) {
      logError('Error recording sickness:', submitError);
      setError('Die Meldung konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
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
    overlapHint,
    dateErrors,
    isSingleDay,
    handleSubmit,
  };
}
