import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { addOwnedTestEmail, ownedTestEmails, preserveOwnedTestEmails } from './test-email-ownership';
import { browserRunPaths } from './run-paths';
import { planTestWorld } from './seed-world-plan';
import { loadWorld, registerTestUserEmail, saveWorld } from '../../tests/golden/support/world';

describe('exact signup email ownership', () => {
  test('records the email before its caller can submit a signup and deduplicates repeated mints', () => {
    const first = addOwnedTestEmail({ world: { runId: 'owner123' }, requestedRunId: 'owner123', label: 'a1-signup' });
    expect(first.world.additionalUserEmails).toEqual([first.email]);
    expect(addOwnedTestEmail({ world: first.world, requestedRunId: 'owner123', label: 'a1-signup' }).world.additionalUserEmails)
      .toEqual([first.email]);
  });

  test('rejects a foreign run, unsafe label, or archived foreign email before lookup', () => {
    expect(() => addOwnedTestEmail({ world: { runId: 'owner123' }, requestedRunId: 'other123', label: 'a1-signup' })).toThrow('another test world');
    expect(() => addOwnedTestEmail({ world: { runId: 'owner123' }, requestedRunId: 'owner123', label: 'other@example.com' })).toThrow('Invalid test email label');
    expect(() => ownedTestEmails({ runId: 'owner123', additionalUserEmails: ['a1-signup-other123@werkflow-golden.test'] })).toThrow('does not belong');
    expect(() => ownedTestEmails({ runId: 'owner123', additionalUserEmails: ['real@example.com'] })).toThrow('does not belong');
  });

  test('a stale world save preserves email ownership without importing another world', () => {
    const original = { runId: 'owner123', seedStatus: 'ready' };
    const minted = addOwnedTestEmail({ world: original, requestedRunId: original.runId, label: 'a1-signup' });
    expect(preserveOwnedTestEmails(original, minted.world).additionalUserEmails).toEqual([minted.email]);
    expect(() => preserveOwnedTestEmails(original, { runId: 'other123' })).toThrow('different owned world');
    expect(ownedTestEmails(original)).toEqual([]);
  });

  test('the disk journal and recovery copy own the exact email before mint returns', () => {
    const previousRunKey = process.env.WERKFLOW_RUN_KEY;
    const runKey = `email-ownership-unit-${randomUUID()}`;
    const paths = browserRunPaths(resolve(import.meta.dir, '../..'), runKey);
    try {
      process.env.WERKFLOW_RUN_KEY = runKey;
      const world = planTestWorld();
      saveWorld(world);
      const email = registerTestUserEmail('a1-signup', world.runId);
      expect(loadWorld().additionalUserEmails).toEqual([email]);
      expect(readFileSync(resolve(paths.archivedState, 'world.json'), 'utf8')).toContain(email);
      saveWorld(world);
      expect(loadWorld().additionalUserEmails).toEqual([email]);
      expect(() => registerTestUserEmail('a1-signup', 'foreign')).toThrow('another test world');
      expect(loadWorld().additionalUserEmails).toEqual([email]);
    } finally {
      if (previousRunKey === undefined) delete process.env.WERKFLOW_RUN_KEY;
      else process.env.WERKFLOW_RUN_KEY = previousRunKey;
      rmSync(paths.directory, { recursive: true, force: true });
    }
  });
});
