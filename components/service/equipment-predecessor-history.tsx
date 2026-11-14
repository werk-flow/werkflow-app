'use client';

import { useState, type ReactElement } from 'react';
import { History } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { useServerAction } from '@/hooks/use-server-action';
import { getEquipmentPredecessorHistory } from '@/lib/installed-equipment/actions';
import type { EquipmentPredecessorEvent, EquipmentPredecessorHistory } from '@/lib/installed-equipment/types';
import { EquipmentHistoryTimeline } from './equipment-detail-sections';

/**
 * The history of the records this Anlage replaced, after its own history:
 * the first page comes with the detail, further pages load on request.
 */
export function EquipmentPredecessorHistorySection({
  equipmentId,
  initial,
}: {
  equipmentId: string;
  initial: EquipmentPredecessorHistory;
}): ReactElement | null {
  const [loaded, setLoaded] = useState<{
    firstPage: string;
    events: EquipmentPredecessorEvent[];
    nextOffset: number | null;
  }>();
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(getEquipmentPredecessorHistory);
  // Older pages count on the first page they were loaded under; a refreshed
  // first page that differs (a backdated event) starts the paging over.
  const firstPage = initial.events.map((event) => event.id).join(',');
  const older = loaded?.firstPage === firstPage ? loaded : undefined;
  if (initial.events.length === 0) return null;
  // An event recorded while paging shifts later offsets by one; each event shows once.
  const events = [
    ...new Map([...initial.events, ...(older?.events ?? [])].map((event) => [event.id, event])).values(),
  ];
  const nextOffset = older ? older.nextOffset : initial.nextOffset;

  async function loadOlder(offset: number): Promise<void> {
    setError(null);
    const result = await run({ equipmentId, offset });
    if (!result.success) {
      setError('Ältere Einträge konnten nicht geladen werden. Versuche es erneut.');
      return;
    }
    setLoaded({
      firstPage,
      events: [...(older?.events ?? []), ...result.history.events],
      nextOffset: result.history.nextOffset,
    });
  }

  return (
    <section className="rounded-lg border p-4 shadow-xs" aria-labelledby="equipment-predecessor-history">
      <div className="flex items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <h2 id="equipment-predecessor-history" className="text-base font-semibold">
          Historie beim Vorgänger
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Was an der ersetzten Anlage passiert ist, neueste zuerst.
      </p>
      <EquipmentHistoryTimeline
        events={events}
        origin={(event) => `beim Vorgänger ${event.equipmentNumber} · ${event.equipmentName}`}
      />
      {nextOffset !== null && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          pending={isPending}
          onClick={() => void loadOlder(nextOffset)}
        >
          Ältere Einträge laden
        </Button>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
