import type { updatePlanningCalendarEntry as ServerUpdatePlanning } from '@/lib/planning/actions';
import type { updateJob as ServerUpdateJob } from '@/lib/jobs/actions';
import { unexpectedWrite } from './held-write-boundary';
import { reviewTimeCorrectionContract } from './time-approval-boundaries';

/**
 * The write boundary of the calendar views' contracts (P1-24a): every
 * mutation the optimistic owner can issue is held here until the test
 * completes it, so the contract proves optimism, rollback, Undo and the
 * release of refresh ownership against the real components.
 */
type Result = { success: true } | { success: false; error: string };
type HeldCall = { kind: 'planning' | 'job' | 'park' | 'unpark' | 'entries'; id: string; input: unknown };
const held: Array<{ resolve: (result: Result) => void; reject: (error: Error) => void }> = [];
declare global {
  interface Window {
    calendarWriteContract: {
      calls: HeldCall[];
      complete: (index: number, outcome: 'success' | 'failure' | 'reject', error?: string) => void;
    };
  }
}
window.calendarWriteContract = {
  calls: [],
  complete(index, outcome, error = 'update_failed') {
    const call = held[index];
    if (!call) throw new Error(`No held calendar write ${index}`);
    if (outcome === 'reject') call.reject(new Error('controlled transport failure'));
    else call.resolve(outcome === 'success' ? { success: true } : { success: false, error });
  },
};
function hold(call: HeldCall): Promise<Result> {
  window.calendarWriteContract.calls.push(call);
  return new Promise((resolve, reject) => held.push({ resolve, reject }));
}

export function updatePlanningCalendarEntry(
  occurrenceId: string,
  input: Parameters<typeof ServerUpdatePlanning>[1],
): Promise<Result> {
  return hold({ kind: 'planning', id: occurrenceId, input });
}
export function updateJob(jobId: string, input: Parameters<typeof ServerUpdateJob>[1]): Promise<Result> {
  return hold({ kind: 'job', id: jobId, input });
}
export function createPlanningEntry(input: unknown): Promise<Result> {
  return hold({ kind: 'planning', id: 'create', input });
}
export async function getTimeCorrectionFormOptions(): Promise<unknown> {
  return {
    success: true,
    options: {
      currentEmployeeRecordId: 'manager-record',
      people: [
        { userId: 'worker', employeeRecordId: 'r1', name: 'Alex Test' },
        { userId: 'worker-2', employeeRecordId: 'r2', name: 'Bea Zwei' },
      ],
      jobs: [],
    },
  };
}
export async function submitTimeCorrection(input: unknown): Promise<unknown> {
  const result = await hold({ kind: 'entries', id: 'correction', input });
  return result.success
    ? { success: true, status: 'submitted', requestId: 'request', replayed: false }
    : result;
}
// `@/lib/time-corrections/actions` for the correction approval card.
export const reviewTimeCorrection = reviewTimeCorrectionContract;
export const reviewTimeCorrectionsBatch = unexpectedWrite;
export const withdrawTimeCorrection = unexpectedWrite;
export const resubmitTimeCorrection = unexpectedWrite;
export function parkWorkTarget(input: unknown): Promise<Result> {
  return hold({ kind: 'park', id: 'park', input });
}
export function unparkJobIntoSchedule(input: unknown): Promise<Result> {
  return hold({ kind: 'unpark', id: 'unpark', input });
}
