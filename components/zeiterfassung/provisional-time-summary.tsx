'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { ClockAlert } from 'lucide-react';

import { SectionError } from '@/components/ui/section-error';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import { formatSignedDuration } from '@/lib/time-tracking/helpers';

export function ProvisionalTimeSummary({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) {
  const view = useLiveView<{
    count: number;
    beforeMinutes: number;
    proposedMinutes: number;
  }>({
    tables: ['time_correction_requests'],
    read: async ({
      signal,
    }): Promise<
      LiveViewResult<{
        count: number;
        beforeMinutes: number;
        proposedMinutes: number;
      }>
    > => {
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
        Offene Zeitkorrekturen konnten nicht geladen werden.
      </SectionError>
    );
  }
  if (summary.count === 0) return null;
  const delta = summary.proposedMinutes - summary.beforeMinutes;
  return (
    <StaleRegion stale={view.isStale} onRetry={view.refresh}>
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
        <ClockAlert className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground" />
        <div>
          <p className="font-medium">Vorgemerkte Zeit: {formatSignedDuration(delta)}</p>
          <p className="text-muted-foreground">
            {summary.count === 1 ? 'Eine Korrektur wartet' : `${summary.count} Korrekturen warten`} auf eine
            Entscheidung. Diese Änderung ist noch nicht in den freigegebenen Summen enthalten.
          </p>
        </div>
      </div>
    </StaleRegion>
  );
}
