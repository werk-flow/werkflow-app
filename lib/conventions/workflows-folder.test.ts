// Rule test: code reads the repository's workflows through workflowsFolder()
// (lib/testing/ci-workflow.ts), never by the literal `.github/workflows` path. On the CI mirror the
// pushed tree keeps them in .github/held-workflows (scripts/ci/mirror-push.ts), and a literal read
// fails there while it passes on every other runner.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
/** A read of a repository workflow by its literal folder: a reader call, or a path built from the repository. */
const LITERAL_READ =
  /(readFileSync|readdirSync|read)\((join|resolve)?\(?[^)]*['"`]\.github\/workflows|(join|resolve)\((repositoryRoot|repository|repoRoot|import\.meta\.dir)[^)]*['"`](\.\.\/)*\.github\/workflows/;

const sources = (folder: string): string[] =>
  readdirSync(join(repositoryRoot, folder), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(?:ts|tsx|mjs)$/.test(name))
    .map((name) => join(folder, name));

test('no code reads a repository workflow by the literal .github/workflows path', () => {
  // This file names such reads as its own cases.
  const self = 'lib/conventions/workflows-folder.test.ts';
  const files = [...sources('lib'), ...sources('scripts')].filter((file) => file !== self);
  const literal = files.flatMap((file) =>
    readFileSync(join(repositoryRoot, file), 'utf8')
      .split('\n')
      .flatMap((line, index) => (LITERAL_READ.test(line) ? [`${file}:${index + 1}`] : [])),
  );
  expect(literal).toEqual([]);
});

test('the rule sees the reads that failed on the mirror', () => {
  for (const line of [
    "readFileSync(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')",
    "join(repository, '.github/workflows/release.yml'),",
    "const ci = read('.github/workflows/ci.yml');",
    "readFileSync(resolve(import.meta.dir, '../../../.github/workflows/ci.yml'), 'utf8')",
  ])
    expect(LITERAL_READ.test(line), line).toBe(true);
  expect(LITERAL_READ.test("const NIGHTLY = { path: '.github/workflows/nightly.yml' };")).toBe(false);
});
