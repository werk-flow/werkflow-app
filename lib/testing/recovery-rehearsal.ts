import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export type RecoveryTarget = Readonly<{
  runId: string;
  sourceDatabase: string;
  restoredDatabase: string;
  sourceBucket: string;
  backupBucket: string;
  restoredBucket: string;
}>;

export function createRecoveryTarget(runId = randomUUID().replaceAll('-', '')): RecoveryTarget {
  if (!/^[a-f0-9]{32}$/.test(runId)) throw new Error('Invalid recovery run identity.');
  return {
    runId,
    sourceDatabase: `wf_recovery_${runId}_source`,
    restoredDatabase: `wf_recovery_${runId}_restore`,
    sourceBucket: `wf-recovery-${runId}-source`,
    backupBucket: `wf-recovery-${runId}-backup`,
    restoredBucket: `wf-recovery-${runId}-restore`,
  };
}

export function assertRecoveryResource(target: RecoveryTarget, name: string): void {
  const expected = createRecoveryTarget(target.runId);
  if (![expected.sourceDatabase, expected.restoredDatabase, expected.sourceBucket,
    expected.backupBucket, expected.restoredBucket].includes(name)) {
    throw new Error('Resource is outside this recovery run.');
  }
}

export function assertLocalRecoveryEndpoint(endpoint: string, localHost: string): void {
  const parsed = new URL(endpoint);
  const isPrivateHost = isIP(localHost) === 4 && (
    localHost === '127.0.0.1' || localHost.startsWith('10.') || localHost.startsWith('192.168.') ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(localHost)
  );
  if (!isPrivateHost
    || parsed.protocol !== 'http:' || parsed.hostname !== localHost
    || parsed.port !== '54321' || parsed.pathname !== '/storage/v1/s3'
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Recovery requires the inspected local Storage endpoint.');
  }
}

export type RecoveryStage = 'seed' | 'backup' | 'remove-source' | 'restore' | 'verify';
export type RecoveryOperations = Record<RecoveryStage, () => Promise<void>> & {
  cleanup: () => Promise<void>;
};

/** Cleanup runs after every failure; success requires cleanup, too. Only fixed stage names escape. */
export async function runRecoveryStages(
  operations: RecoveryOperations,
  record: (stage: RecoveryStage | 'cleanup', status: 'started' | 'passed' | 'failed') => void,
): Promise<void> {
  let failure: string | undefined;
  try {
    for (const stage of ['seed', 'backup', 'remove-source', 'restore', 'verify'] as const) {
      record(stage, 'started');
      try { await operations[stage](); }
      catch { record(stage, 'failed'); throw new Error(stage); }
      record(stage, 'passed');
    }
  } catch (error) {
    failure = error instanceof Error && ['seed', 'backup', 'remove-source', 'restore', 'verify'].includes(error.message)
      ? error.message : 'journal';
  }
  try { record('cleanup', 'started'); } catch { failure ??= 'journal'; }
  try { await operations.cleanup(); }
  catch { failure = failure ? `${failure}; cleanup` : 'cleanup'; }
  try { record('cleanup', failure?.includes('cleanup') ? 'failed' : 'passed'); }
  catch { failure ??= 'journal'; }
  if (failure) throw new Error(`Recovery rehearsal failed at ${failure}. Inspect the redacted journal; no acceptance recorded.`);
}

export type RecoveryResource = {
  kind: 'database' | 'bucket';
  name: string;
  state: 'planned' | 'created' | 'cleaned';
};

/** A timed-out create may have committed. Reconcile every reserved owned resource. */
export async function cleanupRecoveryResources(
  target: RecoveryTarget,
  resources: RecoveryResource[],
  removeIfPresent: (resource: RecoveryResource) => Promise<void>,
  journal: () => void,
): Promise<void> {
  let failed = false;
  for (const resource of [...resources].reverse()) {
    if (resource.state === 'cleaned') continue;
    try {
      assertRecoveryResource(target, resource.name);
      await removeIfPresent(resource);
      resource.state = 'cleaned';
      journal();
    } catch { failed = true; }
  }
  if (failed) throw new Error('Owned cleanup incomplete.');
}
