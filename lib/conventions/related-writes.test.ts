import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import {
  moduleSpecifierOf,
  namedBindings,
  repositorySources,
  resolveModuleFile,
  type SourceHost,
} from './module-imports';
import { listProductSources, parseProductSource } from './product-sources';

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
// where they are called. A call to an imported function counts the writes that
// function performs on its most-writing path, through any number of further
// imports and re-exports by name (`writeCounts`); import cycles end. The count
// follows one execution path: the branches of an `if`, a `switch` or a `?:` are
// alternatives, a branch that returns ends the path, and a write inside a loop
// or an array callback counts twice. An action with two or more writes on one
// path is a finding. Calls through an object, such as a namespace import or a
// default import, are out of reach.

const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);
const READ_RPC =
  /^(get|list|search|generate|read|count|is|has|can|find|load|select|resolve|check|preview|evaluate|calculate|compute)_/;
const REPEATING_CALLBACKS = /^(map|flatMap|forEach|filter|reduce)$/;

const EMAIL_CHANGE_STATE_RECOVERY =
  'Independent recovery: the wizard state the action returns (getInitialEmailChangeWizardState) completes a claim whose Auth update succeeded but whose response was lost; the action’s own transition is refused while such a completion is pending, so the two never change the same rows together.';

// Reviewed actions, keyed `file::function`, with the reason their writes stay
// separate by design. A stale entry fails the test.
const ALLOWED_SEPARATE_WRITES: Readonly<Record<string, string>> = {
  'lib/time-tracking/clock-state-actions.ts::clockOutBeforeSignOut':
    'Independent by design: each organization’s open session is clocked out on its own, best effort before sign-out; one refusal must not keep the others running.',
  'lib/inventory/actions.ts::importInventoryRows':
    'Independent by design: each CSV row is booked by its own import_inventory_row call so a refused row keeps the rows before it; the batch row records the counts.',
  'lib/org/join-request-actions.ts::requestOrganizationJoin':
    'Independent housekeeping: the attempt row of the hourly limit must persist when the join request is refused, and expired attempts are deleted first.',
  'lib/time-accounts/actions.ts::generatePayrollExport':
    'Documented recovery: the export is reserved, its file stored and the export finalized; a failed step marks the reservation failed, and recover_failed_payroll_exports resolves the rest.',
  'lib/personnel/actions.ts::sendPersonnelInvite':
    'Ordered around a mail: the invite is written in one transaction before the mail, and the append-only „Einladung versendet“ history row only after the mail went out, because a mail cannot join a transaction.',
  'lib/invites/actions.ts::sendOrgInvite':
    'Ordered around a mail: the rate-limit attempts must persist when the invite is refused, the invite is written in one transaction (create_organization_invite) before the mail, and discard_unsent_organization_invite withdraws it when the mail fails, because a mail cannot join a transaction.',
  'lib/settings/email-change-actions.ts::verifyCurrentEmailChangeOtp': EMAIL_CHANGE_STATE_RECOVERY,
  'lib/settings/email-change-actions.ts::resetEmailChangeWizard': EMAIL_CHANGE_STATE_RECOVERY,
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
  /** Imported functions that write, by local name, with their write count. */
  importedWriters: ReadonlyMap<string, number>;
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
  const imported = scope.importedWriters.get(name);
  if (imported !== undefined) return imported;
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

type ImportedName = { file: string; name: string };
type ModuleFacts = {
  file: string;
  useServer: boolean;
  local: Map<string, ts.FunctionLikeDeclaration>;
  /** Exported names: declared functions, and names re-exported from a further module. */
  exported: string[];
  /** Imported and re-exported names by local name, with the module and name they come from. */
  imports: Map<string, ImportedName>;
};

function exportedNames(statement: ts.Statement): string[] {
  if (ts.isExportDeclaration(statement) && statement.moduleSpecifier)
    return namedBindings(statement).map((binding) => binding.local);
  if (!isExported(statement)) return [];
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.map((declaration) => declaration.name.getText());
  return ts.isFunctionDeclaration(statement) && statement.name ? [statement.name.text] : [];
}

function moduleFacts(file: string, host: SourceHost): ModuleFacts | null {
  const text = host(file);
  if (text === null) return null;
  const source = parseProductSource(file, text);
  const imports = new Map<string, ImportedName>();
  for (const statement of source.statements) {
    const specifier = moduleSpecifierOf(statement);
    const target = specifier === null ? null : resolveModuleFile(file, specifier, host);
    if (target === null) continue;
    for (const binding of namedBindings(statement))
      imports.set(binding.local, { file: target, name: binding.exported });
  }
  return {
    file,
    useServer: isUseServerModule(source),
    local: localFunctions(source),
    exported: source.statements.flatMap(exportedNames),
    imports,
  };
}

/** The most writes per exported function: file, then name. Two is the finding, so a count stops there. */
type WriteCounts = Map<string, Map<string, number>>;
const FINDING_WRITES = 2;

/** The write count of every imported name that writes, by local name. */
function importedWriteCounts(facts: ModuleFacts, counts: WriteCounts): Map<string, number> {
  const writers = new Map<string, number>();
  for (const [local, imported] of facts.imports) {
    const writes = counts.get(imported.file)?.get(imported.name);
    if (writes) writers.set(local, writes);
  }
  return writers;
}

/**
 * Counts the writes of every exported function, through any number of
 * imported helpers: each pass counts with the helpers the passes before found,
 * until a pass changes nothing. Counts only rise and stop at two, so import
 * cycles end too.
 */
function writeCounts(modules: readonly ModuleFacts[]): WriteCounts {
  const counts: WriteCounts = new Map();
  for (let changed = true; changed; ) {
    changed = false;
    for (const facts of modules) {
      const writers = importedWriteCounts(facts, counts);
      const own = counts.get(facts.file) ?? new Map<string, number>();
      for (const name of facts.exported) {
        const declaration = facts.local.get(name);
        const scope: Scope = { local: facts.local, calling: new Set([name]), importedWriters: writers };
        const writes = Math.min(
          FINDING_WRITES,
          declaration ? functionWrites(declaration, scope) : (writers.get(name) ?? 0),
        );
        if (writes <= (own.get(name) ?? 0)) continue;
        own.set(name, writes);
        changed = true;
      }
      if (own.size > 0) counts.set(facts.file, own);
    }
  }
  return counts;
}

/** `file::function` of every exported function of a `'use server'` module that writes twice on one path. */
function actionsWithSeparateWrites(files: readonly string[], host: SourceHost): string[] {
  const modules = files.flatMap((file) => moduleFacts(file, host) ?? []);
  const counts = writeCounts(modules);
  return modules
    .filter((facts) => facts.useServer)
    .flatMap((facts) =>
      [...(counts.get(facts.file) ?? [])]
        .filter(([name, writes]) => writes >= FINDING_WRITES && facts.local.has(name))
        .map(([name]) => `${facts.file}::${name}`),
    );
}

test('Server Actions write related rows in one database function', () => {
  const findings = actionsWithSeparateWrites(listProductSources(['app', 'lib']), repositorySources);
  const unreviewed = findings.filter((finding) => !(finding in ALLOWED_SEPARATE_WRITES));
  expect(
    unreviewed,
    'Move the related writes into one transaction-backed database function, or add a reviewed reason to ALLOWED_SEPARATE_WRITES.',
  ).toEqual([]);
  const stale = Object.keys(ALLOWED_SEPARATE_WRITES).filter((key) => !findings.includes(key));
  expect(stale, 'These allowlist entries no longer write twice; remove them.').toEqual([]);
});

describe('the scan follows writes through imported helpers', () => {
  const planted: Record<string, string> = {
    'lib/probe/actions.ts': [
      "'use server';",
      "import { saveBoth } from './outer';",
      "import { saveOne } from '@/lib/probe/barrel';",
      "import { first } from './cycle-a';",
      'export async function twiceThroughHelpers() { await saveBoth(); }',
      'export async function onceThroughHelpers() { await saveOne(); }',
      'export async function twiceDirect() { await saveOne(); await saveOne(); }',
      'export async function eitherOne(flag: boolean) { if (flag) return saveOne(); await saveOne(); }',
      'export async function throughCycle() { await first(); }',
      '',
    ].join('\n'),
    'lib/probe/outer.ts': `import { saveOne as one } from './barrel';\nexport async function saveBoth() { await one(); await one(); }\n`,
    'lib/probe/barrel.ts': `export { saveOne } from './inner';\n`,
    'lib/probe/inner.ts': `import { db } from './db';\nexport async function saveOne() { await db.from('jobs').insert({}); }\n`,
    'lib/probe/cycle-a.ts': `import { second } from './cycle-b';\nexport async function first(): Promise<void> { await second(); }\n`,
    'lib/probe/cycle-b.ts': `import { first } from './cycle-a';\nimport { saveOne } from './inner';\nexport async function second(): Promise<void> { if (Date.now() < 0) return first(); await saveOne(); }\n`,
  };
  const findings = actionsWithSeparateWrites(Object.keys(planted), (file) => planted[file] ?? null);

  test('two writes three imports deep, through a renamed import and a re-export, are found at the action', () => {
    expect(findings).toContain('lib/probe/actions.ts::twiceThroughHelpers');
    expect(findings).toContain('lib/probe/actions.ts::twiceDirect');
  });

  test('one write through helpers, alternative branches and an import cycle stay clean', () => {
    expect(findings.sort()).toEqual([
      'lib/probe/actions.ts::twiceDirect',
      'lib/probe/actions.ts::twiceThroughHelpers',
    ]);
  });
});
