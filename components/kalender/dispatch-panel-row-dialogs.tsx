'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';

import { cancelDispatch as cancelDispatchAction, resolveDispatchChallenge } from '@/lib/dispatch/actions';
import { dispatchErrorMessage, type DispatchOverviewOccurrence } from '@/lib/dispatch/types';
import { withdrawCustomerCommitment } from '@/lib/commitments/actions';
import { commitmentErrorMessage } from '@/lib/commitments/types';
import { DispatchIssueDialog } from './dispatch-issue-dialog';
import { CommitmentDialog } from './dispatch-panel-commitment-dialog';
import { ReasonDialog } from './dispatch-panel-reason-dialog';

type IssueTarget = { occurrenceId: string };
type WithdrawCommitmentTarget = { commitmentId: string; rowKey: string };
type CancelDispatchTarget = { dispatchId: string; rowKey: string };

/** Which row dialog of the dispatch panel is open, and for which row. */
export type DispatchPanelRowDialogState = {
  issueTarget: IssueTarget | null;
  setIssueTarget: Dispatch<SetStateAction<IssueTarget | null>>;
  commitmentEntry: DispatchOverviewOccurrence | null;
  setCommitmentEntry: Dispatch<SetStateAction<DispatchOverviewOccurrence | null>>;
  withdrawCommitment: WithdrawCommitmentTarget | null;
  setWithdrawCommitment: Dispatch<SetStateAction<WithdrawCommitmentTarget | null>>;
  resolveChallengeId: string | null;
  setResolveChallengeId: Dispatch<SetStateAction<string | null>>;
  cancelDispatch: CancelDispatchTarget | null;
  setCancelDispatch: Dispatch<SetStateAction<CancelDispatchTarget | null>>;
};

export function useDispatchPanelRowDialogs(): DispatchPanelRowDialogState {
  const [issueTarget, setIssueTarget] = useState<{
    occurrenceId: string;
  } | null>(null);
  const [commitmentEntry, setCommitmentEntry] = useState<DispatchOverviewOccurrence | null>(null);
  const [withdrawCommitment, setWithdrawCommitment] = useState<{
    commitmentId: string;
    rowKey: string;
  } | null>(null);
  const [resolveChallengeId, setResolveChallengeId] = useState<string | null>(null);
  const [cancelDispatch, setCancelDispatch] = useState<{
    dispatchId: string;
    rowKey: string;
  } | null>(null);

  return {
    issueTarget,
    setIssueTarget,
    commitmentEntry,
    setCommitmentEntry,
    withdrawCommitment,
    setWithdrawCommitment,
    resolveChallengeId,
    setResolveChallengeId,
    cancelDispatch,
    setCancelDispatch,
  };
}

type DispatchPanelRowDialogsProps = {
  dialogs: DispatchPanelRowDialogState;
  /** Confirms the persisted action and marks its row until the re-read lands. */
  settleRow: (rowKey: string, message: string) => void;
};

export function DispatchPanelRowDialogs({ dialogs, settleRow }: DispatchPanelRowDialogsProps) {
  const {
    issueTarget,
    setIssueTarget,
    commitmentEntry,
    setCommitmentEntry,
    withdrawCommitment,
    setWithdrawCommitment,
    resolveChallengeId,
    setResolveChallengeId,
    cancelDispatch,
    setCancelDispatch,
  } = dialogs;

  return (
    <>
      {issueTarget && (
        <DispatchIssueDialog
          target={issueTarget}
          onClose={() => setIssueTarget(null)}
          onIssued={() => {
            setIssueTarget(null);
            settleRow(issueTarget.occurrenceId, 'Einsatz wurde gesendet.');
          }}
        />
      )}

      {commitmentEntry && (
        <CommitmentDialog
          entry={commitmentEntry}
          onClose={() => setCommitmentEntry(null)}
          onSaved={() => {
            setCommitmentEntry(null);
            settleRow(commitmentEntry.occurrenceId, 'Kundenzusage wurde erfasst.');
          }}
        />
      )}

      {withdrawCommitment && (
        <ReasonDialog
          title="Kundenzusage zurückziehen"
          description="Die Zusage wird als zurückgezogen dokumentiert. Der Kunde wird dadurch nicht benachrichtigt."
          confirmLabel="Zusage zurückziehen"
          minLength={3}
          onClose={() => setWithdrawCommitment(null)}
          onConfirm={async (reason) => {
            const result = await withdrawCustomerCommitment(withdrawCommitment.commitmentId, reason);
            if (!result.success) return commitmentErrorMessage(result.error);
            setWithdrawCommitment(null);
            settleRow(withdrawCommitment.rowKey, 'Kundenzusage wurde zurückgezogen.');
            return null;
          }}
        />
      )}

      {resolveChallengeId && (
        <ReasonDialog
          title="Plan beibehalten"
          description="Die Rückfrage wird mit Begründung beantwortet; der Einsatz bleibt bestehen und die Person bestätigt erneut."
          confirmLabel="Beibehalten"
          minLength={3}
          onClose={() => setResolveChallengeId(null)}
          onConfirm={async (reason) => {
            const result = await resolveDispatchChallenge(resolveChallengeId, reason);
            if (!result.success) return dispatchErrorMessage(result.error);
            setResolveChallengeId(null);
            settleRow(resolveChallengeId, 'Rückfrage wurde beantwortet, der Plan bleibt bestehen.');
            return null;
          }}
        />
      )}

      {cancelDispatch && (
        <ReasonDialog
          title="Einsatz zurückziehen"
          description="Der Einsatz wird zurückgezogen und verschwindet bei den zugewiesenen Personen. Die Historie bleibt erhalten."
          confirmLabel="Einsatz zurückziehen"
          minLength={3}
          onClose={() => setCancelDispatch(null)}
          onConfirm={async (reason) => {
            const result = await cancelDispatchAction(cancelDispatch.dispatchId, reason);
            if (!result.success) return dispatchErrorMessage(result.error);
            setCancelDispatch(null);
            settleRow(cancelDispatch.rowKey, 'Einsatz wurde zurückgezogen.');
            return null;
          }}
        />
      )}
    </>
  );
}
