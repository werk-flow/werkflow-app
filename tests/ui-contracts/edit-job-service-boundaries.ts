// Stand-in for `@/lib/jobs/actions` as the job edit dialog imports it: the
// focus contract never saves, so a write is a contract violation.
import { unexpectedWrite } from './held-write-boundary';

export const updateJob = unexpectedWrite;

// The job header's handle on the lazily loaded edit dialog: the contract
// renders the dialog itself, so the handle neither downloads nor waits.
export const lazyEditJobDialog = {
  useWaiting: (): boolean => false,
  preload: (): void => undefined,
};
