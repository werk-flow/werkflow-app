'use client';

import { useMemo, useCallback, useState } from 'react';
import {
  calculateBlockPosition,
  BASE_HOUR_WIDTH,
  snapToGrid,
  formatTimeFromPx
} from './timeline-grid';
import { WorkSessionBlock, type MoveResizeResult } from './work-session-block';
import { JobBlock, type JobMoveResizeResult } from './job-block';
import { DragToCreateOverlay } from './drag-to-create';
import {
  DAY_VIEW_ROW_HEIGHT,
  DAY_VIEW_ROW_INNER_HEIGHT,
  DAY_VIEW_ROW_PADDING
} from './layout-constants';
import { PARKPLATZ_MIME, type DragJobPayload } from '../parkplatz-panel';
import {
  formatDuration,
  calculateTotalMinutes
} from '@/lib/time-tracking/helpers';
import {
  calculateCalendarWorkBlocks,
  createSessionFromCalendarBlock,
  getCalendarBlockDisplaySegments,
} from '@/lib/time-tracking/calendar-blocks';
import { computeOverlapLayout } from '@/lib/calendar/overlap';
import { cn } from '@/lib/utils';
import type {
  InteractiveCalendarSession,
  TimeEntry,
  WorkSession,
  EntryChangeRequestMap
} from '@/lib/time-tracking/types';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface EmployeeTimelineRowProps {
  member: CalendarMember;
  sessions: WorkSession[];
  entries: TimeEntry[];
  date?: Date;
  organizationSettings?: OrganizationTimeTrackingSettings;
  currentUserRole?: OrgRole;
  currentUserId?: string;
  onRefresh?: () => void;
  showNameOnly?: boolean;
  showTimelineOnly?: boolean;
  changeRequestMap?: EntryChangeRequestMap;
  isHighlighted?: boolean;
  /** Effective pixel width per hour (zoom-aware). Falls back to BASE_HOUR_WIDTH. */
  effectiveHourWidth?: number;
  /** Total pixel width of the timeline. */
  timelineWidth?: number;
  /** Shared current-time position calculated once by DayView. */
  currentTimePosition?: number | null;
  /** Callback when user drags to create a new entry on this member's row. */
  onDragCreate?: (memberId: string, startTime: string, endTime: string) => void;
  /** Callback when user drags to move/resize a work session block. */
  onMoveResize?: (result: MoveResizeResult) => void;
  /** Called when user starts a whole-block move drag (for cross-row support). */
  onBlockMoveStart?: (
    session: WorkSession,
    memberId: string,
    left: number,
    width: number,
    e: React.PointerEvent<Element>
  ) => void;
  /** Session ID (clockIn or clockOut) that is currently being dragged across rows. */
  activeDragSessionId?: string | null;
  /** Calendar block IDs that the active drag currently conflicts with. */
  activeConflictTargetIds?: string[];
  /** Ref set by DayView when cross-row drag occurred (prevents click opening dialog). */
  dayViewDragDidOccurRef?: React.RefObject<boolean>;
  /** Timed jobs to display as blocks on this member's row. */
  jobs?: CalendarJob[];
  /** Callback when a job block is clicked. */
  onJobClick?: (job: CalendarJob, position: { x: number; y: number }) => void;
  /** Callback when user drags to move/resize a job block. */
  onJobMoveResize?: (result: JobMoveResizeResult) => void;
  /** Called when user starts a cross-row move on a job block. */
  onJobBlockMoveStart?: (
    job: CalendarJob,
    memberId: string,
    left: number,
    width: number,
    e: React.PointerEvent
  ) => void;
  /** Job ID that is currently being dragged across rows. */
  activeDragJobId?: string | null;
  /** Callback when a Parkplatz job is dropped onto this row. */
  onUnparkJob?: (jobId: string, date: string, time: string, memberId: string, durationMinutes?: number) => void;
  /** Callback when an untimed day-row job is dropped onto this row to schedule it. */
  onScheduleJob?: (jobId: string, date: string, time: string, memberId: string, durationMinutes: number) => void;
  /** Shadow pill to render for parkplatz drag preview. */
  parkplatzShadow?: { left: number; width: number } | null;
  /** Whether this row is the target of a parkplatz drag (for highlight). */
  isParkplatzDragTarget?: boolean;
  /** Callback when a parkplatz pill is dragged over this row. */
  onParkplatzDragOver?: (memberId: string, snappedLeft: number) => void;
  /** Active job drag shadow state — renders shadow pills for matching jobs in this row */
  jobDragShadow?: { jobId: string; left: number; width: number; sourceMemberId?: string } | null;
  /** Callback during in-row job drag to report position for shadow mirroring */
  onJobDragUpdate?: (jobId: string, left: number, width: number, memberId?: string) => void;
  /** Callback when in-row job drag ends */
  onJobDragEnd?: (jobId: string) => void;
  /** Callback when a session move/resize is rejected locally before drop. */
  onInvalidSessionPlacement?: (message: string) => void;
}

