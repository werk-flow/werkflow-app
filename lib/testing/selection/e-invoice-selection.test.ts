// A CI run checks the reference e-invoices whenever its diff can change a rendered byte, and whenever it cannot tell.
import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { sourceImportGraph, UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import { E_INVOICE_CHECK, eInvoiceReason } from './e-invoice-selection';

const WRITER = 'lib/document-rendering/fixtures/write-reference-e-invoices.ts';
// The writer renders through the invoice core, which reads a money helper outside both folders.
const graph = new Map<string, string[]>([
  [E_INVOICE_CHECK, []],
  [WRITER, ['lib/invoicing/calculate.ts', 'lib/document-rendering/e-invoice.ts']],
  ['lib/invoicing/calculate.ts', ['lib/money/round.ts']],
  ['lib/document-rendering/e-invoice.ts', ['lib/document-rendering/render.ts']],
]);
const reason = (changedFiles: readonly string[] | undefined, fullReason?: string, imports = graph) =>
  eInvoiceReason({ graph: imports, changedFiles, lintOnly: [], fullReason, toolingReason: undefined });

test('a change to what the check imports, to the invoice core or renderer, or to the dependencies selects it', () => {
  for (const file of [
    'lib/money/round.ts',
    E_INVOICE_CHECK,
    'lib/invoicing/rules/en16931.sef.json',
    'lib/document-rendering/fonts/Geist-Regular.ttf',
    'bun.lock',
    'package.json',
    'tsconfig.json',
  ])
    expect(reason(['app/page.tsx', file]), file).toContain(`(${file})`);
});

test('a change the check cannot reach, and documentation, select nothing', () => {
  expect(reason(['app/page.tsx', 'lib/jobs/status.ts', 'docs/features/commercial-and-finance.md'])).toBe(
    undefined,
  );
  expect(reason(['lib/invoicing/README.md'])).toBe(undefined);
  expect(reason([])).toBe(undefined);
});

test('an unreadable diff, a full run, a tooling change and an unresolved import select it', () => {
  expect(reason(undefined)).toBe('The diff against the base could not be read');
  expect(reason([], 'Nightly run')).toBe('Nightly run');
  // A tooling input samples the browser groups without a full reason (ci-plan.ts), and still checks them.
  const tooling = 'Tooling input changed: scripts/ci/job.ts';
  expect(
    eInvoiceReason({
      graph,
      changedFiles: ['docs/technical/testing.md'],
      lintOnly: [],
      fullReason: undefined,
      toolingReason: tooling,
    }),
  ).toBe(tooling);
  const unresolved = new Map([...graph, ['lib/money/round.ts', [UNKNOWN_IMPORT_DEPENDENCY]]]);
  expect(reason(['app/page.tsx'], undefined, unresolved)).toBe(
    'The e-invoice check has an unresolved import',
  );
  expect(reason(['docs/technical/testing.md'], undefined, unresolved)).toBe(undefined);
});

test('a dependency change that moves only lint and type packages selects it only through a full run or a tooling input', () => {
  const lintOnly = (fullReason?: string, toolingReason?: string) =>
    eInvoiceReason({
      graph,
      changedFiles: ['package.json', 'bun.lock'],
      lintOnly: ['package.json', 'bun.lock'],
      fullReason,
      toolingReason,
    });
  expect(lintOnly()).toBe(undefined);
  expect(lintOnly('Nightly run')).toBe('Nightly run');
  expect(lintOnly(undefined, 'Tooling input changed: scripts/ci/job.ts')).toBe(
    'Tooling input changed: scripts/ci/job.ts',
  );
});

test("the repository's import graph carries the check to the invoice core and the renderer, with every import resolved", () => {
  const root = resolve(import.meta.dir, '../../..');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const real = sourceImportGraph(root, files, [E_INVOICE_CHECK, WRITER]);
  expect(reason(['lib/invoicing/calculate.ts'], undefined, real)).toContain('(lib/invoicing/calculate.ts)');
  expect(reason(['app/page.tsx'], undefined, real)).toBe(undefined);
  const reached = [...real.keys()];
  expect(reached).toContain('lib/document-rendering/e-invoice.ts');
  expect(
    reached.filter(
      (file) => !file.startsWith('lib/invoicing/') && !file.startsWith('lib/document-rendering/'),
    ).length,
  ).toBeGreaterThan(0);
});
