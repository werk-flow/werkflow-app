import { describe, expect, test } from 'bun:test';
import { describeClockActivity, workTimeParts, todayWorkingTime } from './clock-day-summary';
import { createActivitySelection } from './segments';

const none = { travel: 0, standby: 0, callout: 0, internal_activity: 0 };

describe('the running activity in words', () => {
  test('a drive reads as on the road, never as working', () => {
    const status = describeClockActivity({
      isClockedIn: true,
      status: 'working',
      currentActivity: createActivitySelection('travel', 'job-1'),
    });
    expect(status.sentence).toBe('Du bist gerade unterwegs.');
    expect(status.badge).toBe('unterwegs');
  });

  test('work, a break and a stopped clock keep their own sentence', () => {
    const working = { isClockedIn: true, status: 'working' as const };
    expect(
      describeClockActivity({ ...working, currentActivity: createActivitySelection('work', null) }).sentence,
    ).toBe('Du arbeitest gerade.');
    expect(
      describeClockActivity({
        ...working,
        status: 'on_break',
        currentActivity: createActivitySelection('break'),
      }).sentence,
    ).toBe('Du machst gerade Pause.');
    expect(
      describeClockActivity({ isClockedIn: false, status: 'clocked_out', currentActivity: null }).sentence,
    ).toBe('Du bist nicht eingestempelt.');
  });

  test('a legacy stream without an activity reads as its status', () => {
    expect(
      describeClockActivity({ isClockedIn: true, status: 'on_break', currentActivity: null }).badge,
    ).toBe('Pause');
    expect(describeClockActivity({ isClockedIn: true, status: 'working', currentActivity: null }).badge).toBe(
      'arbeitet',
    );
  });
});

describe('the parts of today’s working time', () => {
  test('work and travel add up to the working time', () => {
    const parts = workTimeParts(3, { ...none, travel: 1 });
    expect(parts).toEqual([
      { kind: 'work', label: 'Arbeit', minutes: 2 },
      { kind: 'travel', label: 'Fahrt', minutes: 1 },
    ]);
    expect(parts.reduce((total, part) => total + part.minutes, 0)).toBe(3);
  });

  test('rounded parts add up to the rounded total', () => {
    const sum = (parts: ReturnType<typeof workTimeParts>) =>
      parts.reduce((total, part) => total + part.minutes, 0);
    expect(sum(workTimeParts(10.4, { ...none, travel: 2.4, standby: 3.4 }))).toBe(10);
    expect(sum(workTimeParts(1.2, { ...none, travel: 0.6, standby: 0.6 }))).toBe(1);
  });

  test('an automatic break longer than the work comes out of the other parts', () => {
    // 400 minutes of travel, 30 of them deducted as the automatic break.
    const parts = workTimeParts(370, { ...none, travel: 400 });
    expect(parts).toEqual([
      { kind: 'work', label: 'Arbeit', minutes: 0 },
      { kind: 'travel', label: 'Fahrt', minutes: 370 },
    ]);
  });

  test('a day past its target keeps every recorded minute of travel in the parts', () => {
    // 480 minutes of target plus 120 of overtime: the parts describe all 600.
    const today = todayWorkingTime({ workMinutes: 480, overtimeMinutes: 120 }, { ...none, travel: 400 });
    expect(today.workingMinutes).toBe(600);
    expect(today.parts).toEqual([
      { kind: 'work', label: 'Arbeit', minutes: 200 },
      { kind: 'travel', label: 'Fahrt', minutes: 400 },
    ]);
  });

  test('a day of work only shows no parts', () => {
    expect(workTimeParts(240, none)).toEqual([]);
  });
});
