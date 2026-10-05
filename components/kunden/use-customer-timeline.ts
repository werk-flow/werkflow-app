'use client';

import { useMemo, useState } from 'react';
import { useBanner } from '@/components/ui/banner';
import { getCustomerRelationshipBundle } from '@/lib/customer-relationships/actions';
import { compareTimelineItems } from '@/lib/customer-relationships/resolution';
import type {
  CustomerRelationshipBundle,
  TimelineCategory,
  TimelineItem,
} from '@/lib/customer-relationships/types';

export type TimelineFilter = 'all' | TimelineCategory;

interface CustomerTimelineState {
  /** The server bundle with every older timeline page loaded so far merged in. */
  bundle: CustomerRelationshipBundle;
  timelineFilter: TimelineFilter;
  setTimelineFilter: (filter: TimelineFilter) => void;
  visibleTimeline: TimelineItem[];
  olderTimelineCursor: string | null;
  loadOlderTimeline: (cursor: string) => void;
}

/** Timeline paging and filtering on top of the refreshed relationship bundle. */
export function useCustomerTimeline({
  clientId,
  initialBundle,
  runTask,
}: {
  clientId: string;
  initialBundle: CustomerRelationshipBundle;
  runTask: (task: () => Promise<void>) => Promise<void>;
}): CustomerTimelineState {
  const [persistedTimelineItems, setPersistedTimelineItems] = useState<TimelineItem[]>([]);
  const [nextTimelineCursor, setNextTimelineCursor] = useState<string | null | undefined>(undefined);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all');
  const { showBanner } = useBanner();

  const bundle = useMemo(() => {
    if (nextTimelineCursor === undefined) return initialBundle;
    const mergedTimeline = new Map<string, TimelineItem>();
    for (const item of initialBundle.timeline.items) {
      mergedTimeline.set(item.stableKey, item);
    }
    for (const item of persistedTimelineItems) {
      if (!mergedTimeline.has(item.stableKey)) {
        mergedTimeline.set(item.stableKey, item);
      }
    }
    return {
      ...initialBundle,
      timeline: {
        items: [...mergedTimeline.values()].sort(compareTimelineItems),
        nextCursor: nextTimelineCursor,
      },
    };
  }, [initialBundle, nextTimelineCursor, persistedTimelineItems]);

  const olderTimelineCursor = bundle.timeline.nextCursor;
  const visibleTimeline = useMemo(
    () =>
      timelineFilter === 'all'
        ? bundle.timeline.items
        : bundle.timeline.items.filter((item) => item.category === timelineFilter),
    [bundle.timeline.items, timelineFilter],
  );

  function loadOlderTimeline(cursor: string): void {
    void runTask(async () => {
      const result = await getCustomerRelationshipBundle(clientId, cursor);
      if (!result.success) {
        showBanner({
          variant: 'error',
          message: 'Die Kundenhistorie konnte nicht aktualisiert werden.',
        });
        return;
      }
      setPersistedTimelineItems((current) => {
        const mergedTimeline = new Map(
          (current.length > 0 ? current : initialBundle.timeline.items).map((item) => [item.stableKey, item]),
        );
        for (const item of result.data.timeline.items) {
          if (!mergedTimeline.has(item.stableKey)) {
            mergedTimeline.set(item.stableKey, item);
          }
        }
        return [...mergedTimeline.values()].sort(compareTimelineItems);
      });
      setNextTimelineCursor(result.data.timeline.nextCursor);
    });
  }

  return {
    bundle,
    timelineFilter,
    setTimelineFilter,
    visibleTimeline,
    olderTimelineCursor,
    loadOlderTimeline,
  };
}
