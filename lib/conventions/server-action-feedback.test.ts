import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// Tier 2 for immediate feedback (AGENTS.md "2. Performance and immediate
// feedback": never wait for the network before you acknowledge an action).
//
// Client code: a module with the 'use client' directive, and every product
// module without a directive that client code imports. Server components,
// route handlers and 'use server' modules are not client code.
//
// A use is a call of a Server Action or its value passed on: a value import
// from a module that starts with 'use server' (type-only imports and
// type-only specifiers do not count). A use is a write unless the action's
// name starts with one of READ_ACTION_PREFIXES; the background-read registry
// (lib/data/background-reads.ts) holds only such readers.
//
// A write is acknowledged in its first frame when the use sits
//   1. inside an argument of an owner call: a FEEDBACK_OWNER_HOOKS hook, a
//      name bound to such a hook's result, a runner by convention
//      (RUNNER_NAME), or a wrapper: a function anywhere in client code that
//      invokes one of its parameters in an acknowledged place (`perform(scope,
//      task)` around `busy.run`);
//   2. after a first-frame change earlier in the same function: a pending
//      flag (PENDING_FLAG_SETTER, PENDING_SUBJECT_SETTER; the second test
//      below admits one only from HAND_PENDING_STATE), a progress banner, or an optimistic
//      `insert`, `update` or `remove` of a useOptimisticList (bound here,
//      received by its type, or any object this module also rolls back);
//   3. inside a callback prop (`<ReasonDialog onSubmit={...}>`,
//      `useForm({ onSubmit })`, `editableConfig.onSave` of a `MetadataField[]`)
//      that the receiving module calls in an acknowledged place; or
//   4. inside a named function that is used in such a place: followed through
//      its local references, through the client modules that import it, and
//      through one `const` its result is stored in, up to four steps.
// REVIEWED_USES holds the reasoned exceptions; an entry that matches no
// finding fails, so the list only describes the code.

/** Hooks that show pending, busy or optimistic state before they await the work they are given. */
export const FEEDBACK_OWNER_HOOKS: Readonly<Record<string, string>> = {
  useServerAction: 'counts the call as pending before it awaits the wrapped action',
  usePendingTask: 'useServerAction over an arbitrary task',
  useBusyIds: 'marks the id busy before it awaits the task',
  useBatchProgress: 'adds the progress rows before the first worker runs',
  useOptimisticRun: 'applies the calendar change and the progress banner before execute',
  useCalendarMutations: 'returns the calendar useOptimisticRun runner',
  useOptimisticList: 'insert, update and remove show the change before the caller awaits',
  useTimeAccountForm: 'binds the form submit to useServerAction',
};

/** Action names that only read. Every other action writes. */
const READ_ACTION_PREFIXES = [
  'get',
  'list',
  'search',
  'read',
  'load',
  'fetch',
  'preview',
  'suggest',
  'evaluate',
  'expand',
];
const READ_ACTION_NAME = new RegExp(`^(${READ_ACTION_PREFIXES.join('|')})[A-Z]`);

/** The name an owner's runner carries, bound here or received from the caller. */
const RUNNER_NAME = /^run([A-Z]\w*)?$/;

/** A setter of a pending flag, called with `true`: `setIsSaving`, `setIsBatchWorking`. */
const PENDING_FLAG_SETTER = /^set\w*(Pending|Busy|ing)\w*$/;

/** A setter of the pending subject, called with a value: `setEndingId(id)`, `setPendingAction(kind)`. */
const PENDING_SUBJECT_SETTER = /^set\w*(Pending|Busy|ing)\w*(Id|Ids|Key|Action|State|Draft)$/;

const OPTIMISTIC_METHODS = new Set(['insert', 'update', 'remove']);

/** The declared type of an optimistic change that the caller hands over. */
const RECEIVED_OPTIMISTIC_TYPE = /Optimistic.*\['(insert|update|remove)'\]$/;

const MAX_DEPTH = 4;

