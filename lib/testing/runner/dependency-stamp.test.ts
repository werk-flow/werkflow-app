// Rule test: a check refuses node_modules installed from another bun.lock, names the install command, and passes once the install stamped the current lockfile.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { dependencyStampProblem, writeDependencyStamp } from './dependency-stamp';

const INSTALL = '`bun install --frozen-lockfile`';

function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-dependency-stamp-'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'bun.lock'), '{ "lockfileVersion": 1, "packages": {} }\n');
  return root;
}

test('a lockfile that changed after the install stops the check with the command, and the install clears it', () => {
  const root = checkout();
  try {
    writeDependencyStamp(root);
    expect(dependencyStampProblem(root)).toBeUndefined();
    // A merge of main brings a lockfile with a dependency this node_modules lacks.
    writeFileSync(join(root, 'bun.lock'), '{ "lockfileVersion": 1, "packages": { "fake-indexeddb": [] } }\n');
    expect(dependencyStampProblem(root)).toContain(INSTALL);
    writeDependencyStamp(root);
    expect(dependencyStampProblem(root)).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('node_modules without a stamp stops the check with the command', () => {
  const root = checkout();
  try {
    expect(dependencyStampProblem(root)).toContain('no install stamp');
    expect(dependencyStampProblem(root)).toContain(INSTALL);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every install stamps, and the checks load the stamp test before any package', () => {
  const scripts = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(resolve(import.meta.dir, '../../../package.json'), 'utf8'))).scripts;
  expect(scripts.postinstall).toBe('bun scripts/stamp-dependencies.ts');
  for (const name of ['check:changed', 'test:verify', 'test:plan'])
    expect(scripts[name], name).toStartWith('bun --preload ./scripts/require-installed-dependencies.ts ');
  const preload = readFileSync(
    resolve(import.meta.dir, '../../../scripts/require-installed-dependencies.ts'),
    'utf8',
  );
  const stamp = readFileSync(resolve(import.meta.dir, 'dependency-stamp.ts'), 'utf8');
  // A package import would fail to resolve before the stamp test runs, which is the case it exists for.
  for (const source of [preload, stamp])
    for (const [, specifier] of source.matchAll(/from '([^']+)'/g))
      expect(specifier?.startsWith('node:') || specifier?.startsWith('.')).toBe(true);
});
