import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import ts from 'typescript';
import { assertBuildIdentity, calculateBuildInputs, type BuildReceipt } from "./build-identity";

const directories: string[] = [];

function runtimeToolingImportProblems(repositoryRoot: string): string[] {
  const problems: string[] = [];
  const excluded = ['lib/testing', 'lib/docs', 'temporary-transcripts'];
  function visit(directory: string, rootRuntimeEntries = false): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (rootRuntimeEntries && !/^(middleware|proxy|instrumentation(?:-client)?)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const path = join(directory, entry.name);
      const name = relative(repositoryRoot, path).replaceAll('\\', '/');
      if (excluded.includes(name)) continue;
      if (entry.isDirectory()) { visit(path); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(name) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) continue;
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      function inspect(node: ts.Node): void {
        let specifier: ts.Expression | undefined;
        if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) specifier = node.moduleSpecifier;
        else if (ts.isExportDeclaration(node) && !node.isTypeOnly) specifier = node.moduleSpecifier;
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0];
        if (specifier && ts.isStringLiteralLike(specifier)) {
          const target = specifier.text.startsWith('@/') ? resolve(repositoryRoot, specifier.text.slice(2)) : specifier.text.startsWith('.') ? resolve(dirname(path), specifier.text) : null;
          if (target) {
            const owned = relative(repositoryRoot, target).replaceAll('\\', '/');
            if (excluded.some((prefix) => owned === prefix || owned.startsWith(`${prefix}/`))) problems.push(`${name}: ${specifier.text}`);
          }
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
    }
  }
  for (const root of ['app', 'components', 'hooks', 'lib']) visit(join(repositoryRoot, root));
  visit(repositoryRoot, true);
  return problems;
}

// This whole-repository AST census measured 6.1 s on Windows; it is not a latency contract.
test('application runtime cannot import command-only modules excluded from build identity', () => {
  expect(runtimeToolingImportProblems(resolve(import.meta.dir, '../..'))).toEqual([]);
}, 15_000);

test('root runtime entries receive the same tooling import protection as app files', () => {
  const root = fixture();
  for (const name of ['middleware.ts', 'proxy.ts', 'instrumentation.ts', 'instrumentation-client.ts']) {
    writeFileSync(join(root, name), "import '@/lib/testing/workspace-test-lock';");
    expect(runtimeToolingImportProblems(root)).toContain(`${name}: @/lib/testing/workspace-test-lock`);
  }
});
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "werkflow-build-identity-"));
  directories.push(directory);
  for (const child of ["app", "lib", "docs", "tests"]) mkdirSync(join(directory, child));
  writeFileSync(join(directory, "app/page.tsx"), "export default function Page() { return null; }");
  writeFileSync(join(directory, ".env.local"), "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nSECRET=never-print-me");
  return directory;
}

test("app edits invalidate builds while docs and test-only edits do not", () => {
  const root = fixture();
  const before = calculateBuildInputs(root, {});
  writeFileSync(join(root, "docs/note.md"), "Changed prose");
  writeFileSync(join(root, "lib/example.test.ts"), "test-only change");
  mkdirSync(join(root, "lib/testing"));
  mkdirSync(join(root, "lib/docs"));
  writeFileSync(join(root, "lib/testing/runner.ts"), "runner-only change");
  writeFileSync(join(root, "lib/docs/check.ts"), "docs tooling change");
  expect(calculateBuildInputs(root, {})).toEqual(before);
  writeFileSync(join(root, "app/page.tsx"), "changed product");
  expect(calculateBuildInputs(root, {}).sourceDigest).not.toBe(before.sourceDigest);
});

test("environment file and inherited backend changes invalidate without revealing secrets", () => {
  const root = fixture();
  const before = calculateBuildInputs(root, {});
  const overridden = calculateBuildInputs(root, { NEXT_PUBLIC_SUPABASE_URL: "https://different.supabase.co" });
  expect(overridden.environmentDigest).not.toBe(before.environmentDigest);
  writeFileSync(join(root, ".env.local"), "SECRET=changed");
  expect(calculateBuildInputs(root, {}).environmentDigest).not.toBe(before.environmentDigest);
  expect(JSON.stringify(before)).not.toContain("never-print-me");
});

test("certification rejects a different served build, checkout, source, or backend", () => {
  const root = fixture();
  const inputs = calculateBuildInputs(root, {});
  const receipt: BuildReceipt = { version: 1, ...inputs, repositoryRoot: root, buildId: "build-one", completedAt: new Date().toISOString() };
  const request = { receipt, inputs, repositoryRoot: root, diskBuildId: "build-one", servedBuildId: "build-one" };
  expect(() => assertBuildIdentity(request)).not.toThrow();
  expect(() => assertBuildIdentity({ ...request, servedBuildId: "build-two" })).toThrow("served");
  expect(() => assertBuildIdentity({ ...request, diskBuildId: "build-two" })).toThrow("receipt");
  mkdirSync(join(root, "other"));
  expect(() => assertBuildIdentity({ ...request, repositoryRoot: join(root, "other") })).toThrow("workspace");
  expect(() => assertBuildIdentity({ ...request, inputs: { ...inputs, sourceDigest: "changed" } })).toThrow("source");
  expect(() => assertBuildIdentity({ ...request, inputs: { ...inputs, environmentDigest: "changed" } })).toThrow("environment");
});
