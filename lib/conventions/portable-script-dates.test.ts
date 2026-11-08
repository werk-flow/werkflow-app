// Rule test: a .github/scripts shell script calls `date` only with options macOS's BSD date knows.
import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from './product-sources';

// Tier 2 for portable script dates (werk-flow/werkflow-planning#303). Unit tests run these
// scripts on every developer's Mac, where BSD date refuses GNU's `--utc`, `--date` and `-d`:
// ci-queue.sh failed its test there, and release-smoke.sh sent an empty time window that no
// test noticed. A script calls `date`, `date +FORMAT` or `date -u +FORMAT`, and computes any
// other instant with jq (`now - 7 * 86400 | strftime("%Y-%m-%dT%H:%M:%SZ")`). A script that
// only a Linux runner runs is listed below with its reason.
const SCRIPTS = join(repositoryRoot, '.github/scripts');
const PORTABLE_OPTIONS = new Set(['-u']);

const LINUX_RUNNER_ONLY: Readonly<Record<string, string>> = {
  'shift-clock.sh': 'Sets the runner clock with `sudo date --set`; its unit test stubs date.',
};

// `date` as a command, after a line start, whitespace, `(`, `;`, `|`, `&` or a backtick, with
// the options that follow it up to the first word that is no option.
const DATE_CALL = /(?:^|[\s(;|&`])date((?:\s+-[^\s)"'`;|&]*)*)(?=[\s)"'`;|&]|$)/g;

/** The script's commands with each `\\` line continuation joined, numbered by their first line. */
function logicalLines(script: string): { number: number; text: string }[] {
  const lines: { number: number; text: string }[] = [];
  let pending: { number: number; text: string } | undefined;
  for (const [index, line] of script.split('\n').entries()) {
    const current = pending
      ? { number: pending.number, text: `${pending.text} ${line}` }
      : { number: index + 1, text: line };
    if (current.text.endsWith('\\')) pending = { number: current.number, text: current.text.slice(0, -1) };
    else {
      lines.push(current);
      pending = undefined;
    }
  }
  if (pending) lines.push(pending);
  return lines;
}

/** Each `<line>: date <option name>` that BSD date may not know, outside comments. */
function gnuOnlyDateOptions(script: string): string[] {
  return logicalLines(script).flatMap(({ number, text: line }) => {
    if (line.trimStart().startsWith('#')) return [];
    return [...line.matchAll(DATE_CALL)].flatMap(([, options = '']) =>
      options
        .trim()
        .split(/\s+/)
        .map((option) => option.split('=')[0] ?? option)
        .filter((option) => option !== '' && !PORTABLE_OPTIONS.has(option))
        .map((option) => `${number}: date ${option}`),
    );
  });
}

function scriptFindings(): Record<string, string[]> {
  const scripts = readdirSync(SCRIPTS).filter((name) => name.endsWith('.sh'));
  return Object.fromEntries(
    scripts.map((name) => [name, gnuOnlyDateOptions(readFileSync(join(SCRIPTS, name), 'utf8'))]),
  );
}

test('the scan names GNU-only date options and passes portable calls', () => {
  expect(
    gnuOnlyDateOptions(
      [
        `since="$(date --utc --date '7 days ago' +%Y-%m-%dT%H:%M:%SZ)"`,
        `  --arg start "$(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:00Z)" --arg end "$(date -u +%H)"`,
        'sudo date --utc --set="@${target}" > /dev/null',
        'now="$(date +%s)"; stamp=`date -u`',
        '# date --date is GNU-only',
        'echo "update --all"',
        'start="$(date -u \\',
        "  -d '15 minutes ago' +%H)\"",
      ].join('\n'),
    ),
  ).toEqual([
    '1: date --utc',
    '1: date --date',
    '2: date -d',
    '3: date --utc',
    '3: date --set',
    '7: date -d',
  ]);
});

test('every .github/scripts shell script calls date with options macOS knows too', () => {
  const findings = Object.entries(scriptFindings()).filter(
    ([name, options]) => options.length > 0 && !(name in LINUX_RUNNER_ONLY),
  );
  expect(Object.fromEntries(findings)).toEqual({});
});

test('every Linux-runner-only script still needs its place on the list', () => {
  const findings = scriptFindings();
  const stale = Object.keys(LINUX_RUNNER_ONLY).filter((name) => (findings[name] ?? []).length === 0);
  expect(stale).toEqual([]);
});
