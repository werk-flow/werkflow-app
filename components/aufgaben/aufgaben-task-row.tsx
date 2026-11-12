import Link from 'next/link';
import { lazy, Suspense, type ComponentType } from 'react';

import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import type { AttentionTask } from '@/lib/attention/types';
import { formatVacationDays } from '@/lib/vacation/balance';
import { REQUEST_STATUS_LABELS, REQUEST_URGENCY_LABELS } from '@/lib/requests/types';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';
import { CALENDAR_DISPATCH_STATE_LABELS } from '@/lib/calendar/board';
import { formatOpenSince } from '@/lib/attention/task-sections';
import { formatGermanDate, formatGermanDateRange, formatBerlinDateTime } from '@/lib/utils';

// The access proposal row and its review load on their own: every page's cold
// start carries the Aufgaben code (lab.field.cold-start). A failed download
// shows in the row; a reload tries again.
type SiteAccessRowProps = {
  task: Extract<AttentionTask, { sourceType: 'site_access_proposal' }>;
  onDecided: () => Promise<void>;
};

function SiteAccessRowLoadError() {
  return (
    <ListRow variant="plain">
      <ErrorText>Dieser Zugangshinweis konnte nicht geladen werden. Lade die Seite neu.</ErrorText>
    </ListRow>
  );
}

const SiteAccessTaskRow = lazy<ComponentType<SiteAccessRowProps>>(() =>
  import('./site-access-review').then(
    (mod) => ({ default: mod.SiteAccessTaskRow }),
    () => ({ default: SiteAccessRowLoadError }),
  ),
);

type AttentionApprovalTask = Extract<
  AttentionTask,
  {
    sourceType:
      | 'time_session_approval'
      | 'time_change_request_approval'
      | 'time_correction_approval'
      | 'vacation_request_approval';
  }
>;
type AttentionDispatchTask = Extract<
  AttentionTask,
  { sourceType: 'dispatch_acknowledgement' | 'dispatch_challenge_open' }
>;
type AttentionWorkTask = Extract<
  AttentionTask,
  {
    sourceType:
      | 'work_blocker_review'
      | 'work_artifact_review'
      | 'work_artifact_correction'
      | 'work_defect_due'
      | 'work_handover_review';
  }
>;
type AttentionClientTask = Extract<
  AttentionTask,
  { sourceType: 'client_follow_up' | 'client_request_open' | 'client_request_callback_overdue' }
>;

/** One task; `onDecided` reads the overview again after a decision taken in its row. */
export function TaskRow({ task, onDecided }: { task: AttentionTask; onDecided: () => Promise<void> }) {
  switch (task.sourceType) {
    case 'time_session_approval':
    case 'time_change_request_approval':
    case 'time_correction_approval':
    case 'vacation_request_approval':
      return <AttentionApprovalTaskRow task={task} />;
    case 'dispatch_acknowledgement':
    case 'dispatch_challenge_open':
      return <AttentionDispatchTaskRow task={task} />;
    case 'work_blocker_review':
    case 'work_artifact_review':
    case 'work_artifact_correction':
    case 'work_defect_due':
    case 'work_handover_review':
      return <AttentionWorkTaskRow task={task} />;
    // The Mitarbeiter area decides join requests.
    case 'organization_join_request':
      return (
        <TaskLink
          href="/mitarbeiter#beitrittsanfragen"
          ariaLabel={`Beitrittsanfrage von ${task.personName} öffnen`}
          sourceId={task.sourceId}
        >
          <p className="truncate text-sm font-medium">{task.personName}</p>
          {task.email && <p className="truncate text-xs text-muted-foreground">{task.email}</p>}
        </TaskLink>
      );
    case 'client_follow_up':
    case 'client_request_open':
    case 'client_request_callback_overdue':
      return <AttentionClientTaskRow task={task} />;
    // The visit's day on the Plantafel, where the office plans someone else.
    case 'planning_visit_replan':
      return (
        <TaskLink
          href={`/kalender?date=${task.date}`}
          ariaLabel={`Einsatz ${task.visitTitle} von ${task.personName} am ${formatGermanDate(task.date)} umplanen`}
          sourceId={task.sourceId}
        >
          <p className="truncate text-sm font-medium">
            {task.personName} · {task.visitTitle}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatGermanDate(task.date)}
            {task.time ? `, ${task.time} Uhr` : ''}
            {task.jobNumber ? ` · ${task.jobNumber}` : ''}
            {` · Abwesend · Einsatz ${CALENDAR_DISPATCH_STATE_LABELS[task.dispatchState]}`}
          </p>
        </TaskLink>
      ); // A field worker's access proposal: decided in its own dialog.
    case 'site_access_proposal':
      return (
        <Suspense fallback={<ListRow skeleton variant="plain" className="min-h-14" />}>
          <SiteAccessTaskRow task={task} onDecided={onDecided} />
        </Suspense>
      );
  }
}

