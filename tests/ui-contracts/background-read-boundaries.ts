// Isolated stand-in for `@/lib/data/background-read-client`: the fixtures own
// the reads their components perform; any other kind is a contract violation.
import { getWorkLifecycleSnapshot } from './lifecycle-boundaries';

export async function readInBackground(kind: string, input: unknown): Promise<unknown> {
  if (kind === 'work-lifecycle-snapshot') return getWorkLifecycleSnapshot();
  throw new Error(`Unexpected background read in the UI fixture: ${kind} ${JSON.stringify(input)}`);
}
