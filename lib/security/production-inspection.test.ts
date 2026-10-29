// Rule test: `bun run prod:inspect` reads PROD's structure, never a table row.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CATALOG_QUERY, LEDGER_QUERY, catalogDrift, ledgerFindings } from './production-inspection';

/** Every relation a query reads after `from` or `join`, function calls and subqueries aside. */
function relationsRead(query: string): string[] {
  const ctes = new Set([...query.matchAll(/(?:with|,)\s+([a-z_]+)\s+as\s+\(/g)].map((match) => match[1]));
  return [...query.matchAll(/\b(?:from|join)\s+([a-z_][a-z_.]*)\b(?!\s*\()/g)]
    .map((match) => match[1] ?? '')
    .filter((relation) => !ctes.has(relation));
}

test('the catalog query reads only system catalogs', () => {
  const relations = relationsRead(CATALOG_QUERY);
  expect(relations.length).toBeGreaterThan(0);
  for (const relation of relations) expect(relation).toMatch(/^pg_catalog\.pg_[a-z_]+$/);
});

test('the catalog compares the Realtime publication operations', () => {
  // Raw DELETE and TRUNCATE publication bypass Realtime RLS (docs/technical/security.md, Realtime).
  for (const flag of ['pubinsert', 'pubupdate', 'pubdelete', 'pubtruncate'])
    expect(CATALOG_QUERY).toContain(`p.${flag}`);
});

test('the ledger query reads only the migration versions', () => {
  expect(relationsRead(LEDGER_QUERY)).toEqual(['supabase_migrations.schema_migrations']);
  expect(LEDGER_QUERY).toStartWith('select version from ');
});

test('the inspection reads through the read-only query endpoint only', () => {
  const script = readFileSync(resolve(import.meta.dir, '../../scripts/inspect-production.ts'), 'utf8');
  expect([...script.matchAll(/database\/query[\w/-]*/g)].map((match) => match[0])).toEqual([
    'database/query/read-only',
  ]);
});

test('drift names each object that is missing or differs, never its definition', () => {
  const dev = [
    { kind: 'function', name: 'public.a()', hash: '1' },
    { kind: 'function', name: 'public.b()', hash: '2' },
    { kind: 'policy', name: 'public.jobs.read', hash: '3' },
  ];
  const prod = [
    { kind: 'function', name: 'public.a()', hash: '1' },
    { kind: 'function', name: 'public.b()', hash: 'changed' },
    { kind: 'index', name: 'public.jobs_idx', hash: '4' },
  ];
  expect(catalogDrift(dev, prod)).toEqual([
    'function public.b(): differs',
    'index public.jobs_idx: only on PROD',
    'policy public.jobs.read: only on DEV',
  ]);
  expect(catalogDrift(dev, dev)).toEqual([]);
});

test('the ledger lists pending versions and refuses versions no committed file holds', () => {
  expect(ledgerFindings({ committed: ['1', '2', '3'], prod: ['1'], dev: ['1', '2'] })).toEqual({
    pending: ['2', '3'],
    problems: [],
    matchesDev: false,
  });
  expect(ledgerFindings({ committed: ['1'], prod: ['1', '9', '9'], dev: ['1', '9'] })).toEqual({
    pending: [],
    problems: [
      'PROD holds versions no committed migration has: 9. Run from an up-to-date main.',
      'PROD holds duplicate versions: 9.',
    ],
    matchesDev: true,
  });
});
