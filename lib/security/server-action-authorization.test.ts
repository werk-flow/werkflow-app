import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Tier 1 and 2 guard for SI-025. Every exported function of a 'use server'
// module is a public POST endpoint. It establishes the caller's organization
// context through the one owner module, lib/org/action-context.ts, directly
// or through a named wrapper that this file proves is built on it. An action
// that needs no organization (the caller's own account, a step before any
// membership) is listed with its reason and reaches the session identity. This
// proves the presence of the right kind of check, not its correctness; the
// boundary tests own that.

const repositoryRoot = resolve(import.meta.dir, '../..');

const OWNER_MODULE = 'lib/org/action-context.ts';
const CONTEXT_ROOTS = new Set(['resolveActionContext', 'resolveActionContextFor']);

// Exported guards of other modules. Each one must reach a root (checked below).
const CONTEXT_WRAPPERS: Record<string, string> = {
  authenticateAndAuthorize: 'lib/jobs/auth.ts',
  getAuthorizedDocumentContext: 'lib/documents/access.ts',
  requireServiceManager: 'lib/service-cases/manager-context.ts',
  requireAuth: 'lib/time-accounts/access.ts',
  requireManagerAndClient: 'lib/clients/manager-access.ts',
  requireManagedInvite: 'lib/invites/managed-invite.ts',
};

const SESSION_IDENTITY = 'getAuthenticatedUser';

const OWN_ACCOUNT = "Changes the caller's own account, which belongs to no organization.";
const PRESTART =
  'Prestart employees act on their own items; the owner module resolves operational memberships only.';

// Actions that run on the verified session identity alone. Keep each reason
// true; an entry whose action gains an organization check, or disappears,
// fails as stale.
const IDENTITY_ONLY_ACTIONS: Record<string, string> = {
  'lib/auth/actions.ts#deleteAccount': OWN_ACCOUNT,
  'lib/auth/actions.ts#invalidateProfileCache': OWN_ACCOUNT,
  'lib/settings/actions.ts#removeProfileAvatar': OWN_ACCOUNT,
  'lib/settings/actions.ts#updateProfileAvatar': OWN_ACCOUNT,
  'lib/settings/actions.ts#updateProfileSettings': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#clearEmailChangeChallengeBeforeSignOut': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#requestCurrentEmailChangeOtp': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#resetEmailChangeWizard': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#savePendingNewEmailVerification': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#touchPendingNewEmailVerification': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#verifyCurrentEmailChangeOtp': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#verifyNewEmailChangeOtp': OWN_ACCOUNT,
  'lib/org/actions.ts#createOrganization': 'Runs before the caller has a membership.',
  'lib/org/actions.ts#setActiveOrgCookie':
    'Sets the hint cookie only for a current membership it checks itself.',
  'lib/org/join-request-actions.ts#requestOrganizationJoin': 'Runs before the caller has a membership.',
  'lib/org/join-request-actions.ts#withdrawOrganizationJoinRequest':
    "Withdraws the caller's own request, which exists before any membership.",
  'lib/subscription/actions.ts#simulatePayment':
    'Activates the subscription before the first organization exists.',
  'lib/members/actions.ts#getProfilesByIds':
    'Names are visible across every organization the caller shares with the person (SI-015).',
  'lib/time-tracking/actions.ts#clockOutBeforeSignOut':
    "Ends the caller's own open sessions in every organization at sign-out.",
  'lib/time-tracking/actions.ts#getChangeRequestsForEntries':
    "Reads only organizations from the caller's current memberships, with the role in each.",
  'lib/time-corrections/actions.ts#withdrawTimeCorrection':
    "withdraw_time_correction accepts only the request's author and changes only that request.",
  'lib/personnel/lifecycle-actions.ts#acknowledgePersonnelDocument': PRESTART,
  'lib/personnel/lifecycle-actions.ts#acknowledgePersonnelRequirement': PRESTART,
  'lib/personnel/lifecycle-actions.ts#getOwnPersonnelActions': PRESTART,
  'lib/personnel/lifecycle-actions.ts#getPersonnelDocumentSignedUrl': PRESTART,
};

type Reach = { context: boolean; identity: boolean };

function listApplicationSources(): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
        found.push(path);
      }
    }
  }
  for (const root of ['lib', 'app', 'components', 'hooks']) visit(root);
  return found.sort();
}