function AttentionApprovalTaskRow({ task }: { task: AttentionApprovalTask }) {
  if (task.sourceType === 'time_session_approval') {
    return (
      <TaskLink
        href="/zeiterfassung?tab=approvals"
        ariaLabel={`Zeitfreigabe von ${task.personName} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">{task.personName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatGermanDate(task.date)}
          {task.jobTitle ? ` · ${task.jobTitle}` : ''}
          {` · ${formatOpenSince(task.openSinceDays)}`}
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
        <p className="truncate text-sm font-medium">{task.personName}</p>
        <p className="text-xs text-muted-foreground">
          {task.requestType === 'delete' ? 'Löschung eines Zeiteintrags' : 'Änderung eines Zeiteintrags'}
          {` · ${formatOpenSince(task.openSinceDays)}`}
        </p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'time_correction_approval') {
    return (
      <TaskLink
        href="/zeiterfassung?tab=approvals"
        ariaLabel={`Zeitkorrektur von ${task.personName} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">{task.personName}</p>
        <p className="text-xs text-muted-foreground">
          {task.correctionLabel}
          {` · ${formatOpenSince(task.openSinceDays)}`}
        </p>
      </TaskLink>
    );
  }

  return (
    <TaskLink
      href="/zeiterfassung?tab=approvals"
      ariaLabel={`Urlaubsantrag von ${task.personName} öffnen`}
      sourceId={task.sourceId}
    >
      <p className="truncate text-sm font-medium">{task.personName}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatGermanDateRange(task.startDate, task.endDate)}
        {task.dayPortion === 'half_day' ? ' (halbtags)' : ''}
        {` · ${formatVacationDays(task.totalDays)}`}
        {` · ${formatOpenSince(task.openSinceDays)}`}
      </p>
    </TaskLink>
  );
}

function AttentionDispatchTaskRow({ task }: { task: AttentionDispatchTask }) {
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
            ? formatBerlinDateTime(task.startAt)
            : task.startDate
              ? formatGermanDate(task.startDate)
              : 'Ohne festen Termin'}
          {' · Bestätigung ausstehend'}
        </p>
      </TaskLink>
    );
  }

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

function AttentionWorkTaskRow({ task }: { task: AttentionWorkTask }) {
  if (task.sourceType === 'work_blocker_review') {
    return (
      <TaskLink
        href={task.targetHref}
        ariaLabel={`Wiedervorlage für ${task.targetLabel} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">{task.targetLabel}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {task.blockerKind === 'parking' ? 'Parkplatz' : 'Blocker'} · Wiedervorlage{' '}
          {formatGermanDate(task.nextReviewDate)}
          {task.responsibleName ? ` · Zuständig: ${task.responsibleName}` : ''}
        </p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'work_artifact_review' || task.sourceType === 'work_artifact_correction') {
    const needsReview = task.sourceType === 'work_artifact_review';
    return (
      <TaskLink
        href={`${task.targetHref}?arbeitsnachweis=${task.sourceId}#arbeitsnachweise`}
        ariaLabel={`${needsReview ? 'Prüfung' : 'Korrektur'} für ${task.artifactTitle} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">{task.artifactTitle}</p>
        <p className="text-xs text-muted-foreground">
          {WORK_ARTIFACT_KIND_LABELS[task.artifactKind]} · Version {task.revisionNumber} ·{' '}
          {needsReview ? 'Prüfung ausstehend' : 'Korrektur erforderlich'}
        </p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'work_defect_due') {
    return (
      <TaskLink
        href={`${task.targetHref}?arbeitsnachweis=${task.sourceId}#arbeitsnachweise`}
        ariaLabel={`Fälligen Mangel ${task.artifactTitle} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">{task.artifactTitle}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {task.targetLabel} · fällig {formatGermanDate(task.dueDate)}
        </p>
      </TaskLink>
    );
  }

  return (
    <TaskLink
      href={task.targetHref}
      ariaLabel={`Übergabe für ${task.targetLabel} prüfen`}
      sourceId={task.sourceId}
    >
      <p className="truncate text-sm font-medium">{task.targetLabel}</p>
      <p className="text-xs text-muted-foreground">
        {task.packageState === 'reopened'
          ? 'Erneute Freigabe erforderlich'
          : task.packageState === 'draft'
            ? 'Entwurf prüfen und freigeben'
            : 'Übergabepaket vorbereiten'}
      </p>
    </TaskLink>
  );
}

function AttentionClientTaskRow({ task }: { task: AttentionClientTask }) {
  if (task.sourceType === 'client_follow_up') {
    return (
      <TaskLink
        href={`/kunden/${task.clientId}?followUp=${task.sourceId}#nachfassaktionen`}
        ariaLabel={`Nachfassaktion ${task.title} für ${task.clientName} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="text-xs text-muted-foreground">
          {task.clientName} · fällig {formatBerlinDateTime(task.dueAt)}
          {task.ownerUnavailable ? ` · Zuständig: ${task.ownerName} (nicht mehr verfügbar)` : ''}
        </p>
      </TaskLink>
    );
  }

  if (task.sourceType === 'client_request_callback_overdue') {
    return (
      <TaskLink
        href={`/anfragen/${task.sourceId}`}
        ariaLabel={`Rückruf zur Anfrage ${task.requestNumber ?? task.summary} öffnen`}
        sourceId={task.sourceId}
      >
        <p className="truncate text-sm font-medium">
          {task.requestNumber ? `${task.requestNumber} · ` : ''}
          {task.summary}
        </p>
        <p className="text-xs text-muted-foreground">
          Rückruf bis {formatBerlinDateTime(task.callbackDueAt)}
          {` · ${REQUEST_URGENCY_LABELS[task.urgency]}`}
          {task.ownerName === null
            ? ' · Nicht zugewiesen'
            : task.ownerUnavailable
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
    <ListRow asChild interactive variant="plain">
      <Link href={href} aria-label={ariaLabel} data-task-source={sourceId}>
        {children}
      </Link>
    </ListRow>
  );
}
