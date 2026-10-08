'use client';

import { useState } from 'react';
import { Palmtree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type { ApproverVacationRequest } from '@/lib/vacation/actions';
import { readInBackground } from '@/lib/data/background-read-client';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { useVacationApprovalDecisions } from './use-vacation-approvals';
import { VacationApprovalApprovedList, VacationApprovalPendingCard } from './vacation-approvals-cards';

const EMPTY_REQUESTS: ApproverVacationRequest[] = [];
const getVacationRequestId = (item: ApproverVacationRequest) => item.request.id;

type ApproverVacationLists = {
  pending: ApproverVacationRequest[];
  approved: ApproverVacationRequest[];
};

async function readApproverVacationLists(
  signal: AbortSignal,
): Promise<LiveViewResult<ApproverVacationLists>> {
  const [pendingResult, approvedResult] = await Promise.all([
    readInBackground('pending-vacation-for-approver', {}, signal),
    readInBackground('decidable-approved-vacation', {}, signal),
  ]);
  if (!pendingResult.success || !approvedResult.success) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      pending: pendingResult.requests,
      approved: approvedResult.requests,
    },
  };
}

export function VacationApprovals() {
  // Guards a second decision on the same request while its write runs.
  const busy = useBusyIds();

  const view = useLiveView<ApproverVacationLists>({
    tables: ['vacation_requests'],
    read: ({ signal }) => readApproverVacationLists(signal),
  });

  // A decided request leaves its list at once; the overlay expires when the
  // authoritative read no longer carries it and rolls back on a refusal.
  const pendingList = useOptimisticList({
    items: view.data?.pending ?? EMPTY_REQUESTS,
    getId: getVacationRequestId,
  });
  const approvedList = useOptimisticList({
    items: view.data?.approved ?? EMPTY_REQUESTS,
    getId: getVacationRequestId,
  });
  const pending = pendingList.items.map((row) => row.item);
  const approved = approvedList.items.map((row) => row.item);
  const isLoading = view.isLoading;
  // Keep last-known data on transient failures; only an initial load that
  // never produced data shows the visible failure state.
  const loadFailed = !isLoading && view.data === undefined;

  const {
    actionError,
    reasonDialog,
    setReasonDialog,
    dialogError,
    setDialogError,
    handleApprove,
    handleReasonSubmit,
  } = useVacationApprovalDecisions({ view, busy, pendingList, approvedList });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  // A failed initial load must be visible, never an empty screen.
  if (loadFailed && pending.length === 0 && approved.length === 0) {
    return (
      <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
        Die Urlaubsanträge konnten nicht geladen werden.
      </SectionError>
    );
  }

  // The section may only disappear when nothing is in progress: an open
  // decision dialog must never be unmounted by a background refresh that
  // empties the lists (the user would lose their in-progress reason mid-typing
  // and the pending server action), and an action error must stay readable so
  // the user understands why a card vanished.
  if (pending.length === 0 && approved.length === 0 && !actionError && reasonDialog.mode === 'closed') {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground">
        <Palmtree className="size-4" />
        Urlaubsanträge
      </h3>

      <ErrorText className="px-1">{actionError}</ErrorText>

      {pending.map((item) => (
        <VacationApprovalPendingCard
          key={item.request.id}
          item={item}
          busy={busy}
          setReasonDialog={setReasonDialog}
          handleApprove={handleApprove}
        />
      ))}

      {approved.length > 0 && (
        <VacationApprovalApprovedList approved={approved} busy={busy} setReasonDialog={setReasonDialog} />
      )}

      {reasonDialog.mode !== 'closed' && (
        <ReasonDialog
          title={reasonDialog.mode === 'reject' ? 'Urlaubsantrag ablehnen' : 'Genehmigten Urlaub stornieren'}
          description={
            reasonDialog.mode === 'reject'
              ? `Der Antrag von ${reasonDialog.item.personName} wird mit Begründung abgelehnt.`
              : `Die Stornierung stellt die verbrauchten Urlaubstage von ${reasonDialog.item.personName} nachvollziehbar wieder her.`
          }
          confirmLabel={reasonDialog.mode === 'reject' ? 'Ablehnen' : 'Stornieren'}
          isBusy={busy.isBusy(reasonDialog.item.request.id)}
          submitError={dialogError}
          onConfirm={handleReasonSubmit}
          onClose={() => {
            setDialogError(null);
            setReasonDialog({ mode: 'closed' });
          }}
        />
      )}
    </div>
  );
}

function ReasonDialog({
  title,
  description,
  confirmLabel,
  isBusy,
  submitError,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  isBusy: boolean;
  submitError: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Bitte gib einen Grund an.');
      document.getElementById('vacation-decision-reason')?.focus();
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isBusy}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <Field label="Grund" htmlFor="vacation-decision-reason" required error={error}>
              <Textarea
                value={reason}
                onChange={(e) => {
                  setError(null);
                  setReason(e.target.value);
                }}
                disabled={isBusy}
              />
            </Field>
          </div>
          <ErrorText className="pb-3">{submitError}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
              Abbrechen
            </Button>
            <Button pending={isBusy} type="submit" disabled={isBusy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
