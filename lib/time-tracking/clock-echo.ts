import { liveMinutes } from './helpers';
import type { LiveClockState, TimeActivitySelection, TimeTransitionResult } from './types';

/** What an accepted transition says about the clock, as far as the echo needs it. */
export type ClockEchoResult = Pick<
  Extract<TimeTransitionResult, { success: true }>,
  'outcome' | 'sessionId' | 'segmentId' | 'version' | 'recoveryReason'
>;

/**
 * Optimistic echo of a successful transition (feedback canon: the user's own
 * clock action reflects in the first frame after the server answers, not
 * after the follow-up read). The result carries ids and the outcome, not a
 * full state, so the echo flips the activity, closes the running segment
 * into today's totals with the same arithmetic the dashboard uses for its
 * live counters, and leaves everything it cannot know (a newly chosen job's
 * title) empty until the refresh reconciles. `at` is when the transition
 * happened: now for an online one, the captured time for one a phone kept
 * without signal (lib/field-sync/device/time-outbox.ts).
 */
export function applyTransitionEcho(
  previous: LiveClockState,
  selection: TimeActivitySelection | null,
  result: ClockEchoResult,
  at: Date = new Date(),
): LiveClockState {
  if (result.outcome !== 'active' && result.outcome !== 'ended') return previous;
  const now = at.toISOString();
  const elapsedMinutes = liveMinutes(0, previous.isClockedIn ? previous.statusStartedAt : null, at.getTime());
  const wasBreak = previous.status === 'on_break';
  const previousKind = previous.currentActivity?.kind;
  const countIf = (kind: typeof previousKind) => (previousKind === kind ? elapsedMinutes : 0);
  const closed: LiveClockState = {
    ...previous,
    todayMinutes: previous.todayMinutes + elapsedMinutes,
    workMinutes: previous.workMinutes + (wasBreak ? 0 : elapsedMinutes),
    breakMinutes: previous.breakMinutes + (wasBreak ? elapsedMinutes : 0),
    travelMinutes: previous.travelMinutes + countIf('travel'),
    standbyMinutes: previous.standbyMinutes + countIf('standby'),
    calloutMinutes: previous.calloutMinutes + countIf('callout'),
    internalMinutes: previous.internalMinutes + countIf('internal_activity'),
    timelineSegments:
      elapsedMinutes > 0
        ? [...previous.timelineSegments, { type: wasBreak ? 'break' : 'work', minutes: elapsedMinutes }]
        : previous.timelineSegments,
    sessionId: result.sessionId,
    sessionVersion: result.version,
    currentSegmentId: result.segmentId,
    recoveryReason: result.recoveryReason,
    legacyOpen: false,
    fetchedAt: now,
  };
  if (result.outcome === 'ended') {
    return {
      ...closed,
      status: 'clocked_out',
      isClockedIn: false,
      isOnBreak: false,
      clockInTime: null,
      statusStartedAt: null,
      breakStartTime: null,
      currentActivity: null,
      resumeActivity: null,
      resumeJobInfo: null,
      activeJobId: null,
      activeJobInfo: null,
    };
  }
  const isBreak = selection?.kind === 'break';
  const jobId = selection?.allocationKind === 'job' ? selection.jobId : null;
  const knownJobs = [previous.activeJobInfo, previous.resumeJobInfo];
  const activeJobInfo = knownJobs.find((job) => job !== null && job.id === jobId) ?? null;
  return {
    ...closed,
    status: isBreak ? 'on_break' : 'working',
    isClockedIn: true,
    isOnBreak: isBreak,
    clockInTime: previous.clockInTime ?? now,
    statusStartedAt: now,
    breakStartTime: isBreak ? now : null,
    currentActivity: selection,
    // A break keeps what it interrupted; any other activity becomes the
    // thing to resume after the next break.
    resumeActivity: isBreak ? previous.resumeActivity : selection,
    resumeJobInfo: isBreak ? previous.resumeJobInfo : activeJobInfo,
    activeJobId: jobId,
    activeJobInfo,
  };
}
