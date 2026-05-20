'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ArrowUp, ArrowDown, BriefcaseBusiness, Clock, Coffee } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildClockTimelineSegments,
  formatDuration
} from '@/lib/time-tracking/helpers';
import { HOUR_WIDTH } from './timeline-grid';
import { useBlockDrag, type DragMode } from './use-block-drag';

const EntryDetailsDialog = dynamic(
  () =>
    import('@/components/kalender/entry-details-dialog').then(
      (mod) => mod.EntryDetailsDialog
    ),
  { ssr: false }
);
import type {
  InteractiveCalendarSession,
  WorkSession,
  EntryChangeRequestMap,
  ChangeRequest,
  TimeEntry,
  WorkSessionBreak,
} from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';

export interface MoveResizeResult {
  clockInEntryId?: string;
  clockOutEntryId?: string;
  newClockInTimestamp: string;
  newClockOutTimestamp: string;
  originalClockInTimestamp: string;
  originalClockOutTimestamp: string;
  additionalEntryUpdates?: Array<{
    entryId: string;
    newTimestamp: string;
    originalTimestamp: string;
  }>;
}

interface WorkSessionBlockProps {
  session: WorkSession;
  blockId?: string;
  left: number;
  width: number;
  isPending: boolean;
  backgroundSegments?: Array<{
    id: string;
    left: number;
    width: number;
    type: 'work' | 'break';
  }>;
  currentUserRole: OrgRole;
  currentUserId?: string;
  onRefresh: () => void;
  changeRequestMap?: EntryChangeRequestMap;
  usePercentage?: boolean;
  entryUserRole?: OrgRole;
  effectiveHourWidth?: number;
  /** Called when user drags to move or resize the block. */
  onMoveResize?: (result: MoveResizeResult) => void;
  /** The date of the current day view (needed to build timestamps). */
  viewDate?: Date;
  /** Called on pointer-down in the move area when DayView handles cross-row moves. */
  onBlockMoveStart?: (
    session: WorkSession,
    memberId: string,
    left: number,
    width: number,
    e: React.PointerEvent
  ) => void;
  /** The member id that owns this block. Required for cross-row drag. */
  memberId?: string;
  /** When true, hide this block because DayView is rendering a floating preview. */
  isDraggedAway?: boolean;
  /** Ref that DayView sets to true when a cross-row drag occurred (prevents click opening dialog). */
  dayViewDragDidOccurRef?: React.RefObject<boolean>;
  /** Vertical offset within the row (from overlap layout). */
  layoutTop?: number;
  /** Height of the block (from overlap layout). */
  layoutHeight?: number;
  blockedRanges?: Array<{
    id: string;
    left: number;
    width: number;
  }>;
  isConflictTarget?: boolean;
  onConflictTargetsChange?: (sourceBlockId: string, targetIds: string[]) => void;
  onInvalidPlacement?: (message: string) => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getPositionFromTime(
  date: Date,
  hourWidth: number = HOUR_WIDTH
): number {
  return (
    (date.getHours() +
      date.getMinutes() / 60 +
      date.getSeconds() / 3600 +
      date.getMilliseconds() / 3600000) *
    hourWidth
  );
}

function pixelToTimeStr(px: number, hourWidth: number, baseDate: Date): string {
  const totalMinutes = Math.max(
    0,
    Math.min(24 * 60, Math.round((px / hourWidth) * 60))
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const d = new Date(baseDate);
  d.setHours(Math.min(23, hours), Math.min(59, minutes), 0, 0);
  return d.toISOString();
}

const hatchedStyle = {
  backgroundImage: `repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 4px,
    rgba(161, 98, 7, 0.3) 4px,
    rgba(161, 98, 7, 0.3) 8px
  )`
};

function analyzeEditRequest(
  changeRequest: ChangeRequest,
  entryType: 'clock_in' | 'clock_out',
  currentTimestamp: string,
  hourWidth: number = HOUR_WIDTH
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
  const originalPos = getPositionFromTime(originalTime, hourWidth);
  const newPos = getPositionFromTime(newTime, hourWidth);

  let editType: 'add_time' | 'remove_time';

  if (entryType === 'clock_in') {
    editType = newTime < originalTime ? 'add_time' : 'remove_time';
  } else {
    editType = newTime > originalTime ? 'add_time' : 'remove_time';
  }

  return { editType, originalPos, newPos };
}

function formatTimeFromPx(px: number, hourWidth: number): string {
  const totalMinutes = Math.max(
    0,
    Math.min(24 * 60, Math.round((px / hourWidth) * 60))
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

type SegmentSummary = {
  workMinutes: number;
  breakMinutes: number;
  workText: string;
  breakText: string | null;
};

function buildSegmentSummary(
  session: WorkSession,
  entries: TimeEntry[],
  referenceDate: Date,
  breaks?: WorkSessionBreak[]
): SegmentSummary | null {
  if (session.clockIn && breaks && breaks.length > 0) {
    const clockIn = new Date(session.clockIn.timestamp)
    const clockOut = session.clockOut ? new Date(session.clockOut.timestamp) : referenceDate
    const totalMinutes = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 60000)
    const breakMinutes = breaks.reduce((total, workBreak) => {
      const breakEnd = workBreak.breakEnd
        ? new Date(workBreak.breakEnd.timestamp)
        : referenceDate

      return (
        total +
        Math.max(
          0,
          (breakEnd.getTime() - new Date(workBreak.breakStart.timestamp).getTime()) / 60000
        )
      )
    }, 0)
    const workMinutes = Math.max(0, totalMinutes - breakMinutes)

    return {
      workMinutes,
      breakMinutes,
      workText: formatDuration(workMinutes),
      breakText: breakMinutes > 0 ? formatDuration(breakMinutes) : null,
    }
  }

  if (entries.length === 0) {
    return null;
  }

  const timelineSegments = buildClockTimelineSegments(entries, referenceDate, {
    sameLocalDayOnly: true,
    includeOpenSegment: true
  });
  const workMinutes = timelineSegments.reduce(
    (total, segment) => total + (segment.type === 'work' ? segment.minutes : 0),
    0
  );
  const breakMinutes = timelineSegments.reduce(
    (total, segment) => total + (segment.type === 'break' ? segment.minutes : 0),
    0
  );

  if (workMinutes <= 0 && breakMinutes <= 0) {
    return null;
  }

  return {
    workMinutes,
    breakMinutes,
    workText: formatDuration(workMinutes),
    breakText: breakMinutes > 0 ? formatDuration(breakMinutes) : null
  };
}

export function WorkSessionBlock({
  session,
  blockId,
  left,
  width,
  isPending,
  backgroundSegments,
  currentUserRole,
  currentUserId,
  onRefresh,
  changeRequestMap = {},
  usePercentage = false,
  entryUserRole,
  effectiveHourWidth = HOUR_WIDTH,
  onMoveResize,
  viewDate,
  onBlockMoveStart,
  memberId,
  isDraggedAway = false,
  dayViewDragDidOccurRef,
  layoutTop,
  layoutHeight,
  blockedRanges = [],
  isConflictTarget = false,
  onConflictTargetsChange,
  onInvalidPlacement
}: WorkSessionBlockProps) {
  const hasBackgroundSegments = (backgroundSegments?.length ?? 0) > 0;
  const hasLayout = layoutTop !== undefined && layoutHeight !== undefined;
  const blockTop = hasLayout ? layoutTop : undefined;
  const blockHeight = hasLayout ? layoutHeight : undefined;
  const compact = hasLayout && layoutHeight <= 28;
  const posUnit = usePercentage ? '%' : 'px';
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const isOpenSession = !session.clockOut && !session.isOrphan;

  const canManageBlock = useMemo(() => {
    if (!onMoveResize || !viewDate) return false;
    if (!session.clockIn) return false;
    if (session.isOrphan) return false;
    if (
      session.clockIn.status === 'pending_delete' ||
      session.clockOut?.status === 'pending_delete'
    )
      return false;
    if (usePercentage) return false;
    if (currentUserRole === 'admin') return true;
    if (currentUserRole === 'buero') {
      if (entryUserRole === 'employee') return true;
      const userId = session.clockIn?.userId;
      if (userId === currentUserId) return true;
    }
    return false;
  }, [
    onMoveResize,
    viewDate,
    session,
    usePercentage,
    currentUserRole,
    entryUserRole,
    currentUserId
  ]);

  const canMove = canManageBlock && !isOpenSession && !!session.clockOut;
  const canResizeLeft = canManageBlock && !!session.clockIn;
  const canResizeRight = canManageBlock && !!session.clockOut && !isOpenSession;

  const showResizeHint = useMemo(() => {
    if (canResizeLeft || canResizeRight) return false;
    if (!onMoveResize || !viewDate) return false;
    if (!session.clockIn) return false;
    if (session.isOrphan || usePercentage) return false;
    if (
      session.clockIn.status === 'pending_delete' ||
      session.clockOut?.status === 'pending_delete'
    )
      return false;
    return true;
  }, [canResizeLeft, canResizeRight, onMoveResize, viewDate, session, usePercentage]);

  const isOwnEntryNeedingApproval = useMemo(() => {
    if (currentUserRole !== 'buero') return false;
    return session.clockIn?.userId === currentUserId;
  }, [currentUserRole, session, currentUserId]);

  const handleDragComplete = useCallback(
    (newLeft: number, newWidth: number, mode: DragMode) => {
      if (!onMoveResize || !viewDate || !session.clockIn)
        return;

      const newClockIn = pixelToTimeStr(newLeft, effectiveHourWidth, viewDate);
      const newClockOut = pixelToTimeStr(
        newLeft + newWidth,
        effectiveHourWidth,
        viewDate
      );
      const interactiveSession = session as InteractiveCalendarSession;
      const sourceEntries = interactiveSession.sourceEntries ?? [];
      const clockInDelta =
        new Date(newClockIn).getTime() - new Date(session.clockIn.timestamp).getTime();
      const clockOutDelta =
        session.clockOut
          ? new Date(newClockOut).getTime() - new Date(session.clockOut.timestamp).getTime()
          : 0;

      let additionalEntryUpdates:
        | Array<{
            entryId: string;
            newTimestamp: string;
            originalTimestamp: string;
          }>
        | undefined;

      if (sourceEntries.length > 2) {
        if (mode === 'move' && clockInDelta === clockOutDelta) {
          additionalEntryUpdates = sourceEntries
            .filter(
              (entry) =>
                entry.id !== session.clockIn?.id && entry.id !== session.clockOut?.id
            )
            .map((entry) => ({
              entryId: entry.id,
              originalTimestamp: entry.timestamp,
              newTimestamp: new Date(
                new Date(entry.timestamp).getTime() + clockInDelta
              ).toISOString()
            }))
            .filter(
              (update) => update.newTimestamp !== update.originalTimestamp
            );
        } else if (
          mode === 'resize-right' &&
          backgroundSegments &&
          backgroundSegments[backgroundSegments.length - 1]?.type === 'break'
        ) {
          const trailingBreakStart = [...sourceEntries]
            .reverse()
            .find((entry) => entry.entryType === 'break_start');

          if (trailingBreakStart && session.clockOut) {
            additionalEntryUpdates = [
              {
                entryId: trailingBreakStart.id,
                originalTimestamp: trailingBreakStart.timestamp,
                newTimestamp: new Date(
                  new Date(trailingBreakStart.timestamp).getTime() + clockOutDelta
                ).toISOString()
              }
            ].filter(
              (update) => update.newTimestamp !== update.originalTimestamp
            );
          }
        }
      }

      onMoveResize({
        clockInEntryId: session.clockIn.id,
        clockOutEntryId: session.clockOut?.id,
        newClockInTimestamp: newClockIn,
        newClockOutTimestamp: newClockOut,
        originalClockInTimestamp: session.clockIn.timestamp,
        originalClockOutTimestamp:
          session.clockOut?.timestamp ?? session.clockIn.timestamp,
        additionalEntryUpdates
      });
    },
    [onMoveResize, viewDate, session, effectiveHourWidth, backgroundSegments]
  );

  const drag = useBlockDrag({
    left,
    width,
    effectiveHourWidth,
    enabled: canManageBlock,
    allowMove: canMove,
    allowResizeLeft: canResizeLeft,
    allowResizeRight: canResizeRight,
    onComplete: handleDragComplete,
    isDropInvalid: (nextLeft, nextWidth) =>
      blockedRanges.some(
        (range) => range.left < nextLeft + nextWidth && nextLeft < range.left + range.width
      ),
    onInvalidDrop: (mode) => {
      const action =
        mode === 'move'
          ? 'verschoben'
          : mode === 'resize-left' || mode === 'resize-right'
            ? 'geändert'
            : 'platziert';
      onInvalidPlacement?.(
        `Arbeitszeit konnte nicht ${action} werden, weil sie sich mit einem anderen Arbeitsblock überschneiden würde.`
      );
    }
  });

  const clockInCR = session.clockIn
    ? changeRequestMap[session.clockIn.id]
    : undefined;
  const clockOutCR = session.clockOut
    ? changeRequestMap[session.clockOut.id]
    : undefined;

  const isPendingDelete =
    session.clockIn?.status === 'pending_delete' ||
    session.clockOut?.status === 'pending_delete';

  const clockInEdit = useMemo(() => {
    if (!clockInCR || !session.clockIn) return null;
    return analyzeEditRequest(
      clockInCR,
      'clock_in',
      session.clockIn.timestamp,
      effectiveHourWidth
    );
  }, [clockInCR, session.clockIn, effectiveHourWidth]);

  const clockOutEdit = useMemo(() => {
    if (!clockOutCR || !session.clockOut) return null;
    return analyzeEditRequest(
      clockOutCR,
      'clock_out',
      session.clockOut.timestamp,
      effectiveHourWidth
    );
  }, [clockOutCR, session.clockOut, effectiveHourWidth]);

  const displayLeft = drag.isDragging ? drag.currentLeft : left;
  const displayWidth = drag.isDragging ? drag.currentWidth : width;
  const displaySegments = useMemo(() => {
    if (!backgroundSegments) return [];
    if (!drag.isDragging) return backgroundSegments;

    const adjusted = backgroundSegments.map((segment) => ({ ...segment }));
    const deltaLeft = displayLeft - left;
    const deltaWidth = displayWidth - width;

    if (drag.dragMode === 'resize-left' && adjusted.length > 0) {
      if (adjusted[0].type === 'work') {
        adjusted[0].width = Math.max(2, adjusted[0].width - deltaLeft);
      }
      for (let index = 1; index < adjusted.length; index += 1) {
        adjusted[index].left = adjusted[index].left - deltaLeft;
      }
    }

    if (drag.dragMode === 'resize-right' && adjusted.length > 0) {
      const lastIndex = adjusted.length - 1;
      const lastSegment = adjusted[lastIndex];
      if (lastSegment.type === 'break' && lastIndex > 0) {
        adjusted[lastIndex].left = adjusted[lastIndex].left + deltaWidth;
        if (adjusted[lastIndex - 1].type === 'work') {
          adjusted[lastIndex - 1].width = Math.max(
            2,
            adjusted[lastIndex - 1].width + deltaWidth
          );
        }
      } else if (lastSegment.type === 'work') {
        adjusted[lastIndex].width = Math.max(2, adjusted[lastIndex].width + deltaWidth);
      }
    }

    return adjusted;
  }, [
    backgroundSegments,
    drag.dragMode,
    drag.isDragging,
    displayLeft,
    displayWidth,
    left,
    width
  ]);

  const segmentSummary = useMemo(
    () => {
      const interactiveSession = session as InteractiveCalendarSession;
      const sourceEntries = interactiveSession.sourceEntries ?? [];
      return buildSegmentSummary(
        session,
        sourceEntries,
        new Date(),
        interactiveSession.breaks
      );
    },
    [session]
  );
  const conflictingBlockIds = useMemo(() => {
    const displayRight = displayLeft + displayWidth;
    return blockedRanges
      .filter((range) => range.left < displayRight && displayLeft < range.left + range.width)
      .map((range) => range.id);
  }, [blockedRanges, displayLeft, displayWidth]);
  const hasDropConflict = drag.isDragging && conflictingBlockIds.length > 0;

  useEffect(() => {
    if (!blockId || !onConflictTargetsChange) return;

    if (!drag.isDragging || conflictingBlockIds.length === 0) {
      onConflictTargetsChange(blockId, []);
      return;
    }

    onConflictTargetsChange(blockId, conflictingBlockIds);
  }, [blockId, onConflictTargetsChange, conflictingBlockIds, drag.isDragging]);

  // ──── Orphan clock_out ────
  if (session.isOrphan && !session.clockIn && session.clockOut) {
    const clockOutTime = new Date(session.clockOut.timestamp);
    const isNewPending = session.clockOut.status === 'pending';

    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer z-10',
            !hasLayout && 'top-1 h-8',
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
            ...(hasLayout ? { top: blockTop, height: blockHeight } : {}),
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
            entryUserRole={entryUserRole}
          />
        )}
      </>
    );
  }

