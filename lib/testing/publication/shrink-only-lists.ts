import { spawnSync } from 'node:child_process';
import ts from 'typescript';

// The ratchet behind every list the repository calls shrink-only: reviewed
// exceptions, size and assertion ceilings, and registries whose entries may
// leave but never join. Each list's own test compares it with the current
// code only, so raising a function and its ceiling together, or adding a
// finding and its exception together, would pass it. This module compares
// each list with its version at the publication base instead: a new entry or
// a raised ceiling is refused, a removed entry or a lowered ceiling passes.
// lib/testing/publication/shrink-only-lists.test.ts runs it in every unit run
// against the merge base with the trunk, so CI's unit job judges each pull
// request against the branch it merges into. Only the owner lets a list grow:
// CI passes the owner's label on the pull request as `growthApproved`, and
// the diff shows what grew (testing.md, "Grow a shrink-only list").
// Lab references ratchet through scripts/lab-counts.ts instead.

/** A list's entries: a key, with its ceiling where the entry carries one. */
export type ListEntries = ReadonlyMap<string, number | null>;

type Extractor =
  | { readonly kind: 'json'; readonly path: readonly string[] }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'numeric-exports' };

export type ShrinkOnlyList = {
  readonly id: string;
  readonly file: string;
  readonly extract: Extractor;
};

/** Properties that explain an entry; editing them is not growth. */
const EXPLANATION_KEYS = new Set(['reason', 'reasons', 'bound']);

const variable = (id: string, file: string, name: string): ShrinkOnlyList => ({
  id,
  file,
  extract: { kind: 'variable', name },
});

export const SHRINK_ONLY_LISTS: readonly ShrinkOnlyList[] = [
  {
    id: 'module size ceilings',
    file: 'eslint-rules/size-cap-exceptions.json',
    extract: { kind: 'json', path: ['modules'] },
  },
  {
    id: 'function size ceilings',
    file: 'eslint-rules/size-cap-exceptions.json',
    extract: { kind: 'json', path: ['functions'] },
  },
  {
    id: 'type assertion ratchet',
    file: 'eslint-rules/type-assertion-ratchet.json',
    extract: { kind: 'json', path: [] },
  },
  {
    id: 'missing boundary fixtures',
    file: 'lib/security/boundary-coverage-exceptions.json',
    extract: { kind: 'json', path: ['missing'] },
  },
  variable('reviewed unpaged reads', 'lib/conventions/unpaged-reads.test.ts', 'REVIEWED_UNPAGED_READS'),
  variable(
    'reviewed unpaged function reads',
    'lib/conventions/unpaged-reads.test.ts',
    'REVIEWED_UNPAGED_RPC_READS',
  ),
  variable(
    'effect-started Server Actions',
    'lib/conventions/live-view-reads.test.ts',
    'EFFECT_STARTED_ACTIONS',
  ),
  variable(
    'live views without dependent actions',
    'lib/conventions/live-view-stale.test.ts',
    'NO_DEPENDENT_ACTIONS',
  ),
  variable('unscoped functions', 'lib/conventions/tenant-scope.test.ts', 'UNSCOPED_FUNCTIONS'),
  variable('known duplicate helpers', 'lib/conventions/duplicate-helpers.test.ts', 'KNOWN_DUPLICATE_HELPERS'),
  variable('known renamed copies', 'lib/conventions/duplicate-helpers.test.ts', 'KNOWN_RENAMED_COPIES'),
  variable('known erased copies', 'lib/conventions/duplicate-helpers.test.ts', 'KNOWN_ERASED_COPIES'),
  variable('known duplicate types', 'lib/conventions/duplicate-helpers.test.ts', 'KNOWN_DUPLICATE_TYPES'),
  variable('known renamed types', 'lib/conventions/duplicate-helpers.test.ts', 'KNOWN_RENAMED_TYPES'),
  variable(
    'action result shape exceptions',
    'lib/conventions/action-failure-shape.test.ts',
    'REVIEWED_RESULT_EXCEPTIONS',
  ),
  variable('form focus exceptions', 'lib/conventions/form-validation-focus.test.ts', 'REVIEWED_EXCEPTIONS'),
  variable('double renders', 'lib/conventions/route-render-owner.test.ts', 'REVIEWED_DOUBLE_RENDERS'),
  variable(
    'hand-built pending state',
    'lib/conventions/server-action-feedback.test.ts',
    'HAND_PENDING_STATE',
  ),
  variable('delayed refresh sites', 'lib/realtime/debounce-ownership.test.ts', 'DELAYED_REFRESH_SITES'),
  variable('delayed close sites', 'lib/realtime/debounce-ownership.test.ts', 'DELAYED_CLOSE_SITES'),
  variable('unlimited rate-limit sites', 'lib/security/rate-limit-inventory.test.ts', 'REVIEWED_UNLIMITED'),
  variable('closed-history count reads', 'lib/attention/count-volume.test.ts', 'HISTORY_READS'),
  variable('empty-state sentences', 'lib/ui/empty-state-copy.test.ts', 'REVIEWED_SENTENCES'),
  variable('shared doc sentences', 'lib/docs/doc-policy.ts', 'SHARED_SENTENCES'),
  variable('slices proven elsewhere', 'lib/docs/slice-browser-proof.ts', 'SLICES_PROVEN_ELSEWHERE'),
  variable(
    'pending-state locators',
    'lib/testing/spec-support/confirmed-locators.test.ts',
    'PENDING_STATE_LOCATORS',
  ),
  variable(
    'non-persisted returns',
    'lib/testing/spec-support/persisted-returns.test.ts',
    'NON_PERSISTED_RETURNS',
  ),
  variable('interval files', 'eslint.config.mjs', 'intervalAllowList'),
  variable('derived-state effects', 'eslint.config.mjs', 'derivedStateEffectExceptions'),
  {
    id: 'browser wait registry',
    file: 'tests/golden/support/timeouts.ts',
    extract: { kind: 'numeric-exports' },
  },
];

