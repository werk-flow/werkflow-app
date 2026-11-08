import { expect, test } from 'bun:test';
import {
  assertFilesReconciled,
  assertLocalDockerEndpoint,
  changedAccess,
  cleanupRecoveryResources,
  assertLocalRecoveryEndpoint,
  assertRecoveryResource,
  createRecoveryTarget,
  dumpDigest,
  objectIdentity,
  parseAccessSnapshot,
  parseDocumentPaths,
  planRepresentativeOrganization,
  reconcileDocumentPaths,
  runRecoveryStages,
  type DocumentPath,
  type RecoveryResource,
  type RecoveryStage,
} from './recovery-rehearsal';

test('recovery rejects shared, foreign-run and injected resource identities', () => {
  const target = createRecoveryTarget('a'.repeat(32));
  expect(() => assertRecoveryResource(target, target.sourceDatabase)).not.toThrow();
  for (const name of [
    'postgres',
    'werkflow-documents-local',
    'werkflow-documents-prod',
    createRecoveryTarget('b'.repeat(32)).sourceDatabase,
    `${target.sourceDatabase};drop database postgres`,
  ]) {
    expect(() => assertRecoveryResource(target, name)).toThrow();
  }
  expect(() => createRecoveryTarget('../escape')).toThrow();
  expect(() => assertRecoveryResource({ ...target, sourceDatabase: 'postgres' }, 'postgres')).toThrow();
});

test('recovery endpoint cannot redirect to cloud, an arbitrary local service or userinfo', () => {
  assertLocalRecoveryEndpoint('http://172.22.1.2:54321/storage/v1/s3', '172.22.1.2');
  for (const endpoint of [
    'https://example.supabase.co/storage/v1/s3',
    'http://172.22.1.3:54321/storage/v1/s3',
    'http://172.22.1.2:54322/storage/v1/s3',
    'http://secret@172.22.1.2:54321/storage/v1/s3',
    'http://172.22.1.2:54321/storage/v1/s3?redirect=1',
  ]) {
    expect(() => assertLocalRecoveryEndpoint(endpoint, '172.22.1.2')).toThrow();
  }
});

test('recovery accepts only complete private IPv4 addresses and the exact loopback address', () => {
  for (const host of [
    '127.0.0.1',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
  ]) {
    expect(() => assertLocalRecoveryEndpoint(`http://${host}:54321/storage/v1/s3`, host)).not.toThrow();
  }
  for (const host of [
    '172.15.255.255',
    '172.32.0.1',
    '172.217.0.1',
    '192.0.2.1',
    '192.169.0.1',
    '10.256.0.1',
    '172.16.999.1',
    '192.168.0.256',
    '127.0.0.2',
    '10.1',
    '10.00.0.1',
  ]) {
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
    const promise = runRecoveryStages(
      {
        seed: operation('seed'),
        backup: operation('backup'),
        'remove-source': operation('remove-source'),
        restore: operation('restore'),
        verify: operation('verify'),
        cleanup: async () => {
          called.push('cleanup');
        },
      },
      () => {},
    );
    await expect(promise).rejects.toThrow(`failed at ${failedStage}`);
    expect(called.at(-1)).toBe('cleanup');
    expect(called.indexOf(failedStage)).toBe(called.length - 2);
  });
}

test('a cleanup failure prevents successful acceptance', async () => {
  const pass = async (): Promise<void> => {};
  await expect(
    runRecoveryStages(
      {
        seed: pass,
        backup: pass,
        'remove-source': pass,
        restore: pass,
        verify: pass,
        cleanup: async () => {
          throw new Error('SECRET');
        },
      },
      () => {},
    ),
  ).rejects.toThrow('failed at cleanup');
});

test('journal failure still invokes cleanup', async () => {
  let cleaned = false;
  const pass = async (): Promise<void> => {};
  await expect(
    runRecoveryStages(
      {
        seed: pass,
        backup: pass,
        'remove-source': pass,
        restore: pass,
        verify: pass,
        cleanup: async () => {
          cleaned = true;
        },
      },
      (stage) => {
        if (stage === 'seed') throw new Error('disk full');
      },
    ),
  ).rejects.toThrow('failed at journal');
  expect(cleaned).toBe(true);
});

test('even an unavailable journal during cleanup cannot skip cleanup', async () => {
  let cleaned = false;
  const pass = async (): Promise<void> => {};
  await expect(
    runRecoveryStages(
      {
        seed: pass,
        backup: pass,
        'remove-source': pass,
        restore: pass,
        verify: pass,
        cleanup: async () => {
          cleaned = true;
        },
      },
      () => {
        throw new Error('journal unavailable');
      },
    ),
  ).rejects.toThrow('failed at journal');
  expect(cleaned).toBe(true);
});

