import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QUARANTINE_COMMENT } from '../../eslint-rules/test-hygiene-rules.mjs';

/** A skipped test and the planning issue that brings it back (test-hygiene/no-excluded-test). */
export type Quarantine = { file: string; line: number; issue: number; reason: string };

/** The files where test-hygiene/no-excluded-test lets a test be skipped under a quarantine comment. */
const TEST_SOURCE = /^(?:lib\/.+\.test\.(?:ts|tsx|mjs)|tests\/.+\.(?:ts|tsx))$/;

/** Every quarantine comment of one source file. */
export function quarantinesIn(file: string, text: string): Quarantine[] {
  return text.split('\n').flatMap((content, index) => {
    const comment = /\/\/(.*)$/.exec(content)?.[1];
    const match = comment === undefined ? null : QUARANTINE_COMMENT.exec(comment);
    if (!match?.[1] || !match[2]) return [];
    return [{ file, line: index + 1, issue: Number(match[1]), reason: match[2].trim() }];
  });
}

/** Every quarantined test of the checkout, in file order. */
export function listQuarantines(repositoryRoot: string): Quarantine[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', 'lib', 'tests'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return listed
    .split('\0')
    .filter((file) => TEST_SOURCE.test(file))
    .sort()
    .flatMap((file) => quarantinesIn(file, readFileSync(resolve(repositoryRoot, file), 'utf8')));
}

/** The quarantine list as Markdown, for the nightly run's summary. */
export function formatQuarantines(quarantines: readonly Quarantine[]): string {
  if (!quarantines.length) return '## Quarantined tests\n\nNo test is quarantined.\n';
  const rows = quarantines.map(
    ({ file, line, issue, reason }) =>
      `| \`${file}:${line}\` | werk-flow/werkflow-planning#${issue} | ${reason.replaceAll('|', '\\|')} |`,
  );
  return ['## Quarantined tests', '', '| Test | Issue | Why |', '| --- | --- | --- |', ...rows, ''].join(
    '\n',
  );
}
