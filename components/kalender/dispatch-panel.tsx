'use client';

// P1-12: the manager "Einsätze" panel. Calm, dense dispatch coordination:
// which visits are sent, confirmed, challenged, or still undispatched; which
// customer commitments no longer match the plan; explicit batch rescheduling
// with a server-computed preview. No drag gesture here ever sends a message
// or records a commitment silently.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  Loader2,
  Send,
  X,
} from 'lucide-react';

import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Label } from '@/components/ui/label';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TimeInput } from '@/components/ui/time-input';
import {
  batchReschedule,
  cancelDispatch,
  getDispatchOverview,
  previewBatchReschedule,
  resolveDispatchChallenge,
  type BatchPreviewItem,
} from '@/lib/dispatch/actions';
import {
  DISPATCH_RECIPIENT_STATE_LABELS,
  DISPATCH_OVERVIEW_MAX_OFFSET_DAYS,
  dispatchErrorMessage,
  type DispatchOverview,
  type DispatchOverviewOccurrence,
  type DispatchRecipientView,
} from '@/lib/dispatch/types';
import {
  recordCustomerCommitment,
  withdrawCustomerCommitment,
} from '@/lib/commitments/actions';
import {
  COMMITMENT_SOURCE_LABELS,
  commitmentErrorMessage,
  formatCommitmentWindow,
  type CustomerCommitmentSource,
} from '@/lib/commitments/types';
import { DispatchIssueDialog } from './dispatch-issue-dialog';
import { usePlanningWarningConfirmation } from './planning-warning-dialog';

function berlinTodayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// Also formats the batch preview's old/new instants — keep the two surfaces
// visually identical so the preview reads like the panel rows it moves.
function formatOccurrenceSchedule(entry: {
  startAt: string | null;
  startDate: string | null;
}): string {
  if (entry.startAt) {
    const start = new Date(entry.startAt);
    const dateText = start.toLocaleDateString('de-DE', {
      timeZone: 'Europe/Berlin',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
    const timeText = start.toLocaleTimeString('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${dateText}, ${timeText} Uhr`;
  }
  if (entry.startDate) {
    const [, month, day] = entry.startDate.split('-');
    return `${day}.${month}. (ganztägig)`;
  }
  return 'Ohne Termin';
}

function berlinLocalDateOf(entry: DispatchOverviewOccurrence): string {
  if (entry.startAt) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(entry.startAt));
  }
  return entry.startDate ?? berlinTodayIso();
}

function RecipientChips({
  recipients,
}: {
  recipients: DispatchRecipientView[];
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {recipients.map((recipient) => (
        <span
          key={recipient.employeeRecordId}
          className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]"
          data-recipient-state={recipient.state}
          title={`${recipient.displayName}: ${DISPATCH_RECIPIENT_STATE_LABELS[recipient.state]}${
            recipient.challengeReason ? ` – ${recipient.challengeReason}` : ''
          }`}
        >
          {recipient.displayName} ·{' '}
          {DISPATCH_RECIPIENT_STATE_LABELS[recipient.state]}
        </span>
      ))}
    </div>
  );
}

type CommitmentDialogState = {
  entry: DispatchOverviewOccurrence;
};

