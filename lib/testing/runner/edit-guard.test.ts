// Rule test: an agent edit to a proof input is refused while a verification run holds the workspace lock.
import { expect, test } from 'bun:test';
import {
  editedFiles,
  guardedInputs,
  refusalMessage,
  repositoryPath,
  resetsLocalStack,
  sharedStateCommand,
  stackResetRefusal,
  sourceRewritingCommand,
} from './edit-guard';

const root = '/work/werkflow-app';
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
  expect(repositoryPath('/work/werkflow-app/lib/a.ts', root)).toBe('lib/a.ts');
  expect(repositoryPath('lib/a.ts', root, `${root}/`)).toBe('lib/a.ts');
  expect(repositoryPath('/home/someone/scratch/a.ts', root)).toBeUndefined();
  expect(
    guardedInputs({
      files: [
        `${root}/lib/a.ts`,
        `${root}/docs/technical/testing.md`,
        `${root}/.agent-logs/note.md`,
        '/home/someone/scratch/a.ts',
      ],
      repositoryRoot: root,
      outsideProof,
    }),
  ).toEqual(['lib/a.ts']);
});

// The Codex hook payloads (https://learn.chatgpt.com/docs/hooks, "Tool coverage"): a shell command,
// unified exec (exec_command) included, arrives as Bash and an edit as apply_patch, both with
// tool_input.command. A reviewer that probes the guard with an internal tool name probes no real call.
test('the documented Codex payloads are guarded: Bash for exec_command, apply_patch for an edit', () => {
  expect(sourceRewritingCommand({ tool_name: 'Bash', tool_input: { command: 'bun run format' } })).toBe(
    'bun run format',
  );
  const patch = '*** Begin Patch\n*** Update File: lib/a.ts\n*** End Patch';
  expect(editedFiles({ tool_name: 'apply_patch', tool_input: { command: patch } })).toEqual(['lib/a.ts']);
  // Defense in depth: a `cmd` without `command` is read too.
  expect(sourceRewritingCommand({ tool_name: 'Bash', tool_input: { cmd: 'bun run format' } })).toBe(
    'bun run format',
  );
  expect(editedFiles({ tool_name: 'apply_patch', tool_input: { cmd: patch } })).toEqual(['lib/a.ts']);
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

test('commands that reset the stack or replace the build are named with their effect, mentions are not', () => {
  const shell = (command: string): string | undefined =>
    sharedStateCommand({ tool_name: 'Bash', tool_input: { command } })?.name;
  expect(shell('supabase db reset')).toBe('supabase db reset');
  expect(shell('bash -lc "cd /work/app && supabase db reset"')).toBe('supabase db reset');
  expect(shell('cd app && bunx supabase stop')).toBe('supabase stop');
  expect(shell('bunx next build')).toBe('next build');
  expect(shell('git grep -n "supabase db reset" docs')).toBeUndefined();
  expect(shell('echo run supabase stop later')).toBeUndefined();
  expect(shell("cat >> notes.md <<'EOF'\nguard (supabase db reset, stop)\nEOF")).toBeUndefined();
  expect(shell('bun run build')).toBeUndefined();
  expect(shell('supabase status')).toBeUndefined();
  expect(
    sharedStateCommand({ tool_name: 'Write', tool_input: { command: 'supabase db reset' } }),
  ).toBeUndefined();
  const reset = sharedStateCommand({ tool_name: 'Bash', tool_input: { command: 'supabase db reset' } });
  expect(reset).toBeDefined();
  const message = refusalMessage({
    operation: 'independent verification groups',
    startedAt: '2026-10-08T08:00:00.000Z',
    inputs: [],
    ...(reset && { command: reset.name }),
    ...(reset?.effect !== undefined && { effect: reset.effect }),
  });
  expect(message).toContain('Running supabase db reset would rebuild the local database');
  expect(message).not.toContain('fingerprints');
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

test('a stack reset or stop is refused while another worktree holds the shared local stack', () => {
  const shell = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
  const holder = {
    operation: 'audit:lab:field',
    workspace: '/work/werkflow-app-thread-2',
    mode: 'exclusive',
    startedAt: '2026-10-25T10:00:00.000Z',
  };
  expect(resetsLocalStack(shell('supabase db reset'))).toBe(true);
  expect(resetsLocalStack(shell('bunx next build'))).toBe(false);
  const refusal = stackResetRefusal(shell('supabase db reset'), [holder]);
  expect(refusal).toContain(
    '"audit:lab:field" holds the shared local stack (exclusive, /work/werkflow-app-thread-2',
  );
  expect(refusal).not.toContain('workspace lock');
  expect(stackResetRefusal(shell('supabase stop'), [holder])).toContain(
    'would stop the local Supabase stack',
  );
  expect(stackResetRefusal(shell('supabase db reset'), [])).toBeUndefined();
  expect(stackResetRefusal(shell('bunx next build'), [holder])).toBeUndefined();
});
