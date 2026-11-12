import { Badge } from '@/components/ui/badge';
import { PROBLEM_REPORT_STATUS_LABELS } from '@/lib/problem-reports/messages';
import type { ProblemReportStatus } from '@/lib/problem-reports/types';

const STATUS_BADGE: Record<ProblemReportStatus, 'secondary' | 'success' | 'outline'> = {
  eingegangen: 'outline',
  in_bearbeitung: 'secondary',
  erledigt: 'success',
  abgelehnt: 'secondary',
};

/** A report's status, in the one style its reporter and support both read. */
export function ReportStatusBadge({ status }: { status: ProblemReportStatus }) {
  return <Badge variant={STATUS_BADGE[status]}>{PROBLEM_REPORT_STATUS_LABELS[status]}</Badge>;
}
