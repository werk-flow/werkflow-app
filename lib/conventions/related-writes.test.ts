import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// Tier 2 for "related writes are one transaction" (docs/technical/code-quality.md).
// A Server Action that writes in two statements leaves half its change behind
// when the second statement is refused, and a compensating write can fail too.
// Related writes belong in one database function, as create_job_with_assignments
// or review_time_entries do.
//
// The scan covers every exported function of a 'use server' module under app/
// and lib/. A write is an `.insert(`, `.update(`, `.upsert(` or `.delete(` on a
// `.from(...)` chain (storage excluded) or an `.rpc('name')` whose name does not
// start with a read verb. Writes of functions declared in the same module count
// where they are called. A call to an imported write helper counts as one write
// where it is called: a write helper is an exported function of a lib/ module
// that writes in its own body or in a function of its own module. The count
// follows one execution path: the branches of an `if`, a `switch` or a `?:` are
// alternatives, a branch that returns ends the path, and a write inside a loop
// or an array callback counts twice. An action with two or more writes on one
// path is a finding. Writes that a helper reaches through a further import, and
// calls through an object such as a namespace import, are out of reach.

const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);
const READ_RPC =
  /^(get|list|search|generate|read|count|is|has|can|find|load|select|resolve|check|preview|evaluate|calculate|compute)_/;
const REPEATING_CALLBACKS = /^(map|flatMap|forEach|filter|reduce)$/;

// Reviewed actions, keyed `file::function`, with the reason their writes stay
// separate by design. A stale entry fails the test.
const ALLOWED_SEPARATE_WRITES: Readonly<Record<string, string>> = {
  'lib/time-tracking/actions.ts::clockOutBeforeSignOut':
    'Independent by design: each organization’s open session is clocked out on its own, best effort before sign-out; one refusal must not keep the others running.',
  'lib/inventory/actions.ts::importInventoryRows':
    'Independent by design: each CSV row is booked by its own import_inventory_row call so a refused row keeps the rows before it; the batch row records the counts.',
  'lib/org/join-request-actions.ts::requestOrganizationJoin':
    'Independent housekeeping: the attempt row of the hourly limit must persist when the join request is refused, and expired attempts are deleted first.',
  'lib/time-accounts/actions.ts::generatePayrollExport':
    'Documented recovery: the export is reserved, its file stored and the export finalized; a failed step marks the reservation failed, and recover_failed_payroll_exports resolves the rest.',
  'lib/personnel/actions.ts::sendPersonnelInvite':
    'Ordered around a mail: the invite is written in one transaction before the mail, and the append-only „Einladung versendet“ history row only after the mail went out, because a mail cannot join a transaction.',
  'lib/settings/email-change-actions.ts::requestCurrentEmailChangeOtp':
    'Independent housekeeping: the rate-limit attempt must persist when the email change transition refuses.',
  'lib/settings/email-change-actions.ts::savePendingNewEmailVerification':
    'Independent housekeeping: the rate-limit attempt must persist when the email change transition refuses.',
  'lib/settings/email-change-actions.ts::touchPendingNewEmailVerification':
    'Independent housekeeping: the rate-limit attempt must persist when the email change transition refuses.',
  'lib/settings/email-change-actions.ts::verifyNewEmailChangeOtp':
    'Documented recovery around the Auth API: the claim is locked before the Auth update, which cannot join a transaction; a definite rejection abandons the claim, and an unknown outcome stays completion_pending until complete reconciles it.',
  'lib/subscription/actions.ts::simulatePayment':
    'Independent housekeeping: the rate-limit attempt must persist when the subscription activation fails.',
  'lib/documents/actions.ts::linkDocumentsToTarget':
    'Independent by design: each document is authorized and linked by its own update_document_links call, and the result reports linked and failed counts as partial_update; a refused document keeps the links of the others.',
};

type Scope = {
  local: Map<string, ts.FunctionLikeDeclaration>;
  calling: Set<string>;
  /** Local names of imported write helpers. */
  importedWriters: ReadonlySet<string>;
};