type Entries = Map<string, number | null>;

function addValue(entries: Entries, key: string, value: unknown): void {
  if (typeof value === 'number') entries.set(key, value);
  else entries.set(key, null);
  if (Array.isArray(value)) {
    for (const item of value) addValue(entries, `${key}#${itemKey(item)}`, null);
  } else if (value !== null && typeof value === 'object') {
    for (const [name, inner] of Object.entries(value)) {
      if (!EXPLANATION_KEYS.has(name)) addValue(entries, `${key}.${name}`, inner);
    }
  }
}

/** An array item's key: a string itself, an object the strings of its identifying properties. */
function itemKey(item: unknown): string {
  if (typeof item !== 'object' || item === null) return String(item);
  return Object.entries(item)
    .filter(([name, value]) => !EXPLANATION_KEYS.has(name) && typeof value === 'string')
    .map(([, value]) => String(value))
    .join('#');
}

/** A literal's plain value; anything computed counts as a string, so its key still counts. */
function literalValue(node: ts.Expression): unknown {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))
    return literalValue(node.expression);
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll('_', ''));
  if (ts.isBinaryExpression(node)) return arithmetic(node);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literalValue);
  if (ts.isNewExpression(node) && node.arguments?.[0]) return literalValue(node.arguments[0]);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.flatMap((property) => {
        if (ts.isPropertyAssignment(property))
          return [[property.name.getText().replace(/^['"]|['"]$/g, ''), literalValue(property.initializer)]];
        if (ts.isShorthandPropertyAssignment(property)) return [[property.name.text, 'shorthand']];
        // A spread adds entries this extractor cannot list: its own key makes it growth.
        if (ts.isSpreadAssignment(property)) return [[`...${property.expression.getText()}`, 'spread']];
        return [];
      }),
    );
  }
  return node.getText();
}

/** `60 * 1000`: a ceiling written as arithmetic of literals; anything else counts as its text. */
function arithmetic(node: ts.BinaryExpression): unknown {
  const left = literalValue(node.left);
  const right = literalValue(node.right);
  if (typeof left !== 'number' || typeof right !== 'number') return node.getText();
  if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
  if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
  if (node.operatorToken.kind === ts.SyntaxKind.MinusToken) return left - right;
  return node.getText();
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.mjs')
    ? ts.ScriptKind.JS
    : file.endsWith('x')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function variableEntries(file: string, text: string, name: string): Entries | null {
  let initializer: ts.Expression | undefined;
  ts.forEachChild(parse(file, text), function visit(node) {
    if (initializer) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  });
  if (!initializer) return null;
  const value = literalValue(initializer);
  // A computed list (`Object.freeze(...)`, a call) has no entries to read: it counts as no list.
  if (value === null || typeof value !== 'object') return null;
  const entries: Entries = new Map();
  if (Array.isArray(value)) for (const item of value) addValue(entries, itemKey(item), item);
  else for (const [key, inner] of Object.entries(value)) addValue(entries, key, inner);
  return entries;
}

function numericExports(file: string, text: string): Entries {
  const entries: Entries = new Map();
  for (const statement of parse(file, text).statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      // Every exported constant counts; a value that is no literal number has no ceiling to compare.
      const value = declaration.initializer && literalValue(declaration.initializer);
      if (ts.isIdentifier(declaration.name))
        entries.set(declaration.name.text, typeof value === 'number' ? value : null);
    }
  }
  return entries;
}

function jsonEntries(text: string, path: readonly string[]): Entries | null {
  let value: unknown = JSON.parse(text);
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !(key in value)) return null;
    value = Object.entries(value).find(([name]) => name === key)?.[1];
  }
  if (value === null || typeof value !== 'object') return null;
  const entries: Entries = new Map();
  if (Array.isArray(value)) for (const item of value) addValue(entries, itemKey(item), item);
  else for (const [key, inner] of Object.entries(value)) addValue(entries, key, inner);
  return entries;
}

