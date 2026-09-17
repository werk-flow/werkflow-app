import { describe, expect, test } from 'bun:test';

import {
  deriveClockActions,
  isSameActivitySelection,
  selectClockHotKeys,
  selectionForPickedJob,
} from './clock-actions';
import { createActivitySelection } from './segments';
import type { ClockJobInfo, LiveClockState, TimeActivitySelection } from './types';

const job: ClockJobInfo = {
  id: 'job-1',
  title: 'Heizungswartung Müller',
  jobNumber: 'A-1',
  status: 'in_bearbeitung',
  projectName: null,
  clientName: null,
};

function state(overrides: Partial<LiveClockState>): LiveClockState {
  return {
    organizationId: 'org',
    breakMode: 'manual',
    autoBreakThresholdMinutes: 360,
    autoBreakDurationMinutes: 30,
    status: 'working',
    isClockedIn: true,
    isOnBreak: false,
    clockInTime: '2026-09-15T06:00:00.000Z',
    statusStartedAt: '2026-09-15T06:00:00.000Z',
    breakStartTime: null,
    todayMinutes: 0,
    workMinutes: 0,
    breakMinutes: 0,
    timelineSegments: [],
    activeJobId: 'job-1',
    activeJobInfo: job,
    captureModel: 'canonical',
    sessionId: 'session',
    sessionVersion: 1,
    currentSegmentId: 'segment',
    currentActivity: createActivitySelection('work', 'job-1'),
    resumeActivity: createActivitySelection('work', 'job-1'),
    resumeJobInfo: job,
    recoveryReason: null,
    legacyOpen: false,
    standbyMinutes: 0,
    travelMinutes: 0,
    calloutMinutes: 0,
    internalMinutes: 0,
    fetchedAt: '2026-09-15T06:30:00.000Z',
    ...overrides,
  };
}

describe('clock actions per state', () => {
  test('clocked out offers a plain start, a job start and a drive', () => {
    expect(deriveClockActions(null).map((action) => action.label)).toEqual([
      'Arbeit starten',
      'Arbeit an Auftrag …',
      'Fahrt starten',
      'Weitere Aktivitäten …',
    ]);
  });

  test('working on a job offers the break first and the drive keeps the job', () => {
    const actions = deriveClockActions(state({}));
    expect(actions.map((action) => action.label)).toEqual([
      'Pause',
      'Fahrt starten',
      'Auftrag wechseln …',
      'Erfassung beenden',
      'Weitere Aktivitäten …',
    ]);
    const travel = actions[1];
    expect(travel?.kind === 'transition' ? travel.selection : null).toEqual(
      createActivitySelection('travel', 'job-1')
    );
    expect(selectClockHotKeys(actions).map((action) => action.label)).toEqual(['Pause', 'Fahrt starten']);
  });

  test('hides the break under the automatic rule and asks to assign a job when unallocated', () => {
    const actions = deriveClockActions(
      state({ breakMode: 'automatic', activeJobId: null, activeJobInfo: null, currentActivity: createActivitySelection('work') })
    );
    expect(actions.map((action) => action.label)).toEqual([
      'Fahrt starten',
      'Auftrag zuordnen …',
      'Erfassung beenden',
      'Weitere Aktivitäten …',
    ]);
  });

  test('a break resumes what it interrupted, with the job by name', () => {
    const actions = deriveClockActions(
      state({
        status: 'on_break',
        isOnBreak: true,
        activeJobId: null,
        activeJobInfo: null,
        currentActivity: createActivitySelection('break'),
      })
    );
    expect(actions.map((action) => action.label)).toEqual([
      'Weiter: Arbeit · Heizungswartung Müller',
      'Weiter ohne Auftrag',
      'Anderer Auftrag …',
      'Erfassung beenden',
      'Weitere Aktivitäten …',
    ]);
    const resume = actions[0];
    expect(resume?.kind === 'transition' ? resume.selection : null).toEqual(
      createActivitySelection('work', 'job-1')
    );
    expect(selectClockHotKeys(actions).map((action) => action.id)).toEqual(['resume', 'resume-unallocated']);
  });

  test('a break without a remembered job offers one plain resume', () => {
    const labels = deriveClockActions(
      state({
        status: 'on_break',
        isOnBreak: true,
        activeJobId: null,
        activeJobInfo: null,
        currentActivity: createActivitySelection('break'),
        resumeActivity: null,
        resumeJobInfo: null,
      })
    ).map((action) => action.label);
    expect(labels).toEqual(['Weiter: Arbeit', 'Anderer Auftrag …', 'Erfassung beenden', 'Weitere Aktivitäten …']);
  });

  test('a drive arrives at its job in one action', () => {
    const actions = deriveClockActions(
      state({ currentActivity: createActivitySelection('travel', 'job-1'), resumeActivity: createActivitySelection('travel', 'job-1') })
    );
    expect(actions.map((action) => action.label)).toEqual([
      'Arbeit an Heizungswartung Müller',
      'Arbeit an anderem Auftrag …',
      'Pause',
      'Erfassung beenden',
      'Weitere Aktivitäten …',
    ]);
    expect(selectClockHotKeys(actions).map((action) => action.id)).toEqual(['arrive', 'arrive-other-job']);
  });

  test('an unchanged selection is recognized, a changed qualifier or job is not', () => {
    const travel = createActivitySelection('travel', 'job-1');
    const driven: TimeActivitySelection = { kind: 'travel', allocationKind: 'job', jobId: 'job-1', travelRoute: 'unspecified', travelRole: 'driver' };
    expect(isSameActivitySelection(travel, createActivitySelection('travel', 'job-1'))).toBe(true);
    expect(isSameActivitySelection(travel, driven)).toBe(false);
    expect(isSameActivitySelection(createActivitySelection('work', 'job-1'), createActivitySelection('work', 'job-2'))).toBe(false);
    expect(isSameActivitySelection(createActivitySelection('work'), createActivitySelection('work'))).toBe(true);
    expect(isSameActivitySelection(createActivitySelection('break'), null)).toBe(false);
  });

  test('a picked job continues a running drive but otherwise starts work', () => {
    expect(selectionForPickedJob(state({ currentActivity: createActivitySelection('travel', 'job-1') }), 'job-2')).toEqual(
      createActivitySelection('travel', 'job-2')
    );
    expect(selectionForPickedJob(state({ currentActivity: createActivitySelection('break') }), 'job-2')).toEqual(
      createActivitySelection('work', 'job-2')
    );
    expect(selectionForPickedJob(null, null)).toEqual(createActivitySelection('work'));
  });
});
