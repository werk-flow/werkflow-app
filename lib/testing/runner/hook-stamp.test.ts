// Rule test: `bun run check:changed` passes under an agent tool only after that tool ran every guard
// its hook file wires before a shell call (lib/testing/runner/hook-stamp.ts), and each such guard stamps its run.
import { afterEach, expect, test } from 'bun:test';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { agentToolOf, shellHookStamps, stampHookRun, untrustedHooksRefusal } from './hook-stamp';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A checkout whose Codex hook file runs two guards before a shell call and one before an MCP call. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-hook-stamp-'));
  directories.push(root);
  mkdirSync(join(root, '.codex'));
  mkdirSync(join(root, '.claude/hooks'), { recursive: true });
  mkdirSync(join(root, 'scripts'));
  for (const script of ['.claude/hooks/refuse-a.ts', '.claude/hooks/refuse-mcp.ts', 'scripts/guard-b.ts'])
    writeFileSync(join(root, script), `// ${script}\n`);
  const entry = (matcher: string, command: string) => ({ matcher, hooks: [{ type: 'command', command }] });
  writeFileSync(
    join(root, '.codex/hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          entry('^(apply_patch|Edit|Write|Bash)$', 'bun scripts/guard-b.ts'),
          entry(
            '^Bash$',
            'root="$(git rev-parse --show-toplevel)" || exit 0; bun "$root/.claude/hooks/refuse-a.ts"',
          ),
          entry('^mcp__.*$', 'bun "$root/.claude/hooks/refuse-mcp.ts"'),
        ],
      },
    }),
  );
  return root;
}
const runAll = (root: string): void => {
  for (const { script } of shellHookStamps('codex', root)) stampHookRun(join(root, script), root, 'codex');
};

test('a process runs under the nearest agent tool above it, and a human shell under none', () => {
  const row = (pid: number, parent: number, program: string) => ({ pid, parent, program });
  const processes = [
    row(1, 0, 'systemd'),
    row(10, 1, 'codex'),
    row(11, 10, 'bash'),
    row(12, 11, 'bun'),
    row(20, 1, 'claude'),
    row(21, 20, 'bash'),
    row(22, 21, 'codex'),
    row(23, 22, 'bun'),
    row(30, 1, 'bash'),
    row(31, 30, 'bun'),
  ];
  expect(agentToolOf(12, processes)).toBe('codex');
  expect(agentToolOf(21, processes)).toBe('claude');
  expect(agentToolOf(23, processes)).toBe('codex');
  expect(agentToolOf(31, processes)).toBeUndefined();
  expect(agentToolOf(999, processes)).toBeUndefined();
});

test('check:changed fails under an agent tool that has not run the guards, and passes in a human shell', () => {
  const root = checkout();
  // Codex skips an untrusted project hook silently: no guard ran, so no stamp exists.
  const refusal = untrustedHooksRefusal(root, 'codex');
  expect(refusal).toStartWith(
    'check:changed refuses to pass: codex has not run these guards before a shell call in this checkout: scripts/guard-b.ts, .claude/hooks/refuse-a.ts.',
  );
  expect(refusal).toContain('ask the owner to run `/hooks` in Codex on this machine');
  // A person at a terminal, and CI, run under no agent tool.
  expect(untrustedHooksRefusal(root, undefined)).toBeUndefined();
});

test('once the tool has run every shell guard the check passes, and one guard left out still fails it', () => {
  const root = checkout();
  stampHookRun(join(root, 'scripts/guard-b.ts'), root, 'codex');
  expect(untrustedHooksRefusal(root, 'codex')).toContain(
    'has not run this guard before a shell call in this checkout: .claude/hooks/refuse-a.ts.',
  );
  runAll(root);
  expect(untrustedHooksRefusal(root, 'codex')).toBeUndefined();
  // The MCP guard runs before no shell call, so it owes no stamp and leaves none.
  stampHookRun(join(root, '.claude/hooks/refuse-mcp.ts'), root, 'codex');
  expect(readdirSync(join(root, '.t3/hook-stamps'))).toHaveLength(2);
  // A guard started by neither tool leaves no stamp.
  stampHookRun(join(root, 'scripts/guard-b.ts'), checkout(), undefined);
});

test('a changed guard or a changed entry needs a new run: the old stamp does not count', () => {
  const root = checkout();
  runAll(root);
  appendFileSync(join(root, '.claude/hooks/refuse-a.ts'), '// a new rule\n');
  expect(untrustedHooksRefusal(root, 'codex')).toContain('.claude/hooks/refuse-a.ts');
  runAll(root);
  expect(untrustedHooksRefusal(root, 'codex')).toBeUndefined();
  // Codex asks for trust again when an entry changes, and skips it until then.
  const hooks = readFileSync(join(root, '.codex/hooks.json'), 'utf8');
  writeFileSync(
    join(root, '.codex/hooks.json'),
    hooks.replace('bun scripts/guard-b.ts', 'bun scripts/guard-b.ts --strict'),
  );
  expect(untrustedHooksRefusal(root, 'codex')).toContain(
    'this guard before a shell call in this checkout: scripts/guard-b.ts.',
  );
});

test('a stamp that cannot be written never stops a guard', () => {
  const root = checkout();
  writeFileSync(join(root, '.t3'), 'not a folder');
  expect(() => stampHookRun(join(root, 'scripts/guard-b.ts'), root, 'codex')).not.toThrow();
  rmSync(join(root, '.codex/hooks.json'));
  expect(() => stampHookRun(join(root, 'scripts/guard-b.ts'), root, 'codex')).not.toThrow();
});

// A guard wired before a shell call that leaves no stamp would fail every agent's check:changed.
test('every guard either tool runs before a shell call stamps its run first', () => {
  for (const tool of ['claude', 'codex'] as const) {
    const stamps = shellHookStamps(tool, repositoryRoot);
    expect(stamps.length).toBeGreaterThan(3);
    for (const { script } of stamps) {
      const text = readFileSync(resolve(repositoryRoot, script), 'utf8');
      expect([script, text.includes('stampHookRun(import.meta.path, ')]).toEqual([script, true]);
    }
  }
});
