// Rule test: a mutation step helper that returns a value returns the persisted row.
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { MEASUREMENT_DIGEST_SUPPORT_FILES } from '../../../eslint-rules/playwright-spec-rules.mjs';

// The screen or the URL can show what the UI echoed before the write
// persisted; the database cannot. A helper therefore returns nothing, a
// locator, or `Persisted<Row>`, which only the readers in
// tests/golden/support/db/ build (testing.md, "Spec checklist").

const ROOT = join(import.meta.dir, '../../..');
const HELPER_FOLDERS = [
  'tests/golden/support/steps',
  'tests/golden/support/spec-helpers',
  'tests/audit/support',
];
const DB_FOLDER = 'tests/golden/support/db';

/** Helpers that return something else by purpose. Shrink-only: an entry leaves when its helper changes. */
const NON_PERSISTED_RETURNS: readonly { file: string; name: string; reason: string }[] = [
  {
    file: 'tests/golden/support/spec-helpers/work-artifact-dialog.ts',
    name: 'readPopupBodyText',
    reason: 'reads the text of an opened export, not a saved row',
  },
  {
    file: 'tests/audit/support/calendar-live.ts',
    name: 'expectCalendarChangeWithin',
    reason: 'returns a measured duration',
  },
  {
    file: 'tests/audit/support/lab-recorder.ts',
    name: 'openLabSession',
    reason: 'opens a measured browser session, not a saved row',
  },
  {
    file: 'tests/audit/support/lab-network.ts',
    name: 'trackLabNetwork',
    reason: 'starts a network tracker for a measured session, not a saved row',
  },
  {
    file: 'tests/audit/support/layout-shifts.ts',
    name: 'shiftsAfterUsable',
    reason: 'reads the layout shifts of a rendered page, not a saved row',
  },
  {
    file: 'tests/audit/support/lab-journeys.ts',
    name: 'neighbourBoardRow',
    reason: 'reads which board rows the page lays out, not a saved row',
  },
  {
    file: 'tests/audit/support/lab-journeys.ts',
    name: 'boardCardTitle',
    reason: 'reads the title a board card shows, not a saved row',
  },
  {
    file: 'tests/audit/support/lab-journeys.ts',
    name: 'checklistPointDone',
    reason: 'reads one stored completion flag through the admin client for the lab step assertion',
  },
  {
    file: 'tests/audit/support/layout-fixtures.ts',
    name: 'prepareLayoutDetails',
    reason: 'a seeder that writes through the admin client',
  },
  {
    file: 'tests/audit/support/list-pagination.ts',
    name: 'seedInventoryPages',
    reason: 'a seeder that writes through the admin client',
  },
  {
    file: 'tests/audit/support/list-pagination.ts',
    name: 'persistedInventoryItem',
    reason: 'a reader that reads through the admin client',
  },
  {
    file: 'tests/audit/support/list-pagination.ts',
    name: 'seedDocumentPages',
    reason: 'a seeder that writes through the admin client',
  },
  {
    file: 'tests/audit/support/time-correction-fixtures.ts',
    name: 'prepareSubmittedCorrections',
    reason: 'a seeder that writes through the admin client',
  },
  {
    file: 'tests/audit/support/time-correction-fixtures.ts',
    name: 'prepareOutsidePeriodCorrection',
    reason: 'a seeder that writes through the admin client',
  },
  {
    file: 'tests/audit/support/visual-fixtures.ts',
    name: 'prepareVisualWorld',
    reason: 'a seeder that writes through the admin client',
  },
  {
    file: 'tests/audit/support/visual-fixtures.ts',
    name: 'visualReplacements',
    reason: 'returns text replacements for the visual capture',
  },
];

type Finding = { file: string; name: string; returns: string };

function isLocatorType(node: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(node)) return node.typeName.getText() === 'Locator';
  if (ts.isTypeLiteralNode(node))
    return (
      node.members.length > 0 &&
      node.members.every(
        (member) => ts.isPropertySignature(member) && member.type !== undefined && isLocatorType(member.type),
      )
    );
  return false;
}

function allowedReturn(type: ts.TypeNode | undefined): boolean {
  if (!type || !ts.isTypeReferenceNode(type) || type.typeName.getText() !== 'Promise') return false;
  const [inner] = type.typeArguments ?? [];
  if (!inner) return false;
  if (inner.kind === ts.SyntaxKind.VoidKeyword) return true;
  if (isLocatorType(inner)) return true;
  return ts.isTypeReferenceNode(inner) && /^Persisted/.test(inner.typeName.getText());
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function isAsync(node: ts.FunctionLikeDeclaration): boolean {
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
}

/** Exported async helpers whose declared return is not void, a locator or a persisted row. */
function findings(file: string, source: string): Finding[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];
  const check = (name: string, fn: ts.FunctionLikeDeclaration) => {
    if (!isAsync(fn) || allowedReturn(fn.type)) return;
    found.push({ file, name, returns: fn.type?.getText() ?? '<inferred>' });
  };
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) check(statement.name.text, statement);
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        )
          check(declaration.name.text, init);
      }
  }
  return found;
}

