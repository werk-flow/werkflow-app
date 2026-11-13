'use client';

import type { LiveClockState } from '@/lib/time-tracking/types';
import type { StoredClockFacts } from './stored-clock';

// The writing half of the stored clock (stored-clock.ts), without Zod: the
// page that keeps a clock action without signal carries it (unsent-mark.ts).

/** The version of the stored formats this code writes. */
export const STORED_RECORD_VERSION = 1;

/** The live clock as a phone stores it, field by field: a new live field is never stored by accident. */
export function storedClockFacts(live: LiveClockState): StoredClockFacts {
  return {
    organizationId: live.organizationId,
    breakPolicy: {
      breakMode: live.breakPolicy.breakMode,
      autoBreakThresholdMinutes: live.breakPolicy.autoBreakThresholdMinutes,
      autoBreakDurationMinutes: live.breakPolicy.autoBreakDurationMinutes,
      secondStep: live.breakPolicy.secondStep
        ? {
            thresholdMinutes: live.breakPolicy.secondStep.thresholdMinutes,
            durationMinutes: live.breakPolicy.secondStep.durationMinutes,
          }
        : null,
    },
    status: live.status,
    isClockedIn: live.isClockedIn,
    isOnBreak: live.isOnBreak,
    clockInTime: live.clockInTime,
    statusStartedAt: live.statusStartedAt,
    breakStartTime: live.breakStartTime,
    todayMinutes: live.todayMinutes,
    workMinutes: live.workMinutes,
    breakMinutes: live.breakMinutes,
    standbyMinutes: live.standbyMinutes,
    travelMinutes: live.travelMinutes,
    calloutMinutes: live.calloutMinutes,
    internalMinutes: live.internalMinutes,
    timelineSegments: live.timelineSegments.map(({ type, minutes }) => ({ type, minutes })),
    activeJobId: live.activeJobId,
    captureModel: live.captureModel,
    sessionId: live.sessionId,
    sessionVersion: live.sessionVersion,
    currentSegmentId: live.currentSegmentId,
    currentActivity: live.currentActivity,
    resumeActivity: live.resumeActivity,
    recoveryReason: live.recoveryReason,
    legacyOpen: live.legacyOpen,
    fetchedAt: live.fetchedAt,
  };
}