const DEFAULT_DAY_SCHEDULE_DURATION_MINUTES = 240;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  buero: 'Büro',
  employee: 'Handwerker'
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MIN_LAYOUT_WIDTH = 0.5;

function getMemberDisplayName(member: CalendarMember): string {
  if (member.first_name || member.last_name) {
    return `${member.first_name || ''} ${member.last_name || ''}`.trim();
  }
  return member.email;
}

function getExactLayoutWidth(
  startTime: Date,
  endTime: Date | null,
  hourWidth: number
): number {
  const effectiveEnd =
    endTime ??
    (startTime.toDateString() === new Date().toDateString()
      ? new Date()
      : new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate(), 24, 0, 0, 0));

  const diffHours =
    (effectiveEnd.getTime() - startTime.getTime()) / (1000 * 60 * 60);

  return Math.max(diffHours * hourWidth, MIN_LAYOUT_WIDTH);
}

export function EmployeeTimelineRow({
  member,
  sessions,
  entries,
  date,
  organizationSettings,
  currentUserRole,
  currentUserId,
  onRefresh,
  showNameOnly = false,
  showTimelineOnly = false,
  changeRequestMap = {},
  isHighlighted = false,
  effectiveHourWidth = BASE_HOUR_WIDTH,
  timelineWidth: totalWidth,
  currentTimePosition = null,
  onDragCreate,
  onMoveResize,
  onBlockMoveStart,
  activeDragSessionId,
  activeConflictTargetIds = [],
  dayViewDragDidOccurRef,
  jobs,
  onJobClick,
  onJobMoveResize,
  onJobBlockMoveStart,
  activeDragJobId,
  onUnparkJob,
  onScheduleJob,
  parkplatzShadow,
  isParkplatzDragTarget,
  onParkplatzDragOver,
  jobDragShadow,
  onJobDragUpdate,
  onJobDragEnd,
  onInvalidSessionPlacement
}: EmployeeTimelineRowProps) {
  const timelineWidth = totalWidth ?? 24 * effectiveHourWidth;

  const totalMinutes = useMemo(() => {
    return calculateTotalMinutes(sessions);
  }, [sessions]);

  const hasPendingEntries = useMemo(() => {
    return entries.some((e) => e.status === 'pending');
  }, [entries]);

  const daySessionsWithBlocks = useMemo(() => {
    if (!date) return [];
    return sessions
      .filter((session) => session.isOrphan)
      .map((session) => {
        let referenceDate: Date;
        if (session.clockIn) {
          referenceDate = new Date(session.clockIn.timestamp);
        } else if (session.clockOut) {
          referenceDate = new Date(session.clockOut.timestamp);
        } else {
          return null;
        }

        const clockOutDate = session.clockOut
          ? new Date(session.clockOut.timestamp)
          : null;

        const isOnDay = referenceDate.toDateString() === date.toDateString();
        if (!isOnDay) return null;

        const { left } = calculateBlockPosition(
          referenceDate,
          clockOutDate,
          effectiveHourWidth
        );

        return {
          session,
          left,
          layoutWidth: getExactLayoutWidth(
            referenceDate,
            clockOutDate,
            effectiveHourWidth
          ),
          isPending:
            session.clockIn?.status === 'pending' ||
            session.clockOut?.status === 'pending'
        };
      })
      .filter(Boolean) as Array<{
      session: WorkSession;
      left: number;
      width: number;
      layoutWidth: number;
      isPending: boolean;
    }>;
  }, [sessions, date, effectiveHourWidth]);

  const dayEntries = useMemo(() => {
    if (!date) return [];
    return entries.filter((entry) => {
      const entryDate = new Date(entry.timestamp);
      return entryDate.toDateString() === date.toDateString();
    });
  }, [entries, date]);
  const dayWorkBlocks = useMemo(() => {
    if (!date) return [];
    void currentTimePosition;
    const blockReferenceDate = new Date();

    return calculateCalendarWorkBlocks(dayEntries).map((block) => {
      const start = new Date(block.start);
      const end = block.end ? new Date(block.end) : null;
      const { left } = calculateBlockPosition(start, end, effectiveHourWidth);
      const layoutWidth = getExactLayoutWidth(start, end, effectiveHourWidth);
      const displaySegments = getCalendarBlockDisplaySegments(
        block,
        blockReferenceDate,
        organizationSettings
      );
      const segments = displaySegments.map((segment) => {
        const segmentPosition = calculateBlockPosition(
          new Date(segment.start),
          segment.end ? new Date(segment.end) : null,
          effectiveHourWidth
        );

        return {
          id: segment.id,
          type: segment.type,
          left: Math.max(0, segmentPosition.left - left),
          width: Math.max(2, segmentPosition.width)
        };
      });

      return {
        block,
        left,
        width: layoutWidth,
        layoutWidth,
        segments
      };
    });
  }, [date, dayEntries, effectiveHourWidth, organizationSettings, currentTimePosition]);

  const dayJobsWithBlocks = useMemo(() => {
    if (!date || !jobs?.length) return [];
    return jobs
      .filter((j) => j.plannedTime && j.estimatedDurationMinutes)
      .map((job) => {
        const start = new Date(`${job.plannedDate}T${job.plannedTime}:00`);
        const end = new Date(start.getTime() + job.estimatedDurationMinutes! * 60000);
        const { left, width } = calculateBlockPosition(start, end, effectiveHourWidth);
        return {
          job,
          left,
          width,
          layoutWidth: getExactLayoutWidth(start, end, effectiveHourWidth)
        };
      });
  }, [jobs, date, effectiveHourWidth]);

  const sessionCollisionBlocks = useMemo(
    () =>
      dayWorkBlocks.map(({ block, left, layoutWidth }) => ({
        id: block.id,
        left,
        width: layoutWidth
      })),
    [dayWorkBlocks]
  );

  const blockLayout = useMemo(() => {
    const blocks = [
      ...dayWorkBlocks.map((block) => ({
        id: `work-block-${block.block.id}`,
        left: block.left,
        width: block.layoutWidth,
      })),
      ...daySessionsWithBlocks.map((s) => ({
        id: `session-${s.session.clockIn?.id ?? s.session.clockOut?.id}`,
        left: s.left,
        width: s.layoutWidth,
      })),
      ...dayJobsWithBlocks.map((j) => ({
        id: `job-${j.job.id}`,
        left: j.left,
        width: j.layoutWidth,
      })),
    ];
    return computeOverlapLayout(blocks);
  }, [dayWorkBlocks, daySessionsWithBlocks, dayJobsWithBlocks]);

  function getLayoutProps(blockId: string) {
    const layout = blockLayout.get(blockId);
    if (!layout || layout.totalColumns <= 1) {
      return {
        layoutTop: DAY_VIEW_ROW_PADDING,
        layoutHeight: DAY_VIEW_ROW_INNER_HEIGHT
      };
    }
    const colHeight = DAY_VIEW_ROW_INNER_HEIGHT / layout.totalColumns;
    return {
      layoutTop: DAY_VIEW_ROW_PADDING + layout.columnIndex * colHeight,
      layoutHeight: colHeight,
    };
  }

  const isToday = date
    ? date.toDateString() === new Date().toDateString()
    : false;

  const wrappedJobDragUpdate = useCallback(
    (jobId: string, left: number, width: number) => {
      onJobDragUpdate?.(jobId, left, width, member.user_id);
    },
    [onJobDragUpdate, member.user_id]
  );
  const [dragConflictState, setDragConflictState] = useState<{
    sourceId: string | null;
    targetIds: string[];
  }>({
    sourceId: null,
    targetIds: []
  });

  const handleConflictTargetsChange = useCallback(
    (sourceId: string, targetIds: string[]) => {
      setDragConflictState((prev) => {
        if (targetIds.length === 0) {
          if (prev.sourceId === null && prev.targetIds.length === 0) {
            return prev;
          }
          return { sourceId: null, targetIds: [] };
        }

        if (
          prev.sourceId === sourceId &&
          prev.targetIds.length === targetIds.length &&
          prev.targetIds.every((targetId) => targetIds.includes(targetId))
        ) {
          return prev;
        }

        return { sourceId: sourceId, targetIds };
      });
    },
    []
  );

  if (showNameOnly) {
    return (
      <div
        className={cn(
          'px-3 flex flex-col justify-center transition-colors',
          isHighlighted
            ? 'animate-row-highlight bg-[rgba(123,44,191,0.15)]'
            : isParkplatzDragTarget
              ? 'bg-brand-purple/[0.08]'
              : 'hover:bg-muted/30',
          parkplatzShadow && !isParkplatzDragTarget && 'bg-brand-purple/[0.04]'
        )}
        style={{ height: DAY_VIEW_ROW_HEIGHT }}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            {getMemberDisplayName(member)}
          </span>
          {hasPendingEntries && (
            <span
              className="h-2 w-2 rounded-full bg-yellow-500 shrink-0"
              title="Ausstehende Einträge"
            />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{ROLE_LABELS[member.role] || member.role}</span>
          <span>•</span>
          <span>{totalMinutes > 0 ? formatDuration(totalMinutes) : '—'}</span>
        </div>
      </div>
    );
  }

  if (showTimelineOnly) {
    return (
      <div
        className={cn(
          'relative transition-colors',
          isHighlighted
            ? 'animate-row-highlight bg-[rgba(123,44,191,0.15)]'
            : isParkplatzDragTarget
              ? 'bg-brand-purple/[0.08] ring-1 ring-inset ring-brand-purple/20'
              : 'hover:bg-muted/30',
          parkplatzShadow && !isParkplatzDragTarget && 'bg-brand-purple/[0.03]'
        )}
        style={{ width: timelineWidth, height: DAY_VIEW_ROW_HEIGHT }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(PARKPLATZ_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (onParkplatzDragOver) {
              const rawX = e.clientX - e.currentTarget.getBoundingClientRect().left;
              onParkplatzDragOver(member.user_id, rawX);
            }
          }
        }}
        onDrop={(e) => {
          document.body.classList.remove('is-dragging');
          const raw = e.dataTransfer.getData(PARKPLATZ_MIME);
          if (!raw || !date) return;
          e.preventDefault();
          try {
            const payload: DragJobPayload = JSON.parse(raw);
            const rawX = e.clientX - e.currentTarget.getBoundingClientRect().left;
            const durationMinutes =
              payload.durationMinutes ?? DEFAULT_DAY_SCHEDULE_DURATION_MINUTES;
            const dragWidth = (durationMinutes / 60) * effectiveHourWidth;
            const anchorOffset = payload.source === 'parkplatz' ? dragWidth / 2 : 0;
            const snappedX = Math.max(
              0,
              Math.min(
                timelineWidth - dragWidth,
                snapToGrid(rawX - anchorOffset, effectiveHourWidth)
              )
            );
            const time = formatTimeFromPx(snappedX, effectiveHourWidth);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

            if (payload.source === 'parkplatz' && onUnparkJob) {
              onUnparkJob(
                payload.jobId,
                dateStr,
                time,
                member.user_id,
                durationMinutes
              );
            } else if (payload.source === 'day' && onScheduleJob) {
              const dur =
                payload.durationMinutes ?? DEFAULT_DAY_SCHEDULE_DURATION_MINUTES;
              onScheduleJob(payload.jobId, dateStr, time, member.user_id, dur);
            }
          } catch { /* ignore parse errors */ }
        }}
      >
        {/* Hour + sub grid lines */}
        {HOURS.map((hour) => {
          const subs: number[] =
            effectiveHourWidth >= 200 ? [15, 30, 45] :
            effectiveHourWidth >= 120 ? [30] : [];
          return (
            <div key={hour}>
              <div
                className="absolute top-0 h-full border-l border-border/30"
                style={{ left: hour * effectiveHourWidth }}
              />
              {subs.map((m) => (
                <div
                  key={m}
                  className="absolute top-0 h-full border-l border-border/15"
                  style={{ left: hour * effectiveHourWidth + (m / 60) * effectiveHourWidth }}
                />
              ))}
            </div>
          );
        })}

        {/* Current time indicator */}
        {isToday && currentTimePosition !== null && (
          <div
            className="absolute top-0 z-10 h-full w-0.5 -translate-x-1/2 bg-destructive/50"
            style={{ left: currentTimePosition }}
          />
        )}

        {/* Drag-to-create overlay */}
        {onDragCreate && (
          <DragToCreateOverlay
            effectiveHourWidth={effectiveHourWidth}
            timelineWidth={timelineWidth}
            memberId={member.user_id}
            onCreateEntry={onDragCreate}
            canCreate={
              currentUserRole === 'admin' ||
              (currentUserRole === 'buero' && (
                member.role === 'employee' || member.user_id === currentUserId
              ))
            }
          />
        )}

        {/* Attendance blocks — merged across breaks when the work block continues */}
        {dayWorkBlocks.map(({ block, left, width, segments }) => {
          const layout = getLayoutProps(`work-block-${block.id}`);
          const session: InteractiveCalendarSession = {
            ...createSessionFromCalendarBlock(
              block,
              new Date(),
              organizationSettings
            ),
            employeeName: getMemberDisplayName(member),
            employeeRole: member.role as OrgRole
          };
          const sessionKey =
            session.calendarBlockId ?? session.clockIn?.id ?? session.clockOut?.id ?? block.id;
          const isDraggedAway = activeDragSessionId === sessionKey;
          const blockedRanges = sessionCollisionBlocks.filter(
            (collisionBlock) => collisionBlock.id !== block.id
          );

          return (
            <WorkSessionBlock
              key={`work-block-${block.id}`}
              blockId={block.id}
              session={session}
              left={left}
              width={width}
              isPending={block.isPending}
              backgroundSegments={segments}
              currentUserRole={currentUserRole!}
              currentUserId={currentUserId}
              onRefresh={onRefresh!}
              changeRequestMap={changeRequestMap}
              entryUserRole={member.role as OrgRole}
              effectiveHourWidth={effectiveHourWidth}
              onMoveResize={onMoveResize}
              viewDate={date}
              onBlockMoveStart={onBlockMoveStart}
              memberId={member.user_id}
              isDraggedAway={isDraggedAway}
              dayViewDragDidOccurRef={dayViewDragDidOccurRef}
              layoutTop={layout.layoutTop}
              layoutHeight={layout.layoutHeight}
              blockedRanges={blockedRanges}
              isConflictTarget={
                dragConflictState.targetIds.includes(block.id) ||
                activeConflictTargetIds.includes(block.id)
              }
              onConflictTargetsChange={handleConflictTargetsChange}
              onInvalidPlacement={onInvalidSessionPlacement}
            />
          );
        })}

        {/* Orphan session blocks — pixel positioning with overlap layout */}
        {daySessionsWithBlocks.map(
          ({ session, left, width, isPending }, index) => {
            const interactiveSession: InteractiveCalendarSession = {
              ...(session as InteractiveCalendarSession),
              employeeName: getMemberDisplayName(member),
              employeeRole: member.role as OrgRole
            };
            const sessionKey = session.clockIn?.id ?? session.clockOut?.id ?? String(index);
            const isDraggedAway = activeDragSessionId === sessionKey;
            const layout = getLayoutProps(`session-${sessionKey}`);
            return (
              <WorkSessionBlock
                key={`${sessionKey}-${index}`}
                session={interactiveSession}
                left={left}
                width={width}
                isPending={isPending}
                currentUserRole={currentUserRole!}
                currentUserId={currentUserId}
                onRefresh={onRefresh!}
                changeRequestMap={changeRequestMap}
                entryUserRole={member.role as OrgRole}
                effectiveHourWidth={effectiveHourWidth}
                onMoveResize={onMoveResize}
                viewDate={date}
                onBlockMoveStart={onBlockMoveStart}
                memberId={member.user_id}
                isDraggedAway={isDraggedAway}
                dayViewDragDidOccurRef={dayViewDragDidOccurRef}
                layoutTop={layout.layoutTop}
                layoutHeight={layout.layoutHeight}
              />
            );
          }
        )}

        {/* Job blocks — pixel positioning with overlap layout */}
        {dayJobsWithBlocks.map(({ job, left, width }) => {
          const layout = getLayoutProps(`job-${job.id}`);
          const isJobDraggedAway = activeDragJobId === job.id;
          const isShadowedFromOtherRow =
            jobDragShadow?.jobId === job.id &&
            jobDragShadow.sourceMemberId !== member.user_id;
          if (isShadowedFromOtherRow) return null;
          return (
            <JobBlock
              key={`job-${job.id}`}
              job={job}
              left={left}
              width={width}
              layoutTop={layout.layoutTop}
              layoutHeight={layout.layoutHeight}
              onClick={onJobClick ?? (() => {})}
              effectiveHourWidth={effectiveHourWidth}
              onMoveResize={onJobMoveResize}
              onBlockMoveStart={onJobBlockMoveStart}
              memberId={member.user_id}
              isDraggedAway={isJobDraggedAway}
              dayViewDragDidOccurRef={dayViewDragDidOccurRef}
              onDragUpdate={wrappedJobDragUpdate}
              onDragEnd={onJobDragEnd}
            />
          );
        })}

        {/* Job drag shadow — mirrors drag/resize across rows that share the same job */}
        {jobDragShadow && (() => {
          const hasJob = dayJobsWithBlocks.some(({ job }) => job.id === jobDragShadow.jobId);
          if (!hasJob) return null;
          if (jobDragShadow.sourceMemberId === member.user_id) return null;
          return (
            <div
              className="absolute rounded-md border-2 border-dashed border-brand-purple/25 bg-brand-purple/8 pointer-events-none z-15 flex items-center justify-center gap-1"
              style={{
                left: jobDragShadow.left,
                width: jobDragShadow.width,
                top: DAY_VIEW_ROW_PADDING,
                height: DAY_VIEW_ROW_INNER_HEIGHT,
              }}
            >
              <span className="text-[10px] text-brand-purple/50 font-medium truncate px-1">
                {formatTimeFromPx(jobDragShadow.left, effectiveHourWidth)}
                {' – '}
                {formatTimeFromPx(jobDragShadow.left + jobDragShadow.width, effectiveHourWidth)}
              </span>
            </div>
          );
        })()}

        {/* Parkplatz drag shadow pill (only non-hovered assigned rows; hovered row uses the solid preview in DayView) */}
        {parkplatzShadow && !isParkplatzDragTarget && (
          <div
            className="absolute rounded-md border-2 border-dashed border-brand-purple/30 bg-brand-purple/8 pointer-events-none z-20 flex items-center justify-center gap-1"
            style={{
              left: parkplatzShadow.left,
              width: parkplatzShadow.width,
              top: DAY_VIEW_ROW_PADDING,
              height: DAY_VIEW_ROW_INNER_HEIGHT,
            }}
          >
            <span className="text-[10px] text-brand-purple/60 font-medium truncate px-1">
              {formatTimeFromPx(parkplatzShadow.left, effectiveHourWidth)}
              {' – '}
              {formatTimeFromPx(parkplatzShadow.left + parkplatzShadow.width, effectiveHourWidth)}
            </span>
          </div>
        )}
      </div>
    );
  }

  return null;
}
