'use client';

import { getLocalDayEnd, getLocalDayStart } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { isCorrectionEventFor } from '@/lib/time-tracking/clock-state-events';
import { memberStatusOf, type MemberStatus } from '@/lib/time-tracking/member-day';
import { readInBackground, type BackgroundReadFailure } from '@/lib/data/background-read-client';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { breakPolicyKey, type BreakPolicy } from '@/lib/time-tracking/settings';
import type { GetTimeEntriesParams, GetTimeEntriesResult } from '@/lib/time-tracking/types';

type MemberStatusMap = Record<string, MemberStatus>;

const EMPTY_STATUS_MAP: MemberStatusMap = {};

function fetchTimeEntries(
  params: GetTimeEntriesParams,
  signal: AbortSignal,
): Promise<GetTimeEntriesResult | BackgroundReadFailure> {
  return readInBackground('time-entries', params, signal);
}

interface UseMemberStatusOptions {
  organizationId: string;
  memberIds: string[];
  /** The break rule with its earlier versions: a day after clock-out counts by the one at its last entry. */
  breakPolicy: BreakPolicy;
  /** Enable or disable fetching. Default: true */
  enabled?: boolean;
}

export function useMemberStatus({
  organizationId,
  memberIds,
  breakPolicy,
  enabled = true,
}: UseMemberStatusOptions): {
  statusMap: MemberStatusMap;
  isLoading: boolean;
  /** A refresh failed: the statuses are last-known. `error` stays null when the read threw. */
  isStale: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const view = useLiveView<MemberStatusMap>({
    // An approved correction changes the day: its approval updates the request.
    // The filter below reads only for the shown members' requests.
    tables: [
      'time_entries',
      'time_sessions',
      'time_segments',
      'time_correction_requests',
      'organization_settings',
    ],
    eventFilter: (event) => isCorrectionEventFor(event, memberIds),
    read: async ({ signal }): Promise<LiveViewResult<MemberStatusMap>> => {
      if (!organizationId || memberIds.length === 0) {
        return { ok: true, data: EMPTY_STATUS_MAP };
      }

      try {
        // Today's Berlin day, wherever the browser's clock is set.
        const now = new Date();

        // Fetch all entries for today
        // A route handler keeps this live client read independent from the
        // current React Server Component tree. A server-action read can
        // complete after a link click and restore the page it started from.
        const result = await fetchTimeEntries(
          {
            organizationId,
            from: getLocalDayStart(now).toISOString(),
            to: getLocalDayEnd(now).toISOString(),
          },
          signal,
        );

        if (!result.success) {
          return { ok: false, error: result.error };
        }

        // Group entries by user and calculate status
        const newStatusMap: MemberStatusMap = {};

        for (const memberId of memberIds) {
          const memberEntries = result.entries.filter((e) => e.userId === memberId);

          newStatusMap[memberId] = memberStatusOf(memberEntries, breakPolicy);
        }

        return { ok: true, data: newStatusMap };
      } catch (err) {
        logError('member_status.read_failed', err);
        return { ok: false, error: 'Failed to fetch status' };
      }
    },
    enabled,
    // Membership or break-policy changes must discard the old map and read
    // fresh. The read then uses the current inputs through its closure.
    resetKey: `${organizationId}:${[...memberIds].sort().join(',')}:${breakPolicyKey(breakPolicy)}`,
  });

  return {
    statusMap: view.data ?? EMPTY_STATUS_MAP,
    isLoading: view.isLoading,
    isStale: view.isStale,
    error: view.error,
    refetch: view.refresh,
  };
}