function CommitmentDialog({
  entry,
  onClose,
  onSaved,
}: CommitmentDialogState & { onClose: () => void; onSaved: () => void }) {
  const [committedDate, setCommittedDate] = useState<Date | undefined>(() => {
    const iso = berlinLocalDateOf(entry);
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [source, setSource] = useState<CustomerCommitmentSource>('telefonisch');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!committedDate) return;
    setIsSaving(true);
    setError(null);
    const dateIso = `${committedDate.getFullYear()}-${String(committedDate.getMonth() + 1).padStart(2, '0')}-${String(committedDate.getDate()).padStart(2, '0')}`;
    try {
      const result = await recordCustomerCommitment({
        occurrenceId: entry.occurrenceId,
        committedDate: dateIso,
        windowStartTime: windowStart || null,
        windowEndTime: windowEnd || null,
        source,
        contactId: null,
      });
      if (!result.success) {
        setError(commitmentErrorMessage(result.error));
        return;
      }
      onSaved();
    } catch {
      setError(commitmentErrorMessage('unexpected_error'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kundenzusage erfassen</DialogTitle>
          <DialogDescription>
            Dokumentiert eine bereits getroffene Vereinbarung mit dem Kunden.
            Es wird keine Nachricht versendet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="commitment-date">Zugesagter Tag</Label>
            <DatePicker
              id="commitment-date"
              ariaLabel="Zugesagter Tag"
              value={committedDate}
              onChange={setCommittedDate}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="commitment-window-start">
                Zeitfenster von (optional)
              </Label>
              <TimeInput
                id="commitment-window-start"
                value={windowStart}
                onChange={setWindowStart}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="commitment-window-end">bis</Label>
              <TimeInput
                id="commitment-window-end"
                value={windowEnd}
                onChange={setWindowEnd}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="commitment-source">Wie vereinbart?</Label>
            <Select
              value={source}
              onValueChange={(value) =>
                setSource(value as CustomerCommitmentSource)
              }
            >
              <SelectTrigger id="commitment-source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(COMMITMENT_SOURCE_LABELS).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={
                isSaving ||
                !committedDate ||
                (windowStart !== '') !== (windowEnd !== '')
              }
            >
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              Zusage erfassen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({
  title,
  description,
  confirmLabel,
  minLength,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  minLength: number;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const failure = await onConfirm(reason.trim());
      if (failure) setError(failure);
    } catch {
      setError(dispatchErrorMessage('unexpected_error'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleConfirm} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dispatch-reason-dialog">Begründung</Label>
            <Textarea
              id="dispatch-reason-dialog"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">
              Mindestens {minLength} Zeichen.
            </p>
          </div>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={reason.trim().length < minLength || isSaving}
            >
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DispatchPanel({
  onClose,
  onChanged,
  primaryHeaderHeight = 76,
}: {
  onClose: () => void;
  onChanged?: () => void;
  primaryHeaderHeight?: number;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [issueTarget, setIssueTarget] = useState<
    { occurrenceId: string } | { jobId: string } | null
  >(null);
  const [commitmentEntry, setCommitmentEntry] =
    useState<DispatchOverviewOccurrence | null>(null);
  const [withdrawCommitmentId, setWithdrawCommitmentId] = useState<
    string | null
  >(null);
  const [resolveChallengeId, setResolveChallengeId] = useState<string | null>(
    null
  );
  const [cancelDispatchId, setCancelDispatchId] = useState<string | null>(null);

  // Batch rescheduling. batchNow is snapshotted when batch mode starts so the
  // eligibility memo stays pure during render; the RPC re-validates anyway.
  const [batchMode, setBatchMode] = useState(false);
  const [batchNow, setBatchNow] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dayShiftText, setDayShiftText] = useState('1');
  const [newTime, setNewTime] = useState('');
  const [batchReason, setBatchReason] = useState('');
  const [batchPreview, setBatchPreview] = useState<{
    itemCount: number;
    items: BatchPreviewItem[];
    commitmentMismatchTitles: string[];
    invalidatedAcknowledgementCount: number;
    conflictCount: number;
  } | null>(null);
  const [isBatchWorking, setIsBatchWorking] = useState(false);
  const { requestApproval, warningDialog } = usePlanningWarningConfirmation();

  const today = useMemo(() => berlinTodayIso(), []);

  const view = useLiveView<DispatchOverview>({
    tables: [
      'planning_dispatches',
      'planning_dispatch_recipients',
      'planning_dispatch_acknowledgements',
      'planning_customer_commitments',
      'planning_occurrences',
      'planning_occurrence_assignments',
    ],
    read: async (): Promise<LiveViewResult<DispatchOverview>> => {
      const result = await getDispatchOverview(
        today,
        shiftIsoDate(today, DISPATCH_OVERVIEW_MAX_OFFSET_DAYS)
      );
      return result.success
        ? { ok: true, data: result.overview }
        : { ok: false, error: dispatchErrorMessage(result.error) };
    },
  });
  const { refresh } = view;
  const overview = view.data ?? null;
  // A failed initial load must not strand the panel in loading state; later
  // failures keep the last-known overview (the primitive's keep-last-known).
  const loadError =
    view.data === undefined && !view.isLoading
      ? (view.error ?? dispatchErrorMessage('load_failed'))
      : null;

  // Keyboard path for the non-modal panel: Escape closes it — unless an open
  // dialog already consumed the key (Radix prevents default when it handles
  // Escape itself).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus management for the non-modal panel: focus it on open, hand focus
  // back to the toggle on close. No focus trap — the calendar stays usable.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    panelRef.current?.focus();
    return () => {
      const toggle = document.querySelector<HTMLButtonElement>(
        '[data-testid="dispatch-panel-toggle"]'
      );
      toggle?.focus();
    };
  }, []);
  const afterMutation = useCallback(async () => {
    await refresh();
    onChanged?.();
  }, [refresh, onChanged]);

  const eligibleForBatch = useMemo(
    () =>
      (overview?.occurrences ?? []).filter((entry) => {
        const startMs = entry.startAt
          ? new Date(entry.startAt).getTime()
          : null;
        return startMs !== null
          ? startMs > batchNow
          : Boolean(entry.startDate && entry.startDate > today);
      }),
    [overview, today, batchNow]
  );

  const runBatchPreview = useCallback(async () => {
    const dayShift = Number(dayShiftText);
    setActionError(null);
    setIsBatchWorking(true);
    const result = await previewBatchReschedule({
      occurrenceIds: [...selectedIds],
      dayShift,
      newTime: newTime || null,
    });
    setIsBatchWorking(false);
    if (!result.success) {
      setActionError(dispatchErrorMessage(result.error));
      return;
    }
    setBatchPreview({
      itemCount: result.itemCount,
      items: result.items,
      commitmentMismatchTitles: result.commitmentMismatchTitles,
      invalidatedAcknowledgementCount: result.invalidatedAcknowledgementCount,
      conflictCount: result.conflicts.length,
    });
  }, [dayShiftText, newTime, selectedIds]);

  const runBatchCommit = useCallback(async () => {
    const dayShift = Number(dayShiftText);
    setIsBatchWorking(true);
    setActionError(null);
    const baseInput = {
      occurrenceIds: [...selectedIds],
      dayShift,
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
      if (!approval) {
        setIsBatchWorking(false);
        return;
      }
      result = await batchReschedule({
        ...baseInput,
        overrideReason: approval.reason,
        assessmentFingerprint: approval.fingerprint,
      });
    }
    setIsBatchWorking(false);
    if (!result.success) {
      setActionError(dispatchErrorMessage(result.error));
      return;
    }
    setBatchPreview(null);
    setBatchMode(false);
    setSelectedIds(new Set());
    setBatchReason('');
    await afterMutation();
  }, [
    dayShiftText,
    newTime,
    selectedIds,
    batchReason,
    requestApproval,
    afterMutation,
  ]);

  const openChallenges = useMemo(() => {
    if (!overview) return [];
    return [
      ...overview.occurrences.flatMap((entry) =>
        (entry.dispatch?.recipients ?? [])
          .filter((recipient) => recipient.state === 'rueckfrage')
          .map((recipient) => ({ entry, recipient }))
      ),
    ];
  }, [overview]);

  return (
    <div
      ref={panelRef}
      data-dispatch-panel=""
      role="complementary"
      aria-label="Einsätze"
      tabIndex={-1}
      className="fixed right-0 top-0 bottom-0 z-[60] flex w-full max-w-md flex-col border-l bg-background shadow-xl outline-none animate-in slide-in-from-right duration-200"
    >
      <div
        className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6"
        style={{ minHeight: primaryHeaderHeight, height: primaryHeaderHeight }}
      >
        <div className="flex items-center gap-2">
          <Send className="size-5 text-brand-purple" />
          <h2 className="text-base font-semibold">Einsätze</h2>
          {overview && overview.openChallengeCount > 0 && (
            <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
              {overview.openChallengeCount} Rückfrage
              {overview.openChallengeCount === 1 ? '' : 'n'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant={batchMode ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => {
              setBatchNow(Date.now());
              setBatchMode((value) => !value);
              setSelectedIds(new Set());
              setBatchPreview(null);
            }}
          >
            {batchMode ? 'Auswahl beenden' : 'Verschieben'}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Einsätze schließen">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <ErrorText>{loadError}</ErrorText>
        <ErrorText>{actionError}</ErrorText>
        {!overview && !loadError && (
          <div className="space-y-2" role="status" aria-busy="true">
            <span className="sr-only">Einsätze werden geladen …</span>
            <div aria-hidden="true" className="space-y-2">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        )}

        {openChallenges.length > 0 && (
          <section aria-labelledby="dispatch-challenges-heading">
            <h3
              id="dispatch-challenges-heading"
              className="mb-2 text-sm font-medium text-muted-foreground"
            >
              Offene Rückfragen
            </h3>
            <div className="space-y-2">
              {openChallenges.map(({ entry, recipient }) => (
                <div
                  key={`${entry.occurrenceId}:${recipient.employeeRecordId}`}
                  className="rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 py-2"
                >
                  <p className="text-sm font-medium">
                    {recipient.displayName} · {entry.title}
                  </p>
                  {recipient.challengeReason && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {`„${recipient.challengeReason}“`}
                    </p>
                  )}
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setResolveChallengeId(recipient.acknowledgementId)
                      }
                    >
                      Plan beibehalten …
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="dispatch-occurrences-heading">
          <h3
            id="dispatch-occurrences-heading"
            className="mb-2 text-sm font-medium text-muted-foreground"
          >
            Geplante Besuche (nächste {DISPATCH_OVERVIEW_MAX_OFFSET_DAYS} Tage)
          </h3>
          {overview && overview.occurrences.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Keine geplanten Auftragsbesuche im Zeitraum.
            </p>
          )}
          <div className="space-y-2">
            {(overview?.occurrences ?? []).map((entry) => (
              <div
                key={entry.occurrenceId}
                className="rounded-md border px-3 py-2"
                data-dispatch-occurrence={entry.occurrenceId}
              >
                <div className="flex items-start gap-2">
                  {batchMode && (
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedIds.has(entry.occurrenceId)}
                      disabled={
                        !eligibleForBatch.some(
                          (candidate) =>
                            candidate.occurrenceId === entry.occurrenceId
                        )
                      }
                      onCheckedChange={(checked) =>
                        setSelectedIds((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(entry.occurrenceId);
                          else next.delete(entry.occurrenceId);
                          return next;
                        })
                      }
                      aria-label={`${entry.title} für Verschiebung auswählen`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {entry.title}
                      {entry.jobNumber && (
                        <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                          {entry.jobNumber}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatOccurrenceSchedule(entry)}
                      {entry.clientName ? ` · ${entry.clientName}` : ''}
                    </p>
                    {entry.siteName && (
                      <p className="text-xs text-muted-foreground">
                        {entry.siteName}
                        {entry.siteAccessNotes
                          ? ` · ${entry.siteAccessNotes}`
                          : ''}
                      </p>
                    )}
                    {entry.commitment && (
                      <p
                        className={`mt-1 flex items-center gap-1 text-xs ${
                          entry.commitmentMismatch
                            ? 'font-medium text-yellow-700 dark:text-yellow-400'
                            : 'text-muted-foreground'
                        }`}
                        data-commitment-mismatch={
                          entry.commitmentMismatch ? 'true' : 'false'
                        }
                      >
                        {entry.commitmentMismatch ? (
                          <AlertTriangle className="size-3.5 shrink-0" />
                        ) : (
                          <CalendarCheck className="size-3.5 shrink-0" />
                        )}
                        Zusage:{' '}
                        {formatCommitmentWindow({
                          committedDate: entry.commitment.committedDate,
                          windowStartTime: entry.commitment.windowStartTime,
                          windowEndTime: entry.commitment.windowEndTime,
                        })}
                        {entry.commitmentMismatch &&
                          ' – weicht vom Plan ab'}
                      </p>
                    )}
                    {entry.dispatch ? (
                      <RecipientChips recipients={entry.dispatch.recipients} />
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Noch nicht versendet
                      </p>
                    )}
                    {!batchMode && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {!entry.dispatch &&
                          entry.assignedEmployeeRecordIds.length > 0 && (
                            <Button
                              size="sm"
                              onClick={() =>
                                setIssueTarget({
                                  occurrenceId: entry.occurrenceId,
                                })
                              }
                            >
                              <Send className="size-3.5" />
                              Einsatz senden
                            </Button>
                          )}
                        {!entry.dispatch &&
                          entry.assignedEmployeeRecordIds.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              Keine Personen zugewiesen – zuerst im Kalender
                              zuweisen.
                            </p>
                          )}
                        {entry.dispatch && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setCancelDispatchId(
                                entry.dispatch!.dispatchId
                              )
                            }
                          >
                            Einsatz zurückziehen …
                          </Button>
                        )}
                        {entry.commitment ? (
                          <>
                            {entry.commitmentMismatch && (
                              <Button
                                size="sm"
                                onClick={() => setCommitmentEntry(entry)}
                              >
                                Neue Zusage erfassen
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setWithdrawCommitmentId(
                                  entry.commitment!.commitmentId
                                )
                              }
                            >
                              Zusage zurückziehen …
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCommitmentEntry(entry)}
                          >
                            Zusage erfassen
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {overview && overview.unscheduledJobs.length > 0 && (
          <section aria-labelledby="dispatch-unscheduled-heading">
            <h3
              id="dispatch-unscheduled-heading"
              className="mb-2 text-sm font-medium text-muted-foreground"
            >
              Ohne Termin versendet
            </h3>
            <div className="space-y-2">
              {overview.unscheduledJobs.map((entry) => (
                <div
                  key={entry.jobId}
                  className="rounded-md border px-3 py-2"
                  data-dispatch-job={entry.jobId}
                >
                  <p className="truncate text-sm font-medium">
                    {entry.title}
                    {entry.jobNumber && (
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                        {entry.jobNumber}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.clientName ?? 'Ohne Kunde'} · ohne festen Termin
                  </p>
                  <RecipientChips recipients={entry.dispatch.recipients} />
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCancelDispatchId(entry.dispatch.dispatchId)
                      }
                    >
                      Einsatz zurückziehen …
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {overview && overview.travelNotes.length > 0 && (
          <section aria-labelledby="dispatch-travel-heading">
            <h3
              id="dispatch-travel-heading"
              className="mb-2 text-sm font-medium text-muted-foreground"
            >
              Fahrzeit-Hinweise
            </h3>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {overview.travelNotes.map((note, index) => (
                <li
                  key={index}
                  className={
                    note.kind === 'no_gap_different_sites'
                      ? 'text-yellow-700 dark:text-yellow-400'
                      : undefined
                  }
                >
                  {note.kind === 'no_gap_different_sites'
                    ? `${note.employeeName}: keine Zeit zwischen „${note.previousTitle}“ und „${note.nextTitle}“ an unterschiedlichen Orten (${note.localDate.split('-').reverse().join('.')}).`
                    : `${note.employeeName}: ${note.gapMinutes} Min. zwischen „${note.previousTitle}“ und „${note.nextTitle}“ – Fahrzeit nicht bewertet.`}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {batchMode && (
        <div className="shrink-0 space-y-3 border-t p-4">
          <p className="text-sm font-medium">
            {selectedIds.size} Besuch{selectedIds.size === 1 ? '' : 'e'}{' '}
            ausgewählt
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="batch-day-shift">Verschieben um (Tage)</Label>
              <QuantityStepper
                id="batch-day-shift"
                min={-366}
                value={dayShiftText}
                onChange={setDayShiftText}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="batch-new-time">
                Neue Uhrzeit (optional)
              </Label>
              <TimeInput
                id="batch-new-time"
                value={newTime}
                onChange={setNewTime}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="batch-reason">Begründung</Label>
            <Textarea
              id="batch-reason"
              value={batchReason}
              onChange={(event) => setBatchReason(event.target.value)}
              placeholder="z. B. Krankheitsbedingte Umplanung der Woche"
              maxLength={1000}
            />
          </div>
          <Button
            className="w-full"
            disabled={
              selectedIds.size === 0 ||
              batchReason.trim().length < 8 ||
              dayShiftText.trim() === '' ||
              !Number.isInteger(Number(dayShiftText)) ||
              (Number(dayShiftText) === 0 && newTime === '') ||
              isBatchWorking
            }
            onClick={() => void runBatchPreview()}
          >
            {isBatchWorking && <Loader2 className="size-4 animate-spin" />}
            Auswirkungen prüfen
          </Button>
        </div>
      )}

      {batchPreview && (
        <Dialog open onOpenChange={(open) => !open && setBatchPreview(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Verschiebung prüfen</DialogTitle>
              <DialogDescription>
                {batchPreview.itemCount} Besuch
                {batchPreview.itemCount === 1 ? '' : 'e'} werden gemeinsam
                verschoben. Die Änderung erfolgt vollständig oder gar nicht.
              </DialogDescription>
            </DialogHeader>
            <ul
              className="max-h-44 space-y-1 overflow-y-auto text-xs"
              role="group"
              aria-label="Alte und neue Zeitpunkte je Besuch"
              tabIndex={0}
            >
              {batchPreview.items.map((item) => (
                <li
                  key={item.occurrenceId}
                  className="tabular-nums text-muted-foreground"
                  data-batch-preview-item={item.occurrenceId}
                >
                  <span className="font-medium text-foreground">
                    {item.title}
                  </span>
                  {': '}
                  {formatOccurrenceSchedule({
                    startAt: item.oldStartAt,
                    startDate: item.oldStartDate,
                  })}
                  {' → '}
                  {formatOccurrenceSchedule({
                    startAt: item.newStartAt,
                    startDate: item.newStartDate,
                  })}
                </li>
              ))}
            </ul>
            <ul className="space-y-1.5 text-sm">
              {batchPreview.conflictCount > 0 && (
                <li className="text-yellow-700 dark:text-yellow-400">
                  {batchPreview.conflictCount} Planungshinweis
                  {batchPreview.conflictCount === 1 ? '' : 'e'} – Begründung
                  wird beim Speichern abgefragt.
                </li>
              )}
              {batchPreview.invalidatedAcknowledgementCount > 0 && (
                <li>
                  {batchPreview.invalidatedAcknowledgementCount === 1
                    ? '1 Bestätigung wird ungültig'
                    : `${batchPreview.invalidatedAcknowledgementCount} Bestätigungen werden ungültig`}{' '}
                  – die Personen bestätigen neu.
                </li>
              )}
              {batchPreview.commitmentMismatchTitles.length > 0 && (
                <li className="text-yellow-700 dark:text-yellow-400">
                  Kundenzusagen weichen danach ab:{' '}
                  {batchPreview.commitmentMismatchTitles.join(', ')} – bitte
                  neu zusagen oder zurückziehen. Es wird keine Nachricht
                  versendet.
                </li>
              )}
              {batchPreview.conflictCount === 0 &&
                batchPreview.invalidatedAcknowledgementCount === 0 &&
                batchPreview.commitmentMismatchTitles.length === 0 && (
                  <li className="text-muted-foreground">
                    Keine Konflikte, Bestätigungen oder Zusagen betroffen.
                  </li>
                )}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBatchPreview(null)}>
                Abbrechen
              </Button>
              <Button
                disabled={isBatchWorking}
                onClick={() => void runBatchCommit()}
              >
                {isBatchWorking && <Loader2 className="size-4 animate-spin" />}
                Jetzt verschieben
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {issueTarget && (
        <DispatchIssueDialog
          target={issueTarget}
          onClose={() => setIssueTarget(null)}
          onIssued={() => {
            setIssueTarget(null);
            void afterMutation();
          }}
        />
      )}

      {commitmentEntry && (
        <CommitmentDialog
          entry={commitmentEntry}
          onClose={() => setCommitmentEntry(null)}
          onSaved={() => {
            setCommitmentEntry(null);
            void afterMutation();
          }}
        />
      )}

      {withdrawCommitmentId && (
        <ReasonDialog
          title="Kundenzusage zurückziehen"
          description="Die Zusage wird als zurückgezogen dokumentiert. Der Kunde wird dadurch nicht benachrichtigt."
          confirmLabel="Zusage zurückziehen"
          minLength={3}
          onClose={() => setWithdrawCommitmentId(null)}
          onConfirm={async (reason) => {
            const result = await withdrawCustomerCommitment(
              withdrawCommitmentId,
              reason
            );
            if (!result.success) return dispatchErrorMessage(result.error);
            setWithdrawCommitmentId(null);
            void afterMutation();
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
            const result = await resolveDispatchChallenge(
              resolveChallengeId,
              reason
            );
            if (!result.success) return dispatchErrorMessage(result.error);
            setResolveChallengeId(null);
            void afterMutation();
            return null;
          }}
        />
      )}

      {cancelDispatchId && (
        <ReasonDialog
          title="Einsatz zurückziehen"
          description="Der Einsatz wird zurückgezogen und verschwindet bei den zugewiesenen Personen. Die Historie bleibt erhalten."
          confirmLabel="Einsatz zurückziehen"
          minLength={3}
          onClose={() => setCancelDispatchId(null)}
          onConfirm={async (reason) => {
            const result = await cancelDispatch(cancelDispatchId, reason);
            if (!result.success) return dispatchErrorMessage(result.error);
            setCancelDispatchId(null);
            void afterMutation();
            return null;
          }}
        />
      )}

      {warningDialog}
    </div>
  );
}
