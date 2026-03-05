'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ArrowUp, ArrowDown, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { HOUR_WIDTH } from './timeline-grid';

const EntryDetailsDialog = dynamic(
  () =>
    import('@/components/kalender/entry-details-dialog').then(
      (mod) => mod.EntryDetailsDialog
    ),
  { ssr: false }
);
import type {
  WorkSession,
  EntryChangeRequestMap,
  ChangeRequest
} from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';

interface WorkSessionBlockProps {
  session: WorkSession;
  left: number;
  width: number;
  isPending: boolean;
  currentUserRole: OrgRole;
  currentUserId?: string;
  onRefresh: () => void;
  changeRequestMap?: EntryChangeRequestMap;
  /** If true, left and width are percentages instead of pixels */
  usePercentage?: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Calculate block position from a timestamp
 */
function getPositionFromTime(date: Date): number {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return (hours + minutes / 60) * HOUR_WIDTH;
}

/**
 * CSS for diagonal hatching pattern (for removed time / deletion)
 */
const hatchedStyle = {
  backgroundImage: `repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 4px,
    rgba(161, 98, 7, 0.3) 4px,
    rgba(161, 98, 7, 0.3) 8px
  )`
};

/**
 * Analyze a change request to determine edit type and positions
 */
function analyzeEditRequest(
  changeRequest: ChangeRequest,
  entryType: 'clock_in' | 'clock_out',
  currentTimestamp: string
): {
  editType: 'add_time' | 'remove_time';
  originalPos: number;
  newPos: number;
} | null {
  if (changeRequest.changeType !== 'edit' || !changeRequest.originalTimestamp) {
    return null;
  }

  const originalTime = new Date(changeRequest.originalTimestamp);
  const newTime = new Date(currentTimestamp);
  const originalPos = getPositionFromTime(originalTime);
  const newPos = getPositionFromTime(newTime);

  // For clock_in: earlier time = add_time, later time = remove_time
  // For clock_out: later time = add_time, earlier time = remove_time
  let editType: 'add_time' | 'remove_time';

  if (entryType === 'clock_in') {
    editType = newTime < originalTime ? 'add_time' : 'remove_time';
  } else {
    editType = newTime > originalTime ? 'add_time' : 'remove_time';
  }

  return { editType, originalPos, newPos };
}

export function WorkSessionBlock({
  session,
  left,
  width,
  isPending,
  currentUserRole,
  currentUserId,
  onRefresh,
  changeRequestMap = {},
  usePercentage = false
}: WorkSessionBlockProps) {
  // Helper to format position values
  const posUnit = usePercentage ? '%' : 'px';
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Get change requests for this session's entries
  const clockInCR = session.clockIn
    ? changeRequestMap[session.clockIn.id]
    : undefined;
  const clockOutCR = session.clockOut
    ? changeRequestMap[session.clockOut.id]
    : undefined;

  // Check if this is a pending deletion
  const isPendingDelete =
    session.clockIn?.status === 'pending_delete' ||
    session.clockOut?.status === 'pending_delete';

  // Analyze edit requests
  const clockInEdit = useMemo(() => {
    if (!clockInCR || !session.clockIn) return null;
    return analyzeEditRequest(clockInCR, 'clock_in', session.clockIn.timestamp);
  }, [clockInCR, session.clockIn]);

  const clockOutEdit = useMemo(() => {
    if (!clockOutCR || !session.clockOut) return null;
    return analyzeEditRequest(
      clockOutCR,
      'clock_out',
      session.clockOut.timestamp
    );
  }, [clockOutCR, session.clockOut]);

  // Handle orphan clock_out (no clockIn)
  if (session.isOrphan && !session.clockIn && session.clockOut) {
    const clockOutTime = new Date(session.clockOut.timestamp);
    const isNewPending = session.clockOut.status === 'pending';

    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute top-1 h-8 rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer',
            'flex items-center justify-center gap-1 overflow-hidden',
            'hover:shadow-md hover:z-20 hover:scale-[1.02]',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            isPendingDelete
              ? 'bg-yellow-200/80 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
              : isNewPending
              ? 'bg-yellow-400/80 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100'
              : 'bg-red-500/20 text-red-700 dark:bg-red-600/20 dark:text-red-300 border border-red-500/40'
          )}
          style={{
            left: `${left}${posUnit}`,
            width: usePercentage ? '6%' : '90px',
            ...(isPendingDelete ? hatchedStyle : {})
          }}
          title={`Ausstempeln: ${formatTime(clockOutTime)}`}
        >
          <Clock className="h-3 w-3 shrink-0" />
          <ArrowDown className="h-3 w-3 shrink-0" />
          <span className="truncate">{formatTime(clockOutTime)}</span>
        </button>

