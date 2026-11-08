import { describe, expect, test } from 'bun:test';

import { formatOpenSince, groupAttentionTasks } from './task-sections';
import type { AttentionTask } from './types';

const href = '/auftraege/A-1';

/** One task of every kind, in the order the derivations used to emit them. */
const TASK_OF_EVERY_KIND: AttentionTask[] = [
  {
    sourceType: 'work_handover_review',
    sourceId: 'handover-1',
    targetType: 'job',
    targetLabel: 'A-1 · Bad',
    targetHref: href,
    packageState: 'missing',
    stateVersion: 'job:1:0',
  },
  { sourceType: 'organization_join_request', sourceId: 'join-1', personName: 'Jo Neu', email: null },
  {
    sourceType: 'dispatch_acknowledgement',
    sourceId: 'dispatch-1',
    jobId: 'job-1',
    jobNumber: 'A-1',
    jobTitle: 'Bad',
    revisionNumber: 1,
    startAt: null,
    startDate: '2026-11-09',
    stateVersion: 'rev-1',
  },
  {
    sourceType: 'dispatch_challenge_open',
    sourceId: 'challenge-1',
    personName: 'Max Muster',
    reason: 'Termin passt nicht',
    jobTitle: 'Bad',
    acknowledgementId: 'ack-1',
    stateVersion: 'ack-1',
  },
  {
    sourceType: 'work_blocker_review',
    sourceId: 'blocker-1',
    targetLabel: 'A-1 · Bad',
    targetHref: href,
    blockerKind: 'parking',
    nextReviewDate: '2026-11-07',
    responsibleName: null,
    stateVersion: 'blocker:1',
  },
  {
    sourceType: 'work_artifact_correction',
    sourceId: 'artifact-2',
    artifactTitle: 'Aufmaß',
    artifactKind: 'measurement',
    revisionNumber: 2,
    targetLabel: 'A-1 · Bad',
    targetHref: href,
    stateVersion: 'correction:1',
  },
  {
    sourceType: 'work_artifact_review',
    sourceId: 'artifact-1',
    artifactTitle: 'Bautagebuch',
    artifactKind: 'site_diary',
    revisionNumber: 1,
    targetLabel: 'A-1 · Bad',
    targetHref: href,
    stateVersion: 'review:1',
  },
  {
    sourceType: 'work_defect_due',
    sourceId: 'artifact-3',
    artifactTitle: 'Mangel',
    targetLabel: 'A-1 · Bad',
    targetHref: href,
    dueDate: '2026-11-07',
    severity: 'low',
    stateVersion: 'defect:1',
  },
  {
    sourceType: 'client_follow_up',
    sourceId: 'follow-up-1',
    clientId: 'client-1',
    clientName: 'Kunde',
    title: 'Angebot nachfassen',
    dueAt: '2026-11-07T09:00:00.000Z',
    ownerName: 'Bea Büro',
    ownerUnavailable: false,
  },
  {
    sourceType: 'client_request_open',
    sourceId: 'request-1',
    requestNumber: 'AN-1',
    summary: 'Heizung fällt aus',
    status: 'offen',
    urgency: 'normal',
    receivedAt: '2026-10-01T08:00:00.000Z',
    openSinceDays: 37,
    assigneeName: null,
    assignedToMe: false,
  },
  {
    sourceType: 'vacation_request_approval',
    sourceId: 'vacation-1',
    personName: 'Max Muster',
    startDate: '2026-11-02',
    endDate: '2026-11-03',
    dayPortion: 'full',
    totalDays: 2,
    openSinceDays: 12,
  },
  {
    sourceType: 'time_correction_approval',
    sourceId: 'correction-1',
    personName: 'Max Muster',
    correctionLabel: 'Vergessene Stempelung',
    stateVersion: '1',
    openSinceDays: 3,
  },
  {
    sourceType: 'time_change_request_approval',
    sourceId: 'change-1',
    personName: 'Max Muster',
    requestType: 'edit',
    openSinceDays: 2,
  },
  {
    sourceType: 'time_session_approval',
    sourceId: 'session-1',
    personName: 'Max Muster',
    date: '2026-09-26',
    jobTitle: null,
    openSinceDays: 42,
  },
];

describe('groupAttentionTasks', () => {
  test('time-bound decisions lead: time approvals, vacation requests and open Anfragen come first, handovers last', () => {
    expect(groupAttentionTasks(TASK_OF_EVERY_KIND).map((section) => section.key)).toEqual([
      'time',
      'vacation',
      'request',
      'joinRequest',
      'dispatchAcknowledgement',
      'dispatchChallenge',
      'parkingReview',
      'followUp',
      'dueDefect',
      'artifact',
      'handover',
    ]);
  });

  test('every task lands in exactly one section, and a section keeps its kinds in order', () => {
    const sections = groupAttentionTasks(TASK_OF_EVERY_KIND);
    expect(sections.flatMap((section) => section.tasks)).toHaveLength(TASK_OF_EVERY_KIND.length);
    const sourceIdsOf = (key: string) =>
      sections.find((section) => section.key === key)?.tasks.map((task) => task.sourceId);
    expect(sourceIdsOf('time')).toEqual(['session-1', 'change-1', 'correction-1']);
    expect(sourceIdsOf('artifact')).toEqual(['artifact-1', 'artifact-2']);
  });

  test('a section without tasks is left out', () => {
    expect(groupAttentionTasks([])).toEqual([]);
  });
});

describe('formatOpenSince', () => {
  test('an approval or Anfrage says how long it has waited', () => {
    expect(formatOpenSince(0)).toBe('heute eingegangen');
    expect(formatOpenSince(1)).toBe('offen seit 1 Tag');
    expect(formatOpenSince(42)).toBe('offen seit 42 Tagen');
  });
});