function calledIdentifiers(node: ts.Node, collected: Set<string>): void {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) collected.add(callee.text);
    else if (ts.isPropertyAccessExpression(callee)) collected.add(callee.name.text);
  }
  ts.forEachChild(node, (child) => {
    // Defining a nested callback does not execute its identity check.
    if (!ts.isFunctionLike(child)) calledIdentifiers(child, collected);
  });
}

type ExportedAction = { name: string; body: ts.Node | undefined };

function hasServerDirective(statements: readonly ts.Statement[]): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    !!ts.canHaveModifiers(statement) &&
    !!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

// Every export shape that can become a Server Action: function declarations,
// exported arrow or function expressions, and default exports. Re-exports are
// rejected outright because their targets cannot be checked here.
function exportedActions(file: string, source: ts.SourceFile): ExportedAction[] {
  const actions: ExportedAction[] = [];
  if (hasServerDirective(source.statements))
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        throw new Error(
          `${file} re-exports through 'use server'; move the export next to its authorization check`,
        );
      }
      if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
        actions.push({ name: statement.name?.text ?? 'default', body: statement.body });
        continue;
      }
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer;
          if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
            actions.push({ name: declaration.name.getText(source), body: initializer.body });
          } else {
            throw new Error(
              `${file} exports an unresolved action alias ${declaration.name.getText(source)}; export the function beside its identity check`,
            );
          }
        }
        continue;
      }
      if (ts.isExportAssignment(statement)) {
        if (!ts.isArrowFunction(statement.expression) && !ts.isFunctionExpression(statement.expression)) {
          throw new Error(
            `${file} exports an unresolved default action alias; export the function beside its identity check`,
          );
        }
        actions.push({ name: 'default', body: statement.expression.body });
      }
    }
  function visitInline(node: ts.Node): void {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      hasServerDirective(node.body.statements) &&
      !actions.some((action) => action.body === node.body)
    ) {
      actions.push({
        name: `inline:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        body: node.body,
      });
    }
    ts.forEachChild(node, visitInline);
  }
  visitInline(source);
  return actions;
}

/** For each module-local function: whether it reaches an accepted guard or the session identity. */
function localReach(source: ts.SourceFile, guards: ReadonlySet<string>): Map<string, Reach> {
  const callsByLocalFunction = new Map<string, Set<string>>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const calls = new Set<string>();
      calledIdentifiers(statement.body, calls);
      callsByLocalFunction.set(statement.name.text, calls);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          !ts.isIdentifier(declaration.name) ||
          !initializer ||
          !(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        )
          continue;
        const calls = new Set<string>();
        calledIdentifiers(initializer.body, calls);
        callsByLocalFunction.set(declaration.name.text, calls);
      }
    }
  }
  const reach = new Map<string, Reach>();
  for (const name of callsByLocalFunction.keys()) reach.set(name, { context: false, identity: false });
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, calls] of callsByLocalFunction) {
      const current = reach.get(name) ?? { context: false, identity: false };
      const next = { ...current };
      for (const call of calls) {
        if (guards.has(call)) next.context = true;
        if (call === SESSION_IDENTITY) next.identity = true;
        const helper = call === name ? undefined : reach.get(call);
        if (helper?.context) next.context = true;
        if (helper?.identity) next.identity = true;
      }
      if (next.context !== current.context || next.identity !== current.identity) {
        reach.set(name, next);
        changed = true;
      }
    }
  }
  return reach;
}

const ACCEPTED_GUARDS = new Set([...CONTEXT_ROOTS, ...Object.keys(CONTEXT_WRAPPERS)]);

function actionReach(source: ts.SourceFile, action: ExportedAction): Reach {
  const local = localReach(source, ACCEPTED_GUARDS);
  const calls = new Set<string>();
  if (action.body) calledIdentifiers(action.body, calls);
  return {
    context: [...calls].some((call) => ACCEPTED_GUARDS.has(call) || local.get(call)?.context === true),
    identity: [...calls].some((call) => call === SESSION_IDENTITY || local.get(call)?.identity === true),
  };
}

function unguardedActions(
  file: string,
  source: ts.SourceFile,
  actions = exportedActions(file, source),
): string[] {
  const unguarded: string[] = [];
  for (const action of actions) {
    const key = `${file}#${action.name}`;
    const reach = actionReach(source, action);
    if (reach.context) continue;
    if (key in IDENTITY_ONLY_ACTIONS && reach.identity) continue;
    unguarded.push(key);
  }
  return unguarded;
}

test('module and inline Server Actions establish organization context or are reviewed identity-only actions', () => {
  const unguarded: string[] = [];
  const existing = new Set<string>();
  const contextGuarded = new Set<string>();
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    // Most files contain no directive. Keep escaped spellings eligible for AST
    // inspection without parsing huge generated types on every unit run.
    if (!couldContainServerDirective(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const actions = exportedActions(file, source);
    for (const action of actions) {
      existing.add(`${file}#${action.name}`);
      if (actionReach(source, action).context) contextGuarded.add(`${file}#${action.name}`);
    }
    unguarded.push(...unguardedActions(file, source, actions));
  }
  expect(
    unguarded,
    'call resolveActionContext or resolveActionContextFor (lib/org/action-context.ts) or a named wrapper',
  ).toEqual([]);
  expect(
    Object.keys(IDENTITY_ONLY_ACTIONS).filter((key) => !existing.has(key) || contextGuarded.has(key)),
    'stale identity-only entries: the action is gone or now has an organization check',
  ).toEqual([]);
});

test('every named wrapper is built on the owner module', () => {
  const unbuilt: string[] = [];
  for (const [name, file] of Object.entries(CONTEXT_WRAPPERS)) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const others = new Set([
      ...CONTEXT_ROOTS,
      ...Object.keys(CONTEXT_WRAPPERS).filter((other) => other !== name),
    ]);
    if (localReach(source, others).get(name)?.context !== true) unbuilt.push(`${file}#${name}`);
  }
  expect(unbuilt, `a wrapper must call a root of ${OWNER_MODULE} or another wrapper`).toEqual([]);
  const owner = readFileSync(resolve(repositoryRoot, OWNER_MODULE), 'utf8');
  for (const root of CONTEXT_ROOTS) expect(owner).toContain(`export async function ${root}(`);
});

function couldContainServerDirective(text: string): boolean {
  return text.includes('use server') || text.includes('\\');
}

function fixture(source: string): string[] {
  return unguardedActions(
    'app/fixture.tsx',
    ts.createSourceFile('app/fixture.tsx', source, ts.ScriptTarget.Latest, true),
  );
}

test('inline use-server functions inside an ordinary page cannot bypass the identity inventory', () => {
  expect(
    fixture(
      `export default function Page() { async function save() { 'use server'; return readPrivate(); } }`,
    ),
  ).toHaveLength(1);
  expect(
    fixture(
      `export default function Page() { return <form action={async () => { 'use server'; return readPrivate(); }} />; }`,
    ),
  ).toHaveLength(1);
  expect(
    fixture(
      `export default function Page() { async function save() { 'use server'; await resolveActionContext(); return readPrivate(); } }`,
    ),
  ).toEqual([]);
});

test('unresolved action aliases and re-exports fail instead of silently disappearing', () => {
  expect(() =>
    fixture(`'use server'; const inner = async () => readPrivate(); export const save = inner;`),
  ).toThrow('unresolved action alias');
  expect(() =>
    fixture(`'use server'; const inner = async () => readPrivate(); export default inner;`),
  ).toThrow('unresolved default action alias');
  expect(() => fixture(`'use server'; export { save } from './other';`)).toThrow('re-exports');
});

test('direct functions and directive prologues are inventoried while literal text is not a directive', () => {
  expect(
    fixture(`'use strict'; 'use server'; export async function save() { return readPrivate(); }`),
  ).toHaveLength(1);
  expect(
    fixture(
      `'use server'; export const save = async () => readPrivate(); export default async function() { return readPrivate(); }`,
    ),
  ).toHaveLength(2);
  expect(fixture(`const explanation = 'use server'; export const value = 1;`)).toEqual([]);
  expect(
    fixture(
      `'use server'; export async function save() { const unused = async () => resolveActionContext(); return readPrivate(); }`,
    ),
  ).toHaveLength(1);
  const escaped = String.raw`'use\x20server'; export async function save() { return readPrivate(); }`;
  expect(couldContainServerDirective(escaped)).toBe(true);
  expect(fixture(escaped)).toHaveLength(1);
});

test('only the owner module and its wrappers count; identity alone or a lookalike name does not', () => {
  expect(
    fixture(
      `'use server'; export async function save() { await getAuthenticatedUser(); return readPrivate(); }`,
    ),
  ).toHaveLength(1);
  for (const lookalike of [
    'requirePresent',
    'requireJsonRecord',
    'authorizeTarget',
    'getAuthorizedItemContext',
  ]) {
    expect(
      fixture(`'use server'; export async function save() { ${lookalike}(); return readPrivate(); }`),
    ).toHaveLength(1);
  }
  expect(
    fixture(
      `'use server'; export async function save(id) { await resolveActionContextFor(id); return readPrivate(); }`,
    ),
  ).toEqual([]);
});

test('called arrow and expression helpers establish context, unused closures do not', () => {
  expect(
    fixture(
      `'use server'; const guard = async () => resolveActionContext(); export async function save() { await guard(); return readPrivate(); }`,
    ),
  ).toEqual([]);
  expect(
    fixture(
      `'use server'; const guard = async function() { await authenticateAndAuthorize(); }; export async function save() { await guard(); return readPrivate(); }`,
    ),
  ).toEqual([]);
  expect(
    fixture(
      `'use server'; const guard = async () => { const unused = () => resolveActionContext(); }; export async function save() { await guard(); return readPrivate(); }`,
    ),
  ).toHaveLength(1);
});

// Step 3 (2026-09-13) found 27 exported Server Actions with no caller in the
// application: each one was a reachable public POST endpoint that no page,
// component or hook used. An action must be imported by product code or not
// exist; test-only use does not keep a public endpoint alive.
function normalizeModulePath(fromFile: string, specifier: string): string | null {
  let target: string;
  if (specifier.startsWith('@/')) target = specifier.slice(2);
  else if (specifier.startsWith('.')) {
    const parts = fromFile.split('/');
    parts.pop();
    for (const segment of specifier.split('/')) {
      if (segment === '.') continue;
      if (segment === '..') parts.pop();
      else parts.push(segment);
    }
    target = parts.join('/');
  } else return null;
  return target.replace(/\.[cm]?[jt]sx?$/, '');
}

function importedNamesByModule(): Map<string, Set<string>> {
  const imported = new Map<string, Set<string>>();
  const record = (modulePath: string, name: string): void => {
    const names = imported.get(modulePath) ?? new Set<string>();
    names.add(name);
    imported.set(modulePath, names);
  };
  // A text scan keeps this under the unit timeout: import and re-export statements in
  // this repository are plain `import ... from '...'` / `export { ... } from '...'` forms.
  const statement = /^(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    for (const match of text.matchAll(statement)) {
      const [, , typeOnly, clause, specifier] = match;
      if (typeOnly || clause === undefined || specifier === undefined) continue;
      const modulePath = normalizeModulePath(file, specifier);
      if (!modulePath) continue;
      const bindings = clause.trim();
      if (bindings.startsWith('*')) {
        record(modulePath, '*');
        continue;
      }
      const braces = /\{([^}]*)\}/.exec(bindings);
      const defaultImport = bindings
        .replace(/\{[^}]*\}/, '')
        .replace(/,/g, '')
        .trim();
      if (defaultImport && !defaultImport.startsWith('type')) record(modulePath, 'default');
      for (const entry of braces?.[1]?.split(',') ?? []) {
        // split() always yields a first element; the fallback only satisfies the index type.
        const name = (
          entry
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0] ?? ''
        ).trim();
        if (name) record(modulePath, name);
      }
    }
  }
  return imported;
}

test('every exported Server Action is imported by product code', () => {
  const imported = importedNamesByModule();
  const dead: string[] = [];
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    if (!couldContainServerDirective(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (!hasServerDirective(source.statements)) continue;
    const modulePath = file.replace(/\.[cm]?[jt]sx?$/, '');
    const names = imported.get(modulePath) ?? new Set<string>();
    for (const action of exportedActions(file, source)) {
      if (action.name.startsWith('inline:')) continue;
      if (names.has('*') || names.has(action.name)) continue;
      dead.push(`${file}#${action.name}`);
    }
  }
  expect(
    dead,
    'exported Server Actions with no product caller (delete them or wire them: an unused export is still a public POST endpoint)',
  ).toEqual([]);
});