/** "file::actionName" -> why this write needs no owner hook in this file. */
const REVIEWED_USES: Readonly<Record<string, string>> = {
  'components/kalender/use-calendar-preferences.ts::saveCalendarPreferences':
    'updatePreferences applies the preference to the view at once; the debounced save only persists it, and a failure costs nothing visible',
  'components/organization/organization-context.tsx::setActiveOrgCookie':
    'the mount effect syncs a fallback organization into the cookie without a user action; the user-initiated switch raises setIsSwitchingOrg first',
  'components/service/use-maintenance-coverage-form.ts::createMaintenanceCoverage':
    'deferred submit: onSubmitted hands the draft with the result promise to useMaintenancePendingCreates, which shows the pending row in the same frame',
  'components/service/use-maintenance-plan-form.ts::createMaintenancePlan':
    'deferred submit: onSubmitted hands the draft with the result promise to useMaintenancePendingCreates, which shows the pending row in the same frame',
  'components/service/use-service-case-form.ts::createServiceCase':
    'deferred submit: onSubmitted hands the draft with the result promise to the service case list, which shows the pending row in the same frame',
};

const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveModule(importer: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? resolve(repositoryRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(repositoryRoot, dirname(importer), specifier)
      : null;
  if (base === null) return null;
  const found = MODULE_EXTENSIONS.map((extension) => `${base}${extension}`).find((path) => existsSync(path));
  return found === undefined ? null : relative(repositoryRoot, found).replaceAll('\\', '/');
}

const parsedSources = new Map<string, ts.SourceFile>();

function sourceOf(file: string): ts.SourceFile {
  const cached = parsedSources.get(file);
  if (cached) return cached;
  const source = parseProductSource(file);
  parsedSources.set(file, source);
  return source;
}

function directive(source: ts.SourceFile): string | null {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return null;
    const text = statement.expression.text;
    if (text === 'use client' || text === 'use server') return text;
  }
  return null;
}

type ModuleImport = { local: string; imported: string; module: string };

/** The file's imports of product modules; type-only imports only when `withTypes`. */
function moduleImports(file: string, withTypes = false): ModuleImport[] {
  const imports: ModuleImport[] = [];
  for (const statement of sourceOf(file).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || (clause.isTypeOnly && !withTypes)) continue;
    const resolved = resolveModule(file, statement.moduleSpecifier.text);
    if (resolved === null) continue;
    if (clause.name) imports.push({ local: clause.name.text, imported: 'default', module: resolved });
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly && !withTypes) continue;
      imports.push({
        local: element.name.text,
        imported: (element.propertyName ?? element.name).text,
        module: resolved,
      });
    }
  }
  return imports;
}

/** 'use client' modules and the directive-free product modules they reach. */
function findClientModules(): string[] {
  const sources = new Set(listProductSources());
  const queue = [...sources].filter((file) => directive(sourceOf(file)) === 'use client');
  const client = new Set(queue);
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const { module } of moduleImports(file)) {
      if (client.has(module) || !sources.has(module) || directive(sourceOf(module)) !== null) continue;
      client.add(module);
      queue.push(module);
    }
  }
  return [...client].sort();
}

function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) return false;
  if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node)
    return false;
  for (let current: ts.Node = parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isTypeQueryNode(current) || ts.isTypeReferenceNode(current)) return false;
  }
  return true;
}

function isCallee(node: ts.Node): boolean {
  return ts.isCallExpression(node.parent) && node.parent.expression === node;
}

type Owners = {
  bound: Set<string>;
  optimisticObjects: Set<string>;
  optimisticFunctions: Set<string>;
  optimisticChannels: Set<string>;
};

function ownerHookName(initializer: ts.Expression | undefined): string | null {
  let expression = initializer;
  while (expression && (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)))
    expression = expression.expression;
  if (!expression || !ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) return null;
  const name = expression.expression.text;
  return name in FEEDBACK_OWNER_HOOKS ? name : null;
}

