'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { ClockAlert } from 'lucide-react';

import { SectionError } from '@/components/ui/section-error';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import type { ProvisionalTimeSummary as ProvisionalTimeSummaryData } from '@/lib/time-corrections/provisional-summary';
import { formatSignedDuration } from '@/lib/time-tracking/helpers';
import { formatBerlin } from '@/lib/utils';

const dayList = new Intl.ListFormat('de', { type: 'conjunction' });

/** „Eine Korrektur und ein Nachtrag für Mo., 26.10. warten auf eine Entscheidung.“, naming every day they change. */
function pendingSentence({ count, submissionCount, days }: ProvisionalTimeSummaryData): string {
  const parts = [
    count === 0 ? null : count === 1 ? 'eine Korrektur' : `${count} Korrekturen`,
    submissionCount === 0 ? null : submissionCount === 1 ? 'ein Nachtrag' : `${submissionCount} Nachträge`,
  ].filter((part) => part !== null);
  const subject = parts.join(' und ');
  const forDays =
    days.length > 0 ? ` für ${dayList.format(days.map((day) => formatBerlin(day, 'weekdayDayMonth')))}` : '';
  const verb = count + submissionCount === 1 ? 'wartet' : 'warten';
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)}${forDays} ${verb} auf eine Entscheidung.`;
}

export function ProvisionalTimeSummary({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) {
  const view = useLiveView<ProvisionalTimeSummaryData>({
    tables: ['time_correction_requests', 'time_entries'],
    read: async ({ signal }): Promise<LiveViewResult<ProvisionalTimeSummaryData>> => {
      const result = await readInBackground('provisional-time-summary', { organizationId, userId }, signal);
      return result.success ? { ok: true, data: result } : { ok: false };
    },
    resetKey: `${organizationId}:${userId}`,
  });
  const summary = view.data;
  if (view.isLoading) return null;
  // A failed read is not "no pending corrections": say so and offer a retry.
  if (!summary) {
    return (
      <SectionError className="mb-4" onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
        Offene Korrekturen und Nachträge konnten nicht geladen werden.
      </SectionError>
    );
  }
  if (summary.count + summary.submissionCount === 0) return null;
  const delta = summary.proposedMinutes - summary.beforeMinutes;
  return (
    <StaleRegion stale={view.isStale} onRetry={view.refresh}>
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
        <ClockAlert className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground" />
        <div>
          <p className="font-medium">Vorgemerkte Zeit: {formatSignedDuration(delta)}</p>
          <p className="text-muted-foreground">
            {pendingSentence(summary)} Diese Änderung ist noch nicht in den freigegebenen Summen enthalten.
          </p>
        </div>
      </div>
    </StaleRegion>
  );
}
