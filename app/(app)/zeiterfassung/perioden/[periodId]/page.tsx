import { notFound } from 'next/navigation';
import { AlertTriangle, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { formatGermanDate } from '@/lib/utils';
import { TimePeriodCloseForm } from '@/components/zeiterfassung/time-period-close-form';
import { TimePeriodFindingDecisionForm } from '@/components/zeiterfassung/time-period-finding-decision-form';
import {
  TimePeriodExportDownload,
  TimePeriodExportForm,
} from '@/components/zeiterfassung/time-period-payroll-export';
import { TimePeriodReopenForm } from '@/components/zeiterfassung/time-period-reopen-form';
import { TimePeriodResults } from '@/components/zeiterfassung/time-period-results';
import { getTimeAccountAccess } from '@/lib/time-accounts/actions';
import { TIME_PERIOD_DETAIL_LIVE_TABLES } from '@/lib/time-accounts/live-tables';
import {
  FINDING_DECISION_LABELS,
  FINDING_LABELS,
  formatPeriod,
  PAYROLL_EXPORT_STATE_LABELS,
  PERIOD_STATE_LABELS,
} from '@/lib/time-accounts/presentation';
import {
  getTimePeriodDetail,
  type OpenPeriodSession,
  type TimePeriodDetail,
} from '@/lib/time-accounts/queries';

const SESSION_START_FORMAT = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});

function FindingIcon({ severity }: { severity: string }) {
  if (severity === 'close_blocked')
    return <AlertTriangle aria-hidden="true" className="size-4 text-destructive" />;
  if (severity === 'approval_required')
    return <AlertTriangle aria-hidden="true" className="size-4 text-warning-text" />;
  return <Info aria-hidden="true" className="size-4 text-muted-foreground" />;
}

// A running session blocks the close in the database. It shows as a blocking
// finding from the live sessions, also when the calculation predates it.
function OpenSessionFinding({ session }: { session: OpenPeriodSession }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
      <FindingIcon severity="close_blocked" />
      <div>
        <p className="font-medium">
          {session.status === 'recovery_required'
            ? FINDING_LABELS.recovery_session
            : FINDING_LABELS.open_session}
        </p>
        <p className="text-sm text-muted-foreground">
          {session.employeeName} · seit {SESSION_START_FORMAT.format(new Date(session.startedAt))} · muss vor
          dem Abschluss beendet werden
        </p>
      </div>
    </div>
  );
}

function PeriodFindingRow({
  finding,
  periodId,
}: {
  finding: TimePeriodDetail['findings'][number];
  periodId: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <FindingIcon severity={finding.severity} />
        <div>
          <p className="font-medium">
            {FINDING_LABELS[finding.kind as keyof typeof FINDING_LABELS] ?? finding.kind}
          </p>
          <p className="text-sm text-muted-foreground">
            {finding.employeeName ?? 'Organisation'} ·{' '}
            {finding.severity === 'close_blocked'
              ? 'muss vor dem Abschluss behoben werden'
              : finding.severity === 'approval_required'
                ? 'Freigabe erforderlich'
                : 'Information'}
            {finding.decision
              ? ` · ${FINDING_DECISION_LABELS[finding.decision as keyof typeof FINDING_DECISION_LABELS] ?? finding.decision}`
              : ''}
          </p>
        </div>
      </div>
      {finding.severity === 'approval_required' && finding.decision !== 'approved' ? (
        <TimePeriodFindingDecisionForm
          periodId={periodId}
          findingId={finding.id}
          findingLabel={FINDING_LABELS[finding.kind as keyof typeof FINDING_LABELS] ?? finding.kind}
        />
      ) : null}
    </div>
  );
}

