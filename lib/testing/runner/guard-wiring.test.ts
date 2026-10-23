// Rule test: both agent tools run the edit guard before every tool call that can write a file, and the
// publication-bypass refusal before every shell call.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const GUARD = 'scripts/guard-edits-during-verification.ts';
const BYPASS_REFUSAL = '.claude/hooks/refuse-publication-bypass.ts';

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

/** The tools whose calls run the given hook script, read from a hook file's PreToolUse matchers. */
function guardedTools(file: string, tools: readonly string[], script = GUARD): string[] {
  const { hooks } = hookFileSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8')));
  return tools.filter((tool) =>
    hooks.PreToolUse.some(
      (entry) =>
        new RegExp(`^(?:${entry.matcher})$`).test(tool) &&
        entry.hooks.some((hook) => hook.type === 'command' && hook.command.includes(script)),
    ),
  );
}

// The edit guard (docs/technical/testing.md, "How a run executes") only works while both tools call it.
test('Claude runs the edit guard before every file and shell tool', () => {
  const tools = ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'];
  expect(guardedTools('.claude/settings.json', tools)).toEqual(tools);
});

// Codex names its tools in hook payloads as its hooks documentation states
// (https://learn.chatgpt.com/docs/hooks, "Tool coverage"): every shell command,
// unified exec (exec_command) included, matches `Bash`; an edit matches
// `apply_patch`, `Edit` or `Write` and reports `tool_name: "apply_patch"`; Bash
// and apply_patch carry `tool_input.command`. So these matchers cover every
// Codex call; an internal function name such as exec_command never reaches a hook.
test('Codex runs the edit guard before every file and shell tool', () => {
  const tools = ['apply_patch', 'Edit', 'Write', 'Bash'];
  expect(guardedTools('.codex/hooks.json', tools)).toEqual(tools);
});

// The bypass refusal (docs/technical/testing.md, "Publication gate") keeps --no-verify and core.hooksPath overrides out of agent shells.
test('Claude runs the publication-bypass refusal before every shell tool', () => {
  const tools = ['Bash', 'PowerShell'];
  expect(guardedTools('.claude/settings.json', tools, BYPASS_REFUSAL)).toEqual(tools);
});

test('Codex runs the publication-bypass refusal before every shell tool', () => {
  const tools = ['Bash'];
  expect(guardedTools('.codex/hooks.json', tools, BYPASS_REFUSAL)).toEqual(tools);
});
