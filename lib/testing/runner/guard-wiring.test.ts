// Rule test: both agent tools run the edit guard before every tool call that can write a file,
// Claude runs the delete guard before every shell call, and both run the Boat key guard.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const GUARD = 'scripts/guard-edits-during-verification.ts';
const DELETE_GUARD = '.claude/hooks/refuse-unresolvable-delete.ts';
const PRODUCTION_MCP_GUARD = '.claude/hooks/refuse-production-mcp.ts';
const PRODUCTION_LOG_GUARD = '.claude/hooks/refuse-production-logs.ts';
const BOAT_KEY_GUARD = '.claude/hooks/refuse-boat-key-reads.ts';

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
  const tools = ['Edit', 'Write', 'NotebookEdit', 'Bash'];
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

// Only Claude Code's built-in safety check stops on a delete it cannot resolve
// (lib/testing/runner/unresolvable-delete.ts); Codex in full access runs it without asking.
test('Claude runs the delete guard before every shell call', () => {
  expect(guardedTools('.claude/settings.json', ['Bash'], DELETE_GUARD)).toEqual(['Bash']);
});

// Agents never read production data (lib/security/production-access.ts); both tools name an
// MCP tool `mcp__<server>__<tool>` in hook payloads.
test('both agent tools run the production MCP guard before every MCP tool', () => {
  const tools = [
    'mcp__supabase__execute_sql',
    'mcp__supabase-prod-readonly__execute_sql',
    'mcp__claude_ai_Supabase__list_tables',
  ];
  expect(guardedTools('.claude/settings.json', tools, PRODUCTION_MCP_GUARD)).toEqual(tools);
  expect(guardedTools('.codex/hooks.json', tools, PRODUCTION_MCP_GUARD)).toEqual(tools);
});

// No agent reads Vercel's production logs through the CLI (lib/security/production-access.ts);
// both tools name every shell call `Bash`.
test('both agent tools run the production log guard before every shell call', () => {
  expect(guardedTools('.claude/settings.json', ['Bash'], PRODUCTION_LOG_GUARD)).toEqual(['Bash']);
  expect(guardedTools('.codex/hooks.json', ['Bash'], PRODUCTION_LOG_GUARD)).toEqual(['Bash']);
});

// Only the process that calls Boat reads the Boat API key (lib/security/boat-key-access.ts). Claude
// reads files through Read and Grep as well as the shell; Codex reads them only through the shell.
test('both agent tools run the Boat key guard before every call that can read a file', () => {
  const tools = ['Bash', 'Read', 'Grep'];
  expect(guardedTools('.claude/settings.json', tools, BOAT_KEY_GUARD)).toEqual(tools);
  expect(guardedTools('.codex/hooks.json', ['Bash'], BOAT_KEY_GUARD)).toEqual(['Bash']);
});

test('Claude denies its file tools the Boat API key and the Boat CLI config', () => {
  const settings = z
    .object({ permissions: z.object({ deny: z.array(z.string()) }) })
    .parse(JSON.parse(readFileSync(resolve(repositoryRoot, '.claude/settings.json'), 'utf8')));
  for (const rule of [
    'Read(~/.config/werkflow/boat-api-key)',
    'Read(~/.config/ascii/boat/**)',
    'Edit(~/.config/werkflow/boat-api-key)',
    'Edit(~/.config/ascii/boat/**)',
  ])
    expect(settings.permissions.deny).toContain(rule);
});
