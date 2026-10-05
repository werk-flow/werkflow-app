// Rule test: an agent edit to a proof input is refused while a verification run holds the workspace lock.
import { expect, test } from 'bun:test';
import {
  editedFiles,
  guardedInputs,
  refusalMessage,
  repositoryPath,
  sourceRewritingCommand,
} from './edit-guard';

const root = 'C:/work/werkflow-app';
const outsideProof = (path: string): boolean => path.startsWith('docs/') || path.startsWith('.agent-logs/');

test('a file tool names one path and a patch names every file in its headers', () => {
  expect(editedFiles({ tool_name: 'Edit', tool_input: { file_path: 'lib/a.ts' } })).toEqual(['lib/a.ts']);
  expect(editedFiles({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'n.ipynb' } })).toEqual([
    'n.ipynb',
  ]);
  const patch = [
    '*** Begin Patch',
    '*** Update File: lib/a.ts',
    '@@',
    '*** Add File: tests/new.spec.ts',
    '*** Delete File: lib/old.ts',
    '*** Update File: lib/b.ts',
    '*** Move to: lib/c.ts',
    '*** End Patch',
  ].join('\n');
  expect(editedFiles({ tool_name: 'apply_patch', tool_input: { command: patch } })).toEqual([
    'lib/a.ts',
    'tests/new.spec.ts',
    'lib/old.ts',
    'lib/b.ts',
    'lib/c.ts',
  ]);
  expect(editedFiles({ tool_name: 'Bash', tool_input: { command: 'ls' } })).toEqual([]);
  expect(editedFiles({ tool_name: 'Edit' })).toEqual([]);
});

test('only proof inputs inside the repository are guarded', () => {
  expect(repositoryPath('C:\\work\\werkflow-app\\lib\\a.ts', root)).toBe('lib/a.ts');
  expect(repositoryPath('/c/work/werkflow-app/lib/a.ts', root)).toBe('lib/a.ts');
  expect(repositoryPath('lib/a.ts', root, `${root}/`)).toBe('lib/a.ts');
  expect(repositoryPath('C:/Users/someone/scratch/a.ts', root)).toBeUndefined();
  expect(
    guardedInputs({
      files: [
        `${root}/lib/a.ts`,
        `${root}/docs/technical/testing.md`,
        `${root}/.agent-logs/note.md`,
        'C:/Users/someone/scratch/a.ts',
      ],
      repositoryRoot: root,
      outsideProof,
    }),
  ).toEqual(['lib/a.ts']);
});

test('shell commands that rewrite source files are named, checks and plain commands are not', () => {
  const shell = (command: string): string | undefined =>
    sourceRewritingCommand({ tool_name: 'Bash', tool_input: { command } });
  expect(shell('bunx prettier --write lib/a.ts')).toBe('prettier --write');
  expect(shell('bunx eslint --fix lib')).toBe('eslint --fix');
  expect(shell('bun run format')).toBe('bun run format');
  expect(shell('bun run types:generate')).toBe('bun run types:generate');
  expect(shell("sed -i 's/a/b/' lib/a.ts")).toBe('sed -i');
  expect(shell('git checkout -- lib/a.ts')).toBe('a git command that rewrites the working tree');
  expect(shell('bun run format:check')).toBeUndefined();
  expect(shell('bunx prettier --check lib/a.ts')).toBeUndefined();
  expect(shell('bun run test:verify --group ui:contracts')).toBeUndefined();
  expect(shell('git status --porcelain')).toBeUndefined();
  expect(
    sourceRewritingCommand({ tool_name: 'Edit', tool_input: { command: 'bun run format' } }),
  ).toBeUndefined();
});

test('the refusal names the run, the files and the way out', () => {
  const message = refusalMessage({
    operation: 'independent verification groups',
    startedAt: '2026-10-04T08:00:00.000Z',
    inputs: ['lib/a.ts', 'lib/b.ts', 'lib/c.ts', 'lib/d.ts'],
  });
  expect(message).toContain('independent verification groups');
  expect(message).toContain('lib/a.ts, lib/b.ts, lib/c.ts and 1 more');
  expect(message).toContain('Wait until the run ends');
  expect(
    refusalMessage({ operation: 'x', startedAt: 'y', inputs: [], command: 'prettier --write' }),
  ).toContain('Running prettier --write');
});