function helperFiles(): string[] {
  return HELPER_FOLDERS.flatMap((folder) =>
    readdirSync(join(ROOT, folder), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `${folder}/${name.replaceAll('\\', '/')}`),
  ).filter((file) => !MEASUREMENT_DIGEST_SUPPORT_FILES.includes(file));
}

const isListed = ({ file, name }: Finding): boolean =>
  NON_PERSISTED_RETURNS.some((entry) => entry.file === file && entry.name === name);

describe('persisted returns', () => {
  const all = helperFiles().flatMap((file) => findings(file, readFileSync(join(ROOT, file), 'utf8')));

  test('a step helper returns void, a locator or a Persisted row from a db reader', () => {
    expect(all.filter((finding) => !isListed(finding))).toEqual([]);
  });

  test('every exception still names a helper that returns something else', () => {
    const stale = NON_PERSISTED_RETURNS.filter(
      (entry) => !all.some((finding) => finding.file === entry.file && finding.name === entry.name),
    );
    expect(stale).toEqual([]);
  });

  test('every Persisted alias is declared in db/ as Persisted<...>', () => {
    const declared = new Map<string, string>();
    for (const name of readdirSync(join(ROOT, DB_FOLDER))) {
      const source = readFileSync(join(ROOT, DB_FOLDER, name), 'utf8');
      for (const [, alias, body] of source.matchAll(/export type (Persisted\w*)(?:<Row>)? = ([^;]+);/g))
        declared.set(alias ?? '', body ?? '');
    }
    expect(declared.get('Persisted')).toMatch(/^Row & \{ readonly \[persistedBrand\]: true \}$/);
    const used = new Set(
      helperFiles().flatMap((file) =>
        [...readFileSync(join(ROOT, file), 'utf8').matchAll(/Promise<(Persisted\w*)/g)].map(
          ([, alias]) => alias,
        ),
      ),
    );
    for (const alias of used) {
      expect(declared.has(alias ?? ''), `${alias} is declared in ${DB_FOLDER}`).toBe(true);
      if (alias !== 'Persisted') expect(declared.get(alias ?? ''), alias).toMatch(/^Persisted</);
    }
  });

  test('the check reports a helper that returns the URL and passes one that returns a db read', () => {
    const probe = `
      export async function createThing(page: Page): Promise<string> { return page.url(); }
      export const createOther = async (page: Page): Promise<{ id: string }> => ({ id: page.url() });
      export async function createRead(page: Page): Promise<PersistedThing> { return readThing(page.url()); }
      export async function openDialog(page: Page): Promise<Locator> { return page.getByRole('dialog'); }
      export async function openPair(page: Page): Promise<{ dialog: Locator; confirm: Locator }> { return pair(page); }
      export async function save(page: Page): Promise<void> {}
    `;
    expect(findings('probe.ts', probe).map(({ name }) => name)).toEqual(['createThing', 'createOther']);
  });

  test('ESLint refuses a cast to Persisted and an import of persisted outside db/', async () => {
    const eslint = new ESLint();
    const ruleIds = async (source: string, filePath: string): Promise<string[]> => {
      const [result] = await eslint.lintText(source, { filePath });
      return (result?.messages ?? []).map(({ ruleId, message }) => `${ruleId}: ${message.slice(0, 22)}`);
    };
    expect(
      await ruleIds(
        "import type { Persisted } from '../db/shared';\nexport const row = 'x' as unknown as Persisted<{ id: string }>;\n",
        'tests/golden/support/steps/probe.ts',
      ),
    ).toEqual(['no-restricted-syntax: Never cast to Persiste']);
    expect(
      await ruleIds(
        "import { persisted } from '../db/shared';\nexport const row = persisted({ id: 'x' });\n",
        'tests/golden/support/steps/probe.ts',
      ),
    ).toEqual(['no-restricted-syntax: Only the readers in te']);
    expect(
      await ruleIds(
        "import { persisted } from './shared';\nexport const row = persisted({ id: 'x' });\n",
        'tests/golden/support/db/probe.ts',
      ),
    ).toEqual([]);
  });
});
