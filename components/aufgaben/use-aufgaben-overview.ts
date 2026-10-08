'use client';

import { useBanner } from '@/components/ui/banner';
import { useAttentionCountsFromOverview } from '@/components/realtime/attention-count-provider';
import { markAllAttentionNotificationsRead, markAttentionNotificationRead } from '@/lib/attention/actions';
import type { AttentionNotification, AttentionOverview } from '@/lib/attention/types';
import { readInBackground } from '@/lib/data/background-read-client';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';

const MARK_READ_ERROR = 'Die Benachrichtigung konnte nicht als gelesen markiert werden.';
const MARK_ALL_READ_ERROR = 'Die Benachrichtigungen konnten nicht als gelesen markiert werden.';
// Busy id for „Alle als gelesen markieren“; source ids are UUIDs, so no clash.
export const ALL_NOTIFICATIONS_ID = '__all__';

function notificationKey(notification: AttentionNotification): string {
  return `${notification.sourceType}:${notification.sourceId}`;
}

/** The live attention overview and its optimistic mark-as-read actions. */
export function useAufgabenOverview() {
  const { showBanner } = useBanner();
  const busy = useBusyIds();

  // Keep last-known data on transient failures; only a failed initial
  // load shows the visible failure state.
  const view = useLiveView<AttentionOverview>({
    tables: [
      'time_entries',
      'entry_change_requests',
      'vacation_requests',
      'sickness_reports',
      'employee_capabilities',
      'organization_capabilities',
      'client_requests',
      'client_follow_ups',
      'organization_join_requests',
      'planning_dispatches',
      'planning_dispatch_recipients',
      'planning_dispatch_acknowledgements',
      'work_blockers',
      'work_artifacts',
      'jobs',
      'projects',
      'work_handover_packages',
      'attention_read_states',
      'organization_responsibility_configurations',
      'organization_responsibility_assignments',
      'organization_responsibility_delegations',
    ],
    // Reads over GET, so a mark-as-read never waits behind the overview read.
    read: async ({ signal }): Promise<LiveViewResult<AttentionOverview>> => {
      const result = await readInBackground('attention-overview', {}, signal);
      return result.success ? { ok: true, data: result.overview } : { ok: false };
    },
  });
  useBusinessDayRefresh(view.refresh);

  const overview = view.data ?? null;
  // The badges count this overview while the page is open: one derivation
  // per event instead of two, and a mark-as-read moves them with the dot.
  useAttentionCountsFromOverview(overview);
  const refetch = view.refresh;
  const isMarkingAllRead = busy.isBusy(ALL_NOTIFICATIONS_ID);

  // Mark-as-read is a micro-toggle: the dot disappears at once (optimistic
  // echo on the live view), the failure brings back the cleared dots and shows
  // an error banner, and the follow-up read reconciles with the server.
  const markRead = async (
    sourceId: string | null,
    action: () => Promise<{ success: boolean }>,
    errorMessage: string,
  ) => {
    const busyId = sourceId ?? ALL_NOTIFICATIONS_ID;
    if (busy.isBusy(busyId)) return;
    // Only the dots this action cleared come back on failure; restoring a whole
    // snapshot would also undo concurrent marks and newer live data.
    const clearedKeys = new Set(
      (view.data?.notifications ?? [])
        .filter(
          (notification) => notification.unread && (sourceId === null || notification.sourceId === sourceId),
        )
        .map(notificationKey),
    );
    view.invalidate();
    view.setData(
      (previous) =>
        previous && {
          ...previous,
          notifications: previous.notifications.map((notification) =>
            sourceId === null || notification.sourceId === sourceId
              ? { ...notification, unread: false }
              : notification,
          ),
        },
    );
    await busy.run(busyId, async () => {
      let succeeded = false;
      try {
        succeeded = (await action()).success;
      } catch {
        succeeded = false;
      }
      if (!succeeded) {
        view.setData(
          (previous) =>
            previous && {
              ...previous,
              notifications: previous.notifications.map((notification) =>
                clearedKeys.has(notificationKey(notification))
                  ? { ...notification, unread: true }
                  : notification,
              ),
            },
        );
        showBanner({ variant: 'error', message: errorMessage });
        await refetch();
        return;
      }
      await refetch();
    });
  };

  const handleMarkRead = (notification: AttentionNotification) =>
    markRead(
      notification.sourceId,
      () =>
        markAttentionNotificationRead({
          sourceType: notification.sourceType,
          sourceId: notification.sourceId,
          stateVersion: notification.stateVersion,
        }),
      MARK_READ_ERROR,
    );

  const handleMarkAllRead = () => markRead(null, markAllAttentionNotificationsRead, MARK_ALL_READ_ERROR);

  return {
    view,
    overview,
    busy,
    isMarkingAllRead,
    handleMarkRead,
    handleMarkAllRead,
  };
}
