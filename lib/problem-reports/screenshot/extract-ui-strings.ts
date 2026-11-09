import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { isCatalogCandidate, normalizeUiText } from './ui-string-catalog';

// The build step behind the UI string catalog. next.config.ts runs it when
// `next dev` or `next build` starts, so the catalog always matches the source
// it ships with. It runs under Node, so it uses no Bun API and no `@/` import.
// docs/technical/problem-report-scrubbing.md owns the rule.

const UI_SOURCE_ROOTS = ['app', 'components', 'lib'] as const;
// Test data is not UI: the harness under lib/testing/ and its fixtures hold
// made-up names and addresses that a real record could share.
const EXCLUDED_DIRECTORIES = new Set(['lib/testing', 'node_modules']);

// Calls whose string arguments are class names, never copy.
const CLASS_NAME_CALLS = new Set(['cn', 'cva', 'clsx', 'twMerge']);

// A placeholder shows an example value (a name, an address), the same shape as
// a record's value, so its literal never enters the catalog.
const EXAMPLE_VALUE_KEYS = new Set(['placeholder']);

/** Declarations whose literals are data, by file: a record's value can equal an entry. */
export type DataListDeclarations = Readonly<Record<string, readonly string[]>>;

// Lists of real places and similar data. Their entries (a federal state that
// is also a city) stay out of the catalog. A listed declaration that no longer
// exists fails the build, so a rename cannot quietly readmit the list.
const DATA_LIST_DECLARATIONS: DataListDeclarations = {
  'lib/personnel/holidays.ts': ['HOLIDAY_REGION_LABELS'],
};

function isUiSourceFile(name: string): boolean {
  return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts');
}

/** Repository-relative paths of every source file the catalog reads, sorted. */
function listUiSourceFiles(repositoryRoot: string): string[] {
  const found: string[] = [];
  const visit = (relative: string): void => {
    for (const entry of readdirSync(join(repositoryRoot, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(path) && !entry.name.startsWith('.') && entry.name !== 'fixtures')
          visit(path);
      } else if (isUiSourceFile(entry.name)) {
        found.push(path);
      }
    }
  };
  for (const root of UI_SOURCE_ROOTS) visit(root);
  return found.sort();
}

function nameText(name: ts.Node): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * True for a literal that is not a text a user reads as UI: a module path, a
 * class list, an example value or an entry of a data list.
 */
function isNonCopyLiteral(node: ts.Node, dataLists: ReadonlySet<string>): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return true;
    if (ts.isVariableDeclaration(current) && dataLists.has(nameText(current.name) ?? '')) return true;
    if (ts.isPropertyAssignment(current) && EXAMPLE_VALUE_KEYS.has(nameText(current.name) ?? '')) return true;
    if (ts.isJsxAttribute(current)) {
      const attribute = nameText(current.name) ?? '';
      return attribute === 'className' || EXAMPLE_VALUE_KEYS.has(attribute);
    }
    if (ts.isCallExpression(current)) {
      if (current.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
      if (ts.isIdentifier(current.expression) && CLASS_NAME_CALLS.has(current.expression.text)) return true;
    }
  }
  return false;
}

/**
 * The normalized string literals and JSX texts of one source file that have a
 * letter. A literal stays whole: the redraw keeps a text only when all of it
 * equals one of these, so a word inside a longer literal never stays alone.
 */
function extractUiStrings(
  sourceText: string,
  fileName: string,
  dataLists: ReadonlySet<string>,
): { strings: string[]; declarations: Set<string> } {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const strings: string[] = [];
  const declarations = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) declarations.add(nameText(node.name) ?? '');
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      const normalized = normalizeUiText(node.text);
      if (isCatalogCandidate(normalized) && !isNonCopyLiteral(node, dataLists)) strings.push(normalized);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { strings, declarations };
}

/**
 * Every UI string of the app under `repositoryRoot`, unique and sorted. It
 * throws when a listed data list is missing from its file.
 */
export function collectUiStringCatalog(
  repositoryRoot: string,
  dataLists: DataListDeclarations = DATA_LIST_DECLARATIONS,
): string[] {
  const strings = new Set<string>();
  const missing = new Set(
    Object.entries(dataLists).flatMap(([file, names]) => names.map((name) => `${file}#${name}`)),
  );
  for (const file of listUiSourceFiles(repositoryRoot)) {
    const fileLists = new Set(dataLists[file] ?? []);
    const extracted = extractUiStrings(readFileSync(join(repositoryRoot, file), 'utf8'), file, fileLists);
    for (const text of extracted.strings) strings.add(text);
    for (const name of extracted.declarations) missing.delete(`${file}#${name}`);
  }
  if (missing.size > 0)
    throw new Error(
      `UI string catalog: data lists not found, update DATA_LIST_DECLARATIONS: ${[...missing].join(', ')}`,
    );
  return [...strings].sort();
}