test('ambiguous creations are reconciled and cleanup continues after a failed resource', async () => {
  const target = createRecoveryTarget('c'.repeat(32));
  const resources: RecoveryResource[] = [
    { kind: 'database' as const, name: target.sourceDatabase, state: 'planned' as const },
    { kind: 'bucket' as const, name: target.sourceBucket, state: 'planned' as const },
  ];
  const removed: string[] = [];
  await expect(
    cleanupRecoveryResources(
      target,
      resources,
      async (resource) => {
        removed.push(resource.name);
        if (resource.kind === 'bucket') throw new Error('provider unavailable');
      },
      () => {},
    ),
  ).rejects.toThrow('Owned cleanup incomplete');
  expect(removed).toEqual([target.sourceBucket, target.sourceDatabase]);
  expect(resources[0]?.state).toBe('cleaned');
  expect(resources[1]?.state).toBe('planned');
  await cleanupRecoveryResources(
    target,
    resources,
    async (resource) => {
      removed.push(resource.name);
    },
    () => {},
  );
  expect(removed).toEqual([target.sourceBucket, target.sourceDatabase, target.sourceBucket]);
  expect(resources.every((resource) => resource.state === 'cleaned')).toBe(true);
});

test('recovery talks only to the Linux socket or the default Colima socket of the current user', () => {
  assertLocalDockerEndpoint('unix:///var/run/docker.sock', '/home/stack');
  assertLocalDockerEndpoint('unix:///Users/owner/.colima/default/docker.sock', '/Users/owner');
  for (const [endpoint, home] of [
    ['tcp://192.168.1.20:2375', '/Users/owner'],
    ['ssh://stack@pc', '/Users/owner'],
    ['unix:///Users/other/.colima/default/docker.sock', '/Users/owner'],
    ['unix:///Users/owner/.colima/remote/docker.sock', '/Users/owner'],
    ['unix:///Users/owner/../other/.colima/default/docker.sock', '/Users/owner/../other'],
    ['unix://relative/.colima/default/docker.sock', 'relative'],
  ] as const) {
    expect(() => assertLocalDockerEndpoint(endpoint, home)).toThrow('Recovery requires local Docker.');
  }
});

test('each finished stage reports its duration, the restore included', async () => {
  let clock = 0;
  const durations: Record<string, number | undefined> = {};
  const step = (milliseconds: number) => async (): Promise<void> => {
    clock += milliseconds;
  };
  await runRecoveryStages(
    {
      seed: step(10),
      backup: step(20),
      'remove-source': step(5),
      restore: step(1_234.4),
      verify: step(40),
      cleanup: step(7),
    },
    (stage, status, durationMs) => {
      if (status !== 'started') durations[stage] = durationMs;
    },
    () => clock,
  );
  expect(durations).toEqual({
    seed: 10,
    backup: 20,
    'remove-source': 5,
    restore: 1_234,
    verify: 40,
    cleanup: 7,
  });
});

const paths = (organization = planRepresentativeOrganization()): DocumentPath[] =>
  organization.objects.map((object) => ({
    documentId: object.documentId,
    path: object.path,
    sizeBytes: Buffer.byteLength(object.content),
  }));
const stored = (organization: ReturnType<typeof planRepresentativeOrganization>) =>
  organization.objects.map((object) => ({ key: object.path, sizeBytes: Buffer.byteLength(object.content) }));

test('a deliberately removed object in the restored bucket fails acceptance and names its document id', async () => {
  const organization = planRepresentativeOrganization();
  const [removed] = organization.objects.filter((object) =>
    organization.protectedDocumentIds.includes(object.documentId),
  );
  if (!removed) throw new Error('The plan has no protected personnel document.');
  const restoredBucket = stored(organization).filter((object) => object.key !== removed.path);
  const journal: string[] = [];
  const pass = async (): Promise<void> => {};
  await expect(
    runRecoveryStages(
      {
        seed: pass,
        backup: pass,
        'remove-source': pass,
        restore: pass,
        verify: async () => {
          const reconciliation = reconcileDocumentPaths(paths(organization), restoredBucket);
          journal.push(...reconciliation.missingDocumentIds);
          assertFilesReconciled(reconciliation, []);
        },
        cleanup: pass,
      },
      () => {},
    ),
  ).rejects.toThrow('failed at verify');
  expect(journal).toEqual([removed.documentId]);
  expect(() =>
    assertFilesReconciled(reconcileDocumentPaths(paths(organization), restoredBucket), []),
  ).toThrow(`Restored files do not reconcile: missing bytes for documents ${removed.documentId}.`);
});

test('a complete restored bucket reconciles, and an object of another size counts as missing', () => {
  const organization = planRepresentativeOrganization();
  const complete = reconcileDocumentPaths(paths(organization), stored(organization));
  expect(complete).toEqual({ missingDocumentIds: [], orphanObjectIds: [] });
  expect(() => assertFilesReconciled(complete, [])).not.toThrow();
  const [first, ...rest] = stored(organization);
  const [firstObject] = organization.objects;
  if (!first || !firstObject) throw new Error('The plan has no object.');
  const truncated = reconcileDocumentPaths(paths(organization), [{ ...first, sizeBytes: 1 }, ...rest]);
  expect(truncated.missingDocumentIds).toEqual([firstObject.documentId]);
});

