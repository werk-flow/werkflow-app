// Rule test: Zeitkonto, Perioden and the payroll export never apply the
// automatic break rule. They count recorded time only, so a change of the rule
// (or a new step) can never move a prepared or closed period or an export.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repository = join(import.meta.dir, '..', '..');
const BREAK_RULE =
  /auto_?break|break_?mode|break_?policy|getCachedOrganizationSettings|time-tracking\/settings/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => join(directory, file));
}

test('no time-account module reads the break rule', () => {
  const readers = sourceFiles(join(repository, 'lib', 'time-accounts')).filter((file) =>
    BREAK_RULE.test(readFileSync(file, 'utf8')),
  );
  expect(readers).toEqual([]);
});

test('no database function of time accounts, periods or payroll exports reads the break rule', () => {
  const migrations = join(repository, 'supabase', 'migrations');
  const readers: string[] = [];
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(join(migrations, file), 'utf8');
    for (const match of sql.matchAll(
      /create (?:or replace )?function\s+([\w."]+)[\s\S]*?(\$[a-z_]*\$)([\s\S]*?)\2/gi,
    )) {
      const [, name, , body = ''] = match;
      if (/time_account|payroll_export/i.test(body) && BREAK_RULE.test(body))
        readers.push(`${file}: ${name}`);
    }
  }
  expect(readers).toEqual([]);
});
