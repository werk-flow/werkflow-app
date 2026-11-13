import { ReportStatusBadge } from '@/components/problem-reports/report-status-badge';
import { DetailColumns } from '@/components/shared/detail-columns';
import { SectionTitle } from '@/components/shared/section-title';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PROBLEM_REPORT_STATUS_LABELS } from '@/lib/problem-reports/messages';
import { PROBLEM_REPORT_BUCKET_LABELS } from '@/lib/problem-reports/support-messages';
import type { SupportReport, SupportReportHistoryEntry } from '@/lib/problem-reports/types';
import { formatBerlinDateTime } from '@/lib/utils';
import { SupportOriginalSection } from './support-original-section';
import { ReportContext } from './report-context';
import { BucketBadge, ScrubbedText } from './report-labels';
import { SupportTriageForm } from './support-triage-form';

// One report as support works on it: the scrubbed copy and the redrawn
// screenshot, the triage form, the original behind its own button, and the
// history of every change and opening.

function historySentence(change: SupportReportHistoryEntry['change']): string {
  switch (change.kind) {
    case 'status':
      return change.to
        ? `Status auf „${PROBLEM_REPORT_STATUS_LABELS[change.to]}“ gesetzt`
        : 'Status geändert';
    case 'bucket':
      return change.to
        ? `Als „${PROBLEM_REPORT_BUCKET_LABELS[change.to]}“ eingeordnet`
        : 'Einordnung entfernt';
    case 'assignee':
      return change.toName ? `Zuständig: ${change.toName}` : 'Zuständigkeit entfernt';
    case 'response':
      return 'Antwort an die Person geändert';
    case 'original_opened':
      return change.attachment ? 'Anhang heruntergeladen' : 'Original geöffnet';
    case 'handed_out':
      return change.part === 'copy' ? 'Bereinigte Kopie abgerufen' : 'Screenshot abgerufen';
  }
}

function ReportHistory({ history }: { history: readonly SupportReportHistoryEntry[] }) {
  if (history.length === 0)
    return (
      <EmptyState
        size="compact"
        title="Noch keine Einträge."
        description="Jede Änderung und jedes Öffnen des Originals steht hier."
      />
    );
  return (
    <ol className="divide-y">
      {history.map((entry) => (
        <li key={entry.id} className="py-2 text-sm first:pt-0 last:pb-0">
          <p className="break-words">{historySentence(entry.change)}</p>
          <p className="text-xs text-muted-foreground">
            {entry.actorName} · {formatBerlinDateTime(entry.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function ReportScreenshot({ url }: { url: string | null }) {
  if (!url) return <p className="text-sm text-muted-foreground">Ohne Screenshot gesendet.</p>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed private URL; next/image optimization cannot cache it
    <img
      src={url}
      alt="Neu gezeichneter Screenshot der Meldung, mit Platzhaltern statt Kundendaten"
      className="h-auto max-h-[70dvh] w-full rounded-lg border object-contain"
    />
  );
}

export function SupportReportDetail({ report }: { report: SupportReport }) {
  return (
    <DetailColumns layout="main-and-wide-aside">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle as="h2">Meldung</SectionTitle>
              <ReportStatusBadge status={report.status} />
              <BucketBadge bucket={report.bucket} />
            </div>
            <p className="text-xs text-muted-foreground">
              Gesendet am {formatBerlinDateTime(report.createdAt)}
              {report.filedForCaller ? ' · telefonisch aufgenommen' : ''}
            </p>
            <p className="text-sm break-words">
              <ScrubbedText entry={report} />
            </p>
            {report.scrubbedDescription === null ? null : <ReportContext context={report.scrubbedContext} />}
            <ReportScreenshot url={report.screenshotUrl} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-4">
            <SectionTitle as="h2">Original</SectionTitle>
            <SupportOriginalSection report={report} />
          </CardContent>
        </Card>
      </div>
      <div className="min-w-0 space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <SectionTitle as="h2">Bearbeitung</SectionTitle>
            <SupportTriageForm report={report} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-4">
            <SectionTitle as="h2">Verlauf</SectionTitle>
            <ReportHistory history={report.history} />
          </CardContent>
        </Card>
      </div>
    </DetailColumns>
  );
}
