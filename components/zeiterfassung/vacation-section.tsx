'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Palmtree, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  createVacationRequest,
  getOwnVacationOverview,
  withdrawVacationRequest,
  type OwnVacationOverview,
  type VacationRequestListItem,
} from '@/lib/vacation/actions';
import { formatVacationDays } from '@/lib/vacation/balance';
import {
  VACATION_PORTION_LABELS,
  VACATION_STATUS_LABELS,
  type VacationRequestStatus,
} from '@/lib/vacation/types';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { cn, toLocalDateString } from '@/lib/utils';

const REQUEST_ERROR_MESSAGES: Record<string, string> = {
  invalid_dates: 'Bitte gib gültige Daten an.',
  invalid_range: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
  invalid_portion: 'Bitte wähle Ganztägig oder Halbtägig aus.',
  half_day_needs_single_day:
    'Ein halber Urlaubstag gilt nur für einen einzelnen Tag.',
  overlap_conflict:
    'Für diesen Zeitraum existiert bereits ein offener oder genehmigter Urlaubsantrag.',
  no_employee_record:
    'Zu deinem Zugang wurde keine Personalakte gefunden. Bitte wende dich an dein Büro.',
  not_authenticated: 'Bitte melde dich erneut an.',
  not_a_member: 'Du gehörst dieser Organisation nicht mehr an.',
  request_not_pending: 'Der Antrag ist nicht mehr offen.',
  not_authorized: 'Du darfst diesen Antrag nicht ändern.',
  insert_failed: 'Der Antrag konnte nicht gespeichert werden.',
  unexpected_error: 'Der Antrag konnte nicht gespeichert werden.',
};

