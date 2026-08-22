'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Palmtree, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  cancelApprovedVacationRequest,
  decideVacationRequest,
  getDecidableApprovedVacationRequests,
  getPendingVacationRequestsForApprover,
  type ApproverVacationRequest,
} from '@/lib/vacation/actions';
import { formatVacationDays } from '@/lib/vacation/balance';
import { VACATION_PORTION_LABELS } from '@/lib/vacation/types';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

const DECISION_ERROR_MESSAGES: Record<string, string> = {
  self_approval_not_allowed:
    'Eigene Urlaubsanträge können nicht selbst freigegeben werden.',
  not_responsible:
    'Du bist für diese Urlaubsfreigabe nicht mehr verantwortlich. Die Ansicht wurde aktualisiert.',
  responsibility_load_failed:
    'Die aktuelle Freigabeverantwortung konnte nicht geprüft werden. Bitte versuche es erneut.',
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

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDate(startDate);
  return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

type ReasonDialogState =
  | { mode: 'closed' }
  | { mode: 'reject'; item: ApproverVacationRequest }
  | { mode: 'cancel'; item: ApproverVacationRequest };

export function VacationApprovals() {
  const [pending, setPending] = useState<ApproverVacationRequest[]>([]);
  const [approved, setApproved] = useState<ApproverVacationRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [reasonDialog, setReasonDialog] = useState<ReasonDialogState>({
    mode: 'closed',
  });
  const generationRef = useRef(0);

  const hasDataRef = useRef(false);
  const refetch = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const [pendingResult, approvedResult] = await Promise.all([
        getPendingVacationRequestsForApprover(),
        getDecidableApprovedVacationRequests(),
      ]);
      if (generation !== generationRef.current) return;
      // Keep last-known data on transient failures; only an initial load
      // that yields nothing shows the visible failure state.
      if (pendingResult.success) setPending(pendingResult.requests);
      if (approvedResult.success) setApproved(approvedResult.requests);
      if (pendingResult.success && approvedResult.success) {
        hasDataRef.current = true;
        setLoadFailed(false);
      } else if (!hasDataRef.current) {
        setLoadFailed(true);
      }
    } catch (error) {
      console.error('Error fetching vacation approvals:', error);
      if (generation === generationRef.current && !hasDataRef.current) {
        setLoadFailed(true);
      }
    } finally {
      if (generation === generationRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRealtimeEvent('vacation_requests', () => {
    void refetch();
  });

  // One failure, one surface: the section-level error survives the follow-up
  // refetch even when the acted-on card disappears (the section deliberately
  // stays mounted while an actionError is set).
  const reportActionError = useCallback((error: string, fallback: string) => {
    setActionError(DECISION_ERROR_MESSAGES[error] ?? fallback);
  }, []);

  const handleApprove = async (item: ApproverVacationRequest) => {
    if (busyRequestId) return;
    setActionError(null);
    setBusyRequestId(item.request.id);
    try {
      const result = await decideVacationRequest({
        requestId: item.request.id,
        decision: 'approve',
      });
      if (!result.success) {
        reportActionError(
          result.error,
          'Die Freigabe konnte nicht gespeichert werden.'
        );
      }
    } catch (error) {
      console.error('Error approving vacation request:', error);
      reportActionError(
        'unexpected_error',
        'Die Freigabe konnte nicht gespeichert werden.'
      );
    } finally {
      setBusyRequestId(null);
    }
    await refetch();
  };

  const handleReasonSubmit = async (reason: string) => {
    if (reasonDialog.mode === 'closed') return;
    const { item } = reasonDialog;
    setActionError(null);
    setBusyRequestId(item.request.id);
    try {
      const result =
        reasonDialog.mode === 'reject'
          ? await decideVacationRequest({
              requestId: item.request.id,
              decision: 'reject',
              comment: reason,
            })
          : await cancelApprovedVacationRequest({
              requestId: item.request.id,
              reason,
            });
      if (!result.success) {
        reportActionError(
          result.error,
          'Die Entscheidung konnte nicht gespeichert werden.'
        );
      }
    } catch (error) {
      console.error('Error deciding vacation request:', error);
      reportActionError(
        'unexpected_error',
        'Die Entscheidung konnte nicht gespeichert werden.'
      );
    } finally {
      setBusyRequestId(null);
    }
    setReasonDialog({ mode: 'closed' });
    await refetch();
  };

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
      <p role="alert" className="px-1 text-sm text-muted-foreground">
        Die Urlaubsanträge konnten nicht geladen werden.
      </p>
    );
  }

  // The section may only disappear when nothing is in progress: an open
  // decision dialog must never be unmounted by a background refresh that
  // empties the lists (the user would lose their in-progress reason mid-typing
  // and the pending server action), and an action error must stay readable so
  // the user understands why a card vanished.
  if (
    pending.length === 0 &&
    approved.length === 0 &&
    !actionError &&
    reasonDialog.mode === 'closed'
  ) {
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
        <Card key={item.request.id} data-vacation-request={item.request.id}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{item.personName}</p>
                <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                  {formatRange(item.request.startDate, item.request.endDate)}
                  {` · ${VACATION_PORTION_LABELS[item.request.dayPortion]}`}
                  {` · ${formatVacationDays(item.totalDays)}`}
                </p>
                {item.balance ? (
                  item.balance.entitlementDays !== null ? (
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      Resturlaub {item.balance.year}:{' '}
                      {formatVacationDays(item.balance.remainingDays ?? 0)} von{' '}
                      {formatVacationDays(item.balance.entitlementDays)}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-300">
                      Kein Urlaubsanspruch hinterlegt – Anspruch in der
                      Personalakte unter Beschäftigung pflegen.
                    </p>
                  )
                ) : null}
                {item.request.comment && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Notiz: {item.request.comment}
                  </p>
                )}
                {item.hasAbsenceOverlap && (
                  <p className="mt-1 text-xs font-medium text-yellow-700 dark:text-yellow-300">
                    Hinweis: Für diese Person liegt im beantragten Zeitraum eine
                    weitere Abwesenheit vor.
                  </p>
                )}
                {item.assignedJobsInRange.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Im Zeitraum eingeplant:{' '}
                    {item.assignedJobsInRange
                      .map(
                        (job) => `${job.title} (${formatDate(job.plannedDate)})`
                      )
                      .join(', ')}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setReasonDialog({ mode: 'reject', item })}
                  disabled={busyRequestId !== null}
                  aria-label={`Urlaubsantrag von ${item.personName} ablehnen`}
                >
                  <X className="size-3.5" />
                  Ablehnen
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handleApprove(item)}
                  disabled={busyRequestId !== null}
                  aria-label={`Urlaubsantrag von ${item.personName} genehmigen`}
                >
                  {busyRequestId === item.request.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Genehmigen
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {approved.length > 0 && (
        <div className="space-y-2">
          <h4 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Genehmigter Urlaub
          </h4>
          {approved.map((item) => (
            <Card key={item.request.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.personName}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatRange(item.request.startDate, item.request.endDate)}
                    {` · ${formatVacationDays(item.totalDays)}`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setReasonDialog({ mode: 'cancel', item })}
                  disabled={busyRequestId !== null}
                  aria-label={`Genehmigten Urlaub von ${item.personName} stornieren`}
                >
                  <Undo2 className="size-3.5" />
                  Stornieren
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {reasonDialog.mode !== 'closed' && (
        <ReasonDialog
          title={
            reasonDialog.mode === 'reject'
              ? 'Urlaubsantrag ablehnen'
              : 'Genehmigten Urlaub stornieren'
          }
          description={
            reasonDialog.mode === 'reject'
              ? `Der Antrag von ${reasonDialog.item.personName} wird mit Begründung abgelehnt.`
              : `Die Stornierung stellt die verbrauchten Urlaubstage von ${reasonDialog.item.personName} nachvollziehbar wieder her.`
          }
          confirmLabel={
            reasonDialog.mode === 'reject' ? 'Ablehnen' : 'Stornieren'
          }
          isBusy={busyRequestId !== null}
          onConfirm={handleReasonSubmit}
          onClose={() => setReasonDialog({ mode: 'closed' })}
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
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  isBusy: boolean;
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
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isBusy && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="vacation-decision-reason">Grund</Label>
              <Textarea
                id="vacation-decision-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isBusy}
              />
            </div>
            <ErrorText>{error}</ErrorText>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isBusy}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isBusy}>
              {isBusy && <Loader2 className="size-4 animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