/** The list's entries in one version of its file, or `null` when the file or the list is absent. */
export function listEntries(list: ShrinkOnlyList, text: string | null): ListEntries | null {
  if (text === null) return null;
  if (list.extract.kind === 'json') return jsonEntries(text, list.extract.path);
  if (list.extract.kind === 'numeric-exports') return numericExports(list.file, text);
  return variableEntries(list.file, text, list.extract.name);
}

/** The key of a spread, in a record or an array: entries the extractor cannot list. */
const SPREAD_KEY = /(^|[.#])\.\.\./;

/**
 * Entries that joined the list or raised their ceiling since the base. A list
 * absent at the base is new and starts its own baseline. The owner's approval
 * waives a new entry and a raised ceiling, never a spread or a ceiling it
 * cannot compare: those hide what the list holds from every later check.
 */
export function growthProblems(
  list: ShrinkOnlyList,
  base: ListEntries | null,
  current: ListEntries,
  { growthApproved = false }: { growthApproved?: boolean } = {},
): string[] {
  if (base === null) return [];
  return [...current].flatMap(([key, value]) => {
    if (!base.has(key))
      return growthApproved && !SPREAD_KEY.test(key) ? [] : [`${list.id} (${list.file}) gained "${key}"`];
    const ceiling = base.get(key);
    if (typeof ceiling === 'number' && typeof value !== 'number')
      return [
        `${list.id} (${list.file}) replaced the ceiling ${ceiling} of "${key}" with a value it cannot compare`,
      ];
    return !growthApproved && typeof value === 'number' && typeof ceiling === 'number' && value > ceiling
      ? [`${list.id} (${list.file}) raised "${key}" from ${ceiling} to ${value}`]
      : [];
  });
}

/**
 * A file's text in a commit, or null when the commit does not hold the path.
 * Any other git failure throws, so a broken read never passes as a new list.
 */
export function committedFileText(repositoryRoot: string, commit: string, file: string): string | null {
  const shown = spawnSync('git', ['show', `${commit}:${file}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // The "path absent" message below is git's English text.
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  });
  if (shown.status === 0) return shown.stdout;
  if (shown.status === 128 && /does not exist in|exists on disk, but not in/.test(shown.stderr)) return null;
  throw new Error(`git show ${commit}:${file} failed: ${shown.error?.message ?? shown.stderr.trim()}`);
}

/**
 * Every growth of a shrink-only list between two versions of the tree. The
 * owner's approval waives growth as `growthProblems` allows, never a list that is gone.
 */
export function shrinkOnlyProblems(
  readBase: (file: string) => string | null,
  readCurrent: (file: string) => string | null,
  lists: readonly ShrinkOnlyList[] = SHRINK_ONLY_LISTS,
  { growthApproved = false }: { growthApproved?: boolean } = {},
): string[] {
  return lists.flatMap((list) => {
    const base = listEntries(list, readBase(list.file));
    const currentText = readCurrent(list.file);
    // A tree that never held the file (a probe repository) has nothing to ratchet.
    if (base === null && currentText === null) return [];
    const current = listEntries(list, currentText);
    if (current === null)
      return [`${list.id}: ${list.file} no longer holds the list; update SHRINK_ONLY_LISTS`];
    return growthProblems(list, base, current, { growthApproved });
  });
}
