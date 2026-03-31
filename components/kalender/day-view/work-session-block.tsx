'use client';

import { useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { ArrowUp, ArrowDown, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { HOUR_WIDTH, BASE_HOUR_WIDTH } from './timeline-grid';
import { useBlockDrag } from './use-block-drag';

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

export interface MoveResizeResult {
  clockInEntryId?: string;
  clockOutEntryId?: string;
  newClockInTimestamp: string;
  newClockOutTimestamp: string;
  originalClockInTimestamp: string;
  originalClockOutTimestamp: string;
}

interface WorkSessionBlockProps {
  session: WorkSession;
  left: number;
  width: number;
  isPending: boolean;
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
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return (hours + minutes / 60) * hourWidth;
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

export function WorkSessionBlock({
  session,
  left,
  width,
  isPending,
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
  layoutHeight
}: WorkSessionBlockProps) {
  const hasLayout = layoutTop !== undefined && layoutHeight !== undefined;
  const blockTop = hasLayout ? layoutTop : undefined;
  const blockHeight = hasLayout ? layoutHeight : undefined;
  const compact = hasLayout && layoutHeight <= 28;
  const posUnit = usePercentage ? '%' : 'px';
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const canDrag = useMemo(() => {
    if (!onMoveResize || !viewDate) return false;
    if (!session.clockIn || !session.clockOut) return false;
    if (session.isOrphan) return false;
    if (
      session.clockIn.status === 'pending_delete' ||
      session.clockOut.status === 'pending_delete'
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

  const showResizeHint = useMemo(() => {
    if (canDrag) return false;
    if (!onMoveResize || !viewDate) return false;
    if (!session.clockIn || !session.clockOut) return false;
    if (session.isOrphan || usePercentage) return false;
    if (
      session.clockIn.status === 'pending_delete' ||
      session.clockOut.status === 'pending_delete'
    )
      return false;
    return true;
  }, [canDrag, onMoveResize, viewDate, session, usePercentage]);

  const isOwnEntryNeedingApproval = useMemo(() => {
    if (currentUserRole !== 'buero') return false;
    return session.clockIn?.userId === currentUserId;
  }, [currentUserRole, session, currentUserId]);

  const handleDragComplete = useCallback(
    (newLeft: number, newWidth: number) => {
      if (!onMoveResize || !viewDate || !session.clockIn || !session.clockOut)
        return;

      const newClockIn = pixelToTimeStr(newLeft, effectiveHourWidth, viewDate);
      const newClockOut = pixelToTimeStr(
        newLeft + newWidth,
        effectiveHourWidth,
        viewDate
      );

      onMoveResize({
        clockInEntryId: session.clockIn.id,
        clockOutEntryId: session.clockOut.id,
        newClockInTimestamp: newClockIn,
        newClockOutTimestamp: newClockOut,
        originalClockInTimestamp: session.clockIn.timestamp,
        originalClockOutTimestamp: session.clockOut.timestamp
      });
    },
    [onMoveResize, viewDate, session, effectiveHourWidth]
  );

  const drag = useBlockDrag({
    left,
    width,
    effectiveHourWidth,
    enabled: canDrag,
    onComplete: handleDragComplete
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

  const displayLeft = drag.isDragging ? drag.currentLeft : left;
  const displayWidth = drag.isDragging ? drag.currentWidth : width;

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
            'bg-green-500/80 text-white dark:bg-green-600/80',
          isOpen &&
            !isNewPendingEntry &&
            'bg-green-500/60 text-white dark:bg-green-600/60 animate-pulse',
          isNewPendingEntry &&
            'bg-yellow-400/80 text-yellow-900 dark:bg-yellow-500/80 dark:text-yellow-100',
          // Drag state
          drag.isDragging &&
            'opacity-90 shadow-lg ring-2 ring-white/30 scale-[0.990]',
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
          drag.isDragging ? liveTimeRange : `${timeRangeText} (${durationText})`
        }
      >
        {/* Left resize handle */}
        {canDrag && (
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
            !compact && 'flex-col',
            drag.isDragging && 'cursor-grabbing',
            !drag.isDragging && 'cursor-pointer'
          )}
          onPointerDown={
            canDrag
              ? onBlockMoveStart && memberId
                ? (e: React.PointerEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
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
                <Clock className="h-2.5 w-2.5 shrink-0 opacity-80" />
                <span className="truncate text-[10px]">
                  {drag.isDragging ? liveTimeRange : timeRangeText}
                </span>
                <span className="opacity-60 text-[9px]">•</span>
                <span className="truncate text-[10px] opacity-80">
                  {durationText}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 truncate">
                  <Clock className="h-3 w-3 shrink-0 opacity-80" />
                  <span className="truncate">
                    {drag.isDragging ? liveTimeRange : timeRangeText}
                  </span>
                </div>
                <span className="truncate text-[10px] opacity-80">
                  {durationText}
                </span>
              </>
            )
          )}
          {(usePercentage
            ? displayWidth <= 5.5 && displayWidth > 2.8
            : displayWidth <= 80 && displayWidth > 40) && (
            <div className="flex items-center gap-1 truncate">
              <Clock className={cn('shrink-0 opacity-80', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
              <span className="truncate">{durationText}</span>
            </div>
          )}
          {(usePercentage ? displayWidth <= 2.8 : displayWidth <= 40) && (
            <Clock className={cn('shrink-0 opacity-80', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
          )}
        </button>

        {/* Right resize handle */}
        {canDrag && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-20 hover:bg-white/20 rounded-r-md"
            onPointerDown={drag.startResizeRight}
          />
        )}
        {showResizeHint && (
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
