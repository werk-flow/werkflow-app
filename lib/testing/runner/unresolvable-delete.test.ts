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
    // A command substitution runs its rm, quoted or not, and so does one in an expanding heredoc.
    'echo $(rm -rf logs/*)',
    'value=$(rm "$target")',
    'echo "$(cd /tmp/ev35 && rm -rf *)"',
    'cat <<EOF\n$(\nrm -rf logs/*\n)\nEOF',
    // A `<<` in a comment or in quotes opens no heredoc, so the next line still runs.
    '# <<EOF\nrm -rf logs/*',
    'echo "<<EOF"\nrm -rf logs/*',
    // A heredoc a shell reads runs as a script.
    "bash <<'EOF'\nrm -rf logs/*\nEOF",
    'sh <<EOF\nrm -rf logs/*\nEOF',
    'cat <<EOF | sh\nrm -rf logs/*\nEOF',
    'bash -s <<EOF\nrm -rf logs/*\nEOF',
    "source /dev/stdin <<'EOF'\nrm -rf logs/*\nEOF",
    // Each delimiter form ends its heredoc at the line \`EOF\`, so the next line runs.
    ...['\\EOF', "'EOF'", '"EOF"', 'E"OF"'].map(
      (delimiter) => `cat > note.md <<${delimiter}\nbody\nEOF\nrm -rf logs/*`,
    ),
    'cat > note.md <<-EOF\n\tbody\n\tEOF\nrm -rf logs/*',
    // Inside double quotes a backslash escapes the quote: this delimiter is E"OF.
    'cat > note.md << "E\\"OF"\nbody\nE"OF\nrm -rf logs/*',
    // An arithmetic shift opens no heredoc.
    'echo $((1<<2))\nrm -rf logs/*\n2',
    '(( x <<= 1 ))\nrm -rf logs/*\n1',
    // A body that never reaches its delimiter is read as commands: the guard errs toward refusing.
    'cat > note.md <<EOF\nrm -rf logs/*',
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
    'cd /tmp/ev35 && cat > clean.sh <<EOF\nrm -rf $dir\nEOF\nls',
    // A quoted delimiter, in any form, keeps its body literal.
    ...['\\EOF', "'EOF'", '"EOF"', 'E"OF"'].map(
      (delimiter) => `cat > a.md <<${delimiter}\n$(rm -rf logs/*)\nEOF`,
    ),
    'cat > a.md << "E\\"OF"\n$(rm -rf logs/*)\nE"OF',
  ])
    expect(unresolvableDeleteRefusal(command), command).toBeUndefined();
});

// A delimiter the reader cannot place is refused rather than guessed: an rm may follow it.
test('a heredoc delimiter the reader cannot place is refused', () => {
  for (const command of [
    'cat > note.md <<"EOF\nrm -rf /tmp/x\nEOF"',
    "cat > note.md <<$'EOF'\nbody\nEOF\nls",
  ])
    expect(unresolvableDeleteRefusal(command), command).toContain('cannot tell where a heredoc delimiter');
});

// A program the guard cannot judge may run its heredoc, so an rm there is refused.
test('an rm in a heredoc an unknown program reads is refused, and data-only heredocs pass', () => {
  for (const command of [
    'cd /tmp/ev35 && python3 - <<EOF\nrm -rf $dir\nEOF\nls',
    'timeout 60 bash <<EOF\nrm -rf /tmp/x\nEOF',
    "node - <<'EOF'\nrm -rf build\nEOF",
  ])
    expect(unresolvableDeleteRefusal(command), command).toContain('a program the delete guard cannot judge');
  for (const command of [
    'cat <<EOF > clean.sh\nrm -rf logs/*\nEOF',
    "tee clean.sh <<'EOF'\nrm -rf logs/*\nEOF",
    "gh pr comment 1 --body-file - <<'EOF'\nrm -rf logs/* is refused.\nEOF",
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
