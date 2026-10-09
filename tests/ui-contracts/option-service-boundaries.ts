import type { JobEntityOption, JobOptionRequest, JobOptionResult } from '@/lib/jobs/option-types';

const pending: Array<(result: JobOptionResult) => void> = [];
declare global {
  interface Window {
    optionContract: {
      requests: JobOptionRequest[];
      resolve: (
        index: number,
        options: JobEntityOption[],
        selected?: JobEntityOption[],
        hasMore?: boolean,
      ) => void;
      fail: (index: number) => void;
    };
  }
}
window.optionContract = {
  requests: [],
  resolve(index, options, selected = [], hasMore = false) {
    const settle = pending[index];
    if (!settle) throw new Error(`no pending option request ${index}`);
    settle({ success: true, options, selected, hasMore });
  },
  fail(index) {
    const settle = pending[index];
    if (!settle) throw new Error(`no pending option request ${index}`);
    settle({ success: false, error: 'held_failure' });
  },
};
/** The `entity-options` background read: held until the spec resolves or fails it. */
export function readEntityOptionContract(input: unknown): Promise<JobOptionResult> {
  window.optionContract.requests.push(input as JobOptionRequest);
  return new Promise((resolve) => pending.push(resolve));
}
