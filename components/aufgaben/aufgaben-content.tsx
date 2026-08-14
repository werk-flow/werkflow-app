'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  Check,
  CheckCheck,
  Clock,
  Inbox,
  Loader2,
  MessageSquare,
  Palmtree,
  ParkingSquare,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { useAttentionCounts } from '@/components/realtime/attention-count-provider';
import {
  getAttentionOverview,
  markAllAttentionNotificationsRead,
  markAttentionNotificationRead,
} from '@/lib/attention/actions';
import type {
  AttentionNotification,
  AttentionOverview,
  AttentionTask,
} from '@/lib/attention/types';
import { VACATION_STATUS_LABELS } from '@/lib/vacation/types';
import { formatVacationDays } from '@/lib/vacation/balance';
import {
  REQUEST_STATUS_LABELS,
  REQUEST_URGENCY_LABELS,
} from '@/lib/requests/types';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';

const MARK_READ_ERROR =
  'Die Benachrichtigung konnte nicht als gelesen markiert werden.';
const MARK_ALL_READ_ERROR =
  'Die Benachrichtigungen konnten nicht als gelesen markiert werden.';

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

function formatOpenSince(days: number): string {
  if (days <= 0) return 'heute eingegangen';
  if (days === 1) return 'offen seit 1 Tag';
  return `offen seit ${days} Tagen`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}

const VACATION_DECISION_STATUS_TEXT: Record<
  'approved' | 'rejected' | 'cancelled',
  string
> = {
  approved: 'genehmigt',
  rejected: 'abgelehnt',
  cancelled: 'storniert',
};

// P1-08: sickness ranges are honest about open ends („bis auf Weiteres").
function formatSicknessRange(startDate: string, endDate: string | null): string {
  if (endDate === null) return `${formatDate(startDate)} – bis auf Weiteres`;
  return formatRange(startDate, endDate);
}

// Neutral, minimal notification copy (privacy matrix: dates only, no type).
function sicknessNotificationText(
  notification: Extract<AttentionNotification, { sourceType: 'sickness_report' }>
): string {
  const range = formatSicknessRange(
    notification.startDate,
    notification.endDate
  );
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
  notification: Extract<
    AttentionNotification,
    { sourceType: 'employee_certification_expiry' }
  >
): string {
  const phaseText =
    notification.phase === 'expired' ? 'ist abgelaufen' : 'läuft bald ab';
  return `${notification.capabilityName} von ${notification.personName} ${phaseText} (gültig bis ${formatDate(notification.validUntil)}).`;
}

