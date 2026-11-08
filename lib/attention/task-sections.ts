// The order of the Aufgaben sections and the age hint of a waiting task. Pure;
// the Aufgaben page renders what this decides. Unit-tested in task-sections.test.ts.

import type { AttentionTask } from './types';

/**
 * The Aufgaben sections, most urgent first. Time-bound decisions lead: time
 * approvals (MiLoG timeliness), vacation requests and open Anfragen. The
 * handover backlog comes last, because it waits without a deadline.
 */
const ATTENTION_TASK_SECTION_ORDER = [
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
] as const;

export type AttentionTaskSectionKey = (typeof ATTENTION_TASK_SECTION_ORDER)[number];

// Every task kind has exactly one section; a new kind without one fails to compile.
// Within a section, the kinds keep this order.
const SECTION_OF_TASK_KIND = {
  time_session_approval: 'time',
  time_change_request_approval: 'time',
  time_correction_approval: 'time',
  vacation_request_approval: 'vacation',
  client_request_open: 'request',
  organization_join_request: 'joinRequest',
  dispatch_acknowledgement: 'dispatchAcknowledgement',
  dispatch_challenge_open: 'dispatchChallenge',
  work_blocker_review: 'parkingReview',
  client_follow_up: 'followUp',
  work_defect_due: 'dueDefect',
  work_artifact_review: 'artifact',
  work_artifact_correction: 'artifact',
  work_handover_review: 'handover',
} as const satisfies Record<AttentionTask['sourceType'], AttentionTaskSectionKey>;

export type AttentionTaskSection = { key: AttentionTaskSectionKey; tasks: AttentionTask[] };

/** The non-empty sections in urgency order; each keeps the order of its tasks. */
export function groupAttentionTasks(tasks: readonly AttentionTask[]): AttentionTaskSection[] {
  const kinds = Object.entries(SECTION_OF_TASK_KIND);
  return ATTENTION_TASK_SECTION_ORDER.flatMap((key) => {
    const sectionTasks = kinds
      .filter(([, section]) => section === key)
      .flatMap(([kind]) => tasks.filter((task) => task.sourceType === kind));
    return sectionTasks.length > 0 ? [{ key, tasks: sectionTasks }] : [];
  });
}

/** How long an approval or an Anfrage has waited, in Berlin calendar days. */
export function formatOpenSince(days: number): string {
  if (days <= 0) return 'heute eingegangen';
  if (days === 1) return 'offen seit 1 Tag';
  return `offen seit ${days} Tagen`;
}
