import { MessageSquareWarning } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { ColumnsTableHeader } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { PROBLEM_REPORT_STATUS_LABELS } from '@/lib/problem-reports/messages';
import type { OwnProblemReport, ProblemReportStatus } from '@/lib/problem-reports/types';
import { formatBerlinDateTime } from '@/lib/utils';
import { REPORT_COLUMNS } from './own-problem-report-columns';

// „Meine Meldungen“: the caller's own reports with their status and
// support's answer. A report opens nothing, so no row hovers.

const STATUS_BADGE: Record<ProblemReportStatus, 'secondary' | 'success' | 'outline'> = {
  eingegangen: 'outline',
  in_bearbeitung: 'secondary',
  erledigt: 'success',
  abgelehnt: 'secondary',
};

const DELETED_DESCRIPTION = 'Die Beschreibung ist nach ihrer Frist gelöscht.';
const NO_RESPONSE = 'Noch keine Antwort';

function ReportStatusBadge({ status }: { status: ProblemReportStatus }) {
  return <Badge variant={STATUS_BADGE[status]}>{PROBLEM_REPORT_STATUS_LABELS[status]}</Badge>;
}

function ReportCard({ report }: { report: OwnProblemReport }) {
  return (
    <ListRow>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Nr. {report.number}</span>
          <ReportStatusBadge status={report.status} />
          <span className="text-xs text-muted-foreground">{formatBerlinDateTime(report.createdAt)}</span>
        </div>
        <p className="line-clamp-3 text-sm break-words">{report.description ?? DELETED_DESCRIPTION}</p>
        <p className="text-sm break-words text-muted-foreground">
          <span className="font-medium text-foreground">Antwort: </span>
          {report.response ?? NO_RESPONSE}
        </p>
      </div>
    </ListRow>
  );
}

export function OwnProblemReportList({ reports }: { reports: readonly OwnProblemReport[] }) {
  if (reports.length === 0) {
    return (
      <EmptyState
        icon={MessageSquareWarning}
        title="Noch keine Meldungen"
        description="Wenn etwas nicht funktioniert, tippe auf „Problem melden“. Hier siehst du dann den Stand und die Antwort vom Support."
      />
    );
  }
  return (
    <>
      <div className="space-y-2 md:hidden">
        {reports.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </div>
      <div className="hidden md:block">
        <Table>
          <ColumnsTableHeader columns={REPORT_COLUMNS} />
          <TableBody>
            {reports.map((report) => (
              <TableRow key={report.id}>
                <TableCell className="font-medium tabular-nums">{report.number}</TableCell>
                <TableCell className="tabular-nums">{formatBerlinDateTime(report.createdAt)}</TableCell>
                <TableCell>
                  <ReportStatusBadge status={report.status} />
                </TableCell>
                <TableCell className="whitespace-normal break-words">
                  <span className="line-clamp-3">{report.description ?? DELETED_DESCRIPTION}</span>
                </TableCell>
                <TableCell className="whitespace-normal break-words text-muted-foreground">
                  {report.response ?? NO_RESPONSE}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