function isDirectWrite(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const method = call.expression.name.text;
  if (WRITE_METHODS.has(method)) {
    const chain = call.expression.expression.getText();
    return /\.from\(/.test(chain) && !/\.storage\b/.test(chain);
  }
  const [name] = call.arguments;
  return method === 'rpc' && name !== undefined && ts.isStringLiteral(name) && !READ_RPC.test(name.text);
}

function functionWrites(declaration: ts.FunctionLikeDeclaration, scope: Scope): number {
  if (!declaration.body) return 0;
  return ts.isBlock(declaration.body)
    ? pathWrites(declaration.body.statements, scope)
    : expressionWrites(declaration.body, scope);
}

function calledLocalWrites(call: ts.CallExpression, scope: Scope): number {
  if (!ts.isIdentifier(call.expression)) return 0;
  const name = call.expression.text;
  if (scope.importedWriters.has(name)) return 1;
  const declaration = scope.local.get(name);
  if (!declaration || scope.calling.has(name)) return 0;
  scope.calling.add(name);
  const writes = functionWrites(declaration, scope);
  scope.calling.delete(name);
  return writes;
}

/** The most writes one evaluation of the node performs. */
function expressionWrites(node: ts.Node, scope: Scope): number {
  if (ts.isConditionalExpression(node)) {
    return (
      expressionWrites(node.condition, scope) +
      Math.max(expressionWrites(node.whenTrue, scope), expressionWrites(node.whenFalse, scope))
    );
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return functionWrites(node, scope);
  let writes = 0;
  if (ts.isCallExpression(node)) {
    writes += (isDirectWrite(node) ? 1 : 0) + calledLocalWrites(node, scope);
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      REPEATING_CALLBACKS.test(node.expression.name.text)
    ) {
      const repeated = node.arguments.reduce((sum, argument) => sum + expressionWrites(argument, scope), 0);
      return writes + expressionWrites(node.expression.expression, scope) + 2 * repeated;
    }
  }
  ts.forEachChild(node, (child) => {
    writes += expressionWrites(child, scope);
  });
  return writes;
}

function endsPath(statement: ts.Statement | undefined): boolean {
  if (!statement) return false;
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) return statement.statements.some(endsPath);
  return (
    ts.isIfStatement(statement) && endsPath(statement.thenStatement) && endsPath(statement.elseStatement)
  );
}

function bodyOf(statement: ts.Statement | undefined): readonly ts.Statement[] {
  if (!statement) return [];
  return ts.isBlock(statement) ? statement.statements : [statement];
}

/** The most writes one execution path through the statements performs. */
function pathWrites(statements: readonly ts.Statement[], scope: Scope): number {
  let writes = 0;
  for (const [index, statement] of statements.entries()) {
    if (ts.isIfStatement(statement)) {
      const rest = pathWrites(statements.slice(index + 1), scope);
      const branch = (branchStatement: ts.Statement | undefined): number =>
        pathWrites(bodyOf(branchStatement), scope) + (endsPath(branchStatement) ? 0 : rest);
      return (
        writes +
        expressionWrites(statement.expression, scope) +
        Math.max(branch(statement.thenStatement), branch(statement.elseStatement))
      );
    }
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
      return writes + (statement.expression ? expressionWrites(statement.expression, scope) : 0);
    }
    if (ts.isBlock(statement)) writes += pathWrites(statement.statements, scope);
    else if (ts.isTryStatement(statement)) {
      const attempt = pathWrites(statement.tryBlock.statements, scope);
      const recovery = statement.catchClause ? pathWrites(statement.catchClause.block.statements, scope) : 0;
      const cleanup = statement.finallyBlock ? pathWrites(statement.finallyBlock.statements, scope) : 0;
      writes += Math.max(attempt, recovery) + cleanup;
    } else if (ts.isIterationStatement(statement, false)) {
      let repeated = pathWrites(bodyOf(statement.statement), scope);
      ts.forEachChild(statement, (child) => {
        if (child !== statement.statement) repeated += expressionWrites(child, scope);
      });
      writes += 2 * repeated;
    } else if (ts.isSwitchStatement(statement)) {
      const clauses = statement.caseBlock.clauses.map((clause) => pathWrites(clause.statements, scope));
      writes += expressionWrites(statement.expression, scope) + Math.max(0, ...clauses);
    } else writes += expressionWrites(statement, scope);
  }
  return writes;
}

