// Rule test: every money, time and date module has a property test (docs/technical/testing.md, "Property tests").
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import ts from 'typescript';
import { z } from '@/lib/zod';
import { parseProductSource, repositoryRoot } from './product-sources';

// Tier 2 for the owner's decision of 2026-11-22: a rule whose mistake costs money (recorded time,
// periods and payroll, invoices, Berlin dates) has a property test at the unit boundary. Each file
// under lib/testing/property-test-areas/ names one area: its roots, the modules a property test
// covers, and every other module under a root with the reason no such rule lives there. A new
// module under a root fails here until the manifest classifies it, so the change shows in review.

const MANIFEST_DIRECTORY = 'lib/testing/property-test-areas';
const PROPERTY_TEST = /\.property\.test\.ts$/;
const KNOWN_BUG = /^\s*known bug:\s*werk-flow\/werkflow-planning#\d+\s+\S/;
/** The only option a property test passes to `fc.assert`; the seed and run count are shared (lib/testing/property-runs.ts). */
const ASSERT_OPTIONS = new Set(['examples']);

const areaSchema = z
  .object({
    area: z.string().min(1),
    rule: z.string().min(1),
    roots: z.array(z.string().min(1)).min(1),
    covered: z.array(z.string().min(1)),
    exempt: z.record(z.string(), z.string().min(10)),
  })
  .strict();
type Area = z.infer<typeof areaSchema> & { manifest: string };

function readAreas(): Area[] {
  return readdirSync(resolve(repositoryRoot, MANIFEST_DIRECTORY))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const manifest = `${MANIFEST_DIRECTORY}/${name}`;
      const parsed = areaSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, manifest), 'utf8')));
      return { ...parsed, manifest };
    });
}

/** The source modules under a root folder, or the root module itself; tests and declarations left out. */
function modulesUnder(root: string): string[] {
  const absolute = resolve(repositoryRoot, root);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [root];
  return readdirSync(absolute, { recursive: true, encoding: 'utf8' })
    .map((name) => `${root}/${name.split('\\').join('/')}`)
    .filter((file) => /\.tsx?$/.test(file) && !/\.(?:test|spec)\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
    .sort();
}

/** The repository path an import names, without extension, or the bare package name. */
function importTarget(fromFile: string, specifier: string): string {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return posix.normalize(`${dirname(fromFile)}/${specifier}`);
  return specifier;
}

const stemOf = (modulePath: string): string => modulePath.replace(/\.tsx?$/, '');
const propertyTestOf = (modulePath: string): string => `${stemOf(modulePath)}.property.test.ts`;

function listPropertyTests(): string[] {
  return readdirSync(resolve(repositoryRoot, 'lib'), { recursive: true, encoding: 'utf8' })
    .map((name) => `lib/${name.split('\\').join('/')}`)
    .filter((file) => PROPERTY_TEST.test(file))
    .sort();
}

/** The local names a file binds to runtime values of the imports `matches` accepts; type-only bindings left out. */
function runtimeBindings(
  source: ts.SourceFile,
  file: string,
  matches: (target: string) => boolean,
): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !matches(importTarget(file, statement.moduleSpecifier.text)))
      continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements) if (!element.isTypeOnly) names.add(element.name.text);
  }
  // A server-only module loads after `mock.module('server-only', …)`: a top-level
  // `const { x } = await import('…')`, so the binding is the module's in the whole file.
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const))
      continue;
    for (const declaration of statement.declarationList.declarations) {
      const loaded =
        declaration.initializer && ts.isAwaitExpression(declaration.initializer)
          ? declaration.initializer.expression
          : undefined;
      if (!loaded || !ts.isCallExpression(loaded) || loaded.expression.kind !== ts.SyntaxKind.ImportKeyword)
        continue;
      const [specifier] = loaded.arguments;
      if (!specifier || !ts.isStringLiteral(specifier) || !matches(importTarget(file, specifier.text)))
        continue;
      if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      if (ts.isObjectBindingPattern(declaration.name))
        for (const element of declaration.name.elements)
          if (ts.isIdentifier(element.name)) names.add(element.name.text);
    }
  }
  return names;
}

