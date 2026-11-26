import { describe, expect, test } from 'bun:test';

import { escalatesCallbackToAdmin, groupOwnerExceptions } from './owner-exceptions';
import type { AttentionTask } from './types';

function callback(sourceId: string, callbackDueAt: string): AttentionTask {
  return {
    sourceType: 'client_request_callback_overdue',
    sourceId,
    requestNumber: null,
    summary: 'Heizung fällt aus',
    urgency: 'normal',
    callbackDueAt,
    ownerName: 'Erika Musterfrau',
    ownerUnavailable: false,
    assignedToMe: false,
  };
}

function handover(sourceId: string, completedOn: string | null): AttentionTask {
  return {
    sourceType: 'work_handover_review',
    sourceId,
    targetType: 'job',
    targetLabel: 'A-1 · Heizung',
    targetHref: '/auftraege/A-1/uebergabe',
    packageState: 'missing',
    completedOn,
    stateVersion: 'job:1:0',
  };
}

function blocker(sourceId: string, nextReviewDate: string): AttentionTask {
  return {
    sourceType: 'work_blocker_review',
    sourceId,
    targetLabel: 'A-2 · Bad',
    targetHref: '/auftraege/A-2',
    blockerKind: 'blocker',
    nextReviewDate,
    responsibleName: 'Max Mustermann',
    stateVersion: 'review:1',
  };
}

/** The ids of the exceptions on a Berlin day, section by section. */
function exceptionIds(tasks: AttentionTask[], businessDate: string) {
  return groupOwnerExceptions(tasks, businessDate).map((section) => [
    section.key,
    section.tasks.map((task) => task.sourceId),
  ]);
}

