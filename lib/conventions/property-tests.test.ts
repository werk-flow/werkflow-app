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

/** Why a covered module's property test does not drive it through fast-check, if it does not. */
function coverageProblems(modulePath: string, propertyTest: string): string[] {
  const source = parseProductSource(propertyTest);
  const fastCheck = runtimeBindings(source, propertyTest, (target) => target === 'fast-check');
  const covered = runtimeBindings(source, propertyTest, (target) => target === stemOf(modulePath));
  const asserted = fastCheckCalls(source, fastCheck, 'assert').filter((call) => referencesAny(call, covered));
  if (fastCheck.size === 0) return [`${propertyTest} imports no fast-check.`];
  if (covered.size === 0) return [`${propertyTest} imports no value of ${modulePath}.`];
  return asserted.length === 0
    ? [`${propertyTest} has no fc.assert whose property calls a value of ${modulePath}.`]
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
function settingProblems(file: string): string[] {
  const source = parseProductSource(file);
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
  for (const call of fastCheckCalls(source, fastCheck, 'configureGlobal'))
    problems.push(`${at(call)}: only scripts/unit-test-preload.ts configures fast-check.`);
  const visit = (node: ts.Node): void => {
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
      if (fastCheckCalls(node, fastCheck, 'assert').length > 0)
        problems.push(
          `${at(node)}: a failing case holds one fixed counterexample, never fc.assert, so it hides no other failure.`,
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

  test('every property test belongs to a covered module', () => {
    const covered = new Set(areas.flatMap((area) => area.covered.map(propertyTestOf)));
    const orphans = listPropertyTests().filter((file) => !covered.has(file));
    expect(orphans).toEqual([]);
  });

  test('a property test takes the shared seed and run count, and a failing case is one counterexample with its issue', () => {
    expect(listPropertyTests().flatMap(settingProblems)).toEqual([]);
  });
});