/** Every call `<fast-check binding>.<method>(…)` of a file. */
function fastCheckCalls(root: ts.Node, fastCheck: ReadonlySet<string>, method: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      fastCheck.has(node.expression.expression.text) &&
      node.expression.name.text === method
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
}

function referencesAny(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(node) && names.has(node.text)) return true;
  return ts.forEachChild(node, (child) => referencesAny(child, names) || undefined) ?? false;
}

const NOT_RUN = new Set(['skip', 'skipIf', 'todo', 'todoIf', 'if', 'failing', 'failingIf']);

/** The names along a callee: `describe.skip` is `describe`, `skip`; `test.if(x)` is `test`, `if`. */
function calleeNames(callee: ts.Expression): string[] {
  if (ts.isIdentifier(callee)) return [callee.text];
  if (ts.isCallExpression(callee)) return calleeNames(callee.expression);
  if (ts.isPropertyAccessExpression(callee)) return [...calleeNames(callee.expression), callee.name.text];
  return [];
}

/** The inline callbacks of the tests a file always runs and expects to pass: `test(...)`, `it(...)`, `test.each(...)(...)`. */
function testCallbacks(source: ts.SourceFile): ts.Node[] {
  const callbacks: ts.Node[] = [];
  const registers = (callee: ts.Expression): boolean => {
    if (ts.isIdentifier(callee)) return callee.text === 'test' || callee.text === 'it';
    if (ts.isCallExpression(callee)) return registers(callee.expression);
    return (
      ts.isPropertyAccessExpression(callee) && callee.name.text === 'each' && registers(callee.expression)
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && registers(node.expression))
      callbacks.push(
        ...node.arguments.filter(
          (argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
        ),
      );
    // Nothing inside a skipped, conditional or expected-to-fail registration runs or must pass:
    // `describe.skip(…)`, `test.todo(…)`, `describe.if(…)(…)`, `test.failing(…)`.
    if (ts.isCallExpression(node) && calleeNames(node.expression).some((name) => NOT_RUN.has(name))) return;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return callbacks;
}

const contains = (outer: ts.Node, inner: ts.Node): boolean =>
  outer.pos <= inner.pos && inner.end <= outer.end;

/**
 * The covered bindings and the file's own top-level helpers that reach one of them, directly or
 * through another such helper: a property may call the module through `findingsFor(…)`.
 */
function withLocalHelpers(source: ts.SourceFile, covered: ReadonlySet<string>): Set<string> {
  const helpers = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) helpers.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          helpers.set(declaration.name.text, declaration.initializer);
  }
  const reaching = new Set(covered);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, body] of helpers)
      if (!reaching.has(name) && referencesAny(body, reaching)) {
        reaching.add(name);
        grew = true;
      }
  }
  return reaching;
}

/** Why a covered module's property test does not drive it through fast-check in a test, if it does not. */
function coverageProblems(modulePath: string, propertyTest: string, text?: string): string[] {
  const source = parseProductSource(propertyTest, text);
  const fastCheck = runtimeBindings(source, propertyTest, (target) => target === 'fast-check');
  const covered = runtimeBindings(source, propertyTest, (target) => target === stemOf(modulePath));
  const reaching = withLocalHelpers(source, covered);
  const callbacks = testCallbacks(source);
  const asserted = fastCheckCalls(source, fastCheck, 'assert').filter(
    (call) => referencesAny(call, reaching) && callbacks.some((callback) => contains(callback, call)),
  );
  if (fastCheck.size === 0) return [`${propertyTest} imports no fast-check.`];
  if (covered.size === 0) return [`${propertyTest} imports no value of ${modulePath}.`];
  return asserted.length === 0
    ? [`${propertyTest} has no test whose fc.assert calls a value of ${modulePath}.`]
    : [];
}

