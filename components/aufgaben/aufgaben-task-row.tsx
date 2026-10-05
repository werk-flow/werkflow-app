import Link from 'next/link';

import { ListRow } from '@/components/ui/list-row';
import type { AttentionTask } from '@/lib/attention/types';
import { formatVacationDays } from '@/lib/vacation/balance';
import { REQUEST_STATUS_LABELS, REQUEST_URGENCY_LABELS } from '@/lib/requests/types';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';
import { formatOpenSince, formatRange } from './aufgaben-format';
import { formatGermanDate, formatBerlinDateTime } from '@/lib/utils';

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
type AttentionClientTask = Extract<AttentionTask, { sourceType: 'client_follow_up' | 'client_request_open' }>;

export function TaskRow({ task }: { task: AttentionTask }) {
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
    // Client follow-ups; open requests are the fallback row.
    default:
      return <AttentionClientTaskRow task={task} />;
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
        <p className="text-sm font-medium">{task.personName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatGermanDate(task.date)}
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
          {task.requestType === 'delete' ? 'Löschung eines Zeiteintrags' : 'Änderung eines Zeiteintrags'}
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
        <p className="text-sm font-medium">{task.personName}</p>
        <p className="text-xs text-muted-foreground">{task.correctionLabel}</p>
      </TaskLink>
    );
  }

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
