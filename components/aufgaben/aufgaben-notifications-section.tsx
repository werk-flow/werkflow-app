'use client';

import Link from 'next/link';
import { Check, CheckCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlinePending } from '@/components/ui/inline-pending';
import type { AttentionNotification } from '@/lib/attention/types';
import type { useBusyIds } from '@/hooks/use-busy-id';
import { formatSicknessRange } from '@/lib/sickness/types';
import { unconfirmedMarker } from '@/lib/ui/unconfirmed';
import { ALL_NOTIFICATIONS_ID } from './use-aufgaben-overview';
import { formatGermanDate, formatGermanDateRange } from '@/lib/utils';

const VACATION_DECISION_STATUS_TEXT: Record<'approved' | 'rejected' | 'cancelled', string> = {
  approved: 'genehmigt',
  rejected: 'abgelehnt',
  cancelled: 'storniert',
};

// Neutral, minimal notification copy (privacy matrix: dates only, no type).
function sicknessNotificationText(
  notification: Extract<AttentionNotification, { sourceType: 'sickness_report' }>,
): string {
  const range = formatSicknessRange(notification);
  const portion = notification.dayPortion === 'half_day' ? ' (halbtags)' : '';
  if (notification.isOwn) {
    return notification.status === 'cancelled'
      ? `Deine Krankmeldung vom ${range}${portion} wurde storniert.`
      : `Für dich wurde eine Krankmeldung erfasst: ${range}${portion}.`;
  }
  return notification.status === 'cancelled'
    ? `Krankmeldung storniert: ${notification.personName}, ${range}${portion}.`
    : `Krankmeldung: ${notification.personName}, ${range}${portion}.`;
}

function certificationNotificationText(
  notification: Extract<AttentionNotification, { sourceType: 'employee_certification_expiry' }>,
): string {
  const phaseText = notification.phase === 'expired' ? 'ist abgelaufen' : 'läuft bald ab';
  return `${notification.capabilityName} von ${notification.personName} ${phaseText} (gültig bis ${formatGermanDate(notification.validUntil)}).`;
}

type AufgabenBusyIds = Pick<ReturnType<typeof useBusyIds>, 'isBusy' | 'anyBusy'>;

type AufgabenNotificationsSectionProps = {
  notifications: AttentionNotification[];
  busy: AufgabenBusyIds;
  isMarkingAllRead: boolean;
  handleMarkRead: (notification: AttentionNotification) => Promise<void>;
  handleMarkAllRead: () => Promise<void>;
};

export function AufgabenNotificationsSection({
  notifications,
  busy,
  isMarkingAllRead,
  handleMarkRead,
  handleMarkAllRead,
}: AufgabenNotificationsSectionProps) {
  const unreadCount = notifications.filter((notification) => notification.unread).length;

  return (
    <section className="space-y-4" aria-labelledby="benachrichtigungen-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="benachrichtigungen-heading" className="text-sm font-semibold">
          Benachrichtigungen
        </h2>
        {(unreadCount > 1 || isMarkingAllRead) && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void handleMarkAllRead()}
            disabled={busy.anyBusy}
            data-pending={isMarkingAllRead ? 'true' : 'false'}
          >
            {isMarkingAllRead ? (
              <InlinePending active label="Benachrichtigungen werden markiert" />
            ) : (
              <CheckCheck className="size-3.5" />
            )}
            Alle als gelesen markieren
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Benachrichtigungen.</p>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {notifications.map((notification) => (
            <AufgabenNotificationRow
              key={`${notification.sourceType}:${notification.sourceId}`}
              notification={notification}
              busy={busy}
              handleMarkRead={handleMarkRead}
            />
          ))}
        </Card>
      )}
    </section>
  );
}

function AufgabenNotificationRow({
  notification,
  busy,
  handleMarkRead,
}: Pick<AufgabenNotificationsSectionProps, 'busy' | 'handleMarkRead'> & {
  notification: AttentionNotification;
}) {
  const isMarkingRead = busy.isBusy(notification.sourceId);
  const range =
    notification.sourceType === 'sickness_report'
      ? formatSicknessRange(notification)
      : notification.sourceType === 'employee_certification_expiry'
        ? formatGermanDate(notification.validUntil)
        : formatGermanDateRange(notification.startDate, notification.endDate);
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
      data-notification-source={notification.sourceId}
      data-unread={notification.unread ? 'true' : 'false'}
      {...unconfirmedMarker(isMarkingRead || busy.isBusy(ALL_NOTIFICATIONS_ID))}
    >
      <div className="flex min-w-0 items-start gap-2">
        {notification.unread && (
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className={`text-sm ${notification.unread ? 'font-medium' : ''}`}>
            {notification.sourceType === 'sickness_report'
              ? sicknessNotificationText(notification)
              : notification.sourceType === 'employee_certification_expiry'
                ? certificationNotificationText(notification)
                : `Urlaub vom ${range}${
                    notification.dayPortion === 'half_day' ? ' (halbtags)' : ''
                  } wurde ${VACATION_DECISION_STATUS_TEXT[notification.status]}.`}
          </p>
          {notification.sourceType === 'vacation_decision' && notification.comment && (
            <p className="mt-0.5 text-xs text-muted-foreground">Grund: {notification.comment}</p>
          )}
          {notification.sourceType === 'employee_certification_expiry' && (
            // The detail route resolves both user IDs and
            // employee-record IDs for personnel without a login.
            <Link
              href={`/mitarbeiter/${notification.employeeRecordId}`}
              className="mt-0.5 inline-block text-xs text-primary-text hover:underline"
            >
              Qualifikation ansehen
            </Link>
          )}
        </div>
      </div>
      {(notification.unread || isMarkingRead) && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => void handleMarkRead(notification)}
          disabled={isMarkingRead || busy.isBusy(ALL_NOTIFICATIONS_ID)}
          data-pending={isMarkingRead ? 'true' : 'false'}
          aria-label={`Benachrichtigung vom ${range} als gelesen markieren`}
        >
          {isMarkingRead ? (
            <InlinePending active label="Wird als gelesen markiert" />
          ) : (
            <Check className="size-3.5" />
          )}
          Gelesen
        </Button>
      )}
    </div>
  );
}
