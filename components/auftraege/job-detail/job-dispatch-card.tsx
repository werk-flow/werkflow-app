'use client';

import { CalendarCheck, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { DISPATCH_RECIPIENT_STATE_LABELS, type EmployeeDispatchCard } from '@/lib/dispatch/types';

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

type JobDispatchCardProps = {
  card: EmployeeDispatchCard;
  primaryPendingDispatchId: string | undefined;
  readOnly: boolean;
  isCardBusy: (dispatchId: string) => boolean;
  actionError: { dispatchId: string; message: string } | null;
  handleAcknowledge: (card: EmployeeDispatchCard) => Promise<void>;
  onChallenge: () => void;
};

export function JobDispatchCard({
  card,
  primaryPendingDispatchId,
  readOnly,
  isCardBusy,
  actionError,
  handleAcknowledge,
  onChallenge,
}: JobDispatchCardProps) {
  return (
    <div
      className="rounded-md border px-4 py-3"
      data-dispatch-id={card.dispatchId}
      data-dispatch-state={card.myState}
    >
      <p className="text-sm font-medium tabular-nums">{formatCardSchedule(card)}</p>
      {card.locationText && <p className="mt-0.5 text-sm text-muted-foreground">{card.locationText}</p>}
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
          {card.committedWindowText ? `: ${card.committedWindowText}` : ''}
        </p>
      )}
      <ErrorText className="mt-2">
        {actionError?.dispatchId === card.dispatchId ? actionError.message : null}
      </ErrorText>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {card.myState === 'ausstehend' && !readOnly ? (
          <>
            <Button
              data-testid={
                card.dispatchId === primaryPendingDispatchId ? 'field-primary-next-action' : undefined
              }
              variant={card.dispatchId === primaryPendingDispatchId ? 'default' : 'outline'}
              className="min-h-11 flex-1 sm:flex-none"
              disabled={isCardBusy(card.dispatchId)}
              onClick={() => void handleAcknowledge(card)}
            >
              Einsatz bestätigen
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={isCardBusy(card.dispatchId)}
              onClick={() => onChallenge()}
            >
              <MessageSquare className="size-4" />
              Rückfrage stellen
            </Button>
            <InlinePending active={isCardBusy(card.dispatchId)} label="Einsatz wird bestätigt" />
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
  );
}
