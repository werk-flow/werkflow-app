'use client';

import { useCallback, useState } from 'react';

import type { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { calendarRefusalMessage } from '@/lib/calendar/messages';
import { extendPlanningSeriesHorizon } from '@/lib/planning/actions';
import type { PlanningConflict } from '@/lib/planning/types';
import { focusFirstInvalidField, REASON_MIN_8_MESSAGE } from '@/lib/ui/field-validation';

const EXTEND_REASON_FIELD_ID = 'planning-extend-reason';

interface PlanningSeriesExtensionOptions {
  seriesId: string | null | undefined;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  onSuccess: (() => void) | undefined;
}

/**
 * The series extension of the occurrence edit dialog: its pending state, its
 * own planning warnings and the reason a warned extension needs. The dialog
 * calls `resetSeriesExtension` when it opens.
 */
export function usePlanningSeriesExtension({
  seriesId,
  showBanner,
  onSuccess,
}: PlanningSeriesExtensionOptions) {
  const { run: runExtend, isPending: extending } = useServerAction(extendPlanningSeriesHorizon);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [extendConflicts, setExtendConflicts] = useState<PlanningConflict[]>([]);
  const [extendFingerprint, setExtendFingerprint] = useState<string | null>(null);
  const [extendReason, setExtendReason] = useState('');
  const [extendAttempted, setExtendAttempted] = useState(false);
  const extendReasonMissing = extendConflicts.length > 0 && extendReason.trim().length < 8;
  const extendReasonError = extendAttempted && extendReasonMissing ? REASON_MIN_8_MESSAGE : undefined;
  const resetSeriesExtension = useCallback(() => {
    setExtendAttempted(false);
    setExtendError(null);
    setExtendConflicts([]);
    setExtendFingerprint(null);
    setExtendReason('');
  }, []);

  // P1-11-F02: one click extends the series horizon by six months at a time.
  // The extension re-checks capacity/qualification like any other planning and
  // demands a fresh decision when the facts changed since the shown warning.
  async function handleExtendSeries() {
    if (!seriesId) return;
    if (extendReasonMissing) {
      setExtendAttempted(true);
      focusFirstInvalidField({ [EXTEND_REASON_FIELD_ID]: REASON_MIN_8_MESSAGE });
      return;
    }
    setExtendError(null);
    try {
      const result = await runExtend(
        seriesId,
        extendConflicts.length > 0
          ? {
              assessmentFingerprint: extendFingerprint,
              overrideReason: extendReason.trim(),
            }
          : undefined,
      );
      if (result.success) {
        if (result.occurrenceIds.length === 0) {
          showBanner({
            variant: 'info',
            message: 'Die Serie ist bereits bis zu ihrem Ende geplant.',
          });
          return;
        }
        showBanner({
          variant: 'success',
          message: `Serie wurde um sechs Monate verlängert (${result.occurrenceIds.length} neue Termine).`,
        });
        setExtendConflicts([]);
        setExtendFingerprint(null);
        setExtendReason('');
        setExtendAttempted(false);
        onSuccess?.();
        return;
      }
      if (
        (result.error === 'planning_warning' || result.error === 'stale_assessment') &&
        result.conflicts &&
        result.fingerprint
      ) {
        setExtendConflicts(result.conflicts);
        setExtendFingerprint(result.fingerprint);
        if (result.error === 'stale_assessment') {
          showBanner({
            variant: 'info',
            message: 'Die Planungslage hat sich geändert. Bitte erneut prüfen.',
          });
        }
        return;
      }
      setExtendError(calendarRefusalMessage(result.error) ?? 'Die Serie konnte nicht verlängert werden.');
    } catch {
      setExtendError('Die Serie konnte nicht verlängert werden.');
    }
  }

  return {
    extending,
    extendError,
    extendConflicts,
    extendReason,
    extendReasonError,
    setExtendReason,
    handleExtendSeries,
    resetSeriesExtension,
  };
}