/** Names bound to an owner hook's result, and the optimistic overlays and changes of this module. */
function collectOwners(source: ts.SourceFile): Owners {
  const owners: Owners = {
    bound: new Set(),
    optimisticObjects: new Set(),
    optimisticFunctions: new Set(),
    optimisticChannels: new Set(),
  };
  function bindOptimistic(pattern: ts.ObjectBindingPattern): void {
    for (const element of pattern.elements) {
      const property = (element.propertyName ?? element.name).getText(source);
      if (ts.isIdentifier(element.name) && OPTIMISTIC_METHODS.has(property))
        owners.optimisticFunctions.add(element.name.text);
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node)) {
      const hook = ownerHookName(node.initializer);
      const initializer = node.initializer;
      if (
        initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === 'createOptimisticChannel' &&
        ts.isIdentifier(node.name)
      )
        owners.optimisticChannels.add(node.name.text);
      if (hook === 'useOptimisticList') {
        if (ts.isIdentifier(node.name)) owners.optimisticObjects.add(node.name.text);
        else if (ts.isObjectBindingPattern(node.name)) bindOptimistic(node.name);
      } else if (hook !== null) {
        if (ts.isIdentifier(node.name)) owners.bound.add(node.name.text);
        else if (ts.isObjectBindingPattern(node.name))
          for (const element of node.name.elements)
            if (ts.isIdentifier(element.name)) owners.bound.add(element.name.text);
      } else if (
        initializer &&
        ts.isIdentifier(initializer) &&
        owners.optimisticObjects.has(initializer.text) &&
        ts.isObjectBindingPattern(node.name)
      ) {
        bindOptimistic(node.name);
      }
    }
    // `list.rollback(id)` marks `list` as an optimistic overlay, received or bound.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.name.text === 'rollback'
    )
      owners.optimisticObjects.add(node.expression.expression.text);
    if (
      (ts.isPropertySignature(node) || ts.isParameter(node)) &&
      node.type &&
      ts.isIdentifier(node.name) &&
      RECEIVED_OPTIMISTIC_TYPE.test(node.type.getText(source))
    )
      owners.optimisticFunctions.add(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return owners;
}

/** Names of functions in client code that invoke a parameter in an acknowledged place. */
const wrapperNames = new Set<string>();

function isOwnerCall(call: ts.CallExpression, owners: Owners): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee))
    return (
      callee.text in FEEDBACK_OWNER_HOOKS ||
      owners.bound.has(callee.text) ||
      RUNNER_NAME.test(callee.text) ||
      wrapperNames.has(callee.text)
    );
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (RUNNER_NAME.test(callee.name.text) || wrapperNames.has(callee.name.text)) return true;
  return ts.isIdentifier(callee.expression) && owners.bound.has(callee.expression.text);
}

function isProgressBanner(call: ts.CallExpression): boolean {
  const [options] = call.arguments;
  if (!ts.isIdentifier(call.expression) || call.expression.text !== 'showBanner') return false;
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText() === 'variant' &&
      ts.isStringLiteral(property.initializer) &&
      property.initializer.text === 'progress',
  );
}

/** `inviteCreations.publish({ kind: 'insert', ... })` on a createOptimisticChannel. */
function isChannelInsert(call: ts.CallExpression, owners: Owners): boolean {
  const callee = call.expression;
  const [event] = call.arguments;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'publish') return false;
  if (!ts.isIdentifier(callee.expression) || !owners.optimisticChannels.has(callee.expression.text))
    return false;
  return (
    event !== undefined &&
    ts.isObjectLiteralExpression(event) &&
    event.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText() === 'kind' &&
        ts.isStringLiteral(property.initializer) &&
        property.initializer.text === 'insert',
    )
  );
}

/** A pending flag raised, a progress banner, or an optimistic change applied. */
function isFirstFrameChange(call: ts.CallExpression, owners: Owners): boolean {
  const callee = call.expression;
  if (isProgressBanner(call) || isChannelInsert(call, owners)) return true;
  if (ts.isIdentifier(callee)) {
    if (owners.optimisticFunctions.has(callee.text)) return true;
    const [value] = call.arguments;
    if (value === undefined) return false;
    if (value.kind === ts.SyntaxKind.TrueKeyword) return PENDING_FLAG_SETTER.test(callee.text);
    return (
      PENDING_SUBJECT_SETTER.test(callee.text) &&
      value.kind !== ts.SyntaxKind.FalseKeyword &&
      value.kind !== ts.SyntaxKind.NullKeyword
    );
  }
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    owners.optimisticObjects.has(callee.expression.text) &&
    OPTIMISTIC_METHODS.has(callee.name.text)
  );
}

