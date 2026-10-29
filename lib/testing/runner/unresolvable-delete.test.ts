// Rule test: a delete whose target the shell decides is refused before Claude Code's safety check asks the owner.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unresolvableDeleteRefusal } from './unresolvable-delete';

test('rm on a variable or a relative wildcard is refused, with any flags and with or without a cd', () => {
  for (const command of [
    // The command that stopped a full-access thread after the first version of this guard.
    'cd /tmp/ci-measure; rm -f logs/*',
    'cd /tmp/ci-measure && rm logs/*.txt',
    'pushd /tmp/ci-measure; rm -f logs/*',
    'rm -f logs/*',
    'rm *.log',
    'rm -rf * && cd /tmp/ev35',
    'rm -f "$target"',
    'rm -rf "$target"/*',
    'rm -f /tmp/$name/*',
    'rm -i -v -- logs/?',
    'ls && rm -f ./build-[0-9]',
    'if [ -d logs ]; then rm -f logs/*; fi',
    'if true; then :; else rm -f logs/*; fi',
    'for f in a b; do rm -f "$f"; done',
    '{ rm -f logs/*; }',
    '! rm -f logs/*',
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
    expect(unresolvableDeleteRefusal(command), command).toContain('explicit absolute path');
});

test('explicit absolute deletes and literal relative deletes pass', () => {
  for (const command of [
    'mkdir -p /tmp/ev35 && cd /tmp/ev35 && rm -rf /tmp/ev35/* && gh run download 123',
    'cd /tmp/ev35 && rm -rf /tmp/ev35',
    // A redirection target is no operand.
    'cd /tmp/ev35 && rm -rf /tmp/ev35/* > "$log" 2>&1',
    'cd /tmp/ev35 && rm -rf /tmp/ev35/* 2>"$log"',
    'cd /tmp/ev35 && rm -rf /tmp/ev35/*>"$log" 2>&1',
    'cd /tmp/ev35 && rm -rf build',
    'cd /tmp/ci-measure; rm -f /tmp/ci-measure/logs/*',
    'pushd /tmp/ci-measure && rm /tmp/ci-measure/logs/*.txt',
    'rm -f /tmp/x/*',
    'rm -f logs/run.txt',
    'if [ -d /tmp/x ]; then rm -f /tmp/x/*; fi',
    'cd /tmp/ev35 && rm -rf "*"',
    "cd /tmp/ev35 && rm -rf '$target'",
    'cd /tmp/ev35 && rm -rf \\*',
    'dir=$(mktemp -d) && cd "$dir" && gh run download 123',
    'cd /tmp/ev35 && ls * # rm -rf *',
    'cd /tmp/ev35 && grep -r "rm -rf *" .',
    'git log --grep "cd x && rm -rf *"',
    // A heredoc body is data written to a file, not commands.
    "cd /tmp/ev35 && cat > a.test.ts <<'EOF'\ncd /tmp/x && rm -rf *\nEOF",
    'cd /tmp/ev35 && python3 - <<EOF\nrm -rf $dir\nEOF\nls',
  ])
    expect(unresolvableDeleteRefusal(command), command).toBeUndefined();
});

test('the Claude hook refuses the delete with the reason and lets other calls through', () => {
  const script = resolve(import.meta.dir, '../../../.claude/hooks/refuse-unresolvable-delete.ts');
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
  for (const command of [
    'mkdir -p /tmp/ev35 && cd /tmp/ev35 && rm -rf * && gh run download 123',
    'cd /tmp/ci-measure; rm -f logs/*',
  ]) {
    const refused = call(bash(command));
    expect(refused.exitCode, refused.output).toBe(2);
    expect(refused.output).toContain('rm -rf /tmp/x/*');
  }
  const absolute = call(bash('cd /tmp/ci-measure; rm -f /tmp/ci-measure/logs/*'));
  expect(absolute.exitCode, absolute.output).toBe(0);
  const edit = call(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'a.ts' } }));
  expect(edit.exitCode, edit.output).toBe(0);
  const unreadable = call('not json');
  expect(unreadable.exitCode, unreadable.output).toBe(0);
});
