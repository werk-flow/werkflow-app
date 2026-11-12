import { Badge } from '@/components/ui/badge';
import {
  PROBLEM_REPORT_BUCKET_LABELS,
  REPORT_WITHOUT_TEXT,
  UNSCRUBBED_NOTICES,
} from '@/lib/problem-reports/support-messages';
import type { SupportQueueEntry } from '@/lib/problem-reports/types';

// How a report's bucket and its scrubbed copy read in support's queue and on
// a report's page.

/** A report no bucket was chosen for yet. */
export const NOT_SORTED = 'Nicht eingeordnet';

export function BucketBadge({ bucket }: { bucket: SupportQueueEntry['bucket'] }) {
  if (bucket === null) return <span className="text-sm text-muted-foreground">{NOT_SORTED}</span>;
  return (
    <Badge variant={bucket === 'blocker' ? 'destructive' : 'secondary'}>
      {PROBLEM_REPORT_BUCKET_LABELS[bucket]}
    </Badge>
  );
}

/** The scrubbed copy, or what stands in for it while the report has none. */
export function ScrubbedText({ entry, clamp }: { entry: SupportQueueEntry; clamp?: boolean }) {
  if (entry.scrubState !== 'bereinigt' || entry.scrubbedDescription === null)
    return (
      <span className="text-muted-foreground italic">
        {entry.originalsDeleted
          ? REPORT_WITHOUT_TEXT
          : UNSCRUBBED_NOTICES[entry.scrubState === 'nicht_bereinigbar' ? 'nicht_bereinigbar' : 'ausstehend']}
      </span>
    );
  return <span className={clamp ? 'line-clamp-2' : 'whitespace-pre-wrap'}>{entry.scrubbedDescription}</span>;
}