  // ──── Orphan clock_in ────
  if (session.isOrphan && session.clockIn && !session.clockOut) {
    const clockInTime = new Date(session.clockIn.timestamp);
    const isNewPending = session.clockIn.status === 'pending';

    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer z-10',
            !hasLayout && 'top-1 h-8',
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
            ...(hasLayout ? { top: blockTop, height: blockHeight } : {}),
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
            entryUserRole={entryUserRole}
          />
        )}
      </>
    );
  }

  // ──── Normal session ────
  const clockInTime = new Date(session.clockIn!.timestamp);
  const clockOutTime = session.clockOut
    ? new Date(session.clockOut.timestamp)
    : null;

  const isOpen = !session.clockOut && !session.isOrphan;
  const durationText = session.durationMinutes
    ? formatDuration(session.durationMinutes)
    : 'Offen';
  const secondaryDurationText = segmentSummary?.breakText
    ? `${segmentSummary.workText} Arbeit · ${segmentSummary.breakText} Pause`
    : durationText;

  const timeRangeText = clockOutTime
    ? `${formatTime(clockInTime)} - ${formatTime(clockOutTime)}`
    : `${formatTime(clockInTime)} - ...`;

  const isNewPendingEntry =
    isPending && !clockInEdit && !clockOutEdit && !isPendingDelete;

  const hasClockInEdit = clockInEdit !== null;
  const hasClockOutEdit = clockOutEdit !== null;

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
      const removedWidth = clockInEdit.newPos - clockInEdit.originalPos;
      editBlocks.push({
        left: clockInEdit.originalPos,
        width: removedWidth,
        type: 'remove',
        position: 'start'
      });
    }
  }

  if (hasClockOutEdit && clockOutEdit && clockOutTime) {
    if (clockOutEdit.editType === 'add_time') {
      const addedWidth = clockOutEdit.newPos - clockOutEdit.originalPos;
      editBlocks.push({
        left: clockOutEdit.originalPos,
        width: addedWidth,
        type: 'add',
        position: 'end'
      });
      mainBlockWidth = mainBlockWidth - addedWidth;
    } else {
      const removedWidth = clockOutEdit.originalPos - clockOutEdit.newPos;
      editBlocks.push({
        left: clockOutEdit.newPos,
        width: removedWidth,
        type: 'remove',
        position: 'end'
      });
    }
  }

  // ──── Pending delete ────
  if (isPendingDelete) {
    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer z-10',
            !hasLayout && 'top-1 h-14',
            'flex flex-col items-center justify-center overflow-hidden',
            'hover:shadow-md hover:z-20 hover:scale-[1.02]',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            'bg-yellow-200/80 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
          )}
          style={{
            left: `${left}${posUnit}`,
            width: `${width}${posUnit}`,
            ...(hasLayout ? { top: blockTop, height: blockHeight } : {}),
            ...hatchedStyle
          }}
          title={`${timeRangeText} (${secondaryDurationText}) - Löschung ausstehend`}
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
            entryUserRole={entryUserRole}
          />
        )}
      </>
    );
  }

  // ──── Edit blocks ────
  if (editBlocks.length > 0) {
    return (
      <>
        {editBlocks.map((block, idx) => (
          <div
            key={`edit-${idx}`}
            className={cn(
              'absolute rounded-md',
              !hasLayout && 'top-1 h-14',
              block.type === 'add'
                ? 'bg-yellow-400/80 dark:bg-yellow-500/80'
                : 'bg-yellow-200/80 dark:bg-yellow-900/50'
            )}
            style={{
              left: `${block.left}px`,
              width: `${Math.max(block.width, 2)}px`,
              ...(hasLayout ? { top: blockTop, height: blockHeight } : {}),
              ...(block.type === 'remove' ? hatchedStyle : {})
            }}
            title={
              block.type === 'add'
                ? 'Hinzugefügte Zeit (ausstehend)'
                : 'Entfernte Zeit (ausstehend)'
            }
          />
        ))}

        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'absolute rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer z-10',
            !hasLayout && 'top-1 h-14',
            'flex flex-col items-center justify-center overflow-hidden',
            'hover:shadow-md hover:z-20 hover:scale-[1.02]',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            isOpen
              ? 'bg-green-500/60 text-white dark:bg-green-600/60 animate-pulse'
              : 'bg-green-500/80 text-white dark:bg-green-600/80'
          )}
          style={{
            left: `${mainBlockLeft}px`,
            width: `${Math.max(mainBlockWidth, 20)}px`,
            ...(hasLayout ? { top: blockTop, height: blockHeight } : {})
          }}
          title={`${timeRangeText} (${secondaryDurationText})`}
        >
          {mainBlockWidth > 80 && (
            <>
              <div className="flex items-center gap-1 truncate">
                <Clock className="h-3 w-3 shrink-0 opacity-80" />
                <span className="truncate">{timeRangeText}</span>
              </div>
              <div className="flex items-center gap-2 truncate text-[10px] opacity-85">
                <span className="flex items-center gap-1 truncate">
                  <BriefcaseBusiness className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">
                    {segmentSummary?.workText ?? durationText}
                  </span>
                </span>
                {segmentSummary?.breakText && (
                  <span className="flex items-center gap-1 truncate">
                    <Coffee className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{segmentSummary.breakText}</span>
                  </span>
                )}
              </div>
            </>
          )}
          {mainBlockWidth <= 80 && mainBlockWidth > 40 && (
            <div className="flex items-center gap-1 truncate">
              {segmentSummary?.breakText ? (
                <>
                  <BriefcaseBusiness className="h-3 w-3 shrink-0 opacity-80" />
                  <span className="truncate text-[10px]">
                    {segmentSummary.workText}
                  </span>
                  <Coffee className="h-3 w-3 shrink-0 opacity-70" />
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3 shrink-0 opacity-80" />
                  <span className="truncate">{durationText}</span>
                </>
              )}
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
            entryUserRole={entryUserRole}
          />
        )}
      </>
    );
  }

  // ──── Standard rendering (with drag-to-move/resize support) ────
  if (isDraggedAway) {
    return (
      <>
        {isDialogOpen && (
          <EntryDetailsDialog
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            session={session}
            currentUserRole={currentUserRole}
            currentUserId={currentUserId}
            onRefresh={onRefresh}
            entryUserRole={entryUserRole}
          />
        )}
      </>
    );
  }

  // Compute the live time range tooltip during drag
  const liveTimeRange = drag.isDragging
    ? `${formatTimeFromPx(drag.currentLeft, effectiveHourWidth)} - ${formatTimeFromPx(drag.currentLeft + drag.currentWidth, effectiveHourWidth)}`
    : timeRangeText;

  return (
    <>
      {/* Ghost at original position during drag */}
      {drag.isDragging && (
        <div
          className={cn(
            'absolute rounded-md border-2 border-dashed pointer-events-none',
            !hasLayout && 'top-1 h-14',
            isOwnEntryNeedingApproval
              ? 'border-green-400/60 bg-green-500/15'
              : 'border-muted-foreground/30 bg-muted/20'
          )}
          style={{
            left: `${left}px`,
            width: `${width}px`,
            ...(hasLayout ? { top: blockTop, height: blockHeight } : {})
          }}
        />
      )}

      <div
        className={cn(
          'absolute rounded-md text-xs font-medium transition-shadow z-10',
          !hasLayout && 'top-1 h-14',
          'flex items-stretch overflow-hidden',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
          // Colors
          !isNewPendingEntry &&
            !isOpen &&
            !hasBackgroundSegments &&
            'bg-green-500/80 text-white dark:bg-green-600/80',
          isOpen &&
            !isNewPendingEntry &&
            !hasBackgroundSegments &&
            'bg-green-500/60 text-white dark:bg-green-600/60 animate-pulse',
          hasBackgroundSegments &&
            !isNewPendingEntry &&
            'text-white',
          hasBackgroundSegments &&
            isOpen &&
            !isNewPendingEntry &&
            'animate-pulse',
          isNewPendingEntry &&
            'bg-yellow-400/80 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100',
          isConflictTarget &&
            !drag.isDragging &&
            'ring-2 ring-red-500/70 bg-red-500/10',
          // Drag state
          drag.isDragging &&
            'opacity-90 shadow-lg ring-2 ring-white/30 scale-[0.990]',
          hasDropConflict && 'ring-red-500/80 bg-red-500/10',
          !drag.isDragging &&
            'hover:shadow-md hover:z-20 cursor-pointer'
        )}
        style={{
          left: `${displayLeft}${posUnit}`,
          width: `${displayWidth}${posUnit}`,
          ...(hasLayout ? { top: blockTop, height: blockHeight } : {}),
          transition: drag.isDragging
            ? 'none'
            : 'box-shadow 0.15s, transform 0.15s'
        }}
        onPointerMove={drag.handlers.onPointerMove}
        onPointerUp={drag.handlers.onPointerUp}
        title={
          drag.isDragging ? liveTimeRange : `${timeRangeText} (${secondaryDurationText})`
        }
      >
        {hasBackgroundSegments && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
            {displaySegments.map((segment) => (
              <div
                key={segment.id}
                className={cn(
                  'absolute inset-y-0',
                  segment.type === 'break'
                    ? 'bg-yellow-500/80'
                    : isOpen
                      ? 'bg-green-500/60 dark:bg-green-600/60'
                      : 'bg-green-500/80 dark:bg-green-600/80'
                )}
                style={{ left: segment.left, width: segment.width }}
              />
            ))}
          </div>
        )}
        {(isConflictTarget || hasDropConflict) && (
          <div className="pointer-events-none absolute inset-0 rounded-md border border-red-500/80 bg-red-500/10" />
        )}

        {/* Left resize handle */}
        {canResizeLeft && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-20 hover:bg-white/20 rounded-l-md"
            onPointerDown={drag.startResizeLeft}
          />
        )}
        {showResizeHint && (
          <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-not-allowed z-20 hover:bg-white/20 rounded-l-md" />
        )}

        {/* Main body — clickable / draggable */}
        <button
          className={cn(
            'flex-1 flex items-center justify-center px-2 py-1 overflow-hidden min-w-0',
            'relative z-[1]',
            !compact && 'flex-col',
            drag.isDragging && 'cursor-grabbing',
            !drag.isDragging && 'cursor-pointer'
          )}
          onPointerDown={
            canMove
              ? onBlockMoveStart && memberId
                ? (e: React.PointerEvent) => {
                    onBlockMoveStart(session, memberId, left, width, e);
                  }
                : drag.startMove
              : undefined
          }
          onClick={(e) => {
            if (drag.didDrag.current || dayViewDragDidOccurRef?.current) {
              e.preventDefault();
              return;
            }
            setIsDialogOpen(true);
          }}
        >
          {(usePercentage ? displayWidth > 5.5 : displayWidth > 80) && (
            compact ? (
              <div className="flex items-center gap-1 truncate">
                <Clock
                  className={cn(
                    'h-2.5 w-2.5 shrink-0',
                    hasBackgroundSegments ? 'opacity-100' : 'opacity-80'
                  )}
                />
                <span
                  className={cn(
                    'truncate text-[10px]',
                    hasBackgroundSegments ? 'opacity-100' : ''
                  )}
                >
                  {drag.isDragging ? liveTimeRange : timeRangeText}
                </span>
                <span
                  className={cn(
                    'text-[9px]',
                    hasBackgroundSegments ? 'opacity-90' : 'opacity-60'
                  )}
                >
                  •
                </span>
                <span
                  className={cn(
                    'truncate text-[10px]',
                    hasBackgroundSegments ? 'opacity-100' : 'opacity-80'
                  )}
                >
                  {segmentSummary?.breakText ? segmentSummary.workText : durationText}
                </span>
                {segmentSummary?.breakText && (
                  <>
                    <span
                      className={cn(
                        'text-[9px]',
                        hasBackgroundSegments ? 'opacity-90' : 'opacity-60'
                      )}
                    >
                      •
                    </span>
                    <Coffee
                      className={cn(
                        'h-2.5 w-2.5 shrink-0',
                        hasBackgroundSegments ? 'opacity-100' : 'opacity-80'
                      )}
                    />
                    <span
                      className={cn(
                        'truncate text-[10px]',
                        hasBackgroundSegments ? 'opacity-100' : 'opacity-80'
                      )}
                    >
                      {segmentSummary.breakText}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 truncate">
                  <Clock
                    className={cn(
                      'h-3 w-3 shrink-0',
                      hasBackgroundSegments ? 'opacity-100' : 'opacity-80'
                    )}
                  />
                  <span
                    className={cn(
                      'truncate',
                      hasBackgroundSegments ? 'opacity-100' : ''
                    )}
                  >
                    {drag.isDragging ? liveTimeRange : timeRangeText}
                  </span>
                </div>
                <div
                  className={cn(
                    'flex items-center gap-2 truncate text-[10px]',
                    hasBackgroundSegments ? 'opacity-100' : 'opacity-80'
                  )}
                >
                  <span className="flex items-center gap-1 truncate">
                    <BriefcaseBusiness className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">
                      {segmentSummary?.workText ?? durationText}
                    </span>
                  </span>
                  {segmentSummary?.breakText && (
                    <span className="flex items-center gap-1 truncate">
                      <Coffee className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{segmentSummary.breakText}</span>
                    </span>
                  )}
                </div>
              </>
            )
          )}
          {(usePercentage
            ? displayWidth <= 5.5 && displayWidth > 2.8
            : displayWidth <= 80 && displayWidth > 40) && (
            <div className="flex items-center gap-1 truncate">
              {segmentSummary?.breakText ? (
                <>
                  <BriefcaseBusiness
                    className={cn(
                      'shrink-0',
                      compact ? 'h-2.5 w-2.5' : 'h-3 w-3',
                      hasBackgroundSegments ? 'opacity-100' : 'opacity-80'
                    )}
                  />
                  <span className="truncate text-[10px]">
                    {segmentSummary.workText}
                  </span>
                  <Coffee
                    className={cn(
                      'shrink-0',
                      compact ? 'h-2.5 w-2.5' : 'h-3 w-3',
                      hasBackgroundSegments ? 'opacity-100' : 'opacity-70'
                    )}
                  />
                </>
              ) : (
                <>
                  <Clock
                    className={cn(
                      'shrink-0',
                      compact ? 'h-2.5 w-2.5' : 'h-3 w-3',
                      hasBackgroundSegments ? 'opacity-100' : 'opacity-80'
                    )}
                  />
                  <span className="truncate">{durationText}</span>
                </>
              )}
            </div>
          )}
          {(usePercentage ? displayWidth <= 2.8 : displayWidth <= 40) && (
            <Clock
              className={cn(
                'shrink-0',
                compact ? 'h-2.5 w-2.5' : 'h-3 w-3',
                hasBackgroundSegments ? 'opacity-100' : 'opacity-80'
              )}
            />
          )}
        </button>

        {/* Right resize handle */}
        {canResizeRight && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-20 hover:bg-white/20 rounded-r-md"
            onPointerDown={drag.startResizeRight}
          />
        )}
        {showResizeHint && session.clockOut && (
          <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-not-allowed z-20 hover:bg-white/20 rounded-r-md" />
        )}
      </div>

      {isDialogOpen && (
        <EntryDetailsDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          session={session}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onRefresh={onRefresh}
          entryUserRole={entryUserRole}
        />
      )}
    </>
  );
}
