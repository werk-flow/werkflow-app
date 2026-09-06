import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertInterruptedRecoveryOwnership, archiveRecoveryActiveState, interruptedRecoveryPatch, recoverInterruptedEvidence, INTERRUPTED_RECOVERY_OPERATION } from './interrupted-run-recovery';
import { campaignSummary } from './run-campaign';
import { withWorkspaceTestLock } from './workspace-test-lock';
import type { RunManifest } from '../../tests/golden/support/run-state';

const unfinished = {
  runKey: 'orphaned-run', status: 'running' as const,
  startedAt: '2026-09-05T06:00:00Z', completedAt: null,
  world: { runId: 'owned-world', organizationIds: ['primary', 'outsider'], userIds: [] },
  retainedAt: null, cleanedAt: null, failures: [],
  passed: 41, failed: 0, skipped: 0,
  outcomes: [{ id: 'completed-business-stage', status: 'passed' as const }],
  currentTestId: 'stage-in-progress', campaignId: 'campaign', rerunGrantId: 'consumed-grant',
};

type RecoveryFixture = Pick<RunManifest,
  'runKey' | 'status' | 'startedAt' | 'completedAt' | 'world' | 'retainedAt' | 'cleanedAt' |
  'failures' | 'interruptionRecovery' | 'passed' | 'failed' | 'outcomes' | 'rerunGrantId'>;

function manifestStore(directory: string): {
  read: () => RecoveryFixture;
  persist: (patch: Partial<RunManifest>) => RecoveryFixture;
} {
  const path = join(directory, 'manifest.json');
  writeFileSync(path, JSON.stringify(unfinished));
  const read = (): RecoveryFixture => JSON.parse(readFileSync(path, 'utf8')) as RecoveryFixture;
  return {
    read,
    persist: (patch) => {
      const next = { ...read(), ...patch };
      writeFileSync(path, JSON.stringify(next));
      return next;
    },
  };
}

