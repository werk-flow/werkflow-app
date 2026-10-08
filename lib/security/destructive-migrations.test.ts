import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from '../conventions/product-sources';

// Tier 2 for the destructive-statement rule of the migration rule
// (docs/technical/environments.md#the-migration-rule, item 8). A top-level
// statement that removes or reshapes something the deployed build may still
// use (a drop, a truncate, a delete, a dropped column or constraint, a rename,
// a column type change) carries `-- @destructive: <reason>` in the comment
// lines directly above it. Statements inside a function body are the
// function's logic, not migration steps, and are not checked.
//
// Applied migrations are immutable, so committed files cannot gain a marker.
// The rule applies to every migration whose version is greater than
// MARKER_REQUIRED_AFTER, the last migration committed before the rule landed.
// Never raise this constant: a new file is always checked.
const MARKER_REQUIRED_AFTER = '20261006100100';

const DESTRUCTIVE_STATEMENTS: readonly RegExp[] = [
  /^drop\s/,
  /^truncate\b/,
  /^delete\s+from\b/,
  /^alter\s+(table|publication)\b.*\bdrop\s+(column|constraint|table)\b/,
  /^alter\s+(table|view|materialized\s+view|function|procedure|type|sequence|index|schema)\b.*\srename\b/,
  /\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b/,
];

const MARKER = /--\s*@destructive:\s*(\S.{9,})$/m;

type Statement = { line: number; text: string; leadingComments: string };

function endOfQuoted(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "'" && sql[index + 1] === "'") index += 2;
    else if (sql[index] === "'") return index + 1;
    else index += 1;
  }
  return sql.length;
}

/** Top-level statements with their start line and the comments directly above them. */
function topLevelStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let text = '';
  let leadingComments = '';
  let line = 1;
  let startLine = 1;
  let index = 0;
  const skip = (end: number, replacement: string): void => {
    line += (sql.slice(index, end).match(/\n/g) ?? []).length;
    text += replacement;
    index = end;
  };
  while (index < sql.length) {
    const char = sql[index];
    if (char === '-' && sql[index + 1] === '-') {
      const newline = sql.indexOf('\n', index);
      const end = newline < 0 ? sql.length : newline;
      if (!text.trim()) leadingComments += `${sql.slice(index, end)}\n`;
      index = end;
      continue;
    }
    if (char === '/' && sql[index + 1] === '*') {
      const close = sql.indexOf('*/', index + 2);
      skip(close < 0 ? sql.length : close + 2, ' ');
      continue;
    }
    // A dollar-quote tag is empty or an identifier: a letter or underscore, then letters, digits or underscores.
    const dollarTag = char === '$' ? /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index)) : null;
    if (dollarTag) {
      const close = sql.indexOf(dollarTag[0], index + dollarTag[0].length);
      skip(close < 0 ? sql.length : close + dollarTag[0].length, ' $body$ ');
      continue;
    }
    if (char === "'") {
      skip(endOfQuoted(sql, index), " 'text' ");
      continue;
    }
    if (char === ';') {
      if (text.trim()) {
        statements.push({
          line: startLine,
          text: text.trim().replace(/\s+/g, ' ').toLowerCase(),
          leadingComments,
        });
      }
      text = '';
      leadingComments = '';
      index += 1;
      continue;
    }
    if (!text.trim() && /\S/.test(char ?? '')) startLine = line;
    if (char === '\n') line += 1;
    text += char;
    index += 1;
  }
  return statements;
}

/** `line: statement` for every destructive statement without a reasoned marker. */
function unmarkedDestructiveStatements(sql: string): string[] {
  return topLevelStatements(sql)
    .filter((statement) => DESTRUCTIVE_STATEMENTS.some((pattern) => pattern.test(statement.text)))
    .filter((statement) => !MARKER.test(statement.leadingComments))
    .map((statement) => `${statement.line}: ${statement.text.slice(0, 100)}`);
}

describe('destructive migration statements', () => {
  test('every destructive statement in a new migration carries a reasoned @destructive marker', () => {
    const directory = join(repositoryRoot, 'supabase/migrations');
    const offenders = readdirSync(directory)
      .filter((file) => file.endsWith('.sql') && file.slice(0, 14) > MARKER_REQUIRED_AFTER)
      .flatMap((file) =>
        unmarkedDestructiveStatements(readFileSync(join(directory, file), 'utf8')).map(
          (statement) => `supabase/migrations/${file}:${statement}`,
        ),
      );
    expect(
      offenders,
      'Add `-- @destructive: <why the deployed build no longer needs it>` directly above each statement (migration rule, item 8)',
    ).toEqual([]);
  });

  test('the probe flags unmarked top-level statements and ignores marked ones and function bodies', () => {
    const planted = [
      'drop function public.old_helper(uuid);',
      '-- @destructive: replaced by new_helper, which the deployed build already calls',
      'drop function public.older_helper(uuid);',
      '-- @destructive: too short',
      'alter table public.jobs drop column legacy_note;',
      'alter table public.jobs alter column legacy_note drop not null;',
      'create function public.f() returns void language sql as $$ delete from public.jobs; drop table x; $$;',
      'create function public.g() returns void language plpgsql as $fn1$ begin drop table y; end $fn1$;',
      "comment on table public.jobs is 'drop table jobs; delete from jobs';",
      'delete from public.jobs where false;',
      'alter table public.jobs rename column title to name;',
      'alter table public.jobs alter column title type varchar(80);',
    ].join('\n');
    expect(unmarkedDestructiveStatements(planted)).toEqual([
      '1: drop function public.old_helper(uuid)',
      '5: alter table public.jobs drop column legacy_note',
      '10: delete from public.jobs where false',
      '11: alter table public.jobs rename column title to name',
      '12: alter table public.jobs alter column title type varchar(80)',
    ]);
  });
});
