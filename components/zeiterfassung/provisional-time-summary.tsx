'use client';

import { ClockAlert } from 'lucide-react';

import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { getProvisionalTimeSummary } from '@/lib/time-corrections/actions';

function formatMinutes(value: number): string {
  const absolute = Math.abs(value);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  const parts = [
    hours > 0 ? `${hours} Std.` : '',
    minutes > 0 ? `${minutes} Min.` : '',
  ].filter(Boolean);
  return `${value >= 0 ? '+' : '−'}${parts.join(' ') || '0 Min.'}`;
}

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
    read: async (): Promise<LiveViewResult<{
      count: number;
      beforeMinutes: number;
      proposedMinutes: number;
    }>> => {
      const result = await getProvisionalTimeSummary({ organizationId, userId });
      return result.success ? { ok: true, data: result } : { ok: false };
    },
    resetKey: `${organizationId}:${userId}`,
  });
  const summary = view.data;
  if (!summary || summary.count === 0) return null;
  const delta = summary.proposedMinutes - summary.beforeMinutes;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
      <ClockAlert className="mt-0.5 size-4 shrink-0 text-yellow-700 dark:text-yellow-300" />
      <div>
        <p className="font-medium">Vorgemerkte Zeit: {formatMinutes(delta)}</p>
        <p className="text-muted-foreground">
          {summary.count === 1 ? 'Eine Korrektur wartet' : `${summary.count} Korrekturen warten`} auf eine Entscheidung. Diese Änderung ist noch nicht in den freigegebenen Summen enthalten.
        </p>
      </div>
    </div>
  );
}
