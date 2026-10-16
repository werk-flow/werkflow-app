import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';

type WriteError = { message: string } | null;

/**
 * The failure of one call of a database write function for a module whose
 * function raises the codes in `refusals` under its lock: a listed refusal
 * reaches the caller as its code; anything else is logged and becomes the
 * action's own failure code.
 */
export function writeRefusalFor(
  refusals: ReadonlySet<string>,
): (error: WriteError, failureCode: string, logLabel: string) => ActionFailure {
  return (error, failureCode, logLabel) => {
    if (error && refusals.has(error.message)) return { success: false, error: error.message };
    logError(logLabel, error);
    return { success: false, error: failureCode };
  };
}

/**
 * The result of one call of a database write function that returns the saved
 * row: the row's data, or the failure `writeRefusalFor` names. A call that
 * returns no row fails with the action's own code.
 */
export function rowWriteResultFor<Row, Data extends object>(
  refusals: ReadonlySet<string>,
  toData: (row: Row) => Data,
): (
  outcome: { data: Row | null; error: WriteError },
  failureCode: string,
  logLabel: string,
) => ActionResult<Data> {
  const refusal = writeRefusalFor(refusals);
  return (outcome, failureCode, logLabel) => {
    if (outcome.error || !outcome.data) return refusal(outcome.error, failureCode, logLabel);
    return { success: true, ...toData(outcome.data) };
  };
}
