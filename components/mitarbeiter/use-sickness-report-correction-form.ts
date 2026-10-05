'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { correctSicknessReport } from '@/lib/sickness/actions';
import { SICKNESS_ERROR_MESSAGES, type SicknessAbsenceType, type SicknessReport } from '@/lib/sickness/types';
import { logError } from '@/lib/logging';

export type SicknessReportCorrectionForm = ReturnType<typeof useSicknessReportCorrectionForm>;

export function useSicknessReportCorrectionForm(report: SicknessReport, onClose: (saved: boolean) => void) {
  const { showBanner } = useBanner();
  const [absenceType, setAbsenceType] = useState<SicknessAbsenceType>(report.absenceType);
  const [startDate, setStartDate] = useState<string>(report.startDate);
  const [endKnown, setEndKnown] = useState(report.endDate !== null);
  const [endDate, setEndDate] = useState<string>(report.endDate ?? report.startDate);
  const [halfDay, setHalfDay] = useState(report.dayPortion === 'half_day');
  const [reason, setReason] = useState('');
  const { run: runSave, isPending: isSaving } = useServerAction(correctSicknessReport);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    start?: string | undefined;
    end?: string | undefined;
    reason?: string | undefined;
  }>({});

  const isSingleDay = endKnown && startDate === endDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    const nextFieldErrors = {
      start: startDate ? undefined : 'Bitte wähle ein Datum aus.',
      end: endKnown && !endDate ? 'Bitte wähle ein Datum aus.' : undefined,
      reason: reason.trim() ? undefined : 'Bitte gib einen Grund für die Korrektur an.',
    };
    setFieldErrors(nextFieldErrors);
    const firstInvalidId = nextFieldErrors.start
      ? 'correct-sickness-start'
      : nextFieldErrors.end
        ? 'correct-sickness-end'
        : nextFieldErrors.reason
          ? 'correct-sickness-reason'
          : null;
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return;
    }

    try {
      const result = await runSave({
        reportId: report.id,
        absenceType,
        startDate,
        endDate: endKnown ? endDate : null,
        dayPortion: halfDay && isSingleDay ? 'half_day' : 'full',
        reason: reason.trim(),
      });
      if (result.success) {
        showBanner({
          variant: 'success',
          message: 'Die Krankmeldung wurde korrigiert.',
        });
        onClose(true);
      } else {
        setError(
          describeFailure(
            result.error,
            SICKNESS_ERROR_MESSAGES,
            'Die Korrektur konnte nicht gespeichert werden.',
          ),
        );
      }
    } catch (submitError) {
      logError('Error correcting sickness report:', submitError);
      setError('Die Korrektur konnte nicht gespeichert werden.');
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
    reason,
    setReason,
    isSaving,
    error,
    fieldErrors,
    isSingleDay,
    handleSubmit,
  };
}
