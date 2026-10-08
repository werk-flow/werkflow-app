'use client';

import { Briefcase, Clock, ExternalLink, User } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time-tracking/helpers';
import type { EntryDetailsResolvedJob } from './use-entry-details-resolved-job';

function DetailCard({
  icon,
  label,
  value,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick?: (() => void) | undefined;
  disabled?: boolean;
}) {
  const interactive = !!onClick && !disabled;

  return (
    <PlainButton
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={cn(
        'flex w-full items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-left text-sm transition-colors',
        interactive && 'cursor-pointer hover:bg-accent',
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
      {interactive && <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />}
    </PlainButton>
  );
}

type EntryDetailsSummaryProps = {
  employeeName: string | null;
  employeeDetailUrl: string | null;
  resolvedJob: EntryDetailsResolvedJob | null;
  jobDetailUrl: string | null;
  isOrphan: boolean;
  isActiveBlock: boolean;
  totalWorkMinutes: number | null;
  /** Closes the dialog and opens the linked detail page. */
  onNavigate: (url: string) => void;
};

/** Who worked on what, and the net work time of the opened block. */
export function EntryDetailsSummary({
  employeeName,
  employeeDetailUrl,
  resolvedJob,
  jobDetailUrl,
  isOrphan,
  isActiveBlock,
  totalWorkMinutes,
  onNavigate,
}: EntryDetailsSummaryProps) {
  const showBlockScopedTotalHint = !isOrphan;

  return (
    <>
      {employeeName && (
        <DetailCard
          icon={<User className="size-4" />}
          label="Mitarbeiter"
          value={employeeName}
          onClick={employeeDetailUrl ? () => onNavigate(employeeDetailUrl) : undefined}
          disabled={!employeeDetailUrl}
        />
      )}

      {resolvedJob && (
        <DetailCard
          icon={<Briefcase className="size-4" />}
          label="Auftrag"
          value={resolvedJob.title}
          onClick={jobDetailUrl ? () => onNavigate(jobDetailUrl) : undefined}
          disabled={!jobDetailUrl}
        />
      )}

      {!isOrphan && totalWorkMinutes !== null && (
        <div
          className={cn(
            'rounded-md border border-success/30 bg-success-soft px-3 py-3',
            isActiveBlock && 'animate-live',
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-success-soft-foreground" />
              <span className="text-sm font-medium">Arbeitszeit gesamt</span>
            </div>
            <span className="text-base font-semibold text-success-soft-foreground">
              {formatDuration(totalWorkMinutes)}
            </span>
          </div>
          {showBlockScopedTotalHint && (
            <p className="mt-2 text-xs text-muted-foreground">
              Bezieht sich nur auf diesen geöffneten Arbeitsblock, nicht auf den gesamten Tag.
            </p>
          )}
        </div>
      )}
    </>
  );
}
