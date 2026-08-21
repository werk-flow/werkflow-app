'use client';

// P1-12: the field worker's own dispatch card on the job detail. One primary
// confirmation action plus a quiet challenge path. Confirming records ONLY
// that this person saw this exact work instruction revision — never
// attendance, time, or a customer promise.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarCheck, Loader2, MessageSquare, Send } from 'lucide-react';

import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  acknowledgeDispatch,
  challengeDispatch,
  getJobDispatchCards,
} from '@/lib/dispatch/actions';
import {
  DISPATCH_RECIPIENT_STATE_LABELS,
  dispatchErrorMessage,
  type EmployeeDispatchCard,
} from '@/lib/dispatch/types';

function formatCardSchedule(card: EmployeeDispatchCard): string {
  if (card.startAt) {
    const start = new Date(card.startAt);
    const dateText = start.toLocaleDateString('de-DE', {
      timeZone: 'Europe/Berlin',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const timeText = start.toLocaleTimeString('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
    });
    const endText = card.endAt
      ? new Date(card.endAt).toLocaleTimeString('de-DE', {
          timeZone: 'Europe/Berlin',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
    return `${dateText}, ${timeText}${endText ? `–${endText}` : ''} Uhr`;
  }
  if (card.startDate) {
    const [year, month, day] = card.startDate.split('-');
    return `Ab ${day}.${month}.${year} (ganztägig)`;
  }
  return 'Ohne festen Termin – bitte Rücksprache mit dem Büro.';
}

export function JobDispatchSection({ jobId }: { jobId: string }) {
  const [cards, setCards] = useState<EmployeeDispatchCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyDispatchId, setBusyDispatchId] = useState<string | null>(null);
  const [challengeTarget, setChallengeTarget] =
    useState<EmployeeDispatchCard | null>(null);
  const [challengeReason, setChallengeReason] = useState('');
  const generationRef = useRef(0);
  // Ref instead of a state dependency: keep-last-known must read the CURRENT
  // loaded state without changing the refresh identity on every result.
  const hasCardsRef = useRef(false);

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const result = await getJobDispatchCards(jobId);
      if (generation !== generationRef.current) return;
      if (result.success) {
        hasCardsRef.current = true;
        setCards(result.cards);
        setError(null);
      } else if (!hasCardsRef.current) {
        // Initial load failed; transient later failures keep last-known cards.
        setError(dispatchErrorMessage(result.error));
      }
    } catch {
      if (generation !== generationRef.current) return;
      if (!hasCardsRef.current) {
        setError(dispatchErrorMessage('load_failed'));
      }
    }
  }, [jobId]);

  // Shared debounce: one mutation touches several published tables and must
  // produce one refetch.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 150);
  }, [refresh]);
  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    []
  );

  useEffect(() => {
    hasCardsRef.current = false;
    void refresh();
  }, [refresh]);
  useRealtimeEvent('planning_dispatches', scheduleRefresh);
  useRealtimeEvent('planning_dispatch_recipients', scheduleRefresh);
  useRealtimeEvent('planning_dispatch_acknowledgements', scheduleRefresh);

  const handleAcknowledge = useCallback(
    async (card: EmployeeDispatchCard) => {
      setBusyDispatchId(card.dispatchId);
      setError(null);
      const result = await acknowledgeDispatch(
        card.dispatchId,
        card.revisionNumber
      );
      setBusyDispatchId(null);
      if (!result.success) {
        setError(dispatchErrorMessage(result.error));
      }
      await refresh();
    },
    [refresh]
  );

  const [challengeError, setChallengeError] = useState<string | null>(null);
  const handleChallenge = useCallback(async () => {
    if (!challengeTarget) return;
    setBusyDispatchId(challengeTarget.dispatchId);
    setChallengeError(null);
    try {
      const result = await challengeDispatch(
        challengeTarget.dispatchId,
        challengeTarget.revisionNumber,
        challengeReason
      );
      if (!result.success) {
        // Shown inside the still-open dialog so the typed reason survives.
        setChallengeError(dispatchErrorMessage(result.error));
        return;
      }
      setChallengeTarget(null);
      setChallengeReason('');
      await refresh();
    } catch {
      setChallengeError(dispatchErrorMessage('unexpected_error'));
    } finally {
      setBusyDispatchId(null);
    }
  }, [challengeTarget, challengeReason, refresh]);

  // An initial load failure must stay visible instead of silently reading as
  // "kein Einsatz".
  if (error && (!cards || cards.length === 0)) {
    return (
      <section
        className="rounded-lg border bg-card p-4 sm:p-5"
        aria-labelledby="job-dispatch-heading"
        data-testid="job-dispatch-section"
      >
        <h3
          id="job-dispatch-heading"
          className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          <Send className="size-4" />
          Mein Einsatz
        </h3>
        <ErrorText>{error}</ErrorText>
      </section>
    );
  }
  if (!cards || cards.length === 0) return null;

  return (
    <section
      className="rounded-lg border bg-card p-4 sm:p-5"
      aria-labelledby="job-dispatch-heading"
      data-testid="job-dispatch-section"
    >
      <h3
        id="job-dispatch-heading"
        className="mb-4 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        <Send className="size-4" />
        Mein Einsatz
      </h3>
      <ErrorText className="mb-3">{error}</ErrorText>
      <div className="space-y-3">
        {cards.map((card) => (
          <div
            key={card.dispatchId}
            className="rounded-md border px-4 py-3"
            data-dispatch-id={card.dispatchId}
            data-dispatch-state={card.myState}
          >
            <p className="text-sm font-medium tabular-nums">
              {formatCardSchedule(card)}
            </p>
            {card.locationText && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {card.locationText}
              </p>
            )}
            {card.note && (
              <p className="mt-1.5 text-sm">
                <span className="text-muted-foreground">Hinweis: </span>
                {card.note}
              </p>
            )}
            {card.committedToCustomer && (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarCheck className="size-4 shrink-0" aria-hidden="true" />
                Dem Kunden zugesagt
                {card.committedWindowText
                  ? `: ${card.committedWindowText}`
                  : ''}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {card.myState === 'ausstehend' ? (
                <>
                  <Button
                    className="min-h-11 flex-1 sm:flex-none"
                    disabled={busyDispatchId === card.dispatchId}
                    onClick={() => void handleAcknowledge(card)}
                  >
                    {busyDispatchId === card.dispatchId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Einsatz bestätigen
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={busyDispatchId === card.dispatchId}
                    onClick={() => {
                      setChallengeReason('');
                      setChallengeTarget(card);
                    }}
                  >
                    <MessageSquare className="size-4" />
                    Rückfrage stellen
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {DISPATCH_RECIPIENT_STATE_LABELS[card.myState]}
                  {card.myState === 'rueckfrage' && card.myOpenChallengeReason
                    ? ` – „${card.myOpenChallengeReason}“ (das Büro meldet sich)`
                    : ''}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={challengeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setChallengeTarget(null);
            setChallengeError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rückfrage zum Einsatz</DialogTitle>
            <DialogDescription>
              Deine Rückfrage geht an das Büro. Der Einsatz bleibt bestehen,
              bis das Büro entscheidet.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleChallenge();
            }}
            noValidate
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="dispatch-challenge-reason">Begründung</Label>
              <Textarea
                id="dispatch-challenge-reason"
                value={challengeReason}
                onChange={(event) => setChallengeReason(event.target.value)}
                placeholder="z. B. Terminüberschneidung mit anderem Einsatz"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">
                Mindestens 8 Zeichen.
              </p>
            </div>
            <ErrorText>{challengeError}</ErrorText>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setChallengeTarget(null);
                  setChallengeError(null);
                }}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={
                  challengeReason.trim().length < 8 ||
                  busyDispatchId === challengeTarget?.dispatchId
                }
              >
                Rückfrage senden
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
