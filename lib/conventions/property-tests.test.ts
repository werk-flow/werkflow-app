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
// covers, and the modules exempt with the reason no such rule lives there. A new module under a
// root fails here until the manifest classifies it, so a change of the list shows in review.

const MANIFEST_DIRECTORY = 'lib/testing/property-test-areas';
const PROPERTY_TEST = /\.property\.test\.ts$/;
const KNOWN_BUG = /^\s*known bug:\s*werk-flow\/werkflow-planning#\d+\s+\S/;
/** Only scripts/unit-test-preload.ts sets these (lib/testing/property-runs.ts). */
const RUN_SETTINGS = new Set(['seed', 'numRuns', 'configureGlobal']);

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

/** The `.ts` modules under a root folder or the root module itself, tests and declarations left out. */
function modulesUnder(root: string): string[] {
  const absolute = resolve(repositoryRoot, root);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [root];
  return readdirSync(absolute, { recursive: true, encoding: 'utf8' })
    .map((name) => `${root}/${name.split('\\').join('/')}`)
    .filter((file) => /\.tsx?$/.test(file) && !/\.(?:test|spec)\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
    .sort();
}

/** A Server Action, a server-only reader or a client module: I/O at the edge, never the rule itself. */
function isBoundary(file: string): boolean {
  if (file.endsWith('.tsx')) return true;
  const source = parseProductSource(file);
  const [first] = source.statements;
  const directive =
    first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)
      ? first.expression.text
      : '';
  return (
    directive === 'use server' ||
    directive === 'use client' ||
    importsOf(source).some((specifier) => specifier === 'server-only')
  );
}

function importsOf(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

/** The repository path an import names, without extension, or the bare package name. */
function importTarget(fromFile: string, specifier: string): string {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return posix.normalize(`${dirname(fromFile)}/${specifier}`);
  return specifier;
}

const propertyTestOf = (modulePath: string): string => modulePath.replace(/\.ts$/, '.property.test.ts');

function listPropertyTests(): string[] {
  return readdirSync(resolve(repositoryRoot, 'lib'), { recursive: true, encoding: 'utf8' })
    .map((name) => `lib/${name.split('\\').join('/')}`)
    .filter((file) => PROPERTY_TEST.test(file))
    .sort();
}

/** What a property test does that only the shared run settings may do, and failing tests without an issue. */
function runSettingViolations(file: string): string[] {
  const source = parseProductSource(file);
  const text = source.getFullText();
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const named =
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isPropertyAccessExpression(node)
          ? node.name.text
          : undefined;
    if (named && RUN_SETTINGS.has(named))
      found.push(
        `${file}: sets \`${named}\`; the seed and run count come from lib/testing/property-runs.ts.`,
      );
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'failing') {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      const above = text.split('\n')[line - 1] ?? '';
      const comment = /^\s*\/\/(.*)$/.exec(above)?.[1] ?? '';
      if (!KNOWN_BUG.test(comment))
        found.push(
          `${file}:${line + 1}: a failing case needs \`// known bug: werk-flow/werkflow-planning#<n> <why>\` on the line above.`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
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
        .filter((modulePath) => !listed.has(modulePath) && !isBoundary(modulePath))
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
        if (!existsSync(resolve(repositoryRoot, propertyTest)))
          return [`${modulePath} is covered in ${area.manifest}, but ${propertyTest} does not exist.`];
        const source = parseProductSource(propertyTest);
        const targets = importsOf(source).map((specifier) => importTarget(propertyTest, specifier));
        const missing: string[] = [];
        if (!targets.includes('fast-check')) missing.push('imports no fast-check');
        if (!targets.includes(modulePath.replace(/\.ts$/, ''))) missing.push(`never imports ${modulePath}`);
        if (!source.getFullText().includes('fc.assert(')) missing.push('asserts no property with fc.assert');
        return missing.map((reason) => `${propertyTest} ${reason}.`);
      }),
    );
    expect(problems).toEqual([]);
  });

  test('every property test belongs to a covered module', () => {
    const covered = new Set(areas.flatMap((area) => area.covered.map(propertyTestOf)));
    const orphans = listPropertyTests().filter((file) => !covered.has(file));
    expect(orphans).toEqual([]);
  });

  test('a property test takes the shared seed and run count, and a failing case names its issue', () => {
    expect(listPropertyTests().flatMap(runSettingViolations)).toEqual([]);
  });
});
