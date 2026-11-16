import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { serviceWorkerScript } from './service-worker-script';

// Rule test: a phone replaces its offline shell only when /sw.js serves other
// bytes. The build writes the shell version, so two builds never share one
// and a rebuild of the same commit keeps it (Tier 1: no hand-bumped number).
const root = join(import.meta.dir, '..', '..');
const BUILD = 'phase-production-build';
const SERVER = 'phase-production-server';
const DEVELOPMENT = 'phase-development-server';

function servedFor(env: Record<string, string>, phase = BUILD): string {
  return serviceWorkerScript(root, phase, env);
}

/** The version a served worker names in its first line. */
function versionOf(script: string): string | undefined {
  return script.match(/^const SHELL_VERSION = "([^"]*)";\n/)?.[1];
}

describe('the shell version comes from the build', () => {
  test('two builds with different build ids serve workers with different versions', () => {
    const first = servedFor({ WERKFLOW_BUILD_ID: '6f1c2a5e-0b7d-4c1e-9a43-2f8d61b0c7aa' });
    const second = servedFor({ WERKFLOW_BUILD_ID: 'd2b94e10-73a8-4f55-8e0c-5a1f37c2e9b4' });
    expect(first).not.toBe(second);
    expect(first).toStartWith('const SHELL_VERSION = "6f1c2a5e-0b7d-4c1e-9a43-2f8d61b0c7aa";\n');
  });

  test('a Vercel build is versioned by its commit, so a rebuild of the same commit serves the same worker', () => {
    const commit = 'a3f9c1e07b2d48f6e1c5a9b0d7e3f2a1c4b6d8e0';
    expect(servedFor({ VERCEL_GIT_COMMIT_SHA: commit })).toBe(servedFor({ VERCEL_GIT_COMMIT_SHA: commit }));
    expect(servedFor({ VERCEL_GIT_COMMIT_SHA: commit })).not.toBe(
      servedFor({ VERCEL_GIT_COMMIT_SHA: 'b4e0d2f18c3e59a7f2d6b0c1e8f4a3b2d5c7e9f1' }),
    );
  });

  test('a local recorded build id wins over a commit', () => {
    expect(versionOf(servedFor({ WERKFLOW_BUILD_ID: 'local-build', VERCEL_GIT_COMMIT_SHA: 'commit' }))).toBe(
      'local-build',
    );
  });

  test('a production build without a build id fails instead of reusing a version', () => {
    expect(() => servedFor({})).toThrow('needs WERKFLOW_BUILD_ID');
    expect(() => servedFor({ WERKFLOW_BUILD_ID: '', VERCEL_GIT_COMMIT_SHA: '' })).toThrow();
  });

  test('outside a production build the version is fixed, so development is deterministic', () => {
    expect(versionOf(servedFor({}, DEVELOPMENT))).toBe('development');
    expect(versionOf(servedFor({}, SERVER))).toBe('development');
  });

  test('a build id that could break the cache name or the script is refused', () => {
    for (const id of ['a"; importScripts("x', 'a/b', 'x'.repeat(65)])
      expect(() => servedFor({ WERKFLOW_BUILD_ID: id })).toThrow('must be 1 to 64');
  });

  test('the version line is the only difference between two builds', () => {
    const [, ...first] = servedFor({ WERKFLOW_BUILD_ID: 'one' }).split('\n');
    const [, ...second] = servedFor({ WERKFLOW_BUILD_ID: 'two' }).split('\n');
    expect(first).toEqual(second);
  });
});
