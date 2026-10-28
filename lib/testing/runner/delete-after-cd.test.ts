// Rule test: a recursive delete whose target depends on an earlier cd is refused before Claude Code's safety check asks the owner.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { deleteAfterCdRefusal } from './delete-after-cd';

test('rm -r on a wildcard or a variable after a cd in the same command is refused', () => {
  for (const command of [
    'mkdir -p /tmp/ev35 && cd /tmp/ev35 && rm -rf * && gh run download 123',
    'cd /tmp/ev35; rm -rf ./*',
    'cd /tmp/ev35\nrm -r build-?',
    'pushd /tmp/ev35 && rm -fr [ab]*',
    'cd "$dir" && rm --recursive --force -- *',
    'cd /tmp/ev35 && rm -rf "$target"',
    'cd /tmp/ev35 && rm -Rf ${OUT}/*',
    'cd /tmp/ev35 && rm -rf $(ls)',
    'cd /tmp/ev35 && rm -rf /tmp/$name/*',
    '(cd /tmp/ev35 && sudo rm -rf *)',
    'cd /tmp/ev35 && LC_ALL=C /bin/rm -rf *',
    'cd /tmp/ev35 && cat <<EOF > notes.txt\ndata\nEOF\nrm -rf *',
    'cd /tmp/ev35 && \\\nrm -rf *',
    'cd /tmp/ev35 && rm -rf * 2>&1 > "$log"',
  ])
    expect(deleteAfterCdRefusal(command), command).toContain('explicit absolute path');
});

test('explicit absolute deletes, deletes without a cd and non-recursive deletes pass', () => {
  for (const command of [
    'mkdir -p /tmp/ev35 && cd /tmp/ev35 && rm -rf /tmp/ev35/* && gh run download 123',
    'cd /tmp/ev35 && rm -rf /tmp/ev35',
    // A redirection target is no operand.
    'cd /tmp/ev35 && rm -rf /tmp/ev35/* > "$log" 2>&1',
    'cd /tmp/ev35 && rm -rf /tmp/ev35/* 2>"$log"',
    'cd /tmp/ev35 && rm -rf build',
    'cd /tmp/ev35 && rm -f *.log',
    'cd /tmp/ev35 && rm -rf "*"',
    "cd /tmp/ev35 && rm -rf '$target'",
    'cd /tmp/ev35 && rm -rf \\*',
    'rm -rf * && cd /tmp/ev35',
    'rm -rf "$target"/*',
    'dir=$(mktemp -d) && cd "$dir" && gh run download 123',
    'cd /tmp/ev35 && ls * # rm -rf *',
    'cd /tmp/ev35 && grep -r "rm -rf *" .',
    'git log --grep "cd x && rm -rf *"',
    // A heredoc body is data written to a file, not commands.
    "cd /tmp/ev35 && cat > a.test.ts <<'EOF'\ncd /tmp/x && rm -rf *\nEOF",
    'cd /tmp/ev35 && python3 - <<EOF\nrm -rf $dir\nEOF\nls',
  ])
    expect(deleteAfterCdRefusal(command), command).toBeUndefined();
});

test('the Claude hook refuses the delete with the reason and lets other calls through', () => {
  const script = resolve(import.meta.dir, '../../../.claude/hooks/refuse-delete-after-cd.ts');
  const call = (stdin: string) => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, script],
      stdin: Buffer.from(stdin),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}` };
  };
  const bash = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const refused = call(bash('mkdir -p /tmp/ev35 && cd /tmp/ev35 && rm -rf * && gh run download 123'));
  expect(refused.exitCode, refused.output).toBe(2);
  expect(refused.output).toContain('rm -rf /tmp/x/*');
  const absolute = call(bash('cd /tmp/ev35 && rm -rf /tmp/ev35/*'));
  expect(absolute.exitCode, absolute.output).toBe(0);
  const edit = call(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'a.ts' } }));
  expect(edit.exitCode, edit.output).toBe(0);
  const unreadable = call('not json');
  expect(unreadable.exitCode, unreadable.output).toBe(0);
});
