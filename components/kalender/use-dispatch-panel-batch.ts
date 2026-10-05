'use client';

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import { REASON_MIN_8_MESSAGE } from '@/lib/ui/field-validation';
import type { useBanner } from '@/components/ui/banner';
import { batchReschedule, previewBatchReschedule, type BatchPreviewItem } from '@/lib/dispatch/actions';
import {
  dispatchErrorMessage,
  type DispatchOverview,
  type DispatchOverviewOccurrence,
} from '@/lib/dispatch/types';
import type { usePlanningWarningConfirmation } from './planning-warning-dialog';

export type DispatchPanelBatchPreview = {
  itemCount: number;
  items: BatchPreviewItem[];
  commitmentMismatchTitles: string[];
  invalidatedAcknowledgementCount: number;
  conflictCount: number;
};

export type DispatchPanelBatch = {
  batchMode: boolean;
  toggleBatchMode: () => void;
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  eligibleForBatch: DispatchOverviewOccurrence[];
  dayShiftText: string;
  setDayShiftText: Dispatch<SetStateAction<string>>;
  newTime: string;
  setNewTime: Dispatch<SetStateAction<string>>;
  batchReason: string;
  setBatchReason: Dispatch<SetStateAction<string>>;
  batchPreview: DispatchPanelBatchPreview | null;
  setBatchPreview: Dispatch<SetStateAction<DispatchPanelBatchPreview | null>>;
  isBatchWorking: boolean;
  batchError: string | null;
  batchAttempted: boolean;
  setBatchAttempted: Dispatch<SetStateAction<boolean>>;
  batchFieldErrors: {
    'batch-day-shift': string | undefined;
    'batch-reason': string | undefined;
  };
  runBatchPreview: () => Promise<void>;
  runBatchCommit: () => Promise<void>;
};

/** Batch rescheduling of the dispatch panel: selection, inputs, server preview and commit. */
export function useDispatchPanelBatch({
  overview,
  today,
  requestApproval,
  afterMutation,
  showBanner,
}: {
  overview: DispatchOverview | null;
  today: string;
  requestApproval: ReturnType<typeof usePlanningWarningConfirmation>['requestApproval'];
  afterMutation: () => Promise<void>;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
}): DispatchPanelBatch {
  // Batch rescheduling. batchNow is snapshotted when batch mode starts so the
  // eligibility memo stays pure during render; the RPC re-validates anyway.
  const [batchMode, setBatchMode] = useState(false);
  const [batchNow, setBatchNow] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dayShiftText, setDayShiftText] = useState('1');
  const [newTime, setNewTime] = useState('');
  const [batchReason, setBatchReason] = useState('');
  const [batchPreview, setBatchPreview] = useState<DispatchPanelBatchPreview | null>(null);
  const [isBatchWorking, setIsBatchWorking] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  const eligibleForBatch = useMemo(
    () =>
      (overview?.occurrences ?? []).filter((entry) => {
        const startMs = entry.startAt ? new Date(entry.startAt).getTime() : null;
        return startMs !== null ? startMs > batchNow : Boolean(entry.startDate && entry.startDate > today);
      }),
    [overview, today, batchNow],
  );

  const [batchAttempted, setBatchAttempted] = useState(false);
  const batchFieldErrors = {
    'batch-day-shift':
      dayShiftText.trim() === '' || !Number.isInteger(Number(dayShiftText))
        ? 'Bitte gib eine ganze Zahl an Tagen an.'
        : Number(dayShiftText) === 0 && newTime === ''
          ? 'Gib eine Verschiebung in Tagen oder eine neue Uhrzeit an.'
          : undefined,
    'batch-reason': batchReason.trim().length < 8 ? REASON_MIN_8_MESSAGE : undefined,
  };

  // A rejected Server Action reports the unexpected error and frees the panel's buttons.
  const runBatchPreview = useCallback(async () => {
    const dayShift = Number(dayShiftText);
    setBatchError(null);
    setIsBatchWorking(true);
    try {
      const result = await previewBatchReschedule({
        occurrenceIds: [...selectedIds],
        dayShift,
        newTime: newTime || null,
      });
      if (!result.success) {
        setBatchError(dispatchErrorMessage(result.error));
        return;
      }
      setBatchPreview({
        itemCount: result.itemCount,
        items: result.items,
        commitmentMismatchTitles: result.commitmentMismatchTitles,
        invalidatedAcknowledgementCount: result.invalidatedAcknowledgementCount,
        conflictCount: result.conflicts.length,
      });
    } catch {
      setBatchError(dispatchErrorMessage('unexpected_error'));
    } finally {
      setIsBatchWorking(false);
    }
  }, [dayShiftText, newTime, selectedIds]);

  const commitBatch = useCallback(async (): Promise<boolean> => {
    const baseInput = {
      occurrenceIds: [...selectedIds],
      dayShift: Number(dayShiftText),
      newTime: newTime || null,
      reason: batchReason.trim(),
      requestId: crypto.randomUUID(),
    };
    let result = await batchReschedule({
      ...baseInput,
      overrideReason: null,
      assessmentFingerprint: null,
    });
    if (
      !result.success &&
      result.error === 'planning_warning' &&
      'conflicts' in result &&
      result.conflicts &&
      'fingerprint' in result &&
      result.fingerprint
    ) {
      const approval = await requestApproval(result.conflicts, result.fingerprint);
      if (!approval) return false;
      result = await batchReschedule({
        ...baseInput,
        overrideReason: approval.reason,
        assessmentFingerprint: approval.fingerprint,
      });
    }
    if (!result.success) {
      setBatchError(dispatchErrorMessage(result.error));
      return false;
    }
    return true;
  }, [dayShiftText, newTime, selectedIds, batchReason, requestApproval]);

  const runBatchCommit = useCallback(async () => {
    setIsBatchWorking(true);
    setBatchError(null);
    let committed = false;
    try {
      committed = await commitBatch();
    } catch {
      setBatchError(dispatchErrorMessage('unexpected_error'));
    } finally {
      setIsBatchWorking(false);
    }
    if (!committed) return;
    const movedCount = selectedIds.size;
    setBatchPreview(null);
    setBatchMode(false);
    setSelectedIds(new Set());
    setBatchReason('');
    showBanner({
      variant: 'success',
      message: movedCount === 1 ? 'Der Besuch wurde verschoben.' : `${movedCount} Besuche wurden verschoben.`,
    });
    await afterMutation();
  }, [commitBatch, selectedIds, afterMutation, showBanner]);

  const toggleBatchMode = () => {
    setBatchNow(Date.now());
    setBatchMode((value) => !value);
    setSelectedIds(new Set());
    setBatchPreview(null);
  };

  return {
    batchMode,
    toggleBatchMode,
    selectedIds,
    setSelectedIds,
    eligibleForBatch,
    dayShiftText,
    setDayShiftText,
    newTime,
    setNewTime,
    batchReason,
    setBatchReason,
    batchPreview,
    setBatchPreview,
    isBatchWorking,
    batchError,
    batchAttempted,
    setBatchAttempted,
    batchFieldErrors,
    runBatchPreview,
    runBatchCommit,
  };
}