export function AufgabenContent() {
  const [overview, setOverview] = useState<AttentionOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const generationRef = useRef(0);
  const hasDataRef = useRef(false);
  const { refreshAttentionCounts } = useAttentionCounts();

  const refetch = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const result = await getAttentionOverview();
      if (generation !== generationRef.current) return;
      // Keep last-known data on transient failures; only a failed initial
      // load shows the visible failure state.
      if (result.success) {
        setOverview(result.overview);
        hasDataRef.current = true;
        setLoadFailed(false);
      } else if (!hasDataRef.current) {
        setLoadFailed(true);
      }
    } catch (error) {
      console.error('Error fetching attention overview:', error);
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

  // One shared 150ms debounce for all Realtime triggers (mirrors the count
  // provider): a burst of related row changes causes one refetch, not eight.
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) {
      clearTimeout(refetchTimerRef.current);
    }
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      void refetch();
    }, 150);
  }, [refetch]);

  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
      }
    };
  }, []);

  useRealtimeEvent('time_entries', scheduleRefetch);
  useRealtimeEvent('entry_change_requests', scheduleRefetch);
  useRealtimeEvent('vacation_requests', scheduleRefetch);
  useRealtimeEvent('sickness_reports', scheduleRefetch);
  useRealtimeEvent('employee_capabilities', scheduleRefetch);
  useRealtimeEvent('organization_capabilities', scheduleRefetch);
  useRealtimeEvent('client_requests', scheduleRefetch);
  useRealtimeEvent('client_follow_ups', scheduleRefetch);
  useRealtimeEvent('planning_dispatches', scheduleRefetch);
  useRealtimeEvent('planning_dispatch_recipients', scheduleRefetch);
  useRealtimeEvent('planning_dispatch_acknowledgements', scheduleRefetch);
  useRealtimeEvent('job_parking_contexts', scheduleRefetch);
  useRealtimeEvent('attention_read_states', scheduleRefetch);
  useRealtimeEvent('organization_responsibility_configurations', scheduleRefetch);
  useRealtimeEvent('organization_responsibility_assignments', scheduleRefetch);
  useRealtimeEvent('organization_responsibility_delegations', scheduleRefetch);
  useBusinessDayRefresh(scheduleRefetch);

  const handleMarkRead = async (notification: AttentionNotification) => {
    if (busyKey) return;
    setBusyKey(notification.sourceId);
    try {
      const result = await markAttentionNotificationRead({
        sourceType: notification.sourceType,
        sourceId: notification.sourceId,
        stateVersion: notification.stateVersion,
      });
      if (!result.success) {
        toast.error(MARK_READ_ERROR);
      }
    } catch (error) {
      console.error('Error marking notification read:', error);
      toast.error(MARK_READ_ERROR);
    } finally {
      setBusyKey(null);
    }
    await refetch();
    void refreshAttentionCounts();
  };

  const handleMarkAllRead = async () => {
    if (busyKey) return;
    setBusyKey('__all__');
    try {
      const result = await markAllAttentionNotificationsRead();
      if (!result.success) {
        toast.error(MARK_ALL_READ_ERROR);
      }
    } catch (error) {
      console.error('Error marking all notifications read:', error);
      toast.error(MARK_ALL_READ_ERROR);
    } finally {
      setBusyKey(null);
    }
    await refetch();
    void refreshAttentionCounts();
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (loadFailed && !overview) {
    return (
      <p role="alert" className="mx-auto max-w-3xl text-sm text-destructive">
        Die Aufgaben konnten nicht geladen werden. Bitte versuche es erneut.
      </p>
    );
  }

  if (!overview) return null;

  const timeTasks = overview.tasks.filter(
    (task) =>
      task.sourceType === 'time_session_approval' ||
      task.sourceType === 'time_change_request_approval'
  );
  const vacationTasks = overview.tasks.filter(
    (task) => task.sourceType === 'vacation_request_approval'
  );
  const requestTasks = overview.tasks.filter(
    (task) => task.sourceType === 'client_request_open'
  );
  const followUpTasks = overview.tasks.filter(
    (task) => task.sourceType === 'client_follow_up'
  );
  const dispatchAcknowledgementTasks = overview.tasks.filter(
    (task) => task.sourceType === 'dispatch_acknowledgement'
  );
  const dispatchChallengeTasks = overview.tasks.filter(
    (task) => task.sourceType === 'dispatch_challenge_open'
  );
  const parkingReviewTasks = overview.tasks.filter(
    (task) => task.sourceType === 'job_parking_review'
  );
  const unreadCount = overview.notifications.filter(
    (notification) => notification.unread
  ).length;

  return (
    <div
      className="mx-auto max-w-3xl space-y-8"
      data-testid="aufgaben-content"
      data-loaded="true"
    >
      <section className="space-y-4" aria-labelledby="aufgaben-heading">
        <h2 id="aufgaben-heading" className="text-sm font-semibold">
          Offene Aufgaben
        </h2>

        {timeTasks.length === 0 &&
          vacationTasks.length === 0 &&
          requestTasks.length === 0 &&
          followUpTasks.length === 0 &&
          dispatchAcknowledgementTasks.length === 0 &&
          dispatchChallengeTasks.length === 0 &&
          parkingReviewTasks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Keine offenen Aufgaben.
            </p>
          )}

        {dispatchAcknowledgementTasks.length > 0 && (
          <TaskGroup
            icon={<Send className="size-4" />}
            title="Einsätze bestätigen"
            testId="attention-dispatch-tasks"
          >
            {dispatchAcknowledgementTasks.map((task) => (
              <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
            ))}
          </TaskGroup>
        )}

        {dispatchChallengeTasks.length > 0 && (
          <TaskGroup
            icon={<MessageSquare className="size-4" />}
            title="Offene Rückfragen"
            testId="attention-dispatch-challenge-tasks"
          >
            {dispatchChallengeTasks.map((task) => (
              <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
            ))}
          </TaskGroup>
        )}

        {parkingReviewTasks.length > 0 && (
          <TaskGroup
            icon={<ParkingSquare className="size-4" />}
            title="Parkplatz-Wiedervorlagen"
            testId="attention-parking-review-tasks"
          >
            {parkingReviewTasks.map((task) => (
              <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
            ))}
          </TaskGroup>
        )}

        {timeTasks.length > 0 && (
          <TaskGroup
            icon={<Clock className="size-4" />}
            title="Zeitfreigaben"
            testId="attention-time-tasks"
          >
            {timeTasks.map((task) => (
              <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
            ))}
          </TaskGroup>
        )}

        {vacationTasks.length > 0 && (
          <TaskGroup
            icon={<Palmtree className="size-4" />}
            title="Urlaubsanträge"
            testId="attention-vacation-tasks"
          >
            {vacationTasks.map((task) => (
              <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
            ))}
          </TaskGroup>
        )}

        {requestTasks.length > 0 && (
          <TaskGroup
            icon={<Inbox className="size-4" />}
            title="Offene Anfragen"
            testId="attention-request-tasks"
          >
            {requestTasks.map((task) => (
              <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
            ))}
          </TaskGroup>
        )}

        {followUpTasks.length > 0 && (
          <TaskGroup
            icon={<CalendarClock className="size-4" />}
            title="Nachfassaktionen"
            testId="attention-follow-up-tasks"
          >
            {followUpTasks.map((task) => (
              <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
            ))}
          </TaskGroup>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="benachrichtigungen-heading">
        <div className="flex items-center justify-between gap-2">
          <h2 id="benachrichtigungen-heading" className="text-sm font-semibold">
            Benachrichtigungen
          </h2>
          {unreadCount > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void handleMarkAllRead()}
              disabled={busyKey !== null}
            >
              {busyKey === '__all__' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCheck className="size-3.5" />
              )}
              Alle als gelesen markieren
            </Button>
          )}
        </div>

        {overview.notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine Benachrichtigungen.
          </p>
        ) : (
          <Card className="gap-0 divide-y py-0">
            {overview.notifications.map((notification) => {
              const range =
                notification.sourceType === 'sickness_report'
                  ? formatSicknessRange(
                      notification.startDate,
                      notification.endDate
                    )
                  : notification.sourceType ===
                      'employee_certification_expiry'
                    ? formatDate(notification.validUntil)
                    : formatRange(notification.startDate, notification.endDate);
              return (
                <div
                  key={`${notification.sourceType}:${notification.sourceId}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  data-notification-source={notification.sourceId}
                  data-unread={notification.unread ? 'true' : 'false'}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    {notification.unread && (
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p
                        className={`text-sm ${notification.unread ? 'font-medium' : ''}`}
                      >
                        {notification.sourceType === 'sickness_report'
                          ? sicknessNotificationText(notification)
                          : notification.sourceType ===
                              'employee_certification_expiry'
                            ? certificationNotificationText(notification)
                            : `Urlaub vom ${range}${
                                notification.dayPortion === 'half_day'
                                  ? ' (halbtags)'
                                  : ''
                              } wurde ${VACATION_DECISION_STATUS_TEXT[notification.status]}.`}
                      </p>
                      {notification.sourceType === 'vacation_decision' &&
                        notification.comment && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Grund: {notification.comment}
                          </p>
                        )}
                      {notification.sourceType ===
                        'employee_certification_expiry' && (
                        // The detail route resolves both user IDs and
                        // employee-record IDs for personnel without a login.
                        <Link
                          href={`/mitarbeiter/${notification.employeeRecordId}`}
                          className="mt-0.5 inline-block text-xs text-primary hover:underline"
                        >
                          Qualifikation ansehen
                        </Link>
                      )}
                    </div>
                  </div>
                  {notification.unread && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      onClick={() => void handleMarkRead(notification)}
                      disabled={busyKey !== null}
                      aria-label={`Benachrichtigung vom ${range} als gelesen markieren`}
                    >
                      {busyKey === notification.sourceId ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Gelesen
                    </Button>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="meine-antraege-heading">
        <div className="flex items-center justify-between gap-2">
          <h2 id="meine-antraege-heading" className="text-sm font-semibold">
            Meine Anträge
          </h2>
          <Link
            href="/zeiterfassung"
            className="text-sm text-primary hover:underline"
          >
            Zur Zeiterfassung
          </Link>
        </div>

        {overview.ownRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine eigenen Urlaubsanträge.
          </p>
        ) : (
          <Card className="gap-0 divide-y py-0" data-testid="attention-own-requests">
            {overview.ownRequests.map((request) => (
              <div
                key={request.sourceId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                data-own-request-source={request.sourceId}
              >
                <p className="text-sm tabular-nums">
                  {formatRange(request.startDate, request.endDate)}
                  {request.dayPortion === 'half_day' ? ' (halbtags)' : ''}
                  {` · ${formatVacationDays(request.totalDays)}`}
                </p>
                <p className="text-sm text-muted-foreground">
                  {VACATION_STATUS_LABELS[request.status]}
                </p>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function TaskGroup({
  icon,
  title,
  testId,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <h3 className="flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
      </h3>
      <Card className="gap-0 divide-y py-0">{children}</Card>
    </div>
  );
}

function TaskRow({ task }: { task: AttentionTask }) {
  if (task.sourceType === 'time_session_approval') {
    return (
      <TaskLink
        href="/zeiterfassung?tab=approvals"
        ariaLabel={`Zeitfreigabe von ${task.personName} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="text-sm font-medium">{task.personName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatDate(task.date)}
          {task.jobTitle ? ` · ${task.jobTitle}` : ''}
        </p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'time_change_request_approval') {
    return (
      <TaskLink
        href="/zeiterfassung?tab=approvals"
        ariaLabel={`Änderungsantrag von ${task.personName} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="text-sm font-medium">{task.personName}</p>
        <p className="text-xs text-muted-foreground">
          {task.requestType === 'delete'
            ? 'Löschung eines Zeiteintrags'
            : 'Änderung eines Zeiteintrags'}
        </p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'vacation_request_approval') {
    return (
      <TaskLink
        href="/zeiterfassung?tab=approvals"
        ariaLabel={`Urlaubsantrag von ${task.personName} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="text-sm font-medium">{task.personName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatRange(task.startDate, task.endDate)}
          {task.dayPortion === 'half_day' ? ' (halbtags)' : ''}
          {` · ${formatVacationDays(task.totalDays)}`}
        </p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'dispatch_acknowledgement') {
    return (
      <TaskLink
        href={task.jobNumber ? `/auftraege/${task.jobNumber}` : '/kalender'}
        ariaLabel={`Einsatz für ${task.jobTitle} bestätigen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">{task.jobTitle}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {task.startAt
            ? formatDateTime(task.startAt)
            : task.startDate
              ? formatDate(task.startDate)
              : 'Ohne festen Termin'}
          {' · Bestätigung ausstehend'}
        </p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'dispatch_challenge_open') {
    return (
      <TaskLink
        href="/kalender"
        ariaLabel={`Rückfrage von ${task.personName} zu ${task.jobTitle} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">
          {task.personName} · {task.jobTitle}
        </p>
        <p className="truncate text-xs text-muted-foreground">{task.reason}</p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'job_parking_review') {
    return (
      <TaskLink
        href={task.jobNumber ? `/auftraege/${task.jobNumber}` : '/kalender'}
        ariaLabel={`Wiedervorlage für geparkten Auftrag ${task.jobTitle} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">{task.jobTitle}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          Wiedervorlage {formatDate(task.nextReviewDate)}
          {task.responsibleName ? ` · Zuständig: ${task.responsibleName}` : ''}
        </p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'client_follow_up') {
    return (
      <TaskLink
        href={`/kunden/${task.clientId}?followUp=${task.sourceId}#nachfassaktionen`}
        ariaLabel={`Nachfassaktion ${task.title} für ${task.clientName} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="text-xs text-muted-foreground">
          {task.clientName} · fällig {formatDateTime(task.dueAt)}
          {task.ownerUnavailable
            ? ` · Zuständig: ${task.ownerName} (nicht mehr verfügbar)`
            : ''}
        </p>
      </TaskLink>
    );
  }

  return (
    <TaskLink
      href={`/anfragen/${task.sourceId}`}
      ariaLabel={`Anfrage ${task.requestNumber ?? task.summary} öffnen`}
      sourceId={task.sourceId}
    >
      <p className="truncate text-sm font-medium">
        {task.requestNumber ? `${task.requestNumber} · ` : ''}
        {task.summary}
      </p>
      <p className="text-xs text-muted-foreground">
        {REQUEST_STATUS_LABELS[task.status]}
        {` · ${REQUEST_URGENCY_LABELS[task.urgency]}`}
        {` · ${formatOpenSince(task.openSinceDays)}`}
        {task.assignedToMe
          ? ' · Mir zugewiesen'
          : task.assigneeName
            ? ` · Zuständig: ${task.assigneeName}`
            : ' · Nicht zugewiesen'}
      </p>
    </TaskLink>
  );
}

function TaskLink({
  href,
  ariaLabel,
  sourceId,
  children,
}: {
  href: string;
  ariaLabel: string;
  sourceId: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      data-task-source={sourceId}
      className="block px-4 py-3 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  );
}
