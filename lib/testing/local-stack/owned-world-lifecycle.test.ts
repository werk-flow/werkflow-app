import { expect, test } from 'bun:test';
import {
  completedWorldCleanup,
  finishOwnedWorldCleanup,
  retainUnreadableOwnedWorld,
} from './owned-world-lifecycle';

test('an unreadable world remains retained after green tests and cannot reach the sweep', () => {
  const failure = new Error('World JSON corrupted after the last passing test');
  const events: string[] = [];
  expect(() => {
    retainUnreadableOwnedWorld(
      { runId: 'green-run', organizationIds: ['owned', 'other'], userIds: ['owner'] },
      failure,
      {
        retain: () => {
          events.push('failed_retained');
        },
        archive: () => {
          events.push('archive');
        },
      },
    );
    events.push('sweep');
  }).toThrow(failure);
  expect(events).toEqual(['failed_retained', 'archive']);
});

test('failed owned cleanup retains evidence without recording success', async () => {
  const events: string[] = [];
  const failure = new Error('Partial cleanup');
  await expect(
    finishOwnedWorldCleanup({
      destroy: async () => {
        events.push('destroy');
        throw failure;
      },
      recordCleaned: () => {
        events.push('cleaned');
      },
      retain: () => {
        events.push('retained');
      },
      archive: () => {
        events.push('archive');
      },
    }),
  ).rejects.toBe(failure);
  expect(events).toEqual(['destroy', 'retained', 'archive']);
});

test('archive failure preserves ownership and the cleanup error without sweeping', async () => {
  const cleanupFailure = new Error('Partial cleanup');
  const archiveFailure = new Error('Archive unavailable');
  let retained = false;
  const result = await finishOwnedWorldCleanup({
    destroy: async () => {
      throw cleanupFailure;
    },
    recordCleaned: () => {},
    retain: () => {
      retained = true;
    },
    archive: () => {
      throw archiveFailure;
    },
  }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(retained).toBe(true);
  expect(result).toBeInstanceOf(AggregateError);
  expect((result as AggregateError).errors).toEqual([cleanupFailure, archiveFailure]);
});

test('a failed cleanup journal stops before sweeping and does not claim a retained live world', async () => {
  const events: string[] = [];
  await expect(
    finishOwnedWorldCleanup({
      destroy: async () => {
        events.push('destroy');
      },
      recordCleaned: () => {
        events.push('journal');
        throw new Error('Journal unavailable');
      },
      retain: () => {
        events.push('retained');
      },
      archive: () => {
        events.push('archive');
      },
    }),
  ).rejects.toThrow('Ownership remains uncertain');
  expect(events).toEqual(['destroy', 'journal']);
});

test('successful owned cleanup records completion and returns without other cleanup', async () => {
  const events: string[] = [];
  await finishOwnedWorldCleanup({
    destroy: async () => {
      events.push('destroy');
    },
    recordCleaned: () => {
      events.push('cleaned');
    },
    retain: () => {
      events.push('retained');
    },
    archive: () => {
      events.push('archive');
    },
  });
  expect(events).toEqual(['destroy', 'cleaned']);
});

test('Golden and canary cleanup closes retention even without an audit group', () => {
  const timestamp = '2026-09-05T18:00:00.000Z';
  const patch = completedWorldCleanup(
    { runId: 'golden-run', orgId: 'owned', outsider: { orgId: 'outsider' } },
    {},
    timestamp,
  );
  expect(patch).toEqual({ cleanedAt: timestamp, retainedAt: null });
});

test('audit cleanup records the final group without losing earlier cleanup history', () => {
  const previous = {
    group: 'first.spec.ts',
    runId: 'first',
    organizationIds: ['first', 'other'],
    cleanedAt: '2026-09-05T17:00:00.000Z',
  };
  const timestamp = '2026-09-05T18:00:00.000Z';
  const patch = completedWorldCleanup(
    { runId: 'last', orgId: 'last-org', outsider: { orgId: 'last-other' }, auditGroup: 'last.spec.ts' },
    { completedAuditGroups: [previous] },
    timestamp,
  );
  expect(patch.cleanedAt).toBe(timestamp);
  expect(patch.retainedAt).toBeNull();
  expect(patch.completedAuditGroups).toEqual([
    previous,
    {
      group: 'last.spec.ts',
      runId: 'last',
      organizationIds: ['last-org', 'last-other'],
      cleanedAt: timestamp,
    },
  ]);
});
