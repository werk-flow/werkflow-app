'use client';

import { useCallback, useMemo, useState } from 'react';

import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { useLiveView, type LiveViewResult, type LiveViewState } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import {
  DISPATCH_OVERVIEW_MAX_OFFSET_DAYS,
  dispatchErrorMessage,
  type DispatchOverview,
  type DispatchOverviewOccurrence,
  type DispatchRecipientView,
} from '@/lib/dispatch/types';
import { getBusinessTodayIso, shiftIsoDateByDays } from '@/lib/personnel/types';

export type DispatchPanelOpenChallenge = {
  entry: DispatchOverviewOccurrence;
  recipient: DispatchRecipientView;
  acknowledgementId: string;
};

/** The live dispatch overview of the coming days and what the panel derives from it. */
export function useDispatchPanelOverview(): {
  today: string;
  overview: DispatchOverview | null;
  loadError: string | null;
  /** A refresh failed: the overview is last-known and its row actions are inert. */
  isStale: boolean;
  refresh: LiveViewState<DispatchOverview>['refresh'];
  openChallenges: DispatchPanelOpenChallenge[];
} {
  // The window starts today; a panel left open overnight reads the new day's
  // window fresh instead of keeping yesterday's.
  const [today, setToday] = useState(getBusinessTodayIso);
  useBusinessDayRefresh(useCallback(() => setToday(getBusinessTodayIso()), []));

  const view = useLiveView<DispatchOverview>({
    tables: [
      'planning_dispatches',
      'planning_dispatch_recipients',
      'planning_dispatch_acknowledgements',
      'planning_customer_commitments',
      'planning_occurrences',
      'planning_occurrence_assignments',
    ],
    read: async ({ signal }): Promise<LiveViewResult<DispatchOverview>> => {
      const result = await readInBackground(
        'dispatch-overview',
        { from: today, to: shiftIsoDateByDays(today, DISPATCH_OVERVIEW_MAX_OFFSET_DAYS) },
        signal,
      );
      return result.success
        ? { ok: true, data: result.overview }
        : { ok: false, error: dispatchErrorMessage(result.error) };
    },
    resetKey: today,
  });
  const { refresh } = view;
  const overview = view.data ?? null;
  // A failed initial load must not strand the panel in loading state; later
  // failures keep the last-known overview (the primitive's keep-last-known),
  // which the panel marks stale so a failed read after an action is never silent.
  const loadError =
    !view.isLoading && view.data === undefined ? (view.error ?? dispatchErrorMessage('load_failed')) : null;

  // A challenge is always recorded on an acknowledgement; the narrowed id is
  // the row key for the settle indicator and the resolve dialog.
  const openChallenges = useMemo(() => {
    if (!overview) return [];
    return overview.occurrences.flatMap((entry) =>
      (entry.dispatch?.recipients ?? []).flatMap((recipient) =>
        recipient.state === 'rueckfrage' && recipient.acknowledgementId
          ? [{ entry, recipient, acknowledgementId: recipient.acknowledgementId }]
          : [],
      ),
    );
  }, [overview]);

  return { today, overview, loadError, isStale: view.isStale, refresh, openChallenges };
}
