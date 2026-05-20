'use client';

import { useMemo, useCallback } from 'react';
import { Briefcase, Building2, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBlockDrag } from './use-block-drag';
import type { CalendarJob } from '@/lib/jobs/types';

export interface JobMoveResizeResult {
  jobId: string;
  newPlannedTime: string;
  newDurationMinutes: number;
  originalPlannedTime: string;
  originalDurationMinutes: number;
}

interface JobBlockProps {
  job: CalendarJob;
  left: number;
  width: number;
  layoutTop: number;
  layoutHeight: number;
  onClick: (job: CalendarJob, position: { x: number; y: number }) => void;
  effectiveHourWidth?: number;
  onMoveResize?: (result: JobMoveResizeResult) => void;
  onBlockMoveStart?: (
    job: CalendarJob,
    memberId: string,
    left: number,
    width: number,
    e: React.PointerEvent
  ) => void;
  memberId?: string;
  isDraggedAway?: boolean;
  dayViewDragDidOccurRef?: React.RefObject<boolean>;
  onDragUpdate?: (jobId: string, left: number, width: number) => void;
  onDragEnd?: (jobId: string) => void;
}

function pixelToHHMM(px: number, hourWidth: number): string {
  const totalMinutes = Math.max(0, Math.min(24 * 60, Math.round((px / hourWidth) * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function pixelToMinutes(widthPx: number, hourWidth: number): number {
  return Math.max(1, Math.round((widthPx / hourWidth) * 60));
}

function formatTimeFromPx(px: number, hourWidth: number): string {
  return pixelToHHMM(px, hourWidth);
}

export function JobBlock({
  job,
  left,
  width,
  layoutTop,
  layoutHeight,
  onClick,
  effectiveHourWidth = 60,
  onMoveResize,
  onBlockMoveStart,
  memberId,
  isDraggedAway = false,
  dayViewDragDidOccurRef,
  onDragUpdate,
  onDragEnd: onDragEndProp,
}: JobBlockProps) {
  const compact = layoutHeight <= 32;
  const canShowMetadata = layoutHeight >= 72 && width >= 150;
  const addressLine = job.location ?? job.clientAddress;

  const canDrag = useMemo(() => {
    if (!onMoveResize) return false;
    return !!job.plannedTime && !!job.estimatedDurationMinutes;
  }, [onMoveResize, job.plannedTime, job.estimatedDurationMinutes]);

  const handleDragComplete = useCallback(
    (newLeft: number, newWidth: number) => {
      if (!onMoveResize || !job.plannedTime || !job.estimatedDurationMinutes) return;

      const newTime = pixelToHHMM(newLeft, effectiveHourWidth);
      const newDuration = pixelToMinutes(newWidth, effectiveHourWidth);

      onMoveResize({
        jobId: job.id,
        newPlannedTime: newTime,
        newDurationMinutes: newDuration,
        originalPlannedTime: job.plannedTime,
        originalDurationMinutes: job.estimatedDurationMinutes,
      });
    },
    [onMoveResize, job, effectiveHourWidth]
  );

  const handleBlockDragUpdate = useCallback(
    (newLeft: number, newWidth: number) => {
      onDragUpdate?.(job.id, newLeft, newWidth);
    },
    [onDragUpdate, job.id]
  );

  const handleBlockDragEnd = useCallback(() => {
    onDragEndProp?.(job.id);
  }, [onDragEndProp, job.id]);

  const drag = useBlockDrag({
    left,
    width,
    effectiveHourWidth,
    enabled: canDrag,
    onComplete: handleDragComplete,
    onDragUpdate: handleBlockDragUpdate,
    onDragEnd: handleBlockDragEnd,
  });

  const handleClick = (e: React.MouseEvent) => {
    if (dayViewDragDidOccurRef?.current) return;
    if (drag.didDrag.current) return;
    onClick(job, { x: e.clientX + 12, y: e.clientY + 12 });
  };

  const handleMovePointerDown = (e: React.PointerEvent) => {
    if (onBlockMoveStart && memberId) {
      onBlockMoveStart(job, memberId, drag.currentLeft, drag.currentWidth, e);
      return;
    }
    drag.startMove(e);
  };

  if (isDraggedAway) {
    return null;
  }

  const displayLeft = drag.currentLeft;
  const displayWidth = drag.currentWidth;
  const isResizing = drag.isDragging && drag.dragMode !== 'move';

  return (
    <>
      {/* Ghost outline at original position during resize */}
      {drag.isDragging && (
        <div
          className="absolute rounded-md border-2 border-dashed border-brand-purple/30 bg-brand-purple/5 pointer-events-none"
          style={{
            left,
            width,
            top: layoutTop,
            height: layoutHeight,
          }}
        />
      )}

      <div
        className={cn(
          'absolute rounded-md text-xs font-medium transition-shadow z-10',
          'flex items-center overflow-hidden',
          drag.isDragging
            ? 'bg-brand-purple/70 text-white shadow-lg z-30'
            : [
                'border border-brand-purple/40 bg-brand-purple/15 text-foreground',
                'border-l-[3px] border-l-brand-purple/70',
                'hover:shadow-md hover:z-20 hover:bg-brand-purple/25',
              ],
          'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1'
        )}
        style={{
          left: displayLeft,
          width: displayWidth,
          top: layoutTop,
          height: layoutHeight,
          cursor: drag.isDragging
            ? isResizing ? 'col-resize' : 'grabbing'
            : 'pointer',
        }}
        title={job.title}
        onClick={handleClick}
        {...drag.handlers}
      >
        {/* Left resize handle */}
        {canDrag && (
          <div
            className={cn(
              'absolute left-0 top-0 h-full w-1.5 z-20',
              drag.isDragging ? 'cursor-col-resize' : 'cursor-col-resize hover:bg-brand-purple/30'
            )}
            onPointerDown={drag.startResizeLeft}
          />
        )}

        {/* Move area */}
        <div
          className={cn(
            'w-full h-full overflow-hidden',
            compact && 'px-1',
            canDrag && !drag.isDragging && 'cursor-pointer'
          )}
          onPointerDown={canDrag ? handleMovePointerDown : undefined}
        >
          {drag.isDragging ? (
            <div className="flex h-full w-full items-center justify-center gap-1 overflow-hidden px-2">
              <Briefcase className={cn('shrink-0 opacity-80', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
              <span className="font-medium truncate">
                {formatTimeFromPx(displayLeft, effectiveHourWidth)}
                {' – '}
                {formatTimeFromPx(displayLeft + displayWidth, effectiveHourWidth)}
              </span>
            </div>
          ) : canShowMetadata ? (
            <div className="flex h-full w-full flex-col justify-center gap-1.5 overflow-hidden px-2 py-1.5">
              <div className="flex min-w-0 items-center gap-1">
                <Briefcase className="h-3 w-3 shrink-0 text-brand-purple" />
                <span className="truncate font-medium">{job.title}</span>
              </div>
              {job.clientName && (
                <div className="flex min-w-0 items-center gap-1 text-[10px]/[1.3] text-muted-foreground">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{job.clientName}</span>
                </div>
              )}
              {addressLine && (
                <div className="flex min-w-0 items-center gap-1 text-[10px]/[1.3] text-muted-foreground">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{addressLine}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full w-full items-center gap-1 overflow-hidden px-2">
              <Briefcase className={cn('shrink-0 text-brand-purple', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
              {displayWidth > 48 && (
                <span className="font-medium truncate">{job.title}</span>
              )}
            </div>
          )}
        </div>

        {/* Right resize handle */}
        {canDrag && (
          <div
            className={cn(
              'absolute right-0 top-0 h-full w-1.5 z-20',
              drag.isDragging ? 'cursor-col-resize' : 'cursor-col-resize hover:bg-brand-purple/30'
            )}
            onPointerDown={drag.startResizeRight}
          />
        )}
      </div>
    </>
  );
}
