'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { EntryDetailsDialog } from '@/components/kalender/entry-details-dialog';
import type { WorkSession } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';

interface WorkSessionBlockProps {
  session: WorkSession;
  left: number;
  width: number;
  isPending: boolean;
  currentUserRole: OrgRole;
  onRefresh: () => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function WorkSessionBlock({
  session,
  left,
  width,
  isPending,
  currentUserRole,
  onRefresh
}: WorkSessionBlockProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Handle orphan clock_out (no clockIn)
  if (session.isOrphan && !session.clockIn && session.clockOut) {
    const clockOutTime = new Date(session.clockOut.timestamp);

    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute top-1 h-8 rounded-md px-2 py-1 text-xs font-medium transition-all',
            'flex items-center justify-center overflow-hidden',
            'hover:shadow-md hover:z-20 hover:scale-[1.02]',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            isPending
              ? 'bg-yellow-500/80 text-yellow-900 dark:bg-yellow-600/80 dark:text-yellow-100 border-2 border-dashed border-yellow-600'
              : 'bg-red-500/20 text-red-700 dark:bg-red-600/20 dark:text-red-300 border border-red-500/40'
          )}
          style={{
            left: `${left}px`,
            width: `${Math.max(width, 60)}px`
          }}
          title={`Ausstempeln: ${formatTime(clockOutTime)}`}
        >
          <span className="truncate">⬇ {formatTime(clockOutTime)}</span>
        </button>

        <EntryDetailsDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          session={session}
          currentUserRole={currentUserRole}
          onRefresh={onRefresh}
        />
      </>
    );
  }

  // Handle orphan clock_in (from previous day, no clockOut)
  if (session.isOrphan && session.clockIn && !session.clockOut) {
    const clockInTime = new Date(session.clockIn.timestamp);

    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute top-1 h-8 rounded-md px-2 py-1 text-xs font-medium transition-all',
            'flex items-center justify-center overflow-hidden',
            'hover:shadow-md hover:z-20 hover:scale-[1.02]',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            isPending
              ? 'bg-yellow-500/80 text-yellow-900 dark:bg-yellow-600/80 dark:text-yellow-100 border-2 border-dashed border-yellow-600'
              : 'bg-red-500/20 text-red-700 dark:bg-red-600/20 dark:text-red-300 border border-red-500/40'
          )}
          style={{
            left: `${left}px`,
            width: `${Math.max(width, 60)}px`
          }}
          title={`Einstempeln: ${formatTime(clockInTime)}`}
        >
          <span className="truncate">⬆ {formatTime(clockInTime)}</span>
        </button>

        <EntryDetailsDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          session={session}
          currentUserRole={currentUserRole}
          onRefresh={onRefresh}
        />
      </>
    );
  }

  // Normal session with clockIn (paired or open/currently working)
  const clockInTime = new Date(session.clockIn!.timestamp);
  const clockOutTime = session.clockOut
    ? new Date(session.clockOut.timestamp)
    : null;

  // Only truly "open" if not an orphan (i.e., from today and currently working)
  const isOpen = !session.clockOut && !session.isOrphan;
  const durationText = session.durationMinutes
    ? formatDuration(session.durationMinutes)
    : 'Offen';

  const timeRangeText = clockOutTime
    ? `${formatTime(clockInTime)} - ${formatTime(clockOutTime)}`
    : `${formatTime(clockInTime)} - ...`;

  return (
    <>
      <button
        onClick={() => setIsDialogOpen(true)}
        className={cn(
          'absolute top-1 h-14 rounded-md px-2 py-1 text-xs font-medium transition-all',
          'flex flex-col justify-center overflow-hidden',
          'hover:shadow-md hover:z-20 hover:scale-[1.02]',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
          // Default (approved) state
          !isPending &&
            !isOpen &&
            'bg-green-500/80 text-white dark:bg-green-600/80',
          // Open session
          isOpen &&
            !isPending &&
            'bg-green-500/60 text-white dark:bg-green-600/60 animate-pulse',
          // Pending state
          isPending &&
            'bg-yellow-500/80 text-yellow-900 dark:bg-yellow-600/80 dark:text-yellow-100 border-2 border-dashed border-yellow-600'
        )}
        style={{
          left: `${left}px`,
          width: `${width}px`
        }}
        title={`${timeRangeText} (${durationText})`}
      >
        {width > 80 && (
          <>
            <span className="truncate">{timeRangeText}</span>
            <span className="truncate text-[10px] opacity-80">
              {durationText}
            </span>
          </>
        )}
        {width <= 80 && width > 40 && (
          <span className="truncate">{durationText}</span>
        )}
      </button>

      <EntryDetailsDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        session={session}
        currentUserRole={currentUserRole}
        onRefresh={onRefresh}
      />
    </>
  );
}