/** The name a function is reachable under: its declaration, its `const`, or its `useCallback` `const`. */
function functionName(node: ts.Node): ts.Identifier | null {
  if (ts.isFunctionDeclaration(node)) return node.name ?? null;
  let current: ts.Node = node;
  if (ts.isCallExpression(current.parent) && current.parent.arguments[0] === current)
    current = current.parent;
  const parent = current.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === current && ts.isIdentifier(parent.name))
    return parent.name;
  return null;
}

function isExportedAtTopLevel(name: ts.Identifier): boolean {
  let statement: ts.Node = name.parent;
  if (ts.isVariableDeclaration(statement)) statement = statement.parent.parent;
  return (
    ts.isSourceFile(statement.parent) &&
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

type Analysis = {
  file: string;
  source: ts.SourceFile;
  owners: Owners;
  identifiers: Map<string, ts.Identifier[]>;
  imports: Map<string, string>;
};

const analyses = new Map<string, Analysis>();

function analysisOf(file: string): Analysis {
  const cached = analyses.get(file);
  if (cached) return cached;
  const source = sourceOf(file);
  const identifiers = new Map<string, ts.Identifier[]>();
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const list = identifiers.get(node.text);
      if (list) list.push(node);
      else identifiers.set(node.text, [node]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const imports = new Map(moduleImports(file, true).map(({ local, module }) => [local, module]));
  const analysis = { file, source, owners: collectOwners(source), identifiers, imports };
  analyses.set(file, analysis);
  return analysis;
}

/** "module#exportName" -> the client modules that import it, with the local name. */
const importers = new Map<string, { file: string; local: string }[]>();

function precededByFirstFrameChange(use: ts.Node, body: ts.Node, analysis: Analysis): boolean {
  const usePosition = use.getStart(analysis.source);
  let found = false;
  function visit(node: ts.Node): void {
    if (found || node.getStart(analysis.source) >= usePosition) return;
    if (ts.isCallExpression(node) && isFirstFrameChange(node, analysis.owners)) found = true;
    ts.forEachChild(node, visit);
  }
  visit(body);
  return found;
}

function isLiteralWrapper(node: ts.Node): boolean {
  return (
    ts.isObjectLiteralExpression(node) ||
    ts.isArrayLiteralExpression(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isConditionalExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isSpreadElement(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

/** Type names of the declaration an object literal is written for: `const fields: MetadataField[] = [{ ... }]`. */
function declaredTypeNames(literal: ts.Node): string[] {
  let current = literal;
  while (isLiteralWrapper(current.parent)) current = current.parent;
  const holder = current.parent;
  let type: ts.TypeNode | undefined;
  if (ts.isVariableDeclaration(holder)) type = holder.type;
  if (ts.isReturnStatement(holder) || (ts.isArrowFunction(holder) && holder.body === current)) {
    let fn: ts.Node = holder;
    while (!ts.isFunctionLike(fn) && !ts.isSourceFile(fn)) fn = fn.parent;
    if (ts.isFunctionLike(fn)) type = fn.type;
  }
  const names: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) names.push(node.typeName.text);
    ts.forEachChild(node, visit);
  }
  if (type) visit(type);
  return names;
}

/** The module that receives `node` as a callback prop, and the prop's name. */
function callbackProps(node: ts.Node, analysis: Analysis): { module: string; prop: string }[] {
  const parent = node.parent;
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    const prop = parent.parent.name.getText(analysis.source);
    const element = parent.parent.parent.parent;
    if (!ts.isJsxOpeningElement(element) && !ts.isJsxSelfClosingElement(element)) return [];
    const tag = element.tagName.getText(analysis.source);
    return [{ module: analysis.imports.get(tag) ?? analysis.file, prop }];
  }
  if (!ts.isPropertyAssignment(parent) || !ts.isIdentifier(parent.name) || parent.initializer !== node)
    return [];
  const prop = parent.name.text;
  const call = parent.parent.parent;
  if (ts.isCallExpression(call) && ts.isIdentifier(call.expression))
    return [{ module: analysis.imports.get(call.expression.text) ?? analysis.file, prop }];
  return declaredTypeNames(parent.parent).flatMap((name) => {
    const typeModule = analysis.imports.get(name);
    return typeModule === undefined ? [] : [{ module: typeModule, prop }];
  });
}

/** True when the receiving module calls its `prop` callback in an acknowledged place. */
function ownsCallbackProp(module: string, prop: string, depth: number): boolean {
  const analysis = analysisOf(module);
  return (analysis.identifiers.get(prop) ?? []).some(
    (reference) => isCallee(reference) && isAcknowledged(reference, analysis, depth + 1),
  );
}

/** Where else a named function, or the `const` that stores its result, is used. */
function usesOf(name: ts.Identifier, analysis: Analysis): { reference: ts.Identifier; analysis: Analysis }[] {
  const uses = (analysis.identifiers.get(name.text) ?? [])
    .filter((reference) => reference !== name)
    .map((reference) => ({ reference, analysis }));
  if (!isExportedAtTopLevel(name)) return uses;
  for (const { file, local } of importers.get(`${analysis.file}#${name.text}`) ?? []) {
    const importer = analysisOf(file);
    for (const reference of importer.identifiers.get(local) ?? [])
      if (isValueReference(reference)) uses.push({ reference, analysis: importer });
  }
  return uses;
}

/** `const steps = build(...).map(...)`: the `const` a call's result lands in. */
function storedResult(reference: ts.Node): ts.Identifier | null {
  let current: ts.Node = reference;
  while (
    (ts.isCallExpression(current.parent) && current.parent.expression === current) ||
    (ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current) ||
    ts.isAwaitExpression(current.parent)
  )
    current = current.parent;
  const parent = current.parent;
  return ts.isVariableDeclaration(parent) && parent.initializer === current && ts.isIdentifier(parent.name)
    ? parent.name
    : null;
}

function isImmediatelyInvoked(fn: ts.Node): boolean {
  let current = fn;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return isCallee(current);
}

function isAcknowledged(use: ts.Node, analysis: Analysis, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (depth > 0) {
    const stored = storedResult(use);
    if (
      stored &&
      usesOf(stored, analysis).some((next) => isAcknowledged(next.reference, next.analysis, depth + 1))
    )
      return true;
  }
  let isInnermostFunction = true;
  for (
    let child: ts.Node = use, current = use.parent;
    !ts.isSourceFile(current);
    child = current, current = current.parent
  ) {
    if (
      ts.isCallExpression(current) &&
      current.arguments.some((argument) => argument === child) &&
      isOwnerCall(current, analysis.owners)
    )
      return true;
    if (callbackProps(current, analysis).some(({ module, prop }) => ownsCallbackProp(module, prop, depth)))
      return true;
    if (!ts.isFunctionLike(current)) continue;
    const body = 'body' in current ? current.body : undefined;
    if (isInnermostFunction && body && precededByFirstFrameChange(use, body, analysis)) return true;
    // `void (async () => { await save(); })()` runs in the frame of the function around it.
    isInnermostFunction = isImmediatelyInvoked(current);
    const name = functionName(current);
    if (name === null) continue;
    if (usesOf(name, analysis).some((next) => isAcknowledged(next.reference, next.analysis, depth + 1)))
      return true;
  }
  return false;
}

/** Functions that invoke a parameter in an acknowledged place; their names become owner calls. */
function discoverWrappers(modules: readonly string[]): void {
  for (let round = 0; round < 3; round++) {
    const before = wrapperNames.size;
    for (const file of modules) {
      const analysis = analysisOf(file);
      function visit(node: ts.Node): void {
        if (ts.isFunctionLike(node) && node.parameters.length > 0) {
          const name = functionName(node);
          if (name && !wrapperNames.has(name.text) && invokesParameterInOwner(node, analysis))
            wrapperNames.add(name.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(analysis.source);
    }
    if (wrapperNames.size === before) return;
  }
}

function invokesParameterInOwner(fn: ts.SignatureDeclaration, analysis: Analysis): boolean {
  return fn.parameters.some((parameter) => {
    if (!ts.isIdentifier(parameter.name)) return false;
    const parameterName = parameter.name;
    // A callback parameter: invoked here, or handed on when its declared type is a function.
    const isCallback = parameter.type !== undefined && ts.isFunctionTypeNode(parameter.type);
    return (analysis.identifiers.get(parameterName.text) ?? []).some(
      (reference) =>
        reference !== parameterName &&
        reference.pos >= fn.pos &&
        reference.end <= fn.end &&
        (isCallee(reference) || (isCallback && ts.isCallExpression(reference.parent))) &&
        isAcknowledged(reference, analysis, MAX_DEPTH),
    );
  });
}

type Use = { key: string; location: string; call: boolean; write: boolean; acknowledged: boolean };

function serverActionUses(file: string): Use[] {
  const actions = new Map<string, string>();
  for (const { local, imported, module } of moduleImports(file)) {
    if (directive(sourceOf(module)) === 'use server') actions.set(local, imported);
  }
  if (actions.size === 0) return [];
  const analysis = analysisOf(file);
  const uses: Use[] = [];
  for (const [local, imported] of actions) {
    for (const reference of analysis.identifiers.get(local) ?? []) {
      if (!isValueReference(reference)) continue;
      const write = !READ_ACTION_NAME.test(imported);
      const line =
        analysis.source.getLineAndCharacterOfPosition(reference.getStart(analysis.source)).line + 1;
      uses.push({
        key: `${file}::${imported}`,
        location: `${file}:${line} ${imported}`,
        call: isCallee(reference),
        write,
        acknowledged: write && isAcknowledged(reference, analysis),
      });
    }
  }
  return uses;
}

test('every Server Action write in client code shows feedback in its first frame', () => {
  const modules = findClientModules();
  for (const file of modules) {
    for (const { local, imported, module } of moduleImports(file)) {
      const key = `${module}#${imported}`;
      importers.set(key, [...(importers.get(key) ?? []), { file, local }]);
    }
  }
  discoverWrappers(modules);
  const uses = modules.flatMap(serverActionUses);
  const findings = uses.filter((use) => use.write && !use.acknowledged);
  const findingKeys = new Set(findings.map((use) => use.key));
  expect(
    findings.filter((use) => REVIEWED_USES[use.key] === undefined).map((use) => use.location),
    'Route the write through useServerAction or another FEEDBACK_OWNER_HOOKS owner, so pending, busy or optimistic state shows before the await, or add the use to REVIEWED_USES with the reason.',
  ).toEqual([]);
  expect(
    Object.keys(REVIEWED_USES).filter((key) => !findingKeys.has(key)),
    'These REVIEWED_USES entries match no finding; remove them.',
  ).toEqual([]);
}, 120_000);

// One owner for pending state (AGENTS.md "2. Performance and immediate
// feedback"). A pending setter (PENDING_FLAG_SETTER called with `true`,
// PENDING_SUBJECT_SETTER called with a value) raised before an await or a
// `.then` that is not only a read is pending state written by hand: route the
// write through useServerAction, usePendingTask or useBusyIds instead. A
// setter that names a read (HAND_READ_SETTER) and an awaited call that only
// reads (READ_ACTION_NAME, `readInBackground`) stay out, and so do the modules
// that implement a FEEDBACK_OWNER_HOOKS hook. HAND_PENDING_STATE holds the
// reasoned exceptions; it may only shrink: an entry that matches no site fails.

/** "file::setterName" -> why this pending state stays hand-written. */
const HAND_PENDING_STATE: Readonly<Record<string, string>> = {
  'components/auftraege/artifacts/use-work-artifact-customer-actions.ts::setPendingSignatureDocumentId':
    'not a pending flag: it keeps the id of an uploaded signature that is not linked yet, so a retry reuses it; the write itself runs inside runArtifactTask',
  'components/auftraege/lifecycle/work-lifecycle-card.tsx::setPendingState':
    'an optimistic display value: the card shows the chosen state over the snapshot until the server answers, which a busy-id set cannot express',
  'components/inventar/use-inventory-editing.ts::setPendingItemDraft':
    'an optimistic placeholder row that the table renders until the refreshed list contains the item',
  'components/inventar/use-inventory-editing.ts::setPendingLocationDraft':
    'an optimistic placeholder card that the Lager tab renders until the refreshed list contains the location',
  'components/organization/organization-context.tsx::setIsSwitchingOrg':
    'the switch lock ends when matching server props arrive (realtime-and-caching.md, organization switch confirmation), not when the cookie write returns',
  'components/user/user-profile-context.tsx::setIsLoading':
    "the profile read's loading state: refreshProfile only reads the user and the profile row",
};

/** A setter of a read's loading state: `setIsLoadingOptions`, `setIsRefreshing`; a bare `setIsLoading` may name a write. */
const HAND_READ_SETTER = /Loading[A-Z]|Refresh|Preview|Search|Settl/;

/** Background reads that start without a Server Action (lib/data/background-reads.ts). */
const READ_CALLS = new Set(['readInBackground']);

function isOwnerImplementation(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.name.text in FEEDBACK_OWNER_HOOKS &&
      (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

/** `setIsSaving(true)` or `setEndingId(id)`; a functional update or a reset is not a raise. */
function handPendingSetter(call: ts.CallExpression): string | null {
  if (!ts.isIdentifier(call.expression)) return null;
  const name = call.expression.text;
  const [value] = call.arguments;
  if (value === undefined || HAND_READ_SETTER.test(name)) return null;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return PENDING_FLAG_SETTER.test(name) ? name : null;
  const isValue =
    value.kind !== ts.SyntaxKind.FalseKeyword &&
    value.kind !== ts.SyntaxKind.NullKeyword &&
    !ts.isArrowFunction(value) &&
    !ts.isFunctionExpression(value);
  return isValue && PENDING_SUBJECT_SETTER.test(name) ? name : null;
}

/** The name a call is known by: `save` for `save()`, `signInWithPassword` for `supabase.auth.signInWithPassword()`. */
function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
}

const CONTINUATIONS = ['then', 'catch', 'finally'];

/** The call a continuation waits for: `await save()`, `save().then(...)`, `save().finally(...)`. */
function awaitedCall(node: ts.Node): ts.CallExpression | null {
  let expression: ts.Node | null = null;
  if (ts.isAwaitExpression(node)) expression = node.expression;
  else if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    CONTINUATIONS.includes(node.expression.name.text)
  )
    expression = node.expression.expression;
  // `save().catch(...).finally(...)`: the chain waits for its first call.
  while (
    expression &&
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    CONTINUATIONS.includes(expression.expression.name.text)
  )
    expression = expression.expression.expression;
  return expression && ts.isCallExpression(expression) ? expression : null;
}

function isReadCall(call: ts.CallExpression): boolean {
  const name = calleeName(call);
  return name !== null && (READ_ACTION_NAME.test(name) || READ_CALLS.has(name));
}

/** The nodes of a function body that run in its own call: nested functions only when invoked at once. */
function ownBodyNodes(body: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  function visit(node: ts.Node): void {
    if (node !== body && ts.isFunctionLike(node) && !isImmediatelyInvoked(node)) return;
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(body);
  return nodes;
}

type HandPendingSite = { key: string; location: string };

function handPendingSites(file: string): HandPendingSite[] {
  const source = sourceOf(file);
  if (isOwnerImplementation(source)) return [];
  const sites: HandPendingSite[] = [];
  function visit(node: ts.Node): void {
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const nodes = ownBodyNodes(node.body);
      for (const call of nodes.filter(ts.isCallExpression)) {
        const setter = handPendingSetter(call);
        if (setter === null) continue;
        const raisedAt = call.getStart(source);
        const waitsForWrite = nodes.some((later) => {
          if (later.getStart(source) <= raisedAt) return false;
          const awaited = awaitedCall(later);
          return awaited !== null && !isReadCall(awaited);
        });
        if (!waitsForWrite) continue;
        const line = source.getLineAndCharacterOfPosition(raisedAt).line + 1;
        sites.push({ key: `${file}::${setter}`, location: `${file}:${line} ${setter}` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return sites;
}

test('pending state of a write has one owner: the FEEDBACK_OWNER_HOOKS hooks', () => {
  const sites = findClientModules().flatMap(handPendingSites);
  const siteKeys = new Set(sites.map((site) => site.key));
  expect(
    sites.filter((site) => HAND_PENDING_STATE[site.key] === undefined).map((site) => site.location),
    'This pending state is written by hand around a write. Use the isPending of useServerAction (one action) or usePendingTask (a flow of several steps), or useBusyIds for the row or the choice that runs; hold it across a page change with untilPageLeaves(). A reasoned exception goes into HAND_PENDING_STATE.',
  ).toEqual([]);
  expect(
    Object.keys(HAND_PENDING_STATE).filter((key) => !siteKeys.has(key)),
    'These HAND_PENDING_STATE entries match no site; remove them.',
  ).toEqual([]);
}, 120_000);

/** The unacknowledged writes of a fixture client module that imports `updateJob` and `getJobDetails`. */
function fixtureFindings(name: string, body: string): string[] {
  const file = `components/fixtures/${name}.tsx`;
  const header = [
    "'use client';",
    "import { useState } from 'react';",
    "import { useServerAction } from '@/hooks/use-server-action';",
    "import { useBusyIds } from '@/hooks/use-busy-id';",
    "import { getJobDetails, updateJob } from '@/lib/jobs/actions';",
    "import type { createJob } from '@/lib/jobs/actions';",
  ].join('\n');
  parsedSources.set(file, parseProductSource(file, `${header}\n${body}`));
  return serverActionUses(file)
    .filter((use) => use.write && !use.acknowledged)
    .map((use) => use.key);
}

test('the scan accepts owner hooks and earlier pending flags and rejects a bare await', () => {
  const save = `export function Save() { const [isSaving, setIsSaving] = useState(false); const busy = useBusyIds();`;
  expect(fixtureFindings('bare', `${save} return async () => { await updateJob('j', {}); }; }`)).toEqual([
    'components/fixtures/bare.tsx::updateJob',
  ]);
  expect(
    fixtureFindings(
      'late-flag',
      `${save} return async () => { await updateJob('j', {}); setIsSaving(true); }; }`,
    ),
  ).toEqual(['components/fixtures/late-flag.tsx::updateJob']);
  expect(
    fixtureFindings('flag', `${save} return async () => { setIsSaving(true); await updateJob('j', {}); }; }`),
  ).toEqual([]);
  expect(fixtureFindings('owner', `${save} return useServerAction(() => updateJob('j', {})); }`)).toEqual([]);
  expect(fixtureFindings('busy', `${save} return () => busy.run('j', () => updateJob('j', {})); }`)).toEqual(
    [],
  );
  expect(
    fixtureFindings(
      'helper',
      `${save} async function persist() { await updateJob('j', {}); } return useServerAction(async () => persist()); }`,
    ),
  ).toEqual([]);
  expect(fixtureFindings('read', `export async function load() { return getJobDetails('j'); }`)).toEqual([]);
});

/** The hand-written pending sites of a fixture client module. */
function fixtureHandPending(name: string, body: string): string[] {
  const file = `components/fixtures/${name}.tsx`;
  const header = [
    "'use client';",
    "import { useState } from 'react';",
    "import { getJobDetails, updateJob } from '@/lib/jobs/actions';",
  ].join('\n');
  parsedSources.set(file, parseProductSource(file, `${header}\n${body}`));
  return handPendingSites(file).map((site) => site.location.replace(/^components\/fixtures\//, ''));
}

test('the scan rejects pending state raised by hand before a write and accepts reads and resets', () => {
  const state = `export function Save({ onConfirm }: { onConfirm: () => Promise<void> }) { const [isSaving, setIsSaving] = useState(false); const [endingId, setEndingId] = useState<string | null>(null);`;
  expect(
    fixtureHandPending(
      'flag',
      `${state} return async () => { setIsSaving(true); await updateJob('j', {}); }; }`,
    ),
  ).toEqual(['flag.tsx:4 setIsSaving']);
  expect(
    fixtureHandPending(
      'subject',
      `${state} return (id: string) => { setEndingId(id); void updateJob(id, {}).finally(() => setEndingId(null)); }; }`,
    ),
  ).toEqual(['subject.tsx:4 setEndingId']);
  expect(
    fixtureHandPending(
      'callback',
      `${state} return async () => { setIsSaving(true); await onConfirm(); }; }`,
    ),
  ).toEqual(['callback.tsx:4 setIsSaving']);
  expect(
    fixtureHandPending(
      'nested',
      `${state} return () => { setIsSaving(true); void (async () => { await updateJob('j', {}); })(); }; }`,
    ),
  ).toEqual(['nested.tsx:4 setIsSaving']);
  expect(
    fixtureHandPending(
      'read',
      `${state} return async () => { setIsSaving(true); await getJobDetails('j'); }; }`,
    ),
  ).toEqual([]);
  expect(
    fixtureHandPending(
      'reset',
      `${state} return async () => { await updateJob('j', {}); setIsSaving(false); }; }`,
    ),
  ).toEqual([]);
});
