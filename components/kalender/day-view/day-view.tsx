'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Briefcase, Clock, ParkingSquare } from 'lucide-react';
import { TimelineHeader } from './timeline-header';
import { EmployeeTimelineRow } from './employee-timeline-row';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import { Skeleton } from '@/components/ui/skeleton';
import { useTimelineZoom } from './use-timeline-zoom';
import { snapToGrid, formatTimeFromPx, pixelToTimeStr } from './timeline-grid';
import { cn, toLocalDateString } from '@/lib/utils';
import { CalendarEntryDialog } from '../calendar-entry-dialog';
import { updateEntry, cancelOwnChangeRequest, reassignEntries } from '@/lib/time-tracking/actions';
import { updateJob, unassignEmployee, assignEmployee } from '@/lib/jobs/actions';
import type { JobMoveResizeResult } from './job-block';
import { ActionBanner, type ActionBannerState } from './undo-banner';
import type { MoveResizeResult } from './work-session-block';
import type {
  TimeEntry,
  WorkSession,
  EntryChangeRequestMap
} from '@/lib/time-tracking/types';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import { JobEventPopover } from '../job-event-popover';
import { PARKPLATZ_MIME, getDragGhost, type DragJobPayload } from '../parkplatz-panel';

interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface DayViewProps {
  date: Date;
  entries: TimeEntry[];
  members: CalendarMember[];
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  isLoading: boolean;
  onRefresh: () => void;
  onSilentRefresh?: () => void;
  onOperationStart?: () => void;
  onManualEntrySuccess?: (entries: TimeEntry[]) => void | Promise<void>;
  onJobSuccess?: () => void | Promise<void>;
  changeRequestMap?: EntryChangeRequestMap;
  highlightMemberId?: string | null;
  jobs?: CalendarJob[];
  onParkJob?: (jobId: string) => void;
  onUnparkJob?: (jobId: string, date: string, time?: string, memberId?: string) => void;
  onScheduleJob?: (jobId: string, date: string, time: string, memberId: string, durationMinutes: number) => void;
  parkplatzButtonRef?: React.RefObject<HTMLElement | null>;
  parkplatzDragJob?: CalendarJob | null;
}