function isUseServerModule(source: ts.SourceFile): boolean {
  const [first] = source.statements;
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  );
}

function localFunctions(source: ts.SourceFile): Map<string, ts.FunctionLikeDeclaration> {
  const local = new Map<string, ts.FunctionLikeDeclaration>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) local.set(statement.name.text, statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        ts.isIdentifier(declaration.name) &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      )
        local.set(declaration.name.text, initializer);
    }
  }
  return local;
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false)
  );
}

/** Exported write helpers per lib/ module, keyed by repository-relative path. */
function findWriteHelpers(): Map<string, Set<string>> {
  const helpers = new Map<string, Set<string>>();
  for (const file of listProductSources(['lib'])) {
    const source = parseProductSource(file);
    const local = localFunctions(source);
    const writers = new Set<string>();
    for (const statement of source.statements) {
      if (!isExported(statement)) continue;
      const names = ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.map((declaration) => declaration.name.getText())
        : [ts.isFunctionDeclaration(statement) ? (statement.name?.text ?? '') : ''];
      for (const name of names) {
        const declaration = local.get(name);
        const scope: Scope = { local, calling: new Set([name]), importedWriters: new Set() };
        if (declaration && functionWrites(declaration, scope) > 0) writers.add(name);
      }
    }
    if (writers.size > 0) helpers.set(file, writers);
  }
  return helpers;
}

/** The module file an import specifier names, or null outside the repository. */
function resolveImport(importer: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? specifier.slice(2)
    : specifier.startsWith('.')
      ? posix.join(posix.dirname(importer), specifier)
      : null;
  if (base === null) return null;
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
  return candidates.find((candidate) => existsSync(resolve(repositoryRoot, candidate))) ?? null;
}

/** Local names under which the module imports a write helper. */
function importedWriters(
  file: string,
  source: ts.SourceFile,
  helpers: Map<string, Set<string>>,
): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = resolveImport(file, statement.moduleSpecifier.text);
    const writers = target ? helpers.get(target) : undefined;
    const bindings = statement.importClause?.namedBindings;
    if (!writers || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (writers.has((element.propertyName ?? element.name).text)) names.add(element.name.text);
    }
  }
  return names;
}

function findActionsWithSeparateWrites(): string[] {
  const findings: string[] = [];
  const helpers = findWriteHelpers();
  for (const file of listProductSources(['app', 'lib'])) {
    const source = parseProductSource(file);
    if (!isUseServerModule(source)) continue;
    const local = localFunctions(source);
    const writers = importedWriters(file, source, helpers);
    for (const statement of source.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
      if (!isExported(statement)) continue;
      const writes = functionWrites(statement, {
        local,
        calling: new Set([statement.name.text]),
        importedWriters: writers,
      });
      if (writes >= 2) findings.push(`${file}::${statement.name.text}`);
    }
  }
  return findings;
}

test('Server Actions write related rows in one database function', () => {
  const findings = findActionsWithSeparateWrites();
  const unreviewed = findings.filter((finding) => !(finding in ALLOWED_SEPARATE_WRITES));
  expect(
    unreviewed,
    'Move the related writes into one transaction-backed database function, or add a reviewed reason to ALLOWED_SEPARATE_WRITES.',
  ).toEqual([]);
  const stale = Object.keys(ALLOWED_SEPARATE_WRITES).filter((key) => !findings.includes(key));
  expect(stale, 'These allowlist entries no longer write twice; remove them.').toEqual([]);
});
