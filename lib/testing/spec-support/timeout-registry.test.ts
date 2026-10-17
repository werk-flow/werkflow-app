// Rule test: a browser-test wait above the configured expect timeout is a reviewed registry entry that names its slow operation, and the registry only shrinks.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  CONFIGURED_EXPECT_TIMEOUT_MS,
  MAX_REGISTERED_TIMEOUT_MS,
  TIMEOUT_REGISTRY_MODULE,
} from '../../../eslint-rules/playwright-wait-rules.mjs';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/**
 * The reviewed registry. Adding an entry, raising a value or rewording a
 * reason changes this pin, so the change shows in review; removing an entry
 * or lowering a value changes it too, which keeps the pin exact.
 */
const PINNED_ENTRIES = [
  {
    name: 'DOCUMENT_UPLOAD_TIMEOUT_MS',
    value: 60_000,
    reason:
      'A document upload: the browser sends the bytes to object storage, then the server records the file and the dialog reports it complete. The archived local runs took up to 15 s; the cloud bucket is slower.',
  },
  {
    name: 'TASK_OVERVIEW_READ_TIMEOUT_MS',
    value: 20_000,
    reason:
      'The Aufgaben overview after a navigation: it reads every task, approval and notification source of the person before it marks itself loaded. The archived local runs took up to 7 s, and 4 s at the 95th percentile.',
  },
];

type RegistryEntry = { name: string; value: number | null; reason: string };

function docCommentOf(statement: ts.Statement, source: string): string {
  const ranges = ts.getLeadingCommentRanges(source, statement.getFullStart()) ?? [];
  const last = ranges.at(-1);
  if (!last) return '';
  return source
    .slice(last.pos, last.end)
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ');
}

function numericValue(initializer: ts.Expression | undefined): number | null {
  if (!initializer || !ts.isNumericLiteral(initializer)) return null;
  return Number(initializer.text.replaceAll('_', ''));
}

/** Every top-level statement of the registry as an entry; anything but an exported numeric const has no value. */
function registryEntries(): RegistryEntry[] {
  const source = readFileSync(join(REPO_ROOT, TIMEOUT_REGISTRY_MODULE), 'utf8');
  const file = ts.createSourceFile(TIMEOUT_REGISTRY_MODULE, source, ts.ScriptTarget.Latest, true);
  return file.statements.map((statement) => {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    const declaration = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]
      : undefined;
    const isConst =
      ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const named =
      declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : statement.getText();
    return {
      name: named,
      value: exported && isConst ? numericValue(declaration?.initializer) : null,
      reason: docCommentOf(statement, source),
    };
  });
}

describe('the wait registry', () => {
  const entries = registryEntries();

  test('holds exactly the pinned entries, each with its reason', () => {
    expect(entries).toEqual(PINNED_ENTRIES);
  });

  test('every entry outlasts the configured expect timeout and stays under the hard maximum', () => {
    for (const entry of entries) {
      expect(entry.value, `${entry.name} is an exported numeric constant`).not.toBeNull();
      expect(entry.value ?? 0).toBeGreaterThan(CONFIGURED_EXPECT_TIMEOUT_MS);
      expect(entry.value ?? Infinity).toBeLessThanOrEqual(MAX_REGISTERED_TIMEOUT_MS);
    }
  });

  test('every reason names an operation and its measured duration', () => {
    for (const entry of entries) expect(entry.reason, entry.name).toMatch(/^[A-Z].+\. .*\d+ s/);
  });
});

test('the configured expect timeout of every browser config matches the lint limit', () => {
  for (const config of [
    'playwright.config.ts',
    'playwright.audit.config.ts',
    'playwright.canary.config.ts',
  ]) {
    const source = readFileSync(join(REPO_ROOT, config), 'utf8');
    const configured = source.match(/expect:\s*\{\s*timeout:\s*([\d_]+)\s*\}/)?.[1];
    expect(Number(configured?.replaceAll('_', '')), config).toBe(CONFIGURED_EXPECT_TIMEOUT_MS);
  }
});
