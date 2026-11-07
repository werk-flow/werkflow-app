import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { formatGermanDate } from '@/lib/utils';
import { TimePeriodCloseForm } from '@/components/zeiterfassung/time-period-close-form';
import { TimePeriodFindings } from '@/components/zeiterfassung/time-period-findings';
import {
  TimePeriodExportDownload,
  TimePeriodExportForm,
} from '@/components/zeiterfassung/time-period-payroll-export';
import { TimePeriodReopenForm } from '@/components/zeiterfassung/time-period-reopen-form';
import { TimePeriodResults } from '@/components/zeiterfassung/time-period-results';
import { getTimeAccountAccess } from '@/lib/time-accounts/actions';
import { TIME_PERIOD_DETAIL_LIVE_TABLES } from '@/lib/time-accounts/live-tables';
import {
  formatPeriod,
  PAYROLL_EXPORT_STATE_LABELS,
  PERIOD_STATE_LABELS,
} from '@/lib/time-accounts/presentation';
import {
  getTimePeriodDetail,
  type OpenPeriodSession,
  type TimePeriodDetail,
} from '@/lib/time-accounts/queries';

/** The period's payroll export: Admin and Büro build it and download its versions. */
function PayrollExportCard({
  periodId,
  detail,
}: {
  periodId: string;
  detail: Pick<TimePeriodDetail, 'period' | 'exports'>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lohnexport</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {detail.period.state === 'closed' ? (
          <TimePeriodExportForm periodId={periodId} />
        ) : (
          <p className="text-sm text-muted-foreground">Der Export wird nach dem Abschluss freigeschaltet.</p>
        )}
        {detail.exports.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
            <span>
              Version {item.version} · {PAYROLL_EXPORT_STATE_LABELS[item.state]}
            </span>
            {item.state === 'ready' ? <TimePeriodExportDownload exportId={item.id} /> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// The close's blockers: open approvals, blocking findings, and running
// sessions the calculation has no finding for yet.
function periodCloseState(detail: TimePeriodDetail): {
  unresolvedApprovalCount: number;
  liveSessions: OpenPeriodSession[];
  blockedCount: number;
} {
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
  return { unresolvedApprovalCount, liveSessions, blockedCount };
}

function PeriodSummaryCards({
  employeeCount,
  unresolvedApprovalCount,
  blockedCount,
}: {
  employeeCount: number;
  unresolvedApprovalCount: number;
  blockedCount: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      <Card className="gap-2 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm text-muted-foreground">Mitarbeitende</CardTitle>
        </CardHeader>
        <CardContent className="px-4 text-2xl font-semibold">{employeeCount}</CardContent>
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
  );
}

/** What still blocks the close, one sentence each, in the order the page shows them. */
function closeBlockerSentences(input: {
  hasCalculation: boolean;
  blockedCount: number;
  unresolvedApprovalCount: number;
}): string[] {
  const { hasCalculation, blockedCount, unresolvedApprovalCount } = input;
  if (!hasCalculation) return ['Die Periode muss zuerst vorbereitet werden.'];
  return [
    ...(blockedCount === 1 ? ['Ein blockierender Hinweis muss zuerst behoben werden.'] : []),
    ...(blockedCount > 1 ? [`${blockedCount} blockierende Hinweise müssen zuerst behoben werden.`] : []),
    ...(unresolvedApprovalCount === 1 ? ['Eine Freigabe ist noch offen.'] : []),
    ...(unresolvedApprovalCount > 1 ? [`${unresolvedApprovalCount} Freigaben sind noch offen.`] : []),
  ];
}

/** Close or reopen the period; a press while something blocks the close names it. */
function PeriodCloseCard({
  periodId,
  detail,
  isAdmin,
  blockedCount,
  unresolvedApprovalCount,
}: {
  periodId: string;
  detail: Pick<TimePeriodDetail, 'period' | 'calculation'>;
  isAdmin: boolean;
  blockedCount: number;
  unresolvedApprovalCount: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Periodenabschluss</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {detail.period.state !== 'closed' ? (
          <TimePeriodCloseForm
            periodId={periodId}
            blockers={closeBlockerSentences({
              hasCalculation: detail.calculation !== null,
              blockedCount,
              unresolvedApprovalCount,
            })}
          />
        ) : null}
        {detail.period.state === 'closed' && isAdmin ? <TimePeriodReopenForm periodId={periodId} /> : null}
      </CardContent>
    </Card>
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
  const { unresolvedApprovalCount, liveSessions, blockedCount } = periodCloseState(detail);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <LiveRouteRefresh tables={TIME_PERIOD_DETAIL_LIVE_TABLES} />
      <SubpageHeader
        title={<span className="capitalize">{formatPeriod(detail.period.startDate)}</span>}
        description={`${formatGermanDate(detail.period.startDate)} – ${formatGermanDate(detail.period.endDate)} · ${
          PERIOD_STATE_LABELS[detail.period.state]
        }`}
      />

      <PeriodSummaryCards
        employeeCount={detail.results.length}
        unresolvedApprovalCount={unresolvedApprovalCount}
        blockedCount={blockedCount}
      />

      <section className="space-y-3" aria-labelledby="time-period-results-title">
        <h3 id="time-period-results-title" className="font-semibold">
          Monatswerte
        </h3>
        <TimePeriodResults results={detail.results} />
      </section>

      <TimePeriodFindings
        periodId={periodId}
        findings={detail.findings}
        liveSessions={liveSessions}
        viewer={{ isAdmin: access.isAdmin, isOffice: access.isOffice }}
      />

      <PeriodCloseCard
        periodId={periodId}
        detail={detail}
        isAdmin={access.isAdmin}
        blockedCount={blockedCount}
        unresolvedApprovalCount={unresolvedApprovalCount}
      />

      {access.canExportPayroll ? <PayrollExportCard periodId={periodId} detail={detail} /> : null}
    </div>
  );
}