describe('the exceptions on the owner start', () => {
  // [Berlin today, Berlin due day of the callback or completion of the handover, an exception]
  const workdayCases: Array<[today: string, since: string, exception: boolean, why: string]> = [
    ['2026-11-19', '2026-11-16', true, 'Monday to Thursday: three workdays'],
    ['2026-11-19', '2026-11-17', false, 'Tuesday to Thursday: two workdays'],
    ['2026-11-24', '2026-11-19', true, 'Thursday to Tuesday over a weekend: three workdays'],
    ['2026-11-24', '2026-11-20', false, 'Friday to Tuesday over a weekend: two workdays'],
    ['2026-12-03', '2026-11-30', true, 'over a month end: three workdays'],
    ['2028-03-02', '2028-02-28', true, 'through a leap day: three workdays'],
    ['2028-03-02', '2028-02-29', false, 'from a leap day: two workdays'],
    ['2026-11-19', '2026-11-20', false, 'a date after today'],
  ];

  test('an overdue callback is an exception once it is overdue more than two workdays', () => {
    for (const [today, dueDay, exception, why] of workdayCases) {
      const tasks = [callback('request', `${dueDay}T09:00:00.000Z`)];
      expect(exceptionIds(tasks, today), why).toEqual(exception ? [['callback', ['request']]] : []);
    }
  });

  test('an overdue callback counts by the Berlin day of its deadline', () => {
    // 23:30 UTC on Monday is 00:30 on Tuesday in Berlin: two workdays on Thursday.
    expect(exceptionIds([callback('request', '2026-11-16T23:30:00.000Z')], '2026-11-19')).toEqual([]);
  });

  test('an Übergabe is an exception once it waited more than two workdays after the execution completed', () => {
    for (const [today, completedOn, exception, why] of workdayCases) {
      expect(exceptionIds([handover('job', completedOn)], today), why).toEqual(
        exception ? [['handover', ['job']]] : [],
      );
    }
  });

  test('an Übergabe with an unknown completion day never becomes an exception by age', () => {
    expect(exceptionIds([handover('project', null)], '2026-11-19')).toEqual([]);
  });

  test('a blocker is an exception once its review date has passed', () => {
    const tasks = [blocker('yesterday', '2026-11-18'), blocker('today', '2026-11-19')];
    expect(exceptionIds(tasks, '2026-11-19')).toEqual([['parkingReview', ['yesterday']]]);
  });

  test('due maintenance is an exception once it is überfällig, never while it is only due within the lead time', () => {
    const maintenance = (sourceId: string, dueDate: string, overdue: boolean): AttentionTask => ({
      sourceType: 'maintenance_due',
      sourceId,
      equipmentLabel: 'Gasbrennwertkessel',
      siteName: 'Heizzentrale Lindenhof',
      dueDate,
      overdue,
      href: '/service/wartung?q=WPL-1',
    });
    const tasks = [maintenance('overdue', '2026-11-18', true), maintenance('today', '2026-11-19', false)];
    expect(exceptionIds(tasks, '2026-11-19')).toEqual([['dueMaintenance', ['overdue']]]);
  });

  test('time corrections, vacation requests and open dispatch questions are exceptions; session approvals and other tasks are not', () => {
    const tasks: AttentionTask[] = [
      {
        sourceType: 'time_session_approval',
        sourceId: 'session',
        personName: 'Max Mustermann',
        date: '2026-11-18',
        jobTitle: null,
        openSinceDays: 1,
      },
      {
        sourceType: 'time_correction_approval',
        sourceId: 'correction',
        personName: 'Max Mustermann',
        correctionLabel: 'Vergessene Stempelung',
        stateVersion: '1',
        openSinceDays: 0,
      },
      {
        sourceType: 'time_change_request_approval',
        sourceId: 'change',
        personName: 'Max Mustermann',
        requestType: 'edit',
        openSinceDays: 0,
      },
      {
        sourceType: 'vacation_request_approval',
        sourceId: 'vacation',
        personName: 'Max Mustermann',
        startDate: '2026-12-21',
        endDate: '2026-12-23',
        dayPortion: 'full',
        totalDays: 3,
        openSinceDays: 0,
      },
      {
        sourceType: 'dispatch_challenge_open',
        sourceId: 'challenge',
        personName: 'Max Mustermann',
        reason: 'Material fehlt',
        jobTitle: 'Heizung',
        acknowledgementId: 'ack',
        stateVersion: '1',
      },
      {
        sourceType: 'job_past_last_visit',
        sourceId: 'overdue-job',
        jobLabel: 'A-3 · Heizung',
        jobHref: '/auftraege/A-3',
        lastVisitDate: '2026-11-01',
      },
      {
        sourceType: 'organization_join_request',
        sourceId: 'join',
        personName: 'Erika Musterfrau',
        email: null,
      },
    ];
    expect(exceptionIds(tasks, '2026-11-19')).toEqual([
      ['time', ['change', 'correction']],
      ['vacation', ['vacation']],
      ['dispatchChallenge', ['challenge']],
    ]);
  });

  test('the exceptions keep the order of the Aufgaben sections', () => {
    const tasks = [
      handover('job', '2026-11-02'),
      blocker('blocker', '2026-11-02'),
      callback('request', '2026-11-02T09:00:00.000Z'),
    ];
    expect(exceptionIds(tasks, '2026-11-19').map(([key]) => key)).toEqual([
      'callback',
      'parkingReview',
      'handover',
    ]);
  });
});

describe("an overdue callback reaches Admin past the owner's threshold", () => {
  test('Admin gets it after more than two workdays, Büro and employees never through this rule', () => {
    const threeWorkdays = '2026-11-16T09:00:00.000Z';
    const twoWorkdays = '2026-11-17T09:00:00.000Z';
    expect(escalatesCallbackToAdmin('admin', threeWorkdays, '2026-11-19')).toBe(true);
    expect(escalatesCallbackToAdmin('admin', twoWorkdays, '2026-11-19')).toBe(false);
    expect(escalatesCallbackToAdmin('buero', threeWorkdays, '2026-11-19')).toBe(false);
    expect(escalatesCallbackToAdmin('employee', threeWorkdays, '2026-11-19')).toBe(false);
  });
});
