import { readFileSync } from 'node:fs';
import type { RunManifest } from '../../tests/golden/support/run-state';
import { assertWorkspaceTestLock, workspaceTestLockPath } from './workspace-test-lock';
import { validateRetainedWorldIdentity } from './archive-state';

export const INTERRUPTED_RECOVERY_OPERATION = 'Playwright run management recover-interrupted';

/** Recovery must acquire its own lock, never borrow a running runner's ownership. */
export function assertInterruptedRecoveryOwnership(repositoryRoot?: string): void {
  assertWorkspaceTestLock(repositoryRoot);
  const owner: unknown = JSON.parse(readFileSync(workspaceTestLockPath(repositoryRoot), 'utf8'));
  if (!owner || typeof owner !== 'object' || !('processId' in owner) || owner.processId !== process.pid ||
      !('operation' in owner) || owner.operation !== INTERRUPTED_RECOVERY_OPERATION) {
    throw new Error('Interrupted recovery requires its own exclusive workspace lock. Stop the owning operation first.');
  }
}

export type InterruptionRecovery = {
  recoveredAt: string;
  reason: string;
  durationIsUpperBound: true;
  archive?: { attemptedAt: string; attemptReason: string } & (
    { status: 'pending' | 'complete' } | { status: 'failed'; error: string }
  );
};

type RecoverableManifest = Pick<RunManifest,
  'status' | 'completedAt' | 'startedAt' | 'world' | 'cleanedAt' | 'retainedAt' | 'failures' | 'interruptionRecovery'>;

export function archiveRecoveryActiveState(
  manifest: Pick<RunManifest, 'runKey' | 'world'>,
  active: Pick<RunManifest, 'runKey' | 'world'>,
  world: { runId: string; orgId: string; outsider: { orgId: string } },
  archiveOutputs: () => void,
): void {
  if (manifest.runKey !== active.runKey) throw new Error('Active state belongs to another run; refusing to archive it for recovery.');
  validateRetainedWorldIdentity(manifest.world, world);
  validateRetainedWorldIdentity(active.world, world);
  archiveOutputs();
}

export function interruptedRecoveryPatch(
  manifest: RecoverableManifest,
  reason: string,
  recoveredAt = new Date().toISOString(),
): Partial<RunManifest> {
  const repair = manifest.status === 'interrupted' && Boolean(manifest.completedAt && manifest.interruptionRecovery);
  if (!repair && (!['starting', 'running'].includes(manifest.status) || manifest.completedAt)) {
    throw new Error('Only an unfinished starting or running manifest can be recovered as interrupted.');
  }
  if (reason.trim().length < 20) throw new Error('Record a concrete interruption reason of at least 20 characters.');
  if (!Number.isFinite(Date.parse(recoveredAt)) || !Number.isFinite(Date.parse(manifest.startedAt)) ||
      Date.parse(recoveredAt) < Date.parse(manifest.startedAt)) {
    throw new Error('Recovery time must be valid and no earlier than the recorded run start.');
  }
  const archive: NonNullable<InterruptionRecovery['archive']> = {
    status: 'pending', attemptedAt: recoveredAt, attemptReason: reason.trim(),
  };
  if (repair && manifest.interruptionRecovery) {
    return {
      retainedAt: manifest.world && !manifest.cleanedAt
        ? manifest.retainedAt ?? manifest.interruptionRecovery.recoveredAt : manifest.retainedAt,
      interruptionRecovery: { ...manifest.interruptionRecovery, archive },
    };
  }
  return {
    status: 'interrupted',
    completedAt: recoveredAt,
    retainedAt: manifest.world && !manifest.cleanedAt ? manifest.retainedAt ?? recoveredAt : manifest.retainedAt,
    interruptionRecovery: { recoveredAt, reason: reason.trim(), durationIsUpperBound: true, archive },
    failures: [...manifest.failures, {
      title: 'Runner interrupted outside normal teardown',
      file: null,
      message: `${reason.trim()} Recovery conservatively charges campaign duration through ${recoveredAt}; no failed business test is inferred.`,
    }],
  };
}

/** Retain ownership before evidence I/O; named retries repair the archive without rewriting run results. */
export function recoverInterruptedEvidence<Manifest extends RecoverableManifest>(input: {
  manifest: Manifest;
  reason: string;
  recoveredAt?: string;
  persist: (patch: Partial<RunManifest>) => Manifest;
  archiveAndVerify: (manifest: Manifest) => void;
}): Manifest {
  const pending = input.persist(interruptedRecoveryPatch(input.manifest, input.reason, input.recoveredAt));
  const recovery = pending.interruptionRecovery;
  if (!recovery?.archive) throw new Error('Interrupted ownership must be recorded before archiving evidence.');
  try {
    input.archiveAndVerify(pending);
    return input.persist({ interruptionRecovery: {
      ...recovery, archive: { ...recovery.archive, status: 'complete' },
    } });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    try {
      input.persist({ interruptionRecovery: {
        ...recovery, archive: { ...recovery.archive, status: 'failed', error },
      } });
    } catch (recordingFailure) {
      throw new AggregateError([cause, recordingFailure], 'Interrupted ownership was recorded, but archive recovery and its failure record both failed. Repair the evidence and retry recover-interrupted for the same run.');
    }
    throw new Error('Interrupted ownership remains recorded; archive recovery failed. Repair the evidence and retry recover-interrupted for the same run. No cleanup was performed.', { cause });
  }
}