test('an orphan object is reported by the ids in its key, never by its file name, and only the expected orphan passes', () => {
  const organizationId = '0b0e7c39-7f3c-4a43-9a2e-3b6f2f0a1c11';
  const documentId = '5f7a2d4e-9c1b-4e8a-8b3d-6a2c1e0f9d22';
  const key = `${organizationId}/${documentId}/Arbeitsunfaehigkeit-Erika-Musterfrau.pdf`;
  expect(objectIdentity(key)).toBe(`${organizationId}/${documentId}`);
  expect(objectIdentity('Erika-Musterfrau.pdf')).toMatch(/^key-sha256-[0-9a-f]{16}$/);
  const reconciliation = reconcileDocumentPaths([], [{ key, sizeBytes: 10 }]);
  expect(reconciliation.orphanObjectIds).toEqual([`${organizationId}/${documentId}`]);
  expect(() => assertFilesReconciled(reconciliation, [`${organizationId}/${documentId}`])).not.toThrow();
  expect(() => assertFilesReconciled(reconciliation, [])).toThrow(/orphan objects/);
  expect(() => assertFilesReconciled(reconciliation, [])).not.toThrow(/Musterfrau/);
  expect(() =>
    assertFilesReconciled({ missingDocumentIds: [], orphanObjectIds: [] }, [
      `${organizationId}/${documentId}`,
    ]),
  ).toThrow('orphan objects none instead of');
});

test('the representative organization holds every kind of file link the restore must keep', () => {
  const organization = planRepresentativeOrganization();
  const documentIds = new Set(organization.objects.map((object) => object.documentId));
  const historical = organization.objects.length - documentIds.size;
  expect(historical).toBeGreaterThanOrEqual(5);
  expect(new Set(organization.objects.map((object) => object.path)).size).toBe(organization.objects.length);
  expect(organization.protectedDocumentIds).toHaveLength(2);
  expect(organization.jobDocumentIds.length).toBeGreaterThanOrEqual(6);
  for (const object of organization.objects) {
    expect(object.path.startsWith(`${object.path.split('/')[0]}/${object.documentId}/`)).toBe(true);
  }
  expect(
    organization.objects.some((object) => object.path.startsWith(`${organization.foreignOrganizationId}/`)),
  ).toBe(true);
  const statement = (name: string): number => organization.seedSql.split(`public.${name}(`).length - 1;
  expect(statement('file_document')).toBeGreaterThanOrEqual(5);
  expect(statement('finalize_document_version_upload')).toBe(historical);
  expect(statement('finalize_personnel_document_metadata')).toBeGreaterThanOrEqual(10);
  expect(statement('trash_document')).toBe(1);
  expect(statement('copy_document')).toBe(1);
  const assignments =
    organization.seedSql.split('insert into public.job_assignments')[1]?.split(';')[0] ?? '';
  expect(assignments).toContain(organization.readers.assignedEmployee);
  expect(assignments).not.toContain(organization.readers.unassignedEmployee);
});

test('restored document paths parse only from the expected JSON shape', () => {
  expect(
    parseDocumentPaths(
      '[{"documentId":"a","path":"o/a/f.pdf","sizeBytes":3},{"documentId":"b","path":"o/b/f.pdf","sizeBytes":null}]',
    ),
  ).toHaveLength(2);
  expect(() => parseDocumentPaths('[{"documentId":"a","path":"o/a/f.pdf"}]')).toThrow();
  expect(() => parseDocumentPaths('a|o/a/f.pdf|3')).toThrow();
});

test('a reader whose visible rows change, appear or vanish fails the access comparison', () => {
  const before = parseAccessSnapshot('documents|3:abc\njobs|1:def\n');
  expect(changedAccess(before, parseAccessSnapshot('documents|3:abc\njobs|1:def'))).toEqual([]);
  expect(changedAccess(before, parseAccessSnapshot('documents|4:abd\njobs|1:def'))).toEqual(['documents']);
  expect(changedAccess(before, parseAccessSnapshot('documents|3:abc'))).toEqual(['jobs']);
  expect(changedAccess(before, parseAccessSnapshot('documents|3:abc\njobs|1:def\nnotes|1:x'))).toEqual([
    'notes',
  ]);
  expect(() => parseAccessSnapshot('documents|3:abc\ndocuments|3:abc')).toThrow();
  expect(() => parseAccessSnapshot('documents')).toThrow();
});

test('two dumps of one schema match despite their random restrict keys, and any other change differs', () => {
  const dump = (key: string, body: string) =>
    `\\restrict ${key}\nCREATE TABLE public.documents ();\n${body}\\unrestrict ${key}\n`;
  expect(dumpDigest(dump('a1', ''))).toBe(dumpDigest(dump('b2', '')));
  expect(dumpDigest(dump('a1', ''))).not.toBe(dumpDigest(dump('a1', 'CREATE TABLE public.extra ();\n')));
});
