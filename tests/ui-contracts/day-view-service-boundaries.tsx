import type { updateJob as ServerUpdateJob } from '@/lib/jobs/actions';

type Result = { success: true } | { success: false; error: string };
const held: Array<{ resolve: (result: Result) => void; reject: (error: Error) => void }> = [];
declare global {
  interface Window { dayViewContract: { calls: Array<{ jobId: string; input: Parameters<typeof ServerUpdateJob>[1] }>; complete: (index: number, outcome: 'success' | 'failure' | 'reject') => void }; }
}
window.dayViewContract = {
  calls: [],
  complete(index, outcome) {
    const call = held[index];
    if (!call) throw new Error(`No held day-view write ${index}`);
    if (outcome === 'reject') call.reject(new Error('controlled transport failure'));
    else call.resolve(outcome === 'success' ? { success: true } : { success: false, error: 'write_failed' });
  },
};
export function updateJob(jobId: string, input: Parameters<typeof ServerUpdateJob>[1]): Promise<Result> {
  window.dayViewContract.calls.push({ jobId, input });
  return new Promise((resolve, reject) => held.push({ resolve, reject }));
}
// These editors are closed in this drag contract; they must not bring their unrelated server graph into the bundle.
export function CalendarEntryDialog(): null { return null; }
export function JobEventPopover(): null { return null; }
export function EntryDetailsDialog(): null { return null; }
export async function updateEntry(): Promise<{ success: false; error: string }> { throw new Error('unexpected time write in job drag contract'); }
export async function reassignEntries(): Promise<{ success: false; error: string }> { throw new Error('unexpected time reassignment'); }
export async function reassignEntryBatch(): Promise<{ success: false; error: string }> { throw new Error('unexpected time batch'); }
export async function cancelOwnChangeRequest(): Promise<{ success: false; error: string }> { throw new Error('unexpected request cancellation'); }
