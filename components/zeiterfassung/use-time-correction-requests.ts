'use client';

import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import type { useBusyIds } from '@/hooks/use-busy-id';
import {
  resubmitTimeCorrection,
  reviewTimeCorrection,
  reviewTimeCorrectionsBatch,
  withdrawTimeCorrection,
} from '@/lib/time-corrections/actions';
import type { TimeCorrectionRequest } from '@/lib/time-corrections/types';

// The area's own sentences; describeFailure adds the shared ones
// (invalid_input, period_closed, ...) from lib/action-messages.ts.
const CORRECTION_REVIEW_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  comment_required: 'Bitte gib für Rückfrage oder Ablehnung einen Kommentar an.',
};

type TimeCorrectionRequestActionsInput = {
  view: { invalidate: () => void; refresh: () => Promise<void> };
  list: { remove: (id: string) => void; rollback: (id: string) => void };
  busy: Pick<ReturnType<typeof useBusyIds>, 'run'>;
  comments: Record<string, string>;
  selectedRequests: TimeCorrectionRequest[];
  setSelected: (selected: Set<string>) => void;
  /** Approval list: a decided request leaves at once instead of settling in place. */
  leavesOnDecision: boolean;
};

type TimeCorrectionRequestActions = {
  review: (request: TimeCorrectionRequest, decision: 'approve' | 'reject' | 'clarify') => Promise<void>;
  withdraw: (request: TimeCorrectionRequest) => Promise<void>;
  resubmit: (request: TimeCorrectionRequest) => Promise<void>;
  reviewBatch: (decision: 'approve' | 'reject') => Promise<void>;
};

// The writes of the correction list: single review, withdraw, resubmit and
// the all-or-nothing batch review, each with its banner and follow-up read.
export function useTimeCorrectionRequestActions({
  view,
  list,
  busy,
  comments,
  selectedRequests,
  setSelected,
  leavesOnDecision,
}: TimeCorrectionRequestActionsInput): TimeCorrectionRequestActions {
  const { showBanner } = useBanner();

  const refresh = async () => {
    setSelected(new Set());
    await view.refresh();
  };

  const review = async (request: TimeCorrectionRequest, decision: 'approve' | 'reject' | 'clarify') => {
    const comment = comments[request.id]?.trim() || null;
    if (decision !== 'approve' && !comment) {
      showBanner({
        variant: 'error',
        message: 'Bitte gib für Rückfrage oder Ablehnung einen Kommentar an.',
      });
      return;
    }
    if (leavesOnDecision) {
      view.invalidate();
      list.remove(request.id);
    }
    await busy.run(request.id, async () => {
      const result = await reviewTimeCorrection({
        requestId: request.id,
        expectedRevision: request.currentRevision,
        decision,
        comment,
        operationId: crypto.randomUUID(),
      }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
      if (!result.success) {
        list.rollback(request.id);
        showBanner({
          variant: 'error',
          message: describeFailure(
            result.error,
            CORRECTION_REVIEW_MESSAGES,
            'Die Entscheidung konnte nicht gespeichert werden.',
          ),
        });
        // A refusal often means the request changed elsewhere; read it again.
        await refresh();
        return;
      }
      showBanner({ variant: 'success', message: 'Die Entscheidung wurde gespeichert.' });
      await refresh();
    });
  };

  const withdraw = (request: TimeCorrectionRequest) =>
    busy.run(request.id, async () => {
      const result = await withdrawTimeCorrection({
        requestId: request.id,
        operationId: crypto.randomUUID(),
      }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
      showBanner(
        result.success
          ? { variant: 'success', message: 'Der Antrag wurde zurückgezogen.' }
          : {
              variant: 'error',
              message: describeFailure(
                result.error,
                CORRECTION_REVIEW_MESSAGES,
                'Der Antrag konnte nicht zurückgezogen werden.',
              ),
            },
      );
      if (result.success) await refresh();
    });

  const resubmit = async (request: TimeCorrectionRequest) => {
    const reason = comments[request.id]?.trim();
    if (!reason) {
      showBanner({ variant: 'error', message: 'Bitte beantworte die Rückfrage.' });
      return;
    }
    await busy.run(request.id, async () => {
      const result = await resubmitTimeCorrection({
        requestId: request.id,
        expectedRevision: request.currentRevision,
        reason,
        operationId: crypto.randomUUID(),
      }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
      showBanner(
        result.success
          ? { variant: 'success', message: 'Die Antwort wurde erneut eingereicht.' }
          : {
              variant: 'error',
              message: describeFailure(
                result.error,
                CORRECTION_REVIEW_MESSAGES,
                'Die Antwort konnte nicht eingereicht werden.',
              ),
            },
      );
      if (result.success) await refresh();
    });
  };

  // One all-or-nothing server call for the whole selection (not per-item
  // progress): the selected cards leave at once and the progress banner
  // resolves into the result; a refusal returns every card with its selection.
  const reviewBatch = async (decision: 'approve' | 'reject') => {
    if (selectedRequests.length === 0) return;
    const batchComment = comments.batch?.trim() || null;
    if (decision === 'reject' && !batchComment) {
      showBanner({ variant: 'error', message: 'Bitte gib einen Ablehnungsgrund an.' });
      return;
    }
    const count = selectedRequests.length;
    showBanner({
      variant: 'progress',
      message: `${count} ${count === 1 ? 'Antrag wird' : 'Anträge werden'} bearbeitet …`,
    });
    const batch = selectedRequests;
    view.invalidate();
    for (const request of batch) list.remove(request.id);
    const result = await reviewTimeCorrectionsBatch({
      requests: batch.map((request) => ({
        requestId: request.id,
        expectedRevision: request.currentRevision,
      })),
      decision,
      comment: batchComment,
    }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
    if (!result.success) {
      for (const request of batch) list.rollback(request.id);
      showBanner({ variant: 'error', message: 'Kein Antrag wurde geändert. Die Liste wurde neu geladen.' });
      await view.refresh();
      return;
    }
    showBanner({
      variant: 'success',
      message: count === 1 ? '1 Antrag wurde bearbeitet.' : `${count} Anträge wurden gemeinsam bearbeitet.`,
    });
    await refresh();
  };

  return { review, withdraw, resubmit, reviewBatch };
}
