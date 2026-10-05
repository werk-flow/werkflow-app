import { expect, test } from 'bun:test';

import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for the one-home rule (AGENTS.md coding standards). A module-level
// helper name declared in two or more product files is a copy until proven
// otherwise. The names below are the known copies with their copy count; a
// count may only fall, and a name leaves the list with its last copy.
// A new shared name, or a known one with a new copy, fails here with the files.

const KNOWN_DUPLICATE_HELPERS: Readonly<Record<string, number>> = {
  announceSubmission: 3,
  calculateTotalMinutes: 2,
  errorMessage: 4,
  EvidenceDialog: 2,
  Fact: 2,
  formatDuration: 2,
  formatMinutes: 2,
  formatRange: 3,
  formatSicknessRange: 2,
  formatTime: 3,
  getActiveJobIdsForOrg: 2,
  getCalendarWindow: 2,
  getCurrentClockState: 2,
  getSortValue: 2,
  mapRpcError: 2,
  missingFields: 3,
  mutationError: 2,
  normalizeDatabaseError: 2,
  optionalText: 2,
  ReasonDialog: 3,
  sortTimeEntries: 2,
};

type ModuleHelper = { name: string; file: string; body: string; tokenCount: number };

// A body shorter than this many tokens is a trivial one-liner (a property read,
// a constant) whose repetition is not a copied rule; longer identical bodies are copies.
const MIN_COPIED_BODY_TOKENS = 12;

/** The node's tokens without comments and whitespace, joined by single spaces. */
function normalizedTokens(node: ts.Node, source: ts.SourceFile): string[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    source.languageVariant,
    source.text.slice(node.getStart(source), node.getEnd()),
  );
  const tokens: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan())
    tokens.push(scanner.getTokenText());
  return tokens;
}

/** Module-level function declarations and arrow or function expressions bound to a const. */
function moduleHelpers(file: string): ModuleHelper[] {
  const source = parseProductSource(file);
  const helpers: ModuleHelper[] = [];
  const add = (name: string, node: ts.FunctionLikeDeclaration): void => {
    // The parameters and the body; the name and modifiers may differ between copies.
    const tokens = [...node.parameters, ...(node.body ? [node.body] : [])].flatMap((part) =>
      normalizedTokens(part, source),
    );
    helpers.push({ name, file, body: tokens.join(' '), tokenCount: tokens.length });
  };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) add(statement.name.text, statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        ts.isIdentifier(declaration.name) &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        add(declaration.name.text, initializer);
      }
    }
  }
  return helpers;
}

const helpers = listProductSources()
  .filter((file) => !file.endsWith('/route.ts'))
  .flatMap(moduleHelpers);

test('a module-level helper name is declared in one product file unless it is a known copy', () => {
  const filesByName = new Map<string, string[]>();
  for (const { name, file } of helpers) {
    const files = filesByName.get(name) ?? [];
    if (!files.includes(file)) filesByName.set(name, [...files, file]);
  }
  const duplicated = new Map([...filesByName].filter(([, files]) => files.length > 1));
  const grown = [...duplicated].filter(
    ([name, files]) => files.length > (KNOWN_DUPLICATE_HELPERS[name] ?? 1),
  );
  expect(
    grown.map(([name, files]) => `${name}: ${files.join(', ')}`),
    'One home per helper: move the shared implementation into the owning lib module and import it (AGENTS.md coding standards). Same-name helpers with genuinely different meaning need different names.',
  ).toEqual([]);
  const shrunk = Object.entries(KNOWN_DUPLICATE_HELPERS).filter(
    ([name, count]) => (duplicated.get(name)?.length ?? 1) < count,
  );
  expect(
    shrunk.map(([name]) => name),
    'These names have fewer copies than KNOWN_DUPLICATE_HELPERS records; lower the count or remove the name so the list only shrinks.',
  ).toEqual([]);
}, 60_000);

// Renamed copies that predate the check, as their sorted names joined by " = ".
// An entry leaves the list with its last copy.
const KNOWN_RENAMED_COPIES: readonly string[] = [];

// The same rule for a copy that was renamed: two helpers with token-identical
// parameters and bodies under different names. Same-name copies are the
// previous test's business.
test('no helper body is copied under another name', () => {
  const byBody = new Map<string, ModuleHelper[]>();
  for (const helper of helpers) {
    if (helper.tokenCount < MIN_COPIED_BODY_TOKENS) continue;
    byBody.set(helper.body, [...(byBody.get(helper.body) ?? []), helper]);
  }
  const renamedCopies = new Map<string, ModuleHelper[]>();
  for (const copies of byBody.values()) {
    const names = [...new Set(copies.map((copy) => copy.name))].sort();
    if (names.length > 1) renamedCopies.set(names.join(' = '), copies);
  }
  const unknown = [...renamedCopies].filter(([key]) => !KNOWN_RENAMED_COPIES.includes(key));
  expect(
    unknown.map(([, copies]) => copies.map((copy) => `${copy.name} (${copy.file})`).join(' = ')),
    'Identical helper bodies under different names: keep one in its owning module and import it.',
  ).toEqual([]);
  expect(
    KNOWN_RENAMED_COPIES.filter((key) => !renamedCopies.has(key)),
    'These renamed copies are gone; remove them from KNOWN_RENAMED_COPIES so the list only shrinks.',
  ).toEqual([]);
}, 60_000);
