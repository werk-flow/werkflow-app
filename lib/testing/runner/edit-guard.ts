import { isAbsolute, relative, resolve } from 'node:path';

/**
 * The decision of the agent edit guard (scripts/guard-edits-during-verification.ts):
 * while a verification run holds the workspace lock, an agent must not change
 * a file the run fingerprints, because that voids the run. The agent tools
 * call the script before every edit; this module holds its pure rules.
 */

/** The fields both agent tools send before a tool call. */
export type GuardedToolCall = {
  tool_name?: unknown;
  tool_input?: unknown;
};

const PATCH_FILE_LINE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/;
const PATCH_MOVE_LINE = /^\*\*\* Move to: (.+)$/;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Every file a tool call writes: a file tool names one path, a patch names each file in its headers. */
export function editedFiles(call: GuardedToolCall): string[] {
  if (!call.tool_input || typeof call.tool_input !== 'object') return [];
  const input = call.tool_input as Record<string, unknown>;
  const files = [text(input.file_path), text(input.notebook_path), text(input.path)].filter(
    (file): file is string => file !== undefined,
  );
  if (call.tool_name === 'apply_patch') {
    const patch = text(input.command) ?? text(input.patch) ?? text(input.input) ?? '';
    for (const line of patch.split(/\r?\n/)) {
      const match = PATCH_FILE_LINE.exec(line) ?? PATCH_MOVE_LINE.exec(line);
      if (match?.[1]) files.push(match[1].trim());
    }
  }
  return [...new Set(files)];
}

/** Shell commands that rewrite source files in place; other commands are left to the runner's drift check. */
const SOURCE_REWRITING_COMMANDS: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /\bprettier\b[^|;&]*\s(--write|-w)\b/, name: 'prettier --write' },
  { pattern: /\beslint\b[^|;&]*\s--fix\b/, name: 'eslint --fix' },
  { pattern: /\bbun\s+run\s+format(?![:\w-])/, name: 'bun run format' },
  { pattern: /\bbun\s+run\s+types:generate\b/, name: 'bun run types:generate' },
  { pattern: /\bsed\b[^|;&]*\s-i\b/, name: 'sed -i' },
  {
    pattern: /\bgit\s+(checkout|restore|reset|stash|apply|merge|rebase|clean|pull|cherry-pick)\b/,
    name: 'a git command that rewrites the working tree',
  },
];

/**
 * A command position: line start, after `;`, `&` or `|`, or behind a launcher
 * such as `wsl --exec` or `bunx`. An opening parenthesis does not count,
 * because prose in a heredoc uses it far more often than a subshell does.
 */
const AT_COMMAND = String.raw`(?:^|[;&|\n]|\bbash\s+-l?c\s+["']|\b(?:wsl(?:\.exe)?(?:\s+(?:--exec|-e))?|bunx|npx|sudo)\s)\s*`;

/** Shell commands that change state a running test operation depends on, with that effect. */
const SHARED_STATE_COMMANDS: readonly { pattern: RegExp; name: string; effect: string }[] = [
  {
    pattern: new RegExp(String.raw`${AT_COMMAND}supabase\s+db\s+reset\b`),
    name: 'supabase db reset',
    effect: 'would rebuild the local database and delete the test world the run uses',
  },
  {
    pattern: new RegExp(String.raw`${AT_COMMAND}supabase\s+stop\b`),
    name: 'supabase stop',
    effect: 'would stop the local Supabase stack the run uses',
  },
  {
    pattern: new RegExp(String.raw`${AT_COMMAND}next\s+build\b`),
    name: 'next build',
    effect: 'would replace the .next build the test server serves',
  },
];

function shellCommand(call: GuardedToolCall): string | undefined {
  if (call.tool_name !== 'Bash' && call.tool_name !== 'PowerShell') return undefined;
  if (!call.tool_input || typeof call.tool_input !== 'object') return undefined;
  return text((call.tool_input as Record<string, unknown>).command);
}

/** The shared-state command a shell call runs, if any; mentions inside a search or a string do not count. */
export function sharedStateCommand(call: GuardedToolCall): { name: string; effect: string } | undefined {
  const command = shellCommand(call);
  if (!command) return undefined;
  const match = SHARED_STATE_COMMANDS.find((entry) => entry.pattern.test(command));
  return match && { name: match.name, effect: match.effect };
}

/** The name of the rewriting command a shell call contains, if any. */
export function sourceRewritingCommand(call: GuardedToolCall): string | undefined {
  const command = shellCommand(call);
  if (!command) return undefined;
  return SOURCE_REWRITING_COMMANDS.find((entry) => entry.pattern.test(command))?.name;
}

/** A path inside the repository as the runner names it, or undefined for a file outside it. */
export function repositoryPath(
  file: string,
  repositoryRoot: string,
  cwd = repositoryRoot,
): string | undefined {
  // Git Bash hands over /c/Users/...; Node resolves only the drive form.
  const windowsForm = /^\/([a-zA-Z])\//.test(file) ? `${file[1]}:${file.slice(2)}` : file;
  const absolute = isAbsolute(windowsForm) ? windowsForm : resolve(cwd, windowsForm);
  const path = relative(resolve(repositoryRoot), absolute).replace(/\\/g, '/');
  if (!path || path.startsWith('..') || isAbsolute(path)) return undefined;
  return path;
}

/** Files of the call that a running verification fingerprints. */
export function guardedInputs(input: {
  files: readonly string[];
  repositoryRoot: string;
  cwd?: string;
  /** True for a path the runner leaves out of every proof: documentation, run evidence, ignored files. */
  outsideProof: (path: string) => boolean;
}): string[] {
  return input.files.flatMap((file) => {
    const path = repositoryPath(file, input.repositoryRoot, input.cwd);
    return path && !input.outsideProof(path) ? [path] : [];
  });
}

export function refusalMessage(input: {
  operation: string;
  startedAt: string;
  inputs: readonly string[];
  command?: string;
  /** What the command would do to the run; defaults to voiding it through changed proof inputs. */
  effect?: string;
}): string {
  const target = input.command
    ? `Running ${input.command}`
    : `Editing ${input.inputs.slice(0, 3).join(', ')}${input.inputs.length > 3 ? ` and ${input.inputs.length - 3} more` : ''}`;
  return [
    `Refused: a test operation holds the workspace lock ("${input.operation}", started ${input.startedAt}).`,
    `${target} ${input.effect ?? 'would change files the run fingerprints and void its results'}.`,
    'Wait until the run ends, or stop it deliberately first. Documentation and files under .agent-logs stay editable.',
  ].join(' ');
}
