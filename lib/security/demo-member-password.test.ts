import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveDemoMemberPassword } from './demo-member-password';

test('each seeder run generates its own demo member password', () => {
  const first = resolveDemoMemberPassword('prod', undefined);
  expect(first).toMatch(/^[\w-]{32}$/);
  expect(resolveDemoMemberPassword('prod', '')).not.toBe(first);
  expect(resolveDemoMemberPassword('dev', undefined)).not.toBe(first);
});

test('a chosen demo member password works locally and on DEV and is refused for PROD', () => {
  expect(resolveDemoMemberPassword('local', 'owner-chosen-password')).toBe('owner-chosen-password');
  expect(resolveDemoMemberPassword('dev', 'owner-chosen-password')).toBe('owner-chosen-password');
  expect(() => resolveDemoMemberPassword('prod', 'owner-chosen-password')).toThrow(/generated password/);
});

test('the demo seeder takes its member password from the resolver, never from a literal', () => {
  const seeder = readFileSync(resolve(import.meta.dir, '../../scripts/seed-demo-data.ts'), 'utf8');
  expect(seeder).toContain('resolveDemoMemberPassword(target, process.env[DEMO_MEMBER_PASSWORD_ENV])');
  expect(seeder).not.toMatch(/password\s*[:=]\s*['"`]/i);
  expect(seeder).not.toMatch(/const \w*PASSWORD\w* = ['"`]/);
});
