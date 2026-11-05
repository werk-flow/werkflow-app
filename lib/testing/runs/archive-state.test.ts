import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mirrorOwnedStateFiles,
  readRetainedWorldState,
  restoreRetainedWorkloads,
  validateRetainedWorldIdentity,
} from './archive-state';
import { testWorldSchema } from '../../../tests/golden/support/world';

describe('retained state archive ownership', () => {
  test('restores exact workload inputs without inheriting acceptance results or stale workloads', () => {
    const root = mkdtempSync(join(tmpdir(), 'werkflow-retained-workload-'));
    const source = join(root, 'source');
    const target = join(root, 'diagnostic');
    mkdirSync(source);
    try {
      const workload = '{"businessDate":"2026-06-15","counts":{"occurrences":1760}}';
      for (const name of ['performance-workload.json', 'planning-benchmark-workload.json'])
        writeFileSync(join(source, name), workload);
      writeFileSync(join(source, 'latency-summary.json'), '{"passed":true}');
      writeFileSync(join(source, 'manifest.json'), '{"lane":"group"}');
      restoreRetainedWorkloads(source, target);
      for (const name of ['performance-workload.json', 'planning-benchmark-workload.json'])
        expect(readFileSync(join(target, name), 'utf8')).toBe(workload);
      expect(existsSync(join(target, 'latency-summary.json'))).toBe(false);
      expect(existsSync(join(target, 'manifest.json'))).toBe(false);
      rmSync(join(source, 'planning-benchmark-workload.json'));
      restoreRetainedWorkloads(source, target);
      expect(existsSync(join(target, 'planning-benchmark-workload.json'))).toBe(false);
      expect(readFileSync(join(target, 'performance-workload.json'), 'utf8')).toBe(workload);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('missing archived state still blocks cleanup', () => {
    const root = mkdtempSync(join(tmpdir(), 'werkflow-archive-'));
    const retained = { runKey: 'interrupted-copy', retainedAt: '2026-09-05T18:00:00Z', cleanedAt: null };
    try {
      expect(() =>
        readRetainedWorldState(
          { ...retained, world: { runId: 'owned', organizationIds: ['primary', 'other'], userIds: [] } },
          join(root, 'missing.json'),
        ),
      ).toThrow('Refusing to omit its owned resources');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('a retained world older than the current shape keeps its protection and every key', () => {
    const root = mkdtempSync(join(tmpdir(), 'werkflow-archive-'));
    const user = { id: 'user', email: 'user@test', password: 'test', firstName: 'A', lastName: 'B' };
    // The shape of the first harness: no invitees and no inventory.
    const olderWorld = {
      runId: 'owned',
      orgId: 'primary',
      orgName: 'Primary',
      users: { admin: user, buero: user, employee: user },
      outsider: { orgId: 'other', orgName: 'Other', admin: user },
    };
    const path = join(root, 'world.json');
    const retained = { runKey: 'older', retainedAt: '2026-08-04T18:00:00Z', cleanedAt: null };
    try {
      writeFileSync(path, JSON.stringify(olderWorld));
      expect(testWorldSchema.safeParse(olderWorld).success).toBe(false);
      expect(
        readRetainedWorldState(
          { ...retained, world: { runId: 'owned', organizationIds: ['primary', 'other'], userIds: [] } },
          path,
        ),
      ).toEqual(olderWorld);
      expect(() =>
        readRetainedWorldState(
          { ...retained, world: { runId: 'another', organizationIds: ['primary', 'other'], userIds: [] } },
          path,
        ),
      ).toThrow('do not match');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('removes a retired world file instead of leaving prior-group credentials in its archive', () => {
    const root = mkdtempSync(join(tmpdir(), 'werkflow-archive-'));
    const active = join(root, 'active');
    const archive = join(root, 'archive');
    mkdirSync(active);
    try {
      const world = join(active, 'world.json');
      writeFileSync(world, 'old-world');
      mirrorOwnedStateFiles([world], archive);
      expect(readFileSync(join(archive, 'world.json'), 'utf8')).toBe('old-world');
      rmSync(world);
      mirrorOwnedStateFiles([world], archive);
      expect(existsSync(join(archive, 'world.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('rejects an archive from a different or already-retired world', () => {
    const world = { runId: 'new-world', orgId: 'primary', outsider: { orgId: 'outsider' } };
    expect(() =>
      validateRetainedWorldIdentity({ runId: 'new-world', organizationIds: ['primary', 'outsider'] }, world),
    ).not.toThrow();
    expect(() => validateRetainedWorldIdentity(null, world)).toThrow('do not match');
    expect(() =>
      validateRetainedWorldIdentity({ runId: 'old-world', organizationIds: ['primary', 'outsider'] }, world),
    ).toThrow('do not match');
    expect(() =>
      validateRetainedWorldIdentity(
        { runId: 'new-world', organizationIds: ['unrelated', 'outsider'] },
        world,
      ),
    ).toThrow('do not match');
  });
});
