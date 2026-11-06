import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { resolve } from 'node:path';
const repositoryRoot = resolve(import.meta.dir, '../..');
import { dependencyDigest, inspectDependencyAudit } from '../testing/publication/dependency-audit';
import { z } from '@/lib/zod';

const advisory = 'https://github.com/advisories/GHSA-1234-5678-abcd';
const manifest = '{"dependencies":{"tool":"1.2.3"}}';
const lockfile = '{"lockfileVersion":1,"packages":{"tool":["tool@1.2.3"]}}';
const exception = {
  package: 'tool',
  version: '1.2.3',
  advisory,
  severity: 'high',
  paths: ['tool'],
  reviewedOn: '2026-09-07',
  expiresOn: '2026-10-07',
  rationale: 'Reviewed exact fixture installation with no request input.',
  evidence: ['fixture'],
};
const policy = {
  version: 1,
  dependencyDigest: dependencyDigest(manifest, lockfile),
  exceptions: [exception],
};
const audit = { tool: [{ url: advisory, severity: 'high', vulnerable_versions: '<1.2.4' }] };
const input = { stdout: JSON.stringify(audit), exitCode: 1, manifest, lockfile, policy, today: '2026-09-07' };
// The exception fields the checked-in policy checks below read; inspectDependencyAudit
// owns the full policy schema.
const reviewedPolicySchema = z.object({
  exceptions: z.array(
    z.object({
      package: z.string(),
      advisory: z.string(),
      reviewedOn: z.string(),
      expiresOn: z.string(),
      rationale: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
});

test('accepts clean audit and narrowly reviewed exact findings', () => {
  const clean = { ...input, stdout: '{}', exitCode: 0, policy: { ...policy, exceptions: [] } };
  expect(inspectDependencyAudit(clean)).toEqual({ passed: true, findings: [], problems: [], notes: [] });
  expect(inspectDependencyAudit(input).findings[0]?.disposition).toBe('reviewed-exception');
  expect(
    inspectDependencyAudit({ ...input, policy: { ...policy, exceptions: [] } }).findings[0]?.disposition,
  ).toBe('blocked');
});

test('a new unreviewed finding fails, and a note on another exception cannot pass it', () => {
  const unreviewed = inspectDependencyAudit({ ...input, policy: { ...policy, exceptions: [] } });
  expect(unreviewed.passed).toBe(false);
  expect(unreviewed.findings[0]?.disposition).toBe('blocked');
  // The reviewed advisory went away and a new one arrived on the same installed package.
  const replaced = inspectDependencyAudit({
    ...input,
    stdout: JSON.stringify({ tool: [{ ...audit.tool[0], url: advisory.replace('abcd', 'dcba') }] }),
  });
  expect(replaced.passed).toBe(false);
  expect(replaced.findings[0]?.disposition).toBe('blocked');
  expect(replaced.notes).toHaveLength(1);
});

test('an exception a changed path, severity or version outgrew fails as a review, never a note', () => {
  for (const changed of [{ severity: 'moderate' }, { paths: ['nested/tool'] }, { version: '1.2.2' }]) {
    const result = inspectDependencyAudit({
      ...input,
      policy: { ...policy, exceptions: [{ ...exception, ...changed }] },
    });
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.disposition).toBe('blocked');
    expect(result.problems).toHaveLength(1);
    expect(result.notes).toEqual([]);
  }
});

test('a stale dependency digest fails, also when the tree change removed every finding', () => {
  const changed = inspectDependencyAudit({ ...input, manifest: '{"dependencies":{"tool":"^1.2.3"}}' });
  expect(changed.passed).toBe(false);
  expect(changed.findings[0]?.disposition).toBe('blocked');
  expect(changed.problems).toHaveLength(1);
  // Good news from this repository's own diff is still a tree nobody reviewed against the exceptions.
  const upgraded = inspectDependencyAudit({
    ...input,
    stdout: '{}',
    exitCode: 0,
    lockfile: lockfile.replaceAll('1.2.3', '1.2.4'),
  });
  expect(upgraded.passed).toBe(false);
  expect(upgraded.problems).toEqual([
    'Dependency declarations or lockfile changed; review exceptions against the new dependency tree.',
  ]);
});

test('a withdrawn advisory leaves a cleanup note and the check passes', () => {
  const withdrawn = inspectDependencyAudit({ ...input, stdout: '{}', exitCode: 0 });
  expect(withdrawn).toEqual({
    passed: true,
    findings: [],
    problems: [],
    notes: [
      `Exception tool@1.2.3 (${advisory}) matches no current finding; remove it from lib/security/dependency-exceptions.json. After 2026-10-07 it fails this check.`,
    ],
  });
  expect(inspectDependencyAudit(input).notes).toEqual([]);
});

test('the advisory narrowing of 2026-11-05 passes with a note on the same commit', () => {
  const url = 'https://github.com/advisories/GHSA-g3hv-75wg-m249';
  const estree = '@typescript-eslint/typescript-estree/minimatch';
  const lock = JSON.stringify({
    lockfileVersion: 1,
    packages: { minimatch: ['minimatch@3.1.5'], [estree]: ['minimatch@9.0.9'] },
  });
  const reviewed = { ...exception, package: 'minimatch', advisory: url, severity: 'moderate' };
  const day = {
    ...input,
    lockfile: lock,
    today: '2026-11-05',
    policy: {
      ...policy,
      dependencyDigest: dependencyDigest(manifest, lock),
      exceptions: [
        { ...reviewed, version: '3.1.5', paths: ['minimatch'], expiresOn: '2026-11-30' },
        { ...reviewed, version: '9.0.9', paths: [estree], expiresOn: '2026-11-30' },
      ],
    },
  };
  const range = (vulnerable_versions: string): string =>
    JSON.stringify({ minimatch: [{ url, severity: 'moderate', vulnerable_versions }] });

  const before = inspectDependencyAudit({ ...day, stdout: range('<11.0.1') });
  expect(before.passed).toBe(true);
  expect(before.notes).toEqual([]);

  const after = inspectDependencyAudit({ ...day, stdout: range('>=7.0.0 <11.0.1') });
  expect(after.passed).toBe(true);
  expect(after.problems).toEqual([]);
  expect(after.notes).toEqual([
    `Exception minimatch@3.1.5 (${url}) matches no current finding; remove it from lib/security/dependency-exceptions.json. After 2026-11-30 it fails this check.`,
  ]);
  expect(after.findings.map((finding) => [finding.version, finding.disposition])).toEqual([
    ['9.0.9', 'reviewed-exception'],
  ]);
});

test('a review window that is closed fails, whether or not the exception still matches', () => {
  const inverted = { ...exception, reviewedOn: '2026-09-07', expiresOn: '2026-09-06' };
  for (const today of ['2026-09-06', '2026-10-08']) {
    const matching = inspectDependencyAudit({ ...input, today });
    expect(matching.passed).toBe(false);
    expect(matching.findings[0]?.disposition).toBe('blocked');
    expect(matching.problems).toHaveLength(1);
    // A cleanup note must not outlive its review: the old "matches nothing" failure covered this case.
    const unmatched = inspectDependencyAudit({ ...input, today, stdout: '{}', exitCode: 0 });
    expect(unmatched.passed).toBe(false);
    expect(unmatched.problems).toHaveLength(1);
    expect(unmatched.notes).toEqual([]);
  }
  const reversed = inspectDependencyAudit({
    ...input,
    stdout: '{}',
    exitCode: 0,
    policy: { ...policy, exceptions: [inverted] },
  });
  expect(reversed.passed).toBe(false);
});

test('an invalid exception date stops the check, whether or not the exception still matches', () => {
  for (const date of [{ expiresOn: '2026-13-01' }, { reviewedOn: 'soon' }]) {
    const invalid = { ...policy, exceptions: [{ ...exception, ...date }] };
    expect(() => inspectDependencyAudit({ ...input, policy: invalid })).toThrow();
    expect(() => inspectDependencyAudit({ ...input, stdout: '{}', exitCode: 0, policy: invalid })).toThrow();
  }
});

test('network failures, invalid JSON, mismatched lockfiles and inconsistent exit codes cannot become green', () => {
  for (const changed of [
    { exitCode: 2 },
    { stdout: 'upstream unavailable' },
    { stdout: '{}' },
    { exitCode: 0 },
    { lockfile: '{}' },
    { stdout: JSON.stringify({ absent: audit.tool }) },
    { stdout: JSON.stringify({ tool: [{ ...audit.tool[0], vulnerable_versions: '>2' }] }) },
  ]) {
    expect(() => inspectDependencyAudit({ ...input, ...changed })).toThrow();
  }
  // A crashed audit is named as such, even when it left unparseable output.
  expect(() => inspectDependencyAudit({ ...input, exitCode: 2, stdout: 'upstream unavailable' })).toThrow(
    'Inconsistent audit completion',
  );
});

test('duplicate advisory ranges yield one finding per affected installed path', () => {
  expect(
    inspectDependencyAudit({ ...input, stdout: JSON.stringify({ tool: [audit.tool[0], audit.tool[0]] }) })
      .findings,
  ).toHaveLength(1);
});

test('checked-in exceptions remain narrow, explained and short lived', () => {
  const reviewed = reviewedPolicySchema.parse(
    JSON.parse(readFileSync(resolve(repositoryRoot, 'lib/security/dependency-exceptions.json'), 'utf8')),
  );
  for (const item of reviewed.exceptions) {
    expect(item.rationale.length).toBeGreaterThan(30);
    expect(item.evidence).toContain(item.advisory);
    expect(Date.parse(item.expiresOn) - Date.parse(item.reviewedOn)).toBeLessThanOrEqual(31 * 86400000);
    expect(item.package).not.toBe('ws');
  }
});

test('reviewed vulnerable glob and YAML toolchains cannot be imported into application source', () => {
  const reviewed = reviewedPolicySchema.parse(
    JSON.parse(readFileSync(resolve(repositoryRoot, 'lib/security/dependency-exceptions.json'), 'utf8')),
  );
  const reviewedPackages = new Set(reviewed.exceptions.map((item) => item.package));
  const toolchain =
    /^(?:brace-expansion|js-yaml|minimatch|picomatch|micromatch|tinyglobby|eslint|eslint-config-next|eslint-plugin-[^/]+|@eslint\/[^/]+|@typescript-eslint\/[^/]+)(?:\/|$)/;
  const isTooling = (specifier: string): boolean => {
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
    return reviewedPackages.has(name) || toolchain.test(specifier);
  };
  const violations: string[] = [];
  for (const directory of ['app', 'components', 'hooks', 'lib', 'supabase/functions']) {
    for (const file of readdirSync(resolve(repositoryRoot, directory), {
      recursive: true,
      encoding: 'utf8',
    })) {
      const path = `${directory}/${file.replaceAll('\\', '/')}`;
      if (
        !/\.[cm]?[jt]sx?$/.test(path) ||
        /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
        path.startsWith('lib/testing/')
      )
        continue;
      const source = readFileSync(resolve(repositoryRoot, path), 'utf8');
      // Parse only potential package references; the AST still decides whether they are imports.
      if (
        ![...reviewedPackages].some((name) => source.includes(name)) &&
        !/(?:brace-expansion|js-yaml|minimatch|picomatch|micromatch|tinyglobby|eslint|@typescript-eslint)/.test(
          source,
        )
      )
        continue;
      const imported = ts.preProcessFile(source, true, true).importedFiles;
      if (imported.some((item) => isTooling(item.fileName))) violations.push(path);
    }
  }
  expect(violations).toEqual([]);
});
