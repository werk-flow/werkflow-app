import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

import { type BoatClient, BoatError, READY_STATES } from './boat-api';
import { runScript } from './boat-machine';

// The three workstations share one Boat member limit of 10 machines. At that limit a run first deletes
// its own workstation's kept machines (machine-reuse.ts), whose idle records only that workstation
// can read. Without one, it takes another workstation's machine that has waited for its checkout's
// next run longer than EVICT_AFTER_MINUTES (docs/technical/boat-verification.md#machine-reuse).
// The machine itself decides who gets it: a wiped machine holds IDLE_MARK, and the owner's next run
// and an evicting run each rename it. A rename succeeds once, so a machine is never evicted while a
// run uses it, and a machine whose wait was taken over is never reused.

const PRISTINE = '/var/lib/werkflow-pristine';
/** Present only while a wiped machine waits; its modification time is the moment the wait began. */
const IDLE_MARK = `${PRISTINE}/idle`;
/** How long another workstation's kept machine must have waited before a run at the limit takes it. */
const EVICT_AFTER_MINUTES = 10;

/** The label that ties a machine to its workstation, without naming it. */
export function workstationLabel(host = hostname()): string {
  return createHash('sha256').update(host).digest('hex').slice(0, 16);
}

/**
 * Appended to the wipe's command: once the wipe passed, marks the machine as waiting. A wipe that
 * failed exits with its own status first, and a mark that fails fails the wipe.
 */
export const MARK_IDLE = `
wiped=$?
[ "$wiped" -eq 0 ] || exit "$wiped"
sudo touch ${IDLE_MARK} || { printf '[boat] wipe failed: cannot mark the machine idle\\n' >&2; exit 1; }`;

/**
 * Exits 0 when this run may use the kept machine: it took the mark, or the machine was wiped before
 * marks existed and so no other workstation can have taken it.
 */
const CLAIM = `sudo mv ${IDLE_MARK} ${PRISTINE}/taken 2> /dev/null || ! test -e ${PRISTINE}/evicted`;

/** Exits 0 only when this run took the mark of a machine that has waited over EVICT_AFTER_MINUTES. */
const EVICT = `[ -n "$(find ${IDLE_MARK} -mmin +${EVICT_AFTER_MINUTES} 2> /dev/null)" ] && sudo mv ${IDLE_MARK} ${PRISTINE}/evicted`;

const silent = { stdout: () => undefined, stderr: () => undefined };

/** When Boat stops a machine, or never for a deadline it did not send or that does not parse. */
const stopsAt = (archiveAfter: string | null | undefined) => Date.parse(archiveAfter ?? '') || Infinity;

/**
 * Whether the run may use its workstation's kept machine `id`; false once another workstation took
 * it, including when that workstation already deleted it. Any other Boat refusal throws.
 */
export async function claimKeptMachine(
  client: BoatClient,
  id: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const { exitCode } = await runScript({ id, client, log: () => undefined }, CLAIM, silent, signal);
    return exitCode === 0;
  } catch (error) {
    if (error instanceof BoatError && error.status === 404) return false;
    throw error;
  }
}

/**
 * The id of one other workstation's machine that waited over EVICT_AFTER_MINUTES and is now this
 * run's to delete, trying those Boat stops soonest first; none when no such machine exists or Boat
 * does not answer. A machine without a `workstation` label was kept by code without marks: never taken.
 */
export async function takeIdleMachineElsewhere(
  client: BoatClient,
  signal: AbortSignal,
  mine = workstationLabel(),
): Promise<string[]> {
  const listed = await client.list({ purpose: 'werkflow-verify' }).catch(() => []);
  const candidates = listed
    .filter(
      ({ state, labels }) => READY_STATES.has(state) && labels?.workstation && labels.workstation !== mine,
    )
    .sort((a, b) => stopsAt(a.archiveAfter) - stopsAt(b.archiveAfter));
  for (const { id } of candidates) {
    const taken = await runScript({ id, client, log: () => undefined }, EVICT, silent, signal).then(
      ({ exitCode }) => exitCode === 0,
      () => false,
    );
    if (taken) return [id];
  }
  return [];
}