const STATUS_BADGE_CLASSES: Record<VacationRequestStatus, string> = {
  pending: 'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light',
  approved: 'bg-green-500/10 text-green-600 dark:text-green-400',
  rejected: 'bg-destructive/10 text-destructive',
  withdrawn: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

function formatGermanNumber(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

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

export function VacationSection() {
  const [overview, setOverview] = useState<OwnVacationOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const hasDataRef = useRef(false);
  const refetch = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const result = await getOwnVacationOverview();
      if (generation !== generationRef.current) return;
      if (result.success) {
        hasDataRef.current = true;
        setOverview(result.overview);
        setLoadFailed(false);
      } else if (!hasDataRef.current) {
        // Keep last-known data on transient failure; only an initial load
        // failure shows the error state.
        setLoadFailed(true);
      }
    } catch (error) {
      console.error('Error fetching vacation overview:', error);
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
  useRealtimeEvent('employment_conditions', () => {
    void refetch();
  });

  const handleWithdraw = async (request: VacationRequestListItem) => {
    if (withdrawingId) return;
    setListError(null);
    setWithdrawingId(request.id);
    const result = await withdrawVacationRequest({ requestId: request.id });
    setWithdrawingId(null);
    if (!result.success) {
      setListError(
        REQUEST_ERROR_MESSAGES[result.error] ??
          'Der Antrag konnte nicht zurückgezogen werden.'
      );
    }
    await refetch();
  };

  const balance = overview?.balance ?? null;
  const hasEntitlement = balance?.entitlementDays != null;
  const usedPercentage =
    hasEntitlement && balance!.entitlementDays! > 0
      ? Math.min(
          Math.round((balance!.takenDays / balance!.entitlementDays!) * 100),
          100
        )
      : 0;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground px-1">
        Urlaub & Abwesenheit
      </h3>

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-4 w-56" />
            </div>
          ) : loadFailed ? (
            <p className="text-sm text-muted-foreground">
              Die Urlaubsdaten konnten nicht geladen werden.
            </p>
          ) : (
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-purple/10">
                <Palmtree className="h-6 w-6 text-brand-purple" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    Urlaubsanspruch {overview?.year}
                  </span>
                  {hasEntitlement ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatGermanNumber(balance!.takenDays)} von{' '}
                      {formatGermanNumber(balance!.entitlementDays!)} Tagen
                      genommen
                    </span>
                  ) : null}
                </div>

                {hasEntitlement ? (
                  <>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-brand-purple transition-all"
                        style={{ width: `${usedPercentage}%` }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {balance!.pendingDays > 0
                          ? `${formatVacationDays(balance!.pendingDays)} angefragt`
                          : 'Keine offenen Anträge'}
                      </span>
                      <span className="font-semibold text-foreground tabular-nums">
                        {formatVacationDays(balance!.remainingDays ?? 0)}{' '}
                        <span className="font-normal">Resturlaub</span>
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Kein Urlaubsanspruch hinterlegt. Der Anspruch wird vom Büro
                    in den Beschäftigungs&shy;konditionen gepflegt; Anträge sind
                    trotzdem möglich.
                  </p>
                )}

                <div className="mt-3">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setShowRequestDialog(true)}
                    disabled={!overview?.employeeRecordId}
                  >
                    <Plus className="size-3.5" />
                    Urlaub beantragen
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {overview && overview.requests.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h4 className="mb-2 text-sm font-medium">Meine Urlaubsanträge</h4>
            <ul className="grid gap-2">
              {overview.requests.map((request) => (
                <li
                  key={request.id}
                  className="rounded-md border px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          {formatRange(request.startDate, request.endDate)}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            STATUS_BADGE_CLASSES[request.status]
                          )}
                        >
                          {VACATION_STATUS_LABELS[request.status]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {VACATION_PORTION_LABELS[request.dayPortion]}
                        {` · ${formatVacationDays(request.totalDays)}`}
                        {request.status === 'pending' && ' (vorläufig)'}
                      </p>
                      {request.status === 'rejected' &&
                        request.decisionComment && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Grund: {request.decisionComment}
                          </p>
                        )}
                      {request.status === 'cancelled' &&
                        request.cancellationReason && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Storniert: {request.cancellationReason}
                          </p>
                        )}
                    </div>
                    {request.status === 'pending' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleWithdraw(request)}
                        disabled={withdrawingId !== null}
                      >
                        {withdrawingId === request.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        Zurückziehen
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {listError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {listError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {showRequestDialog && (
        <VacationRequestDialog
          hasEntitlement={hasEntitlement}
          onClose={(saved) => {
            setShowRequestDialog(false);
            if (saved) void refetch();
          }}
        />
      )}
    </div>
  );
}

function VacationRequestDialog({
  hasEntitlement,
  onClose,
}: {
  hasEntitlement: boolean;
  onClose: (saved: boolean) => void;
}) {
  const todayIso = toLocalDateString(new Date());
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endDate, setEndDate] = useState<string>(todayIso);
  const [halfDay, setHalfDay] = useState(false);
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSingleDay = startDate === endDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    if (!startDate || !endDate) {
      setError('Bitte wähle Start- und Enddatum aus.');
      return;
    }
    if (endDate < startDate) {
      setError(REQUEST_ERROR_MESSAGES.invalid_range);
      return;
    }

    setIsSaving(true);
    const result = await createVacationRequest({
      startDate,
      endDate,
      dayPortion: halfDay && isSingleDay ? 'half_day' : 'full',
      comment: comment.trim() || undefined,
    });
    setIsSaving(false);

    if (result.success) {
      onClose(true);
    } else {
      setError(
        REQUEST_ERROR_MESSAGES[result.error] ??
          'Der Antrag konnte nicht gespeichert werden.'
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Urlaub beantragen</DialogTitle>
          <DialogDescription>
            Der Antrag wird zur Freigabe eingereicht. Wochenenden, Feiertage und
            freie Tage laut Arbeitszeitmodell kosten keine Urlaubstage.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vacation-start-date">Von</Label>
                <DatePicker
                  id="vacation-start-date"
                  ariaLabel="Von"
                  value={
                    startDate ? new Date(`${startDate}T00:00:00`) : undefined
                  }
                  onChange={(date) => {
                    const next = date ? toLocalDateString(date) : '';
                    setStartDate(next);
                    if (next && (!endDate || endDate < next)) setEndDate(next);
                  }}
                  disabled={isSaving}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vacation-end-date">Bis</Label>
                <DatePicker
                  id="vacation-end-date"
                  ariaLabel="Bis"
                  value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
                  onChange={(date) =>
                    setEndDate(date ? toLocalDateString(date) : '')
                  }
                  disabled={isSaving}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="vacation-half-day"
                checked={halfDay && isSingleDay}
                onCheckedChange={(checked) => setHalfDay(checked === true)}
                disabled={isSaving || !isSingleDay}
              />
              <Label
                htmlFor="vacation-half-day"
                className={cn(
                  'text-sm font-normal',
                  !isSingleDay && 'text-muted-foreground'
                )}
              >
                Halbtägig (0,5 Tage)
                {!isSingleDay && ' – nur bei einem einzelnen Tag'}
              </Label>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="vacation-comment">Notiz (optional)</Label>
              <Textarea
                id="vacation-comment"
                rows={2}
                placeholder="z. B. Familienfeier"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={isSaving}
              />
            </div>

            {!hasEntitlement && (
              <p className="text-xs text-muted-foreground">
                Hinweis: Für dich ist noch kein Urlaubsanspruch hinterlegt. Der
                Antrag ist trotzdem möglich; die Freigabe entscheidet dein
                Betrieb.
              </p>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving || !startDate || !endDate}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird eingereicht...' : 'Antrag einreichen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
