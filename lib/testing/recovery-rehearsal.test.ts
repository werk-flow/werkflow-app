import { expect, test } from 'bun:test';
import { cleanupRecoveryResources, assertLocalRecoveryEndpoint, assertRecoveryResource, createRecoveryTarget, runRecoveryStages, type RecoveryResource, type RecoveryStage } from './recovery-rehearsal';

test('recovery rejects shared, foreign-run and injected resource identities', () => {
  const target = createRecoveryTarget('a'.repeat(32));
  expect(() => assertRecoveryResource(target, target.sourceDatabase)).not.toThrow();
  for (const name of ['postgres', 'werkflow-documents-local', 'werkflow-documents-prod',
    createRecoveryTarget('b'.repeat(32)).sourceDatabase, `${target.sourceDatabase};drop database postgres`]) {
    expect(() => assertRecoveryResource(target, name)).toThrow();
  }
  expect(() => createRecoveryTarget('../escape')).toThrow();
  expect(() => assertRecoveryResource({ ...target, sourceDatabase: 'postgres' }, 'postgres')).toThrow();
});

test('recovery endpoint cannot redirect to cloud, an arbitrary local service or userinfo', () => {
  assertLocalRecoveryEndpoint('http://172.22.1.2:54321/storage/v1/s3', '172.22.1.2');
  for (const endpoint of ['https://example.supabase.co/storage/v1/s3',
    'http://172.22.1.3:54321/storage/v1/s3', 'http://172.22.1.2:54322/storage/v1/s3',
    'http://secret@172.22.1.2:54321/storage/v1/s3', 'http://172.22.1.2:54321/storage/v1/s3?redirect=1']) {
    expect(() => assertLocalRecoveryEndpoint(endpoint, '172.22.1.2')).toThrow();
  }
});

test('recovery accepts only complete private IPv4 addresses and the exact loopback address', () => {
  for (const host of ['127.0.0.1', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1']) {
    expect(() => assertLocalRecoveryEndpoint(`http://${host}:54321/storage/v1/s3`, host)).not.toThrow();
  }
  for (const host of ['172.15.255.255', '172.32.0.1', '172.217.0.1', '192.0.2.1', '192.169.0.1',
    '10.256.0.1', '172.16.999.1', '192.168.0.256', '127.0.0.2', '10.1', '10.00.0.1']) {
    expect(() => assertLocalRecoveryEndpoint(`http://${host}:54321/storage/v1/s3`, host)).toThrow();
  }
});

for (const failedStage of ['seed', 'backup', 'remove-source', 'restore', 'verify'] as const) {
  test(`failure at ${failedStage} stops later operations, cleans resources and redacts provider errors`, async () => {
    const called: string[] = [];
    const operation = (stage: RecoveryStage) => async (): Promise<void> => {
      called.push(stage);
      if (stage === failedStage) throw new Error('token=SECRET signed-url=SECRET');
    };
    const promise = runRecoveryStages({ seed: operation('seed'), backup: operation('backup'),
      'remove-source': operation('remove-source'), restore: operation('restore'), verify: operation('verify'),
      cleanup: async () => { called.push('cleanup'); } }, () => {});
    await expect(promise).rejects.toThrow(`failed at ${failedStage}`);
    expect(called.at(-1)).toBe('cleanup');
    expect(called.indexOf(failedStage)).toBe(called.length - 2);
  });
}

test('a cleanup failure prevents successful acceptance', async () => {
  const pass = async (): Promise<void> => {};
  await expect(runRecoveryStages({ seed: pass, backup: pass, 'remove-source': pass,
    restore: pass, verify: pass, cleanup: async () => { throw new Error('SECRET'); } }, () => {}))
    .rejects.toThrow('failed at cleanup');
});

test('journal failure still invokes cleanup', async () => {
  let cleaned = false;
  const pass = async (): Promise<void> => {};
  await expect(runRecoveryStages({ seed: pass, backup: pass, 'remove-source': pass,
    restore: pass, verify: pass, cleanup: async () => { cleaned = true; } }, (stage) => {
    if (stage === 'seed') throw new Error('disk full');
  })).rejects.toThrow('failed at journal');
  expect(cleaned).toBe(true);
});

test('even an unavailable journal during cleanup cannot skip cleanup', async () => {
  let cleaned = false;
  const pass = async (): Promise<void> => {};
  await expect(runRecoveryStages({ seed: pass, backup: pass, 'remove-source': pass,
    restore: pass, verify: pass, cleanup: async () => { cleaned = true; } }, () => {
    throw new Error('journal unavailable');
  })).rejects.toThrow('failed at journal');
  expect(cleaned).toBe(true);
});

test('ambiguous creations are reconciled and cleanup continues after a failed resource', async () => {
  const target = createRecoveryTarget('c'.repeat(32));
  const resources: RecoveryResource[] = [
    { kind: 'database' as const, name: target.sourceDatabase, state: 'planned' as const },
    { kind: 'bucket' as const, name: target.sourceBucket, state: 'planned' as const },
  ];
  const removed: string[] = [];
  await expect(cleanupRecoveryResources(target, resources, async resource => {
    removed.push(resource.name);
    if (resource.kind === 'bucket') throw new Error('provider unavailable');
  }, () => {})).rejects.toThrow('Owned cleanup incomplete');
  expect(removed).toEqual([target.sourceBucket, target.sourceDatabase]);
  expect(resources[0]?.state).toBe('cleaned');
  expect(resources[1]?.state).toBe('planned');
  await cleanupRecoveryResources(target, resources, async resource => { removed.push(resource.name); }, () => {});
  expect(removed).toEqual([target.sourceBucket, target.sourceDatabase, target.sourceBucket]);
  expect(resources.every(resource => resource.state === 'cleaned')).toBe(true);
});
