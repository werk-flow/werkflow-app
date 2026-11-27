import { logError } from '@/lib/logging';

type DatabaseWrite = PromiseLike<{ error: { message: string } | null }>;

/**
 * Runs an idempotent database write under its time limit, at most `tries`
 * times while time is left. A write past its limit counts as failed, though
 * it may still land: the caller then keeps the run's provisional charge,
 * which only ever overstates. `landed` names a refusal that means an earlier
 * try already wrote.
 */
export async function boundedWrite(
  label: string,
  limitMs: number,
  tries: number,
  write: (signal: AbortSignal) => DatabaseWrite,
  landed: (message: string) => boolean = () => false,
): Promise<boolean> {
  const signal = AbortSignal.timeout(limitMs);
  let failure: unknown = 'timeout';
  for (let attempt = 0; attempt < tries && !signal.aborted; attempt += 1) {
    const { error } = await write(signal);
    if (!error || landed(error.message)) return true;
    failure = error;
  }
  logError(label, failure);
  return false;
}
