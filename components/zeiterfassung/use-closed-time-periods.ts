'use client';

import { useLiveView } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import { closedPeriodsToHide, type ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';

/**
 * The organization's closed periods, so a surface that edits recorded time
 * offers no edit the server refuses with `period_closed`. A manager sees a
 * close or reopen live. Until the read lands, or when a refresh fails, the
 * list is empty (`closedPeriodsToHide`): the edit stays offered and the server's refusal is the backstop, so
 * a failed read blocks nothing and needs no surface of its own.
 */
export function useClosedTimePeriods(
  organizationId: string | null,
  enabled: boolean = true,
): readonly ClosedTimePeriod[] {
  const view = useLiveView<readonly ClosedTimePeriod[]>({
    tables: ['time_periods'],
    enabled: enabled && organizationId !== null,
    resetKey: organizationId,
    read: async ({ signal }) => {
      if (!organizationId) return { ok: false };
      const result = await readInBackground('closed-time-periods', { organizationId }, signal);
      return result.success ? { ok: true, data: result.periods } : { ok: false };
    },
  });
  return closedPeriodsToHide(view.data, view.isStale);
}