/** An option key as written, quoted or not; undefined for a spread or a computed key. */
function optionKey(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return undefined;
  const { name } = property;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Run settings a property test sets itself, and failing cases that hide a property or name no issue. */
function settingProblems(file: string, text?: string): string[] {
  const source = parseProductSource(file, text);
  const lines = source.getFullText().split('\n');
  const fastCheck = runtimeBindings(source, file, (target) => target === 'fast-check');
  const problems: string[] = [];
  const at = (node: ts.Node): string =>
    `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  for (const call of fastCheckCalls(source, fastCheck, 'assert')) {
    const options = call.arguments[1];
    if (!options) continue;
    const keys = ts.isObjectLiteralExpression(options) ? options.properties.map(optionKey) : [undefined];
    if (keys.some((key) => key === undefined || !ASSERT_OPTIONS.has(key)))
      problems.push(
        `${at(call)}: fc.assert takes only a literal \`{ examples }\`; the seed and run count come from lib/testing/property-runs.ts.`,
      );
  }
  const visit = (node: ts.Node): void => {
    // fast-check is used as `fc.<name>` only, and `fc.assert` only when called: an alias such as
    // `const check = fc.assert` or `const { assert } = fc` would escape the option check above.
    const parent = node.parent;
    if (
      ts.isIdentifier(node) &&
      fastCheck.has(node.text) &&
      parent &&
      !ts.isImportClause(parent) &&
      !ts.isImportSpecifier(parent) &&
      !ts.isNamespaceImport(parent) &&
      !ts.isQualifiedName(parent) &&
      !(ts.isPropertyAccessExpression(parent) && parent.expression === node)
    )
      problems.push(`${at(node)}: use fast-check only as \`fc.<name>\`, never aliased or passed on.`);
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      fastCheck.has(node.expression.text) &&
      node.name.text === 'assert' &&
      !(parent && ts.isCallExpression(parent) && parent.expression === node)
    )
      problems.push(`${at(node)}: call \`fc.assert\` directly, so its options are checked.`);
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'failingIf')
      problems.push(
        `${at(node)}: an expected failure is an unconditional \`test.failing\` under its known-bug comment.`,
      );
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text === 'configureGlobal')
      problems.push(`${at(node)}: only scripts/unit-test-preload.ts configures fast-check.`);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'failing'
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      const comment = /^\s*\/\/(.*)$/.exec(lines[line - 1] ?? '')?.[1] ?? '';
      if (!KNOWN_BUG.test(comment))
        problems.push(
          `${at(node)}: a failing case needs \`// known bug: werk-flow/werkflow-planning#<n> <why>\` on the line above.`,
        );
      const callback = node.arguments[1];
      const inline = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback));
      if (!inline || referencesAny(callback, fastCheck))
        problems.push(
          `${at(node)}: a failing case is an inline callback with one fixed counterexample and no fast-check, so it hides no other failure.`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

const areas = readAreas();

describe('property test manifest', () => {
  test('every area names roots and modules that exist, each module once', () => {
    const problems: string[] = [];
    const seen = new Map<string, string>();
    for (const area of areas) {
      for (const root of area.roots)
        if (!existsSync(resolve(repositoryRoot, root)))
          problems.push(`${area.manifest}: root ${root} does not exist.`);
      for (const modulePath of [...area.covered, ...Object.keys(area.exempt)]) {
        if (!existsSync(resolve(repositoryRoot, modulePath)))
          problems.push(`${area.manifest}: ${modulePath} does not exist.`);
        if (!area.roots.some((root) => modulePath === root || modulePath.startsWith(`${root}/`)))
          problems.push(`${area.manifest}: ${modulePath} lies under none of its roots.`);
        const earlier = seen.get(modulePath);
        if (earlier) problems.push(`${modulePath} is listed in ${earlier} and again in ${area.manifest}.`);
        seen.set(modulePath, area.manifest);
      }
    }
    expect(problems).toEqual([]);
  });

  test('every module under an area root is covered by a property test or exempt with a reason', () => {
    const problems = areas.flatMap((area) => {
      const listed = new Set([...area.covered, ...Object.keys(area.exempt)]);
      return area.roots
        .flatMap(modulesUnder)
        .filter((modulePath) => !listed.has(modulePath))
        .map(
          (modulePath) =>
            `${modulePath} lies in the area "${area.area}" (${area.rule}). Write ${propertyTestOf(modulePath)} and list the module under "covered" in ${area.manifest}, or list it under "exempt" with why no such rule lives there.`,
        );
    });
    expect(problems).toEqual([]);
  });

  test('every covered module has a property test beside it that drives it through fast-check', () => {
    const problems = areas.flatMap((area) =>
      area.covered.flatMap((modulePath) => {
        const propertyTest = propertyTestOf(modulePath);
        return existsSync(resolve(repositoryRoot, propertyTest))
          ? coverageProblems(modulePath, propertyTest)
          : [`${modulePath} is covered in ${area.manifest}, but ${propertyTest} does not exist.`];
      }),
    );
    expect(problems).toEqual([]);
  });

  test('a property test takes the shared seed and run count, and a failing case is one counterexample with its issue', () => {
    expect(listPropertyTests().flatMap((file) => settingProblems(file))).toEqual([]);
  });
});

describe('property test gate', () => {
  const MODULE = 'lib/date-time/berlin.ts';
  const FILE = 'lib/date-time/berlin.property.test.ts';
  const header =
    "import { describe, test } from 'bun:test';\nimport fc from 'fast-check';\nimport { addLocalDays } from './berlin';\n";
  const property = "fc.assert(fc.property(fc.integer(), (n) => addLocalDays('2026-01-01', n) !== ''))";
  const covers = (body: string): boolean => coverageProblems(MODULE, FILE, header + body).length === 0;

  test('counts a property in a test, test.each or a running suite, through a local helper too', () => {
    expect(covers(`test('x', () => { ${property}; });`)).toBe(true);
    expect(covers(`describe('s', () => { test.each([1])('x %d', () => { ${property}; }); });`)).toBe(true);
    expect(
      covers(
        "const next = (n: number) => addLocalDays('2026-01-01', n);\ntest('x', () => { fc.assert(fc.property(fc.integer(), (n) => next(n) !== '')); });",
      ),
    ).toBe(true);
  });

  test('never counts a property that does not run or is expected to fail', () => {
    for (const body of [
      `test.skip('x', () => { ${property}; });`,
      `describe.skip('s', () => { test('x', () => { ${property}; }); });`,
      `describe.if(false)('s', () => { test('x', () => { ${property}; }); });`,
      `test.todo('x', () => { ${property}; });`,
      `test.failing('x', () => { ${property}; });`,
      `function unused() { ${property}; }\ntest('x', () => {});`,
    ])
      expect(covers(body)).toBe(false);
  });

  test('refuses a run setting of its own, an alias of fc.assert and a failing case that hides a property', () => {
    const problems = (body: string): string[] => settingProblems(FILE, header + body);
    expect(
      problems(`test('x', () => { fc.assert(fc.property(fc.integer(), () => true), { 'numRuns': 0 }); });`),
    ).not.toEqual([]);
    expect(
      problems(
        `const check = fc.assert;\ntest('x', () => { check(fc.property(fc.integer(), () => true)); });`,
      ),
    ).not.toEqual([]);
    expect(
      problems(
        `// known bug: werk-flow/werkflow-planning#1 probe\ntest.failing('x', () => { ${property}; });`,
      ),
    ).not.toEqual([]);
    expect(problems(`test('x', () => { ${property}; });`)).toEqual([]);
    const namespaced = header.replace("import fc from 'fast-check';", "import * as fc from 'fast-check';");
    expect(settingProblems(FILE, `${namespaced}test('x', () => { ${property}; });`)).toEqual([]);
  });
});
