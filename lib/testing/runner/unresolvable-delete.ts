/**
 * The rule of the agent delete guard (.claude/hooks/refuse-unresolvable-delete.ts):
 * Claude Code's built-in safety check cannot resolve the target of an `rm`
 * whose operand is a variable or a wildcard on a relative path, so it asks the
 * owner even in full access, with or without an earlier `cd`. The guard refuses
 * that shape and names the form the check can resolve.
 */

import { type ShellWord, program, readShell } from '../../security/shell-words';

/** Operands whose directory the shell decides: a variable anywhere, or a wildcard on a relative path. */
function unresolvedOperands(args: readonly ShellWord[]): string[] {
  const end = args.findIndex((arg) => arg.text === '--');
  return args
    .filter((arg, index) => (end !== -1 && index > end) || !arg.text.startsWith('-'))
    .filter((arg) => arg.expands || (arg.globs && !arg.text.startsWith('/')))
    .map((arg) => arg.text);
}

/**
 * The refusal of a shell command that runs `rm`, with any flags, on a variable
 * or on a wildcard with a relative path, or undefined. A delete with an
 * explicit absolute path (`rm -f /tmp/x/*`) passes.
 */
export function unresolvableDeleteRefusal(command: string): string | undefined {
  const reading = readShell(command);
  if (!reading)
    return "Refused: the delete guard cannot tell where a heredoc delimiter in this command ends, so it cannot rule out an rm after it. Write the delimiter plainly: <<EOF or <<'EOF'.";
  // A program the guard cannot judge (python3, node, timeout) may run its heredoc as commands.
  if (reading.unknownBodies.some((body) => /(?:^|[\s;&|(])rm\s/.test(body)))
    return 'Refused: rm in a heredoc that a program the delete guard cannot judge reads, so it may run. Feed the script to a shell (bash <<EOF) or write the rm out as a command.';
  for (const words of reading.commands) {
    const call = program(words);
    if (call?.name !== 'rm') continue;
    const operands = unresolvedOperands(call.args);
    if (operands.length === 0) continue;
    return [
      `Refused: rm on ${operands.join(' ')}.`,
      'The Claude Code safety check cannot resolve that target, so it would stop for the owner even in full access.',
      'Delete with an explicit absolute path (rm -rf /tmp/x/*), or work in a fresh folder from mktemp -d instead of emptying one.',
    ].join(' ');
  }
  return undefined;
}
