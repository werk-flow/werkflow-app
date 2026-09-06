import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoRetainedManifests, mirrorOwnedStateFiles, readRetainedWorldState, validateRetainedWorldIdentity } from './archive-state';

describe('retained state archive ownership', () => {
  test('missing archived state still blocks certification and cleanup protection', () => {
    const root = mkdtempSync(join(tmpdir(), 'werkflow-archive-'));
    const retained = { runKey: 'interrupted-copy', retainedAt: '2026-09-05T18:00:00Z', cleanedAt: null };
    try {
      expect(() => assertNoRetainedManifests([retained], () => false)).toThrow('1 open retained manifest');
      expect(() => assertNoRetainedManifests([retained], () => false)).toThrow('Missing archived world.json for interrupted-copy');
      expect(() => readRetainedWorldState({ ...retained, world: { runId: 'owned', organizationIds: ['primary', 'other'], userIds: [] } }, join(root, 'missing.json'))).toThrow('Refusing to omit its owned resources');
      expect(() => assertNoRetainedManifests([{ ...retained, cleanedAt: '2026-09-05T19:00:00Z' }], () => false)).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
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
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('rejects an archive from a different or already-retired world', () => {
    const world = { runId: 'new-world', orgId: 'primary', outsider: { orgId: 'outsider' } };
    expect(() => validateRetainedWorldIdentity({ runId: 'new-world', organizationIds: ['primary', 'outsider'] }, world)).not.toThrow();
    expect(() => validateRetainedWorldIdentity(null, world)).toThrow('do not match');
    expect(() => validateRetainedWorldIdentity({ runId: 'old-world', organizationIds: ['primary', 'outsider'] }, world)).toThrow('do not match');
    expect(() => validateRetainedWorldIdentity({ runId: 'new-world', organizationIds: ['unrelated', 'outsider'] }, world)).toThrow('do not match');
  });
});
