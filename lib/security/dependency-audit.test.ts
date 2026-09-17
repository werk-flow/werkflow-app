import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { resolve } from 'node:path';
const repositoryRoot = resolve(import.meta.dir, '../..');
import { dependencyDigest, inspectDependencyAudit } from '../testing/dependency-audit';

const advisory = 'https://github.com/advisories/GHSA-1234-5678-abcd';
const manifest = '{"dependencies":{"tool":"1.2.3"}}';
const lockfile = '{"lockfileVersion":1,"packages":{"tool":["tool@1.2.3"]}}';
const exception = { package: 'tool', version: '1.2.3', advisory, severity: 'high', paths: ['tool'],
  reviewedOn: '2026-09-07', expiresOn: '2026-10-07', rationale: 'Reviewed exact fixture installation with no request input.', evidence: ['fixture'] };
const policy = { version: 1, dependencyDigest: dependencyDigest(manifest, lockfile), exceptions: [exception] };
const audit = { tool: [{ url: advisory, severity: 'high', vulnerable_versions: '<1.2.4' }] };
const input = { stdout: JSON.stringify(audit), exitCode: 1, manifest, lockfile, policy, today: '2026-09-07' };

test('accepts clean audit and narrowly reviewed exact findings', () => {
  expect(inspectDependencyAudit({ ...input, stdout: '{}', exitCode: 0 }).findings).toEqual([]);
  expect(inspectDependencyAudit(input).findings[0]?.disposition).toBe('reviewed-exception');
  expect(inspectDependencyAudit({ ...input, policy: { ...policy, exceptions: [] } }).findings[0]?.disposition).toBe('blocked');
});

test('changed advisory, severity, installed path, version or dependency digest cannot inherit review', () => {
  for (const changed of [{ advisory: advisory.replace('abcd', 'dcba') }, { severity: 'moderate' },
    { paths: ['nested/tool'] }, { version: '1.2.2' }]) {
    expect(inspectDependencyAudit({ ...input, policy: { ...policy, exceptions: [{ ...exception, ...changed }] } }).findings[0]?.disposition).toBe('blocked');
  }
  const changed = inspectDependencyAudit({ ...input, manifest: '{"dependencies":{"tool":"^1.2.3"}}' });
  expect(changed.findings[0]?.disposition).toBe('blocked');
  expect(changed.problems).toHaveLength(1);
});

test('expired and future-dated reviews fail closed', () => {
  for (const today of ['2026-09-06', '2026-10-08']) {
    expect(inspectDependencyAudit({ ...input, today }).findings[0]?.disposition).toBe('blocked');
  }
});

test('network failures, invalid JSON, mismatched lockfiles and inconsistent exit codes cannot become green', () => {
  for (const changed of [{ exitCode: 2 }, { stdout: 'upstream unavailable' }, { stdout: '{}' },
    { exitCode: 0 }, { lockfile: '{}' }, { stdout: JSON.stringify({ absent: audit.tool }) },
    { stdout: JSON.stringify({ tool: [{ ...audit.tool[0], vulnerable_versions: '>2' }] }) }]) {
    expect(() => inspectDependencyAudit({ ...input, ...changed })).toThrow();
  }
});

test('duplicate advisory ranges yield one finding per affected installed path', () => {
  expect(inspectDependencyAudit({ ...input, stdout: JSON.stringify({ tool: [audit.tool[0], audit.tool[0]] }) }).findings).toHaveLength(1);
});

test('checked-in exceptions remain narrow, explained and short lived', () => {
  const reviewed = JSON.parse(readFileSync(resolve(repositoryRoot, 'lib/security/dependency-exceptions.json'), 'utf8')) as typeof policy;
  for (const item of reviewed.exceptions) {
    expect(item.rationale.length).toBeGreaterThan(30);
    expect(item.evidence).toContain(item.advisory);
    expect(Date.parse(item.expiresOn) - Date.parse(item.reviewedOn)).toBeLessThanOrEqual(31 * 86400000);
    expect(item.package).not.toBe('ws');
  }
});

test('reviewed vulnerable glob and YAML toolchains cannot be imported into application source', () => {
  const reviewed = JSON.parse(readFileSync(resolve(repositoryRoot, 'lib/security/dependency-exceptions.json'), 'utf8')) as typeof policy;
  const reviewedPackages = new Set(reviewed.exceptions.map(item => item.package));
  const toolchain = /^(?:brace-expansion|js-yaml|minimatch|picomatch|micromatch|tinyglobby|eslint|eslint-config-next|eslint-plugin-[^/]+|@eslint\/[^/]+|@typescript-eslint\/[^/]+)(?:\/|$)/;
  const isTooling = (specifier: string): boolean => {
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier;
    return reviewedPackages.has(name) || toolchain.test(specifier);
  };
  const violations: string[] = [];
  for (const directory of ['app', 'components', 'hooks', 'lib', 'supabase/functions']) {
    for (const file of readdirSync(resolve(repositoryRoot, directory), { recursive: true, encoding: 'utf8' })) {
      const path = `${directory}/${file.replaceAll('\\', '/')}`;
      if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.startsWith('lib/testing/')) continue;
      const source = readFileSync(resolve(repositoryRoot, path), 'utf8');
      // Parse only potential package references; the AST still decides whether they are imports.
      if (![...reviewedPackages].some(name => source.includes(name)) &&
          !/(?:brace-expansion|js-yaml|minimatch|picomatch|micromatch|tinyglobby|eslint|@typescript-eslint)/.test(source)) continue;
      const imported = ts.preProcessFile(source, true, true).importedFiles;
      if (imported.some((item) => isTooling(item.fileName))) violations.push(path);
    }
  }
  expect(violations).toEqual([]);
});