describe('explicit interrupted-run recovery', () => {
  test('preserves real outcomes and consumed campaign cost without inventing a failed stage', () => {
    const patch = interruptedRecoveryPatch(unfinished, 'Operator stopped the process tree after finding an omitted UI form.', '2026-09-05T06:30:00Z');
    const recovered = { ...unfinished, ...patch };
    expect(recovered.status).toBe('interrupted');
    expect(recovered.passed).toBe(41);
    expect(recovered.failed).toBe(0);
    expect(recovered.outcomes).toEqual(unfinished.outcomes);
    expect(recovered.rerunGrantId).toBe('consumed-grant');
    expect(recovered.retainedAt).toBe('2026-09-05T06:30:00Z');
    expect(recovered.failures).toMatchObject([{ file: null }]);
    expect(recovered.failures?.[0]).not.toHaveProperty('testId');
    expect(patch).not.toHaveProperty('currentTestId');
    expect(campaignSummary({ id: 'campaign', name: 'Browser verification', startedAt: unfinished.startedAt, closedAt: null, grants: [] }, [{
      runKey: unfinished.runKey, campaignId: 'campaign', lane: 'certification', suite: 'audit', target: 'local',
      startedAt: unfinished.startedAt, completedAt: patch.completedAt ?? null,
    }])).toMatchObject({ fullAttempts: 1, fullMinutes: 30 });
  });

  test('rejects completed runs, weak explanations and invalid completion times', () => {
    expect(() => interruptedRecoveryPatch({ ...unfinished, status: 'passed', completedAt: '2026-09-05T06:10:00Z' }, 'Operator observed a terminated process tree.')).toThrow('unfinished');
    expect(() => interruptedRecoveryPatch(unfinished, 'retry')).toThrow('concrete');
    expect(() => interruptedRecoveryPatch(unfinished, 'Operator observed a terminated process tree.', '2026-09-05T05:00:00Z')).toThrow('no earlier');
  });

  test('does not resurrect ownership already confirmed cleaned', () => {
    expect(interruptedRecoveryPatch({ ...unfinished, cleanedAt: '2026-09-05T06:10:00Z' }, 'Host killed the runner after successful teardown.').retainedAt).toBeNull();
  });

  test('archives active files only when both manifests and the world agree', () => {
    const world = { runId: 'owned-world', orgId: 'primary', outsider: { orgId: 'outsider' } };
    let archives = 0;
    const archiveOutputs = (): void => { archives += 1; };
    expect(() => archiveRecoveryActiveState(unfinished, { ...unfinished, runKey: 'another-run' }, world, archiveOutputs)).toThrow('another run');
    expect(() => archiveRecoveryActiveState(unfinished, { ...unfinished, world: { ...unfinished.world, runId: 'retired-world' } }, world, archiveOutputs)).toThrow('do not match');
    expect(() => archiveRecoveryActiveState(unfinished, unfinished, { ...world, orgId: 'unrelated' }, archiveOutputs)).toThrow('do not match');
    expect(archives).toBe(0);
    expect(() => archiveRecoveryActiveState(unfinished, unfinished, world, archiveOutputs)).not.toThrow();
    expect(archives).toBe(1);
  });

  test('requires a separately acquired recovery lock and refuses a live runner lock', async () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'werkflow-recover-'));
    try {
      expect(() => assertInterruptedRecoveryOwnership(repositoryRoot)).toThrow();
      await withWorkspaceTestLock({ repositoryRoot, operation: 'Playwright certification audit' }, async () => {
        expect(() => assertInterruptedRecoveryOwnership(repositoryRoot)).toThrow('own exclusive');
        await expect(withWorkspaceTestLock({ repositoryRoot, operation: INTERRUPTED_RECOVERY_OPERATION }, async () => undefined)).rejects.toThrow('Another workspace operation');
      });
      await withWorkspaceTestLock({ repositoryRoot, operation: INTERRUPTED_RECOVERY_OPERATION }, async () => {
        expect(() => assertInterruptedRecoveryOwnership(repositoryRoot)).not.toThrow();
      });
    } finally { rmSync(repositoryRoot, { recursive: true, force: true }); }
  });

  test.each(['archive copy failed', 'missing archived world', 'world identity mismatch'])(
    'durably retains ownership before evidence failure: %s', (failure) => {
      const directory = mkdtempSync(join(tmpdir(), 'werkflow-recovery-evidence-'));
      try {
        const store = manifestStore(directory);
        const artifact = join(directory, 'original-output.log');
        writeFileSync(artifact, 'original forensic output');
        expect(() => recoverInterruptedEvidence({
          manifest: store.read(), reason: 'Host terminated the runner before normal teardown completed.',
          recoveredAt: '2026-09-05T06:30:00Z', persist: store.persist,
          archiveAndVerify: () => {
            expect(store.read()).toMatchObject({ status: 'interrupted', retainedAt: '2026-09-05T06:30:00Z', cleanedAt: null });
            throw new Error(failure);
          },
        })).toThrow('retry recover-interrupted');
        expect(store.read()).toMatchObject({
          status: 'interrupted', retainedAt: '2026-09-05T06:30:00Z', cleanedAt: null,
          passed: 41, failed: 0, interruptionRecovery: { archive: { status: 'failed', error: failure } },
        });
        expect(readFileSync(artifact, 'utf8')).toBe('original forensic output');
      } finally { rmSync(directory, { recursive: true, force: true }); }
    },
  );

  test('named archive repair preserves the original completion time, outcomes and consumed grant', () => {
    const directory = mkdtempSync(join(tmpdir(), 'werkflow-recovery-repair-'));
    try {
      const store = manifestStore(directory);
      const archivePath = join(directory, 'world.json');
      const archiveAndVerify = (): void => { readFileSync(archivePath, 'utf8'); };
      expect(() => recoverInterruptedEvidence({
        manifest: store.read(), reason: 'Host terminated the runner before normal teardown completed.',
        recoveredAt: '2026-09-05T06:30:00Z', persist: store.persist, archiveAndVerify,
      })).toThrow('archive recovery failed');
      const firstRecovery = store.read();
      writeFileSync(archivePath, JSON.stringify({ runId: 'owned-world' }));
      const repaired = recoverInterruptedEvidence({
        manifest: firstRecovery, reason: 'Recovered the missing archive from the same owned active world.',
        recoveredAt: '2026-09-05T07:00:00Z', persist: store.persist, archiveAndVerify,
      });
      expect(repaired).toMatchObject({
        status: 'interrupted', completedAt: '2026-09-05T06:30:00Z', retainedAt: '2026-09-05T06:30:00Z', cleanedAt: null,
        rerunGrantId: 'consumed-grant', interruptionRecovery: { recoveredAt: '2026-09-05T06:30:00Z', archive: { status: 'complete' } },
      });
      expect(repaired.outcomes).toEqual(firstRecovery.outcomes);
      expect(repaired.failures).toEqual(firstRecovery.failures);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('no archive operation starts when durable ownership recording fails', () => {
    let archiveCalls = 0;
    expect(() => recoverInterruptedEvidence({
      manifest: unfinished, reason: 'Host terminated the runner before normal teardown completed.',
      persist: () => { throw new Error('manifest write failed'); },
      archiveAndVerify: () => { archiveCalls += 1; },
    })).toThrow('manifest write failed');
    expect(archiveCalls).toBe(0);
  });

  test('failure-record write failure preserves the earlier pending ownership and both errors', () => {
    const directory = mkdtempSync(join(tmpdir(), 'werkflow-recovery-write-fault-'));
    try {
      const store = manifestStore(directory);
      let writes = 0;
      expect(() => recoverInterruptedEvidence({
        manifest: store.read(), reason: 'Host terminated the runner before normal teardown completed.',
        persist: (patch) => {
          writes += 1;
          if (writes > 1) throw new Error('archive failure record write failed');
          return store.persist(patch);
        },
        archiveAndVerify: () => { throw new Error('archive copy failed'); },
      })).toThrow(AggregateError);
      expect(store.read()).toMatchObject({
        status: 'interrupted', cleanedAt: null, interruptionRecovery: { archive: { status: 'pending' } },
      });
      expect(store.read().retainedAt).not.toBeNull();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
