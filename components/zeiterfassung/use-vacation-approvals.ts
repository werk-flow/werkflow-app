'use client';

import { useCallback, useState } from 'react';
import {
  cancelApprovedVacationRequest,
  decideVacationRequest,
  type ApproverVacationRequest,
} from '@/lib/vacation/actions';
import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import type { useBusyIds } from '@/hooks/use-busy-id';

// The area's own sentences; describeFailure adds the shared ones
// (invalid_input, period_closed, ...) from lib/action-messages.ts.
const DECISION_ERROR_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  self_approval_not_allowed: 'Eigene Urlaubsanträge können nicht selbst freigegeben werden.',
  not_responsible:
    'Du bist für diese Urlaubsfreigabe nicht mehr verantwortlich. Die Ansicht wurde aktualisiert.',
  reason_required: 'Bitte gib einen Grund an.',
  request_not_pending: 'Der Antrag ist nicht mehr offen.',
  request_not_approved: 'Der Antrag ist nicht mehr genehmigt.',
  request_not_found: 'Der Antrag wurde nicht gefunden.',
  target_not_found: 'Die Person wurde nicht gefunden.',
  not_authenticated: 'Bitte melde dich erneut an.',
  not_a_member: 'Du gehörst dieser Organisation nicht mehr an.',
  load_failed: 'Die Anträge konnten nicht geladen werden.',
  fetch_failed: 'Die Anträge konnten nicht geladen werden.',
  update_failed: 'Die Entscheidung konnte nicht gespeichert werden.',
  unexpected_error: 'Die Entscheidung konnte nicht gespeichert werden.',
};

export type VacationReasonDialogState =
  | { mode: 'closed' }
  | { mode: 'reject'; item: ApproverVacationRequest }
  | { mode: 'cancel'; item: ApproverVacationRequest };

type VacationApprovalOptimisticList = {
  remove: (id: string) => void;
  rollback: (id: string) => void;
};

type VacationApprovalDecisionsInput = {
  view: { invalidate: () => void; refresh: () => Promise<void> };
  busy: Pick<ReturnType<typeof useBusyIds>, 'isBusy' | 'run'>;
  pendingList: VacationApprovalOptimisticList;
  approvedList: VacationApprovalOptimisticList;
};

type VacationApprovalDecisions = {
  actionError: string | null;
  reasonDialog: VacationReasonDialogState;
  setReasonDialog: (state: VacationReasonDialogState) => void;
  dialogError: string | null;
  setDialogError: (error: string | null) => void;
  handleApprove: (item: ApproverVacationRequest) => Promise<void>;
  handleReasonSubmit: (reason: string) => Promise<void>;
};

// The approver's decisions: approve in place, reject or cancel through the
// reason dialog, each with its optimistic removal, banner and follow-up read.
export function useVacationApprovalDecisions({
  view,
  busy,
  pendingList,
  approvedList,
}: VacationApprovalDecisionsInput): VacationApprovalDecisions {
  const { showBanner } = useBanner();
  const [actionError, setActionError] = useState<string | null>(null);
  const [reasonDialog, setReasonDialog] = useState<VacationReasonDialogState>({
    mode: 'closed',
  });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const refetch = view.refresh;

  // One failure, one surface: the section-level error survives the follow-up
  // refetch even when the acted-on card disappears (the section deliberately
  // stays mounted while an actionError is set).
  const reportActionError = useCallback((error: string, fallback: string) => {
    setActionError(describeFailure(error, DECISION_ERROR_MESSAGES, fallback));
  }, []);

  // The card leaves in the first frame. The confirmation appears only after
  // the server accepted the decision; a refusal brings the card back with the
  // reason.
  const handleApprove = async (item: ApproverVacationRequest) => {
    const requestId = item.request.id;
    if (busy.isBusy(requestId)) return;
    setActionError(null);
    view.invalidate();
    pendingList.remove(requestId);
    await busy.run(requestId, async () => {
      const result = await decideVacationRequest({
        requestId,
        decision: 'approve',
      }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
      if (result.success) {
        showBanner({
          variant: 'success',
          message: `Der Urlaubsantrag von ${item.personName} wurde genehmigt.`,
        });
      } else {
        pendingList.rollback(requestId);
        reportActionError(result.error, 'Die Freigabe konnte nicht gespeichert werden.');
      }
      await refetch();
    });
  };

  // A decision with a reason keeps its dialog open and pending until the
  // server answers, so a refused write never discards the typed reason.
  const handleReasonSubmit = async (reason: string) => {
    if (reasonDialog.mode === 'closed') return;
    const { item, mode } = reasonDialog;
    const requestId = item.request.id;
    setDialogError(null);
    await busy.run(requestId, async () => {
      const result = await (
        mode === 'reject'
          ? decideVacationRequest({ requestId, decision: 'reject', comment: reason })
          : cancelApprovedVacationRequest({ requestId, reason })
      ).catch(() => ({ success: false as const, error: 'unexpected_error' }));
      if (!result.success) {
        setDialogError(
          describeFailure(
            result.error,
            DECISION_ERROR_MESSAGES,
            'Die Entscheidung konnte nicht gespeichert werden.',
          ),
        );
        return;
      }
      view.invalidate();
      (mode === 'reject' ? pendingList : approvedList).remove(requestId);
      setReasonDialog({ mode: 'closed' });
      showBanner({
        variant: 'success',
        message:
          mode === 'reject'
            ? `Der Urlaubsantrag von ${item.personName} wurde abgelehnt.`
            : `Der Urlaub von ${item.personName} wurde storniert.`,
      });
      await refetch();
    });
  };

  return {
    actionError,
    reasonDialog,
    setReasonDialog,
    dialogError,
    setDialogError,
    handleApprove,
    handleReasonSubmit,
  };
}