export function DayView({
  date,
  entries,
  members,
  currentUserId,
  currentUserRole,
  isLoading,
  onRefresh,
  onSilentRefresh,
  onOperationStart,
  onManualEntrySuccess,
  onJobSuccess,
  changeRequestMap = {},
  highlightMemberId,
  jobs = [],
  onParkJob,
  onUnparkJob,
  onScheduleJob,
  parkplatzButtonRef,
  parkplatzDragJob
}: DayViewProps) {
  const [selectedJob, setSelectedJob] = useState<{
    job: CalendarJob;
    position: { x: number; y: number };
  } | null>(null);

  // Drag-to-create state
  const [dragCreateOpen, setDragCreateOpen] = useState(false);
  const [dragCreateMemberId, setDragCreateMemberId] = useState<string>('');
  const [dragCreateClockIn, setDragCreateClockIn] = useState<string>('09:00');
  const [dragCreateClockOut, setDragCreateClockOut] = useState<string>('17:00');

  const bannerSeqRef = useRef(0);
  const [activeBanner, setActiveBanner] = useState<ActionBannerState | null>(null);

  const handleDragCreate = useCallback((memberId: string, startTime: string, endTime: string) => {
    setDragCreateMemberId(memberId);
    setDragCreateClockIn(startTime);
    setDragCreateClockOut(endTime);
    setDragCreateOpen(true);
  }, []);

  const silentRefresh = onSilentRefresh ?? onRefresh;

  const {
    scrollContainerRef,
    effectiveHourWidth,
    timelineWidth,
    resetZoom
  } = useTimelineZoom();

  const dateKey = date.toISOString();
  useEffect(() => {
    resetZoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  // ── Optimistic entry overrides (instant UI before server round-trip) ──
  const [optimisticOverrides, setOptimisticOverrides] = useState<
    Map<string, { timestamp?: string; userId?: string }>
  >(new Map());

  const effectiveEntries = useMemo(() => {
    if (optimisticOverrides.size === 0) return entries;
    return entries.map(entry => {
      const ov = optimisticOverrides.get(entry.id);
      if (!ov) return entry;
      return {
        ...entry,
        ...(ov.timestamp !== undefined ? { timestamp: ov.timestamp } : {}),
        ...(ov.userId !== undefined ? { userId: ov.userId } : {}),
      };
    });
  }, [entries, optimisticOverrides]);

  useEffect(() => {
    if (optimisticOverrides.size === 0) return;
    const next = new Map(optimisticOverrides);
    let changed = false;
    for (const [entryId, ov] of optimisticOverrides) {
      const real = entries.find(e => e.id === entryId);
      if (!real) continue;
      const tsMatch = !ov.timestamp || real.timestamp === ov.timestamp;
      const userMatch = !ov.userId || real.userId === ov.userId;
      if (tsMatch && userMatch) {
        next.delete(entryId);
        changed = true;
      }
    }
    if (changed) setOptimisticOverrides(next);
  }, [entries, optimisticOverrides]);

  // ── Optimistic job overrides (instant UI before server round-trip) ──
  const [jobOverrides, setJobOverrides] = useState<
    Map<string, { plannedTime?: string; estimatedDurationMinutes?: number; assignedUserIds?: string[] }>
  >(new Map());

  const effectiveJobs = useMemo(() => {
    if (jobOverrides.size === 0) return jobs;
    return jobs.map(job => {
      const ov = jobOverrides.get(job.id);
      if (!ov) return job;
      return { ...job, ...ov };
    });
  }, [jobs, jobOverrides]);

  useEffect(() => {
    if (jobOverrides.size === 0) return;
    const next = new Map(jobOverrides);
    let changed = false;
    for (const [jobId, ov] of jobOverrides) {
      const real = jobs.find(j => j.id === jobId);
      if (!real) continue;
      const timeMatch = !ov.plannedTime || real.plannedTime === ov.plannedTime;
      const durationMatch = !ov.estimatedDurationMinutes || real.estimatedDurationMinutes === ov.estimatedDurationMinutes;
      const assignMatch = !ov.assignedUserIds ||
        (real.assignedUserIds.length === ov.assignedUserIds.length &&
         ov.assignedUserIds.every(id => real.assignedUserIds.includes(id)));
      if (timeMatch && durationMatch && assignMatch) {
        next.delete(jobId);
        changed = true;
      }
    }
    if (changed) setJobOverrides(next);
  }, [jobs, jobOverrides]);

  const handleMoveResize = useCallback(async (result: MoveResizeResult) => {
    const clockInChanged =
      !!result.clockInEntryId &&
      result.newClockInTimestamp !== result.originalClockInTimestamp;
    const clockOutChanged =
      !!result.clockOutEntryId &&
      result.newClockOutTimestamp !== result.originalClockOutTimestamp;

    if (!clockInChanged && !clockOutChanged) return;

    const isMove = clockInChanged && clockOutChanged;

    const forwardOv = new Map<string, { timestamp: string }>();
    const reverseOv = new Map<string, { timestamp: string }>();
    if (clockInChanged) {
      forwardOv.set(result.clockInEntryId!, { timestamp: result.newClockInTimestamp });
      reverseOv.set(result.clockInEntryId!, { timestamp: result.originalClockInTimestamp });
    }
    if (clockOutChanged) {
      forwardOv.set(result.clockOutEntryId!, { timestamp: result.newClockOutTimestamp });
      reverseOv.set(result.clockOutEntryId!, { timestamp: result.originalClockOutTimestamp });
    }

    onOperationStart?.();
    setOptimisticOverrides(prev => {
      const next = new Map(prev);
      for (const [id, val] of forwardOv) next.set(id, val);
      return next;
    });

    const undone = { current: false };

    const message = isMove
      ? 'Zeiteintrag wurde verschoben.'
      : 'Zeiteintrag wurde geändert.';
    setActiveBanner({
      id: ++bannerSeqRef.current,
      variant: 'success',
      message,
      onUndo: async () => {
        undone.current = true;
        onOperationStart?.();
        setOptimisticOverrides(prev => {
          const next = new Map(prev);
          for (const [id, val] of reverseOv) next.set(id, val);
          return next;
        });
        const revUpdates: Promise<unknown>[] = [];
        for (const [entryId, { timestamp }] of reverseOv) {
          revUpdates.push(updateEntry(entryId, { timestamp }));
        }
        await Promise.all(revUpdates);
        silentRefresh();
      },
    });

    type UpdateItem = { entryId: string; newTs: string; origTs: string };
    const updates: UpdateItem[] = [];

    if (clockInChanged && clockOutChanged) {
      const movingLater =
        new Date(result.newClockInTimestamp).getTime() >
        new Date(result.originalClockInTimestamp).getTime();
      const ciItem: UpdateItem = {
        entryId: result.clockInEntryId!,
        newTs: result.newClockInTimestamp,
        origTs: result.originalClockInTimestamp,
      };
      const coItem: UpdateItem = {
        entryId: result.clockOutEntryId!,
        newTs: result.newClockOutTimestamp,
        origTs: result.originalClockOutTimestamp,
      };
      updates.push(movingLater ? coItem : ciItem, movingLater ? ciItem : coItem);
    } else {
      if (clockInChanged) {
        updates.push({ entryId: result.clockInEntryId!, newTs: result.newClockInTimestamp, origTs: result.originalClockInTimestamp });
      }
      if (clockOutChanged) {
        updates.push({ entryId: result.clockOutEntryId!, newTs: result.newClockOutTimestamp, origTs: result.originalClockOutTimestamp });
      }
    }

    const results: Array<{ entryId: string; success: boolean; requestId?: string }> = [];

    for (const update of updates) {
      if (undone.current) { silentRefresh(); return; }
      const r = await updateEntry(update.entryId, { timestamp: update.newTs });
      const requestId = r.success && 'request' in r ? r.request.id : undefined;
      results.push({ entryId: update.entryId, success: r.success, requestId });

      if (!r.success) {
        for (const prev of results) {
          if (!prev.success) continue;
          if (prev.requestId) {
            await cancelOwnChangeRequest(prev.requestId);
          } else {
            const orig = updates.find((u) => u.entryId === prev.entryId)?.origTs;
            if (orig) await updateEntry(prev.entryId, { timestamp: orig });
          }
        }
        break;
      }
    }

    if (undone.current) { silentRefresh(); return; }

    const allOk = results.length > 0 && results.every((r) => r.success);

    if (allOk) {
      silentRefresh();
    } else {
      setOptimisticOverrides(prev => {
        const next = new Map(prev);
        for (const [id, val] of reverseOv) next.set(id, val);
        return next;
      });
      silentRefresh();
      const errorMsg = isMove
        ? 'Zeiteintrag konnte nicht verschoben werden.'
        : 'Zeiteintrag konnte nicht geändert werden.';
      setActiveBanner({ id: ++bannerSeqRef.current, variant: 'error', message: errorMsg });
    }
  }, [silentRefresh, onOperationStart]);

  const handleJobMoveResize = useCallback(async (result: JobMoveResizeResult) => {
    const { jobId, newPlannedTime, newDurationMinutes, originalPlannedTime, originalDurationMinutes } = result;

    if (newPlannedTime === originalPlannedTime && newDurationMinutes === originalDurationMinutes) return;

    const isMove = newPlannedTime !== originalPlannedTime;

    onOperationStart?.();
    setJobOverrides(prev => {
      const next = new Map(prev);
      next.set(jobId, { plannedTime: newPlannedTime, estimatedDurationMinutes: newDurationMinutes });
      return next;
    });

    const undone = { current: false };

    setActiveBanner({
      id: ++bannerSeqRef.current,
      variant: 'success',
      message: isMove ? 'Auftrag wurde verschoben.' : 'Auftrag wurde geändert.',
      onUndo: async () => {
        undone.current = true;
        onOperationStart?.();
        setJobOverrides(prev => {
          const next = new Map(prev);
          next.set(jobId, { plannedTime: originalPlannedTime, estimatedDurationMinutes: originalDurationMinutes });
          return next;
        });
        await updateJob(jobId, {
          plannedTime: originalPlannedTime,
          estimatedDurationMinutes: originalDurationMinutes,
        });
        silentRefresh();
      },
    });

    const updateResult = await updateJob(jobId, {
      plannedTime: newPlannedTime,
      estimatedDurationMinutes: newDurationMinutes,
    });

    if (undone.current) { silentRefresh(); return; }

    if (updateResult.success) {
      silentRefresh();
    } else {
      setJobOverrides(prev => {
        const next = new Map(prev);
        next.set(jobId, { plannedTime: originalPlannedTime, estimatedDurationMinutes: originalDurationMinutes });
        return next;
      });
      silentRefresh();
      setActiveBanner({
        id: ++bannerSeqRef.current,
        variant: 'error',
        message: isMove ? 'Auftrag konnte nicht verschoben werden.' : 'Auftrag konnte nicht geändert werden.',
      });
    }
  }, [silentRefresh, onOperationStart]);

  // ── Cross-row drag state ──
  type DragBlockPayload =
    | { type: 'session'; session: WorkSession }
    | { type: 'job'; job: CalendarJob };

  interface ActiveBlockDrag {
    payload: DragBlockPayload;
    sourceMemberId: string;
    sourceRowIndex: number;
    originalLeft: number;
    originalWidth: number;
    currentLeft: number;
    currentRowIndex: number;
    canDrop: boolean;
    pointerOffsetX: number;
    isOverParkplatz?: boolean;
    isAboveGrid?: boolean;
    pointerClientX?: number;
    pointerClientY?: number;
  }
  const [activeDrag, setActiveDrag] = useState<ActiveBlockDrag | null>(null);
  const activeDragRef = useRef<ActiveBlockDrag | null>(null);
  const dragDidOccurRef = useRef(false);

  // Job block drag shadow state (for mirroring across rows)
  const [jobDragShadow, setJobDragShadow] = useState<{
    jobId: string;
    left: number;
    width: number;
    sourceMemberId?: string;
  } | null>(null);
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragThresholdMetRef = useRef(false);
  const dragPendingRef = useRef<{
    payload: DragBlockPayload;
    memberId: string;
    left: number;
    width: number;
    sourceRowIndex: number;
    pointerOffsetX: number;
    pointerId: number;
  } | null>(null);

  const HEADER_HEIGHT = 40;
  const ROW_HEIGHT = 64;

  const canDropOnMember = useCallback(
    (targetMember: CalendarMember): boolean => {
      if (currentUserRole === 'admin') return true;
      if (currentUserRole === 'buero') {
        if (targetMember.role === 'employee') return true;
        if (targetMember.user_id === currentUserId) return true;
        return false;
      }
      return false;
    },
    [currentUserRole, currentUserId]
  );

  // Refs that always hold the latest versions of values needed in window listeners
  const membersRef = useRef(members);
  membersRef.current = members;
  const canDropOnMemberRef = useRef(canDropOnMember);
  canDropOnMemberRef.current = canDropOnMember;
  const effectiveHourWidthRef = useRef(effectiveHourWidth);
  effectiveHourWidthRef.current = effectiveHourWidth;
  const timelineWidthRef = useRef(timelineWidth);
  timelineWidthRef.current = timelineWidth;
  const dateRef = useRef(date);
  dateRef.current = date;
  const handleMoveResizeRef = useRef(handleMoveResize);
  handleMoveResizeRef.current = handleMoveResize;
  const handleJobMoveResizeRef = useRef(handleJobMoveResize);
  handleJobMoveResizeRef.current = handleJobMoveResize;
  const parkplatzButtonRefLocal = useRef(parkplatzButtonRef);
  parkplatzButtonRefLocal.current = parkplatzButtonRef;
  const onParkJobRef = useRef(onParkJob);
  onParkJobRef.current = onParkJob;
  const setJobDragShadowRef = useRef(setJobDragShadow);
  setJobDragShadowRef.current = setJobDragShadow;

  // Stable wrapper functions for window event listeners
  const stableMoveHandler = useCallback((e: PointerEvent) => {
    const container = scrollContainerRef.current;
    const pending = dragPendingRef.current;
    if (!container) return;

    const dx = e.clientX - dragStartPosRef.current.x;
    const dy = e.clientY - dragStartPosRef.current.y;

    if (!dragThresholdMetRef.current) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      dragThresholdMetRef.current = true;
      dragDidOccurRef.current = true;
    }

    if (!pending && !activeDragRef.current) return;

    const containerRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;

    let sourceRowIndex: number;
    let originalLeft: number;
    let originalWidth: number;
    let pointerOffsetX: number;
    let payload: DragBlockPayload;
    let sourceMemberId: string;

    if (pending) {
      sourceRowIndex = pending.sourceRowIndex;
      originalLeft = pending.left;
      originalWidth = pending.width;
      pointerOffsetX = pending.pointerOffsetX;
      payload = pending.payload;
      sourceMemberId = pending.memberId;
      dragPendingRef.current = null;
    } else {
      const prev = activeDragRef.current!;
      sourceRowIndex = prev.sourceRowIndex;
      originalLeft = prev.originalLeft;
      originalWidth = prev.originalWidth;
      pointerOffsetX = prev.pointerOffsetX;
      payload = prev.payload;
      sourceMemberId = prev.sourceMemberId;
    }

    const ehw = effectiveHourWidthRef.current;
    const tlw = timelineWidthRef.current;
    const rawLeft = e.clientX - containerRect.left + scrollLeft - pointerOffsetX;
    const snapped = snapToGrid(rawLeft, ehw);
    const clampedLeft = Math.max(0, Math.min(snapped, tlw - originalWidth));

    const relativeY = e.clientY - containerRect.top + scrollTop - HEADER_HEIGHT;
    const rowIdx = Math.floor(relativeY / ROW_HEIGHT);
    const curMembers = membersRef.current;
    const clampedRow = Math.max(0, Math.min(rowIdx, curMembers.length - 1));
    const targetMember = curMembers[clampedRow];
    let canDrop = targetMember ? canDropOnMemberRef.current(targetMember) : false;

    if (canDrop && payload.type === 'job' && clampedRow !== sourceRowIndex) {
      const target = curMembers[clampedRow];
      if (target && payload.job.assignedUserIds.includes(target.user_id)) {
        canDrop = false;
      }
    }

    let overParkplatz = false;
    if (payload.type === 'job') {
      const btnRef = parkplatzButtonRefLocal.current;
      const btn = btnRef?.current;
      if (btn) {
        const pRect = btn.getBoundingClientRect();
        overParkplatz =
          e.clientX >= pRect.left && e.clientX <= pRect.right &&
          e.clientY >= pRect.top && e.clientY <= pRect.bottom;
      }
      if (!overParkplatz) {
        const panel = document.querySelector('[data-parkplatz-panel]');
        if (panel) {
          const pRect = panel.getBoundingClientRect();
          overParkplatz =
            e.clientX >= pRect.left && e.clientX <= pRect.right &&
            e.clientY >= pRect.top && e.clientY <= pRect.bottom;
        }
      }
    }

    const isAboveGrid = payload.type === 'job' && e.clientY < containerRect.top;

    const next: ActiveBlockDrag = {
      payload,
      sourceMemberId,
      sourceRowIndex,
      originalLeft,
      originalWidth,
      currentLeft: clampedLeft,
      currentRowIndex: clampedRow,
      canDrop: overParkplatz ? true : canDrop,
      pointerOffsetX,
      isOverParkplatz: overParkplatz,
      isAboveGrid: isAboveGrid || overParkplatz,
      pointerClientX: e.clientX,
      pointerClientY: e.clientY,
    };

    activeDragRef.current = next;
    setActiveDrag(next);

    if (payload.type === 'job') {
      setJobDragShadowRef.current({
        jobId: payload.job.id,
        left: clampedLeft,
        width: originalWidth,
        sourceMemberId: sourceMemberId,
      });
    }

    document.body.style.cursor = (overParkplatz || canDrop) ? 'grabbing' : 'not-allowed';
    document.body.style.userSelect = 'none';
  }, []); // stable — reads everything from refs

  const stableUpHandler = useCallback((_e: PointerEvent) => {
    window.removeEventListener('pointermove', stableMoveHandler);
    window.removeEventListener('pointerup', stableUpHandler);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    dragPendingRef.current = null;

    const drag = activeDragRef.current;
    activeDragRef.current = null;
    setActiveDrag(null);
    setJobDragShadowRef.current(null);

    if (!drag || !dragThresholdMetRef.current) {
      setTimeout(() => { dragDidOccurRef.current = false; }, 0);
      return;
    }

    if (drag.isOverParkplatz && drag.payload.type === 'job') {
      onParkJobRef.current?.(drag.payload.job.id);
      setTimeout(() => { dragDidOccurRef.current = false; }, 0);
      return;
    }

    if (!drag.canDrop) {
      setTimeout(() => { dragDidOccurRef.current = false; }, 0);
      return;
    }

    const sameRow = drag.currentRowIndex === drag.sourceRowIndex;
    const samePosition = drag.currentLeft === drag.originalLeft;

    if (sameRow && samePosition) {
      setTimeout(() => { dragDidOccurRef.current = false; }, 0);
      return;
    }

    const ehw = effectiveHourWidthRef.current;
    const d = dateRef.current;

    if (sameRow) {
      if (drag.payload.type === 'session') {
        const session = drag.payload.session;
        const result: MoveResizeResult = {
          clockInEntryId: session.clockIn?.id,
          clockOutEntryId: session.clockOut?.id,
          newClockInTimestamp: pixelToTimeStr(drag.currentLeft, ehw, d),
          newClockOutTimestamp: pixelToTimeStr(drag.currentLeft + drag.originalWidth, ehw, d),
          originalClockInTimestamp: session.clockIn!.timestamp,
          originalClockOutTimestamp: session.clockOut!.timestamp,
        };
        handleMoveResizeRef.current(result);
      } else {
        const job = drag.payload.job;
        handleJobMoveResizeRef.current({
          jobId: job.id,
          newPlannedTime: formatTimeFromPx(drag.currentLeft, ehw),
          newDurationMinutes: Math.max(1, Math.round((drag.originalWidth / ehw) * 60)),
          originalPlannedTime: job.plannedTime!,
          originalDurationMinutes: job.estimatedDurationMinutes!,
        });
      }
    } else {
      const targetMember = membersRef.current[drag.currentRowIndex];
      if (targetMember) {
        if (drag.payload.type === 'session') {
          handleCrossUserMoveRef.current(drag, targetMember);
        } else {
          handleCrossJobMoveRef.current(drag, targetMember);
        }
      }
    }

    setTimeout(() => { dragDidOccurRef.current = false; }, 0);
  }, [stableMoveHandler]); // stable

  const handleCrossUserMoveRef = useRef(
    async (_drag: ActiveBlockDrag, _targetMember: CalendarMember) => {}
  );
  handleCrossUserMoveRef.current = useCallback(
    async (drag: ActiveBlockDrag, targetMember: CalendarMember) => {
      if (drag.payload.type !== 'session') return;
      const session = drag.payload.session;
      if (!session.clockIn || !session.clockOut) return;

      const newClockIn = pixelToTimeStr(drag.currentLeft, effectiveHourWidth, date);
      const newClockOut = pixelToTimeStr(drag.currentLeft + drag.originalWidth, effectiveHourWidth, date);
      const origClockIn = session.clockIn.timestamp;
      const origClockOut = session.clockOut.timestamp;
      const origUserId = drag.sourceMemberId;
      const clockInId = session.clockIn.id;
      const clockOutId = session.clockOut.id;

      const targetName =
        targetMember.first_name || targetMember.last_name
          ? `${targetMember.first_name || ''} ${targetMember.last_name || ''}`.trim()
          : targetMember.email;

      onOperationStart?.();
      setOptimisticOverrides(prev => {
        const next = new Map(prev);
        next.set(clockInId, { timestamp: newClockIn, userId: targetMember.user_id });
        next.set(clockOutId, { timestamp: newClockOut, userId: targetMember.user_id });
        return next;
      });

      const undone = { current: false };

      setActiveBanner({
        id: ++bannerSeqRef.current,
        variant: 'success',
        message: `Zeiteintrag wurde zu ${targetName} verschoben.`,
        onUndo: async () => {
          undone.current = true;
          onOperationStart?.();
          setOptimisticOverrides(prev => {
            const next = new Map(prev);
            next.set(clockInId, { timestamp: origClockIn, userId: origUserId });
            next.set(clockOutId, { timestamp: origClockOut, userId: origUserId });
            return next;
          });
          await reassignEntries(clockInId, clockOutId, origUserId, origClockIn, origClockOut);
          silentRefresh();
        },
      });

      const result = await reassignEntries(clockInId, clockOutId, targetMember.user_id, newClockIn, newClockOut);

      if (undone.current) { silentRefresh(); return; }

      if (result.success) {
        silentRefresh();
      } else {
        setOptimisticOverrides(prev => {
          const next = new Map(prev);
          next.set(clockInId, { timestamp: origClockIn, userId: origUserId });
          next.set(clockOutId, { timestamp: origClockOut, userId: origUserId });
          return next;
        });
        silentRefresh();
        setActiveBanner({
          id: ++bannerSeqRef.current,
          variant: 'error',
          message: result.error === 'overlapping_session'
            ? `Überschneidung mit bestehendem Eintrag von ${targetName}.`
            : 'Zeiteintrag konnte nicht verschoben werden.',
        });
      }
    },
    [effectiveHourWidth, date, silentRefresh, onOperationStart]
  );

  const handleCrossJobMoveRef = useRef(
    async (_drag: ActiveBlockDrag, _targetMember: CalendarMember) => {}
  );
  handleCrossJobMoveRef.current = useCallback(
    async (drag: ActiveBlockDrag, targetMember: CalendarMember) => {
      if (drag.payload.type !== 'job') return;
      const job = drag.payload.job;

      const ehw = effectiveHourWidth;
      const newTime = formatTimeFromPx(drag.currentLeft, ehw);
      const newDuration = Math.max(1, Math.round((drag.originalWidth / ehw) * 60));
      const origTime = job.plannedTime!;
      const origDuration = job.estimatedDurationMinutes!;
      const origUserId = drag.sourceMemberId;

      const targetName =
        targetMember.first_name || targetMember.last_name
          ? `${targetMember.first_name || ''} ${targetMember.last_name || ''}`.trim()
          : targetMember.email;

      const newAssignedUserIds = job.assignedUserIds
        .filter((uid) => uid !== origUserId)
        .concat(targetMember.user_id);

      onOperationStart?.();
      setJobOverrides(prev => {
        const next = new Map(prev);
        next.set(job.id, {
          plannedTime: newTime,
          estimatedDurationMinutes: newDuration,
          assignedUserIds: newAssignedUserIds,
        });
        return next;
      });

      const undone = { current: false };

      setActiveBanner({
        id: ++bannerSeqRef.current,
        variant: 'success',
        message: `Auftrag wurde zu ${targetName} verschoben.`,
        onUndo: async () => {
          undone.current = true;
          onOperationStart?.();
          setJobOverrides(prev => {
            const next = new Map(prev);
            next.set(job.id, {
              plannedTime: origTime,
              estimatedDurationMinutes: origDuration,
              assignedUserIds: job.assignedUserIds,
            });
            return next;
          });
          await unassignEmployee(job.id, targetMember.user_id);
          await assignEmployee(job.id, origUserId);
          if (newTime !== origTime || newDuration !== origDuration) {
            await updateJob(job.id, {
              plannedTime: origTime,
              estimatedDurationMinutes: origDuration,
            });
          }
          silentRefresh();
        },
      });

      const unassignResult = await unassignEmployee(job.id, origUserId);
      if (undone.current) { silentRefresh(); return; }

      const assignResult = unassignResult.success
        ? await assignEmployee(job.id, targetMember.user_id)
        : { success: false, error: 'unassign_failed' };

      if (undone.current) { silentRefresh(); return; }

      const assignOk = unassignResult.success && assignResult.success;

      if (assignOk) {
        if (newTime !== origTime || newDuration !== origDuration) {
          await updateJob(job.id, {
            plannedTime: newTime,
            estimatedDurationMinutes: newDuration,
          });
        }
        silentRefresh();
      } else {
        setJobOverrides(prev => {
          const next = new Map(prev);
          next.set(job.id, {
            plannedTime: origTime,
            estimatedDurationMinutes: origDuration,
            assignedUserIds: job.assignedUserIds,
          });
          return next;
        });
        silentRefresh();
        setActiveBanner({
          id: ++bannerSeqRef.current,
          variant: 'error',
          message: `Auftrag konnte nicht zu ${targetName} verschoben werden.`,
        });
      }
    },
    [effectiveHourWidth, silentRefresh, onOperationStart]
  );

  const initiateCrossRowDrag = useCallback(
    (payload: DragBlockPayload, memberId: string, blockLeft: number, blockWidth: number, e: React.PointerEvent) => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const sourceRowIndex = membersRef.current.findIndex((m) => m.user_id === memberId);
      if (sourceRowIndex < 0) return;

      const pointerXInTimeline = e.clientX - containerRect.left + container.scrollLeft;
      const pointerOffsetX = pointerXInTimeline - blockLeft;

      dragDidOccurRef.current = false;
      dragThresholdMetRef.current = false;
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      dragPendingRef.current = {
        payload,
        memberId,
        left: blockLeft,
        width: blockWidth,
        sourceRowIndex,
        pointerOffsetX,
        pointerId: e.pointerId,
      };

      window.addEventListener('pointermove', stableMoveHandler);
      window.addEventListener('pointerup', stableUpHandler);
    },
    [stableMoveHandler, stableUpHandler]
  );

  const handleBlockMoveStart = useCallback(
    (session: WorkSession, memberId: string, blockLeft: number, blockWidth: number, e: React.PointerEvent) => {
      initiateCrossRowDrag({ type: 'session', session }, memberId, blockLeft, blockWidth, e);
    },
    [initiateCrossRowDrag]
  );

  const handleJobBlockMoveStart = useCallback(
    (job: CalendarJob, memberId: string, blockLeft: number, blockWidth: number, e: React.PointerEvent) => {
      initiateCrossRowDrag({ type: 'job', job }, memberId, blockLeft, blockWidth, e);
    },
    [initiateCrossRowDrag]
  );

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', stableMoveHandler);
      window.removeEventListener('pointerup', stableUpHandler);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [stableMoveHandler, stableUpHandler]);

  const memberNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.user_id] =
        m.first_name || m.last_name
          ? `${m.first_name || ''} ${m.last_name || ''}`.trim()
          : m.email;
    }
    return map;
  }, [members]);

  const { timedDayJobs, untimedDayJobs } = useMemo(() => {
    const dateStr = toLocalDateString(date);
    const forDay = effectiveJobs.filter((j) => j.plannedDate === dateStr);
    return {
      timedDayJobs: forDay.filter((j) => j.plannedTime && j.estimatedDurationMinutes),
      untimedDayJobs: forDay.filter((j) => !j.plannedTime || !j.estimatedDurationMinutes),
    };
  }, [effectiveJobs, date]);

  // ── Parkplatz / untimed-chip drag hover state (for showing shadow pills) ──
  interface ParkplatzDragHover {
    snappedLeft: number;
    width: number;
    hoveredMemberId: string;
  }
  const [parkplatzDragHover, setParkplatzDragHover] = useState<ParkplatzDragHover | null>(null);
  const parkplatzDragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks the locally-dragged untimed chip so the preview works without parkplatzDragJob
  const localChipDragJobRef = useRef<CalendarJob | null>(null);
  const [draggingChipId, setDraggingChipId] = useState<string | null>(null);
  const [chipDragCursor, setChipDragCursor] = useState<{ x: number; y: number } | null>(null);

  // Auto-clear draggingChipId when the job leaves the untimed list (e.g. after
  // a successful drop schedules it). onDragEnd may not fire because the chip
  // unmounts before the browser dispatches the event.
  useEffect(() => {
    if (draggingChipId && !untimedDayJobs.some((j) => j.id === draggingChipId)) {
      setDraggingChipId(null);
      localChipDragJobRef.current = null;
    }
  }, [draggingChipId, untimedDayJobs]);

  // Track cursor position during untimed chip drag for floating preview
  useEffect(() => {
    if (!draggingChipId) {
      setChipDragCursor(null);
      return;
    }
    const handler = (e: DragEvent) => {
      if (e.clientX === 0 && e.clientY === 0) return;
      setChipDragCursor({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('dragover', handler);
    return () => window.removeEventListener('dragover', handler);
  }, [draggingChipId]);

  const handleParkplatzDragOver = useCallback((memberId: string, cursorX: number) => {
    const dragJob = parkplatzDragJob ?? localChipDragJobRef.current;
    if (!dragJob) return;
    const durationMinutes = dragJob.estimatedDurationMinutes ?? 60;
    const width = (durationMinutes / 60) * effectiveHourWidth;
    const snappedLeft = Math.max(0, snapToGrid(cursorX, effectiveHourWidth));
    setParkplatzDragHover({ snappedLeft, width, hoveredMemberId: memberId });
    if (parkplatzDragTimeoutRef.current) clearTimeout(parkplatzDragTimeoutRef.current);
    parkplatzDragTimeoutRef.current = setTimeout(() => setParkplatzDragHover(null), 150);
  }, [parkplatzDragJob, effectiveHourWidth]);

  useEffect(() => {
    if (!parkplatzDragJob && !localChipDragJobRef.current) setParkplatzDragHover(null);
  }, [parkplatzDragJob]);

  const handleJobDragUpdate = useCallback((jobId: string, newLeft: number, newWidth: number, memberId?: string) => {
    setJobDragShadow((prev) =>
      prev?.jobId === jobId && prev.left === newLeft && prev.width === newWidth && prev.sourceMemberId === memberId
        ? prev
        : { jobId, left: newLeft, width: newWidth, sourceMemberId: memberId }
    );
  }, []);

  const handleJobDragEnd = useCallback(() => {
    setJobDragShadow(null);
  }, []);

  const handleJobClick = useCallback(
    (job: CalendarJob, position: { x: number; y: number }) => {
      setSelectedJob({ job, position });
    },
    []
  );

  const entriesByUser = useMemo(() => {
    const grouped: Record<string, TimeEntry[]> = {};
    for (const entry of effectiveEntries) {
      if (!grouped[entry.userId]) {
        grouped[entry.userId] = [];
      }
      grouped[entry.userId].push(entry);
    }
    return grouped;
  }, [effectiveEntries]);

  const sessionsByUser = useMemo(() => {
    const sessions: Record<
      string,
      ReturnType<typeof calculateWorkSessions>
    > = {};
    for (const [userId, userEntries] of Object.entries(entriesByUser)) {
      sessions[userId] = calculateWorkSessions(userEntries);
    }
    return sessions;
  }, [entriesByUser]);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* All-day jobs row (only untimed jobs — timed jobs appear as blocks on the timeline) */}
      {untimedDayJobs.length > 0 && (
        <div className="border-b bg-muted/20 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground mr-1">
              Aufträge:
            </span>
            {untimedDayJobs.map((job) => {
              const isChipDragging = draggingChipId === job.id;
              return (
              <button
                key={job.id}
                draggable
                onDragStart={(e) => {
                  const payload: DragJobPayload = {
                    jobId: job.id,
                    source: 'day',
                    sourceDate: toLocalDateString(date),
                    durationMinutes: job.estimatedDurationMinutes ?? 60,
                  };
                  e.dataTransfer.setData(PARKPLATZ_MIME, JSON.stringify(payload));
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setDragImage(getDragGhost(), 0, 0);
                  localChipDragJobRef.current = job;
                  setDraggingChipId(job.id);
                  document.body.classList.add('is-dragging');
                }}
                onDragEnd={() => {
                  localChipDragJobRef.current = null;
                  setDraggingChipId(null);
                  setParkplatzDragHover(null);
                  document.body.classList.remove('is-dragging');
                }}
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSelectedJob({
                    job,
                    position: { x: rect.right + 8, y: rect.top }
                  });
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border border-brand-purple/30 bg-brand-purple/10 px-2.5 py-1 text-xs font-medium transition-all cursor-grab active:cursor-grabbing',
                  isChipDragging
                    ? 'opacity-40 scale-[0.95] shadow-none'
                    : 'hover:bg-brand-purple/20'
                )}
              >
                <Briefcase className="h-3 w-3 text-brand-purple" />
                <span className="truncate max-w-[150px]">{job.title}</span>
                {job.jobNumber && (
                  <span className="text-muted-foreground text-[10px]">
                    {job.jobNumber}
                  </span>
                )}
              </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating preview for untimed chip drag (hidden when over timeline rows — purple block takes over) */}
      {draggingChipId && chipDragCursor && !parkplatzDragHover && (() => {
        const chipJob = localChipDragJobRef.current;
        if (!chipJob) return null;
        const container = scrollContainerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          if (chipDragCursor.x >= rect.left && chipDragCursor.x <= rect.right &&
              chipDragCursor.y >= rect.top && chipDragCursor.y <= rect.bottom) {
            return null;
          }
        }
        return (
          <div
            className="fixed pointer-events-none z-[9999]"
            style={{ left: chipDragCursor.x - 80, top: chipDragCursor.y - 16 }}
          >
            <div className="rounded-md border border-brand-purple/40 bg-brand-purple/10 px-2.5 py-1 shadow-lg opacity-90 inline-flex items-center gap-1.5">
              <Briefcase className="h-3 w-3 text-brand-purple shrink-0" />
              <span className="font-medium text-xs truncate max-w-[120px]">{chipJob.title}</span>
            </div>
          </div>
        );
      })()}

      <div className="flex flex-1 min-h-0">
        {/* Fixed employee names column */}
        <div className="w-48 shrink-0 border-r bg-background z-10">
          <div className="h-10 border-b bg-muted/30 px-3 flex items-center">
            <span className="text-sm font-medium text-muted-foreground">
              Mitarbeiter
            </span>
          </div>
          <div className="divide-y">
            {members.length === 0 ? (
              <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
                Keine Mitarbeiter
              </div>
            ) : (
              members.map((member) => {
                const sessions = sessionsByUser[member.user_id] || [];
                const userEntries = entriesByUser[member.user_id] || [];
                const isHighlighted = highlightMemberId === member.user_id;
                const activeDragJob = parkplatzDragJob ?? localChipDragJobRef.current;
                const showParkplatzShadow = !!(parkplatzDragHover && activeDragJob && (
                  member.user_id === parkplatzDragHover.hoveredMemberId ||
                  activeDragJob.assignedUserIds.includes(member.user_id)
                ));
                return (
                  <EmployeeTimelineRow
                    key={member.user_id}
                    member={member}
                    sessions={sessions}
                    entries={userEntries}
                    showNameOnly
                    isHighlighted={isHighlighted}
                    isParkplatzDragTarget={parkplatzDragHover?.hoveredMemberId === member.user_id}
                    parkplatzShadow={showParkplatzShadow ? { left: parkplatzDragHover!.snappedLeft, width: parkplatzDragHover!.width } : null}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Scrollable timeline area — zoom-aware pixel layout */}
        <div ref={scrollContainerRef} data-timeline-scroll="" className="flex-1 overflow-x-auto">
          <div className="relative" style={{ width: timelineWidth }}>
            {/* Timeline header */}
            <TimelineHeader
              date={date}
              effectiveHourWidth={effectiveHourWidth}
              timelineWidth={timelineWidth}
            />

            {/* Timeline rows */}
            <div className="divide-y">
              {members.map((member) => {
                const sessions = sessionsByUser[member.user_id] || [];
                const userEntries = entriesByUser[member.user_id] || [];
                const isHighlighted = highlightMemberId === member.user_id;
                const memberJobs = timedDayJobs.filter(
                  (j) =>
                    j.assignedUserIds.length === 0 ||
                    j.assignedUserIds.includes(member.user_id)
                );
                const activeDragJobForRow = parkplatzDragJob ?? localChipDragJobRef.current;
                const showParkplatzShadow = !!(parkplatzDragHover && activeDragJobForRow && (
                  member.user_id === parkplatzDragHover.hoveredMemberId ||
                  activeDragJobForRow.assignedUserIds.includes(member.user_id)
                ));
                return (
                  <EmployeeTimelineRow
                    key={member.user_id}
                    member={member}
                    sessions={sessions}
                    entries={userEntries}
                    date={date}
                    currentUserRole={currentUserRole}
                    currentUserId={currentUserId}
                    onRefresh={silentRefresh}
                    showTimelineOnly
                    changeRequestMap={changeRequestMap}
                    isHighlighted={isHighlighted}
                    effectiveHourWidth={effectiveHourWidth}
                    timelineWidth={timelineWidth}
                    onDragCreate={handleDragCreate}
                    onMoveResize={handleMoveResize}
                    onBlockMoveStart={handleBlockMoveStart}
                    activeDragSessionId={
                      activeDrag?.payload.type === 'session'
                        ? (activeDrag.payload.session.clockIn?.id ?? activeDrag.payload.session.clockOut?.id ?? null)
                        : null
                    }
                    dayViewDragDidOccurRef={dragDidOccurRef}
                    jobs={memberJobs}
                    onJobClick={handleJobClick}
                    onJobMoveResize={handleJobMoveResize}
                    onJobBlockMoveStart={handleJobBlockMoveStart}
                    activeDragJobId={
                      activeDrag?.payload.type === 'job'
                        ? activeDrag.payload.job.id
                        : null
                    }
                    onUnparkJob={onUnparkJob}
                    onScheduleJob={onScheduleJob}
                    parkplatzShadow={showParkplatzShadow ? { left: parkplatzDragHover!.snappedLeft, width: parkplatzDragHover!.width } : null}
                    isParkplatzDragTarget={parkplatzDragHover?.hoveredMemberId === member.user_id}
                    onParkplatzDragOver={handleParkplatzDragOver}
                    jobDragShadow={jobDragShadow}
                    onJobDragUpdate={handleJobDragUpdate}
                    onJobDragEnd={handleJobDragEnd}
                  />
                );
              })}
            </div>

            {/* Floating preview for Parkplatz / untimed chip → day view drag */}
            {parkplatzDragHover && (parkplatzDragJob || localChipDragJobRef.current) && (() => {
              const hovIdx = members.findIndex(m => m.user_id === parkplatzDragHover.hoveredMemberId);
              if (hovIdx < 0) return null;
              return (
                <>
                  {/* Solid purple block at hovered position */}
                  <div
                    className="absolute rounded-md text-xs font-medium pointer-events-none z-50 flex items-center justify-center overflow-hidden bg-brand-purple/70 text-white shadow-lg"
                    style={{
                      left: parkplatzDragHover.snappedLeft,
                      top: HEADER_HEIGHT + hovIdx * ROW_HEIGHT + 4,
                      width: parkplatzDragHover.width,
                      height: 56,
                      opacity: 0.9,
                    }}
                  >
                    <Briefcase className="h-3 w-3 shrink-0 opacity-80 mr-1" />
                    <span className="truncate">
                      {formatTimeFromPx(parkplatzDragHover.snappedLeft, effectiveHourWidth)}
                      {' - '}
                      {formatTimeFromPx(parkplatzDragHover.snappedLeft + parkplatzDragHover.width, effectiveHourWidth)}
                    </span>
                  </div>
                  {/* Row highlight for hovered row */}
                  <div
                    className="absolute left-0 right-0 pointer-events-none bg-brand-purple/5 ring-1 ring-inset ring-brand-purple/20"
                    style={{
                      top: HEADER_HEIGHT + hovIdx * ROW_HEIGHT,
                      height: ROW_HEIGHT,
                      width: timelineWidth,
                      zIndex: 4,
                    }}
                  />
                </>
              );
            })()}

            {/* Floating preview + ghost during cross-row drag */}
            {activeDrag && !activeDrag.isAboveGrid && (
              <>
                {/* Ghost at original position */}
                <div
                  className="absolute border-2 border-dashed border-muted-foreground/30 bg-muted/20 rounded-md pointer-events-none"
                  style={{
                    left: activeDrag.originalLeft,
                    top: HEADER_HEIGHT + activeDrag.sourceRowIndex * ROW_HEIGHT + 4,
                    width: activeDrag.originalWidth,
                    height: 56,
                    zIndex: 5,
                  }}
                />

                {/* Floating preview at target position */}
                <div
                  className={cn(
                    'absolute rounded-md text-xs font-medium pointer-events-none z-50',
                    'flex items-center justify-center overflow-hidden',
                    activeDrag.isOverParkplatz
                      ? 'bg-brand-purple/80 text-white shadow-lg'
                      : activeDrag.canDrop
                        ? activeDrag.payload.type === 'job'
                          ? 'bg-brand-purple/70 text-white shadow-lg'
                          : 'bg-green-500/70 text-white shadow-lg'
                        : 'bg-red-400/50 text-red-900 shadow-lg'
                  )}
                  style={{
                    left: activeDrag.currentLeft,
                    top: HEADER_HEIGHT + activeDrag.currentRowIndex * ROW_HEIGHT + 4,
                    width: activeDrag.originalWidth,
                    height: 56,
                    opacity: 0.9,
                    transition: 'top 0.08s ease-out',
                  }}
                >
                  {activeDrag.isOverParkplatz ? (
                    <>
                      <ParkingSquare className="h-3 w-3 shrink-0 opacity-80 mr-1" />
                      <span>Parkplatz</span>
                    </>
                  ) : (
                    <>
                      {activeDrag.payload.type === 'job' ? (
                        <Briefcase className="h-3 w-3 shrink-0 opacity-80 mr-1" />
                      ) : (
                        <Clock className="h-3 w-3 shrink-0 opacity-80 mr-1" />
                      )}
                      <span className="truncate">
                        {formatTimeFromPx(activeDrag.currentLeft, effectiveHourWidth)}
                        {' - '}
                        {formatTimeFromPx(activeDrag.currentLeft + activeDrag.originalWidth, effectiveHourWidth)}
                      </span>
                    </>
                  )}
                </div>

                {/* Row highlight for target */}
                {activeDrag.currentRowIndex !== activeDrag.sourceRowIndex && (
                  <div
                    className={cn(
                      'absolute left-0 right-0 pointer-events-none',
                      activeDrag.canDrop
                        ? 'bg-green-500/5 ring-1 ring-inset ring-green-500/20'
                        : 'bg-red-500/5 ring-1 ring-inset ring-red-500/20'
                    )}
                    style={{
                      top: HEADER_HEIGHT + activeDrag.currentRowIndex * ROW_HEIGHT,
                      height: ROW_HEIGHT,
                      width: timelineWidth,
                      zIndex: 4,
                    }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Free-floating preview when job block is dragged above the calendar grid */}
      {activeDrag && activeDrag.isAboveGrid && activeDrag.payload.type === 'job' && (
        <>
          {/* Ghost at original position (rendered in scroll container via portal-like absolute) */}
          <div
            className="fixed pointer-events-none z-[9999]"
            style={{
              left: (activeDrag.pointerClientX ?? 0) - Math.min(activeDrag.originalWidth, 180) / 2,
              top: (activeDrag.pointerClientY ?? 0) - 28,
            }}
          >
            <div
              className={cn(
                'rounded-md shadow-lg flex items-center justify-center px-3 text-xs font-medium gap-1',
                activeDrag.isOverParkplatz
                  ? 'bg-brand-purple/90 text-white'
                  : 'bg-muted border text-muted-foreground'
              )}
              style={{
                width: Math.min(activeDrag.originalWidth, 180),
                height: 44,
              }}
            >
              {activeDrag.isOverParkplatz ? (
                <>
                  <ParkingSquare className="h-3 w-3 shrink-0" />
                  <span>Parkplatz</span>
                </>
              ) : (
                <>
                  <Briefcase className="h-3 w-3 shrink-0" />
                  <span className="truncate">{activeDrag.payload.job.title}</span>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {selectedJob && (
        <JobEventPopover
          job={selectedJob.job}
          position={selectedJob.position}
          onClose={() => setSelectedJob(null)}
          memberNames={memberNameMap}
        />
      )}

      {/* Drag-to-create CalendarEntryDialog (controlled, two-tab) */}
      <CalendarEntryDialog
        open={dragCreateOpen}
        onOpenChange={setDragCreateOpen}
        preselectedUserId={dragCreateMemberId}
        preselectedDate={date}
        preselectedClockInTime={dragCreateClockIn}
        preselectedClockOutTime={dragCreateClockOut}
        lockEntryMode
        onManualEntrySuccess={onManualEntrySuccess}
        onJobSuccess={onJobSuccess}
      />

      <ActionBanner banner={activeBanner} onDismiss={() => setActiveBanner(null)} />
    </div>
  );
}
