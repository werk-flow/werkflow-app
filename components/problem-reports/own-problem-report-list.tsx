import { MessageSquareWarning } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ColumnsTableHeader,
  SkeletonList,
  SkeletonRows,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { PROBLEM_REPORT_STATUS_LABELS } from '@/lib/problem-reports/messages';
import type { OwnProblemReport, ProblemReportStatus } from '@/lib/problem-reports/types';
import { formatBerlinDateTime } from '@/lib/utils';

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

const REPORT_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'number', header: 'Nr.', className: 'w-[72px]', skeleton: <Skeleton className="h-5 w-8" /> },
  { id: 'sent', header: 'Gesendet', className: 'w-[150px]', skeleton: <Skeleton className="h-5 w-28" /> },
  {
    id: 'status',
    header: 'Status',
    className: 'w-[140px]',
    skeleton: <Skeleton className="h-[22px] w-24 rounded-full" />,
  },
  { id: 'description', header: 'Beschreibung', skeleton: <Skeleton className="h-5 w-56" /> },
  { id: 'response', header: 'Antwort vom Support', skeleton: <Skeleton className="h-5 w-40" /> },
];

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

/** The same frame as the loaded list, for the route's skeleton. */
export function OwnProblemReportListSkeleton() {
  return (
    <>
      <SkeletonList count={4} className="md:hidden">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-[22px] w-24 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <ColumnsTableHeader columns={REPORT_COLUMNS} />
          <TableBody>
            <SkeletonRows columns={REPORT_COLUMNS} rows={4} />
          </TableBody>
        </Table>
      </div>
    </>
  );
}
