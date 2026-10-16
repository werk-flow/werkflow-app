import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for the business-date rule (AGENTS.md "4. Code quality and
// maintainability"). "Today" for a business decision (valid-from defaults,
// sickness and vacation ranges, closure days) is the Berlin business date from
// getBusinessTodayIso (lib/date-time/berlin.ts). The browser's or runtime's
// local date drifts from it around midnight for anyone outside Berlin or on a
// UTC server; ten component sites used it until 2026-10-01. A formatter that
// renders "now" (`Intl…format(new Date())`, `new Date().toLocaleDateString()`)
// is the same local today in another spelling.

const LOCAL_TODAY =
  /toLocalDateString\([^()]*new Date\(\)\)|new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)|\.toDateString\(\)|\.format\(new Date\(\)\)|new Date\(\)\.toLocale(?:Date)?String\(/;

// Sites where the local date is the intended meaning, with the reason.
const ALLOWED_LOCAL_TODAY: Readonly<Record<string, string>> = {
  'components/ui/date-time-field.tsx':
    'A picker default: typing a time before a date anchors it to the day the user sees; no business rule reads it before the user confirms.',
};

/**
 * Only a file that names one of these date calls can match LOCAL_TODAY.
 * Git finds those in the working tree, untracked files included, so the test
 * reads a few dozen files instead of every product source.
 */
function filesNamingDateCalls(): Set<string> {
  const search = Bun.spawnSync(
    [
      'git',
      'grep',
      '--untracked',
      '-l',
      '-F',
      '-e',
      'toLocalDateString',
      '-e',
      'toISOString',
      '-e',
      'toDateString',
      '-e',
      '.format(new Date())',
      '-e',
      'new Date().toLocale',
      '--',
      'app',
      'components',
      'hooks',
      'lib',
      'proxy.ts',
    ],
    { cwd: repositoryRoot },
  );
  // Exit code 1 means no match; anything else is a failed search, never an empty result.
  if (search.exitCode !== 0 && search.exitCode !== 1)
    throw new Error(`git grep failed: ${search.stderr.toString()}`);
  return new Set(search.stdout.toString().split(/\r?\n/).filter(Boolean));
}

test('the local-today pattern catches every spelling and spares the Berlin helpers', () => {
  for (const planted of [
    'const today = toLocalDateString(new Date());',
    'const today = new Date().toISOString().slice(0, 10);',
    'const today = new Date().toDateString();',
    "const today = new Intl.DateTimeFormat('sv-SE').format(new Date());",
    "const today = new Date().toLocaleDateString('de-DE');",
    "const label = new Date().toLocaleString('de-DE', { day: '2-digit' });",
  ]) {
    expect(LOCAL_TODAY.test(planted), planted).toBe(true);
  }
  for (const clean of [
    'const today = getBusinessTodayIso();',
    'const day = formatBerlinLocalDate(new Date());',
    "const label = formatBerlin(new Date(value), 'date');",
    'const value = toLocalDateString(picked);',
  ]) {
    expect(LOCAL_TODAY.test(clean), clean).toBe(false);
  }
});

test('business decisions read the Berlin business date, not the local date', () => {
  const candidates = filesNamingDateCalls();
  const offenders = listProductSources()
    .concat('proxy.ts')
    .filter((file) => candidates.has(file))
    .filter((file) => LOCAL_TODAY.test(readFileSync(resolve(repositoryRoot, file), 'utf8')));
  expect(
    offenders.filter((file) => !(file in ALLOWED_LOCAL_TODAY)),
    'Use getBusinessTodayIso() from lib/date-time/berlin.ts, or add the file to ALLOWED_LOCAL_TODAY with the reason the local date is meant.',
  ).toEqual([]);
  expect(
    Object.keys(ALLOWED_LOCAL_TODAY).filter((file) => !offenders.includes(file)),
    'These allowlisted files no longer read the local date; remove them from ALLOWED_LOCAL_TODAY.',
  ).toEqual([]);
});