export default async function TimePeriodDetailPage({ params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;
  const [detailRead, access] = await Promise.all([getTimePeriodDetail(periodId), getTimeAccountAccess()]);
  if (!detailRead.success)
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <LiveRouteRefresh tables={TIME_PERIOD_DETAIL_LIVE_TABLES} />
        <RegionLoadError title="Die Periode konnte nicht geladen werden">
          Monatswerte und Prüfhinweise sind gerade nicht erreichbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      </div>
    );
  const detail = detailRead.data;
  if (!detail) notFound();
  const unresolvedApprovalCount = detail.findings.filter(
    (finding) => finding.severity === 'approval_required' && finding.decision !== 'approved',
  ).length;
  const sessionFindingEmployees = new Set(
    detail.findings.flatMap((finding) =>
      (finding.kind === 'open_session' || finding.kind === 'recovery_session') && finding.employeeRecordId
        ? [finding.employeeRecordId]
        : [],
    ),
  );
  const liveSessions = detail.openSessions.filter(
    (session) => !sessionFindingEmployees.has(session.employeeRecordId),
  );
  const blockedCount =
    detail.findings.filter((finding) => finding.severity === 'close_blocked').length + liveSessions.length;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <LiveRouteRefresh tables={TIME_PERIOD_DETAIL_LIVE_TABLES} />
      <SubpageHeader
        title={<span className="capitalize">{formatPeriod(detail.period.startDate)}</span>}
        description={`${formatGermanDate(detail.period.startDate)} – ${formatGermanDate(detail.period.endDate)} · ${
          PERIOD_STATE_LABELS[detail.period.state as keyof typeof PERIOD_STATE_LABELS] ?? detail.period.state
        }`}
      />

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm text-muted-foreground">Mitarbeitende</CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-2xl font-semibold">{detail.results.length}</CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm text-muted-foreground">Freigaben offen</CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-2xl font-semibold">{unresolvedApprovalCount}</CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm text-muted-foreground">Abschluss blockiert</CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-2xl font-semibold">{blockedCount}</CardContent>
        </Card>
      </div>

      <section className="space-y-3" aria-labelledby="time-period-results-title">
        <h3 id="time-period-results-title" className="font-semibold">
          Monatswerte
        </h3>
        <TimePeriodResults results={detail.results} />
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Prüfhinweise</h3>
        <div className="space-y-2">
          {liveSessions.map((session) => (
            <OpenSessionFinding key={session.employeeRecordId} session={session} />
          ))}
          {detail.findings.length === 0 && liveSessions.length === 0 ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">Keine Prüfhinweise.</p>
          ) : (
            detail.findings.map((finding) => (
              <PeriodFindingRow key={finding.id} finding={finding} periodId={periodId} />
            ))
          )}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Periodenabschluss</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {detail.period.state !== 'closed' ? (
            <TimePeriodCloseForm
              periodId={periodId}
              blocked={!detail.calculation || blockedCount > 0 || unresolvedApprovalCount > 0}
            />
          ) : null}
          {detail.period.state === 'closed' && access.isAdmin ? (
            <TimePeriodReopenForm periodId={periodId} />
          ) : null}
          {!detail.calculation ? (
            <p className="text-sm text-muted-foreground">Die Periode muss zuerst vorbereitet werden.</p>
          ) : null}
          {detail.calculation && blockedCount > 0 ? (
            <p className="text-sm text-destructive" role="status">
              {blockedCount === 1
                ? 'Ein blockierender Hinweis muss zuerst behoben werden.'
                : `${blockedCount} blockierende Hinweise müssen zuerst behoben werden.`}
            </p>
          ) : null}
          {detail.calculation && unresolvedApprovalCount > 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              {unresolvedApprovalCount === 1
                ? 'Eine Freigabe ist noch offen.'
                : `${unresolvedApprovalCount} Freigaben sind noch offen.`}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lohnexport</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {detail.period.state === 'closed' ? (
            <TimePeriodExportForm periodId={periodId} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Der Export wird nach dem Abschluss freigeschaltet.
            </p>
          )}
          {detail.exports.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
              <span>
                Version {item.version} ·{' '}
                {PAYROLL_EXPORT_STATE_LABELS[item.state as keyof typeof PAYROLL_EXPORT_STATE_LABELS] ??
                  item.state}
              </span>
              {item.state === 'ready' ? <TimePeriodExportDownload exportId={item.id} /> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