        {isDialogOpen && (
          <EntryDetailsDialog
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            session={session}
            currentUserRole={currentUserRole}
            currentUserId={currentUserId}
            onRefresh={onRefresh}
          />
        )}
      </>
    );
  }

  // Handle orphan clock_in (from previous day, no clockOut)
  if (session.isOrphan && session.clockIn && !session.clockOut) {
    const clockInTime = new Date(session.clockIn.timestamp);
    const isNewPending = session.clockIn.status === 'pending';

    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute top-1 h-8 rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer',
            'flex items-center justify-center gap-1 overflow-hidden',
            'hover:shadow-md hover:z-20 hover:scale-[1.02]',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            isPendingDelete
              ? 'bg-yellow-200/80 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
              : isNewPending
              ? 'bg-yellow-400/80 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100'
              : 'bg-red-500/20 text-red-700 dark:bg-red-600/20 dark:text-red-300 border border-red-500/40'
          )}
          style={{
            left: `${left}${posUnit}`,
            width: usePercentage ? '6%' : '90px',
            ...(isPendingDelete ? hatchedStyle : {})
          }}
          title={`Einstempeln: ${formatTime(clockInTime)}`}
        >
          <Clock className="h-3 w-3 shrink-0" />
          <ArrowUp className="h-3 w-3 shrink-0" />
          <span className="truncate">{formatTime(clockInTime)}</span>
        </button>

        {isDialogOpen && (
          <EntryDetailsDialog
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            session={session}
            currentUserRole={currentUserRole}
            currentUserId={currentUserId}
            onRefresh={onRefresh}
          />
        )}
      </>
    );
  }

  // Normal session with clockIn (paired or open/currently working)
  const clockInTime = new Date(session.clockIn!.timestamp);
  const clockOutTime = session.clockOut
    ? new Date(session.clockOut.timestamp)
    : null;

  const isOpen = !session.clockOut && !session.isOrphan;
  const durationText = session.durationMinutes
    ? formatDuration(session.durationMinutes)
    : 'Offen';

  const timeRangeText = clockOutTime
    ? `${formatTime(clockInTime)} - ${formatTime(clockOutTime)}`
    : `${formatTime(clockInTime)} - ...`;

  // Check if this is a new pending entry (no edit request, just pending status)
  const isNewPendingEntry =
    isPending && !clockInEdit && !clockOutEdit && !isPendingDelete;

  // Check if there are any pending edits
  const hasClockInEdit = clockInEdit !== null;
  const hasClockOutEdit = clockOutEdit !== null;

  // Calculate positions for edit visualization
  // For the main green block, we need to consider the "approved" portion
  let mainBlockLeft = left;
  let mainBlockWidth = width;
  const editBlocks: Array<{
    left: number;
    width: number;
    type: 'add' | 'remove';
    position: 'start' | 'end';
  }> = [];

  if (hasClockInEdit && clockInEdit) {
    if (clockInEdit.editType === 'add_time') {
      // Time was added at the start
      const addedWidth = clockInEdit.originalPos - clockInEdit.newPos;
      editBlocks.push({
        left: clockInEdit.newPos,
        width: addedWidth,
        type: 'add',
        position: 'start'
      });
      mainBlockLeft = clockInEdit.originalPos;
      mainBlockWidth = width - addedWidth;
    } else {
      // Time was removed from the start
      const removedWidth = clockInEdit.newPos - clockInEdit.originalPos;
      editBlocks.push({
        left: clockInEdit.originalPos,
        width: removedWidth,
        type: 'remove',
        position: 'start'
      });
      // Main block is already at the new position
    }
  }

  if (hasClockOutEdit && clockOutEdit && clockOutTime) {
    if (clockOutEdit.editType === 'add_time') {
      // Time was added at the end
      const addedWidth = clockOutEdit.newPos - clockOutEdit.originalPos;
      editBlocks.push({
        left: clockOutEdit.originalPos,
        width: addedWidth,
        type: 'add',
        position: 'end'
      });
      mainBlockWidth = mainBlockWidth - addedWidth;
    } else {
      // Time was removed from the end
      const removedWidth = clockOutEdit.originalPos - clockOutEdit.newPos;
      editBlocks.push({
        left: clockOutEdit.newPos,
        width: removedWidth,
        type: 'remove',
        position: 'end'
      });
    }
  }

  // If pending delete, show the entire block with hatched style
  if (isPendingDelete) {
    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute top-1 h-14 rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer',
            'flex flex-col items-center justify-center overflow-hidden',
            'hover:shadow-md hover:z-20 hover:scale-[1.02]',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            'bg-yellow-200/80 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
          )}
          style={{
            left: `${left}${posUnit}`,
            width: `${width}${posUnit}`,
            ...hatchedStyle
          }}
          title={`${timeRangeText} (${durationText}) - Löschung ausstehend`}
        >
          {width > 80 && (
            <>
              <div className="flex items-center gap-1 truncate">
                <Clock className="h-3 w-3 shrink-0 opacity-80" />
                <span className="truncate">{timeRangeText}</span>
              </div>
              <span className="truncate text-[10px] opacity-80">
                Löschung ausstehend
              </span>
            </>
          )}
          {width <= 80 && width > 40 && (
            <div className="flex items-center gap-1 truncate">
              <Clock className="h-3 w-3 shrink-0 opacity-80" />
              <span className="truncate text-[10px]">Löschen</span>
            </div>
          )}
          {width <= 40 && <Clock className="h-3 w-3 shrink-0 opacity-80" />}
        </button>

        {isDialogOpen && (
          <EntryDetailsDialog
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            session={session}
            currentUserRole={currentUserRole}
            currentUserId={currentUserId}
            onRefresh={onRefresh}
          />
        )}
      </>
    );
  }

  // Render with edit blocks if present
  if (editBlocks.length > 0) {
    return (
      <>
        {/* Edit blocks (added or removed time) */}
        {editBlocks.map((block, idx) => (
          <div
            key={`edit-${idx}`}
            className={cn(
              'absolute top-1 h-14 rounded-md',
              block.type === 'add'
                ? 'bg-yellow-400/80 dark:bg-yellow-500/80'
                : 'bg-yellow-200/80 dark:bg-yellow-900/50'
            )}
            style={{
              left: `${block.left}px`,
              width: `${Math.max(block.width, 2)}px`,
              ...(block.type === 'remove' ? hatchedStyle : {})
            }}
            title={
              block.type === 'add'
                ? 'Hinzugefügte Zeit (ausstehend)'
                : 'Entfernte Zeit (ausstehend)'
            }
          />
        ))}

        {/* Main approved block */}
        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute top-1 h-14 rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer',
            'flex flex-col items-center justify-center overflow-hidden',
            'hover:shadow-md hover:z-20 hover:scale-[1.02]',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            isOpen
              ? 'bg-green-500/60 text-white dark:bg-green-600/60 animate-pulse'
              : 'bg-green-500/80 text-white dark:bg-green-600/80'
          )}
          style={{
            left: `${mainBlockLeft}px`,
            width: `${Math.max(mainBlockWidth, 20)}px`
          }}
          title={`${timeRangeText} (${durationText})`}
        >
          {mainBlockWidth > 80 && (
            <>
              <div className="flex items-center gap-1 truncate">
                <Clock className="h-3 w-3 shrink-0 opacity-80" />
                <span className="truncate">{timeRangeText}</span>
              </div>
              <span className="truncate text-[10px] opacity-80 pl-4">
                {durationText}
              </span>
            </>
          )}
          {mainBlockWidth <= 80 && mainBlockWidth > 40 && (
            <div className="flex items-center gap-1 truncate">
              <Clock className="h-3 w-3 shrink-0 opacity-80" />
              <span className="truncate">{durationText}</span>
            </div>
          )}
          {mainBlockWidth <= 40 && (
            <Clock className="h-3 w-3 shrink-0 opacity-80" />
          )}
        </button>

        {isDialogOpen && (
          <EntryDetailsDialog
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            session={session}
            currentUserRole={currentUserRole}
            currentUserId={currentUserId}
            onRefresh={onRefresh}
          />
        )}
      </>
    );
  }

  // Standard rendering (new pending entry or approved)
  return (
    <>
      <button
        onClick={() => setIsDialogOpen(true)}
        className={cn(
          'absolute top-1 h-14 rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer',
          'flex flex-col items-center justify-center overflow-hidden',
          'hover:shadow-md hover:z-20 hover:scale-[1.02]',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
          // Approved state (green)
          !isNewPendingEntry &&
            !isOpen &&
            'bg-green-500/80 text-white dark:bg-green-600/80',
          // Open session (pulsing green)
          isOpen &&
            !isNewPendingEntry &&
            'bg-green-500/60 text-white dark:bg-green-600/60 animate-pulse',
          // New pending entry (solid yellow, no dashed border)
          isNewPendingEntry &&
            'bg-yellow-400/80 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100'
        )}
        style={{
          left: `${left}${posUnit}`,
          width: `${width}${posUnit}`
        }}
        title={`${timeRangeText} (${durationText})`}
      >
        {/* Use percentage thresholds when in percentage mode, pixel thresholds otherwise */}
        {(usePercentage ? width > 5.5 : width > 80) && (
          <>
            <div className="flex items-center gap-1 truncate">
              <Clock className="h-3 w-3 shrink-0 opacity-80" />
              <span className="truncate">{timeRangeText}</span>
            </div>
            <span className="truncate text-[10px] opacity-80">
              {durationText}
            </span>
          </>
        )}
        {(usePercentage
          ? width <= 5.5 && width > 2.8
          : width <= 80 && width > 40) && (
          <div className="flex items-center gap-1 truncate">
            <Clock className="h-3 w-3 shrink-0 opacity-80" />
            <span className="truncate">{durationText}</span>
          </div>
        )}
        {(usePercentage ? width <= 2.8 : width <= 40) && (
          <Clock className="h-3 w-3 shrink-0 opacity-80" />
        )}
      </button>

      {isDialogOpen && (
        <EntryDetailsDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          session={session}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}
