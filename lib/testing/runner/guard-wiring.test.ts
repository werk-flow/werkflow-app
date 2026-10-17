// Rule test: both agent tools run the edit guard before every tool call that can write a file.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const GUARD = 'scripts/guard-edits-during-verification.ts';

const hookFileSchema = z.object({
  hooks: z.object({
    PreToolUse: z.array(
      z.object({
        matcher: z.string(),
        hooks: z.array(z.object({ type: z.string(), command: z.string() })),
      }),
    ),
  }),
});

/** The tools whose calls run the guard, read from a hook file's PreToolUse matchers. */
function guardedTools(file: string, tools: readonly string[]): string[] {
  const { hooks } = hookFileSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8')));
  return tools.filter((tool) =>
    hooks.PreToolUse.some(
      (entry) =>
        new RegExp(`^(?:${entry.matcher})$`).test(tool) &&
        entry.hooks.some((hook) => hook.type === 'command' && hook.command.includes(GUARD)),
    ),
  );
}

// The edit guard (docs/technical/testing.md, "How a run executes") only works while both tools call it.
test('Claude runs the edit guard before every file and shell tool', () => {
  const tools = ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'];
  expect(guardedTools('.claude/settings.json', tools)).toEqual(tools);
});

test('Codex runs the edit guard before every file and shell tool', () => {
  const tools = ['apply_patch', 'Edit', 'Write', 'Bash'];
  expect(guardedTools('.codex/hooks.json', tools)).toEqual(tools);
});
