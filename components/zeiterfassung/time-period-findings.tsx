import Link from 'next/link';
import type { ReactElement } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDuration } from '@/lib/time-tracking/helpers';
import {
  activityLabel,
  canFixFinding,
  FINDING_FIXER_LABELS,
  type FindingViewer,
  groupPeriodFindings,
  PERIOD_FINDING_FIXES,
  type PeriodFindingFix,
  type PeriodFindingGroup,
  personFixHref,
  readFindingDates,
  readUnallocatedTime,
} from '@/lib/time-accounts/period-finding-groups';
import { FINDING_DECISION_LABELS, FINDING_LABELS, formatMinutes } from '@/lib/time-accounts/presentation';
import type { OpenPeriodSession, TimePeriodDetail } from '@/lib/time-accounts/queries';
import { formatBerlin, formatGermanDate } from '@/lib/utils';
import { TimePeriodFindingDecisionForm } from './time-period-finding-decision-form';

type PeriodFinding = TimePeriodDetail['findings'][number];

function FindingIcon({ severity }: { severity: string }) {
  if (severity === 'close_blocked')
    return <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />;
  if (severity === 'approval_required')
    return <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-text" />;
  return <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function severityText(severity: string): string {
  if (severity === 'close_blocked') return 'Blockiert den Abschluss';
  if (severity === 'approval_required') return 'Freigabe erforderlich';
  return 'Information';
}

// A running session blocks the close in the database. It joins the card of
// its kind from the live sessions, also when the calculation predates it.
function liveSessionFinding(session: OpenPeriodSession): PeriodFinding {
  return {
    id: `live-session:${session.employeeRecordId}`,
    employeeRecordId: session.employeeRecordId,
    employeeName: session.employeeName,
    kind: session.status === 'recovery_required' ? 'recovery_session' : 'open_session',
    severity: 'close_blocked',
    explanation: { startedAt: session.startedAt },
    decision: null,
    canApprove: false,
  };
}

function isSessionFinding(finding: PeriodFinding): boolean {
  return finding.kind === 'open_session' || finding.kind === 'recovery_session';
}

function peopleCountText(findings: readonly PeriodFinding[]): string {
  const people = new Set(findings.flatMap((finding) => finding.employeeRecordId ?? []));
  if (people.size === 0) return 'Organisation';
  return people.size === 1 ? '1 Person' : `${people.size} Personen`;
}

/** What fixes the group, a link to where when the viewer may do it, „Nur Admin“ when not. */
function FindingFixLine({ fix, viewer }: { fix: PeriodFindingFix; viewer: FindingViewer }): ReactElement {
  const canFix = canFixFinding(fix, viewer);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {!canFix && fix.fixedBy !== 'manager' ? (
        <Badge variant="outline">{FINDING_FIXER_LABELS[fix.fixedBy]}</Badge>
      ) : null}
      <span>{fix.instruction}</span>
      {canFix && fix.target !== 'person' ? (
        <Button asChild variant="outline" size="sm">
          <Link href={fix.target.href}>{fix.target.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

/** The day, time, activity and minutes of each entry „Zeit ohne Zuordnung“ asks to approve. */
function UnallocatedTimeEntries({ finding }: { finding: PeriodFinding }) {
  const unallocated = readUnallocatedTime(finding.explanation);
  if (!unallocated)
    return (
      <p className="text-sm text-muted-foreground">
        Bereite den Monat neu vor, um Tag und Dauer der Zeiten zu sehen.
      </p>
    );
  return (
    <div className="space-y-1 text-sm">
      <p className="text-muted-foreground">
        {unallocated.entries.length === 1 ? '1 Zeit' : `${unallocated.entries.length} Zeiten`} ·{' '}
        {formatDuration(unallocated.minutes)}
      </p>
      <ul className="space-y-0.5 tabular-nums">
        {unallocated.entries.map((entry) => (
          <li key={`${entry.startedAt}:${entry.endedAt}:${entry.activityKind}`}>
            {formatBerlin(entry.date, 'weekdayDate')} · {formatBerlin(entry.startedAt, 'time')}–
            {formatBerlin(entry.endedAt, 'time')} · {activityLabel(entry.activityKind)} ·{' '}
            {formatDuration(entry.minutes)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The facts behind one person's finding that a decision needs. */
function FindingDetail({ finding }: { finding: PeriodFinding }) {
  if (finding.kind === 'unallocated_time') return <UnallocatedTimeEntries finding={finding} />;
  if (isSessionFinding(finding)) {
    const startedAt = finding.explanation.startedAt;
    return typeof startedAt === 'string' ? (
      <p className="text-sm text-muted-foreground">
        seit {formatBerlin(startedAt, 'shortDateTime')} · muss vor dem Abschluss beendet werden
      </p>
    ) : null;
  }
  if (finding.kind === 'positive_overtime') {
    const minutes = finding.explanation.minutes;
    return typeof minutes === 'number' ? (
      <p className="text-sm text-muted-foreground tabular-nums">{formatMinutes(minutes)}</p>
    ) : null;
  }
  // The days without a rule are the whole gap; the instruction above says how to close it.
  if (finding.kind === 'missing_policy') return null;
  const dates = readFindingDates(finding.explanation);
  return dates ? (
    <p className="text-sm text-muted-foreground">{dates.map(formatGermanDate).join(', ')}</p>
  ) : null;
}

/** Whether a person needs a row of their own: a decision, a link or facts to read. */
function needsPersonRows(
  group: PeriodFindingGroup,
  fix: PeriodFindingFix | undefined,
  viewer: FindingViewer,
) {
  if (group.severity === 'approval_required') return true;
  if (fix?.target === 'person' && canFixFinding(fix, viewer)) return true;
  if (group.findings.some(isSessionFinding)) return true;
  return group.findings.some(
    (finding) => finding.kind !== 'missing_policy' && readFindingDates(finding.explanation) !== null,
  );
}

function PersonFindingRow({
  finding,
  periodId,
  fix,
  viewer,
}: {
  finding: PeriodFinding;
  periodId: string;
  fix: PeriodFindingFix | undefined;
  viewer: FindingViewer;
}) {
  const name = finding.employeeName ?? 'Organisation';
  const personLink =
    fix?.target === 'person' && finding.employeeRecordId && canFixFinding(fix, viewer)
      ? personFixHref(finding.employeeRecordId)
      : null;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1 wrap-anywhere">
        <p className="font-medium">
          {name}
          {finding.decision ? (
            <span className="font-normal text-muted-foreground">
              {' '}
              · {FINDING_DECISION_LABELS[finding.decision]}
            </span>
          ) : null}
        </p>
        <FindingDetail finding={finding} />
      </div>
      {personLink ? (
        <Button asChild variant="outline" size="sm">
          <Link href={personLink} aria-label={`Arbeitszeitmodell öffnen: ${name}`}>
            Arbeitszeitmodell öffnen
          </Link>
        </Button>
      ) : null}
      {finding.severity === 'approval_required' && finding.decision !== 'approved' ? (
        <TimePeriodFindingDecisionForm
          periodId={periodId}
          findingId={finding.id}
          canApprove={finding.canApprove}
        />
      ) : null}
    </li>
  );
}

function FindingGroupCard({
  group,
  periodId,
  viewer,
}: {
  group: PeriodFindingGroup;
  periodId: string;
  viewer: FindingViewer;
}) {
  const fix = PERIOD_FINDING_FIXES[group.kind];
  const label = FINDING_LABELS[group.kind];
  return (
    <article aria-label={label} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <FindingIcon severity={group.severity} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="font-medium">
              {label}{' '}
              <span className="font-normal text-muted-foreground">· {peopleCountText(group.findings)}</span>
            </p>
            <p className="text-sm text-muted-foreground">{severityText(group.severity)}</p>
          </div>
          {fix ? <FindingFixLine fix={fix} viewer={viewer} /> : null}
        </div>
      </div>
      {needsPersonRows(group, fix, viewer) ? (
        <ul className="divide-y border-t pt-3">
          {group.findings.map((finding) => (
            <PersonFindingRow
              key={finding.id}
              finding={finding}
              periodId={periodId}
              fix={fix}
              viewer={viewer}
            />
          ))}
        </ul>
      ) : (
        <ul
          className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-sm"
          aria-label={`Betroffen: ${label}`}
        >
          {group.findings.map((finding) => (
            <li key={finding.id} className="min-w-0 max-w-full wrap-anywhere">
              {finding.employeeName ?? 'Organisation'}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * The period's Prüfhinweise: running sessions first, then one card per kind
 * with the people it affects, what fixes it and where.
 */
export function TimePeriodFindings({
  periodId,
  findings,
  liveSessions,
  viewer,
}: {
  periodId: string;
  findings: TimePeriodDetail['findings'];
  /** Running sessions the calculation has no finding for yet (the page filters them). */
  liveSessions: readonly OpenPeriodSession[];
  viewer: FindingViewer;
}): ReactElement {
  const groups = groupPeriodFindings([...findings, ...liveSessions.map(liveSessionFinding)]);
  return (
    <section className="space-y-3" aria-labelledby="time-period-findings-title">
      <h3 id="time-period-findings-title" className="font-semibold">
        Prüfhinweise
      </h3>
      <div className="space-y-2">
        {groups.length === 0 ? (
          <EmptyState size="compact" title="Keine Prüfhinweise." />
        ) : (
          groups.map((group) => (
            <FindingGroupCard
              key={`${group.severity}:${group.kind}`}
              group={group}
              periodId={periodId}
              viewer={viewer}
            />
          ))
        )}
      </div>
    </section>
  );
}
